import {
  addBusinessDays,
  businessDaysBetween,
  isWorkingDay,
  shiftToNearestWorkingDay,
  toUtcDay,
  type WorkingCalendarConfig,
} from "@/server/schedulers/business-days";
import type { TaskModel } from "@/types/domain";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayKeyFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addCalendarDaysIso(isoDay: string, delta: number): string {
  const d = new Date(`${isoDay}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return dayKeyFromDate(d);
}

/**
 * [firstCal, lastCal] 달력 구간 안의 영업일 수(양 끝 포함, 해당 일이 영업일일 때만 카운트).
 */
export function countWorkingDaysInInclusiveCalendarRange(
  firstCalDay: string,
  lastCalDay: string,
  cal: WorkingCalendarConfig,
): number {
  const start = toUtcDay(firstCalDay);
  const end = toUtcDay(lastCalDay);
  let n = 0;
  let cur = new Date(start.getTime());
  while (cur.getTime() <= end.getTime()) {
    if (isWorkingDay(cur, cal)) {
      n += 1;
    }
    cur = new Date(cur.getTime() + MS_PER_DAY);
  }
  return Math.max(1, n);
}

export interface ResolveSplitDatesInput {
  taskStartDay: string;
  taskEndDay: string;
  leftEndInclusiveDay: string;
  rawRightStartDay: string;
  calendar: WorkingCalendarConfig;
}

export interface ResolveSplitDatesResult {
  leftEndDay: string;
  leftDurationDays: number;
  rightStartDay: string;
  rightEndDay: string;
  rightDurationDays: number;
}

/**
 * 나누기: 앞/뒤 구간이 같은 영업일에 겹치지 않게 하고,
 * 앞 구간 다음 날부터 휴일·주말이면 뒤 구간 시작을 첫 영업일로 옮긴 뒤 영업일 수는 유지(종료일 연장).
 */
export function resolveSplitTaskDates(input: ResolveSplitDatesInput): ResolveSplitDatesResult {
  const cal = input.calendar;
  const t0 = input.taskStartDay.slice(0, 10);
  const t1 = input.taskEndDay.slice(0, 10);
  const leftEndIn = input.leftEndInclusiveDay.slice(0, 10);
  const rawRight = input.rawRightStartDay.slice(0, 10);

  const leftStartAdj = shiftToNearestWorkingDay(t0, cal, "forward");
  const taskEndAdj = shiftToNearestWorkingDay(t1, cal, "forward");

  const leftWorkDays = countWorkingDaysInInclusiveCalendarRange(t0, leftEndIn, cal);
  const rightWorkDays = countWorkingDaysInInclusiveCalendarRange(rawRight, t1, cal);

  let leftEndDate = addBusinessDays(leftStartAdj, leftWorkDays - 1, cal);

  const earliestRightStart = shiftToNearestWorkingDay(addCalendarDaysIso(leftEndIn, 1), cal, "forward");
  const uiRightStart = shiftToNearestWorkingDay(rawRight, cal, "forward");

  let rightStartDate =
    uiRightStart.getTime() >= earliestRightStart.getTime() ? uiRightStart : earliestRightStart;

  if (leftEndDate.getTime() >= rightStartDate.getTime()) {
    rightStartDate = shiftToNearestWorkingDay(
      addCalendarDaysIso(dayKeyFromDate(leftEndDate), 1),
      cal,
      "forward",
    );
  }

  if (rightStartDate.getTime() > taskEndAdj.getTime()) {
    throw new Error("나눈 뒤 뒤쪽 구간을 배치할 수 없습니다. 앞 구간을 더 짧게 나눠 보세요.");
  }

  let rightEndDate = addBusinessDays(rightStartDate, rightWorkDays - 1, cal);
  if (rightEndDate.getTime() > taskEndAdj.getTime()) {
    rightEndDate = taskEndAdj;
  }

  let guard = 0;
  while (leftEndDate.getTime() >= rightStartDate.getTime() && guard < 366) {
    rightStartDate = shiftToNearestWorkingDay(
      addCalendarDaysIso(dayKeyFromDate(rightStartDate), 1),
      cal,
      "forward",
    );
    rightEndDate = addBusinessDays(rightStartDate, rightWorkDays - 1, cal);
    if (rightEndDate.getTime() > taskEndAdj.getTime()) {
      rightEndDate = taskEndAdj;
    }
    if (rightStartDate.getTime() > taskEndAdj.getTime()) {
      throw new Error("앞·뒤 구간이 겹치지 않게 나눌 수 없습니다.");
    }
    guard += 1;
  }

  const leftDurationDays = Math.max(
    1,
    businessDaysBetween(shiftToNearestWorkingDay(leftStartAdj, cal, "forward"), leftEndDate, cal),
  );
  const rightDurationDays = Math.max(
    1,
    businessDaysBetween(shiftToNearestWorkingDay(rightStartDate, cal, "forward"), rightEndDate, cal),
  );

  return {
    leftEndDay: dayKeyFromDate(leftEndDate),
    leftDurationDays,
    rightStartDay: dayKeyFromDate(rightStartDate),
    rightEndDay: dayKeyFromDate(rightEndDate),
    rightDurationDays,
  };
}

export type TaskCalendarResolver = (task: { id: string; companyId: string | null }) => WorkingCalendarConfig;

/**
 * 같은 timeline 머리 아래 구간들이 날짜로 겹치면, 뒤쪽 구간부터 시작일을 앞 구간 종료 다음 영업일로 밀고
 * durationDays는 유지해 종료일을 다시 잡는다.
 */
export function shiftOverlappingTimelineSegments(
  tasks: TaskModel[],
  getCalendarForTask: TaskCalendarResolver,
): { next: TaskModel[]; changedIds: Set<string> } {
  const byHead = new Map<string, TaskModel[]>();
  for (const t of tasks) {
    const headId = t.timelineHeadTaskId ?? t.id;
    const arr = byHead.get(headId) ?? [];
    arr.push(t);
    byHead.set(headId, arr);
  }

  const changedIds = new Set<string>();
  const next = tasks.map((t) => ({ ...t }));
  const byId = new Map(next.map((t) => [t.id, t]));

  for (const [, group] of byHead) {
    if (group.length < 2) continue;

    for (let pass = 0; pass < group.length + 2; pass += 1) {
      const sorted = [...group]
        .map((t) => byId.get(t.id)!)
        .sort(
          (a, b) =>
            a.startDate.localeCompare(b.startDate) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
        );

      let touched = false;
      for (let i = 0; i < sorted.length - 1; i += 1) {
        const left = sorted[i];
        const right = sorted[i + 1];
        const leftEndKey = left.endDate.slice(0, 10);
        const rightStartKey = right.startDate.slice(0, 10);
        if (leftEndKey < rightStartKey) continue;

        const cal = getCalendarForTask(right);
        const rs = shiftToNearestWorkingDay(
          addCalendarDaysIso(left.endDate.slice(0, 10), 1),
          cal,
          "forward",
        );
        const rd = Math.max(1, right.durationDays);
        const re = addBusinessDays(rs, rd - 1, cal);
        const rightDur = Math.max(1, businessDaysBetween(rs, re, cal));

        const r = byId.get(right.id)!;
        if (r.startDate !== rs.toISOString() || r.endDate !== re.toISOString() || r.durationDays !== rightDur) {
          r.startDate = rs.toISOString();
          r.endDate = re.toISOString();
          r.durationDays = rightDur;
          changedIds.add(right.id);
          touched = true;
        }
      }
      if (!touched) break;
    }
  }

  return { next: changedIds.size > 0 ? next : tasks, changedIds };
}
