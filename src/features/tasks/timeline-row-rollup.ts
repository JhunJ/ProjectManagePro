import type { TaskModel } from "@/types/domain";

/** 목록 한 줄(머리 + 타임라인 세그먼트)의 달력 구간과 영업일 합계 */
export function rollupTimelineActivityRow(head: TaskModel, segments: TaskModel[] | undefined) {
  const all = segments?.length ? [head, ...segments] : [head];
  let minStart = head.startDate;
  let maxEnd = head.endDate;
  let workingDaysTotal = 0;
  for (const t of all) {
    if (t.startDate < minStart) minStart = t.startDate;
    if (t.endDate > maxEnd) maxEnd = t.endDate;
    workingDaysTotal += t.durationDays;
  }
  return { startDate: minStart, endDate: maxEnd, workingDaysTotal };
}
