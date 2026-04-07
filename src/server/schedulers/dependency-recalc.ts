import type { DependencyType } from "@/types/domain";

import {
  addBusinessDays,
  maxDate,
  normalizeTaskDates,
  shiftToNearestWorkingDay,
  type WorkingCalendarConfig,
} from "@/server/schedulers/business-days";

export interface ScheduleTask {
  id: string;
  projectId: string;
  startDate: Date;
  endDate: Date;
  durationDays: number;
  isMilestone: boolean;
}

export interface ScheduleDependency {
  id: string;
  predecessorTaskId: string;
  successorTaskId: string;
  type: DependencyType;
  lagDays: number;
  /** true일 때만 선행 작업 변경 시 후행 일정 재계산에 사용 */
  drivesSchedule?: boolean;
}

export class ScheduleCycleError extends Error {
  constructor(message = "의존관계에 순환 참조가 있습니다.") {
    super(message);
    this.name = "ScheduleCycleError";
  }
}

function getTopologicalOrder(tasks: ScheduleTask[], dependencies: ScheduleDependency[]): string[] {
  const taskIds = new Set(tasks.map((task) => task.id));
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const task of tasks) {
    indegree.set(task.id, 0);
    adjacency.set(task.id, []);
  }

  for (const dependency of dependencies) {
    if (!taskIds.has(dependency.predecessorTaskId) || !taskIds.has(dependency.successorTaskId)) {
      continue;
    }

    adjacency.get(dependency.predecessorTaskId)?.push(dependency.successorTaskId);
    indegree.set(
      dependency.successorTaskId,
      (indegree.get(dependency.successorTaskId) ?? 0) + 1,
    );
  }

  const queue: string[] = [];
  for (const [taskId, degree] of indegree.entries()) {
    if (degree === 0) {
      queue.push(taskId);
    }
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const taskId = queue.shift();
    if (!taskId) continue;

    order.push(taskId);
    for (const successorTaskId of adjacency.get(taskId) ?? []) {
      const nextDegree = (indegree.get(successorTaskId) ?? 0) - 1;
      indegree.set(successorTaskId, nextDegree);
      if (nextDegree === 0) {
        queue.push(successorTaskId);
      }
    }
  }

  if (order.length !== tasks.length) {
    throw new ScheduleCycleError();
  }

  return order;
}

function getStartConstraint(
  dependency: ScheduleDependency,
  predecessor: ScheduleTask,
  calendar: WorkingCalendarConfig,
): Date | null {
  if (dependency.type === "FS") {
    return addBusinessDays(predecessor.endDate, dependency.lagDays + 1, calendar);
  }

  if (dependency.type === "SS") {
    return addBusinessDays(predecessor.startDate, dependency.lagDays, calendar);
  }

  return null;
}

function getEndConstraint(
  dependency: ScheduleDependency,
  predecessor: ScheduleTask,
  calendar: WorkingCalendarConfig,
): Date | null {
  if (dependency.type === "FF") {
    return addBusinessDays(predecessor.endDate, dependency.lagDays, calendar);
  }

  if (dependency.type === "SF") {
    return addBusinessDays(predecessor.startDate, dependency.lagDays, calendar);
  }

  return null;
}

export function assertNoDependencyCycle(tasks: ScheduleTask[], dependencies: ScheduleDependency[]) {
  getTopologicalOrder(tasks, dependencies);
}

export function recalculateSuccessorTasks(params: {
  tasks: ScheduleTask[];
  dependencies: ScheduleDependency[];
  calendar: WorkingCalendarConfig;
  calendarByTaskId?: Map<string, WorkingCalendarConfig>;
  anchorTaskIds: string[];
  /** true면 연결된 구속을 모두 반영(drivesSchedule 무시). 스케줄 연동 토글 켰을 때 사용 */
  forceAllDependencies?: boolean;
}): ScheduleTask[] {
  const { tasks, calendar, calendarByTaskId, anchorTaskIds } = params;
  const dependencies =
    params.forceAllDependencies === true
      ? params.dependencies
      : params.dependencies.filter((d) => d.drivesSchedule !== false);
  const resolveCalendar = (taskId: string) => calendarByTaskId?.get(taskId) ?? calendar;

  const normalizedTasks = tasks.map((task) => {
    const taskCalendar = resolveCalendar(task.id);
    const normalized = normalizeTaskDates(
      {
        startDate: task.startDate,
        endDate: task.endDate,
        durationDays: task.durationDays,
        isMilestone: task.isMilestone,
      },
      taskCalendar,
    );

    return {
      ...task,
      ...normalized,
    };
  });

  const taskMap = new Map<string, ScheduleTask>(normalizedTasks.map((task) => [task.id, { ...task }]));
  const order = getTopologicalOrder(normalizedTasks, dependencies);

  const downstream = new Map<string, string[]>();
  for (const dependency of dependencies) {
    const list = downstream.get(dependency.predecessorTaskId) ?? [];
    list.push(dependency.successorTaskId);
    downstream.set(dependency.predecessorTaskId, list);
  }

  const anchors = new Set(anchorTaskIds);
  const impacted = new Set<string>();
  const queue = [...anchorTaskIds];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    for (const next of downstream.get(current) ?? []) {
      if (anchors.has(next) || impacted.has(next)) {
        continue;
      }
      impacted.add(next);
      queue.push(next);
    }
  }

  if (impacted.size === 0) {
    return [];
  }

  const changedTaskIds = new Set<string>();

  for (const taskId of order) {
    if (!impacted.has(taskId)) {
      continue;
    }

    const current = taskMap.get(taskId);
    if (!current) continue;

    const incomingDependencies = dependencies.filter((dependency) => dependency.successorTaskId === taskId);
    if (incomingDependencies.length === 0) {
      continue;
    }
    const successorCalendar = resolveCalendar(taskId);

    const startConstraints: Date[] = [];
    const endConstraints: Date[] = [];

    for (const dependency of incomingDependencies) {
      const predecessor = taskMap.get(dependency.predecessorTaskId);
      if (!predecessor) continue;

      const startConstraint = getStartConstraint(dependency, predecessor, successorCalendar);
      const endConstraint = getEndConstraint(dependency, predecessor, successorCalendar);

      if (startConstraint) {
        startConstraints.push(startConstraint);
      }

      if (endConstraint) {
        endConstraints.push(endConstraint);
      }
    }

    const maxStartConstraint = maxDate(startConstraints);
    const maxEndConstraint = maxDate(endConstraints);

    let nextStart = current.startDate;

    if (maxStartConstraint && maxStartConstraint.getTime() > nextStart.getTime()) {
      nextStart = maxStartConstraint;
    }

    if (maxEndConstraint) {
      const startFromEnd = addBusinessDays(maxEndConstraint, -(current.durationDays - 1), successorCalendar);
      if (startFromEnd.getTime() > nextStart.getTime()) {
        nextStart = startFromEnd;
      }
    }

    nextStart = shiftToNearestWorkingDay(nextStart, successorCalendar, "forward");
    const nextEnd = current.isMilestone
      ? nextStart
      : addBusinessDays(nextStart, current.durationDays - 1, successorCalendar);

    if (
      nextStart.getTime() !== current.startDate.getTime() ||
      nextEnd.getTime() !== current.endDate.getTime()
    ) {
      taskMap.set(taskId, {
        ...current,
        startDate: nextStart,
        endDate: nextEnd,
      });
      changedTaskIds.add(taskId);
    }
  }

  return [...changedTaskIds].map((taskId) => taskMap.get(taskId)!);
}

/** 이동한 작업의 종료일 변경량(델타)만큼 연결된 후행 작업들을 모두 밀어냄. 선행과 직접 연결된 것·그 다음 연결된 것 모두 동일 델타만큼 이동. */
export function cascadeSuccessorsByDelta(params: {
  tasks: ScheduleTask[];
  dependencies: ScheduleDependency[];
  anchorTaskIds: string[];
  /** 이동한 작업의 종료일이 밀린 양(ms). 양수=뒤로, 음수=앞으로 */
  deltaMs: number;
}): ScheduleTask[] {
  const { tasks, dependencies, anchorTaskIds, deltaMs } = params;
  if (deltaMs === 0) return [];

  const taskMap = new Map<string, ScheduleTask>(tasks.map((t) => [t.id, { ...t }]));
  const downstream = new Map<string, string[]>();
  for (const d of dependencies) {
    const list = downstream.get(d.predecessorTaskId) ?? [];
    list.push(d.successorTaskId);
    downstream.set(d.predecessorTaskId, list);
  }

  const anchors = new Set(anchorTaskIds);
  const impacted = new Set<string>();
  const queue = [...anchorTaskIds];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const next of downstream.get(current) ?? []) {
      if (anchors.has(next) || impacted.has(next)) continue;
      impacted.add(next);
      queue.push(next);
    }
  }

  const result: ScheduleTask[] = [];
  for (const taskId of impacted) {
    const task = taskMap.get(taskId);
    if (!task) continue;
    result.push({
      ...task,
      startDate: new Date(task.startDate.getTime() + deltaMs),
      endDate: new Date(task.endDate.getTime() + deltaMs),
    });
  }
  return result;
}
