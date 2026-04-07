import { normalizeTaskDates, type WorkingCalendarConfig } from "@/server/schedulers/business-days";
import type { DependencyModel, TaskModel } from "@/types/domain";

export function timelineGroupHeadId(task: TaskModel): string {
  return task.timelineHeadTaskId ?? task.id;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function canMergeSelectedTimelineTasks(tasks: TaskModel[], selectedIds: string[]): boolean {
  const picked: TaskModel[] = [];
  for (const id of selectedIds) {
    const t = tasks.find((x) => x.id === id);
    if (t && !t.isMilestone) {
      picked.push(t);
    }
  }
  if (picked.length < 2) {
    return false;
  }
  const headIds = new Set(picked.map(timelineGroupHeadId));
  if (headIds.size !== 1) {
    return false;
  }
  const headId = [...headIds][0]!;
  const head = tasks.find((t) => t.id === headId);
  return Boolean(head && head.timelineHeadTaskId == null);
}

export interface TimelineMergePlan {
  headId: string;
  headPatch: {
    startDate: string;
    endDate: string;
    durationDays: number;
    progress: number;
    timelineHeadTaskId: null;
  };
  segmentIdsToDelete: string[];
  nextDependencies: DependencyModel[];
  dependencyDeletes: string[];
  dependencyUpdates: Array<{
    id: string;
    predecessorTaskId: string;
    successorTaskId: string;
  }>;
}

function depDedupeKey(d: Pick<DependencyModel, "predecessorTaskId" | "successorTaskId" | "type" | "lagDays">): string {
  return `${d.predecessorTaskId}|${d.successorTaskId}|${d.type}|${d.lagDays}`;
}

export function planTimelineMerge(args: {
  tasks: TaskModel[];
  dependencies: DependencyModel[];
  selectedIds: string[];
  calendar: WorkingCalendarConfig;
  holidayDayKeysByTaskId: Map<string, Set<string>>;
}): TimelineMergePlan | null {
  const { tasks, dependencies, selectedIds, calendar, holidayDayKeysByTaskId } = args;

  const picked: TaskModel[] = [];
  for (const id of selectedIds) {
    const t = tasks.find((x) => x.id === id);
    if (t && !t.isMilestone) {
      picked.push(t);
    }
  }
  if (picked.length < 2) {
    return null;
  }

  const headIds = new Set(picked.map(timelineGroupHeadId));
  if (headIds.size !== 1) {
    return null;
  }

  const headId = [...headIds][0]!;
  const headTask = tasks.find((t) => t.id === headId);
  if (!headTask || headTask.timelineHeadTaskId != null) {
    return null;
  }

  const mergeCal: WorkingCalendarConfig = {
    ...calendar,
    holidayDayKeys: holidayDayKeysByTaskId.get(headId) ?? new Set<string>(),
  };

  const mergeSet = picked.filter((t) => timelineGroupHeadId(t) === headId);
  if (mergeSet.length < 2) {
    return null;
  }

  const startKeys = mergeSet.map((t) => dayKey(t.startDate));
  const endKeys = mergeSet.map((t) => dayKey(t.endDate));
  const minDay = startKeys.reduce((a, b) => (a <= b ? a : b));
  const maxDay = endKeys.reduce((a, b) => (a >= b ? a : b));

  const normalized = normalizeTaskDates(
    {
      startDate: `${minDay}T00:00:00.000Z`,
      endDate: `${maxDay}T00:00:00.000Z`,
      isMilestone: headTask.isMilestone,
    },
    mergeCal,
  );

  const progress = Math.max(...mergeSet.map((t) => t.progress));

  const segmentIdsToDelete = mergeSet.map((t) => t.id).filter((id) => id !== headId);
  const deleteSet = new Set(segmentIdsToDelete);

  const replaced = dependencies
    .map((d) => ({
      ...d,
      predecessorTaskId: deleteSet.has(d.predecessorTaskId) ? headId : d.predecessorTaskId,
      successorTaskId: deleteSet.has(d.successorTaskId) ? headId : d.successorTaskId,
    }))
    .filter((d) => d.predecessorTaskId !== d.successorTaskId);

  const slot = new Map<string, DependencyModel>();
  const dependencyDeletes: string[] = [];

  for (const d of replaced) {
    const k = depDedupeKey(d);
    const existing = slot.get(k);
    if (!existing) {
      slot.set(k, d);
      continue;
    }
    if (d.id.localeCompare(existing.id) < 0) {
      dependencyDeletes.push(existing.id);
      slot.set(k, d);
    } else {
      dependencyDeletes.push(d.id);
    }
  }

  const nextDependencies = [...slot.values()];
  const origById = new Map(dependencies.map((d) => [d.id, d]));
  const dependencyUpdates: Array<{ id: string; predecessorTaskId: string; successorTaskId: string }> = [];

  for (const d of nextDependencies) {
    const orig = origById.get(d.id);
    if (!orig) {
      continue;
    }
    if (orig.predecessorTaskId !== d.predecessorTaskId || orig.successorTaskId !== d.successorTaskId) {
      dependencyUpdates.push({
        id: d.id,
        predecessorTaskId: d.predecessorTaskId,
        successorTaskId: d.successorTaskId,
      });
    }
  }

  return {
    headId,
    headPatch: {
      startDate: normalized.startDate.toISOString(),
      endDate: normalized.endDate.toISOString(),
      durationDays: normalized.durationDays,
      progress,
      timelineHeadTaskId: null,
    },
    segmentIdsToDelete,
    nextDependencies,
    dependencyDeletes,
    dependencyUpdates,
  };
}
