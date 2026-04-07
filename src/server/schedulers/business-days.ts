export interface WorkingCalendarConfig {
  workMon: boolean;
  workTue: boolean;
  workWed: boolean;
  workThu: boolean;
  workFri: boolean;
  workSat: boolean;
  workSun: boolean;
  holidayDayKeys?: Set<string>;
}

export type Direction = "forward" | "backward";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_WORKING_CALENDAR: WorkingCalendarConfig = {
  workMon: true,
  workTue: true,
  workWed: true,
  workThu: true,
  workFri: true,
  workSat: false,
  workSun: false,
};

export function toUtcDay(date: Date | string): Date {
  const source = typeof date === "string" ? new Date(date) : date;
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
}

function dayToCalendarKey(day: number): keyof WorkingCalendarConfig {
  if (day === 0) return "workSun";
  if (day === 1) return "workMon";
  if (day === 2) return "workTue";
  if (day === 3) return "workWed";
  if (day === 4) return "workThu";
  if (day === 5) return "workFri";
  return "workSat";
}

export function isWorkingDay(date: Date | string, calendar: WorkingCalendarConfig): boolean {
  const normalized = toUtcDay(date);
  const day = normalized.getUTCDay();
  if (!calendar[dayToCalendarKey(day)]) {
    return false;
  }
  if (!calendar.holidayDayKeys || calendar.holidayDayKeys.size === 0) {
    return true;
  }
  const key = normalized.toISOString().slice(0, 10);
  return !calendar.holidayDayKeys.has(key);
}

export function shiftToNearestWorkingDay(
  date: Date | string,
  calendar: WorkingCalendarConfig,
  direction: Direction = "forward",
): Date {
  const delta = direction === "forward" ? 1 : -1;
  let current = toUtcDay(date);

  while (!isWorkingDay(current, calendar)) {
    current = new Date(current.getTime() + delta * MS_PER_DAY);
  }

  return current;
}

export function addBusinessDays(
  date: Date | string,
  days: number,
  calendar: WorkingCalendarConfig,
): Date {
  if (days === 0) {
    return shiftToNearestWorkingDay(date, calendar, "forward");
  }

  const direction: Direction = days > 0 ? "forward" : "backward";
  const delta = direction === "forward" ? 1 : -1;
  let remaining = Math.abs(days);
  let current = shiftToNearestWorkingDay(date, calendar, direction);

  while (remaining > 0) {
    current = new Date(current.getTime() + delta * MS_PER_DAY);
    if (isWorkingDay(current, calendar)) {
      remaining -= 1;
    }
  }

  return current;
}

export function businessDaysBetween(
  startDate: Date | string,
  endDate: Date | string,
  calendar: WorkingCalendarConfig,
): number {
  let start = shiftToNearestWorkingDay(startDate, calendar, "forward");
  const end = shiftToNearestWorkingDay(endDate, calendar, "forward");

  const direction = start.getTime() <= end.getTime() ? 1 : -1;
  let total = 0;

  while ((direction > 0 && start.getTime() <= end.getTime()) || (direction < 0 && start.getTime() >= end.getTime())) {
    if (isWorkingDay(start, calendar)) {
      total += direction;
    }
    start = new Date(start.getTime() + direction * MS_PER_DAY);
  }

  return total;
}

export interface TaskDateInput {
  startDate: Date | string;
  endDate: Date | string;
  durationDays?: number;
  isMilestone?: boolean;
}

export interface NormalizedTaskDates {
  startDate: Date;
  endDate: Date;
  durationDays: number;
}

export function normalizeTaskDates(
  input: TaskDateInput,
  calendar: WorkingCalendarConfig,
): NormalizedTaskDates {
  const startDate = shiftToNearestWorkingDay(input.startDate, calendar, "forward");
  let endDate = shiftToNearestWorkingDay(input.endDate, calendar, "forward");

  if (endDate.getTime() < startDate.getTime()) {
    endDate = startDate;
  }

  if (input.isMilestone) {
    return {
      startDate,
      endDate: startDate,
      durationDays: 1,
    };
  }

  const fallbackDuration = Math.max(1, businessDaysBetween(startDate, endDate, calendar));
  const durationDays = Math.max(1, input.durationDays ?? fallbackDuration);
  endDate = addBusinessDays(startDate, durationDays - 1, calendar);

  return {
    startDate,
    endDate,
    durationDays,
  };
}

export function maxDate(dates: Array<Date | null | undefined>): Date | null {
  const valid = dates.filter((date): date is Date => Boolean(date));
  if (valid.length === 0) {
    return null;
  }
  return valid.reduce((acc, date) => (date.getTime() > acc.getTime() ? date : acc));
}

