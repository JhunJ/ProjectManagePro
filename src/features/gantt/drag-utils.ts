import { addBusinessDays, businessDaysBetween, normalizeTaskDates, shiftToNearestWorkingDay, type WorkingCalendarConfig } from "@/server/schedulers/business-days";
import type { TaskModel } from "@/types/domain";

export function moveTaskByBusinessDays(task: TaskModel, deltaDays: number, calendar: WorkingCalendarConfig) {
  const startDate = addBusinessDays(new Date(task.startDate), deltaDays, calendar);
  const normalized = normalizeTaskDates(
    {
      startDate,
      endDate: startDate,
      durationDays: task.isMilestone ? 1 : task.durationDays,
      isMilestone: task.isMilestone,
    },
    calendar,
  );

  return {
    startDate: normalized.startDate.toISOString(),
    endDate: normalized.endDate.toISOString(),
    durationDays: normalized.durationDays,
  };
}

export function resizeTaskByBusinessDays(
  task: TaskModel,
  deltaDays: number,
  edge: "start" | "end",
  calendar: WorkingCalendarConfig,
) {
  const currentStart = new Date(task.startDate);
  const currentEnd = new Date(task.endDate);

  if (task.isMilestone) {
    const shifted = addBusinessDays(currentStart, deltaDays, calendar);
    return {
      startDate: shifted.toISOString(),
      endDate: shifted.toISOString(),
      durationDays: 1,
    };
  }

  if (edge === "start") {
    let nextStart = addBusinessDays(currentStart, deltaDays, calendar);
    nextStart = shiftToNearestWorkingDay(nextStart, calendar, "forward");

    if (nextStart.getTime() > currentEnd.getTime()) {
      nextStart = currentEnd;
    }

    const durationDays = Math.max(1, businessDaysBetween(nextStart, currentEnd, calendar));
    const normalized = normalizeTaskDates(
      {
        startDate: nextStart,
        endDate: currentEnd,
        durationDays,
        isMilestone: false,
      },
      calendar,
    );

    return {
      startDate: normalized.startDate.toISOString(),
      endDate: normalized.endDate.toISOString(),
      durationDays: normalized.durationDays,
    };
  }

  let nextEnd = addBusinessDays(currentEnd, deltaDays, calendar);
  nextEnd = shiftToNearestWorkingDay(nextEnd, calendar, "forward");

  if (nextEnd.getTime() < currentStart.getTime()) {
    nextEnd = currentStart;
  }

  const durationDays = Math.max(1, businessDaysBetween(currentStart, nextEnd, calendar));
  const normalized = normalizeTaskDates(
    {
      startDate: currentStart,
      endDate: nextEnd,
      durationDays,
      isMilestone: false,
    },
    calendar,
  );

  return {
    startDate: normalized.startDate.toISOString(),
    endDate: normalized.endDate.toISOString(),
    durationDays: normalized.durationDays,
  };
}
