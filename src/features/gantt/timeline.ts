import { endOfWeek, format, isSameDay, isSameWeek, startOfMonth, startOfWeek } from "date-fns";

import { toUtcDay } from "@/server/schedulers/business-days";
import type { HolidayModel, TaskModel, ZoomLevel } from "@/types/domain";

interface ZoomConfig {
  cellWidth: number;
  labelFormat: string;
}

export const ZOOM_CONFIG: Record<ZoomLevel, ZoomConfig> = {
  day: {
    cellWidth: 46,
    labelFormat: "MM.dd",
  },
  week: {
    cellWidth: 34,
    labelFormat: "MM.dd",
  },
  month: {
    cellWidth: 22,
    labelFormat: "MM.dd",
  },
};

/** 터치 UI에서도 날짜 헤더가 읽히도록 데스크톱 대비 약간만 좁힘(과도한 축소는 하지 않음) */
export function getTimelineCellWidth(zoomLevel: ZoomLevel, compactForTouchUi = false): number {
  const base = ZOOM_CONFIG[zoomLevel].cellWidth;
  if (!compactForTouchUi) {
    return base;
  }
  const scaled = Math.round(base * 0.88);
  if (zoomLevel === "month") {
    return Math.max(18, scaled);
  }
  if (zoomLevel === "week") {
    return Math.max(28, scaled);
  }
  return Math.max(36, scaled);
}

export interface TimelineRange {
  start: Date;
  end: Date;
  days: Date[];
}

export interface TimelineVisibilityFilter {
  hideSaturday: boolean;
  hideSunday: boolean;
  hideHoliday: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_BUFFER_DAYS = 45;
const FUTURE_BUFFER_DAYS = 180;
const EMPTY_RANGE_DAYS = 180;

/** Build an array of dates at UTC midnight for each day in [start, end]. */
function eachUtcDay(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const startUtc = toUtcDay(start);
  const endUtc = toUtcDay(end);
  const current = new Date(startUtc.getTime());
  while (current.getTime() <= endUtc.getTime()) {
    days.push(new Date(current.getTime()));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

const FIXED_KR_HOLIDAYS = new Set([
  "01-01",
  "03-01",
  "05-05",
  "06-06",
  "08-15",
  "10-03",
  "10-09",
  "12-25",
]);

export const DEFAULT_TIMELINE_VISIBILITY: TimelineVisibilityFilter = {
  hideSaturday: false,
  hideSunday: false,
  hideHoliday: false,
};

function computePaddingDays(zoomLevel: ZoomLevel): number {
  if (zoomLevel === "day") return 7;
  if (zoomLevel === "week") return 14;
  return 31;
}

export function getTimelineDayKey(date: Date | string) {
  return toUtcDay(date).toISOString().slice(0, 10);
}

export function isWeekend(date: Date | string) {
  const normalized = toUtcDay(date);
  const day = normalized.getUTCDay();
  return day === 0 || day === 6;
}

export function isFixedHoliday(date: Date | string) {
  const normalized = toUtcDay(date);
  const month = String(normalized.getUTCMonth() + 1).padStart(2, "0");
  const day = String(normalized.getUTCDate()).padStart(2, "0");
  return FIXED_KR_HOLIDAYS.has(`${month}-${day}`);
}

export function isProjectHoliday(date: Date | string, holidayDayKeys?: Set<string>) {
  return holidayDayKeys?.has(getTimelineDayKey(date)) ?? false;
}

export function isHoliday(date: Date | string, holidayDayKeys?: Set<string>) {
  return isProjectHoliday(date, holidayDayKeys) || isFixedHoliday(date);
}

function shouldHideDay(date: Date, visibility: TimelineVisibilityFilter, holidayDayKeys?: Set<string>) {
  const day = date.getUTCDay();

  if (visibility.hideSaturday && day === 6) return true;
  if (visibility.hideSunday && day === 0) return true;
  if (visibility.hideHoliday && isHoliday(date, holidayDayKeys)) return true;

  return false;
}

export function getTimelineRange(
  tasks: TaskModel[],
  zoomLevel: ZoomLevel,
  visibility: TimelineVisibilityFilter = DEFAULT_TIMELINE_VISIBILITY,
  holidayDayKeys?: Set<string>,
): TimelineRange {
  const dates = tasks.flatMap((task) => [new Date(task.startDate), new Date(task.endDate)]);
  const now = toUtcDay(new Date());

  if (dates.length === 0) {
    const start = toUtcDay(startOfWeek(now, { weekStartsOn: 1 }));
    const end = new Date(start.getTime() + EMPTY_RANGE_DAYS * DAY_MS);
    const allDays = eachUtcDay(start, end);
    const visibleDays = allDays.filter((day) => !shouldHideDay(day, visibility, holidayDayKeys));
    const days = visibleDays.length > 0 ? visibleDays : allDays;

    return {
      start: days[0],
      end: days[days.length - 1],
      days,
    };
  }

  const min = new Date(Math.min(...dates.map((date) => date.getTime())));
  const max = new Date(Math.max(...dates.map((date) => date.getTime())));
  const pad = computePaddingDays(zoomLevel);

  const start = new Date(min.getTime() - Math.max(pad, PAST_BUFFER_DAYS) * DAY_MS);
  const minStartFromToday = new Date(now.getTime() - PAST_BUFFER_DAYS * DAY_MS);
  const effectiveStart = start.getTime() > minStartFromToday.getTime() ? minStartFromToday : start;
  const end = new Date(max.getTime() + Math.max(pad, FUTURE_BUFFER_DAYS) * DAY_MS);
  const minFutureEnd = new Date(now.getTime() + FUTURE_BUFFER_DAYS * DAY_MS);
  const effectiveEnd = end.getTime() < minFutureEnd.getTime() ? minFutureEnd : end;

  const rangeStart = toUtcDay(effectiveStart);
  const rangeEnd = toUtcDay(effectiveEnd);
  const allDays = eachUtcDay(rangeStart, rangeEnd);
  const visibleDays = allDays.filter((day) => !shouldHideDay(day, visibility, holidayDayKeys));
  const days = visibleDays.length > 0 ? visibleDays : allDays;

  return {
    start: days[0],
    end: days[days.length - 1],
    days,
  };
}

/** 작업 기간 바깥으로 타임라인을 달력 일수만큼 늘립니다(숨긴 요일·공휴일 필터 동일 적용). */
export function extendTimelineRangeByCalendarDays(
  base: TimelineRange,
  pastCalendarDays: number,
  futureCalendarDays: number,
  visibility: TimelineVisibilityFilter = DEFAULT_TIMELINE_VISIBILITY,
  holidayDayKeys?: Set<string>,
): TimelineRange {
  if (pastCalendarDays <= 0 && futureCalendarDays <= 0) {
    return base;
  }
  if (base.days.length === 0) {
    return base;
  }

  const start = new Date(base.start.getTime() - Math.max(0, pastCalendarDays) * DAY_MS);
  const end = new Date(base.end.getTime() + Math.max(0, futureCalendarDays) * DAY_MS);
  const rangeStart = toUtcDay(start);
  const rangeEnd = toUtcDay(end);
  const allDays = eachUtcDay(rangeStart, rangeEnd);
  const visibleDays = allDays.filter((day) => !shouldHideDay(day, visibility, holidayDayKeys));
  const days = visibleDays.length > 0 ? visibleDays : allDays;
  if (days.length === 0) {
    return base;
  }

  return {
    start: days[0],
    end: days[days.length - 1],
    days,
  };
}

export function getOffsetFromDate(date: Date | string, timelineStart: Date, zoomLevel: ZoomLevel) {
  const config = ZOOM_CONFIG[zoomLevel];
  const normalized = toUtcDay(date);
  const days = Math.floor((normalized.getTime() - timelineStart.getTime()) / DAY_MS);
  return days * config.cellWidth;
}

export function getWidthFromDuration(durationDays: number, zoomLevel: ZoomLevel) {
  const config = ZOOM_CONFIG[zoomLevel];
  return Math.max(config.cellWidth, durationDays * config.cellWidth);
}

export function getDateFromOffset(offsetPx: number, timelineStart: Date, zoomLevel: ZoomLevel) {
  const config = ZOOM_CONFIG[zoomLevel];
  const days = Math.round(offsetPx / config.cellWidth);
  return new Date(timelineStart.getTime() + days * DAY_MS);
}

export function buildHeaderGroups(days: Date[]) {
  const monthGroups: Array<{ label: string; startIndex: number; span: number }> = [];
  const weekGroups: Array<{ label: string; startIndex: number; span: number }> = [];

  let monthStart = 0;
  let weekStart = 0;

  for (let index = 1; index <= days.length; index += 1) {
    const current = days[index - 1];
    const next = days[index];

    if (!next || startOfMonth(current).getTime() !== startOfMonth(next).getTime()) {
      monthGroups.push({
        label: format(current, "yyyy.MM"),
        startIndex: monthStart,
        span: index - monthStart,
      });
      monthStart = index;
    }

    if (!next || !isSameWeek(current, next, { weekStartsOn: 1 })) {
      weekGroups.push({
        label: `${format(startOfWeek(current, { weekStartsOn: 1 }), "MM.dd")} - ${format(
          endOfWeek(current, { weekStartsOn: 1 }),
          "MM.dd",
        )}`,
        startIndex: weekStart,
        span: index - weekStart,
      });
      weekStart = index;
    }
  }

  return { monthGroups, weekGroups };
}

/** 오늘 여부. 사용자 로컬(한국) 기준 날짜로 비교합니다. */
export function isToday(date: Date) {
  return isSameDay(date, new Date());
}

export type ProjectHolidayForLabel = Pick<HolidayModel, "startDate" | "endDate" | "name" | "scope">;

export interface HolidayLabelSegment {
  startIndex: number;
  endIndex: number;
  label: string;
}

/**
 * 프로젝트 휴일을 타임라인 일 열 기준으로 병합합니다.
 * `projectHolidayDayKeys`와 타임라인 열이 어긋나도(날짜 파싱 차이 등) 키가 있으면 최소 "휴일"은 표시합니다.
 * 같은 표기가 연속된 날은 엑셀 병합처럼 한 덩어리로 묶습니다.
 */
export function buildProjectHolidayLabelSegments(
  days: Date[],
  holidays: ProjectHolidayForLabel[],
  projectHolidayDayKeys?: Set<string>,
): HolidayLabelSegment[] {
  if (days.length === 0) {
    return [];
  }

  const project = holidays.filter((h) => h.scope === "PROJECT");
  const hasKeySet = Boolean(projectHolidayDayKeys && projectHolidayDayKeys.size > 0);
  if (project.length === 0 && !hasKeySet) {
    return [];
  }

  const labelsPerIndex = days.map((day) => {
    const key = getTimelineDayKey(day);
    const keyMarked = projectHolidayDayKeys?.has(key) ?? false;

    const names = new Set<string>();
    for (const h of project) {
      const start = getTimelineDayKey(h.startDate);
      const end = getTimelineDayKey(h.endDate);
      if (key >= start && key <= end) {
        const nm = h.name?.trim();
        names.add(nm || "휴일");
      }
    }

    if (names.size > 0) {
      return [...names].sort().join("·");
    }
    if (keyMarked) {
      return "휴일";
    }
    return "";
  });

  const segments: HolidayLabelSegment[] = [];
  let i = 0;
  while (i < labelsPerIndex.length) {
    const lab = labelsPerIndex[i];
    if (!lab) {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < labelsPerIndex.length && labelsPerIndex[j + 1] === lab) {
      j += 1;
    }
    segments.push({ startIndex: i, endIndex: j, label: lab });
    i = j + 1;
  }

  return segments;
}
