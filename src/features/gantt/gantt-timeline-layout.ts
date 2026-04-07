import { isSameWeek, startOfMonth } from "date-fns";

import type { ZoomLevel } from "@/types/domain";

import { getTimelineCellWidth } from "@/features/gantt/timeline";

/** 주 줌: 한 주 블록의 최소 너비(짧은 주·부분 주) */
const GANTT_MERGED_WEEK_COLUMN_MIN_PX = 44;
/** 월 줌: 한 달 블록의 최소 너비 */
const GANTT_MERGED_MONTH_COLUMN_MIN_PX = 30;

/** day 줌 일 너비 대비 주 안 ‘하루’당 배율(작을수록 주간이 촘촘) */
const GANTT_WEEK_DAY_WIDTH_FACTOR = 0.58;
/** day 줌 대비 월 안 하루당 배율 */
const GANTT_MONTH_DAY_WIDTH_FACTOR = 0.28;

function mergedWeekColumnMinPx(compactTouch: boolean): number {
  return compactTouch ? Math.max(40, Math.round(GANTT_MERGED_WEEK_COLUMN_MIN_PX * 0.9)) : GANTT_MERGED_WEEK_COLUMN_MIN_PX;
}

function mergedMonthColumnMinPx(compactTouch: boolean): number {
  return compactTouch ? Math.max(26, Math.round(GANTT_MERGED_MONTH_COLUMN_MIN_PX * 0.88)) : GANTT_MERGED_MONTH_COLUMN_MIN_PX;
}

export interface GanttDayPixelGeometry {
  totalWidth: number;
  dayLeft: (i: number) => number;
  daySpanWidth: (i: number) => number;
  dayCenter: (i: number) => number;
  dayIndexFromX: (x: number) => number;
  /** 막대 드래그 등 — 타임라인에서 하루당 평균 픽셀 */
  avgDayPixel: number;
}

function emptyGeometry(): GanttDayPixelGeometry {
  return {
    totalWidth: 0,
    dayLeft: () => 0,
    daySpanWidth: () => 0,
    dayCenter: () => 0,
    dayIndexFromX: () => 0,
    avgDayPixel: 40,
  };
}

/**
 * 줌(일/주/월)에 맞춰 주·월 단위 컬럼 너비를 두고, 각 일 인덱스의 좌·폭을 계산합니다.
 */
export function buildGanttDayPixelGeometry(
  days: Date[],
  zoomLevel: ZoomLevel,
  compactTouch: boolean,
): GanttDayPixelGeometry {
  const n = days.length;
  if (n === 0) {
    return emptyGeometry();
  }

  const dayBase = getTimelineCellWidth("day", compactTouch);

  if (zoomLevel === "day") {
    const w = dayBase;
    const totalWidth = n * w;
    return {
      totalWidth,
      dayLeft: (i: number) => {
        const j = Math.max(0, Math.min(n - 1, i));
        return j * w;
      },
      daySpanWidth: () => w,
      dayCenter: (i: number) => {
        const j = Math.max(0, Math.min(n - 1, i));
        return (j + 0.5) * w;
      },
      dayIndexFromX: (x: number) => {
        const idx = Math.floor(x / w);
        return Math.max(0, Math.min(n - 1, idx));
      },
      avgDayPixel: w,
    };
  }

  const groups: Array<{ start: number; end: number }> = [];
  let gs = 0;
  for (let i = 1; i <= n; i += 1) {
    const cur = days[i - 1];
    const next = days[i];
    const split =
      zoomLevel === "week"
        ? !next || !isSameWeek(cur, next, { weekStartsOn: 1 })
        : !next || startOfMonth(cur).getTime() !== startOfMonth(next).getTime();
    if (split) {
      groups.push({ start: gs, end: i - 1 });
      gs = i;
    }
  }

  const dayLeft = new Float64Array(n);
  const daySpan = new Float64Array(n);
  let x = 0;

  for (const g of groups) {
    const count = g.end - g.start + 1;
    let colW: number;
    if (zoomLevel === "week") {
      const weekMin = mergedWeekColumnMinPx(compactTouch);
      colW = Math.max(weekMin, count * dayBase * GANTT_WEEK_DAY_WIDTH_FACTOR);
    } else {
      const monthMin = mergedMonthColumnMinPx(compactTouch);
      colW = Math.max(monthMin, count * dayBase * GANTT_MONTH_DAY_WIDTH_FACTOR);
    }
    const sub = colW / count;
    for (let i = g.start; i <= g.end; i += 1) {
      dayLeft[i] = x + (i - g.start) * sub;
      daySpan[i] = sub;
    }
    x += colW;
  }

  const totalWidth = x;
  const avgDayPixel = totalWidth / n;

  return {
    totalWidth,
    dayLeft: (i: number) => dayLeft[Math.max(0, Math.min(n - 1, i))],
    daySpanWidth: (i: number) => daySpan[Math.max(0, Math.min(n - 1, i))],
    dayCenter: (i: number) => {
      const j = Math.max(0, Math.min(n - 1, i));
      return dayLeft[j] + daySpan[j] / 2;
    },
    dayIndexFromX: (px: number) => {
      if (px <= 0) {
        return 0;
      }
      if (px >= totalWidth - 1e-6) {
        return n - 1;
      }
      let lo = 0;
      let hi = n - 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        if (dayLeft[mid] <= px) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }
      const i = lo;
      const right = i + 1 < n ? dayLeft[i + 1] : totalWidth;
      if (px >= right - 1e-6 && i < n - 1) {
        return i + 1;
      }
      return i;
    },
    avgDayPixel,
  };
}

/** 헤더 구간(연속 일 span)의 픽셀 너비 */
export function ganttHeaderSegmentWidth(
  geo: GanttDayPixelGeometry,
  startDayIndex: number,
  spanDays: number,
  maxDayIndex: number,
): number {
  if (spanDays <= 0) {
    return 0;
  }
  const end = Math.min(maxDayIndex, startDayIndex + spanDays - 1);
  return geo.dayLeft(end) + geo.daySpanWidth(end) - geo.dayLeft(startDayIndex);
}

export function getGanttAvgDayPixelWidth(
  days: Date[],
  zoomLevel: ZoomLevel,
  compactTouch: boolean,
): number {
  return buildGanttDayPixelGeometry(days, zoomLevel, compactTouch).avgDayPixel;
}
