"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { cn, isIOSTouchDevice } from "@/lib/utils";
import type { FieldScheduleScale, HolidayModel } from "@/types/domain";
import {
  buildHeaderGroups,
  buildProjectHolidayLabelSegments,
  isFixedHoliday,
  isProjectHoliday,
  isToday,
  isWeekend,
  type TimelineVisibilityFilter,
} from "@/features/gantt/timeline";
import type { FieldScheduleRange, FieldScheduleRow } from "@/features/field-schedule/field-schedule";
import { FIELD_CELL_WIDTH } from "@/features/field-schedule/field-schedule";

const FIELD_CELL_WIDTH_MOBILE = 28;

/** 스크롤이 안쪽에서 이 영역으로 막 들어올 때 이전/다음 구간으로 넘김 */
const FIELD_EDGE_ENTER_PX = 16;

const FIELD_CREATE_EMPTY_LONG_PRESS_MS = 420;
const FIELD_CREATE_EMPTY_CANCEL_MOVE_PX = 14;
const FIELD_IOS_EMPTY_TAP_MAX_MS = 340;
const FIELD_IOS_EMPTY_TAP_MAX_MOVE_PX = 16;
const FIELD_MOBILE_EMPTY_CREATE_POPOVER_W = 220;
const FIELD_MOBILE_EMPTY_CREATE_POPOVER_H = 96;

function clampFieldMobileEmptyCreatePopoverPosition(clientX: number, clientY: number) {
  if (typeof window === "undefined") {
    return { left: clientX, top: clientY };
  }
  const pad = 10;
  const w = FIELD_MOBILE_EMPTY_CREATE_POPOVER_W;
  const h = FIELD_MOBILE_EMPTY_CREATE_POPOVER_H;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = clientX - w / 2;
  let top = clientY - h - 14;
  left = Math.max(pad, Math.min(left, vw - w - pad));
  top = Math.max(pad, Math.min(top, vh - h - pad));
  return { left, top };
}

function useFieldCellWidth() {
  const [cellWidth, setCellWidth] = React.useState(FIELD_CELL_WIDTH);
  React.useEffect(() => {
    const mql = window.matchMedia("(max-width: 640px)");
    const update = () => setCellWidth(mql.matches ? FIELD_CELL_WIDTH_MOBILE : FIELD_CELL_WIDTH);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return cellWidth;
}

const MAIN_CATEGORY_WIDTH = 144;
const MIDDLE_CATEGORY_WIDTH = 128;
const SMALL_CATEGORY_WIDTH = 192;

type ResizeMode = "move" | "start" | "end";

type CategoryColumnKey = "main" | "middle1" | "middle2" | "small";

function FieldHolidayColumnLabel({ text }: { text: string }) {
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

interface CreateDragState {
  row: FieldScheduleRow;
  element: HTMLDivElement;
  startIndex: number;
  currentIndex: number;
}

interface FieldScheduleCategoryColumn {
  key: CategoryColumnKey;
  label: string;
  width: number;
  stickyLeft: number;
}

interface FieldSchedulePanelProps {
  rows: FieldScheduleRow[];
  range: FieldScheduleRange;
  scale: FieldScheduleScale;
  compareMode: boolean;
  dependencyCreateMode: boolean;
  dependencyConnectActive: boolean;
  activeDependencySourceTaskId: string | null;
  dependencyConnectTargetTaskId: string | null;
  timelineVisibility: TimelineVisibilityFilter;
  projectHolidayDayKeys?: Set<string>;
  projectHolidays?: Pick<HolidayModel, "startDate" | "endDate" | "name" | "scope">[];
  selectedTaskIds: string[];
  showMainCategory?: boolean;
  showMiddle1Category: boolean;
  showMiddle2Category: boolean;
  showSmallCategory: boolean;
  onSelectTask: (taskId: string, additive: boolean) => void;
  onBarPointerDown: (taskId: string, mode: ResizeMode, event: React.PointerEvent<Element>, cellWidth: number) => void;
  suppressBarDragClickRef?: React.MutableRefObject<boolean>;
  onDependencySourceSelect: (taskId: string) => void;
  onDependencyConnectStart: (taskId: string, clientX: number, clientY: number) => void;
  onDependencyTargetSelect: (taskId: string) => void;
  onUpdateTaskLabel: (taskId: string, nextLabel: string) => void;
  onCreateTask: (payload: {
    mainCategory: string;
    middle1Category: string;
    middle2Category: string;
    smallCategory: string;
    startDate: string;
    endDate: string;
    label: string;
  }) => void;
  /** 일 단위 나누기 모드: 선택 작업 막대 위에서 날짜 경계 가이드 후 우클릭으로 확정 */
  splitModeTaskId?: string | null;
  onEnterFieldSplitMode?: (taskId: string) => void;
  onExitFieldSplitMode?: () => void;
  onFieldSplitCommit?: (taskId: string, splitAfterIndex: number) => void;
  mergeContextMenuItemVisible?: boolean;
  onMergeTimelineSegments?: () => void;
  mobileMergePickActive?: boolean;
  onMobileMergeLongPressFinish?: () => void;
  enableTouchBarContextMenu?: boolean;
  onCancelTouchBarDrag?: () => void;
  /** 가로 스크롤 끝(터치·트랙패드·스크롤바)에서 이전/다음 주·월 구간으로 이동 */
  mobileFieldEdgePanEnabled?: boolean;
  onMobileFieldEdgePan?: (direction: "past" | "future") => void;
  /** 편집 + 좁은 화면: 꾹 누를 때 브라우저 시스템 메뉴(공유·인쇄 등) 억제 */
  suppressBrowserTouchCallout?: boolean;
}

function getDayTone(day: Date, projectHolidayDayKeys?: Set<string>) {
  if (isProjectHoliday(day, projectHolidayDayKeys)) {
    return "project";
  }

  if (isWeekend(day) || isFixedHoliday(day)) {
    return "offday";
  }

  return "default";
}

function getToneClass(day: Date, projectHolidayDayKeys?: Set<string>) {
  const tone = getDayTone(day, projectHolidayDayKeys);
  if (tone === "project") {
    return "bg-amber-100/75 dark:bg-amber-500/10";
  }
  if (tone === "offday") {
    return "bg-slate-100/80 dark:bg-zinc-900/55";
  }
  return "bg-white/80 dark:bg-zinc-950";
}

function pickSplitAfterIndex(x: number, cellWidth: number, startIndex: number, endIndex: number) {
  let bestD = startIndex;
  let bestDist = Infinity;
  for (let d = startIndex; d < endIndex; d++) {
    const boundaryX = (d + 1) * cellWidth;
    const dist = Math.abs(x - boundaryX);
    if (dist < bestDist) {
      bestDist = dist;
      bestD = d;
    }
  }
  return bestD;
}

function getSegmentClass(status: "ADDED" | "REMOVED" | "UPDATED" | "UNCHANGED") {
  if (status === "ADDED") {
    return "border-emerald-500 bg-emerald-500/20 text-emerald-800 dark:text-emerald-200";
  }
  if (status === "REMOVED") {
    return "border-red-500 border-dashed bg-red-500/12 text-red-800 dark:text-red-200";
  }
  if (status === "UPDATED") {
    return "border-amber-500 bg-amber-500/18 text-amber-900 dark:text-amber-100";
  }
  return "";
}

export function FieldSchedulePanel({
  rows,
  range,
  scale,
  compareMode,
  dependencyCreateMode,
  dependencyConnectActive,
  activeDependencySourceTaskId,
  dependencyConnectTargetTaskId,
  timelineVisibility,
  projectHolidayDayKeys,
  projectHolidays = [],
  selectedTaskIds,
  showMainCategory = true,
  showMiddle1Category,
  showMiddle2Category,
  showSmallCategory,
  onSelectTask,
  onBarPointerDown,
  suppressBarDragClickRef,
  onDependencySourceSelect,
  onDependencyConnectStart,
  onDependencyTargetSelect,
  onUpdateTaskLabel,
  onCreateTask,
  splitModeTaskId = null,
  onEnterFieldSplitMode,
  onExitFieldSplitMode,
  onFieldSplitCommit,
  mergeContextMenuItemVisible = false,
  onMergeTimelineSegments,
  mobileMergePickActive = false,
  onMobileMergeLongPressFinish,
  enableTouchBarContextMenu = false,
  onCancelTouchBarDrag,
  mobileFieldEdgePanEnabled = false,
  onMobileFieldEdgePan,
  suppressBrowserTouchCallout = false,
}: FieldSchedulePanelProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const fieldEdgeCooldownUntilRef = React.useRef(0);
  const pendingFieldEdgeScrollRef = React.useRef<"past" | "future" | null>(null);
  const prevFieldScrollLeftForEdgeRef = React.useRef<number>(-1);
  const didAutoScrollRef = React.useRef(false);
  const [createDrag, setCreateDrag] = React.useState<CreateDragState | null>(null);
  const [mobileEmptyCreateOffer, setMobileEmptyCreateOffer] = React.useState<{
    row: FieldScheduleRow;
    startIndex: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const fieldCreateEmptyLongPressDetachRef = React.useRef<(() => void) | null>(null);
  const clearFieldCreateEmptyLongPress = React.useCallback(() => {
    fieldCreateEmptyLongPressDetachRef.current?.();
    fieldCreateEmptyLongPressDetachRef.current = null;
  }, []);

  React.useEffect(() => () => clearFieldCreateEmptyLongPress(), [clearFieldCreateEmptyLongPress]);

  React.useEffect(() => {
    if (compareMode || dependencyCreateMode || dependencyConnectActive) {
      setMobileEmptyCreateOffer(null);
      clearFieldCreateEmptyLongPress();
    }
  }, [compareMode, dependencyCreateMode, dependencyConnectActive, clearFieldCreateEmptyLongPress]);

  React.useEffect(() => {
    if (splitModeTaskId) {
      clearFieldCreateEmptyLongPress();
      setMobileEmptyCreateOffer(null);
    }
  }, [splitModeTaskId, clearFieldCreateEmptyLongPress]);

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

  const [openMemoPopup, setOpenMemoPopup] = React.useState<{
    taskId: string;
    notes: string;
    anchorRect: DOMRect;
  } | null>(null);
  const [segmentContextMenu, setSegmentContextMenu] = React.useState<{
    taskId: string;
    clientX: number;
    clientY: number;
    canSplit: boolean;
  } | null>(null);
  const segmentContextMenuRef = React.useRef<HTMLDivElement>(null);
  const segLongPressTimerRef = React.useRef<number | null>(null);
  const segLongPressGestureRef = React.useRef<{ taskId: string; x: number; y: number } | null>(null);
  const segLongPressPointerCleanupRef = React.useRef<(() => void) | null>(null);

  const clearSegLongPress = React.useCallback(() => {
    segLongPressPointerCleanupRef.current?.();
    segLongPressPointerCleanupRef.current = null;
    if (segLongPressTimerRef.current != null) {
      window.clearTimeout(segLongPressTimerRef.current);
      segLongPressTimerRef.current = null;
    }
    segLongPressGestureRef.current = null;
  }, []);

  React.useEffect(() => () => clearSegLongPress(), [clearSegLongPress]);

  const splitModeTaskIdRef = React.useRef(splitModeTaskId);
  splitModeTaskIdRef.current = splitModeTaskId;
  const mobileMergePickActiveRef = React.useRef(mobileMergePickActive);
  mobileMergePickActiveRef.current = mobileMergePickActive;
  const onMobileMergeLongPressFinishRef = React.useRef(onMobileMergeLongPressFinish);
  onMobileMergeLongPressFinishRef.current = onMobileMergeLongPressFinish;

  React.useEffect(() => {
    clearSegLongPress();
  }, [splitModeTaskId, mobileMergePickActive, clearSegLongPress]);

  const resolveSegmentLongPress = React.useCallback(
    (taskId: string, clientX: number, clientY: number, canSplit: boolean) => {
      onCancelTouchBarDrag?.();
      if (suppressBarDragClickRef) {
        suppressBarDragClickRef.current = true;
      }
      setMobileEmptyCreateOffer(null);
      setSegmentContextMenu({ taskId, clientX, clientY, canSplit });
    },
    [onCancelTouchBarDrag, suppressBarDragClickRef],
  );
  const [splitGuideAfterIndex, setSplitGuideAfterIndex] = React.useState<number | null>(null);
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
  const memoBalloonRef = React.useRef<HTMLDivElement>(null);
  const baseCellWidth = useFieldCellWidth();
  const [timelineViewportWidth, setTimelineViewportWidth] = React.useState(0);

  React.useEffect(() => {
    if (!openMemoPopup) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (memoBalloonRef.current?.contains(target)) return;
      setOpenMemoPopup(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openMemoPopup]);

  React.useEffect(() => {
    if (!segmentContextMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      // 우클릭으로 연 직후 같은 제스처의 보조 버튼 이벤트가 메뉴를 바로 닫지 않도록 함
      if (e.button !== 0) return;
      const target = e.target as Node;
      if (segmentContextMenuRef.current?.contains(target)) return;
      setSegmentContextMenu(null);
    };
    const onScroll = () => setSegmentContextMenu(null);
    const scroller = scrollRef.current;
    document.addEventListener("pointerdown", onPointerDown);
    scroller?.addEventListener("scroll", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      scroller?.removeEventListener("scroll", onScroll);
    };
  }, [segmentContextMenu]);

  React.useEffect(() => {
    if (!splitModeTaskId) {
      setSplitGuideAfterIndex(null);
    }
  }, [splitModeTaskId]);

  React.useEffect(
    () => () => {
      if (splitGuideRafRef.current != null) {
        cancelAnimationFrame(splitGuideRafRef.current);
      }
    },
    [],
  );

  const headerGroups = React.useMemo(() => buildHeaderGroups(range.days), [range.days]);
  const fieldRangeBoundsKey = React.useMemo(() => {
    if (range.days.length === 0) {
      return "";
    }
    return `${range.days[0].toISOString()}|${range.days[range.days.length - 1].toISOString()}`;
  }, [range.days]);

  React.useEffect(() => {
    prevFieldScrollLeftForEdgeRef.current = -1;
  }, [fieldRangeBoundsKey]);

  const categoryColumns = React.useMemo(() => {
    const defs: Array<Omit<FieldScheduleCategoryColumn, "stickyLeft">> = [
      ...(showMainCategory ? [{ key: "main" as const, label: "공종", width: MAIN_CATEGORY_WIDTH }] : []),
      ...(showMiddle1Category ? [{ key: "middle1" as const, label: "중분류1", width: MIDDLE_CATEGORY_WIDTH }] : []),
      ...(showMiddle2Category ? [{ key: "middle2" as const, label: "중분류2", width: MIDDLE_CATEGORY_WIDTH }] : []),
      ...(showSmallCategory ? [{ key: "small" as const, label: "세부공종", width: SMALL_CATEGORY_WIDTH }] : []),
    ];

    let stickyLeft = 0;
    return defs.map((column) => {
      const next = {
        ...column,
        stickyLeft,
      };
      stickyLeft += column.width;
      return next;
    });
  }, [showMainCategory, showMiddle1Category, showMiddle2Category, showSmallCategory]);
  const categoryWidth = categoryColumns.reduce((sum, column) => sum + column.width, 0);

  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      const w = entry ? entry.contentRect.width : el.clientWidth;
      setTimelineViewportWidth(w);
    });
    ro.observe(el);
    setTimelineViewportWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const cellWidth = React.useMemo(() => {
    if (scale !== "WEEKLY" || range.days.length === 0 || timelineViewportWidth <= 0) {
      return baseCellWidth;
    }
    const avail = Math.max(0, timelineViewportWidth - categoryWidth - 8);
    return Math.max(baseCellWidth, avail / range.days.length);
  }, [baseCellWidth, categoryWidth, range.days.length, scale, timelineViewportWidth]);

  const timelineWidth = range.days.length * cellWidth;
  const contentWidth = categoryWidth + timelineWidth;

  const holidayLabelSegments = React.useMemo(
    () => buildProjectHolidayLabelSegments(range.days, projectHolidays, projectHolidayDayKeys),
    [range.days, projectHolidays, projectHolidayDayKeys],
  );

  const fieldScheduleBodyHeight = React.useMemo(
    () => rows.reduce((sum, row) => sum + row.rowHeight, 0),
    [rows],
  );

  const handleFieldScrollerScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      setSegmentContextMenu(null);
      setMobileEmptyCreateOffer(null);

      const el = event.currentTarget;
      const maxSl = Math.max(0, el.scrollWidth - el.clientWidth);
      const sl = Math.max(0, el.scrollLeft);
      const prevSl = prevFieldScrollLeftForEdgeRef.current;
      prevFieldScrollLeftForEdgeRef.current = sl;

      if (!mobileFieldEdgePanEnabled || !onMobileFieldEdgePan || maxSl <= 0) {
        return;
      }

      if (prevSl < 0) {
        return;
      }

      const now = Date.now();
      if (now < fieldEdgeCooldownUntilRef.current) {
        return;
      }

      const enter = FIELD_EDGE_ENTER_PX;
      const wasInsideLeft = prevSl > enter;
      const atLeft = sl <= enter;
      const wasInsideRight = prevSl < maxSl - enter;
      const atRight = sl >= maxSl - enter;

      if (wasInsideLeft && atLeft) {
        pendingFieldEdgeScrollRef.current = "past";
        fieldEdgeCooldownUntilRef.current = now + 480;
        onMobileFieldEdgePan("past");
        return;
      }
      if (wasInsideRight && atRight) {
        pendingFieldEdgeScrollRef.current = "future";
        fieldEdgeCooldownUntilRef.current = now + 480;
        onMobileFieldEdgePan("future");
      }
    },
    [mobileFieldEdgePanEnabled, onMobileFieldEdgePan],
  );

  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    const pending = pendingFieldEdgeScrollRef.current;
    if (!el || !pending) {
      return;
    }
    pendingFieldEdgeScrollRef.current = null;
    requestAnimationFrame(() => {
      const maxSl = Math.max(0, el.scrollWidth - el.clientWidth);
      if (pending === "future") {
        el.scrollLeft = 0;
      } else {
        el.scrollLeft = maxSl;
      }
    });
  }, [fieldRangeBoundsKey]);

  React.useEffect(() => {
    if (rows.length === 0) {
      didAutoScrollRef.current = false;
    }
  }, [rows.length]);

  React.useEffect(() => {
    if (didAutoScrollRef.current) {
      return;
    }
    if (!scrollRef.current) {
      return;
    }

    const todayIndex = range.days.findIndex((day) => isToday(day));
    if (todayIndex < 0) {
      return;
    }

    const scroller = scrollRef.current;
    const leftOffset = categoryWidth + todayIndex * cellWidth;
    const target = Math.max(0, leftOffset - scroller.clientWidth * 0.4);
    scroller.scrollLeft = target;
    didAutoScrollRef.current = true;
  }, [categoryWidth, cellWidth, range.days]);

  React.useEffect(() => {
    if (!createDrag) {
      return;
    }

    const getDayIndex = (event: PointerEvent) => {
      const rect = createDrag.element.getBoundingClientRect();
      const rawX = event.clientX - rect.left;
      const clampedX = Math.max(0, Math.min(rect.width - 1, rawX));
      return Math.max(0, Math.min(range.days.length - 1, Math.floor(clampedX / cellWidth)));
    };

    const onPointerMove = (event: PointerEvent) => {
      event.preventDefault();
      setCreateDrag((current) =>
        current
          ? {
              ...current,
              currentIndex: getDayIndex(event),
            }
          : current,
      );
    };

    const onPointerUp = () => {
      const activeDrag = createDrag;
      setCreateDrag(null);

      const startIndex = Math.min(activeDrag.startIndex, activeDrag.currentIndex);
      const endIndex = Math.max(activeDrag.startIndex, activeDrag.currentIndex);
      const startDate = range.days[startIndex];
      const endDate = range.days[endIndex];
      if (!startDate || !endDate) {
        return;
      }

      onCreateTask({
        mainCategory: activeDrag.row.mainCategory,
        middle1Category: activeDrag.row.middle1Category,
        middle2Category: activeDrag.row.middle2Category,
        smallCategory: activeDrag.row.smallCategory,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        label: "",
      });
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [cellWidth, createDrag, onCreateTask, range.days]);

  const fieldTouchCalloutAttachedRef = React.useRef<HTMLElement[]>([]);
  React.useLayoutEffect(() => {
    if (!suppressBrowserTouchCallout) {
      return;
    }
    const onContextMenu = (ev: Event) => {
      ev.preventDefault();
    };
    const opts: AddEventListenerOptions = { capture: true, passive: false };
    const attach = () => {
      for (const el of fieldTouchCalloutAttachedRef.current) {
        el.removeEventListener("contextmenu", onContextMenu, opts);
      }
      fieldTouchCalloutAttachedRef.current = [];
      const el = scrollRef.current;
      if (!el) {
        return;
      }
      el.addEventListener("contextmenu", onContextMenu, opts);
      fieldTouchCalloutAttachedRef.current = [el];
    };
    attach();
    const raf = requestAnimationFrame(attach);
    return () => {
      cancelAnimationFrame(raf);
      for (const el of fieldTouchCalloutAttachedRef.current) {
        el.removeEventListener("contextmenu", onContextMenu, opts);
      }
      fieldTouchCalloutAttachedRef.current = [];
    };
  }, [suppressBrowserTouchCallout, range.days.length, rows.length]);

  const fieldMobileEmptyCreatePopoverStyle = React.useMemo(() => {
    if (!mobileEmptyCreateOffer) {
      return null;
    }
    return clampFieldMobileEmptyCreatePopoverPosition(mobileEmptyCreateOffer.clientX, mobileEmptyCreateOffer.clientY);
  }, [mobileEmptyCreateOffer]);

  return (
    <div className="glass-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
      <div className="shrink-0 border-b border-zinc-200/70 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{scale === "MONTHLY" ? "월간 공정표" : "주간 공정표"}</span>
          <span>
            {format(range.start, "yyyy.MM.dd")} - {format(range.end, "yyyy.MM.dd")}
          </span>
          {timelineVisibility.hideSaturday || timelineVisibility.hideSunday || timelineVisibility.hideHoliday ? (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] dark:bg-zinc-800">필터 적용</span>
          ) : null}
        </div>
      </div>

      <div
        ref={scrollRef}
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-auto overscroll-x-contain",
          suppressBrowserTouchCallout && "gantt-suppress-system-callout touch-manipulation",
        )}
        style={
          suppressBrowserTouchCallout ? ({ WebkitOverflowScrolling: "touch" } as React.CSSProperties) : undefined
        }
        onScroll={handleFieldScrollerScroll}
      >
        <div className="min-h-full min-w-max" style={{ width: contentWidth }}>
          <div className="sticky top-0 z-30 border-b border-zinc-200/70 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex">
              {categoryColumns.map((column) => (
                <div
                  key={column.key}
                  className="sticky z-40 flex shrink-0 items-center justify-center border-r border-zinc-200/70 bg-zinc-100 text-xs font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                  style={{ left: column.stickyLeft, width: column.width, height: 36 }}
                >
                  {column.label}
                </div>
              ))}
              <div className="flex shrink-0 shadow-[-4px_0_8px_-2px_rgba(0,0,0,0.06)] dark:shadow-[-4px_0_12px_-2px_rgba(0,0,0,0.25)]" style={{ width: timelineWidth, height: 36 }}>
                {headerGroups.weekGroups.map((group) => {
                  const weekLabel =
                    scale === "MONTHLY" && group.span > 0 && range.days[group.startIndex] && range.days[group.startIndex + group.span - 1]
                      ? `${format(range.days[group.startIndex], "M/d")}~${format(range.days[group.startIndex + group.span - 1], "M/d")}`
                      : group.label;
                  return (
                    <div
                      key={`${group.label}-${group.startIndex}`}
                      className="flex items-center justify-center border-r border-zinc-200/70 text-[11px] font-medium text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
                      style={{ width: group.span * cellWidth, minWidth: group.span * cellWidth }}
                      title={group.label}
                    >
                      <span className="truncate whitespace-nowrap px-0.5">{weekLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex border-t border-zinc-200/70 dark:border-zinc-800">
              {categoryColumns.map((column) => (
                <div
                  key={`${column.key}-blank`}
                  className="sticky z-40 shrink-0 border-r border-zinc-200/70 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
                  style={{ left: column.stickyLeft, width: column.width, height: 34 }}
                />
              ))}
              <div className="flex" style={{ width: timelineWidth, height: 34 }}>
                {range.days.map((day) => (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      "flex items-center justify-center border-r border-zinc-200/70 text-[10px] dark:border-zinc-800",
                      scale === "MONTHLY" ? "flex-row gap-0.5" : "flex-col",
                      getToneClass(day, projectHolidayDayKeys),
                      isToday(day) && "ring-1 ring-inset ring-sky-500/60",
                    )}
                    style={{ width: cellWidth, minWidth: cellWidth }}
                    title={format(day, "yyyy.MM.dd EEE")}
                  >
                    <span className={cn("shrink-0 font-semibold", isWeekend(day) && "text-rose-500")}>{format(day, "d")}</span>
                    <span className={cn("shrink-0 truncate text-zinc-500 dark:text-zinc-400", scale === "MONTHLY" ? "text-[8px]" : "text-[9px]")}>
                      {format(day, "EEE")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {holidayLabelSegments.length > 0 ? (
              <div className="flex border-t border-zinc-200/70 dark:border-zinc-800">
                {categoryColumns.map((column) => (
                  <div
                    key={`${column.key}-hol-blank`}
                    className="sticky z-40 shrink-0 border-r border-zinc-200/70 bg-slate-50/50 dark:border-zinc-800 dark:bg-zinc-950"
                    style={{ left: column.stickyLeft, width: column.width, height: 24 }}
                  />
                ))}
                <div
                  className="relative shrink-0 border-l border-zinc-200/40 bg-slate-50/35 dark:border-zinc-800 dark:bg-zinc-950/50"
                  style={{ width: timelineWidth, height: 24 }}
                >
                  {holidayLabelSegments.map((seg, idx) => {
                    const left = seg.startIndex * cellWidth;
                    const spanW = (seg.endIndex - seg.startIndex + 1) * cellWidth;
                    return (
                      <div
                        key={`field-hol-${idx}-${seg.startIndex}`}
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
              </div>
            ) : null}
          </div>

          <div className="relative">
            {rows.map((row) => (
              <div key={row.rowId} className="flex border-b border-zinc-200/70 dark:border-zinc-800">
                {categoryColumns.map((column) => {
                  const value =
                    column.key === "main"
                      ? row.showMainCategoryLabel
                        ? row.mainCategory
                        : ""
                      : column.key === "middle1"
                        ? row.middle1Category
                        : column.key === "middle2"
                          ? row.middle2Category
                          : row.smallCategory;
                  const isMainColumn = column.key === "main";

                  return (
                    <div
                      key={`${row.rowId}-${column.key}`}
                      className={cn(
                        "sticky z-20 flex shrink-0 items-center border-r border-zinc-200/70 px-3 text-sm dark:border-zinc-800",
                        isMainColumn
                          ? "bg-zinc-50 font-semibold text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
                          : "bg-white text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300",
                      )}
                      style={{ left: column.stickyLeft, width: column.width, height: row.rowHeight }}
                    >
                      <span className="truncate">{value}</span>
                    </div>
                  );
                })}
                <div
                  data-field-split-row="true"
                  className={cn(
                    "relative z-0",
                    splitModeTaskId &&
                      row.segments.some((s) => s.taskId === splitModeTaskId && s.endIndex > s.startIndex) &&
                      "cursor-col-resize",
                  )}
                  style={{ width: timelineWidth, height: row.rowHeight }}
                  onMouseMove={(event) => {
                    if (!splitModeTaskId) return;
                    const splitSeg = row.segments.find(
                      (s) => s.taskId === splitModeTaskId && s.endIndex > s.startIndex,
                    );
                    if (!splitSeg) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const x = Math.max(0, Math.min(rect.width - 1, event.clientX - rect.left));
                    scheduleSplitGuide(pickSplitAfterIndex(x, cellWidth, splitSeg.startIndex, splitSeg.endIndex));
                  }}
                >
                  <div
                    className={cn("absolute inset-0", suppressBrowserTouchCallout && "touch-manipulation")}
                    onContextMenu={suppressBrowserTouchCallout ? (e) => e.preventDefault() : undefined}
                    onPointerDown={(event) => {
                      if (
                        splitModeTaskId &&
                        !compareMode &&
                        !dependencyCreateMode &&
                        !dependencyConnectActive &&
                        event.button === 0 &&
                        splitGuideAfterIndex !== null &&
                        onFieldSplitCommit &&
                        row.segments.some((s) => s.taskId === splitModeTaskId)
                      ) {
                        const target = event.target as HTMLElement;
                        if (!target.closest("[data-segment='true']")) {
                          event.preventDefault();
                          onFieldSplitCommit(splitModeTaskId, splitGuideAfterIndex);
                          onExitFieldSplitMode?.();
                          return;
                        }
                      }
                      if (splitModeTaskId || compareMode || dependencyCreateMode || dependencyConnectActive) {
                        return;
                      }
                      const target = event.target as HTMLElement;
                      if (target.dataset.segment === "true") {
                        return;
                      }
                      const element = event.currentTarget;
                      const rect = element.getBoundingClientRect();
                      const x = Math.max(0, Math.min(rect.width - 1, event.clientX - rect.left));
                      const startIndex = Math.max(0, Math.min(range.days.length - 1, Math.floor(x / cellWidth)));

                      if (suppressBrowserTouchCallout) {
                        if (range.days.length === 0 || event.button !== 0) {
                          return;
                        }
                        clearFieldCreateEmptyLongPress();
                        const pointerId = event.pointerId;
                        const startCx = event.clientX;
                        const startCy = event.clientY;

                        if (isIOSTouchDevice()) {
                          const t0 = performance.now();
                          let moveTooFar = false;
                          const cleanup = () => {
                            window.removeEventListener("pointermove", onMoveIos);
                            window.removeEventListener("pointerup", onUpIos);
                            window.removeEventListener("pointercancel", onUpIos);
                          };
                          const onMoveIos = (ev: PointerEvent) => {
                            if (ev.pointerId !== pointerId) {
                              return;
                            }
                            if (Math.hypot(ev.clientX - startCx, ev.clientY - startCy) > FIELD_IOS_EMPTY_TAP_MAX_MOVE_PX) {
                              moveTooFar = true;
                            }
                          };
                          const onUpIos = (ev: PointerEvent) => {
                            if (ev.pointerId !== pointerId) {
                              return;
                            }
                            cleanup();
                            if (moveTooFar || performance.now() - t0 > FIELD_IOS_EMPTY_TAP_MAX_MS) {
                              return;
                            }
                            const days = range.days;
                            const si = startIndex;
                            const ei = Math.min(days.length - 1, si + 2);
                            const startDate = days[si];
                            const endDate = days[ei];
                            if (!startDate || !endDate) {
                              return;
                            }
                            setSegmentContextMenu(null);
                            setMobileEmptyCreateOffer(null);
                            onCreateTask({
                              mainCategory: row.mainCategory,
                              middle1Category: row.middle1Category,
                              middle2Category: row.middle2Category,
                              smallCategory: row.smallCategory,
                              startDate: startDate.toISOString(),
                              endDate: endDate.toISOString(),
                              label: "",
                            });
                          };
                          window.addEventListener("pointermove", onMoveIos, { passive: true });
                          window.addEventListener("pointerup", onUpIos, { passive: true });
                          window.addEventListener("pointercancel", onUpIos, { passive: true });
                          return;
                        }

                        let settled = false;
                        let timerId: number | null = null;
                        const detach = () => {
                          if (settled) {
                            return;
                          }
                          settled = true;
                          if (timerId != null) {
                            window.clearTimeout(timerId);
                            timerId = null;
                          }
                          window.removeEventListener("pointermove", onMove);
                          window.removeEventListener("pointerup", onEnd);
                          window.removeEventListener("pointercancel", onEnd);
                          if (fieldCreateEmptyLongPressDetachRef.current === detach) {
                            fieldCreateEmptyLongPressDetachRef.current = null;
                          }
                        };
                        const onMove = (ev: PointerEvent) => {
                          if (ev.pointerId !== pointerId) {
                            return;
                          }
                          if (Math.hypot(ev.clientX - startCx, ev.clientY - startCy) > FIELD_CREATE_EMPTY_CANCEL_MOVE_PX) {
                            detach();
                          }
                        };
                        const onEnd = (ev: PointerEvent) => {
                          if (ev.pointerId !== pointerId) {
                            return;
                          }
                          detach();
                        };
                        timerId = window.setTimeout(() => {
                          detach();
                          if (typeof navigator !== "undefined" && navigator.vibrate) {
                            navigator.vibrate(12);
                          }
                          setSegmentContextMenu(null);
                          setMobileEmptyCreateOffer({
                            row,
                            startIndex,
                            clientX: startCx,
                            clientY: startCy,
                          });
                        }, FIELD_CREATE_EMPTY_LONG_PRESS_MS);
                        fieldCreateEmptyLongPressDetachRef.current = detach;
                        window.addEventListener("pointermove", onMove, { passive: true });
                        window.addEventListener("pointerup", onEnd, { passive: true });
                        window.addEventListener("pointercancel", onEnd, { passive: true });
                        return;
                      }

                      setCreateDrag({
                        row,
                        element,
                        startIndex,
                        currentIndex: startIndex,
                      });
                    }}
                  >
                    {range.days.map((day, index) => (
                      <div
                        key={`${row.rowId}-${day.toISOString()}`}
                        className={cn(
                          "absolute inset-y-0 border-r border-zinc-200/70 dark:border-zinc-800",
                          getToneClass(day, projectHolidayDayKeys),
                          isToday(day) && "bg-sky-100/50 dark:bg-sky-500/10",
                        )}
                        style={{ left: index * cellWidth, width: cellWidth }}
                      />
                    ))}
                    {createDrag?.row.rowId === row.rowId ? (
                      <div
                        className="absolute inset-y-1 rounded-md border border-sky-500/60 bg-sky-500/12"
                        style={{
                          left: Math.min(createDrag.startIndex, createDrag.currentIndex) * cellWidth + 1,
                          width: (Math.abs(createDrag.currentIndex - createDrag.startIndex) + 1) * cellWidth - 2,
                        }}
                      />
                    ) : null}
                  </div>

                  {row.segments.map((segment) => {
                    const isSelected = selectedTaskIds.includes(segment.taskId);
                    const dependencySourceSelected = activeDependencySourceTaskId === segment.taskId;
                    const dependencyTargetSelected = dependencyConnectTargetTaskId === segment.taskId;
                    const width = (segment.endIndex - segment.startIndex + 1) * cellWidth - 4;
                    const left = segment.startIndex * cellWidth + 2;
                    const top = 4 + segment.lane * 28;
                    const backgroundColor = segment.status === "UNCHANGED" ? `${segment.task.color}22` : undefined;
                    const borderColor = segment.status === "UNCHANGED" ? segment.task.color : undefined;
                    const hasMemo = segment.task.notes?.trim();

                    const canSplitThisSegment = segment.endIndex > segment.startIndex;
                    const splitThisSeg = splitModeTaskId === segment.taskId;
                    const splitOtherSeg = Boolean(splitModeTaskId) && !splitThisSeg;
                    const segMenuLongPressEnabled =
                      enableTouchBarContextMenu &&
                      !compareMode &&
                      !dependencyCreateMode &&
                      !dependencyConnectActive &&
                      !splitOtherSeg &&
                      ((splitThisSeg && canSplitThisSegment) ||
                        (!splitModeTaskId &&
                          (canSplitThisSegment || Boolean(onMergeTimelineSegments) || mobileMergePickActive)));

                    const segmentEl = (
                      <div
                        key={segment.taskId}
                        data-segment="true"
                        data-dependency-task-id={segment.taskId}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          "group absolute flex touch-none select-none items-center overflow-hidden rounded-md border px-2 text-[11px] shadow-sm transition hover:shadow",
                          getSegmentClass(segment.status),
                          dependencySourceSelected && "ring-2 ring-sky-500/45",
                          dependencyTargetSelected && "ring-2 ring-emerald-500/55",
                          isSelected &&
                            !dependencySourceSelected &&
                            !dependencyTargetSelected &&
                            "z-[5] ring-[3px] ring-amber-400 shadow-[0_0_0_1px_rgba(245,158,11,0.5),0_0_12px_rgba(251,191,36,0.4)] dark:ring-amber-300 dark:shadow-[0_0_0_1px_rgba(252,211,77,0.45),0_0_12px_rgba(251,191,36,0.25)]",
                        )}
                        style={{
                          left,
                          top,
                          width,
                          height: 22,
                          backgroundColor,
                          borderColor,
                          color: segment.status === "UNCHANGED" ? segment.task.color : undefined,
                        }}
                        {...(segMenuLongPressEnabled
                          ? {
                              onPointerDownCapture: (e: React.PointerEvent) => {
                                if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
                                if (!e.isPrimary) return;
                                clearSegLongPress();
                                const pid = e.pointerId;
                                const taskId = segment.taskId;
                                const gx = e.clientX;
                                const gy = e.clientY;
                                segLongPressGestureRef.current = { taskId, x: gx, y: gy };

                                const endListen = () => {
                                  window.removeEventListener("pointermove", onMove, true);
                                  window.removeEventListener("pointerup", onEnd, true);
                                  window.removeEventListener("pointercancel", onEnd, true);
                                };

                                const onEnd = (ev: PointerEvent) => {
                                  if (ev.pointerId !== pid) return;
                                  segLongPressPointerCleanupRef.current = null;
                                  endListen();
                                  if (segLongPressTimerRef.current != null) {
                                    window.clearTimeout(segLongPressTimerRef.current);
                                    segLongPressTimerRef.current = null;
                                  }
                                  segLongPressGestureRef.current = null;
                                };

                                const onMove = (ev: PointerEvent) => {
                                  if (ev.pointerId !== pid) return;
                                  const g = segLongPressGestureRef.current;
                                  if (!g || g.taskId !== taskId || segLongPressTimerRef.current == null) return;
                                  if (Math.hypot(ev.clientX - g.x, ev.clientY - g.y) > 22) {
                                    onEnd(ev);
                                  }
                                };

                                window.addEventListener("pointermove", onMove, { capture: true, passive: true });
                                window.addEventListener("pointerup", onEnd, { capture: true });
                                window.addEventListener("pointercancel", onEnd, { capture: true });
                                segLongPressPointerCleanupRef.current = endListen;

                                segLongPressTimerRef.current = window.setTimeout(() => {
                                  segLongPressTimerRef.current = null;
                                  segLongPressPointerCleanupRef.current = null;
                                  endListen();
                                  const g = segLongPressGestureRef.current;
                                  if (!g || g.taskId !== taskId) return;
                                  segLongPressGestureRef.current = null;

                                  onCancelTouchBarDrag?.();
                                  if (suppressBarDragClickRef) {
                                    suppressBarDragClickRef.current = true;
                                  }

                                  if (mobileMergePickActiveRef.current && onMobileMergeLongPressFinishRef.current) {
                                    onMobileMergeLongPressFinishRef.current();
                                    return;
                                  }

                                  const sid = splitModeTaskIdRef.current;
                                  if (sid === taskId && onFieldSplitCommit && canSplitThisSegment) {
                                    const hit = document.elementFromPoint(g.x, g.y);
                                    const rowEl = hit?.closest("[data-field-split-row]") as HTMLElement | null;
                                    if (rowEl) {
                                      const rect = rowEl.getBoundingClientRect();
                                      const x = Math.max(0, Math.min(rect.width - 1, g.x - rect.left));
                                      const afterIdx = pickSplitAfterIndex(
                                        x,
                                        cellWidth,
                                        segment.startIndex,
                                        segment.endIndex,
                                      );
                                      onFieldSplitCommit(taskId, afterIdx);
                                      onExitFieldSplitMode?.();
                                      setSegmentContextMenu(null);
                                    }
                                    return;
                                  }

                                  if (sid) {
                                    return;
                                  }

                                  resolveSegmentLongPress(g.taskId, g.x, g.y, canSplitThisSegment);
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
                          if (compareMode && hasMemo) {
                            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                            setOpenMemoPopup((current) =>
                              current?.taskId === segment.taskId
                                ? null
                                : { taskId: segment.taskId, notes: segment.task.notes ?? "", anchorRect: rect },
                            );
                            return;
                          }
                          if (
                            activeDependencySourceTaskId &&
                            activeDependencySourceTaskId !== segment.taskId &&
                            !compareMode
                          ) {
                            onDependencyTargetSelect(segment.taskId);
                            return;
                          }
                          onSelectTask(segment.taskId, event.shiftKey || event.metaKey || event.ctrlKey);
                        }}
                        onDoubleClick={() => {
                          if (compareMode) {
                            return;
                          }
                          const nextLabel = window.prompt("현장표 문구", segment.displayText);
                          if (nextLabel && nextLabel.trim() && nextLabel.trim() !== segment.displayText) {
                            onUpdateTaskLabel(segment.taskId, nextLabel.trim());
                          }
                        }}
                        onPointerDown={(event) => {
                          if (
                            splitModeTaskId === segment.taskId &&
                            splitGuideAfterIndex !== null &&
                            onFieldSplitCommit &&
                            event.button === 0 &&
                            !compareMode &&
                            !dependencyCreateMode &&
                            !dependencyConnectActive
                          ) {
                            const rowEl = (event.currentTarget as HTMLElement).closest(
                              "[data-field-split-row='true']",
                            ) as HTMLElement | null;
                            if (rowEl) {
                              const rowRect = rowEl.getBoundingClientRect();
                              const xInRow = event.clientX - rowRect.left;
                              const lineX = (splitGuideAfterIndex + 1) * cellWidth;
                              if (Math.abs(xInRow - lineX) <= 14) {
                                event.preventDefault();
                                event.stopPropagation();
                                onFieldSplitCommit(segment.taskId, splitGuideAfterIndex);
                                onExitFieldSplitMode?.();
                                setSegmentContextMenu(null);
                                return;
                              }
                            }
                          }
                          if (splitModeTaskId === segment.taskId) {
                            event.stopPropagation();
                            return;
                          }
                          event.stopPropagation();
                          if (!dependencyCreateMode && !dependencyConnectActive) {
                            onBarPointerDown(segment.taskId, "move", event, cellWidth);
                          }
                        }}
                        onContextMenu={(event) => {
                          if (compareMode || dependencyCreateMode || dependencyConnectActive) return;
                          if (splitModeTaskId === segment.taskId) {
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
                          const canOpenSegmentMenu =
                            Boolean(onMergeTimelineSegments) ||
                            (Boolean(onEnterFieldSplitMode) && segment.endIndex > segment.startIndex);
                          if (!canOpenSegmentMenu) {
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          const { clientX, clientY } = event;
                          const taskId = segment.taskId;
                          requestAnimationFrame(() => {
                            setSegmentContextMenu({
                              taskId,
                              clientX,
                              clientY,
                              canSplit: segment.endIndex > segment.startIndex,
                            });
                          });
                        }}
                      >
                        {!compareMode ? (
                          <button
                            type="button"
                            data-segment="true"
                            className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize touch-none"
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              if (splitModeTaskId === segment.taskId) return;
                              if (!dependencyCreateMode && !dependencyConnectActive) {
                                onBarPointerDown(segment.taskId, "start", event, cellWidth);
                              }
                            }}
                          />
                        ) : null}
                        <span className="truncate font-medium">{segment.displayText}</span>
                        {!compareMode ? (
                          <button
                            type="button"
                            data-segment="true"
                            className={cn(
                              "absolute -right-3 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border bg-white text-zinc-700 shadow transition hover:bg-sky-50 hover:text-sky-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-sky-950/40",
                              dependencyCreateMode || dependencyConnectActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                              dependencySourceSelected && "border-sky-500 text-sky-700 ring-2 ring-sky-500/35",
                              dependencyTargetSelected && "border-emerald-500 text-emerald-700 ring-2 ring-emerald-500/35",
                            )}
                            title="드래그해 연결"
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onDependencyConnectStart(segment.taskId, event.clientX, event.clientY);
                            }}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (dependencyCreateMode) {
                                onDependencySourceSelect(segment.taskId);
                              }
                            }}
                          >
                            <ArrowRight className="size-3" />
                          </button>
                        ) : null}
                        {!compareMode ? (
                          <button
                            type="button"
                            data-segment="true"
                            className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize touch-none"
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              if (splitModeTaskId === segment.taskId) return;
                              if (!dependencyCreateMode && !dependencyConnectActive) {
                                onBarPointerDown(segment.taskId, "end", event, cellWidth);
                              }
                            }}
                          />
                        ) : null}
                      </div>
                    );

                    return <React.Fragment key={segment.taskId}>{segmentEl}</React.Fragment>;
                  })}
                  {splitModeTaskId &&
                  row.segments.some((s) => s.taskId === splitModeTaskId && s.endIndex > s.startIndex) &&
                  splitGuideAfterIndex !== null ? (
                    <>
                      <div
                        className="pointer-events-none absolute inset-y-1 z-[25] w-px -translate-x-1/2 bg-sky-500 shadow-[0_0_6px_rgba(14,165,233,0.85)]"
                        style={{ left: (splitGuideAfterIndex + 1) * cellWidth }}
                        aria-hidden
                      />
                      <button
                        type="button"
                        aria-label="이 날짜에서 나누기"
                        title="왼쪽 클릭으로 이 위치에서 나눕니다"
                        className="absolute inset-y-1 z-[30] w-5 -translate-x-1/2 cursor-pointer border-0 bg-transparent p-0"
                        style={{ left: (splitGuideAfterIndex + 1) * cellWidth }}
                        onPointerDown={(event) => {
                          if (event.button !== 0 || !onFieldSplitCommit || !splitModeTaskId) return;
                          event.preventDefault();
                          event.stopPropagation();
                          onFieldSplitCommit(splitModeTaskId, splitGuideAfterIndex);
                          onExitFieldSplitMode?.();
                        }}
                      />
                    </>
                  ) : null}
                </div>
              </div>
            ))}

            {holidayLabelSegments.length > 0 && rows.length > 0 ? (
              <div
                className="pointer-events-none absolute left-0 top-0 z-[12]"
                style={{
                  left: categoryWidth,
                  width: timelineWidth,
                  height: fieldScheduleBodyHeight,
                }}
                aria-hidden
              >
                {holidayLabelSegments.map((seg, idx) => {
                  const left = seg.startIndex * cellWidth;
                  const spanW = (seg.endIndex - seg.startIndex + 1) * cellWidth;
                  return (
                    <div
                      key={`field-hol-body-${idx}-${seg.startIndex}`}
                      className="absolute top-0 flex items-center justify-center overflow-visible"
                      style={{ left, width: spanW, height: "100%" }}
                    >
                      <FieldHolidayColumnLabel text={seg.label} />
                    </div>
                  );
                })}
              </div>
            ) : null}

            {rows.length === 0 ? (
              <div className="flex items-center justify-center px-6 py-10 text-sm text-zinc-500 dark:text-zinc-400">
                표시할 현장 공정표 데이터가 없습니다.
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {mobileEmptyCreateOffer &&
        fieldMobileEmptyCreatePopoverStyle &&
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
              style={{ left: fieldMobileEmptyCreatePopoverStyle.left, top: fieldMobileEmptyCreatePopoverStyle.top }}
            >
              <p className="px-1 pb-2 text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">빈 칸에서 작업을 추가합니다.</p>
              <button
                type="button"
                className="w-full rounded-lg bg-sky-600 px-3 py-2.5 text-left text-[14px] font-semibold text-white hover:bg-sky-700 active:bg-sky-800"
                onClick={() => {
                  const offer = mobileEmptyCreateOffer;
                  if (!offer || range.days.length === 0) {
                    setMobileEmptyCreateOffer(null);
                    return;
                  }
                  const si = offer.startIndex;
                  const ei = Math.min(range.days.length - 1, si + 2);
                  const startDate = range.days[si];
                  const endDate = range.days[ei];
                  if (!startDate || !endDate) {
                    setMobileEmptyCreateOffer(null);
                    return;
                  }
                  onCreateTask({
                    mainCategory: offer.row.mainCategory,
                    middle1Category: offer.row.middle1Category,
                    middle2Category: offer.row.middle2Category,
                    smallCategory: offer.row.smallCategory,
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString(),
                    label: "",
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
      {compareMode &&
        openMemoPopup &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={memoBalloonRef}
            className="fixed z-[100] max-w-[260px] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[11px] text-zinc-700 shadow-lg dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            style={{
              left: openMemoPopup.anchorRect.left,
              top: openMemoPopup.anchorRect.top - 8,
              transform: "translateY(-100%)",
              width: Math.max(openMemoPopup.anchorRect.width, 120),
            }}
          >
            <p className="whitespace-pre-wrap text-left">{openMemoPopup.notes}</p>
          </div>,
          document.body,
        )}
      {segmentContextMenu &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={segmentContextMenuRef}
            data-field-split-menu
            className="fixed z-[110] min-w-[168px] overflow-hidden rounded-md border border-zinc-200 bg-white py-0.5 text-[13px] shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
            style={{ left: segmentContextMenu.clientX, top: segmentContextMenu.clientY }}
          >
            {!compareMode && onEnterFieldSplitMode && segmentContextMenu.canSplit ? (
              <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title="파란 줄 위를 왼쪽 클릭으로 확정 · Esc / Ctrl+B 취소"
                onClick={() => {
                  onEnterFieldSplitMode(segmentContextMenu.taskId);
                  setSegmentContextMenu(null);
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
                  onEnterFieldSplitMode &&
                    segmentContextMenu.canSplit &&
                    "border-t border-zinc-200 dark:border-zinc-700",
                )}
                title={
                  enableTouchBarContextMenu
                    ? "모바일: 첫 합치기 후 막대를 더 눌러 고르고, 다시 우클릭·꾹 눌러 완료. PC: Shift로 여러 개 고른 뒤 합치기 한 번이면 바로 합쳐짐"
                    : "Shift로 같은 작업의 막대를 여러 개 선택한 뒤 합치기 (선택 부족 시에만 고르기 모드)"
                }
                onClick={() => {
                  onMergeTimelineSegments();
                  setSegmentContextMenu(null);
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
