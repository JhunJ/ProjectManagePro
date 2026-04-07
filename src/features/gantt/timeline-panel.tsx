"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { isSameWeek } from "date-fns";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { cn, formatDateKorean, isIOSTouchDevice } from "@/lib/utils";
import type {
  DependencyModel,
  HolidayModel,
  ProjectVersionCompareResult,
  TaskCompareItem,
  TaskListRow,
  TaskModel,
  ZoomLevel,
} from "@/types/domain";
import {
  buildGanttDayPixelGeometry,
  ganttHeaderSegmentWidth,
  type GanttDayPixelGeometry,
} from "@/features/gantt/gantt-timeline-layout";
import {
  buildHeaderGroups,
  buildProjectHolidayLabelSegments,
  extendTimelineRangeByCalendarDays,
  getTimelineDayKey,
  getTimelineRange,
  isFixedHoliday,
  isProjectHoliday,
  isToday,
  isWeekend,
  type TimelineVisibilityFilter,
} from "@/features/gantt/timeline";
import { ROW_HEIGHT } from "@/features/gantt/task-grid-panel";

/** 같은 달(로컬) 안에서의 주차(1~6): 1~7일 → 1주차, 8~14일 → 2주차 … */
function formatGanttMonthWeekOrdinalLabel(anchorDay: Date, compact: boolean): string {
  const dom = anchorDay.getDate();
  const ord = Math.min(6, Math.floor((dom - 1) / 7) + 1);
  const m = anchorDay.getMonth() + 1;
  if (compact) {
    return `${ord}주`;
  }
  return `${m}월 ${ord}주차`;
}

/** 주 줌 일 열: `3(월)` 형태 */
function formatGanttWeekZoomDayCellLabel(day: Date) {
  return `${formatDateKorean(day, "d")}(${formatDateKorean(day, "EEE")})`;
}

interface TimelinePanelProps {
  tasks: TaskModel[];
  visibleRows: TaskListRow[];
  dependencies: DependencyModel[];
  compareMode: boolean;
  compareResult: ProjectVersionCompareResult | null;
  taskDiffById?: Record<string, TaskCompareItem>;
  compareVisualization: "split" | "baseline";
  projectHolidayDayKeys?: Set<string>;
  /** 프로젝트 휴일 이름 — 날짜 헤더 아래에 세로·병합 표시 */
  projectHolidays?: Pick<HolidayModel, "startDate" | "endDate" | "name" | "scope">[];
  zoomLevel: ZoomLevel;
  selectedRowIds: string[];
  dependencyCreateMode: boolean;
  dependencyConnectActive: boolean;
  activeDependencySourceTaskId: string | null;
  dependencyConnectTargetTaskId: string | null;
  timelineVisibility: TimelineVisibilityFilter;
  onSelectRow: (row: TaskListRow, additive: boolean) => void;
  onBarPointerDown: (taskId: string, mode: "move" | "start" | "end", event: React.PointerEvent<Element>) => void;
  /** 막대 드래그 직후 의도치 않은 선택(클릭) 방지 */
  suppressBarDragClickRef?: React.MutableRefObject<boolean>;
  onDependencySourceSelect: (taskId: string) => void;
  onDependencyConnectStart: (taskId: string, clientX: number, clientY: number) => void;
  onDependencyTargetSelect: (taskId: string) => void;
  onCreateTask: (payload: {
    row: TaskListRow;
    startDate: string;
    endDate: string;
  }) => void;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  bodyScrollRef: React.RefObject<HTMLDivElement | null>;
  headerScrollRef: React.RefObject<HTMLDivElement | null>;
  /** 연결선 두께 (기본 1.2) */
  dependencyLineStrokeWidth?: number;
  /** 연결선 색상 (기본 파랑) */
  dependencyLineColor?: string;
  /** 간트 막대 일 단위 나누기 (현장표와 동일 UX) */
  splitModeTaskId?: string | null;
  onEnterSplitMode?: (taskId: string) => void;
  onExitSplitMode?: () => void;
  onSplitCommit?: (taskId: string, splitAfterIndex: number) => void;
  /** 막대(머리·이어지는 구간) 클릭 시 작업 id로 선택. 없으면 행 기준 `onSelectRow`만 사용. */
  onSelectTaskById?: (taskId: string, additive: boolean) => void;
  /** 컨텍스트 메뉴에 합치기 항목 표시 (데스크톱: 선택 충족 시 / 모바일: 항상 편집 가능 시) */
  mergeContextMenuItemVisible?: boolean;
  onMergeTimelineSegments?: () => void;
  /** 모바일: 합치기 대상 고르는 중일 때 꾹 누르면 합치기 실행 */
  mobileMergePickActive?: boolean;
  onMobileMergeLongPressFinish?: () => void;
  /** 모바일: 막대 꾹 눌러 나누기/합치기 메뉴 */
  enableTouchBarContextMenu?: boolean;
  onCancelTouchBarDrag?: () => void;
  /** 모바일 간트: 가로 스크롤 끝에서 타임라인을 달력 일수만큼 이어 붙임 */
  timelineExtraPastDays?: number;
  timelineExtraFutureDays?: number;
  mobileGanttEdgePanEnabled?: boolean;
  onMobileGanttEdgePan?: (direction: "past" | "future") => void;
  /** 모바일 등: 타임라인 열 픽셀을 줄여 가로 과확대 완화 */
  compactTimelineForTouch?: boolean;
  /** 읽기 전용(버전 조회 등): 빈 칸 드래그로 작업 생성 시도·토스트 방지, 가로 스크롤만 허용 */
  readOnlySchedule?: boolean;
}

interface CreateDragState {
  row: TaskListRow;
  rowIndex: number;
  element: HTMLDivElement;
  startIndex: number;
  currentIndex: number;
  /** 모바일: 빈 칸 꾹 누른 뒤에만 시작 — 범위를 안 벌리고 손 떼면 생성 안 함 */
  fromLongPress?: boolean;
  /** pointermove로 state가 자주 바뀌어도 리스너 effect가 끊기지 않도록 세션 id */
  interactionId: number;
}

const CREATE_EMPTY_LONG_PRESS_MS = 420;
const CREATE_EMPTY_CANCEL_MOVE_PX = 14;
/** iOS: 짧은 탭만 작업 생성(스크롤과 구분) */
const IOS_EMPTY_TAP_MAX_MS = 340;
const IOS_EMPTY_TAP_MAX_MOVE_PX = 16;

const MOBILE_EMPTY_CREATE_POPOVER_W = 220;
const MOBILE_EMPTY_CREATE_POPOVER_H = 96;

function clampMobileEmptyCreatePopoverPosition(clientX: number, clientY: number) {
  if (typeof window === "undefined") {
    return { left: clientX, top: clientY };
  }
  const pad = 10;
  const w = MOBILE_EMPTY_CREATE_POPOVER_W;
  const h = MOBILE_EMPTY_CREATE_POPOVER_H;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = clientX - w / 2;
  let top = clientY - h - 14;
  left = Math.max(pad, Math.min(left, vw - w - pad));
  top = Math.max(pad, Math.min(top, vh - h - pad));
  return { left, top };
}

let nextCreateDragInteractionId = 0;
function allocCreateDragInteractionId() {
  nextCreateDragInteractionId += 1;
  return nextCreateDragInteractionId;
}

function sortTimelinePieces(head: TaskModel, segments: TaskModel[] | undefined): TaskModel[] {
  if (!segments?.length) {
    return [head];
  }
  return [head, ...segments].sort(
    (a, b) =>
      new Date(a.startDate).getTime() - new Date(b.startDate).getTime() ||
      a.sortOrder - b.sortOrder ||
      a.id.localeCompare(b.id),
  );
}

function pickSplitAfterIndexGeo(
  x: number,
  geo: GanttDayPixelGeometry,
  startIndex: number,
  endIndex: number,
  dayCount: number,
) {
  let bestD = startIndex;
  let bestDist = Infinity;
  for (let d = startIndex; d < endIndex; d += 1) {
    const boundaryX = d + 1 < dayCount ? geo.dayLeft(d + 1) : geo.dayLeft(d) + geo.daySpanWidth(d);
    const dist = Math.abs(x - boundaryX);
    if (dist < bestDist) {
      bestDist = dist;
      bestD = d;
    }
  }
  return bestD;
}

function splitGuideBoundaryX(geo: GanttDayPixelGeometry, afterDayIndex: number, dayCount: number): number {
  const next = afterDayIndex + 1;
  return next < dayCount ? geo.dayLeft(next) : geo.dayLeft(dayCount - 1) + geo.daySpanWidth(dayCount - 1);
}

function ganttBarRangeWidthPx(geo: GanttDayPixelGeometry, startIdx: number, endIdx: number): number {
  return geo.dayLeft(endIdx) + geo.daySpanWidth(endIdx) - geo.dayLeft(startIdx);
}

/** 휴일명을 한 글자씩 위→아래로 쌓음 (예: 일 / 본 / 여 / 행) */
function GanttHolidayColumnLabel({ text }: { text: string }) {
  const chars = Array.from(text);
  return (
    <span
      className="pointer-events-none flex max-h-full min-h-0 flex-col items-center gap-y-4 overflow-hidden py-0.5 select-none text-[10px] font-normal leading-none text-zinc-500/88 dark:text-zinc-400/82"
      title={text}
    >
      {chars.map((ch, i) => (
        <span key={`${i}-${ch}`} className="block shrink-0 text-center">
          {ch}
        </span>
      ))}
    </span>
  );
}

function getContrastTextColor(hexColor: string) {
  const normalized = hexColor.replace("#", "");
  const valid =
    normalized.length === 6
      ? normalized
      : normalized.length === 3
        ? normalized
            .split("")
            .map((char) => `${char}${char}`)
            .join("")
        : "2563eb";
  const r = parseInt(valid.slice(0, 2), 16);
  const g = parseInt(valid.slice(2, 4), 16);
  const b = parseInt(valid.slice(4, 6), 16);
  const toLinear = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  const whiteContrast = (1.05 + 0.0) / (luminance + 0.05);
  const darkContrast = (luminance + 0.05) / 0.05;
  return whiteContrast > darkContrast ? "#f8fafc" : "#0f172a";
}

export function TimelinePanel({
  tasks,
  visibleRows,
  dependencies,
  compareMode,
  compareResult,
  taskDiffById,
  compareVisualization,
  projectHolidayDayKeys,
  projectHolidays = [],
  zoomLevel,
  selectedRowIds,
  dependencyCreateMode,
  dependencyConnectActive,
  activeDependencySourceTaskId,
  dependencyConnectTargetTaskId,
  timelineVisibility,
  onSelectRow,
  onBarPointerDown,
  suppressBarDragClickRef,
  onDependencySourceSelect,
  onDependencyConnectStart,
  onDependencyTargetSelect,
  onCreateTask,
  onScroll,
  bodyScrollRef,
  headerScrollRef,
  dependencyLineStrokeWidth = 1.2,
  dependencyLineColor = "rgba(59,130,246,0.88)",
  splitModeTaskId = null,
  onEnterSplitMode,
  onExitSplitMode,
  onSplitCommit,
  onSelectTaskById,
  mergeContextMenuItemVisible = false,
  onMergeTimelineSegments,
  mobileMergePickActive = false,
  onMobileMergeLongPressFinish,
  enableTouchBarContextMenu = false,
  onCancelTouchBarDrag,
  timelineExtraPastDays = 0,
  timelineExtraFutureDays = 0,
  mobileGanttEdgePanEnabled = false,
  onMobileGanttEdgePan,
  compactTimelineForTouch = false,
  readOnlySchedule = false,
}: TimelinePanelProps) {
  const safeTaskDiffById = taskDiffById ?? {};
  const [ganttContextMenu, setGanttContextMenu] = React.useState<{
    taskId: string;
    clientX: number;
    clientY: number;
    /** 하루짜리 막대는 나누기 불가 — 합치기 메뉴만 표시 */
    canSplit: boolean;
  } | null>(null);
  const ganttContextMenuRef = React.useRef<HTMLDivElement>(null);
  const [mobileEmptyCreateOffer, setMobileEmptyCreateOffer] = React.useState<{
    row: TaskListRow;
    startIndex: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const barLongPressTimerRef = React.useRef<number | null>(null);
  const barLongPressGestureRef = React.useRef<{ pieceId: string; x: number; y: number } | null>(null);
  const barLongPressPointerCleanupRef = React.useRef<(() => void) | null>(null);
  const createEmptyLongPressDetachRef = React.useRef<(() => void) | null>(null);

  const clearCreateEmptyLongPress = React.useCallback(() => {
    createEmptyLongPressDetachRef.current?.();
    createEmptyLongPressDetachRef.current = null;
  }, []);

  React.useEffect(() => () => clearCreateEmptyLongPress(), [clearCreateEmptyLongPress]);

  React.useEffect(() => {
    if (readOnlySchedule || compareMode || dependencyCreateMode || dependencyConnectActive) {
      clearCreateEmptyLongPress();
      setMobileEmptyCreateOffer(null);
    }
  }, [readOnlySchedule, compareMode, dependencyCreateMode, dependencyConnectActive, clearCreateEmptyLongPress]);

  React.useEffect(() => {
    if (!mobileEmptyCreateOffer) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileEmptyCreateOffer(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileEmptyCreateOffer]);

  const clearBarLongPress = React.useCallback(() => {
    barLongPressPointerCleanupRef.current?.();
    barLongPressPointerCleanupRef.current = null;
    if (barLongPressTimerRef.current != null) {
      window.clearTimeout(barLongPressTimerRef.current);
      barLongPressTimerRef.current = null;
    }
    barLongPressGestureRef.current = null;
  }, []);

  React.useEffect(() => () => clearBarLongPress(), [clearBarLongPress]);

  const splitModeTaskIdRef = React.useRef(splitModeTaskId);
  splitModeTaskIdRef.current = splitModeTaskId;
  const mobileMergePickActiveRef = React.useRef(mobileMergePickActive);
  mobileMergePickActiveRef.current = mobileMergePickActive;
  const onMobileMergeLongPressFinishRef = React.useRef(onMobileMergeLongPressFinish);
  onMobileMergeLongPressFinishRef.current = onMobileMergeLongPressFinish;

  /** 나누기·합치기 고르기로 전환되기 직전에 걸린 롱프레스 타이머가 메뉴를 띄우지 않도록 */
  React.useEffect(() => {
    clearBarLongPress();
  }, [splitModeTaskId, mobileMergePickActive, clearBarLongPress]);

  const resolveBarLongPress = React.useCallback(
    (pieceId: string, clientX: number, clientY: number, canSplit: boolean) => {
      onCancelTouchBarDrag?.();
      if (suppressBarDragClickRef) {
        suppressBarDragClickRef.current = true;
      }
      setMobileEmptyCreateOffer(null);
      setGanttContextMenu({ taskId: pieceId, clientX, clientY, canSplit });
    },
    [onCancelTouchBarDrag, suppressBarDragClickRef],
  );
  const [splitGuideAfterIndex, setSplitGuideAfterIndex] = React.useState<number | null>(null);
  const visibleActivityRows = React.useMemo(
    () => visibleRows.filter((row): row is Extract<TaskListRow, { rowType: "ACTIVITY_ROW" }> => row.rowType === "ACTIVITY_ROW"),
    [visibleRows],
  );
  const visibleActivityTasks = React.useMemo(
    () => visibleActivityRows.flatMap((row) => [row.task, ...(row.timelineSegmentTasks ?? [])]),
    [visibleActivityRows],
  );
  const timeline = React.useMemo(() => {
    const base = getTimelineRange(visibleActivityTasks, zoomLevel, timelineVisibility, projectHolidayDayKeys);
    return extendTimelineRangeByCalendarDays(
      base,
      timelineExtraPastDays,
      timelineExtraFutureDays,
      timelineVisibility,
      projectHolidayDayKeys,
    );
  }, [
    projectHolidayDayKeys,
    timelineVisibility,
    visibleActivityTasks,
    zoomLevel,
    timelineExtraPastDays,
    timelineExtraFutureDays,
  ]);
  const headerGroups = React.useMemo(() => buildHeaderGroups(timeline.days), [timeline.days]);
  const geo = React.useMemo(
    () => buildGanttDayPixelGeometry(timeline.days, zoomLevel, compactTimelineForTouch),
    [timeline.days, zoomLevel, compactTimelineForTouch],
  );
  const holidayLabelSegments = React.useMemo(
    () => buildProjectHolidayLabelSegments(timeline.days, projectHolidays, projectHolidayDayKeys),
    [timeline.days, projectHolidays, projectHolidayDayKeys],
  );
  const timelineWidth = geo.totalWidth;
  const geoRef = React.useRef(geo);
  geoRef.current = geo;

  const edgePanCooldownUntilRef = React.useRef(0);
  const pendingPastExtendAnchorRef = React.useRef<{ anchorDayKey: string; fractionInDay: number } | null>(null);
  const timelineDaysRef = React.useRef(timeline.days);
  timelineDaysRef.current = timeline.days;

  const handleBodyScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      setMobileEmptyCreateOffer(null);
      onScroll(event);
      if (!mobileGanttEdgePanEnabled || !onMobileGanttEdgePan) {
        return;
      }
      const days = timelineDaysRef.current;
      const g = geoRef.current;
      if (days.length === 0 || g.totalWidth <= 0) {
        return;
      }
      const body = event.currentTarget;
      const maxSl = Math.max(0, body.scrollWidth - body.clientWidth);
      const sl = Math.max(0, body.scrollLeft);
      const threshold = 10;
      const now = Date.now();
      if (now < edgePanCooldownUntilRef.current) {
        return;
      }
      if (maxSl <= 0) {
        return;
      }

      if (sl <= threshold) {
        const anchorIndex = Math.min(days.length - 1, Math.max(0, g.dayIndexFromX(sl)));
        const anchorDay = days[anchorIndex];
        if (!anchorDay) {
          return;
        }
        const span = g.daySpanWidth(anchorIndex);
        const fractionInDay = span > 0 ? Math.max(0, Math.min(1, (sl - g.dayLeft(anchorIndex)) / span)) : 0;
        pendingPastExtendAnchorRef.current = {
          anchorDayKey: getTimelineDayKey(anchorDay),
          fractionInDay,
        };
        edgePanCooldownUntilRef.current = now + 480;
        onMobileGanttEdgePan("past");
        return;
      }

      if (maxSl > 0 && sl >= maxSl - threshold) {
        edgePanCooldownUntilRef.current = now + 480;
        onMobileGanttEdgePan("future");
      }
    },
    [mobileGanttEdgePanEnabled, onMobileGanttEdgePan, onScroll],
  );

  const mobileEmptyCreatePopoverStyle = React.useMemo(() => {
    if (!mobileEmptyCreateOffer) {
      return null;
    }
    return clampMobileEmptyCreatePopoverPosition(mobileEmptyCreateOffer.clientX, mobileEmptyCreateOffer.clientY);
  }, [mobileEmptyCreateOffer]);

  React.useLayoutEffect(() => {
    const pending = pendingPastExtendAnchorRef.current;
    if (!pending) {
      return;
    }
    const body = bodyScrollRef.current;
    const header = headerScrollRef.current;
    if (!body || timeline.days.length === 0) {
      pendingPastExtendAnchorRef.current = null;
      return;
    }
    const newIdx = timeline.days.findIndex((d) => getTimelineDayKey(d) === pending.anchorDayKey);
    pendingPastExtendAnchorRef.current = null;
    if (newIdx < 0) {
      return;
    }
    const g = geoRef.current;
    const span = g.daySpanWidth(newIdx);
    const nextLeft = g.dayLeft(newIdx) + pending.fractionInDay * span;
    body.scrollLeft = nextLeft;
    if (header) {
      header.scrollLeft = nextLeft;
    }
  }, [timeline.days, bodyScrollRef, headerScrollRef]);

  const dayIndexByKey = React.useMemo(
    () => new Map(timeline.days.map((day, index) => [getTimelineDayKey(day), index])),
    [timeline.days],
  );
  const dayTimestamps = React.useMemo(() => timeline.days.map((day) => day.getTime()), [timeline.days]);

  const getDayTone = React.useCallback(
    (day: Date) => {
      if (isProjectHoliday(day, projectHolidayDayKeys)) {
        return "project-holiday";
      }

      if (isWeekend(day) || isFixedHoliday(day)) {
        return "offday";
      }

      return "default";
    },
    [projectHolidayDayKeys],
  );

  const findDayIndex = React.useCallback(
    (date: Date | string, mode: "floor" | "ceil" | "exact") => {
      if (dayTimestamps.length === 0) {
        return null;
      }

      const key = getTimelineDayKey(date);
      const direct = dayIndexByKey.get(key);
      if (direct !== undefined) {
        return direct;
      }

      if (mode === "exact") {
        return null;
      }

      const target = new Date(`${key}T00:00:00.000Z`).getTime();
      let left = 0;
      let right = dayTimestamps.length;

      while (left < right) {
        const mid = Math.floor((left + right) / 2);
        if (dayTimestamps[mid] < target) {
          left = mid + 1;
        } else {
          right = mid;
        }
      }

      if (mode === "ceil") {
        return left >= dayTimestamps.length ? dayTimestamps.length - 1 : left;
      }

      return left <= 0 ? 0 : left - 1;
    },
    [dayIndexByKey, dayTimestamps],
  );

  const timelinePointerXToGridX = React.useCallback(
    (clientX: number) => {
      const body = bodyScrollRef.current;
      if (!body) return 0;
      const br = body.getBoundingClientRect();
      return clientX - br.left + body.scrollLeft;
    },
    [bodyScrollRef],
  );

  const splitGuideRowIndex = React.useMemo(() => {
    if (!splitModeTaskId) return null;
    const idx = visibleRows.findIndex(
      (r) =>
        r.rowType === "ACTIVITY_ROW" &&
        (r.task.id === splitModeTaskId || r.timelineSegmentTasks?.some((s) => s.id === splitModeTaskId)),
    );
    return idx >= 0 ? idx : null;
  }, [splitModeTaskId, visibleRows]);

  React.useEffect(() => {
    if (!ganttContextMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as Node;
      if (ganttContextMenuRef.current?.contains(target)) return;
      setGanttContextMenu(null);
    };
    const onScroll = () => setGanttContextMenu(null);
    const body = bodyScrollRef.current;
    document.addEventListener("pointerdown", onPointerDown);
    body?.addEventListener("scroll", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      body?.removeEventListener("scroll", onScroll);
    };
  }, [ganttContextMenu, bodyScrollRef]);

  React.useEffect(() => {
    if (!splitModeTaskId) {
      setSplitGuideAfterIndex(null);
    }
  }, [splitModeTaskId]);

  const splitGuideRafRef = React.useRef<number | null>(null);
  const scheduleSplitGuide = React.useCallback((next: number | null) => {
    if (splitGuideRafRef.current != null) {
      cancelAnimationFrame(splitGuideRafRef.current);
    }
    splitGuideRafRef.current = requestAnimationFrame(() => {
      splitGuideRafRef.current = null;
      setSplitGuideAfterIndex(next);
    });
  }, []);

  React.useEffect(
    () => () => {
      if (splitGuideRafRef.current != null) {
        cancelAnimationFrame(splitGuideRafRef.current);
      }
    },
    [],
  );

  // 로컬(한국) 기준 오늘에 해당하는 컬럼 인덱스 → 빨간 수직선은 이 위치에만 그림
  const todayIndexLocal = timeline.days.findIndex((day) => isToday(day));
  const todayOffset = todayIndexLocal >= 0 ? geo.dayLeft(todayIndexLocal) : null;
  // 스크롤로 오늘 근처로 이동할 때는 fallback 포함
  const todayIndexForScroll =
    todayIndexLocal >= 0 ? todayIndexLocal : findDayIndex(new Date(), "ceil") ?? findDayIndex(new Date(), "floor");
  const todayOffsetForScroll = todayIndexForScroll !== null ? geo.dayLeft(todayIndexForScroll) : null;
  const didAutoScrollRef = React.useRef(false);
  const [createDrag, setCreateDrag] = React.useState<CreateDragState | null>(null);

  React.useEffect(() => {
    if (visibleActivityRows.length === 0) {
      didAutoScrollRef.current = false;
    }
  }, [visibleActivityRows.length]);

  React.useEffect(() => {
    if (didAutoScrollRef.current) return;
    if (!bodyScrollRef.current) return;
    if (todayOffsetForScroll === null) return;
    if (visibleActivityRows.length === 0) return;

    const rafId = window.requestAnimationFrame(() => {
      const body = bodyScrollRef.current;
      if (!body) {
        return;
      }
      const header = headerScrollRef.current;
      const viewportWidth = body.clientWidth;
      const maxScrollLeft = Math.max(0, timelineWidth - viewportWidth);
      const targetScrollLeft = Math.max(0, Math.min(maxScrollLeft, todayOffsetForScroll - viewportWidth * 0.35));

      body.scrollLeft = targetScrollLeft;
      if (header) {
        header.scrollLeft = targetScrollLeft;
      }

      didAutoScrollRef.current = true;
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [bodyScrollRef, headerScrollRef, timelineWidth, todayOffsetForScroll, visibleActivityRows.length]);

  const dependencyPaths = React.useMemo(() => {
    const visibleRowIndexByTaskId = new Map<string, number>();
    for (const [index, row] of visibleRows.entries()) {
      if (row.rowType === "ACTIVITY_ROW") {
        visibleRowIndexByTaskId.set(row.taskId, index);
        for (const seg of row.timelineSegmentTasks ?? []) {
          visibleRowIndexByTaskId.set(seg.id, index);
        }
      }
    }

    const entries: Array<{
      id: string;
      key: string;
      path: string;
      label: DependencyModel["type"];
      x: number;
      y: number;
      status: "added" | "changed" | "default";
    }> = [];
    const removedEntries: Array<{
      id: string;
      path: string;
      label: DependencyModel["type"];
      x: number;
      y: number;
    }> = [];

    const beforeTaskIdToRowKey = new Map<string, string>();
    if (compareMode && compareResult) {
      for (const item of compareResult.tasks) {
        if (item.before) {
          beforeTaskIdToRowKey.set(item.before.id, item.key);
        }
      }
    }

    const dependencyStatusMap = new Map<string, "added" | "changed" | "default">();
    if (compareMode && compareResult) {
      for (const item of compareResult.dependenciesDiff.added) {
        dependencyStatusMap.set(item.key, "added");
      }
      for (const item of compareResult.dependenciesDiff.changed) {
        dependencyStatusMap.set(item.key, "changed");
      }
    }

    for (const dependency of dependencies) {
      const predecessor = tasks.find((task) => task.id === dependency.predecessorTaskId);
      const successor = tasks.find((task) => task.id === dependency.successorTaskId);
      if (!predecessor || !successor) {
        continue;
      }

      const predecessorIndex = visibleRowIndexByTaskId.get(predecessor.id);
      const successorIndex = visibleRowIndexByTaskId.get(successor.id);
      if (predecessorIndex === undefined || successorIndex === undefined) {
        continue;
      }

      const predecessorStartIndex = findDayIndex(predecessor.startDate, "ceil");
      const predecessorEndIndex = findDayIndex(predecessor.endDate, "floor");
      const successorStartIndex = findDayIndex(successor.startDate, "ceil");
      if (predecessorStartIndex === null || predecessorEndIndex === null || successorStartIndex === null) {
        continue;
      }

      const predecessorStart = geo.dayLeft(predecessorStartIndex);
      const predecessorWidth = predecessor.isMilestone
        ? 14
        : ganttBarRangeWidthPx(geo, predecessorStartIndex, predecessorEndIndex);
      const predecessorX = predecessor.isMilestone
        ? geo.dayCenter(predecessorStartIndex) + 7
        : predecessorStart + predecessorWidth;
      const predecessorY = predecessorIndex * ROW_HEIGHT + ROW_HEIGHT / 2;

      const successorStart = geo.dayLeft(successorStartIndex);
      const successorX = successor.isMilestone ? geo.dayCenter(successorStartIndex) : successorStart;
      const successorY = successorIndex * ROW_HEIGHT + ROW_HEIGHT / 2;

      const controlX = Math.max(18, (successorX - predecessorX) / 2);
      const path = `M ${predecessorX} ${predecessorY} C ${predecessorX + controlX} ${predecessorY}, ${
        successorX - controlX
      } ${successorY}, ${successorX} ${successorY}`;
      const key = `${dependency.predecessorTaskId}|${dependency.successorTaskId}|${dependency.type}`;

      entries.push({
        id: dependency.id,
        key,
        path,
        label: dependency.type,
        x: (predecessorX + successorX) / 2,
        y: (predecessorY + successorY) / 2,
        status: dependencyStatusMap.get(key) ?? "default",
      });
    }

    if (compareMode && compareResult) {
      for (const item of compareResult.dependenciesDiff.removed) {
        if (!item.before) continue;

        const predecessorRowKey = beforeTaskIdToRowKey.get(item.before.predecessorTaskId);
        const successorRowKey = beforeTaskIdToRowKey.get(item.before.successorTaskId);
        if (!predecessorRowKey || !successorRowKey) continue;

        const predecessorRow = visibleRowIndexByTaskId.get(predecessorRowKey);
        const successorRow = visibleRowIndexByTaskId.get(successorRowKey);
        if (predecessorRow === undefined || successorRow === undefined) continue;

        const predecessorItem = compareResult.tasks.find((taskItem) => taskItem.key === predecessorRowKey);
        const successorItem = compareResult.tasks.find((taskItem) => taskItem.key === successorRowKey);
        const predecessorTask = predecessorItem?.before;
        const successorTask = successorItem?.before;
        if (!predecessorTask || !successorTask) continue;

        const predecessorStartIndex = findDayIndex(predecessorTask.startDate, "ceil");
        const predecessorEndIndex = findDayIndex(predecessorTask.endDate, "floor");
        const successorStartIndex = findDayIndex(successorTask.startDate, "ceil");
        if (predecessorStartIndex === null || predecessorEndIndex === null || successorStartIndex === null) {
          continue;
        }

        const predecessorStart = geo.dayLeft(predecessorStartIndex);
        const predecessorWidth = predecessorTask.isMilestone
          ? 14
          : ganttBarRangeWidthPx(geo, predecessorStartIndex, predecessorEndIndex);
        const predecessorX = predecessorTask.isMilestone
          ? geo.dayCenter(predecessorStartIndex) + 7
          : predecessorStart + predecessorWidth;
        const predecessorY = predecessorRow * ROW_HEIGHT + ROW_HEIGHT / 2;

        const successorStart = geo.dayLeft(successorStartIndex);
        const successorX = successorTask.isMilestone ? geo.dayCenter(successorStartIndex) : successorStart;
        const successorY = successorRow * ROW_HEIGHT + ROW_HEIGHT / 2;

        const controlX = Math.max(18, (successorX - predecessorX) / 2);
        const path = `M ${predecessorX} ${predecessorY} C ${predecessorX + controlX} ${predecessorY}, ${
          successorX - controlX
        } ${successorY}, ${successorX} ${successorY}`;

        removedEntries.push({
          id: `removed-${item.key}`,
          path,
          label: item.before.type,
          x: (predecessorX + successorX) / 2,
          y: (predecessorY + successorY) / 2,
        });
      }
    }

    return {
      current: entries,
      removed: removedEntries,
    };
  }, [geo, compareMode, compareResult, dependencies, findDayIndex, tasks, visibleRows]);

  const prevZoomRef = React.useRef<ZoomLevel | null>(null);
  const prevDaysRef = React.useRef<Date[]>([]);
  const prevGeoRef = React.useRef(geo);
  const prevCompactTimelineRef = React.useRef(compactTimelineForTouch);

  React.useLayoutEffect(() => {
    const body = bodyScrollRef.current;
    if (!body) {
      prevGeoRef.current = geo;
      prevCompactTimelineRef.current = compactTimelineForTouch;
      return;
    }

    const prevZoom = prevZoomRef.current;
    const prevDays = prevDaysRef.current;
    const oldGeo = prevGeoRef.current;

    const preserveScrollToAnchorDay = (daysWhenOld: Date[]) => {
      if (daysWhenOld.length === 0 || timeline.days.length === 0 || oldGeo.totalWidth <= 0) {
        return;
      }
      const sl = body.scrollLeft;
      const anchorIdx = oldGeo.dayIndexFromX(Math.max(0, Math.min(oldGeo.totalWidth - 1e-6, sl)));
      const ospan = oldGeo.daySpanWidth(anchorIdx);
      const frac = ospan > 0 ? Math.max(0, Math.min(1, (sl - oldGeo.dayLeft(anchorIdx)) / ospan)) : 0;
      const anchorDay = daysWhenOld[anchorIdx];
      if (!anchorDay) {
        return;
      }
      const key = getTimelineDayKey(anchorDay);
      const newIdx = timeline.days.findIndex((d) => getTimelineDayKey(d) === key);
      if (newIdx < 0) {
        return;
      }
      const nspan = geo.daySpanWidth(newIdx);
      const targetScrollLeft = Math.max(0, geo.dayLeft(newIdx) + frac * nspan);
      body.scrollLeft = targetScrollLeft;
      if (headerScrollRef.current) {
        headerScrollRef.current.scrollLeft = targetScrollLeft;
      }
    };

    if (prevZoom && prevZoom !== zoomLevel && prevDays.length > 0) {
      preserveScrollToAnchorDay(prevDays);
    } else if (prevCompactTimelineRef.current !== compactTimelineForTouch && prevDays.length > 0) {
      preserveScrollToAnchorDay(prevDays);
    }

    prevZoomRef.current = zoomLevel;
    prevDaysRef.current = timeline.days;
    prevGeoRef.current = geo;
    prevCompactTimelineRef.current = compactTimelineForTouch;
  }, [bodyScrollRef, compactTimelineForTouch, geo, headerScrollRef, timeline.days, zoomLevel]);

  React.useEffect(() => {
    if (!createDrag) {
      return;
    }

    const { row, element, startIndex, fromLongPress, interactionId } = createDrag;
    let currentIndex = createDrag.currentIndex;

    const getDayIndex = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const rawX = event.clientX - rect.left;
      const clampedX = Math.max(0, Math.min(rect.width - 1, rawX));
      const g = geoRef.current;
      return Math.max(0, Math.min(timeline.days.length - 1, g.dayIndexFromX(clampedX)));
    };

    const onPointerMove = (event: PointerEvent) => {
      event.preventDefault();
      currentIndex = getDayIndex(event);
      setCreateDrag((prev) =>
        prev && prev.interactionId === interactionId ? { ...prev, currentIndex } : prev,
      );
    };

    let finished = false;
    const teardownListeners = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };

    const finishDrag = (cancelled: boolean) => {
      if (finished) {
        return;
      }
      finished = true;
      teardownListeners();
      setCreateDrag(null);
      if (cancelled) {
        return;
      }
      const si = Math.min(startIndex, currentIndex);
      const ei = Math.max(startIndex, currentIndex);
      if (fromLongPress && si === ei) {
        return;
      }
      const startDate = timeline.days[si];
      const endDate = timeline.days[ei];
      if (!startDate || !endDate) {
        return;
      }
      onCreateTask({
        row,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
    };

    const onPointerUp = () => finishDrag(false);
    const onPointerCancel = () => finishDrag(true);

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", onPointerCancel, { once: true });

    return () => {
      teardownListeners();
    };
  }, [createDrag?.interactionId, onCreateTask, timeline.days]);

  /** 편집 + 터치형 간트: 꾹 누를 때 Safari/Chrome 시스템 메뉴(공유·인쇄 등) 억제 */
  const suppressMobileBrowserCallout = !readOnlySchedule && compactTimelineForTouch;
  /** Android: contextmenu만 막음. selectstart/dragstart 캡처는 iOS 롱프레스·포인터가 죽을 수 있음 */
  const touchCalloutBlockAttachedRef = React.useRef<HTMLElement[]>([]);
  React.useLayoutEffect(() => {
    if (!suppressMobileBrowserCallout) {
      return;
    }
    const onContextMenu = (ev: Event) => {
      ev.preventDefault();
    };
    const opts: AddEventListenerOptions = { capture: true, passive: false };

    const attach = () => {
      for (const el of touchCalloutBlockAttachedRef.current) {
        el.removeEventListener("contextmenu", onContextMenu, opts);
      }
      touchCalloutBlockAttachedRef.current = [];
      const nodes = [headerScrollRef.current, bodyScrollRef.current].filter(Boolean) as HTMLElement[];
      for (const el of nodes) {
        el.addEventListener("contextmenu", onContextMenu, opts);
        touchCalloutBlockAttachedRef.current.push(el);
      }
    };

    attach();
    const raf = requestAnimationFrame(attach);
    return () => {
      cancelAnimationFrame(raf);
      for (const el of touchCalloutBlockAttachedRef.current) {
        el.removeEventListener("contextmenu", onContextMenu, opts);
      }
      touchCalloutBlockAttachedRef.current = [];
    };
  }, [suppressMobileBrowserCallout, timeline.days.length, visibleRows.length]);

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", suppressMobileBrowserCallout && "gantt-suppress-system-callout")}>
      <div ref={headerScrollRef} className="overflow-hidden border-b border-zinc-200/80 dark:border-zinc-800">
        <div style={{ width: timelineWidth }}>
          <div
            className={cn(
              "flex border-b border-zinc-200/70 bg-slate-100/75 text-muted dark:border-zinc-800 dark:bg-zinc-900/60",
              zoomLevel === "month"
                ? compactTimelineForTouch
                  ? "min-h-[42px] items-center text-[12px] leading-tight"
                  : "min-h-11 items-center text-[12px] leading-tight"
                : compactTimelineForTouch
                  ? "min-h-[26px] text-[11px] leading-tight"
                  : "min-h-7 text-[11px] leading-tight",
            )}
          >
            {headerGroups.monthGroups.map((group) => {
              const firstDay = timeline.days[group.startIndex];
              const monthLabel =
                compactTimelineForTouch && firstDay
                  ? formatDateKorean(firstDay, "yy.MM")
                  : group.label;
              const monthSegW = ganttHeaderSegmentWidth(geo, group.startIndex, group.span, timeline.days.length - 1);
              return (
                <div
                  key={`${group.label}-${group.startIndex}`}
                  className={cn(
                    "flex min-w-0 shrink-0 items-center border-r border-zinc-200/60 dark:border-zinc-800",
                    compactTimelineForTouch ? "justify-center px-1 py-1" : "items-center justify-center px-1.5 py-1",
                    zoomLevel === "month" && "py-2",
                  )}
                  style={{ width: monthSegW, minWidth: monthSegW, maxWidth: monthSegW }}
                >
                  <span
                    className={cn(
                      "text-center font-medium text-zinc-600 dark:text-zinc-400",
                      compactTimelineForTouch ? "whitespace-nowrap text-[10px] leading-none" : "whitespace-nowrap text-[11px] leading-tight",
                      zoomLevel === "month" && !compactTimelineForTouch && "text-[12px] font-semibold",
                      zoomLevel === "month" && compactTimelineForTouch && "text-[11px] font-semibold",
                    )}
                    title={group.label}
                  >
                    {monthLabel}
                  </span>
                </div>
              );
            })}
          </div>
          {zoomLevel === "month" ? null : zoomLevel === "week" ? (
            <>
              <div
                className={cn(
                  "flex border-b border-zinc-200/70 bg-slate-100/75 text-muted dark:border-zinc-800 dark:bg-zinc-900/60",
                  compactTimelineForTouch ? "min-h-[36px] text-[11px] leading-tight" : "min-h-9 text-[11px]",
                )}
              >
                {headerGroups.weekGroups.map((group) => {
                  const firstDay = timeline.days[group.startIndex];
                  if (!firstDay) {
                    return null;
                  }
                  const slice = timeline.days.slice(group.startIndex, group.startIndex + group.span);
                  const weekHasToday = slice.some((d) => isToday(d));
                  const weekIsCurrent = slice.some((d) => isSameWeek(d, new Date(), { weekStartsOn: 1 }));
                  const weekSegW = ganttHeaderSegmentWidth(geo, group.startIndex, group.span, timeline.days.length - 1);
                  return (
                    <div
                      key={`wk-${group.startIndex}-${group.span}`}
                      className={cn(
                        "flex min-w-0 shrink-0 items-center justify-center border-r border-zinc-200/60 px-1 py-1.5 text-center dark:border-zinc-800",
                        weekIsCurrent && "bg-sky-500/5",
                        weekHasToday && "font-semibold text-sky-800 dark:text-sky-200",
                      )}
                      style={{ width: weekSegW, minWidth: weekSegW, maxWidth: weekSegW }}
                      title={group.label}
                    >
                      <span
                        className={cn(
                          "text-center font-medium tabular-nums text-zinc-700 dark:text-zinc-200",
                          compactTimelineForTouch ? "text-[10px] leading-tight" : "text-[11px] leading-tight",
                        )}
                      >
                        {formatGanttMonthWeekOrdinalLabel(firstDay, compactTimelineForTouch)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div
                className={cn(
                  "flex border-b border-zinc-200/70 bg-slate-100/75 text-muted dark:border-zinc-800 dark:bg-zinc-900/60",
                  compactTimelineForTouch ? "min-h-[15px]" : "min-h-[18px]",
                )}
              >
                {timeline.days.map((day, dayIdx) => (
                  <div
                    key={`wk-day-dow-${day.toISOString()}`}
                    className={cn(
                      "flex min-w-0 shrink-0 items-center justify-center border-r border-zinc-200/60 px-0.5 py-0 text-center dark:border-zinc-800",
                      getDayTone(day) === "offday" && "bg-slate-200/70 text-slate-600 dark:bg-zinc-800/70 dark:text-zinc-300",
                      getDayTone(day) === "project-holiday" &&
                        "bg-amber-200/80 text-amber-800 dark:bg-amber-900/35 dark:text-amber-200",
                      isSameWeek(day, new Date(), { weekStartsOn: 1 }) && "bg-sky-500/5",
                      isToday(day) && "font-semibold text-sky-700 dark:text-sky-300",
                    )}
                    style={{
                      width: geo.daySpanWidth(dayIdx),
                      minWidth: geo.daySpanWidth(dayIdx),
                      maxWidth: geo.daySpanWidth(dayIdx),
                    }}
                    title={formatDateKorean(day, "yyyy.MM.dd EEEE")}
                  >
                    <span
                      className={cn(
                        "truncate tabular-nums leading-none tracking-tight",
                        compactTimelineForTouch ? "text-[7px]" : "text-[8px]",
                      )}
                    >
                      {formatGanttWeekZoomDayCellLabel(day)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div
              className={cn(
                "flex border-b border-zinc-200/70 bg-slate-100/75 text-muted dark:border-zinc-800 dark:bg-zinc-900/60",
                compactTimelineForTouch ? "min-h-[40px]" : "min-h-8 text-[11px]",
              )}
            >
              {timeline.days.map((day, dayIdx) => (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "flex min-w-0 shrink-0 justify-center border-r border-zinc-200/60 text-center dark:border-zinc-800",
                    compactTimelineForTouch
                      ? "flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 leading-none"
                      : "items-center justify-center px-1 py-1.5",
                    getDayTone(day) === "offday" && "bg-slate-200/70 text-slate-600 dark:bg-zinc-800/70 dark:text-zinc-300",
                    getDayTone(day) === "project-holiday" &&
                      "bg-amber-200/80 text-amber-800 dark:bg-amber-900/35 dark:text-amber-200",
                    isSameWeek(day, new Date(), { weekStartsOn: 1 }) && "bg-sky-500/5",
                    isToday(day) && "bg-sky-500/18 font-semibold text-sky-700 dark:text-sky-300",
                  )}
                  style={{
                    width: geo.daySpanWidth(dayIdx),
                    minWidth: geo.daySpanWidth(dayIdx),
                    maxWidth: geo.daySpanWidth(dayIdx),
                  }}
                  title={formatDateKorean(day, "yyyy.MM.dd EEEE")}
                >
                  {compactTimelineForTouch ? (
                    <>
                      <span className="text-[11px] font-semibold tabular-nums leading-none">{day.getUTCDate()}</span>
                      <span className="text-[9px] font-medium tabular-nums leading-none text-zinc-500 dark:text-zinc-400">
                        {formatDateKorean(day, "MM.dd")}
                      </span>
                    </>
                  ) : (
                    <span className="whitespace-nowrap text-[11px] font-medium tabular-nums leading-tight">
                      {formatDateKorean(day, "MM.dd")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {holidayLabelSegments.length > 0 ? (
            <div
              className="relative shrink-0 border-b border-zinc-200/60 bg-slate-50/40 dark:border-zinc-800 dark:bg-zinc-950/40"
              style={{ width: timelineWidth, height: compactTimelineForTouch ? 22 : 24 }}
            >
              {holidayLabelSegments.map((seg, idx) => {
                const left = geo.dayLeft(seg.startIndex);
                let spanW = 0;
                for (let j = seg.startIndex; j <= seg.endIndex; j += 1) {
                  spanW += geo.daySpanWidth(j);
                }
                return (
                  <div
                    key={`hol-lab-${idx}-${seg.startIndex}-${seg.endIndex}`}
                    className="pointer-events-none absolute top-0 flex items-center justify-center overflow-hidden border-r border-zinc-200/25 px-0.5 dark:border-zinc-700/30"
                    style={{ left, width: spanW, height: "100%" }}
                    title={seg.label}
                  >
                    <span className="truncate text-center text-[10px] font-normal text-zinc-500/88 dark:text-zinc-400/82">
                      {seg.label}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div
        ref={bodyScrollRef}
        className={cn(
          "relative flex-1 overflow-auto",
          compactTimelineForTouch && "overscroll-x-contain touch-manipulation",
        )}
        style={
          compactTimelineForTouch ? ({ WebkitOverflowScrolling: "touch" } as React.CSSProperties) : undefined
        }
        onScroll={handleBodyScroll}
      >
        <div
          className={cn("gantt-grid-bg relative", suppressMobileBrowserCallout && "gantt-grid-bg-touch-safe")}
          style={{
            width: timelineWidth,
            height: visibleRows.length * ROW_HEIGHT,
          }}
        >
          {timeline.days.map((day, index) => (
            <div
              key={`grid-v-${day.toISOString()}`}
              className="pointer-events-none absolute top-0 border-r border-zinc-200/35 dark:border-zinc-800/45"
              style={{
                left: geo.dayLeft(index),
                width: geo.daySpanWidth(index),
                height: "100%",
              }}
              aria-hidden
            />
          ))}
          {timeline.days.map((day, index) => {
            const tone = getDayTone(day);
            if (tone === "default") {
              return null;
            }

            return (
              <div
                key={`day-bg-${day.toISOString()}`}
                className={cn(
                  "pointer-events-none absolute top-0 h-full",
                  tone === "offday" && "bg-slate-300/22 dark:bg-zinc-800/38",
                  tone === "project-holiday" && "bg-amber-300/24 dark:bg-amber-900/18",
                )}
                style={{
                  left: geo.dayLeft(index),
                  width: geo.daySpanWidth(index),
                }}
              />
            );
          })}

          {todayOffset !== null ? (
            <div className="pointer-events-none absolute top-0 h-full w-px bg-red-500/70" style={{ left: todayOffset }} />
          ) : null}

          {visibleRows.map((row, rowIndex) => {
            const splitTargetTask =
              splitModeTaskId && row.rowType === "ACTIVITY_ROW"
                ? [row.task, ...(row.timelineSegmentTasks ?? [])].find((p) => p.id === splitModeTaskId)
                : null;
            const splitSpanForCreate =
              splitTargetTask && !splitTargetTask.isMilestone
                ? (() => {
                    const s = findDayIndex(splitTargetTask.startDate, "ceil");
                    const e = findDayIndex(splitTargetTask.endDate, "floor");
                    if (s === null || e === null || s >= e) return null;
                    return { startIndex: s, endIndex: e };
                  })()
                : null;

            return (
              <div
                key={`create-layer-${row.rowId}`}
                className={cn("absolute left-0", splitSpanForCreate && "z-[21] cursor-col-resize")}
                style={{
                  top: rowIndex * ROW_HEIGHT,
                  width: timelineWidth,
                  height: ROW_HEIGHT,
                }}
                onMouseMove={(event) => {
                  if (!splitSpanForCreate) return;
                  const x = timelinePointerXToGridX(event.clientX);
                  const clampedX = Math.max(0, Math.min(timelineWidth - 1, x));
                  scheduleSplitGuide(
                    pickSplitAfterIndexGeo(
                      clampedX,
                      geo,
                      splitSpanForCreate.startIndex,
                      splitSpanForCreate.endIndex,
                      timeline.days.length,
                    ),
                  );
                }}
              >
                <div
                  className={cn("h-full w-full", compactTimelineForTouch && "touch-manipulation")}
                  onContextMenu={compactTimelineForTouch ? (e) => e.preventDefault() : undefined}
                  onPointerDown={(event) => {
                    if (
                      splitSpanForCreate &&
                      splitModeTaskId &&
                      event.button === 0 &&
                      splitGuideAfterIndex !== null &&
                      onSplitCommit &&
                      row.rowType === "ACTIVITY_ROW"
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      onSplitCommit(splitModeTaskId, splitGuideAfterIndex);
                      onExitSplitMode?.();
                      return;
                    }
                    if (splitModeTaskId) {
                      return;
                    }
                    if (event.button !== 0) {
                      return;
                    }
                    if (
                      readOnlySchedule ||
                      compareMode ||
                      dependencyCreateMode ||
                      dependencyConnectActive ||
                      timeline.days.length === 0
                    ) {
                      return;
                    }

                    const element = event.currentTarget;
                    const rect = element.getBoundingClientRect();
                    const x = Math.max(0, Math.min(rect.width - 1, event.clientX - rect.left));
                    const startIndex = Math.max(0, Math.min(timeline.days.length - 1, geo.dayIndexFromX(x)));

                    if (compactTimelineForTouch) {
                      clearCreateEmptyLongPress();
                      const pointerId = event.pointerId;
                      const startCx = event.clientX;
                      const startCy = event.clientY;

                      if (isIOSTouchDevice()) {
                        const t0 = performance.now();
                        let moveTooFar = false;
                        const cleanup = () => {
                          window.removeEventListener("pointermove", onMove);
                          window.removeEventListener("pointerup", onUp);
                          window.removeEventListener("pointercancel", onUp);
                        };
                        const onMove = (ev: PointerEvent) => {
                          if (ev.pointerId !== pointerId) {
                            return;
                          }
                          if (Math.hypot(ev.clientX - startCx, ev.clientY - startCy) > IOS_EMPTY_TAP_MAX_MOVE_PX) {
                            moveTooFar = true;
                          }
                        };
                        const onUp = (ev: PointerEvent) => {
                          if (ev.pointerId !== pointerId) {
                            return;
                          }
                          cleanup();
                          if (moveTooFar || performance.now() - t0 > IOS_EMPTY_TAP_MAX_MS) {
                            return;
                          }
                          const days = timeline.days;
                          if (days.length === 0) {
                            return;
                          }
                          const si = startIndex;
                          const ei = Math.min(days.length - 1, si + 2);
                          const startDate = days[si];
                          const endDate = days[ei];
                          if (!startDate || !endDate) {
                            return;
                          }
                          setGanttContextMenu(null);
                          setMobileEmptyCreateOffer(null);
                          onCreateTask({
                            row,
                            startDate: startDate.toISOString(),
                            endDate: endDate.toISOString(),
                          });
                        };
                        window.addEventListener("pointermove", onMove, { passive: true });
                        window.addEventListener("pointerup", onUp, { passive: true });
                        window.addEventListener("pointercancel", onUp, { passive: true });
                        return;
                      }

                      let settled = false;
                      const detach = () => {
                        if (settled) {
                          return;
                        }
                        settled = true;
                        window.clearTimeout(timer);
                        window.removeEventListener("pointermove", onMove);
                        window.removeEventListener("pointerup", onEnd);
                        window.removeEventListener("pointercancel", onEnd);
                        if (createEmptyLongPressDetachRef.current === detach) {
                          createEmptyLongPressDetachRef.current = null;
                        }
                      };
                      const onMove = (ev: PointerEvent) => {
                        if (ev.pointerId !== pointerId) {
                          return;
                        }
                        if (Math.hypot(ev.clientX - startCx, ev.clientY - startCy) > CREATE_EMPTY_CANCEL_MOVE_PX) {
                          detach();
                        }
                      };
                      const onEnd = (ev: PointerEvent) => {
                        if (ev.pointerId !== pointerId) {
                          return;
                        }
                        detach();
                      };
                      const timer = window.setTimeout(() => {
                        detach();
                        if (typeof navigator !== "undefined" && navigator.vibrate) {
                          navigator.vibrate(12);
                        }
                        setGanttContextMenu(null);
                        setMobileEmptyCreateOffer({
                          row,
                          startIndex,
                          clientX: startCx,
                          clientY: startCy,
                        });
                      }, CREATE_EMPTY_LONG_PRESS_MS);
                      createEmptyLongPressDetachRef.current = detach;
                      window.addEventListener("pointermove", onMove, { passive: true });
                      window.addEventListener("pointerup", onEnd, { passive: true });
                      window.addEventListener("pointercancel", onEnd, { passive: true });
                      return;
                    }

                    setCreateDrag({
                      row,
                      rowIndex,
                      element,
                      startIndex,
                      currentIndex: startIndex,
                      interactionId: allocCreateDragInteractionId(),
                    });
                  }}
                />
              </div>
            );
          })}

          {createDrag ? (
            <div
              className="pointer-events-none absolute rounded-md border border-sky-500/60 bg-sky-500/12"
              style={(() => {
                const lo = Math.min(createDrag.startIndex, createDrag.currentIndex);
                const hi = Math.max(createDrag.startIndex, createDrag.currentIndex);
                const leftPx = geo.dayLeft(lo) + 1;
                const rightPx = geo.dayLeft(hi) + geo.daySpanWidth(hi);
                return {
                  top: createDrag.rowIndex * ROW_HEIGHT + 4,
                  left: leftPx,
                  width: Math.max(0, rightPx - leftPx - 2),
                  height: ROW_HEIGHT - 8,
                };
              })()}
            />
          ) : null}

          {visibleRows.map((row, rowIndex) => {
            if (row.rowType !== "ACTIVITY_ROW") {
              return null;
            }

            const splitCompare = compareMode && compareVisualization === "split";
            const baselineCompare = compareMode && compareVisualization === "baseline";
            const pieces = compareMode ? [row.task] : sortTimelinePieces(row.task, row.timelineSegmentTasks);
            const rowTop = rowIndex * ROW_HEIGHT;
            /** 행 래퍼가 이미 `top: rowTop`이므로, 막대는 래퍼 안에서만 오프셋 */
            const barOffsetY = splitCompare ? 4 : 8;
            const barH = splitCompare ? 34 : 28;
            const bridgeMidY = barOffsetY + barH / 2 - 0.5;

            const segmentGapBridges: React.ReactNode[] = [];
            if (!compareMode && pieces.length > 1) {
              for (let i = 0; i < pieces.length - 1; i += 1) {
                const left = pieces[i];
                const right = pieces[i + 1];
                const endL = findDayIndex(left.endDate, "floor");
                const startR = findDayIndex(right.startDate, "ceil");
                if (endL === null || startR === null) continue;
                const n = timeline.days.length;
                const x0 = endL + 1 < n ? geo.dayLeft(endL + 1) : geo.dayLeft(endL) + geo.daySpanWidth(endL);
                const x1 = geo.dayLeft(startR);
                const w = x1 - x0;
                const bridgeKey = `${left.id}-${right.id}`;
                if (w > 0) {
                  segmentGapBridges.push(
                    <div
                      key={`gap-fill-${bridgeKey}`}
                      className="pointer-events-none absolute z-[1] rounded-[3px]"
                      style={{
                        left: x0,
                        width: w,
                        top: barOffsetY,
                        height: barH,
                        background:
                          "repeating-linear-gradient(-45deg, rgba(56,189,248,0.11), rgba(56,189,248,0.11) 4px, transparent 4px, transparent 8px)",
                      }}
                      aria-hidden
                    />,
                    <div
                      key={`gap-line-${bridgeKey}`}
                      className="pointer-events-none absolute z-[2] border-t border-dashed border-sky-500/55"
                      style={{
                        left: x0,
                        width: w,
                        top: bridgeMidY,
                      }}
                      aria-hidden
                    />,
                  );
                } else {
                  segmentGapBridges.push(
                    <div
                      key={`gap-dot-${bridgeKey}`}
                      className="pointer-events-none absolute z-[2] size-1 rounded-full bg-sky-500/50"
                      style={{
                        left: x0 - 2,
                        top: bridgeMidY,
                      }}
                      aria-hidden
                    />,
                  );
                }
              }
            }

            return (
              <div
                key={row.rowId}
                className="absolute left-0"
                style={{ top: rowTop, width: timelineWidth, height: ROW_HEIGHT }}
              >
                {segmentGapBridges}
                {pieces.map((piece) => {
                  const diffItem = safeTaskDiffById[piece.id] ?? safeTaskDiffById[row.taskId];
                  const beforeTask = compareMode ? diffItem?.before ?? null : null;
                  const afterTask = compareMode
                    ? diffItem?.after ?? (diffItem?.status === "REMOVED" ? null : piece)
                    : piece;

                  const baseTask = afterTask ?? beforeTask;
                  if (!baseTask) {
                    return null;
                  }

                  const startIndex = findDayIndex(baseTask.startDate, "ceil");
                  const endIndex = findDayIndex(baseTask.endDate, "floor");
                  if (startIndex === null || endIndex === null) {
                    return null;
                  }

                  const status = compareMode ? diffItem?.status ?? "UNCHANGED" : "UNCHANGED";
                  const isRemoved = status === "REMOVED";
                  const isAdded = status === "ADDED";
                  const isUpdated = status === "UPDATED";
                  const startX = baseTask.isMilestone
                    ? geo.dayCenter(startIndex) - 7
                    : geo.dayLeft(startIndex);
                  const barWidth = baseTask.isMilestone ? 14 : ganttBarRangeWidthPx(geo, startIndex, endIndex);
                  const progressWidth = Math.max(0, Math.min(100, baseTask.progress));
                  const isComplete = baseTask.progress >= 100;
                  const selected = selectedRowIds.includes(piece.id);
                  const dependencySourceSelected = activeDependencySourceTaskId === piece.id;
                  const dependencyTargetSelected = dependencyConnectTargetTaskId === piece.id;
                  const visualOpacity = isComplete ? (selected ? 0.92 : 0.5) : 1;
                  const contrastColor = getContrastTextColor(baseTask.color);
                  const labelShadow =
                    contrastColor === "#f8fafc"
                      ? "0 1px 1px rgba(2, 6, 23, 0.45)"
                      : "0 1px 1px rgba(248, 250, 252, 0.45)";
                  const activityLabel = baseTask.activityName || baseTask.name;
                  const categoryPath = [
                    baseTask.categoryMajor,
                    baseTask.categoryMiddle1,
                    baseTask.categoryMiddle2,
                    baseTask.categorySmall,
                  ]
                    .filter((value): value is string => Boolean(value?.trim()))
                    .join(" / ");

                  const beforeStartIndex = beforeTask ? findDayIndex(beforeTask.startDate, "ceil") : null;
                  const beforeEndIndex = beforeTask ? findDayIndex(beforeTask.endDate, "floor") : null;
                  const beforeBar =
                    beforeTask && beforeStartIndex !== null && beforeEndIndex !== null
                      ? {
                          left: beforeTask.isMilestone
                            ? geo.dayCenter(beforeStartIndex) - 7
                            : geo.dayLeft(beforeStartIndex),
                          width: beforeTask.isMilestone
                            ? 14
                            : ganttBarRangeWidthPx(geo, beforeStartIndex, beforeEndIndex),
                          task: beforeTask,
                        }
                      : null;
                  const renderTask = isRemoved ? beforeBar?.task ?? baseTask : baseTask;
                  const baselineLineX =
                    beforeTask && beforeEndIndex !== null
                      ? geo.dayLeft(beforeEndIndex) + geo.daySpanWidth(beforeEndIndex)
                      : null;

                  const canSplitThisBar = startIndex < endIndex;
                  const splitThisBar = splitModeTaskId === piece.id;
                  const splitOtherBar = Boolean(splitModeTaskId) && !splitThisBar;
                  const barMenuLongPressEnabled =
                    enableTouchBarContextMenu &&
                    !compareMode &&
                    !dependencyCreateMode &&
                    !dependencyConnectActive &&
                    !renderTask.isMilestone &&
                    !splitOtherBar &&
                    ((splitThisBar && canSplitThisBar) ||
                      (!splitModeTaskId &&
                        (canSplitThisBar || Boolean(onMergeTimelineSegments) || mobileMergePickActive)));

                  return (
                    <motion.div
                      key={piece.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: visualOpacity, y: 0 }}
                      transition={{ duration: 0.15 }}
                      className={cn(
                        "absolute cursor-pointer select-none rounded-md",
                        compactTimelineForTouch ? "touch-manipulation" : "touch-none",
                        selected && "z-[25]",
                        dependencySourceSelected && "z-30",
                        selected &&
                          !dependencySourceSelected &&
                          !dependencyTargetSelected &&
                          "shadow-[0_0_0_3px_rgb(251,191,36),0_0_14px_rgba(245,158,11,0.45)] dark:shadow-[0_0_0_3px_rgb(252,211,77),0_0_16px_rgba(251,191,36,0.35)]",
                      )}
                      data-dependency-task-id={piece.id}
                      style={{
                        left: startX,
                        top: barOffsetY,
                        width: barWidth,
                        height: splitCompare ? 34 : 28,
                      }}
                      {...(barMenuLongPressEnabled
                        ? {
                            /** 캡처 단계: 자식 pointerdown(stopPropagation)보다 먼저 실행되어 모바일에서도 롱프레스 메뉴가 뜸 */
                            onPointerDownCapture: (e: React.PointerEvent) => {
                              if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
                              if (!e.isPrimary) return;
                              clearBarLongPress();
                              const pid = e.pointerId;
                              const pieceId = piece.id;
                              const gx = e.clientX;
                              const gy = e.clientY;
                              barLongPressGestureRef.current = { pieceId, x: gx, y: gy };

                              const endListen = () => {
                                window.removeEventListener("pointermove", onMove, true);
                                window.removeEventListener("pointerup", onEnd, true);
                                window.removeEventListener("pointercancel", onEnd, true);
                              };

                              const onEnd = (ev: PointerEvent) => {
                                if (ev.pointerId !== pid) return;
                                barLongPressPointerCleanupRef.current = null;
                                endListen();
                                if (barLongPressTimerRef.current != null) {
                                  window.clearTimeout(barLongPressTimerRef.current);
                                  barLongPressTimerRef.current = null;
                                }
                                barLongPressGestureRef.current = null;
                              };

                              const onMove = (ev: PointerEvent) => {
                                if (ev.pointerId !== pid) return;
                                const g = barLongPressGestureRef.current;
                                if (!g || g.pieceId !== pieceId || barLongPressTimerRef.current == null) return;
                                if (Math.hypot(ev.clientX - g.x, ev.clientY - g.y) > 22) {
                                  onEnd(ev);
                                }
                              };

                              window.addEventListener("pointermove", onMove, { capture: true, passive: true });
                              window.addEventListener("pointerup", onEnd, { capture: true });
                              window.addEventListener("pointercancel", onEnd, { capture: true });
                              barLongPressPointerCleanupRef.current = endListen;

                              barLongPressTimerRef.current = window.setTimeout(() => {
                                barLongPressTimerRef.current = null;
                                barLongPressPointerCleanupRef.current = null;
                                endListen();
                                const g = barLongPressGestureRef.current;
                                if (!g || g.pieceId !== pieceId) return;
                                barLongPressGestureRef.current = null;

                                onCancelTouchBarDrag?.();
                                if (suppressBarDragClickRef) {
                                  suppressBarDragClickRef.current = true;
                                }

                                if (mobileMergePickActiveRef.current && onMobileMergeLongPressFinishRef.current) {
                                  onMobileMergeLongPressFinishRef.current();
                                  return;
                                }

                                const sid = splitModeTaskIdRef.current;
                                if (sid === pieceId && onSplitCommit && canSplitThisBar) {
                                  const x = timelinePointerXToGridX(g.x);
                                  const clampedX = Math.max(0, Math.min(timelineWidth - 1, x));
                                  const afterIdx = pickSplitAfterIndexGeo(
                                    clampedX,
                                    geo,
                                    startIndex,
                                    endIndex,
                                    timeline.days.length,
                                  );
                                  onSplitCommit(pieceId, afterIdx);
                                  onExitSplitMode?.();
                                  setGanttContextMenu(null);
                                  return;
                                }

                                if (sid) {
                                  return;
                                }

                                resolveBarLongPress(g.pieceId, g.x, g.y, canSplitThisBar);
                              }, 520);
                            },
                          }
                        : {})}
                      onClick={(event) => {
                        if (suppressBarDragClickRef?.current) {
                          suppressBarDragClickRef.current = false;
                          event.preventDefault();
                          event.stopPropagation();
                          return;
                        }
                        if (
                          activeDependencySourceTaskId &&
                          activeDependencySourceTaskId !== piece.id &&
                          !compareMode
                        ) {
                          onDependencyTargetSelect(piece.id);
                          return;
                        }
                        if (onSelectTaskById) {
                          onSelectTaskById(piece.id, event.shiftKey || event.metaKey || event.ctrlKey);
                        } else {
                          onSelectRow(row, event.shiftKey || event.metaKey || event.ctrlKey);
                        }
                      }}
                      onMouseMove={(event) => {
                        if (compareMode || splitModeTaskId !== piece.id || renderTask.isMilestone) return;
                        if (startIndex >= endIndex) return;
                        const x = timelinePointerXToGridX(event.clientX);
                        const clampedX = Math.max(0, Math.min(timelineWidth - 1, x));
                        scheduleSplitGuide(
                          pickSplitAfterIndexGeo(clampedX, geo, startIndex, endIndex, timeline.days.length),
                        );
                      }}
                      onContextMenu={(event) => {
                        if (compareMode || dependencyCreateMode || dependencyConnectActive) return;
                        if (renderTask.isMilestone) return;
                        if (splitModeTaskId === piece.id) {
                          event.preventDefault();
                          event.stopPropagation();
                          toast.message("파란 줄 위를 왼쪽 클릭하면 나뉩니다. 취소: Esc / Ctrl+B");
                          return;
                        }
                        if (splitModeTaskId) {
                          event.preventDefault();
                          event.stopPropagation();
                          toast.message("나누기 모드입니다. 취소는 Esc 또는 Ctrl+B.");
                          return;
                        }
                        const canOpenBarMenu =
                          Boolean(onMergeTimelineSegments) || (Boolean(onEnterSplitMode) && startIndex < endIndex);
                        if (!canOpenBarMenu) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const { clientX, clientY } = event;
                        const tid = piece.id;
                        requestAnimationFrame(() => {
                          setGanttContextMenu({
                            taskId: tid,
                            clientX,
                            clientY,
                            canSplit: startIndex < endIndex,
                          });
                        });
                      }}
                    >
                      {baselineCompare && !isRemoved && baselineLineX !== null ? (
                        <div
                          className="pointer-events-none absolute bottom-0 top-0 w-px bg-red-500/90"
                          style={{ left: baselineLineX - startX }}
                        />
                      ) : null}

                      {splitCompare && beforeBar && !isRemoved ? (
                        <div
                          className="pointer-events-none absolute rounded-sm border border-dashed border-red-500/85 bg-red-100/45 dark:bg-red-900/20"
                          style={{
                            top: 0,
                            left: beforeBar.left - startX,
                            width: beforeBar.width,
                            height: 12,
                          }}
                        />
                      ) : null}

                      {baselineCompare && beforeBar && !isRemoved ? (
                        <div
                          className={cn(
                            "pointer-events-none absolute top-0 h-full rounded-md border border-dashed",
                            isUpdated ? "border-amber-500/80 bg-amber-200/20" : "border-slate-400/60 bg-slate-300/10",
                          )}
                          style={{
                            left: beforeBar.left - startX,
                            width: beforeBar.width,
                          }}
                        />
                      ) : null}

                      {renderTask.isMilestone ? (
                        <div
                          className={cn(
                            "absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border border-zinc-700 shadow",
                            selected &&
                              !dependencySourceSelected &&
                              !dependencyTargetSelected &&
                              "ring-[3px] ring-amber-400 ring-offset-2 ring-offset-zinc-100 dark:ring-amber-300 dark:ring-offset-zinc-950",
                          )}
                          style={{
                            backgroundColor: renderTask.color,
                            borderStyle: isRemoved ? "dashed" : "solid",
                            borderColor: isRemoved ? "rgb(239 68 68 / 0.85)" : undefined,
                          }}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            if (!compareMode && !dependencyCreateMode && !dependencyConnectActive) {
                              onBarPointerDown(piece.id, "move", event);
                            }
                          }}
                        />
                      ) : (
                        <>
                          <div
                            className={cn(
                              "group relative rounded-md border border-zinc-700/20 shadow-sm",
                              isRemoved && "border-red-500/70 border-dashed bg-red-100/45 dark:bg-red-900/20",
                              isAdded && "ring-1 ring-emerald-400/80",
                              isUpdated && "ring-1 ring-amber-400/80",
                              dependencySourceSelected && "ring-2 ring-sky-500/45",
                              dependencyTargetSelected && "ring-2 ring-emerald-500/55",
                              selected &&
                                !dependencySourceSelected &&
                                !dependencyTargetSelected &&
                                "ring-[3px] ring-amber-400 dark:ring-amber-300",
                            )}
                            style={{
                              backgroundColor: isRemoved ? "#fecaca" : renderTask.color,
                              height: splitCompare ? 18 : "100%",
                              top: splitCompare ? 14 : 0,
                            }}
                            onPointerDown={(event) => {
                              if (
                                splitModeTaskId === piece.id &&
                                !renderTask.isMilestone &&
                                splitGuideAfterIndex !== null &&
                                onSplitCommit &&
                                event.button === 0
                              ) {
                                const x = timelinePointerXToGridX(event.clientX);
                                const lineX = splitGuideBoundaryX(geo, splitGuideAfterIndex, timeline.days.length);
                                if (Math.abs(x - lineX) <= 14) {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onSplitCommit(piece.id, splitGuideAfterIndex);
                                  onExitSplitMode?.();
                                  setGanttContextMenu(null);
                                  return;
                                }
                              }
                              if (splitModeTaskId === piece.id) {
                                event.stopPropagation();
                                return;
                              }
                              event.stopPropagation();
                              if (!compareMode && !dependencyCreateMode && !dependencyConnectActive) {
                                onBarPointerDown(piece.id, "move", event);
                              }
                            }}
                          >
                            <div
                              className={cn(
                                "absolute left-0 top-0 h-full rounded-l-md",
                                isComplete ? "bg-white/35" : "bg-black/20",
                              )}
                              style={{ width: `${progressWidth}%` }}
                            />
                            {barWidth >= 68 ? (
                              <span
                                className="pointer-events-none absolute inset-0 flex items-center truncate px-2 text-[10px] font-semibold"
                                style={{
                                  color: isRemoved ? "#7f1d1d" : contrastColor,
                                  textShadow: labelShadow,
                                }}
                                title={activityLabel}
                              >
                                {activityLabel}
                              </span>
                            ) : null}
                            <div
                              className={cn(
                                "absolute -left-1 top-0 h-full w-2 cursor-ew-resize rounded-sm bg-white/90 opacity-0 shadow group-hover:opacity-100",
                                compactTimelineForTouch ? "touch-manipulation" : "touch-none",
                              )}
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                if (splitModeTaskId === piece.id) return;
                                if (!compareMode && !dependencyCreateMode && !dependencyConnectActive) {
                                  onBarPointerDown(piece.id, "start", event);
                                }
                              }}
                            />
                            {!compareMode ? (
                              <button
                                type="button"
                                className={cn(
                                  "absolute -right-3 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border bg-white text-zinc-700 shadow transition hover:bg-sky-50 hover:text-sky-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-sky-950/40",
                                  dependencyCreateMode || dependencyConnectActive
                                    ? "opacity-100"
                                    : "opacity-0 group-hover:opacity-100",
                                  dependencySourceSelected && "border-sky-500 text-sky-700 ring-2 ring-sky-500/35",
                                  dependencyTargetSelected &&
                                    "border-emerald-500 text-emerald-700 ring-2 ring-emerald-500/35",
                                )}
                                title="드래그해 연결"
                                onPointerDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onDependencyConnectStart(piece.id, event.clientX, event.clientY);
                                }}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (dependencyCreateMode) {
                                    onDependencySourceSelect(piece.id);
                                  }
                                }}
                              >
                                <ArrowRight className="size-3" />
                              </button>
                            ) : null}
                            <div
                              className={cn(
                                "absolute -right-1 top-0 h-full w-2 cursor-ew-resize rounded-sm bg-white/90 opacity-0 shadow group-hover:opacity-100",
                                compactTimelineForTouch ? "touch-manipulation" : "touch-none",
                              )}
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                if (splitModeTaskId === piece.id) return;
                                if (!compareMode && !dependencyCreateMode && !dependencyConnectActive) {
                                  onBarPointerDown(piece.id, "end", event);
                                }
                              }}
                            />
                          </div>
                          {piece.id === row.task.id ? (
                            <span
                              className={cn(
                                "pointer-events-none absolute left-0 truncate whitespace-nowrap text-[10px] text-muted",
                                splitCompare ? "-bottom-5" : "-bottom-4",
                                isComplete && "opacity-75",
                              )}
                              style={{ width: `${Math.max(barWidth, 1)}px` }}
                              title={categoryPath || activityLabel}
                            >
                              {categoryPath || activityLabel}
                            </span>
                          ) : null}
                        </>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            );
          })}

          {holidayLabelSegments.length > 0 ? (
            <div
              className="pointer-events-none absolute left-0 top-0 z-[9]"
              style={{ width: timelineWidth, height: visibleRows.length * ROW_HEIGHT }}
              aria-hidden
            >
              {holidayLabelSegments.map((seg, idx) => {
                const left = geo.dayLeft(seg.startIndex);
                let spanW = 0;
                for (let j = seg.startIndex; j <= seg.endIndex; j += 1) {
                  spanW += geo.daySpanWidth(j);
                }
                return (
                  <div
                    key={`hol-body-${idx}-${seg.startIndex}-${seg.endIndex}`}
                    className="absolute top-0 flex items-center justify-center overflow-visible"
                    style={{ left, width: spanW, height: "100%" }}
                  >
                    <GanttHolidayColumnLabel text={seg.label} />
                  </div>
                );
              })}
            </div>
          ) : null}

          <svg
            className="pointer-events-none absolute left-0 top-0 z-10"
            width={timelineWidth}
            height={visibleRows.length * ROW_HEIGHT}
          >
            <defs>
              <marker id="arrowhead-removed" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="rgba(239,68,68,0.95)" />
              </marker>
              <marker id="arrowhead-added" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="rgba(16,185,129,0.95)" />
              </marker>
              <marker id="arrowhead-changed" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="rgba(245,158,11,0.95)" />
              </marker>
              <marker id="arrowhead-default" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill={dependencyLineColor} />
              </marker>
            </defs>
            {dependencyPaths.removed.map((dependency) => (
              <g key={dependency.id}>
                <path
                  d={dependency.path}
                  fill="none"
                  stroke="rgba(239,68,68,0.9)"
                  strokeWidth={dependencyLineStrokeWidth}
                  strokeDasharray="5 4"
                  markerEnd="url(#arrowhead-removed)"
                />
                <text x={dependency.x} y={dependency.y - 4} fontSize={10} textAnchor="middle" fill="rgba(220,38,38,0.95)">
                  {dependency.label}
                </text>
              </g>
            ))}
            {dependencyPaths.current.map((dependency) => {
              const strokeColor =
                dependency.status === "added"
                  ? "rgba(16,185,129,0.95)"
                  : dependency.status === "changed"
                    ? "rgba(245,158,11,0.95)"
                    : dependencyLineColor;
              const markerId =
                dependency.status === "added"
                  ? "arrowhead-added"
                  : dependency.status === "changed"
                    ? "arrowhead-changed"
                    : "arrowhead-default";
              return (
              <g key={dependency.id}>
                <path
                  d={dependency.path}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={dependencyLineStrokeWidth}
                  markerEnd={`url(#${markerId})`}
                />
                <text
                  x={dependency.x}
                  y={dependency.y - 4}
                  fontSize={10}
                  textAnchor="middle"
                  fill={
                    dependency.status === "added"
                      ? "rgba(5,150,105,0.95)"
                      : dependency.status === "changed"
                        ? "rgba(217,119,6,0.95)"
                        : dependencyLineColor
                  }
                >
                  {dependency.label}
                </text>
              </g>
              );
            })}
          </svg>

          {splitModeTaskId &&
          splitGuideAfterIndex !== null &&
          splitGuideRowIndex !== null &&
          !compareMode ? (
            <>
              <div
                className="pointer-events-none absolute z-[50] w-0.5 -translate-x-1/2 bg-sky-500 shadow-[0_0_8px_2px_rgba(14,165,233,0.9)]"
                style={{
                  left: splitGuideBoundaryX(geo, splitGuideAfterIndex, timeline.days.length),
                  top: splitGuideRowIndex * ROW_HEIGHT + 4,
                  height: ROW_HEIGHT - 8,
                }}
                aria-hidden
              />
              <button
                type="button"
                aria-label="이 날짜에서 나누기"
                title="왼쪽 클릭으로 이 위치에서 나눕니다"
                className="absolute z-[55] w-5 -translate-x-1/2 cursor-pointer border-0 bg-transparent p-0"
                style={{
                  left: splitGuideBoundaryX(geo, splitGuideAfterIndex, timeline.days.length),
                  top: splitGuideRowIndex * ROW_HEIGHT + 4,
                  height: ROW_HEIGHT - 8,
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0 || !onSplitCommit || !splitModeTaskId) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onSplitCommit(splitModeTaskId, splitGuideAfterIndex);
                  onExitSplitMode?.();
                }}
              />
            </>
          ) : null}
        </div>
      </div>
      {mobileEmptyCreateOffer &&
        mobileEmptyCreatePopoverStyle &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[108] bg-black/25"
              role="presentation"
              onPointerDown={() => setMobileEmptyCreateOffer(null)}
            />
            <div
              className="fixed z-[110] w-[220px] overflow-hidden rounded-xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-600 dark:bg-zinc-900"
              style={{ left: mobileEmptyCreatePopoverStyle.left, top: mobileEmptyCreatePopoverStyle.top }}
            >
              <p className="px-1 pb-2 text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">빈 칸에서 작업을 추가합니다.</p>
              <button
                type="button"
                className="w-full rounded-lg bg-sky-600 px-3 py-2.5 text-left text-[14px] font-semibold text-white hover:bg-sky-700 active:bg-sky-800"
                onClick={() => {
                  const offer = mobileEmptyCreateOffer;
                  if (!offer || timeline.days.length === 0) {
                    setMobileEmptyCreateOffer(null);
                    return;
                  }
                  const si = offer.startIndex;
                  const ei = Math.min(timeline.days.length - 1, si + 2);
                  const startDate = timeline.days[si];
                  const endDate = timeline.days[ei];
                  if (!startDate || !endDate) {
                    setMobileEmptyCreateOffer(null);
                    return;
                  }
                  onCreateTask({
                    row: offer.row,
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString(),
                  });
                  setMobileEmptyCreateOffer(null);
                }}
              >
                작업 생성하기
              </button>
            </div>
          </>,
          document.body,
        )}
      {ganttContextMenu &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={ganttContextMenuRef}
            data-gantt-split-menu
            className="fixed z-[110] min-w-[168px] overflow-hidden rounded-md border border-zinc-200 bg-white py-0.5 text-[13px] shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
            style={{ left: ganttContextMenu.clientX, top: ganttContextMenu.clientY }}
          >
            {!compareMode && onEnterSplitMode && ganttContextMenu.canSplit ? (
              <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title="파란 줄 위를 왼쪽 클릭으로 확정 · Esc / Ctrl+B 취소"
                onClick={() => {
                  onEnterSplitMode(ganttContextMenu.taskId);
                  setGanttContextMenu(null);
                }}
              >
                나누기
              </button>
            ) : null}
            {!compareMode && mergeContextMenuItemVisible && onMergeTimelineSegments ? (
              <button
                type="button"
                className={cn(
                  "w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  onEnterSplitMode &&
                    ganttContextMenu.canSplit &&
                    "border-t border-zinc-200 dark:border-zinc-700",
                )}
                title={
                  enableTouchBarContextMenu
                    ? "모바일: 첫 합치기 후 막대를 더 눌러 고르고, 다시 우클릭·꾹 눌러 완료. PC: Shift로 여러 개 고른 뒤 합치기 한 번이면 바로 합쳐짐"
                    : "Shift로 같은 작업의 막대를 여러 개 선택한 뒤 합치기 (선택 부족 시에만 고르기 모드)"
                }
                onClick={() => {
                  onMergeTimelineSegments();
                  setGanttContextMenu(null);
                }}
              >
                합치기
              </button>
            ) : null}
          </div>,
          document.body,
        )}
    </div>
  );
}




