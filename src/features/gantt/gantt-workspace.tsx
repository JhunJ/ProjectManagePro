"use client";

import * as React from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  CalendarDays,
  ChevronDown,
  Filter,
  GitCompareArrows,
  Minimize2,
  Maximize2,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  SidebarClose,
  SidebarOpen,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SuggestionInput } from "@/components/ui/suggestion-input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { inferDependencyFromTaskDates } from "@/lib/infer-dependency";
import {
  isSiteDisplayTextManual,
  resolveActivityName,
  resolveSiteDisplayText,
  toStoredSiteDisplayText,
} from "@/lib/site-display-text";
import {
  buildFieldScheduleRows,
  collectFieldMiddle1Categories,
  collectFieldMiddle2Categories,
  collectFieldSmallCategories,
  collectSiteMainCategories,
} from "@/features/field-schedule/field-schedule";
import { FieldSchedulePanel } from "@/features/field-schedule/field-schedule-panel";
import { moveTaskByBusinessDays, resizeTaskByBusinessDays } from "@/features/gantt/drag-utils";
import { canMergeSelectedTimelineTasks, planTimelineMerge } from "@/features/gantt/merge-timeline-segments";
import { resolveSplitTaskDates, shiftOverlappingTimelineSegments } from "@/features/gantt/split-task-schedule";
import { TaskGridPanel } from "@/features/gantt/task-grid-panel";
import { getGanttAvgDayPixelWidth } from "@/features/gantt/gantt-timeline-layout";
import {
  extendTimelineRangeByCalendarDays,
  getTimelineCellWidth,
  getTimelineDayKey,
  getTimelineRange,
} from "@/features/gantt/timeline";
import { TimelinePanel } from "@/features/gantt/timeline-panel";
import {
  useProjectMutations,
  useProjectVersionCompareQuery,
  useProjectVersionsQuery,
} from "@/features/projects/hooks";
import { TaskDetailPanel } from "@/features/tasks/task-detail-panel";
import {
  buildVisibleTaskList,
  collectCategoryRowIds,
  collectAssignees,
  collectMajorCategories,
  collectMiddle1Categories,
  collectMiddle2Categories,
  collectSmallCategories,
  moveRowBlock,
  moveTaskInArray,
} from "@/features/tasks/task-tree";
import {
  DEFAULT_WORKING_CALENDAR,
  shiftToNearestWorkingDay,
} from "@/server/schedulers/business-days";
import { useGanttStore } from "@/stores/gantt-store";
import type {
  DependencyType,
  DependencyModel,
  ProjectSchedulePayload,
  TaskCompareItem,
  TaskListRow,
  TaskModel,
  WorkingCalendarModel,
} from "@/types/domain";

type DragMode = "move" | "start" | "end";

interface DragState {
  taskId: string;
  mode: DragMode;
  startX: number;
  cellWidth: number;
  initialTask: TaskModel;
}

interface Props {
  projectId: string;
  initialSchedule: ProjectSchedulePayload;
  onRefetch: () => Promise<unknown>;
  readOnlyMode?: boolean;
}

const PANEL_STORAGE_KEY = "pmp:task-panel-width";
const TASK_PANEL_MIN_WIDTH = 460;
const TIMELINE_MIN_WIDTH = 460;
const DETAIL_PANEL_WIDTH = 340;
const SPLITTER_WIDTH = 8;
/** 모바일 간트: 스크롤 끝에 도달할 때 타임라인을 한 번에 늘리는 달력 일수 */
const MOBILE_GANTT_EDGE_PAN_CHUNK_DAYS = 35;

interface TaskCreateDraft {
  activityName: string;
  categoryMajor: string;
  categoryMiddle1: string;
  categoryMiddle2: string;
  categorySmall: string;
  siteMainCategory: string;
  siteDisplayText: string;
  siteDisplayTextManual: boolean;
  companyName: string;
  assignee: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  color: string;
  isMilestone: boolean;
  progress: number;
}

interface DependencyDraft {
  predecessorTaskId: string;
  successorTaskId: string;
  type: DependencyType;
  mode: "lag" | "lead";
  offsetDays: number;
  /** true면 연결 후 스케줄 재계산, false면 연결만 추가 */
  drivesSchedule: boolean;
}

interface DependencyConnectState {
  sourceTaskId: string;
  sourceClientX: number;
  sourceClientY: number;
  currentClientX: number;
  currentClientY: number;
  hoveredTaskId: string | null;
}

function toDateInputValue(date: Date | string) {
  return new Date(date).toISOString().slice(0, 10);
}

function toIsoDay(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function addDaysToDateString(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getDurationDays(startStr: string, endStr: string) {
  const start = new Date(`${startStr}T00:00:00.000Z`).getTime();
  const end = new Date(`${endStr}T00:00:00.000Z`).getTime();
  return Math.max(1, Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1);
}

function findDayIndexInRange(
  rangeDays: Date[],
  date: Date | string,
  mode: "floor" | "ceil" | "exact",
): number | null {
  if (rangeDays.length === 0) return null;
  const key = getTimelineDayKey(date);
  const dayIndexByKey = new Map(rangeDays.map((d, i) => [getTimelineDayKey(d), i]));
  const direct = dayIndexByKey.get(key);
  if (direct !== undefined) return direct;
  if (mode === "exact") return null;
  const dayTimestamps = rangeDays.map((d) => d.getTime());
  const target = new Date(`${key}T00:00:00.000Z`).getTime();
  let left = 0;
  let right = rangeDays.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (dayTimestamps[mid] < target) left = mid + 1;
    else right = mid;
  }
  if (mode === "ceil") {
    return left >= dayTimestamps.length ? dayTimestamps.length - 1 : left;
  }
  return left <= 0 ? 0 : left - 1;
}

function getTaskSpanOnRangeDays(task: TaskModel, rangeDays: Date[]) {
  if (task.isMilestone || rangeDays.length === 0) return null;
  const startIndex = findDayIndexInRange(rangeDays, task.startDate, "ceil");
  const endIndex = findDayIndexInRange(rangeDays, task.endDate, "floor");
  if (startIndex === null || endIndex === null || startIndex > endIndex) return null;
  return { startIndex, endIndex };
}

function normalizeText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLookupText(value: string) {
  return value.trim().toLocaleLowerCase("ko-KR");
}

const TASK_COLOR_PALETTE = [
  "#2563EB",
  "#0F766E",
  "#DC2626",
  "#D97706",
  "#7C3AED",
  "#0891B2",
  "#65A30D",
  "#C026D3",
  "#4F46E5",
  "#EA580C",
  "#059669",
  "#BE123C",
];

function getSuggestedTaskColor(tasks: TaskModel[], excludedColor?: string | null) {
  const usageCount = new Map<string, number>();

  for (const task of tasks) {
    const normalized = task.color.toUpperCase();
    usageCount.set(normalized, (usageCount.get(normalized) ?? 0) + 1);
  }

  const excluded = excludedColor?.toUpperCase() ?? null;
  const unusedColor = TASK_COLOR_PALETTE.find(
    (color) => color.toUpperCase() !== excluded && !usageCount.has(color.toUpperCase()),
  );
  if (unusedColor) {
    return unusedColor;
  }

  return TASK_COLOR_PALETTE.slice()
    .filter((color) => color.toUpperCase() !== excluded)
    .sort((left, right) => {
      const countDiff = (usageCount.get(left.toUpperCase()) ?? 0) - (usageCount.get(right.toUpperCase()) ?? 0);
      if (countDiff !== 0) {
        return countDiff;
      }
      return left.localeCompare(right);
    })[0] ?? TASK_COLOR_PALETTE[0];
}

export function GanttWorkspace({ projectId, initialSchedule, onRefetch, readOnlyMode = false }: Props) {
  const mutations = useProjectMutations(projectId);
  const {
    zoomLevel,
    setZoomLevel,
    plannerViewMode,
    setPlannerViewMode,
    fieldScheduleScale,
    setFieldScheduleScale,
    fieldAnchorDate,
    setFieldAnchorDate,
    selectedTaskIds,
    activeTaskId,
    setActiveTaskId,
    setSelectedTaskIds,
    setExpandedTaskIds,
    expandedTaskIds,
    toggleExpanded,
    sidePanelOpen,
    setSidePanelOpen,
    compareEnabled,
    selectedPlanVersionId,
    selectedActualVersionId,
    compareVisualization,
    compareResult,
    setCompareEnabled,
    setSelectedPlanVersionId,
    setSelectedActualVersionId,
    setCompareVisualization,
    setCompareResult,
    filters,
    updateFilter,
    timelineVisibility,
    updateTimelineVisibility,
    pushHistory,
    undo,
    redo,
    setSavingState,
  } = useGanttStore(
    useShallow((state) => ({
      zoomLevel: state.zoomLevel,
      setZoomLevel: state.setZoomLevel,
      plannerViewMode: state.plannerViewMode,
      setPlannerViewMode: state.setPlannerViewMode,
      fieldScheduleScale: state.fieldScheduleScale,
      setFieldScheduleScale: state.setFieldScheduleScale,
      fieldAnchorDate: state.fieldAnchorDate,
      setFieldAnchorDate: state.setFieldAnchorDate,
      selectedTaskIds: state.selectedTaskIds,
      activeTaskId: state.activeTaskId,
      setActiveTaskId: state.setActiveTaskId,
      setSelectedTaskIds: state.setSelectedTaskIds,
      setExpandedTaskIds: state.setExpandedTaskIds,
      expandedTaskIds: state.expandedTaskIds,
      toggleExpanded: state.toggleExpanded,
      sidePanelOpen: state.sidePanelOpen,
      setSidePanelOpen: state.setSidePanelOpen,
      compareEnabled: state.compareEnabled,
      selectedPlanVersionId: state.selectedPlanVersionId,
      selectedActualVersionId: state.selectedActualVersionId,
      compareVisualization: state.compareVisualization,
      compareResult: state.compareResult,
      setCompareEnabled: state.setCompareEnabled,
      setSelectedPlanVersionId: state.setSelectedPlanVersionId,
      setSelectedActualVersionId: state.setSelectedActualVersionId,
      setCompareVisualization: state.setCompareVisualization,
      setCompareResult: state.setCompareResult,
      filters: state.filters,
      updateFilter: state.updateFilter,
      timelineVisibility: state.timelineVisibility,
      updateTimelineVisibility: state.updateTimelineVisibility,
      pushHistory: state.pushHistory,
      undo: state.undo,
      redo: state.redo,
      setSavingState: state.setSavingState,
    })),
  );

  const [tasks, setTasks] = React.useState<TaskModel[]>(initialSchedule.tasks);
  const [dependencies, setDependencies] = React.useState<DependencyModel[]>(initialSchedule.dependencies);
  const [companies, setCompanies] = React.useState(initialSchedule.companies);
  const [holidays, setHolidays] = React.useState(initialSchedule.holidays);
  const [calendar, setCalendar] = React.useState<WorkingCalendarModel>(
    initialSchedule.calendar ??
      ({ id: "", projectId, ...DEFAULT_WORKING_CALENDAR, createdAt: "", updatedAt: "" } as WorkingCalendarModel),
  );
  const [dragState, setDragState] = React.useState<DragState | null>(null);
  const barDragCaptureRef = React.useRef<{ el: Element; pointerId: number } | null>(null);
  const touchBarDragCleanupRef = React.useRef<(() => void) | null>(null);
  const substantiveBarDragMoveRef = React.useRef(false);
  const suppressNextBarDragClickRef = React.useRef(false);
  const [taskPanelWidth, setTaskPanelWidth] = React.useState(520);
  const [taskPanelOpen, setTaskPanelOpen] = React.useState(true);
  const [isPanelResizing, setIsPanelResizing] = React.useState(false);
  const [calendarVisibilityOpen, setCalendarVisibilityOpen] = React.useState(false);
  const [majorFilterOpen, setMajorFilterOpen] = React.useState(false);
  const [siteMainFilterOpen, setSiteMainFilterOpen] = React.useState(false);
  const [middle1FilterOpen, setMiddle1FilterOpen] = React.useState(false);
  const [middle2FilterOpen, setMiddle2FilterOpen] = React.useState(false);
  const [smallFilterOpen, setSmallFilterOpen] = React.useState(false);
  const [taskCreateDialogOpen, setTaskCreateDialogOpen] = React.useState(false);
  const [taskCreateDraft, setTaskCreateDraft] = React.useState<TaskCreateDraft | null>(null);
  const [pendingDependencySourceTaskId, setPendingDependencySourceTaskId] = React.useState<string | null>(null);
  const [dependencyConnectState, setDependencyConnectState] = React.useState<DependencyConnectState | null>(null);
  const [dependencyDialogOpen, setDependencyDialogOpen] = React.useState(false);
  const [dependencyDraft, setDependencyDraft] = React.useState<DependencyDraft>({
    predecessorTaskId: "",
    successorTaskId: "",
    type: "FS",
    mode: "lag",
    offsetDays: 0,
    drivesSchedule: false,
  });
  const [scheduleFullscreen, setScheduleFullscreen] = React.useState(false);
  const [cascadeScheduleOnMove, setCascadeScheduleOnMove] = React.useState(true);
  const cascadeScheduleOnMoveRef = React.useRef(cascadeScheduleOnMove);
  cascadeScheduleOnMoveRef.current = cascadeScheduleOnMove;
  const [dependencyLineStrokeWidth, setDependencyLineStrokeWidth] = React.useState(1.2);
  const [dependencyLineColor, setDependencyLineColor] = React.useState("rgba(59,130,246,0.88)");
  const [mobileFilterOpen, setMobileFilterOpen] = React.useState(false);
  /** lg 이상: 조건·빠른 작업(가운데 툴바) 접기 — 좁은 화면은 mobileFilterOpen 사용 */
  const [plannerToolbarOpen, setPlannerToolbarOpen] = React.useState(false);
  /** 모바일 간트: 스크롤 끝에서 타임라인을 달력 일 단위로 이어 붙임 */
  const [ganttTimelineExtraScroll, setGanttTimelineExtraScroll] = React.useState({ past: 0, future: 0 });
  const [isMobile, setIsMobile] = React.useState(false);
  /** lg 미만: 상세 설정 접기/펼치기, 상단 줌·작업 생성 등 터치형 툴바(태블릿·폰 공통) */
  const [isNarrowPlanner, setIsNarrowPlanner] = React.useState(false);
  /** 폰 가로·소형 태블릿 등 (639 초과)에서도 스케줄이 가리지 않도록, 패널 자동 접기는 lg 미만 전체에 적용 */
  const prevNarrowPlannerRef = React.useRef<boolean | null>(null);
  /** 모바일: 합치기 대상 막대 고르는 중 */
  const [mobileMergePickMode, setMobileMergePickMode] = React.useState(false);
  /** 세로 좁은 화면: 분류·현장표 옵션을 접기/펼치기로 노출 */
  const [isMobilePortrait, setIsMobilePortrait] = React.useState(false);
  const [mobileGanttCategoryOpen, setMobileGanttCategoryOpen] = React.useState(false);
  React.useLayoutEffect(() => {
    const mq = window.matchMedia("(max-width: 639px) and (orientation: portrait)");
    const apply = () => setIsMobilePortrait(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /** 좁은 화면(lg 미만) 진입 시에만 목록·상세 접기 + 주 단위 줌. isMobile(639px)은 터치 UI용으로 별도 유지 */
  React.useLayoutEffect(() => {
    const mNarrow = window.matchMedia("(max-width: 1023px)");
    const mMobileUi = window.matchMedia("(max-width: 639px)");
    const apply = () => {
      const narrowPlanner = mNarrow.matches;
      setIsNarrowPlanner(narrowPlanner);
      setIsMobile(mMobileUi.matches);
      const prev = prevNarrowPlannerRef.current;
      if (narrowPlanner && prev !== true) {
        setTaskPanelOpen(false);
        setSidePanelOpen(false);
        setZoomLevel("week");
      }
      prevNarrowPlannerRef.current = narrowPlanner;
    };
    apply();
    mNarrow.addEventListener("change", apply);
    mMobileUi.addEventListener("change", apply);
    return () => {
      mNarrow.removeEventListener("change", apply);
      mMobileUi.removeEventListener("change", apply);
    };
  }, [setSidePanelOpen, setZoomLevel]);

  React.useEffect(() => {
    setGanttTimelineExtraScroll({ past: 0, future: 0 });
  }, [projectId, zoomLevel]);

  const tasksRef = React.useRef(tasks);
  const dependenciesRef = React.useRef(dependencies);
  const visibleRowsRef = React.useRef<TaskListRow[]>([]);
  const pendingTaskPatchesRef = React.useRef(new Map<string, Partial<TaskModel>>());
  const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const didInitPanelWidthRef = React.useRef(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const calendarVisibilityRef = React.useRef<HTMLDivElement>(null);
  const majorFilterRef = React.useRef<HTMLDivElement>(null);
  const siteMainFilterRef = React.useRef<HTMLDivElement>(null);
  const middle1FilterRef = React.useRef<HTMLDivElement>(null);
  const middle2FilterRef = React.useRef<HTMLDivElement>(null);
  const smallFilterRef = React.useRef<HTMLDivElement>(null);
  const leftScrollRef = React.useRef<HTMLDivElement>(null);
  const rightScrollRef = React.useRef<HTMLDivElement>(null);
  const headerScrollRef = React.useRef<HTMLDivElement>(null);
  const syncingRef = React.useRef<"left" | "right" | null>(null);
  const prevCategoryRowIdsRef = React.useRef<string[]>([]);
  const dependencyConnectStateRef = React.useRef<DependencyConnectState | null>(null);
  React.useEffect(() => {
    dependencyConnectStateRef.current = dependencyConnectState;
  }, [dependencyConnectState]);
  const [activityOnlyView, setActivityOnlyView] = React.useState(false);
  const [showFieldMainCategory, setShowFieldMainCategory] = React.useState(true);
  const [showFieldMiddle1Category, setShowFieldMiddle1Category] = React.useState(true);
  const [showFieldMiddle2Category, setShowFieldMiddle2Category] = React.useState(true);
  const [showFieldSmallCategory, setShowFieldSmallCategory] = React.useState(true);
  const [showGanttMajorCategory, setShowGanttMajorCategory] = React.useState(true);
  const [showGanttMiddle1Category, setShowGanttMiddle1Category] = React.useState(true);
  const [showGanttMiddle2Category, setShowGanttMiddle2Category] = React.useState(true);
  const [showGanttSmallCategory, setShowGanttSmallCategory] = React.useState(true);
  /** localStorage에서 분류 열 토글을 읽기 전에는 저장하지 않음(초기 true가 저장값을 덮어쓰는 레이스 방지) */
  const [categoryPrefsHydrated, setCategoryPrefsHydrated] = React.useState(false);
  const [fieldSplitTaskId, setFieldSplitTaskId] = React.useState<string | null>(null);
  const viewModeStorageKey = React.useMemo(() => `pmp:view-mode:${projectId}`, [projectId]);
  const fieldScaleStorageKey = React.useMemo(() => `pmp:field-scale:${projectId}`, [projectId]);
  const fieldAnchorStorageKey = React.useMemo(() => `pmp:field-anchor:${projectId}`, [projectId]);
  const fieldMainStorageKey = React.useMemo(() => `pmp:field-main:${projectId}`, [projectId]);
  const fieldMiddle1StorageKey = React.useMemo(() => `pmp:field-middle1:${projectId}`, [projectId]);
  const fieldMiddle2StorageKey = React.useMemo(() => `pmp:field-middle2:${projectId}`, [projectId]);
  const fieldSmallStorageKey = React.useMemo(() => `pmp:field-small:${projectId}`, [projectId]);
  const ganttCatMajorStorageKey = React.useMemo(() => `pmp:gantt-cat-major:${projectId}`, [projectId]);
  const ganttCatM1StorageKey = React.useMemo(() => `pmp:gantt-cat-m1:${projectId}`, [projectId]);
  const ganttCatM2StorageKey = React.useMemo(() => `pmp:gantt-cat-m2:${projectId}`, [projectId]);
  const ganttCatSmallStorageKey = React.useMemo(() => `pmp:gantt-cat-small:${projectId}`, [projectId]);

  React.useLayoutEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const narrowPhone = window.matchMedia("(max-width: 639px)").matches;
    const read = (key: string): boolean | null => {
      const v = window.localStorage.getItem(key);
      if (v === "false") {
        return false;
      }
      if (v === "true") {
        return true;
      }
      return null;
    };
    const readBool = (key: string) => {
      const v = read(key);
      if (v !== null) {
        return v;
      }
      return narrowPhone ? false : true;
    };

    setShowFieldMainCategory(readBool(fieldMainStorageKey));
    setShowFieldMiddle1Category(readBool(fieldMiddle1StorageKey));
    setShowFieldMiddle2Category(readBool(fieldMiddle2StorageKey));
    setShowFieldSmallCategory(readBool(fieldSmallStorageKey));
    setShowGanttMajorCategory(readBool(ganttCatMajorStorageKey));
    setShowGanttMiddle1Category(readBool(ganttCatM1StorageKey));
    setShowGanttMiddle2Category(readBool(ganttCatM2StorageKey));
    setShowGanttSmallCategory(readBool(ganttCatSmallStorageKey));
    setCategoryPrefsHydrated(true);
  }, [
    fieldMainStorageKey,
    fieldMiddle1StorageKey,
    fieldMiddle2StorageKey,
    fieldSmallStorageKey,
    ganttCatMajorStorageKey,
    ganttCatM1StorageKey,
    ganttCatM2StorageKey,
    ganttCatSmallStorageKey,
  ]);

  const holidayDayKeysByTaskId = React.useMemo(() => {
    const projectHolidayKeys = new Set<string>();
    const companyHolidayKeys = new Map<string, Set<string>>();

    const addRange = (target: Set<string>, startIso: string, endIso: string) => {
      const start = new Date(startIso);
      const end = new Date(endIso);
      const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
      const finish = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
      while (current.getTime() <= finish.getTime()) {
        target.add(current.toISOString().slice(0, 10));
        current.setUTCDate(current.getUTCDate() + 1);
      }
    };

    for (const holiday of holidays) {
      if (holiday.scope === "PROJECT") {
        addRange(projectHolidayKeys, holiday.startDate, holiday.endDate);
      } else if (holiday.scope === "COMPANY" && holiday.companyId) {
        const set = companyHolidayKeys.get(holiday.companyId) ?? new Set<string>();
        addRange(set, holiday.startDate, holiday.endDate);
        companyHolidayKeys.set(holiday.companyId, set);
      }
    }

    const byTask = new Map<string, Set<string>>();
    for (const task of tasks) {
      const merged = new Set<string>();
      for (const key of projectHolidayKeys) merged.add(key);
      if (task.companyId) {
        const companySet = companyHolidayKeys.get(task.companyId);
        if (companySet) {
          for (const key of companySet) merged.add(key);
        }
      }
      byTask.set(task.id, merged);
    }
    return byTask;
  }, [holidays, tasks]);

  const timelineProjectHolidayDayKeys = React.useMemo(() => {
    const result = new Set<string>();
    for (const holiday of holidays) {
      if (holiday.scope !== "PROJECT") {
        continue;
      }
      const start = new Date(holiday.startDate);
      const end = new Date(holiday.endDate);
      const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
      const finish = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
      while (current.getTime() <= finish.getTime()) {
        result.add(current.toISOString().slice(0, 10));
        current.setUTCDate(current.getUTCDate() + 1);
      }
    }
    return result;
  }, [holidays]);

  const projectHolidaysForLabels = React.useMemo(
    () => holidays.filter((holiday) => holiday.scope === "PROJECT"),
    [holidays],
  );

  const clampTaskPanelWidth = React.useCallback(
    (nextWidth: number) => {
      const containerWidth = containerRef.current?.clientWidth ?? 0;
      if (!containerWidth) {
        return Math.max(TASK_PANEL_MIN_WIDTH, Math.round(nextWidth));
      }

      const sidePanelReserved = sidePanelOpen ? DETAIL_PANEL_WIDTH : 0;
      const splitterReserved = taskPanelOpen ? SPLITTER_WIDTH : 0;
      const availableCenterWidth = containerWidth - sidePanelReserved - splitterReserved;
      const maxWidth = Math.max(TASK_PANEL_MIN_WIDTH, availableCenterWidth - TIMELINE_MIN_WIDTH);
      const minWidth = Math.min(TASK_PANEL_MIN_WIDTH, maxWidth);

      return Math.round(Math.min(maxWidth, Math.max(minWidth, nextWidth)));
    },
    [sidePanelOpen, taskPanelOpen],
  );
  const { data: versions = [] } = useProjectVersionsQuery(projectId);
  const planVersions = React.useMemo(
    () => versions.filter((version) => version.versionType === "PLAN"),
    [versions],
  );
  const actualVersions = React.useMemo(
    () => versions.filter((version) => version.versionType === "ACTUAL"),
    [versions],
  );
  const compareQuery = useProjectVersionCompareQuery(
    projectId,
    selectedPlanVersionId,
    selectedActualVersionId,
    compareEnabled,
  );

  React.useEffect(() => {
    if (didInitPanelWidthRef.current) {
      return;
    }

    const containerWidth = containerRef.current?.clientWidth;
    if (!containerWidth) {
      return;
    }

    let nextWidth = containerWidth * 0.42;
    const savedWidth = Number(window.localStorage.getItem(PANEL_STORAGE_KEY));
    if (Number.isFinite(savedWidth) && savedWidth >= TASK_PANEL_MIN_WIDTH) {
      nextWidth = savedWidth;
    }

    setTaskPanelWidth(clampTaskPanelWidth(nextWidth));
    didInitPanelWidthRef.current = true;
  }, [clampTaskPanelWidth]);

  React.useEffect(() => {
    if (!didInitPanelWidthRef.current) return;
    setTaskPanelWidth((prev) => clampTaskPanelWidth(prev));
  }, [clampTaskPanelWidth, sidePanelOpen, taskPanelOpen]);

  React.useEffect(() => {
    if (!didInitPanelWidthRef.current) return;

    const onResize = () => {
      setTaskPanelWidth((prev) => clampTaskPanelWidth(prev));
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampTaskPanelWidth]);

  React.useEffect(() => {
    if (!didInitPanelWidthRef.current) return;
    window.localStorage.setItem(PANEL_STORAGE_KEY, String(taskPanelWidth));
  }, [taskPanelWidth]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedViewMode = window.localStorage.getItem(viewModeStorageKey);
    if (storedViewMode === "GANTT" || storedViewMode === "FIELD") {
      setPlannerViewMode(storedViewMode);
    }

    const storedScale = window.localStorage.getItem(fieldScaleStorageKey);
    if (storedScale === "WEEKLY" || storedScale === "MONTHLY") {
      setFieldScheduleScale(storedScale);
    }

    const storedAnchorDate = window.localStorage.getItem(fieldAnchorStorageKey);
    if (storedAnchorDate) {
      setFieldAnchorDate(storedAnchorDate);
    } else {
      setFieldAnchorDate(new Date().toISOString());
    }

  }, [
    fieldAnchorStorageKey,
    fieldScaleStorageKey,
    setFieldAnchorDate,
    setFieldScheduleScale,
    setPlannerViewMode,
    viewModeStorageKey,
  ]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(viewModeStorageKey, plannerViewMode);
  }, [plannerViewMode, viewModeStorageKey]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(fieldScaleStorageKey, fieldScheduleScale);
  }, [fieldScheduleScale, fieldScaleStorageKey]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(fieldAnchorStorageKey, fieldAnchorDate);
  }, [fieldAnchorDate, fieldAnchorStorageKey]);

  React.useEffect(() => {
    if (typeof window === "undefined" || !categoryPrefsHydrated) {
      return;
    }
    window.localStorage.setItem(fieldMainStorageKey, String(showFieldMainCategory));
  }, [categoryPrefsHydrated, fieldMainStorageKey, showFieldMainCategory]);

  React.useEffect(() => {
    if (typeof window === "undefined" || !categoryPrefsHydrated) {
      return;
    }
    window.localStorage.setItem(fieldMiddle1StorageKey, String(showFieldMiddle1Category));
  }, [categoryPrefsHydrated, fieldMiddle1StorageKey, showFieldMiddle1Category]);

  React.useEffect(() => {
    if (typeof window === "undefined" || !categoryPrefsHydrated) {
      return;
    }
    window.localStorage.setItem(fieldMiddle2StorageKey, String(showFieldMiddle2Category));
  }, [categoryPrefsHydrated, fieldMiddle2StorageKey, showFieldMiddle2Category]);

  React.useEffect(() => {
    if (typeof window === "undefined" || !categoryPrefsHydrated) {
      return;
    }
    window.localStorage.setItem(fieldSmallStorageKey, String(showFieldSmallCategory));
  }, [categoryPrefsHydrated, fieldSmallStorageKey, showFieldSmallCategory]);

  React.useEffect(() => {
    if (typeof window === "undefined" || !categoryPrefsHydrated) {
      return;
    }
    window.localStorage.setItem(ganttCatMajorStorageKey, String(showGanttMajorCategory));
  }, [categoryPrefsHydrated, ganttCatMajorStorageKey, showGanttMajorCategory]);

  React.useEffect(() => {
    if (typeof window === "undefined" || !categoryPrefsHydrated) {
      return;
    }
    window.localStorage.setItem(ganttCatM1StorageKey, String(showGanttMiddle1Category));
  }, [categoryPrefsHydrated, ganttCatM1StorageKey, showGanttMiddle1Category]);

  React.useEffect(() => {
    if (typeof window === "undefined" || !categoryPrefsHydrated) {
      return;
    }
    window.localStorage.setItem(ganttCatM2StorageKey, String(showGanttMiddle2Category));
  }, [categoryPrefsHydrated, ganttCatM2StorageKey, showGanttMiddle2Category]);

  React.useEffect(() => {
    if (typeof window === "undefined" || !categoryPrefsHydrated) {
      return;
    }
    window.localStorage.setItem(ganttCatSmallStorageKey, String(showGanttSmallCategory));
  }, [categoryPrefsHydrated, ganttCatSmallStorageKey, showGanttSmallCategory]);

  React.useEffect(() => {
    if (!isPanelResizing) return;

    const onPointerMove = (event: PointerEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const rawWidth = event.clientX - rect.left;
      setTaskPanelWidth(clampTaskPanelWidth(rawWidth));
    };

    const onPointerUp = () => {
      setIsPanelResizing(false);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [clampTaskPanelWidth, isPanelResizing]);

  React.useEffect(() => {
    if (!taskPanelOpen && isPanelResizing) {
      setIsPanelResizing(false);
    }
  }, [isPanelResizing, taskPanelOpen]);

  React.useEffect(() => {
    if (
      !calendarVisibilityOpen &&
      !majorFilterOpen &&
      !siteMainFilterOpen &&
      !middle1FilterOpen &&
      !middle2FilterOpen &&
      !smallFilterOpen
    ) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (calendarVisibilityRef.current && !calendarVisibilityRef.current.contains(target)) {
        setCalendarVisibilityOpen(false);
      }
      if (majorFilterRef.current && !majorFilterRef.current.contains(target)) {
        setMajorFilterOpen(false);
      }
      if (siteMainFilterRef.current && !siteMainFilterRef.current.contains(target)) {
        setSiteMainFilterOpen(false);
      }
      if (middle1FilterRef.current && !middle1FilterRef.current.contains(target)) {
        setMiddle1FilterOpen(false);
      }
      if (middle2FilterRef.current && !middle2FilterRef.current.contains(target)) {
        setMiddle2FilterOpen(false);
      }
      if (smallFilterRef.current && !smallFilterRef.current.contains(target)) {
        setSmallFilterOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [calendarVisibilityOpen, majorFilterOpen, middle1FilterOpen, middle2FilterOpen, siteMainFilterOpen, smallFilterOpen]);

  React.useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  React.useEffect(() => {
    dependenciesRef.current = dependencies;
  }, [dependencies]);

  React.useEffect(() => {
    setTasks(initialSchedule.tasks);
    setDependencies(initialSchedule.dependencies);
    setCalendar(initialSchedule.calendar);
    setCompanies(initialSchedule.companies ?? []);
    setHolidays(initialSchedule.holidays ?? []);
    setSelectedTaskIds([]);
    setActiveTaskId(null);
    setExpandedTaskIds(collectCategoryRowIds(initialSchedule.tasks));
  }, [initialSchedule, setActiveTaskId, setExpandedTaskIds, setSelectedTaskIds]);

  React.useEffect(() => {
    if (planVersions.length === 0 || actualVersions.length === 0) {
      if (selectedPlanVersionId !== null) {
        setSelectedPlanVersionId(null);
      }
      if (selectedActualVersionId !== null) {
        setSelectedActualVersionId(null);
      }
      if (compareEnabled) {
        setCompareEnabled(false);
      }
      return;
    }

    if (!selectedPlanVersionId || !planVersions.some((version) => version.id === selectedPlanVersionId)) {
      setSelectedPlanVersionId(planVersions[0].id);
    }

    if (!selectedActualVersionId || !actualVersions.some((version) => version.id === selectedActualVersionId)) {
      setSelectedActualVersionId(actualVersions[0].id);
    }
  }, [
    actualVersions,
    compareEnabled,
    planVersions,
    selectedActualVersionId,
    selectedPlanVersionId,
    setCompareEnabled,
    setSelectedActualVersionId,
    setSelectedPlanVersionId,
  ]);

  React.useEffect(() => {
    if (!compareEnabled || !selectedPlanVersionId || !selectedActualVersionId) {
      setCompareResult(null);
      return;
    }

    if (compareQuery.data) {
      setCompareResult(compareQuery.data);
    }
  }, [compareEnabled, compareQuery.data, selectedActualVersionId, selectedPlanVersionId, setCompareResult]);

  React.useEffect(() => {
    if (compareQuery.error && compareEnabled) {
      toast.error(compareQuery.error instanceof Error ? compareQuery.error.message : "버전 비교에 실패했습니다.");
      setCompareEnabled(false);
      setCompareResult(null);
    }
  }, [compareEnabled, compareQuery.error, setCompareEnabled, setCompareResult]);

  const isCompareReadOnly = compareEnabled;
  const isVersionReadOnly = readOnlyMode;
  const isReadOnly = isCompareReadOnly || isVersionReadOnly;
  const isFieldView = plannerViewMode === "FIELD";
  const isGanttView = plannerViewMode === "GANTT";
  const readOnlyToastMessage = isCompareReadOnly
    ? "버전 비교 중에는 편집할 수 없습니다."
    : "선택한 버전 조회 모드에서는 편집할 수 없습니다.";

  const removedCompareTasks = React.useMemo(() => {
    if (!isCompareReadOnly || !compareResult) {
      return [] as TaskModel[];
    }

    const compareTasks = Array.isArray(compareResult.tasks) ? compareResult.tasks : [];
    return compareTasks
      .filter((item) => item.status === "REMOVED" && item.before)
      .map((item) => {
        const before = item.before!;
        return {
          ...before,
          id: item.key,
          parentTaskId: null,
          timelineHeadTaskId: null,
          sortOrder: before.sortOrder,
        };
      });
  }, [compareResult, isCompareReadOnly]);

  const compareModeTasksFromActual = React.useMemo(() => {
    if (!isCompareReadOnly || !compareResult?.tasks) {
      return null;
    }
    const list: TaskModel[] = [];
    for (const item of compareResult.tasks) {
      if (item.after) {
        list.push(item.after);
      } else if (item.before) {
        list.push({
          ...item.before,
          id: item.key,
          parentTaskId: null,
          timelineHeadTaskId: null,
          sortOrder: item.before.sortOrder,
        });
      }
    }
    list.sort((a, b) => a.sortOrder - b.sortOrder);
    return list;
  }, [isCompareReadOnly, compareResult]);

  const tasksForView = React.useMemo(
    () =>
      compareModeTasksFromActual !== null
        ? compareModeTasksFromActual
        : isCompareReadOnly
          ? [...tasks, ...removedCompareTasks]
          : tasks,
    [compareModeTasksFromActual, isCompareReadOnly, removedCompareTasks, tasks],
  );

  const taskDiffById = React.useMemo(() => {
    const map: Record<string, TaskCompareItem> = {};
    if (!compareResult) {
      return map;
    }

    const compareTasks = Array.isArray(compareResult.tasks) ? compareResult.tasks : [];
    for (const item of compareTasks) {
      map[item.key] = item;
      if (item.after) {
        map[item.after.id] = item;
      }
    }

    return map;
  }, [compareResult]);

  const taskListCategoryVisibility = React.useMemo(
    () => ({
      showMajorCategory: showGanttMajorCategory,
      showMiddle1Category: showGanttMiddle1Category,
      showMiddle2Category: showGanttMiddle2Category,
      showSmallCategory: showGanttSmallCategory,
    }),
    [showGanttMajorCategory, showGanttMiddle1Category, showGanttMiddle2Category, showGanttSmallCategory],
  );

  const visibleRows = React.useMemo(
    () =>
      buildVisibleTaskList(
        tasksForView,
        expandedTaskIds,
        {
          query: filters.query,
          assignee: filters.assignee,
          companyId: filters.companyId,
          majorCategories: filters.majorCategories,
          middle1Categories: filters.middle1Categories,
          middle2Categories: filters.middle2Categories,
          smallCategories: filters.smallCategories,
          completion: filters.completion,
          milestoneOnly: filters.milestoneOnly,
          sortBy: filters.sortBy,
        },
        taskListCategoryVisibility,
      ),
    [tasksForView, expandedTaskIds, filters, taskListCategoryVisibility],
  );
  const categoryRowIds = React.useMemo(
    () => collectCategoryRowIds(tasksForView, taskListCategoryVisibility),
    [tasksForView, taskListCategoryVisibility],
  );
  const visibleActivityTaskIds = React.useMemo(
    () =>
      new Set(
        visibleRows
          .filter((row): row is Extract<TaskListRow, { rowType: "ACTIVITY_ROW" }> => row.rowType === "ACTIVITY_ROW")
          .map((row) => row.taskId),
      ),
    [visibleRows],
  );
  const visibleRowsForRender = React.useMemo(() => {
    let rows = visibleRows;

    if (filters.hideCompleted) {
      rows = rows.filter(
        (row) =>
          row.rowType !== "ACTIVITY_ROW" || (row.rowType === "ACTIVITY_ROW" && row.task.progress < 100),
      );
    }
    if (filters.hidePast) {
      const todayStr = new Date().toISOString().slice(0, 10);
      rows = rows.filter(
        (row) =>
          row.rowType !== "ACTIVITY_ROW" ||
          (row.rowType === "ACTIVITY_ROW" && (row.task.endDate?.slice(0, 10) ?? "") >= todayStr),
      );
    }

    if (!activityOnlyView) {
      return rows;
    }

    return rows
      .filter((row): row is Extract<TaskListRow, { rowType: "ACTIVITY_ROW" }> => row.rowType === "ACTIVITY_ROW")
      .map((row) => ({
        ...row,
        depth: 0,
      }));
  }, [activityOnlyView, visibleRows, filters.hideCompleted, filters.hidePast]);

  const ganttSplitRangeDays = React.useMemo(() => {
    const visibleActivityTasks = visibleRowsForRender
      .filter((row): row is Extract<TaskListRow, { rowType: "ACTIVITY_ROW" }> => row.rowType === "ACTIVITY_ROW")
      .map((row) => row.task);
    const base = getTimelineRange(
      visibleActivityTasks,
      zoomLevel,
      timelineVisibility,
      timelineProjectHolidayDayKeys,
    );
    return extendTimelineRangeByCalendarDays(
      base,
      ganttTimelineExtraScroll.past,
      ganttTimelineExtraScroll.future,
      timelineVisibility,
      timelineProjectHolidayDayKeys,
    ).days;
  }, [
    visibleRowsForRender,
    zoomLevel,
    timelineVisibility,
    timelineProjectHolidayDayKeys,
    ganttTimelineExtraScroll.past,
    ganttTimelineExtraScroll.future,
  ]);

  visibleRowsRef.current = visibleRowsForRender;

  const assigneeOptions = React.useMemo(() => collectAssignees(tasks), [tasks]);
  const siteMainCategoryOptions = React.useMemo(() => collectSiteMainCategories(tasksForView), [tasksForView]);
  const fieldMiddle1CategoryOptions = React.useMemo(
    () => collectFieldMiddle1Categories(tasksForView, filters.siteMainCategories),
    [filters.siteMainCategories, tasksForView],
  );
  const fieldMiddle2CategoryOptions = React.useMemo(
    () => collectFieldMiddle2Categories(tasksForView, filters.siteMainCategories, filters.middle1Categories),
    [filters.middle1Categories, filters.siteMainCategories, tasksForView],
  );
  const fieldSmallCategoryOptions = React.useMemo(
    () =>
      collectFieldSmallCategories(
        tasksForView,
        filters.siteMainCategories,
        filters.middle1Categories,
        filters.middle2Categories,
      ),
    [filters.middle1Categories, filters.middle2Categories, filters.siteMainCategories, tasksForView],
  );
  const majorCategoryOptions = React.useMemo(() => collectMajorCategories(tasks), [tasks]);
  const middle1CategoryOptions = React.useMemo(
    () => collectMiddle1Categories(tasks, filters.majorCategories),
    [filters.majorCategories, tasks],
  );
  const middle2CategoryOptions = React.useMemo(
    () => collectMiddle2Categories(tasks, filters.majorCategories, filters.middle1Categories),
    [filters.majorCategories, filters.middle1Categories, tasks],
  );
  const smallCategoryOptions = React.useMemo(
    () =>
      collectSmallCategories(
        tasks,
        filters.majorCategories,
        filters.middle1Categories,
        filters.middle2Categories,
      ),
    [filters.majorCategories, filters.middle1Categories, filters.middle2Categories, tasks],
  );
  const activeMiddle1CategoryOptions = isFieldView ? fieldMiddle1CategoryOptions : middle1CategoryOptions;
  const activeMiddle2CategoryOptions = isFieldView ? fieldMiddle2CategoryOptions : middle2CategoryOptions;
  const activeSmallCategoryOptions = isFieldView ? fieldSmallCategoryOptions : smallCategoryOptions;
  const companyOptions = React.useMemo(
    () => companies.slice().sort((a, b) => a.name.localeCompare(b.name, "ko-KR")),
    [companies],
  );
  const companyNameOptions = React.useMemo(() => companyOptions.map((company) => company.name), [companyOptions]);
  const fieldScheduleData = React.useMemo(
    () =>
      buildFieldScheduleRows({
        tasks: tasksForView,
        filters: {
          query: filters.query,
          siteMainCategories: filters.siteMainCategories,
          middle1Categories: filters.middle1Categories,
          middle2Categories: filters.middle2Categories,
          smallCategories: filters.smallCategories,
        },
        scale: fieldScheduleScale,
        anchorDate: fieldAnchorDate,
        showMiddle1Category: showFieldMiddle1Category,
        showMiddle2Category: showFieldMiddle2Category,
        showSmallCategory: showFieldSmallCategory,
        timelineVisibility,
        projectHolidayDayKeys: timelineProjectHolidayDayKeys,
        taskDiffById,
      }),
    [
      fieldAnchorDate,
      fieldScheduleScale,
      filters.middle1Categories,
      filters.middle2Categories,
      filters.query,
      filters.siteMainCategories,
      filters.smallCategories,
      showFieldMiddle1Category,
      showFieldMiddle2Category,
      showFieldSmallCategory,
      taskDiffById,
      tasksForView,
      timelineProjectHolidayDayKeys,
      timelineVisibility,
    ],
  );

  React.useEffect(() => {
    setFieldSplitTaskId(null);
  }, [plannerViewMode]);

  React.useEffect(() => {
    if (fieldSplitTaskId && !selectedTaskIds.includes(fieldSplitTaskId)) {
      setFieldSplitTaskId(null);
    }
  }, [fieldSplitTaskId, selectedTaskIds]);

  React.useEffect(() => {
    if (isReadOnly) {
      setFieldSplitTaskId(null);
    }
  }, [isReadOnly]);

  const selectedTask = React.useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? null,
    [activeTaskId, tasks],
  );

  const buildTaskCreateDraft = React.useCallback(
    (sourceTask?: TaskModel | null): TaskCreateDraft => {
      const startDate = shiftToNearestWorkingDay(new Date(), calendar, "forward");
      const endDate = new Date(startDate.getTime() + 2 * 24 * 60 * 60 * 1000);
      const sourceCompany = companies.find((company) => company.id === sourceTask?.companyId);
      return {
        activityName: sourceTask?.activityName ?? "",
        categoryMajor: sourceTask?.categoryMajor ?? "",
        categoryMiddle1: sourceTask?.categoryMiddle1 ?? "",
        categoryMiddle2: sourceTask?.categoryMiddle2 ?? "",
        categorySmall: sourceTask?.categorySmall ?? "",
        siteMainCategory: sourceTask?.siteMainCategory ?? sourceTask?.categoryMajor ?? "",
        siteDisplayText: resolveSiteDisplayText({
          siteDisplayText: sourceTask?.siteDisplayText,
          activityName: sourceTask?.activityName,
          name: sourceTask?.name,
        }),
        siteDisplayTextManual: isSiteDisplayTextManual({
          siteDisplayText: sourceTask?.siteDisplayText,
          activityName: sourceTask?.activityName,
          name: sourceTask?.name,
        }),
        companyName: sourceCompany?.name ?? "",
        assignee: sourceTask?.assignee ?? "",
        startDate: toDateInputValue(startDate),
        endDate: toDateInputValue(endDate),
        durationDays: sourceTask?.durationDays ?? 3,
        color: getSuggestedTaskColor(tasks, sourceTask?.color),
        isMilestone: sourceTask?.isMilestone ?? false,
        progress: sourceTask?.progress ?? 0,
      };
    },
    [calendar, companies, tasks],
  );

  React.useEffect(() => {
    const prevSet = new Set(prevCategoryRowIdsRef.current);
    prevCategoryRowIdsRef.current = categoryRowIds;

    const valid = new Set(categoryRowIds);
    const cleaned = expandedTaskIds.filter((rowId) => valid.has(rowId));
    const newlyAdded = categoryRowIds.filter((rowId) => !prevSet.has(rowId));

    const next = [...cleaned, ...newlyAdded.filter((rowId) => !cleaned.includes(rowId))];

    if (next.length !== expandedTaskIds.length || next.some((rowId, index) => rowId !== expandedTaskIds[index])) {
      setExpandedTaskIds(next);
    }
  }, [categoryRowIds, expandedTaskIds, setExpandedTaskIds]);

  React.useEffect(() => {
    if (!activityOnlyView) {
      return;
    }

    const visibleActivityRowIds = new Set<string>();
    for (const row of visibleRows) {
      if (row.rowType !== "ACTIVITY_ROW") continue;
      visibleActivityRowIds.add(row.rowId);
      for (const seg of row.timelineSegmentTasks ?? []) {
        visibleActivityRowIds.add(seg.id);
      }
    }

    const nextSelected = selectedTaskIds.filter((rowId) => visibleActivityRowIds.has(rowId));
    if (nextSelected.length !== selectedTaskIds.length) {
      setSelectedTaskIds(nextSelected);
    }

    if (activeTaskId && !visibleActivityRowIds.has(activeTaskId)) {
      setActiveTaskId(null);
    }
  }, [activityOnlyView, activeTaskId, selectedTaskIds, setActiveTaskId, setSelectedTaskIds, visibleRows]);

  React.useEffect(() => {
    const siteMainNext = filters.siteMainCategories.filter((category) => siteMainCategoryOptions.includes(category));
    if (siteMainNext.length !== filters.siteMainCategories.length) {
      updateFilter("siteMainCategories", siteMainNext);
    }
  }, [filters.siteMainCategories, siteMainCategoryOptions, updateFilter]);

  React.useEffect(() => {
    const middle1Next = filters.middle1Categories.filter((category) => activeMiddle1CategoryOptions.includes(category));
    if (middle1Next.length !== filters.middle1Categories.length) {
      updateFilter("middle1Categories", middle1Next);
    }
  }, [activeMiddle1CategoryOptions, filters.middle1Categories, updateFilter]);

  React.useEffect(() => {
    const middle2Next = filters.middle2Categories.filter((category) => activeMiddle2CategoryOptions.includes(category));
    if (middle2Next.length !== filters.middle2Categories.length) {
      updateFilter("middle2Categories", middle2Next);
    }
  }, [activeMiddle2CategoryOptions, filters.middle2Categories, updateFilter]);

  React.useEffect(() => {
    const smallNext = filters.smallCategories.filter((category) => activeSmallCategoryOptions.includes(category));
    if (smallNext.length !== filters.smallCategories.length) {
      updateFilter("smallCategories", smallNext);
    }
  }, [activeSmallCategoryOptions, filters.smallCategories, updateFilter]);

  React.useEffect(() => {
    if (filters.companyId === "all") return;
    if (!companies.some((company) => company.id === filters.companyId)) {
      updateFilter("companyId", "all");
    }
  }, [companies, filters.companyId, updateFilter]);

  const canReorder =
    !isReadOnly &&
    filters.query.length === 0 &&
    filters.assignee === "all" &&
    filters.companyId === "all" &&
    filters.siteMainCategories.length === 0 &&
    filters.majorCategories.length === 0 &&
    filters.middle1Categories.length === 0 &&
    filters.middle2Categories.length === 0 &&
    filters.smallCategories.length === 0 &&
    filters.completion === "all" &&
    !filters.milestoneOnly;
  const compareSummary = compareResult?.summary ?? null;

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

  const flushPendingTaskPatches = React.useCallback(async () => {
    if (pendingTaskPatchesRef.current.size === 0) {
      setSavingState({ saving: false });
      return;
    }

    const entries = [...pendingTaskPatchesRef.current.entries()];
    pendingTaskPatchesRef.current.clear();

    try {
      const cascadeOn = cascadeScheduleOnMoveRef.current;
      await Promise.all(
        entries.map(([taskId, payload]) =>
          mutations.updateTask.mutateAsync({
            taskId,
            payload: {
              ...payload,
              recalculateSuccessors: cascadeOn,
              forceAllDependencies: cascadeOn,
            },
          }),
        ),
      );

      setSavingState({
        saving: false,
        error: null,
        lastSavedAt: new Date().toISOString(),
      });
      await onRefetch();
    } catch (error) {
      setSavingState({
        saving: false,
        error: error instanceof Error ? error.message : "Failed to save changes.",
      });
      toast.error(error instanceof Error ? error.message : "Save failed");
    }
  }, [mutations.updateTask, onRefetch, setSavingState]);

  const queueTaskPatch = React.useCallback(
    (taskId: string, patch: Partial<TaskModel>) => {
      const current = pendingTaskPatchesRef.current.get(taskId) ?? {};
      pendingTaskPatchesRef.current.set(taskId, { ...current, ...patch });

      setSavingState({ saving: true, error: null });

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        void flushPendingTaskPatches();
      }, 600);
    },
    [flushPendingTaskPatches, setSavingState],
  );

  const calendarRef = React.useRef(calendar);
  calendarRef.current = calendar;
  const holidayDayKeysByTaskIdRef = React.useRef(holidayDayKeysByTaskId);
  holidayDayKeysByTaskIdRef.current = holidayDayKeysByTaskId;
  const queueTaskPatchRef = React.useRef(queueTaskPatch);
  queueTaskPatchRef.current = queueTaskPatch;

  const handleTaskSplitCommit = React.useCallback(
    async (taskId: string, splitAfterIndex: number, rangeDays: Date[]) => {
      if (isReadOnly) {
        toast.error(readOnlyToastMessage);
        return;
      }
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) {
        return;
      }
      if (task.isMilestone) {
        toast.error("마일스톤은 나눌 수 없습니다.");
        return;
      }
      const span = getTaskSpanOnRangeDays(task, rangeDays);
      if (!span || splitAfterIndex < span.startIndex || splitAfterIndex >= span.endIndex) {
        toast.error("나눌 수 있는 위치가 아닙니다.");
        return;
      }
      const dayK = rangeDays[splitAfterIndex];
      const dayK1 = rangeDays[splitAfterIndex + 1];
      if (!dayK || !dayK1) {
        return;
      }

      const leftEnd = toDateInputValue(dayK);
      const rightStart = toDateInputValue(dayK1);
      const taskStartDay = task.startDate.slice(0, 10);
      const taskEndDay = task.endDate.slice(0, 10);

      const splitCalendar = {
        workMon: calendar.workMon,
        workTue: calendar.workTue,
        workWed: calendar.workWed,
        workThu: calendar.workThu,
        workFri: calendar.workFri,
        workSat: calendar.workSat,
        workSun: calendar.workSun,
        holidayDayKeys: holidayDayKeysByTaskId.get(task.id) ?? new Set<string>(),
      };

      let splitDates: ReturnType<typeof resolveSplitTaskDates>;
      try {
        splitDates = resolveSplitTaskDates({
          taskStartDay,
          taskEndDay,
          leftEndInclusiveDay: leftEnd,
          rawRightStartDay: rightStart,
          calendar: splitCalendar,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "나누기 날짜를 맞출 수 없습니다.");
        return;
      }

      try {
        setSavingState({ saving: true, error: null });
        await flushPendingTaskPatches();
        pushHistory(tasksRef.current);
        const cascadeOn = cascadeScheduleOnMoveRef.current;

        await mutations.updateTask.mutateAsync({
          taskId,
          payload: {
            endDate: toIsoDay(splitDates.leftEndDay),
            durationDays: splitDates.leftDurationDays,
            recalculateSuccessors: cascadeOn,
            forceAllDependencies: cascadeOn,
          },
        });

        const primaryName = resolveActivityName(task.activityName, task.name);
        const rootHeadId = task.timelineHeadTaskId ?? task.id;
        const siblingOrders = tasksRef.current
          .filter((t) => t.id === rootHeadId || t.timelineHeadTaskId === rootHeadId)
          .map((t) => t.sortOrder);
        const nextSortOrder = (siblingOrders.length ? Math.max(...siblingOrders) : task.sortOrder) + 1;

        const created = await mutations.createTask.mutateAsync({
          name: primaryName.trim() || task.name,
          activityName: task.activityName,
          parentTaskId: task.parentTaskId,
          timelineHeadTaskId: rootHeadId,
          categoryMajor: task.categoryMajor,
          categoryMiddle1: task.categoryMiddle1,
          categoryMiddle2: task.categoryMiddle2,
          categorySmall: task.categorySmall,
          companyId: task.companyId,
          siteMainCategory: task.siteMainCategory,
          siteDisplayText: task.siteDisplayText,
          categoryMiddle: task.categoryMiddle,
          categoryMinor: task.categoryMinor,
          wbsCode: task.wbsCode,
          assignee: task.assignee,
          startDate: toIsoDay(splitDates.rightStartDay),
          endDate: toIsoDay(splitDates.rightEndDay),
          durationDays: splitDates.rightDurationDays,
          progress: task.progress,
          isMilestone: task.isMilestone,
          color: task.color,
          notes: task.notes,
          sortOrder: nextSortOrder,
        });

        /** 선행 작업의 '끝'이 걸린 연결(FS/FF)은 앞 구간이 아니라 뒤 구간(새 작업)으로 붙인다. 후행이 '끝'인 FF/SF는 동일. */
        const depUpdates: Array<Promise<unknown>> = [];
        for (const dep of dependenciesRef.current) {
          if (dep.predecessorTaskId === taskId && (dep.type === "FS" || dep.type === "FF")) {
            depUpdates.push(
              mutations.updateDependency.mutateAsync({
                dependencyId: dep.id,
                payload: { predecessorTaskId: created.id },
              }),
            );
          }
          if (dep.successorTaskId === taskId && (dep.type === "FF" || dep.type === "SF")) {
            depUpdates.push(
              mutations.updateDependency.mutateAsync({
                dependencyId: dep.id,
                payload: { successorTaskId: created.id },
              }),
            );
          }
        }
        if (depUpdates.length > 0) {
          await Promise.all(depUpdates);
        }

        setSavingState({
          saving: false,
          error: null,
          lastSavedAt: new Date().toISOString(),
        });
        await onRefetch();
        setFieldSplitTaskId(null);
        setSelectedTaskIds([created.id]);
        setActiveTaskId(created.id);
        toast.success(
          "나눴습니다. 뒤쪽 구간으로 이어지는 연결선이 자동으로 붙습니다. 구간 사이는 타임라인에서 점선으로 표시됩니다.",
        );
      } catch (error) {
        setSavingState({
          saving: false,
          error: error instanceof Error ? error.message : "Split failed",
        });
        toast.error(error instanceof Error ? error.message : "나누기에 실패했습니다.");
      }
    },
    [
      calendar,
      flushPendingTaskPatches,
      holidayDayKeysByTaskId,
      isReadOnly,
      mutations.createTask,
      mutations.updateDependency,
      mutations.updateTask,
      onRefetch,
      pushHistory,
      readOnlyToastMessage,
      setActiveTaskId,
      setSavingState,
      setSelectedTaskIds,
    ],
  );

  const handleFieldPanelSplitCommit = React.useCallback(
    (taskId: string, splitAfterIndex: number) => {
      void handleTaskSplitCommit(taskId, splitAfterIndex, fieldScheduleData.range.days);
    },
    [fieldScheduleData.range.days, handleTaskSplitCommit],
  );

  const handleGanttSplitCommit = React.useCallback(
    (taskId: string, splitAfterIndex: number) => {
      void handleTaskSplitCommit(taskId, splitAfterIndex, ganttSplitRangeDays);
    },
    [ganttSplitRangeDays, handleTaskSplitCommit],
  );

  const handleMergeTimelineSegments = React.useCallback(async () => {
    if (isReadOnly) {
      toast.error(readOnlyToastMessage);
      return;
    }
    const plan = planTimelineMerge({
      tasks: tasksRef.current,
      dependencies: dependenciesRef.current,
      selectedIds: selectedTaskIds,
      calendar: {
        workMon: calendar.workMon,
        workTue: calendar.workTue,
        workWed: calendar.workWed,
        workThu: calendar.workThu,
        workFri: calendar.workFri,
        workSat: calendar.workSat,
        workSun: calendar.workSun,
      },
      holidayDayKeysByTaskId: holidayDayKeysByTaskIdRef.current,
    });
    if (!plan) {
      toast.error(
        mobileMergePickMode
          ? "같은 목록 작업의 막대를 둘 이상 선택한 뒤, 다시 우클릭·꾹 눌러 「합치기」를 눌러 주세요."
          : "같은 목록 작업의 막대를 Shift로 둘 이상 선택한 뒤 다시 시도해 주세요.",
      );
      return;
    }

    try {
      setSavingState({ saving: true, error: null });
      await flushPendingTaskPatches();
      pushHistory(tasksRef.current);
      const cascadeOn = cascadeScheduleOnMoveRef.current;

      await Promise.all(
        plan.dependencyUpdates.map((u) =>
          mutations.updateDependency.mutateAsync({
            dependencyId: u.id,
            payload: {
              predecessorTaskId: u.predecessorTaskId,
              successorTaskId: u.successorTaskId,
            },
          }),
        ),
      );
      for (const depId of plan.dependencyDeletes) {
        await mutations.deleteDependency.mutateAsync(depId);
      }

      await mutations.updateTask.mutateAsync({
        taskId: plan.headId,
        payload: {
          startDate: plan.headPatch.startDate,
          endDate: plan.headPatch.endDate,
          durationDays: plan.headPatch.durationDays,
          progress: plan.headPatch.progress,
          timelineHeadTaskId: null,
          recalculateSuccessors: cascadeOn,
          forceAllDependencies: cascadeOn,
        },
      });

      for (const segmentId of plan.segmentIdsToDelete) {
        await mutations.deleteTask.mutateAsync(segmentId);
      }

      setSavingState({
        saving: false,
        error: null,
        lastSavedAt: new Date().toISOString(),
      });
      await onRefetch();
      setSelectedTaskIds([plan.headId]);
      setActiveTaskId(plan.headId);
      setMobileMergePickMode(false);
      toast.success("선택한 구간을 한 막대로 합쳤습니다.");
    } catch (error) {
      setSavingState({
        saving: false,
        error: error instanceof Error ? error.message : "합치기 실패",
      });
      toast.error(error instanceof Error ? error.message : "합치기에 실패했습니다.");
      await onRefetch();
    }
  }, [
    calendar.workFri,
    calendar.workMon,
    calendar.workSat,
    calendar.workSun,
    calendar.workThu,
    calendar.workTue,
    calendar.workWed,
    flushPendingTaskPatches,
    isReadOnly,
    mutations.deleteDependency,
    mutations.deleteTask,
    mutations.updateDependency,
    mutations.updateTask,
    onRefetch,
    pushHistory,
    readOnlyToastMessage,
    selectedTaskIds,
    mobileMergePickMode,
    setActiveTaskId,
    setSavingState,
    setSelectedTaskIds,
  ]);

  /** 편집 중에는 항상 메뉴에 표시(첫 탭=고르기 시작). 뷰포트·isMobile과 무관하게 터치 롱프레스로 열 수 있게 함 */
  const mergeContextMenuItemVisible = React.useMemo(
    () => !isReadOnly && !isCompareReadOnly,
    [isCompareReadOnly, isReadOnly],
  );

  /** 데스크톱: Shift 등으로 같은 목록 작업 막대 2개 이상이면 첫 합치기에서 바로 실행 */
  const desktopMergeSelectionReady = React.useMemo(
    () => !isMobile && canMergeSelectedTimelineTasks(tasks, selectedTaskIds),
    [isMobile, selectedTaskIds, tasks],
  );

  const onMergeFromScheduleMenu = React.useCallback(() => {
    if (mobileMergePickMode) {
      void handleMergeTimelineSegments();
      return;
    }
    if (desktopMergeSelectionReady) {
      void handleMergeTimelineSegments();
      return;
    }
    setMobileMergePickMode(true);
    if (isMobile) {
      toast.message("합칠 막대를 여러 개 선택한 뒤, 막대를 꾹 눌러 합치기를 완료하세요.");
      return;
    }
    toast.message("막대를 더 고른 뒤 다시 「합치기」를 누르세요. Shift로 이미 골랐다면 다음 클릭에서 바로 합쳐집니다.");
  }, [desktopMergeSelectionReady, handleMergeTimelineSegments, isMobile, mobileMergePickMode]);

  const patchTaskLocal = React.useCallback(
    (taskId: string, patch: Partial<TaskModel>, options?: { withHistory?: boolean; persist?: boolean }) => {
      if (isReadOnly) {
        return;
      }
      if (options?.withHistory ?? true) {
        pushHistory(tasksRef.current);
      }

      setTasks((prev) =>
        prev.map((task) =>
          task.id === taskId
            ? {
                ...task,
                ...patch,
              }
            : task,
        ),
      );

      if (options?.persist ?? true) {
        queueTaskPatch(taskId, patch);
      }
    },
    [isReadOnly, pushHistory, queueTaskPatch],
  );

  const persistReorder = React.useCallback(
    async (nextTasks: TaskModel[]) => {
      try {
        setSavingState({ saving: true, error: null });
        await mutations.reorderTasks.mutateAsync(
          nextTasks
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((task) => ({
              id: task.id,
              sortOrder: task.sortOrder,
              parentTaskId: task.parentTaskId,
            })),
        );
        setSavingState({
          saving: false,
          error: null,
          lastSavedAt: new Date().toISOString(),
        });
        await onRefetch();
      } catch (error) {
        setSavingState({
          saving: false,
          error: error instanceof Error ? error.message : "Failed to save order.",
        });
        toast.error(error instanceof Error ? error.message : "Order save failed");
      }
    },
    [mutations.reorderTasks, onRefetch, setSavingState],
  );

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      if (!canReorder) return;

      const activeId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      if (!overId || activeId === overId) return;

      const rows = visibleRowsRef.current;
      const draggedRow = rows.find((r) => r.rowId === activeId);
      const targetRow = rows.find((r) => r.rowId === overId);
      if (!draggedRow || !targetRow) return;

      const reordered = moveRowBlock(draggedRow, targetRow, tasksRef.current);
      if (reordered.length !== tasksRef.current.length) return;
      const oldIds = [...tasksRef.current].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => t.id);
      const newIds = [...reordered].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => t.id);
      if (oldIds.join(",") === newIds.join(",")) return;

      pushHistory(tasksRef.current);
      setTasks(reordered);
      void persistReorder(reordered);
    },
    [canReorder, persistReorder, pushHistory],
  );

  const handleOpenTaskCreateDialog = React.useCallback(() => {
    if (isReadOnly) {
      toast.error(readOnlyToastMessage);
      return;
    }
    setTaskCreateDraft(buildTaskCreateDraft(selectedTask));
    setTaskCreateDialogOpen(true);
  }, [buildTaskCreateDraft, isReadOnly, readOnlyToastMessage, selectedTask]);

  const createTaskFromDraft = React.useCallback(
    async (draft: TaskCreateDraft) => {
      const nextActivityName = draft.activityName.trim();
      if (!nextActivityName) {
        toast.error("작업명을 입력해 주세요.");
        return null;
      }

      try {
        setSavingState({ saving: true, error: null });
        const nextCompanyName = draft.companyName.trim();
        let nextCompanyId: string | null = null;

        if (nextCompanyName) {
          const existingCompany = companies.find(
            (company) => normalizeLookupText(company.name) === normalizeLookupText(nextCompanyName),
          );

          if (existingCompany) {
            nextCompanyId = existingCompany.id;
          } else {
            const createdCompany = await mutations.createCompany.mutateAsync({ name: nextCompanyName });
            nextCompanyId = createdCompany.id;
            setCompanies((prev) =>
              [...prev, createdCompany].sort((left, right) => left.name.localeCompare(right.name, "ko-KR")),
            );
          }
        }

        const created = await mutations.createTask.mutateAsync({
          name: nextActivityName,
          activityName: nextActivityName,
          categoryMajor: normalizeText(draft.categoryMajor),
          categoryMiddle1: normalizeText(draft.categoryMiddle1),
          categoryMiddle2: normalizeText(draft.categoryMiddle2),
          categorySmall: normalizeText(draft.categorySmall),
          siteMainCategory: normalizeText(draft.siteMainCategory) ?? normalizeText(draft.categoryMajor),
          siteDisplayText: draft.siteDisplayTextManual ? normalizeText(draft.siteDisplayText) : null,
          companyId: nextCompanyId,
          assignee: normalizeText(draft.assignee),
          startDate: toIsoDay(draft.startDate),
          endDate: toIsoDay(draft.endDate),
          durationDays: Math.max(1, draft.durationDays),
          progress: Math.max(0, Math.min(100, draft.progress)),
          isMilestone: draft.isMilestone,
          color: draft.color,
        });
        setSavingState({
          saving: false,
          error: null,
          lastSavedAt: new Date().toISOString(),
        });
        await onRefetch();
        setSelectedTaskIds([created.id]);
        setActiveTaskId(created.id);
        return created;
      } catch (error) {
        setSavingState({
          saving: false,
          error: error instanceof Error ? error.message : "Task creation failed",
        });
        toast.error(error instanceof Error ? error.message : "Task creation failed");
        return null;
      }
    },
    [companies, mutations.createCompany, mutations.createTask, onRefetch, setActiveTaskId, setSavingState, setSelectedTaskIds],
  );

  const handleCreateTask = React.useCallback(async () => {
    if (!taskCreateDraft) {
      return;
    }
    const created = await createTaskFromDraft(taskCreateDraft);
    if (!created) {
      return;
    }
    setTaskCreateDialogOpen(false);
    setTaskCreateDraft(null);
    toast.success("작업을 생성했습니다.");
  }, [createTaskFromDraft, taskCreateDraft]);

  const handleCreateFieldTask = React.useCallback(
    (payload: {
      mainCategory: string;
      middle1Category: string;
      middle2Category: string;
      smallCategory: string;
      startDate: string;
      endDate: string;
      label: string;
    }) => {
      if (isReadOnly) {
        toast.error(readOnlyToastMessage);
        return;
      }

      const startDate = toDateInputValue(payload.startDate);
      const endDate = toDateInputValue(payload.endDate);
      const durationDays = Math.max(
        1,
        Math.floor((new Date(payload.endDate).getTime() - new Date(payload.startDate).getTime()) / (24 * 60 * 60 * 1000)) + 1,
      );

      setTaskCreateDraft({
        ...buildTaskCreateDraft(null),
        activityName: payload.label,
        categoryMajor: payload.mainCategory,
        categoryMiddle1: payload.middle1Category,
        categoryMiddle2: payload.middle2Category,
        categorySmall: payload.smallCategory,
        siteMainCategory: payload.mainCategory,
        siteDisplayText: payload.label,
        siteDisplayTextManual: false,
        startDate,
        endDate,
        durationDays,
      });
      setTaskCreateDialogOpen(true);
    },
    [
      buildTaskCreateDraft,
      isReadOnly,
      readOnlyToastMessage,
    ],
  );

  const handleCreateTimelineTask = React.useCallback(
    (payload: {
      row: TaskListRow;
      startDate: string;
      endDate: string;
    }) => {
      if (isReadOnly) {
        return;
      }

      const sourceTask = payload.row.rowType === "ACTIVITY_ROW" ? payload.row.task : null;
      const startDate = toDateInputValue(payload.startDate);
      const endDate = toDateInputValue(payload.endDate);
      const durationDays = Math.max(
        1,
        Math.floor((new Date(payload.endDate).getTime() - new Date(payload.startDate).getTime()) / (24 * 60 * 60 * 1000)) + 1,
      );

      const categoryMajor =
        payload.row.rowType === "ACTIVITY_ROW"
          ? payload.row.task.categoryMajor ?? ""
          : payload.row.level === "major"
            ? payload.row.label
            : payload.row.categoryPath.major;
      const categoryMiddle1 =
        payload.row.rowType === "ACTIVITY_ROW"
          ? payload.row.task.categoryMiddle1 ?? ""
          : payload.row.level === "middle1"
            ? payload.row.label
            : payload.row.level === "middle2" || payload.row.level === "small"
              ? payload.row.categoryPath.middle1
              : "";
      const categoryMiddle2 =
        payload.row.rowType === "ACTIVITY_ROW"
          ? payload.row.task.categoryMiddle2 ?? ""
          : payload.row.level === "middle2"
            ? payload.row.label
            : payload.row.level === "small"
              ? payload.row.categoryPath.middle2
              : "";
      const categorySmall =
        payload.row.rowType === "ACTIVITY_ROW"
          ? payload.row.task.categorySmall ?? ""
          : payload.row.level === "small"
            ? payload.row.label
            : "";

      setTaskCreateDraft({
        ...buildTaskCreateDraft(sourceTask),
        activityName: "",
        categoryMajor,
        categoryMiddle1,
        categoryMiddle2,
        categorySmall,
        siteMainCategory: sourceTask?.siteMainCategory ?? categoryMajor,
        siteDisplayText: "",
        siteDisplayTextManual: false,
        startDate,
        endDate,
        durationDays,
      });
      setTaskCreateDialogOpen(true);
    },
    [buildTaskCreateDraft, isReadOnly],
  );

  /** 좁은 화면·iOS 등: 상단 버튼으로 작업 생성(상세 접힘과 무관) */
  const openCreateTaskFromToolbar = React.useCallback(() => {
    if (isReadOnly) {
      toast.error(readOnlyToastMessage);
      return;
    }
    if (isGanttView) {
      const row =
        visibleRowsForRender.find((r) => r.rowType === "ACTIVITY_ROW") ??
        visibleRowsForRender.find((r) => r.rowType === "CATEGORY_ROW");
      const start = shiftToNearestWorkingDay(new Date(), calendar, "forward");
      const end = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000);
      if (row) {
        handleCreateTimelineTask({
          row,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        });
      } else {
        setTaskCreateDraft(buildTaskCreateDraft(null));
        setTaskCreateDialogOpen(true);
      }
      return;
    }
    if (isFieldView) {
      const firstRow = fieldScheduleData.rows[0];
      const days = fieldScheduleData.range.days;
      if (firstRow && days.length > 0) {
        const endIdx = Math.min(2, days.length - 1);
        handleCreateFieldTask({
          mainCategory: firstRow.mainCategory,
          middle1Category: firstRow.middle1Category,
          middle2Category: firstRow.middle2Category,
          smallCategory: firstRow.smallCategory,
          startDate: days[0].toISOString(),
          endDate: days[endIdx].toISOString(),
          label: "",
        });
      } else {
        setTaskCreateDraft(buildTaskCreateDraft(null));
        setTaskCreateDialogOpen(true);
      }
    }
  }, [
    buildTaskCreateDraft,
    calendar,
    fieldScheduleData.range.days,
    fieldScheduleData.rows,
    handleCreateFieldTask,
    handleCreateTimelineTask,
    isFieldView,
    isGanttView,
    isReadOnly,
    readOnlyToastMessage,
    visibleRowsForRender,
  ]);

  const createDependencyWithOptimistic = React.useCallback(
    async (payload: {
      predecessorTaskId: string;
      successorTaskId: string;
      type: DependencyType;
      lagDays: number;
      drivesSchedule?: boolean;
    }) => {
      const optimistic: DependencyModel = {
        id: `temp-${Date.now()}`,
        projectId,
        predecessorTaskId: payload.predecessorTaskId,
        successorTaskId: payload.successorTaskId,
        type: payload.type,
        lagDays: payload.lagDays,
        createdAt: new Date().toISOString(),
      };
      setDependencies((prev) => [...prev, optimistic]);
      try {
        await mutations.createDependency.mutateAsync({
          ...payload,
          drivesSchedule: payload.drivesSchedule ?? false,
        });
        await onRefetch();
        setSavingState({ saving: false, error: null, lastSavedAt: new Date().toISOString() });
        return true;
      } catch (error) {
        setDependencies((prev) => prev.filter((dependency) => dependency.id !== optimistic.id));
        toast.error(error instanceof Error ? error.message : "Failed to create dependency");
        return false;
      }
    },
    [mutations.createDependency, onRefetch, projectId, setSavingState],
  );

  const handleDeleteTask = React.useCallback(
    async (taskId: string) => {
      if (isReadOnly) {
        toast.error(readOnlyToastMessage);
        return;
      }
      if (!window.confirm("Delete this task?")) return;

      pushHistory(tasksRef.current);
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
      setDependencies((prev) =>
        prev.filter(
          (dependency) => dependency.predecessorTaskId !== taskId && dependency.successorTaskId !== taskId,
        ),
      );

      try {
        setSavingState({ saving: true, error: null });
        await mutations.deleteTask.mutateAsync(taskId);
        setSavingState({
          saving: false,
          error: null,
          lastSavedAt: new Date().toISOString(),
        });
        await onRefetch();
      } catch (error) {
        setSavingState({
          saving: false,
          error: error instanceof Error ? error.message : "Task delete failed",
        });
        toast.error(error instanceof Error ? error.message : "Task delete failed");
      }
    },
    [isReadOnly, mutations.deleteTask, onRefetch, pushHistory, readOnlyToastMessage, setSavingState],
  );

  const applySnapshot = React.useCallback(
    async (snapshot: TaskModel[]) => {
      setTasks(snapshot);
      try {
        setSavingState({ saving: true, error: null });

        await mutations.reorderTasks.mutateAsync(
          snapshot
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((task) => ({
              id: task.id,
              sortOrder: task.sortOrder,
              parentTaskId: task.parentTaskId,
            })),
        );

        await Promise.all(
          snapshot.map((task) =>
            mutations.updateTask.mutateAsync({
              taskId: task.id,
              payload: {
                name: task.name,
                activityName: task.activityName,
                categoryMajor: task.categoryMajor,
                categoryMiddle1: task.categoryMiddle1,
                categoryMiddle2: task.categoryMiddle2,
                categorySmall: task.categorySmall,
                companyId: task.companyId,
                siteMainCategory: task.siteMainCategory,
                siteDisplayText: task.siteDisplayText,
                categoryMiddle: task.categoryMiddle,
                categoryMinor: task.categoryMinor,
                startDate: task.startDate,
                endDate: task.endDate,
                durationDays: task.durationDays,
                progress: task.progress,
                assignee: task.assignee,
                color: task.color,
                isMilestone: task.isMilestone,
                notes: task.notes,
                wbsCode: task.wbsCode,
                parentTaskId: task.parentTaskId,
              },
            }),
          ),
        );

        setSavingState({
          saving: false,
          error: null,
          lastSavedAt: new Date().toISOString(),
        });
        await onRefetch();
      } catch (error) {
        setSavingState({
          saving: false,
          error: error instanceof Error ? error.message : "Undo/Redo save failed",
        });
        toast.error(error instanceof Error ? error.message : "Undo/Redo save failed");
      }
    },
    [mutations.reorderTasks, mutations.updateTask, onRefetch, setSavingState],
  );

  const handleUndo = React.useCallback(async () => {
    const snapshot = undo(tasksRef.current);
    if (!snapshot) return;
    await applySnapshot(snapshot);
  }, [applySnapshot, undo]);

  const handleRedo = React.useCallback(async () => {
    const snapshot = redo(tasksRef.current);
    if (!snapshot) return;
    await applySnapshot(snapshot);
  }, [applySnapshot, redo]);

  const cancelPendingTouchBarDrag = React.useCallback(() => {
    const fn = touchBarDragCleanupRef.current;
    touchBarDragCleanupRef.current = null;
    fn?.();
  }, []);

  React.useEffect(() => {
    if (isReadOnly) {
      setMobileMergePickMode(false);
    }
  }, [isReadOnly]);

  /** 합치기 고르기 중: 막대 탭으로 선택 추가(모바일·데스크톱) */
  const mobileBarTapMulti = mobileMergePickMode;

  const commitBarDragStart = React.useCallback(
    (
      taskId: string,
      mode: DragMode,
      startClientX: number,
      cellWidth: number,
      initialTask: TaskModel,
      captureTarget: Element | null,
      pointerId: number,
    ) => {
      pushHistory(tasksRef.current);
      substantiveBarDragMoveRef.current = false;
      if (captureTarget && "setPointerCapture" in captureTarget && typeof captureTarget.setPointerCapture === "function") {
        try {
          captureTarget.setPointerCapture(pointerId);
          barDragCaptureRef.current = { el: captureTarget, pointerId };
        } catch {
          barDragCaptureRef.current = null;
        }
      } else {
        barDragCaptureRef.current = null;
      }
      setDragState({
        taskId,
        mode,
        startX: startClientX,
        cellWidth,
        initialTask,
      });
    },
    [pushHistory],
  );

  const beginBarDrag = React.useCallback(
    (taskId: string, mode: DragMode, event: React.PointerEvent<Element>, cellWidthOverride?: number) => {
      if (isReadOnly) return;
      const task = tasksRef.current.find((item) => item.id === taskId);
      if (!task) return;

      const cellWidth =
        cellWidthOverride ??
        getGanttAvgDayPixelWidth(ganttSplitRangeDays, zoomLevel, isMobile);
      const target = event.currentTarget;
      const deferTouchMove = isMobile && event.pointerType === "touch" && mode === "move";

      if (!deferTouchMove) {
        cancelPendingTouchBarDrag();
        commitBarDragStart(taskId, mode, event.clientX, cellWidth, task, target, event.pointerId);
        return;
      }

      cancelPendingTouchBarDrag();
      const pointerId = event.pointerId;
      const startX = event.clientX;

      let detached = false;
      const detach = () => {
        if (detached) return;
        detached = true;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (Math.abs(ev.clientX - startX) <= 10) return;
        detach();
        touchBarDragCleanupRef.current = null;
        commitBarDragStart(taskId, mode, startX, cellWidth, task, target, pointerId);
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        detach();
        touchBarDragCleanupRef.current = null;
      };

      touchBarDragCleanupRef.current = detach;
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [cancelPendingTouchBarDrag, commitBarDragStart, ganttSplitRangeDays, isMobile, isReadOnly, zoomLevel],
  );

  React.useEffect(() => {
    if (!dragState) return;

    const ds = dragState;

    const releaseBarPointerCapture = () => {
      const cap = barDragCaptureRef.current;
      barDragCaptureRef.current = null;
      if (!cap) return;
      try {
        if (typeof cap.el.releasePointerCapture === "function" && cap.el.hasPointerCapture(cap.pointerId)) {
          cap.el.releasePointerCapture(cap.pointerId);
        }
      } catch {
        // ignore
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      event.preventDefault();
      if (Math.abs(event.clientX - ds.startX) > 6) {
        substantiveBarDragMoveRef.current = true;
      }
      const deltaDays = Math.round((event.clientX - ds.startX) / ds.cellWidth);
      const dragCalendar = {
        ...calendarRef.current,
        holidayDayKeys: holidayDayKeysByTaskIdRef.current.get(ds.initialTask.id),
      };
      const patch =
        ds.mode === "move"
          ? moveTaskByBusinessDays(ds.initialTask, deltaDays, dragCalendar)
          : resizeTaskByBusinessDays(ds.initialTask, deltaDays, ds.mode, dragCalendar);

      setTasks((prev) =>
        prev.map((task) =>
          task.id === ds.taskId
            ? {
                ...task,
                ...patch,
              }
            : task,
        ),
      );
    };

    const finishDrag = () => {
      releaseBarPointerCapture();
      if (substantiveBarDragMoveRef.current) {
        suppressNextBarDragClickRef.current = true;
      }
      substantiveBarDragMoveRef.current = false;

      const taskIdDragged = ds.taskId;
      const initialTask = ds.initialTask;
      const cal = calendarRef.current;
      const holidayMap = holidayDayKeysByTaskIdRef.current;
      const qPatch = queueTaskPatchRef.current;

      const calForSegment = (t: { id: string; companyId: string | null }) => ({
        workMon: cal.workMon,
        workTue: cal.workTue,
        workWed: cal.workWed,
        workThu: cal.workThu,
        workFri: cal.workFri,
        workSat: cal.workSat,
        workSun: cal.workSun,
        holidayDayKeys: holidayMap.get(t.id) ?? new Set<string>(),
      });

      setTasks((prev) => {
        const { next, changedIds } = shiftOverlappingTimelineSegments(prev, calForSegment);
        const merged = changedIds.size > 0 ? next : prev;
        const latest = merged.find((t) => t.id === taskIdDragged);

        const toQueue = new Map<string, Partial<TaskModel>>();

        if (latest) {
          const changed =
            latest.startDate !== initialTask.startDate ||
            latest.endDate !== initialTask.endDate ||
            latest.durationDays !== initialTask.durationDays;
          if (changed) {
            toQueue.set(taskIdDragged, {
              startDate: latest.startDate,
              endDate: latest.endDate,
              durationDays: latest.durationDays,
            });
          }
        }

        for (const id of changedIds) {
          const t = next.find((x) => x.id === id);
          const b = prev.find((x) => x.id === id);
          if (
            t &&
            b &&
            (t.startDate !== b.startDate || t.endDate !== b.endDate || t.durationDays !== b.durationDays)
          ) {
            toQueue.set(id, {
              startDate: t.startDate,
              endDate: t.endDate,
              durationDays: t.durationDays,
            });
          }
        }

        for (const [id, patch] of toQueue) {
          qPatch(id, patch);
        }

        return merged;
      });

      setDragState(null);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      releaseBarPointerCapture();
    };
  }, [dragState]);

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isReadOnly) {
        return;
      }

      if (event.key === "Escape" && fieldSplitTaskId) {
        setFieldSplitTaskId(null);
        return;
      }

      if (event.key === "Escape" && mobileMergePickMode) {
        setMobileMergePickMode(false);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          void handleRedo();
        } else {
          void handleUndo();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b" && !event.shiftKey) {
        if (!isFieldView && !isGanttView) {
          return;
        }
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
          return;
        }
        event.preventDefault();
        if (fieldSplitTaskId) {
          setFieldSplitTaskId(null);
          return;
        }
        const id = activeTaskId ?? selectedTaskIds[0] ?? null;
        if (!id) {
          toast.message("나눌 작업을 먼저 선택해 주세요.");
          return;
        }
        const task = tasksRef.current.find((t) => t.id === id);
        if (!task) {
          return;
        }
        const rangeDays = isFieldView ? fieldScheduleData.range.days : ganttSplitRangeDays;
        const span = getTaskSpanOnRangeDays(task, rangeDays);
        if (!span || span.endIndex <= span.startIndex) {
          toast.message("하루 이상인 막대만 나눌 수 있습니다.");
          return;
        }
        setFieldSplitTaskId(id);
        return;
      }

      if (event.key === "Delete" && activeTaskId) {
        void handleDeleteTask(activeTaskId);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    activeTaskId,
    fieldScheduleData.range.days,
    fieldSplitTaskId,
    ganttSplitRangeDays,
    handleDeleteTask,
    handleRedo,
    handleUndo,
    isFieldView,
    isGanttView,
    isReadOnly,
    mobileMergePickMode,
    selectedTaskIds,
  ]);

  const handleLeftScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (!rightScrollRef.current) return;
    if (syncingRef.current === "right") {
      syncingRef.current = null;
      return;
    }
    syncingRef.current = "left";
    rightScrollRef.current.scrollTop = event.currentTarget.scrollTop;
  };

  const handleRightScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
    if (!leftScrollRef.current) return;
    if (syncingRef.current === "left") {
      syncingRef.current = null;
      return;
    }
    syncingRef.current = "right";
    leftScrollRef.current.scrollTop = event.currentTarget.scrollTop;
  };

  const handleMobileGanttEdgePan = React.useCallback((direction: "past" | "future") => {
    setGanttTimelineExtraScroll((prev) =>
      direction === "past"
        ? { ...prev, past: prev.past + MOBILE_GANTT_EDGE_PAN_CHUNK_DAYS }
        : { ...prev, future: prev.future + MOBILE_GANTT_EDGE_PAN_CHUNK_DAYS },
    );
  }, []);

  const toggleMultiFilterValue = React.useCallback(
    (
      key: "siteMainCategories" | "majorCategories" | "middle1Categories" | "middle2Categories" | "smallCategories",
      value: string,
    ) => {
      const current = filters[key];
      if (current.includes(value)) {
        updateFilter(
          key,
          current.filter((item) => item !== value),
        );
        return;
      }
      updateFilter(key, [...current, value]);
    },
    [filters, updateFilter],
  );

  const handleRowSelect = React.useCallback(
    (row: TaskListRow, additive: boolean) => {
      if (!additive) {
        setSelectedTaskIds([row.rowId]);
        setActiveTaskId(row.rowType === "ACTIVITY_ROW" ? row.taskId : null);
        return;
      }

      const alreadySelected = selectedTaskIds.includes(row.rowId);
      const nextSelected = alreadySelected
        ? selectedTaskIds.filter((rowId) => rowId !== row.rowId)
        : [...selectedTaskIds, row.rowId];

      setSelectedTaskIds(nextSelected);

      if (row.rowType === "ACTIVITY_ROW") {
        if (alreadySelected && activeTaskId === row.taskId) {
          setActiveTaskId(null);
        } else if (!alreadySelected) {
          setActiveTaskId(row.taskId);
        }
      } else {
        setActiveTaskId(null);
      }
    },
    [activeTaskId, selectedTaskIds, setActiveTaskId, setSelectedTaskIds],
  );

  const handleExpandAllCategories = React.useCallback(() => {
    setExpandedTaskIds(categoryRowIds);
  }, [categoryRowIds, setExpandedTaskIds]);

  const handleCollapseAllCategories = React.useCallback(() => {
    setExpandedTaskIds([]);
  }, [setExpandedTaskIds]);

  const handleFieldTaskSelect = React.useCallback(
    (taskId: string, additive: boolean) => {
      if (!additive) {
        setSelectedTaskIds([taskId]);
        setActiveTaskId(taskId);
        return;
      }

      const alreadySelected = selectedTaskIds.includes(taskId);
      const nextSelected = alreadySelected
        ? selectedTaskIds.filter((rowId) => rowId !== taskId)
        : [...selectedTaskIds, taskId];

      setSelectedTaskIds(nextSelected);
      setActiveTaskId(alreadySelected && activeTaskId === taskId ? null : taskId);
    },
    [activeTaskId, selectedTaskIds, setActiveTaskId, setSelectedTaskIds],
  );

  const handleShiftFieldAnchor = React.useCallback(
    (direction: number) => {
      const base = new Date(fieldAnchorDate);
      const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
      if (fieldScheduleScale === "MONTHLY") {
        next.setUTCMonth(next.getUTCMonth() + direction);
      } else {
        next.setUTCDate(next.getUTCDate() + direction * 7);
      }
      setFieldAnchorDate(next.toISOString());
    },
    [fieldAnchorDate, fieldScheduleScale, setFieldAnchorDate],
  );

  const handleResetFieldAnchor = React.useCallback(() => {
    setFieldAnchorDate(new Date().toISOString());
  }, [setFieldAnchorDate]);

  const handleMobileFieldEdgePan = React.useCallback(
    (direction: "past" | "future") => {
      handleShiftFieldAnchor(direction === "past" ? -1 : 1);
    },
    [handleShiftFieldAnchor],
  );

  const openDependencyDialog = React.useCallback(
    (predecessorTaskId: string, successorTaskId: string) => {
      if (!predecessorTaskId || !successorTaskId || predecessorTaskId === successorTaskId) {
        return;
      }

      const pred = tasks.find((t) => t.id === predecessorTaskId);
      const succ = tasks.find((t) => t.id === successorTaskId);

      let type: DependencyType = "FS";
      let mode: "lag" | "lead" = "lag";
      let offsetDays = 0;

      if (pred && succ && calendar) {
        const calendarConfig = {
          workMon: calendar.workMon,
          workTue: calendar.workTue,
          workWed: calendar.workWed,
          workThu: calendar.workThu,
          workFri: calendar.workFri,
          workSat: calendar.workSat,
          workSun: calendar.workSun,
          holidayDayKeys: timelineProjectHolidayDayKeys,
        };
        const inferred = inferDependencyFromTaskDates(
          { startDate: pred.startDate, endDate: pred.endDate },
          { startDate: succ.startDate, endDate: succ.endDate },
          calendarConfig,
        );
        type = inferred.type;
        offsetDays = Math.abs(inferred.lagDays);
        mode = inferred.lagDays >= 0 ? "lag" : "lead";
      }

      setPendingDependencySourceTaskId(predecessorTaskId);
      setDependencyDraft((prev) => ({
        ...prev,
        predecessorTaskId,
        successorTaskId,
        type,
        mode,
        offsetDays,
      }));
      setDependencyDialogOpen(true);
    },
    [tasks, calendar, timelineProjectHolidayDayKeys],
  );

  const handleDependencySourceSelect = React.useCallback(
    (taskId: string) => {
      if (isReadOnly) {
        toast.error(readOnlyToastMessage);
        return;
      }
      setPendingDependencySourceTaskId(taskId);
      setDependencyDraft((prev) => ({
        ...prev,
        predecessorTaskId: taskId,
        successorTaskId: "",
      }));
      const sourceTask = tasks.find((task) => task.id === taskId);
      toast.message(`선행 작업 선택: ${sourceTask?.activityName ?? sourceTask?.name ?? taskId}`);
    },
    [isReadOnly, readOnlyToastMessage, tasks],
  );

  const handleDependencyConnectStart = React.useCallback(
    (taskId: string, clientX: number, clientY: number) => {
      if (isReadOnly) {
        toast.error(readOnlyToastMessage);
        return;
      }

      setPendingDependencySourceTaskId(taskId);
      setDependencyConnectState({
        sourceTaskId: taskId,
        sourceClientX: clientX,
        sourceClientY: clientY,
        currentClientX: clientX,
        currentClientY: clientY,
        hoveredTaskId: null,
      });
    },
    [isReadOnly, readOnlyToastMessage],
  );

  const handleDependencyTargetSelect = React.useCallback(
    (taskId: string) => {
      if (!pendingDependencySourceTaskId || pendingDependencySourceTaskId === taskId) {
        return;
      }
      openDependencyDialog(pendingDependencySourceTaskId, taskId);
    },
    [openDependencyDialog, pendingDependencySourceTaskId],
  );

  React.useEffect(() => {
    if (!dependencyConnectState) {
      return;
    }

    const resolveHoveredTaskId = (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      const target = element?.closest<HTMLElement>("[data-dependency-task-id]");
      const taskId = target?.dataset.dependencyTaskId ?? null;
      if (!taskId || taskId === dependencyConnectStateRef.current?.sourceTaskId) {
        return null;
      }
      return taskId;
    };

    const onPointerMove = (event: PointerEvent) => {
      event.preventDefault();
      const hoveredTaskId = resolveHoveredTaskId(event.clientX, event.clientY);
      setDependencyConnectState((current) =>
        current
          ? {
              ...current,
              currentClientX: event.clientX,
              currentClientY: event.clientY,
              hoveredTaskId,
            }
          : current,
      );
    };

    const onPointerUp = (event: PointerEvent) => {
      const current = dependencyConnectStateRef.current;
      const hoveredTaskId = resolveHoveredTaskId(event.clientX, event.clientY) ?? current?.hoveredTaskId ?? null;
      if (current && hoveredTaskId) {
        openDependencyDialog(current.sourceTaskId, hoveredTaskId);
      } else {
        setPendingDependencySourceTaskId(null);
      }
      setDependencyConnectState(null);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dependencyConnectState, openDependencyDialog]);

  const handleCreateDependencyFromDialog = React.useCallback(async () => {
    if (!dependencyDraft.predecessorTaskId || !dependencyDraft.successorTaskId) {
      toast.error("선행과 후행 작업을 모두 선택해 주세요.");
      return;
    }

    const lagDays = dependencyDraft.mode === "lead" ? -dependencyDraft.offsetDays : dependencyDraft.offsetDays;
    const success = await createDependencyWithOptimistic({
      predecessorTaskId: dependencyDraft.predecessorTaskId,
      successorTaskId: dependencyDraft.successorTaskId,
      type: dependencyDraft.type,
      lagDays,
      drivesSchedule: dependencyDraft.drivesSchedule,
    });

    if (!success) {
      return;
    }

    setDependencyConnectState(null);
    setDependencyDialogOpen(false);
    setPendingDependencySourceTaskId(null);
    setDependencyDraft({
      predecessorTaskId: "",
      successorTaskId: "",
      type: "FS",
      mode: "lag",
      offsetDays: 0,
      drivesSchedule: false,
    });
    toast.success("연결관계를 저장했습니다.");
  }, [createDependencyWithOptimistic, dependencyDraft]);

  const activeDependencySourceTaskId = dependencyConnectState?.sourceTaskId ?? pendingDependencySourceTaskId;
  const dependencyConnectTargetTaskId = dependencyConnectState?.hoveredTaskId ?? null;

  /** 폰 세로만 상세 블록을 세로 스택; 태블릿·PC·폰 가로는 한 줄에 가깝게 flex-wrap */
  const scheduleDetailStacked = isMobilePortrait;
  /** 조건·분류·빠른 작업 블록: 넓은 화면은 plannerToolbarOpen, lg 미만은 「상세」버튼(mobileFilterOpen) */
  const showScheduleDetailPanel = isNarrowPlanner ? mobileFilterOpen : plannerToolbarOpen;

  return (
    <div className="space-y-3">
      <Card
        className={cn(
          "glass-panel relative z-40 max-w-full min-w-0 rounded-2xl p-3",
          isMobilePortrait ? "overflow-x-hidden" : "overflow-x-auto",
        )}
      >
        <div className="flex min-w-0 max-w-full flex-col gap-3">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-2">
          <div className="flex shrink-0 items-center gap-1 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900/50">
            <Button variant={isGanttView ? "default" : "ghost"} size="sm" onClick={() => setPlannerViewMode("GANTT")}>
              작업뷰
            </Button>
            <Button variant={isFieldView ? "default" : "ghost"} size="sm" onClick={() => setPlannerViewMode("FIELD")}>
              현장표
            </Button>
          </div>
          {isGanttView ? (
            <div className="flex shrink-0 flex-wrap items-center gap-1 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900/50">
              <Button variant={zoomLevel === "day" ? "default" : "ghost"} size="sm" onClick={() => setZoomLevel("day")}>
                Day
              </Button>
              <Button variant={zoomLevel === "week" ? "default" : "ghost"} size="sm" onClick={() => setZoomLevel("week")}>
                Week
              </Button>
              <Button variant={zoomLevel === "month" ? "default" : "ghost"} size="sm" onClick={() => setZoomLevel("month")}>
                Month
              </Button>
            </div>
          ) : null}
          <div className="relative min-w-0 flex-1 basis-[min(100%,11rem)] sm:min-w-56 sm:basis-auto">
            <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-zinc-400" />
            <Input
              value={filters.query}
              onChange={(event) => updateFilter("query", event.target.value)}
              placeholder={isFieldView ? "현장표 문구 / 공종 검색" : "Search task name"}
              className="h-9 border-zinc-200 bg-slate-100/80 pl-8 text-sm text-zinc-900 shadow-none dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-9 shrink-0 gap-1 transition-colors",
              showScheduleDetailPanel &&
                "border-sky-500/60 bg-sky-50 font-medium text-sky-950 shadow-[inset_0_0_0_1px_rgba(14,165,233,0.25)] hover:bg-sky-100 dark:border-sky-500/45 dark:bg-sky-950/45 dark:text-sky-50 dark:hover:bg-sky-900/55",
            )}
            onClick={() =>
              isNarrowPlanner ? setMobileFilterOpen((p) => !p) : setPlannerToolbarOpen((p) => !p)
            }
            aria-expanded={showScheduleDetailPanel}
            title={showScheduleDetailPanel ? "조건·빠른 작업 접기" : "조건·빠른 작업 펼치기"}
          >
            <Filter className="size-4" /> 상세
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-9 shrink-0 gap-1 transition-colors",
              sidePanelOpen &&
                "border-sky-500/60 bg-sky-50 font-medium text-sky-950 shadow-[inset_0_0_0_1px_rgba(14,165,233,0.25)] hover:bg-sky-100 dark:border-sky-500/45 dark:bg-sky-950/45 dark:text-sky-50 dark:hover:bg-sky-900/55",
            )}
            onClick={() => setSidePanelOpen(!sidePanelOpen)}
            aria-pressed={sidePanelOpen}
            title={sidePanelOpen ? "프로젝트 상세 패널 닫기" : "프로젝트 상세 패널 열기"}
          >
            {sidePanelOpen ? <SidebarClose className="size-4 shrink-0" aria-hidden /> : <SidebarOpen className="size-4 shrink-0" aria-hidden />}
            <span className="hidden whitespace-nowrap sm:inline">프로젝트 상세</span>
            <span className="whitespace-nowrap sm:hidden">프젝 상세</span>
          </Button>
          {!isReadOnly && (isGanttView || isFieldView) ? (
            <Button
              type="button"
              variant="default"
              size="sm"
              className="h-9 shrink-0 gap-1.5 font-semibold shadow-sm"
              onClick={openCreateTaskFromToolbar}
              title="새 작업 추가"
            >
              <Plus className="size-4 shrink-0" aria-hidden />
              <span className="hidden sm:inline">작업 생성</span>
              <span className="sm:hidden">생성</span>
            </Button>
          ) : null}
          {isNarrowPlanner && mobileMergePickMode && !isReadOnly && (isGanttView || isFieldView) ? (
            <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-amber-200/90 bg-amber-50/80 px-2 py-2 dark:border-amber-800/60 dark:bg-amber-950/30">
              <span className="text-[11px] text-amber-950 dark:text-amber-100">
                합치기: 막대를 탭해 고른 뒤 꾹 눌러 완료
              </span>
              <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 text-[11px]" onClick={() => setMobileMergePickMode(false)}>
                취소
              </Button>
            </div>
          ) : null}
          {!isReadOnly && !isMobile && mobileMergePickMode && (isGanttView || isFieldView) ? (
            <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-amber-200/90 bg-amber-50/80 px-2 py-2 dark:border-amber-800/60 dark:bg-amber-950/30">
              <span className="text-[11px] text-amber-950 dark:text-amber-100">
                합치기 고르기: 클릭 또는 Shift로 막대를 더 고른 뒤 「합치기」를 다시 누르세요. (Esc 취소)
              </span>
              <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 text-[11px]" onClick={() => setMobileMergePickMode(false)}>
                취소
              </Button>
            </div>
          ) : null}
        </div>
          {isFieldView ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900/50">
              <div className="flex flex-wrap items-center gap-1">
                <div className="flex items-center gap-1 rounded-lg border border-zinc-200/60 bg-white/50 px-0.5 py-0.5 dark:border-zinc-600 dark:bg-zinc-800/50">
                  <Button variant={fieldScheduleScale === "WEEKLY" ? "default" : "ghost"} size="sm" onClick={() => setFieldScheduleScale("WEEKLY")}>
                    주간
                  </Button>
                  <Button variant={fieldScheduleScale === "MONTHLY" ? "default" : "ghost"} size="sm" onClick={() => setFieldScheduleScale("MONTHLY")}>
                    월간
                  </Button>
                </div>
                {!isMobilePortrait ? <div className="h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-600" aria-hidden /> : null}
                <div className="flex items-center gap-0.5 rounded-lg border border-zinc-200/60 bg-white/50 px-0.5 py-0.5 dark:border-zinc-600 dark:bg-zinc-800/50">
                  <Button variant="ghost" size="sm" className="min-w-8" onClick={() => handleShiftFieldAnchor(-1)}>
                    이전
                  </Button>
                  <span className="h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-600" aria-hidden />
                  <Button variant="ghost" size="sm" className="min-w-8" onClick={handleResetFieldAnchor}>
                    오늘
                  </Button>
                  <span className="h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-600" aria-hidden />
                  <Button variant="ghost" size="sm" className="min-w-8" onClick={() => handleShiftFieldAnchor(1)}>
                    다음
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          {showScheduleDetailPanel ? (
            <div
              className={cn(
                "min-w-0 max-w-full overflow-x-auto border-t border-zinc-200/80 pt-3 dark:border-zinc-700",
                scheduleDetailStacked ? "flex flex-col gap-3" : "flex flex-wrap gap-2 content-start items-stretch",
              )}
            >
              <div
                className={cn(
                  "rounded-xl border border-zinc-200/80 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950/35",
                  scheduleDetailStacked ? "w-full p-2.5" : "min-w-0 max-w-[min(100%,720px)] shrink-0 p-2",
                )}
              >
                <p
                  className={cn(
                    "font-semibold text-zinc-600 dark:text-zinc-400",
                    scheduleDetailStacked ? "mb-2 text-[11px]" : "mb-1.5 text-[10px]",
                  )}
                >
                  조건 · 막대/행 걸러보기
                </p>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
          {isFieldView ? (
            <div ref={siteMainFilterRef} className="relative">
              <Button
                variant="outline"
                size="sm"
                className="h-9 min-w-[132px] justify-between border-zinc-200 bg-slate-100/80 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                onClick={() => setSiteMainFilterOpen((prev) => !prev)}
              >
                <span className="truncate">
                  {filters.siteMainCategories.length > 0 ? `공종 ${filters.siteMainCategories.length}` : "공종"}
                </span>
              </Button>
              {siteMainFilterOpen ? (
                <div className="absolute left-0 top-10 z-[90] max-h-64 w-52 overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                  <button
                    type="button"
                    className="mb-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    onClick={() => updateFilter("siteMainCategories", [])}
                  >
                    전체 해제
                  </button>
                  {siteMainCategoryOptions.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-muted">항목 없음</p>
                  ) : (
                    siteMainCategoryOptions.map((category) => (
                      <label
                        key={category}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        <input
                          type="checkbox"
                          className="accent-sky-600"
                          checked={filters.siteMainCategories.includes(category)}
                          onChange={() => toggleMultiFilterValue("siteMainCategories", category)}
                        />
                        <span className="truncate">{category}</span>
                      </label>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
          {isGanttView ? (
          <Select value={filters.assignee} onValueChange={(value) => updateFilter("assignee", value)}>
            <SelectTrigger className="w-[140px] border-zinc-200 bg-slate-100/80 text-zinc-900 shadow-none dark:border-zinc-700 dark:bg-zinc-900">
              <SelectValue placeholder="담당자" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">담당자 전체</SelectItem>
              {assigneeOptions.map((assignee) => (
                <SelectItem key={assignee} value={assignee}>
                  {assignee}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          ) : null}
          {isGanttView ? (
          <Select value={filters.companyId} onValueChange={(value) => updateFilter("companyId", value)}>
            <SelectTrigger className="w-[150px] border-zinc-200 bg-slate-100/80 text-zinc-900 shadow-none dark:border-zinc-700 dark:bg-zinc-900">
              <SelectValue placeholder="업체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">업체 전체</SelectItem>
              {companyOptions.map((company) => (
                <SelectItem key={company.id} value={company.id}>
                  {company.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          ) : null}
          {isGanttView ? (
          <div ref={majorFilterRef} className="relative">
            <Button
              variant="outline"
              size="sm"
              className="h-9 min-w-[132px] justify-between border-zinc-200 bg-slate-100/80 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              onClick={() => setMajorFilterOpen((prev) => !prev)}
            >
              <span className="truncate">
                {filters.majorCategories.length > 0 ? `대분류 ${filters.majorCategories.length}` : "대분류"}
              </span>
            </Button>
            {majorFilterOpen ? (
              <div className="absolute left-0 top-10 z-[90] max-h-64 w-52 overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <button
                  type="button"
                  className="mb-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  onClick={() => updateFilter("majorCategories", [])}
                >
                  전체 해제
                </button>
                {majorCategoryOptions.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted">항목 없음</p>
                ) : (
                  majorCategoryOptions.map((category) => (
                    <label
                      key={category}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <input
                        type="checkbox"
                        className="accent-sky-600"
                        checked={filters.majorCategories.includes(category)}
                        onChange={() => toggleMultiFilterValue("majorCategories", category)}
                      />
                      <span className="truncate">{category}</span>
                    </label>
                  ))
                )}
              </div>
            ) : null}
          </div>
          ) : null}
          {(isGanttView || isFieldView) ? (
          <div ref={middle1FilterRef} className="relative">
            <Button
              variant="outline"
              size="sm"
              className="h-9 min-w-[132px] justify-between border-zinc-200 bg-slate-100/80 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              onClick={() => setMiddle1FilterOpen((prev) => !prev)}
            >
              <span className="truncate">
                {filters.middle1Categories.length > 0 ? `중분류1 ${filters.middle1Categories.length}` : "중분류1"}
              </span>
            </Button>
            {middle1FilterOpen ? (
              <div className="absolute left-0 top-10 z-[90] max-h-64 w-52 overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <button
                  type="button"
                  className="mb-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  onClick={() => updateFilter("middle1Categories", [])}
                >
                  전체 해제
                </button>
                {activeMiddle1CategoryOptions.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted">항목 없음</p>
                ) : (
                  activeMiddle1CategoryOptions.map((category) => (
                    <label
                      key={category}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <input
                        type="checkbox"
                        className="accent-sky-600"
                        checked={filters.middle1Categories.includes(category)}
                        onChange={() => toggleMultiFilterValue("middle1Categories", category)}
                      />
                      <span className="truncate">{category}</span>
                    </label>
                  ))
                )}
              </div>
            ) : null}
          </div>
          ) : null}
          {(isGanttView || isFieldView) ? (
          <div ref={middle2FilterRef} className="relative">
            <Button
              variant="outline"
              size="sm"
              className="h-9 min-w-[132px] justify-between border-zinc-200 bg-slate-100/80 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              onClick={() => setMiddle2FilterOpen((prev) => !prev)}
            >
              <span className="truncate">
                {filters.middle2Categories.length > 0 ? `중분류2 ${filters.middle2Categories.length}` : "중분류2"}
              </span>
            </Button>
            {middle2FilterOpen ? (
              <div className="absolute left-0 top-10 z-[90] max-h-64 w-52 overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <button
                  type="button"
                  className="mb-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  onClick={() => updateFilter("middle2Categories", [])}
                >
                  전체 해제
                </button>
                {activeMiddle2CategoryOptions.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted">항목 없음</p>
                ) : (
                  activeMiddle2CategoryOptions.map((category) => (
                    <label
                      key={category}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <input
                        type="checkbox"
                        className="accent-sky-600"
                        checked={filters.middle2Categories.includes(category)}
                        onChange={() => toggleMultiFilterValue("middle2Categories", category)}
                      />
                      <span className="truncate">{category}</span>
                    </label>
                  ))
                )}
              </div>
            ) : null}
          </div>
          ) : null}
          <div ref={smallFilterRef} className="relative">
            <Button
              variant="outline"
              size="sm"
              className="h-9 min-w-[132px] justify-between border-zinc-200 bg-slate-100/80 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              onClick={() => setSmallFilterOpen((prev) => !prev)}
            >
              <span className="truncate">
                {filters.smallCategories.length > 0
                  ? `${isFieldView ? "세부공종" : "소분류"} ${filters.smallCategories.length}`
                  : isFieldView
                    ? "세부공종"
                    : "소분류"}
              </span>
            </Button>
            {smallFilterOpen ? (
              <div className="absolute left-0 top-10 z-[90] max-h-64 w-52 overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <button
                  type="button"
                  className="mb-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  onClick={() => updateFilter("smallCategories", [])}
                >
                  전체 해제
                </button>
                {activeSmallCategoryOptions.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted">항목 없음</p>
                ) : (
                  activeSmallCategoryOptions.map((category) => (
                    <label
                      key={category}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <input
                        type="checkbox"
                        className="accent-sky-600"
                        checked={filters.smallCategories.includes(category)}
                        onChange={() => toggleMultiFilterValue("smallCategories", category)}
                      />
                      <span className="truncate">{category}</span>
                    </label>
                  ))
                )}
              </div>
            ) : null}
          </div>
                </div>
              </div>
              <div
                className={cn(
                  "rounded-xl border border-zinc-200/80 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950/35",
                  scheduleDetailStacked ? "w-full p-2.5" : "min-w-0 max-w-[min(100%,640px)] shrink-0 p-2",
                )}
              >
                <p
                  className={cn(
                    "font-semibold text-zinc-600 dark:text-zinc-400",
                    scheduleDetailStacked ? "mb-2 text-[11px]" : "mb-1.5 text-[10px]",
                  )}
                >
                  {isGanttView ? "작업뷰 · 줌·분류 줄" : "현장표 · 열 표시"}
                </p>
                {isGanttView ? (
                  <label
                    className={cn(
                      "mb-1.5 flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-sky-400/45 bg-sky-50/50 px-2 py-1.5 dark:border-sky-500/35 dark:bg-sky-950/30",
                      scheduleDetailStacked ? "text-[12px]" : "text-[11px]",
                    )}
                  >
                    <span className="shrink-0 font-medium text-zinc-800 dark:text-zinc-100">전체 켜기/끄기</span>
                    <Switch
                      checked={
                        showGanttMajorCategory &&
                        showGanttMiddle1Category &&
                        showGanttMiddle2Category &&
                        showGanttSmallCategory
                      }
                      onCheckedChange={(checked) => {
                        const v = !!checked;
                        setShowGanttMajorCategory(v);
                        setShowGanttMiddle1Category(v);
                        setShowGanttMiddle2Category(v);
                        setShowGanttSmallCategory(v);
                      }}
                    />
                  </label>
                ) : (
                  <label
                    className={cn(
                      "mb-1.5 flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-sky-400/45 bg-sky-50/50 px-2 py-1.5 dark:border-sky-500/35 dark:bg-sky-950/30",
                      scheduleDetailStacked ? "text-[12px]" : "text-[11px]",
                    )}
                  >
                    <span className="shrink-0 font-medium text-zinc-800 dark:text-zinc-100">전체 켜기/끄기</span>
                    <Switch
                      checked={
                        showFieldMainCategory &&
                        showFieldMiddle1Category &&
                        showFieldMiddle2Category &&
                        showFieldSmallCategory
                      }
                      onCheckedChange={(checked) => {
                        const v = !!checked;
                        setShowFieldMainCategory(v);
                        setShowFieldMiddle1Category(v);
                        setShowFieldMiddle2Category(v);
                        setShowFieldSmallCategory(v);
                      }}
                    />
                  </label>
                )}
                <div className="flex min-w-0 flex-wrap items-center gap-2">
          {isGanttView ? (
            <div className={cn("flex min-w-0 flex-wrap items-center gap-2", scheduleDetailStacked && "w-full")}>
              {isMobilePortrait ? (
                <div className="w-full min-w-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex h-9 w-full min-w-0 items-center justify-between gap-2 border-zinc-200 bg-slate-100/80 px-3 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900"
                    aria-expanded={mobileGanttCategoryOpen}
                    onClick={() => setMobileGanttCategoryOpen((o) => !o)}
                  >
                    <span className="truncate text-left text-xs font-medium">분류 (대·중1·중2·소)</span>
                    <ChevronDown
                      className={cn("size-4 shrink-0 opacity-70 transition-transform", mobileGanttCategoryOpen && "rotate-180")}
                      aria-hidden
                    />
                  </Button>
                  {mobileGanttCategoryOpen ? (
                    <div className="mt-2 flex flex-col gap-2 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-2 dark:border-zinc-700 dark:bg-zinc-900/50">
                      <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-[12px] dark:border-zinc-700 dark:bg-zinc-950/40">
                        <span>대분류</span>
                        <Switch checked={showGanttMajorCategory} onCheckedChange={setShowGanttMajorCategory} />
                      </label>
                      <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-[12px] dark:border-zinc-700 dark:bg-zinc-950/40">
                        <span>중분류1</span>
                        <Switch checked={showGanttMiddle1Category} onCheckedChange={setShowGanttMiddle1Category} />
                      </label>
                      <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-[12px] dark:border-zinc-700 dark:bg-zinc-950/40">
                        <span>중분류2</span>
                        <Switch checked={showGanttMiddle2Category} onCheckedChange={setShowGanttMiddle2Category} />
                      </label>
                      <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-[12px] dark:border-zinc-700 dark:bg-zinc-950/40">
                        <span>소분류</span>
                        <Switch checked={showGanttSmallCategory} onCheckedChange={setShowGanttSmallCategory} />
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900/50">
                  <label className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700">
                    <Switch checked={showGanttMajorCategory} onCheckedChange={setShowGanttMajorCategory} />
                    <span>대분류</span>
                  </label>
                  <label className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700">
                    <Switch checked={showGanttMiddle1Category} onCheckedChange={setShowGanttMiddle1Category} />
                    <span>중분류1</span>
                  </label>
                  <label className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700">
                    <Switch checked={showGanttMiddle2Category} onCheckedChange={setShowGanttMiddle2Category} />
                    <span>중분류2</span>
                  </label>
                  <label className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700">
                    <Switch checked={showGanttSmallCategory} onCheckedChange={setShowGanttSmallCategory} />
                    <span>소분류</span>
                  </label>
                </div>
              )}
            </div>
          ) : (
            <div
              className={cn(
                "flex min-w-0 gap-1 rounded-xl border border-zinc-200/80 bg-zinc-50/70 py-1 dark:border-zinc-700 dark:bg-zinc-900/50",
                isMobilePortrait ? "w-full flex-col px-2" : "flex-wrap items-center px-2",
              )}
            >
              {isMobilePortrait ? (
                <div className="mt-1 flex w-full min-w-0 flex-col gap-2 rounded-xl border border-zinc-200/60 bg-white/40 p-2 dark:border-zinc-600 dark:bg-zinc-900/30">
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-[12px] dark:border-zinc-700 dark:bg-zinc-950/40">
                    <span>공종 열</span>
                    <Switch checked={showFieldMainCategory} onCheckedChange={setShowFieldMainCategory} />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-[12px] dark:border-zinc-700 dark:bg-zinc-950/40">
                    <span>중분류1 열</span>
                    <Switch checked={showFieldMiddle1Category} onCheckedChange={setShowFieldMiddle1Category} />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-[12px] dark:border-zinc-700 dark:bg-zinc-950/40">
                    <span>중분류2 열</span>
                    <Switch checked={showFieldMiddle2Category} onCheckedChange={setShowFieldMiddle2Category} />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-[12px] dark:border-zinc-700 dark:bg-zinc-950/40">
                    <span>세부공종 열</span>
                    <Switch checked={showFieldSmallCategory} onCheckedChange={setShowFieldSmallCategory} />
                  </label>
                </div>
              ) : (
                <>
                  <div className="h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-600" aria-hidden />
                  <label className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700">
                    <Switch checked={showFieldMainCategory} onCheckedChange={setShowFieldMainCategory} />
                    <span>공종</span>
                  </label>
                  <label className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700">
                    <Switch checked={showFieldMiddle1Category} onCheckedChange={setShowFieldMiddle1Category} />
                    <span>중분류1</span>
                  </label>
                  <label className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700">
                    <Switch checked={showFieldMiddle2Category} onCheckedChange={setShowFieldMiddle2Category} />
                    <span>중분류2</span>
                  </label>
                  <label className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700">
                    <Switch checked={showFieldSmallCategory} onCheckedChange={setShowFieldSmallCategory} />
                    <span>세부공종</span>
                  </label>
                </>
              )}
            </div>
          )}
                </div>
              </div>
              {isGanttView ? (
                <div
                  className={cn(
                    "rounded-xl border border-zinc-200/80 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950/35",
                    scheduleDetailStacked ? "w-full p-2.5" : "min-w-0 max-w-[min(100%,520px)] shrink-0 p-2",
                  )}
                >
                  <p
                    className={cn(
                      "font-semibold text-zinc-600 dark:text-zinc-400",
                      scheduleDetailStacked ? "mb-2 text-[11px]" : "mb-1.5 text-[10px]",
                    )}
                  >
                    작업뷰 · 목록에 보이는 작업
                  </p>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Select
                      value={filters.completion}
                      onValueChange={(value) => updateFilter("completion", value as "all" | "complete" | "incomplete")}
                    >
                      <SelectTrigger className="min-w-0 max-w-full w-[132px] border-zinc-200 bg-slate-100/80 text-zinc-900 shadow-none dark:border-zinc-700 dark:bg-zinc-900">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All status</SelectItem>
                        <SelectItem value="complete">Complete</SelectItem>
                        <SelectItem value="incomplete">Incomplete</SelectItem>
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                      <Switch checked={filters.milestoneOnly} onCheckedChange={(checked) => updateFilter("milestoneOnly", checked)} />
                      Milestones only
                    </label>
                    <label className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                      <Switch checked={activityOnlyView} onCheckedChange={setActivityOnlyView} />
                      Activity만 보기
                    </label>
                    <label className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                      <Switch checked={filters.hideCompleted} onCheckedChange={(checked) => updateFilter("hideCompleted", checked)} />
                      진행률 100% 숨기기
                    </label>
                    <label className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                      <Switch checked={filters.hidePast} onCheckedChange={(checked) => updateFilter("hidePast", checked)} />
                      지난 태스크 숨기기
                    </label>
                  </div>
                </div>
              ) : null}
              <div
                className={cn(
                  "rounded-xl border border-zinc-200/80 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950/35",
                  scheduleDetailStacked ? "w-full p-2.5" : "min-w-0 max-w-[min(100%,480px)] shrink-0 p-2",
                )}
              >
                <p
                  className={cn(
                    "font-semibold text-zinc-600 dark:text-zinc-400",
                    scheduleDetailStacked ? "mb-2 text-[11px]" : "mb-1.5 text-[10px]",
                  )}
                >
                  타임라인 · 달력·요일
                </p>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div ref={calendarVisibilityRef} className="relative">
            <Button variant="secondary" size="sm" onClick={() => setCalendarVisibilityOpen((prev) => !prev)}>
              <CalendarDays className="size-4" /> 일정 표시
            </Button>
            {calendarVisibilityOpen ? (
              <div className="absolute left-0 top-10 z-[90] w-56 rounded-xl border border-zinc-200 bg-zinc-50 p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <label className="flex items-center justify-between rounded-lg px-2 py-2 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
                  토요일 숨김
                  <Switch
                    checked={timelineVisibility.hideSaturday}
                    onCheckedChange={(checked) => updateTimelineVisibility("hideSaturday", checked)}
                  />
                </label>
                <label className="mt-1 flex items-center justify-between rounded-lg px-2 py-2 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
                  일요일 숨김
                  <Switch
                    checked={timelineVisibility.hideSunday}
                    onCheckedChange={(checked) => updateTimelineVisibility("hideSunday", checked)}
                  />
                </label>
                <label className="mt-1 flex items-center justify-between rounded-lg px-2 py-2 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
                  공휴일 숨김
                  <Switch
                    checked={timelineVisibility.hideHoliday}
                    onCheckedChange={(checked) => updateTimelineVisibility("hideHoliday", checked)}
                  />
                </label>
              </div>
            ) : null}
          </div>
          {isGanttView ? (
            <div className="flex items-center gap-2 rounded-xl border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700">
              <span className="shrink-0 text-zinc-500 dark:text-zinc-400">연결선</span>
              <div className="flex items-center gap-0.5">
                {([1, 1.2, 1.5, 2] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    className={`rounded px-1.5 py-0.5 text-[10px] ${dependencyLineStrokeWidth === w ? "bg-zinc-200 dark:bg-zinc-600" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                    onClick={() => setDependencyLineStrokeWidth(w)}
                    title={`두께 ${w}`}
                  >
                    {w}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-0.5">
                {[
                  { key: "blue", value: "rgba(59,130,246,0.88)", title: "파랑" },
                  { key: "slate", value: "rgba(71,85,105,0.88)", title: "회색" },
                  { key: "emerald", value: "rgba(16,185,129,0.88)", title: "초록" },
                  { key: "violet", value: "rgba(139,92,246,0.88)", title: "보라" },
                ].map(({ key, value, title }) => (
                  <button
                    key={key}
                    type="button"
                    className={`size-5 rounded border ${dependencyLineColor === value ? "border-zinc-800 ring-1 ring-zinc-400 dark:border-zinc-300" : "border-zinc-300 dark:border-zinc-600"}`}
                    style={{ backgroundColor: value }}
                    onClick={() => setDependencyLineColor(value)}
                    title={title}
                  />
                ))}
              </div>
            </div>
          ) : null}
                </div>
              </div>
              <div
                className={cn(
                  "rounded-xl border border-zinc-200/80 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950/35",
                  scheduleDetailStacked ? "w-full p-2.5" : "min-w-0 w-full max-w-full shrink-0 basis-full p-2",
                )}
              >
                <p
                  className={cn(
                    "font-semibold text-zinc-600 dark:text-zinc-400",
                    scheduleDetailStacked ? "mb-2 text-[11px]" : "mb-1.5 text-[10px]",
                  )}
                >
                  버전 비교
                </p>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
            <Switch
              checked={compareEnabled}
              onCheckedChange={(checked) => {
                setCompareEnabled(checked);
                if (!checked) {
                  setCompareResult(null);
                }
              }}
            />
            <span className="inline-flex items-center gap-1">
              <GitCompareArrows className="size-3.5" /> 버전 비교
            </span>
          </label>
          {compareEnabled ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900/50">
              <Select
                value={selectedPlanVersionId ?? ""}
                onValueChange={(value) => setSelectedPlanVersionId(value || null)}
                disabled={planVersions.length === 0}
              >
                <SelectTrigger className="w-[220px] border-zinc-200 bg-slate-100/80 text-zinc-900 shadow-none dark:border-zinc-700 dark:bg-zinc-900">
                  <SelectValue placeholder={planVersions.length > 0 ? "기준 PLAN 선택" : "PLAN 없음"} />
                </SelectTrigger>
                <SelectContent>
                  {planVersions.map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      {`PLAN v${version.versionNo} · ${version.title}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={selectedActualVersionId ?? ""}
                onValueChange={(value) => setSelectedActualVersionId(value || null)}
                disabled={actualVersions.length === 0}
              >
                <SelectTrigger className="w-[220px] border-zinc-200 bg-slate-100/80 text-zinc-900 shadow-none dark:border-zinc-700 dark:bg-zinc-900">
                  <SelectValue placeholder={actualVersions.length > 0 ? "비교 ACTUAL 선택" : "ACTUAL 없음"} />
                </SelectTrigger>
                <SelectContent>
                  {actualVersions.map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      {`ACTUAL v${version.versionNo} · ${version.title}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={compareVisualization}
                onValueChange={(value) => setCompareVisualization(value as "split" | "baseline")}
              >
                <SelectTrigger className="w-[160px] border-zinc-200 bg-slate-100/80 text-zinc-900 shadow-none dark:border-zinc-700 dark:bg-zinc-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baseline">빨간 기준선</SelectItem>
                  <SelectItem value="split">2행 분리</SelectItem>
                </SelectContent>
              </Select>
              <Badge variant={compareQuery.isFetching ? "warning" : "neutral"}>
                {compareQuery.isFetching
                  ? "비교 계산 중..."
                  : compareSummary
                    ? `변경 ${compareSummary.updated + compareSummary.added + compareSummary.removed}`
                    : "비교 준비"}
              </Badge>
              {compareResult?.calendarDiff.changedFields.length ? (
                <Badge variant="warning">
                  근무일 변경:{" "}
                  {compareResult.calendarDiff.changedFields
                    .map((field) =>
                      ({
                        workMon: "월",
                        workTue: "화",
                        workWed: "수",
                        workThu: "목",
                        workFri: "금",
                        workSat: "토",
                        workSun: "일",
                      })[field],
                    )
                    .join(", ")}
                </Badge>
              ) : null}
            </div>
          ) : null}
                </div>
              </div>
          {isGanttView && !isReadOnly ? (
            <div
              className={cn(
                "rounded-xl border border-zinc-200/80 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950/35",
                scheduleDetailStacked ? "w-full p-2.5" : "min-w-0 max-w-[min(100%,360px)] shrink-0 p-2",
              )}
            >
              <p
                className={cn(
                  "font-semibold text-zinc-600 dark:text-zinc-400",
                  scheduleDetailStacked ? "mb-2 text-[11px]" : "mb-1.5 text-[10px]",
                )}
              >
                스케줄 편집
              </p>
              <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-900/50">
              <label className="flex cursor-pointer items-center gap-1.5">
                <Switch
                  checked={cascadeScheduleOnMove}
                  onCheckedChange={setCascadeScheduleOnMove}
                  aria-describedby="cascade-desc"
                />
                <span className="text-[11px] text-zinc-600 dark:text-zinc-400" id="cascade-desc">
                  {cascadeScheduleOnMove ? "이동 시 후행 연동" : "해당만 이동"}
                </span>
              </label>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-500" title={cascadeScheduleOnMove ? "켜짐: 작업을 옮기면 구속된 후행 작업이 함께 밀림" : "꺼짐: 옮긴 작업만 변경됨"}>
                {cascadeScheduleOnMove ? "연동" : "개별"}
              </span>
              </div>
            </div>
          ) : null}
              <div
                className={cn(
                  "min-w-0 rounded-xl border border-zinc-200/80 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950/35",
                  scheduleDetailStacked ? "w-full p-2.5" : "w-full max-w-full shrink-0 basis-full p-2",
                )}
              >
                <p
                  className={cn(
                    "font-semibold text-zinc-600 dark:text-zinc-400",
                    scheduleDetailStacked ? "mb-2 text-[11px]" : "mb-1.5 text-[10px]",
                  )}
                >
                  빠른 작업
                </p>
                <div
                  className={cn(
                    "flex min-w-0 max-w-full flex-wrap gap-1",
                    scheduleDetailStacked ? "justify-start" : "items-center justify-end",
                  )}
                >
            <Button variant="secondary" onClick={() => void handleUndo()} disabled={isReadOnly}>
              <RotateCcw className="size-4" /> Undo
            </Button>
            <Button variant="secondary" onClick={() => void handleRedo()} disabled={isReadOnly}>
              <RotateCw className="size-4" /> Redo
            </Button>
            <Button variant="secondary" onClick={handleOpenTaskCreateDialog} disabled={isReadOnly}>
              <Plus className="size-4" /> Add Task
            </Button>
            {isGanttView ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={handleExpandAllCategories}
                  disabled={activityOnlyView || categoryRowIds.length === 0}
                  title="분류 전체 펼치기"
                  aria-label="분류 전체 펼치기"
                >
                  <Maximize2 className="size-3.5" />
                  <span>펼침</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={handleCollapseAllCategories}
                  disabled={activityOnlyView || categoryRowIds.length === 0}
                  title="분류 전체 접기"
                  aria-label="분류 전체 접기"
                >
                  <Minimize2 className="size-3.5" />
                  <span>접기</span>
                </Button>
                <Button variant="secondary" onClick={() => setTaskPanelOpen((prev) => !prev)}>
                  {taskPanelOpen ? "목록 숨기기" : "목록 보기"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const containerWidth = containerRef.current?.clientWidth ?? 1200;
                    setTaskPanelWidth(clampTaskPanelWidth(containerWidth * 0.42));
                  }}
                >
                  폭 초기화
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={() => setScheduleFullscreen((prev) => !prev)}
              title={scheduleFullscreen ? "전체화면 해제" : "스케줄 전체화면"}
            >
              {scheduleFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              <span className="hidden sm:inline">{scheduleFullscreen ? "해제" : "전체화면"}</span>
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setSidePanelOpen(!sidePanelOpen)}>
              {sidePanelOpen ? <SidebarClose className="size-4" /> : <SidebarOpen className="size-4" />}
            </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        {isGanttView && !canReorder && isCompareReadOnly ? (
          <div className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">
            <Filter className="size-3.5" /> 버전 비교 중에는 편집이 잠깁니다.
          </div>
        ) : null}
      </Card>

      <div
        className={
          scheduleFullscreen
            ? "fixed inset-0 z-50 flex flex-col bg-zinc-50 dark:bg-zinc-950"
            : ""
        }
      >
        {scheduleFullscreen ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-b border-zinc-200/70 px-3 py-2 dark:border-zinc-800">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">스케줄 전체화면</span>
            <Button variant="outline" size="sm" onClick={() => setScheduleFullscreen(false)}>
              <Minimize2 className="size-4" /> 해제
            </Button>
          </div>
        ) : null}
        <div
          ref={containerRef}
          className={
            scheduleFullscreen
              ? "glass-panel relative z-0 flex min-h-0 flex-1 overflow-hidden rounded-2xl"
              : "glass-panel relative z-0 flex h-[calc(100dvh-128px)] max-[639px]:min-h-[380px] overflow-hidden rounded-2xl sm:h-[calc(100vh-200px)] sm:min-h-[520px] lg:h-[calc(100vh-220px)] lg:min-h-[620px]"
          }
        >
        {isGanttView ? (
          <>
            {taskPanelOpen ? (
              <>
                <TaskGridPanel
                  rows={visibleRowsForRender}
                  selectedRowIds={selectedTaskIds}
                  activeTaskId={activeTaskId}
                  expandedRowIds={expandedTaskIds}
                  canReorder={canReorder}
                  compareMode={isReadOnly}
                  taskDiffById={taskDiffById}
                  widthPx={taskPanelWidth}
                  sensors={sensors}
                  onToggleExpand={toggleExpanded}
                  onSelectRow={handleRowSelect}
                  forceAdditiveSelect={mobileBarTapMulti}
                  onPatchActivity={patchTaskLocal}
                  onDragEnd={handleDragEnd}
                  onScroll={handleLeftScroll}
                  scrollRef={leftScrollRef}
                />

                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize task panel"
                  className={`group relative min-w-[44px] w-11 shrink-0 cursor-col-resize touch-none select-none ${
                    isPanelResizing ? "bg-sky-500/20" : "hover:bg-zinc-300/35 dark:hover:bg-zinc-600/35"
                  }`}
                  style={{ touchAction: "none" }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setIsPanelResizing(true);
                  }}
                  onDoubleClick={() => {
                    const containerWidth = containerRef.current?.clientWidth ?? 1200;
                    setTaskPanelWidth(clampTaskPanelWidth(containerWidth * 0.42));
                  }}
                >
                  <div
                    className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 ${
                      isPanelResizing ? "bg-sky-500" : "bg-zinc-300 dark:bg-zinc-700"
                    }`}
                  />
                  <div className="absolute left-0 right-0 top-0 h-11 bg-sky-500/0 group-hover:bg-sky-500/10" />
                </div>
              </>
            ) : null}

            <TimelinePanel
              tasks={tasksForView}
              visibleRows={visibleRowsForRender}
              dependencies={dependencies}
              compareMode={isCompareReadOnly}
              compareResult={compareResult}
              taskDiffById={taskDiffById}
              compareVisualization={compareVisualization}
              projectHolidayDayKeys={timelineProjectHolidayDayKeys}
              projectHolidays={projectHolidaysForLabels}
              zoomLevel={zoomLevel}
              selectedRowIds={selectedTaskIds}
              dependencyCreateMode={false}
              dependencyConnectActive={Boolean(dependencyConnectState)}
              activeDependencySourceTaskId={activeDependencySourceTaskId}
              dependencyConnectTargetTaskId={dependencyConnectTargetTaskId}
              onSelectRow={handleRowSelect}
              onBarPointerDown={beginBarDrag}
              suppressBarDragClickRef={suppressNextBarDragClickRef}
              onDependencySourceSelect={handleDependencySourceSelect}
              onDependencyConnectStart={handleDependencyConnectStart}
              onDependencyTargetSelect={handleDependencyTargetSelect}
              onCreateTask={handleCreateTimelineTask}
              readOnlySchedule={isReadOnly}
              onScroll={handleRightScroll}
              timelineVisibility={timelineVisibility}
              bodyScrollRef={rightScrollRef}
              headerScrollRef={headerScrollRef}
              dependencyLineStrokeWidth={dependencyLineStrokeWidth}
              dependencyLineColor={dependencyLineColor}
              splitModeTaskId={isReadOnly ? null : fieldSplitTaskId}
              onEnterSplitMode={isReadOnly ? undefined : setFieldSplitTaskId}
              onExitSplitMode={isReadOnly ? undefined : () => setFieldSplitTaskId(null)}
              onSplitCommit={isReadOnly ? undefined : handleGanttSplitCommit}
              onSelectTaskById={(id, add) => handleFieldTaskSelect(id, add || mobileBarTapMulti)}
              mergeContextMenuItemVisible={mergeContextMenuItemVisible}
              onMergeTimelineSegments={isReadOnly ? undefined : onMergeFromScheduleMenu}
              mobileMergePickActive={mobileMergePickMode}
              onMobileMergeLongPressFinish={
                isReadOnly || !mobileMergePickMode ? undefined : () => void handleMergeTimelineSegments()
              }
              enableTouchBarContextMenu={!isReadOnly}
              onCancelTouchBarDrag={cancelPendingTouchBarDrag}
              timelineExtraPastDays={ganttTimelineExtraScroll.past}
              timelineExtraFutureDays={ganttTimelineExtraScroll.future}
              mobileGanttEdgePanEnabled={isMobile && isGanttView}
              onMobileGanttEdgePan={handleMobileGanttEdgePan}
              compactTimelineForTouch={(isMobile || isNarrowPlanner) && isGanttView}
            />
          </>
        ) : (
          <FieldSchedulePanel
            rows={fieldScheduleData.rows}
            range={fieldScheduleData.range}
            scale={fieldScheduleScale}
            compareMode={isReadOnly}
            dependencyCreateMode={false}
            dependencyConnectActive={Boolean(dependencyConnectState)}
            activeDependencySourceTaskId={activeDependencySourceTaskId}
            dependencyConnectTargetTaskId={dependencyConnectTargetTaskId}
            timelineVisibility={timelineVisibility}
            projectHolidayDayKeys={timelineProjectHolidayDayKeys}
            projectHolidays={projectHolidaysForLabels}
            selectedTaskIds={selectedTaskIds}
            showMainCategory={showFieldMainCategory}
            showMiddle1Category={showFieldMiddle1Category}
            showMiddle2Category={showFieldMiddle2Category}
            showSmallCategory={showFieldSmallCategory}
            onSelectTask={(id, add) => handleFieldTaskSelect(id, add || mobileBarTapMulti)}
            onBarPointerDown={(taskId, mode, event, cellWidth) => beginBarDrag(taskId, mode, event, cellWidth)}
            suppressBarDragClickRef={suppressNextBarDragClickRef}
            onDependencySourceSelect={handleDependencySourceSelect}
            onDependencyConnectStart={handleDependencyConnectStart}
            onDependencyTargetSelect={handleDependencyTargetSelect}
            onUpdateTaskLabel={(taskId, nextLabel) => {
              const task = tasks.find((item) => item.id === taskId);
              patchTaskLocal(taskId, {
                siteDisplayText: toStoredSiteDisplayText({
                  siteDisplayText: nextLabel,
                  activityName: task?.activityName,
                  name: task?.name,
                }),
              });
            }}
            onCreateTask={handleCreateFieldTask}
            splitModeTaskId={fieldSplitTaskId}
            onEnterFieldSplitMode={setFieldSplitTaskId}
            onExitFieldSplitMode={() => setFieldSplitTaskId(null)}
            onFieldSplitCommit={handleFieldPanelSplitCommit}
            mergeContextMenuItemVisible={mergeContextMenuItemVisible}
            onMergeTimelineSegments={isReadOnly ? undefined : onMergeFromScheduleMenu}
            mobileMergePickActive={mobileMergePickMode}
            onMobileMergeLongPressFinish={
              isReadOnly || !mobileMergePickMode ? undefined : () => void handleMergeTimelineSegments()
            }
            enableTouchBarContextMenu={!isReadOnly}
            onCancelTouchBarDrag={cancelPendingTouchBarDrag}
            /** 모바일: 가로 끝 스와이프로 주·월 넘기지 않음 — 이전/다음 버튼만 사용 */
            mobileFieldEdgePanEnabled={isFieldView && !isMobile}
            onMobileFieldEdgePan={handleMobileFieldEdgePan}
            suppressBrowserTouchCallout={!isReadOnly && (isMobile || isNarrowPlanner)}
          />
        )}

        {sidePanelOpen ? (
          <div className="w-full max-w-full shrink-0 border-l border-zinc-200/70 p-2 dark:border-zinc-800 sm:w-[340px]">
            <TaskDetailPanel
              task={selectedTask}
              readOnly={isReadOnly}
              tasks={tasks}
              dependencies={dependencies}
              calendar={calendar}
              companies={companies}
              holidays={holidays}
              onTaskSave={async (taskId, patch) => {
                patchTaskLocal(taskId, patch, { withHistory: true, persist: true });
              }}
              onTaskDelete={handleDeleteTask}
              onCreateDependency={async (payload) => {
                await createDependencyWithOptimistic(payload);
              }}
              onDeleteDependency={async (dependencyId) => {
                const previous = dependencies;
                setDependencies((prev) => prev.filter((dependency) => dependency.id !== dependencyId));
                try {
                  await mutations.deleteDependency.mutateAsync(dependencyId);
                  await onRefetch();
                  setSavingState({ saving: false, error: null, lastSavedAt: new Date().toISOString() });
                } catch (error) {
                  setDependencies(previous);
                  toast.error(error instanceof Error ? error.message : "Failed to delete dependency");
                }
              }}
              onUpdateDependency={async (dependencyId, payload) => {
                const previous = dependencies;
                try {
                  await mutations.updateDependency.mutateAsync({ dependencyId, payload });
                  await onRefetch();
                  setSavingState({ saving: false, error: null, lastSavedAt: new Date().toISOString() });
                  toast.success("구속을 수정했습니다.");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Failed to update dependency");
                }
              }}
              onUpdateCalendar={async (patch) => {
                const previous = calendar;
                setCalendar((prev) => ({ ...prev, ...patch }));
                try {
                  await mutations.updateCalendar.mutateAsync(patch);
                  await onRefetch();
                  setSavingState({ saving: false, error: null, lastSavedAt: new Date().toISOString() });
                } catch (error) {
                  setCalendar(previous);
                  toast.error(error instanceof Error ? error.message : "Failed to save calendar");
                }
              }}
              onCreateCompany={async (payload) => {
                try {
                  const createdCompany = await mutations.createCompany.mutateAsync(payload);
                  await onRefetch();
                  setSavingState({ saving: false, error: null, lastSavedAt: new Date().toISOString() });
                  return createdCompany;
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Failed to create company");
                  throw error;
                }
              }}
              onDeleteCompany={async (companyId) => {
                try {
                  await mutations.deleteCompany.mutateAsync(companyId);
                  await onRefetch();
                  setSavingState({ saving: false, error: null, lastSavedAt: new Date().toISOString() });
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Failed to delete company");
                }
              }}
              onCreateHoliday={async (payload) => {
                try {
                  await mutations.createHoliday.mutateAsync(payload);
                  await onRefetch();
                  setSavingState({ saving: false, error: null, lastSavedAt: new Date().toISOString() });
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Failed to create holiday");
                }
              }}
              onUpdateHoliday={async (holidayId, payload) => {
                try {
                  await mutations.updateHoliday.mutateAsync({ holidayId, payload });
                  await onRefetch();
                  setSavingState({ saving: false, error: null, lastSavedAt: new Date().toISOString() });
                  toast.success("휴일을 수정했습니다.");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Failed to update holiday");
                }
              }}
              onDeleteHoliday={async (holidayId) => {
                try {
                  await mutations.deleteHoliday.mutateAsync(holidayId);
                  await onRefetch();
                  setSavingState({ saving: false, error: null, lastSavedAt: new Date().toISOString() });
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Failed to delete holiday");
                }
              }}
            />
          </div>
        ) : null}
        </div>
      </div>

      {dependencyConnectState ? (
        <div className="pointer-events-none fixed inset-0 z-[120]">
          <svg className="h-full w-full">
            <defs>
              <marker id="dependency-connect-arrow" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto">
                <polygon points="0 0, 8 4, 0 8" fill="rgba(59, 130, 246, 0.95)" />
              </marker>
              <marker id="dependency-connect-arrow-ok" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto">
                <polygon points="0 0, 8 4, 0 8" fill="rgba(5, 150, 105, 0.98)" />
              </marker>
            </defs>
            <path
              d={`M ${dependencyConnectState.sourceClientX} ${dependencyConnectState.sourceClientY} C ${dependencyConnectState.sourceClientX + 64} ${dependencyConnectState.sourceClientY}, ${dependencyConnectState.currentClientX - 64} ${dependencyConnectState.currentClientY}, ${dependencyConnectState.currentClientX} ${dependencyConnectState.currentClientY}`}
              fill="none"
              stroke={dependencyConnectTargetTaskId ? "rgba(5, 150, 105, 0.98)" : "rgba(59, 130, 246, 0.95)"}
              strokeWidth={3}
              markerEnd={dependencyConnectTargetTaskId ? "url(#dependency-connect-arrow-ok)" : "url(#dependency-connect-arrow)"}
            />
            <circle cx={dependencyConnectState.sourceClientX} cy={dependencyConnectState.sourceClientY} r={5} fill={dependencyConnectTargetTaskId ? "rgba(5, 150, 105, 0.98)" : "rgba(59, 130, 246, 0.95)"} />
          </svg>
        </div>
      ) : null}

      <Dialog
        open={taskCreateDialogOpen}
        onOpenChange={(open) => {
          setTaskCreateDialogOpen(open);
          if (!open) {
            setTaskCreateDraft(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>작업 생성</DialogTitle>
            <DialogDescription>속성을 입력한 뒤 저장하면 작업이 생성됩니다.</DialogDescription>
          </DialogHeader>
          {taskCreateDraft ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Activity</Label>
                  <Input
                    value={taskCreateDraft.activityName}
                    onChange={(event) =>
                      setTaskCreateDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              activityName: event.target.value,
                              siteDisplayText: prev.siteDisplayTextManual ? prev.siteDisplayText : event.target.value,
                            }
                          : prev,
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>현장표 문구</Label>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span>별도 수정</span>
                      <Switch
                        checked={taskCreateDraft.siteDisplayTextManual}
                        onCheckedChange={(checked) =>
                          setTaskCreateDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  siteDisplayTextManual: checked,
                                  siteDisplayText: checked
                                    ? resolveSiteDisplayText({
                                        siteDisplayText: prev.siteDisplayText,
                                        activityName: prev.activityName,
                                      })
                                    : prev.activityName,
                                }
                              : prev,
                          )
                        }
                      />
                    </div>
                  </div>
                  <Input
                    value={taskCreateDraft.siteDisplayTextManual ? taskCreateDraft.siteDisplayText : taskCreateDraft.activityName}
                    disabled={!taskCreateDraft.siteDisplayTextManual}
                    onChange={(event) =>
                      setTaskCreateDraft((prev) => (prev ? { ...prev, siteDisplayText: event.target.value } : prev))
                    }
                    placeholder={taskCreateDraft.siteDisplayTextManual ? "현장표 셀 문구" : "Activity와 자동 연동"}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>대분류</Label>
                  <SuggestionInput
                    options={majorCategoryOptions}
                    value={taskCreateDraft.categoryMajor}
                    onValueChange={(value) =>
                      setTaskCreateDraft((prev) => (prev ? { ...prev, categoryMajor: value } : prev))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>중분류1</Label>
                  <SuggestionInput
                    options={middle1CategoryOptions}
                    value={taskCreateDraft.categoryMiddle1}
                    onValueChange={(value) =>
                      setTaskCreateDraft((prev) => (prev ? { ...prev, categoryMiddle1: value } : prev))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>중분류2</Label>
                  <SuggestionInput
                    options={middle2CategoryOptions}
                    value={taskCreateDraft.categoryMiddle2}
                    onValueChange={(value) =>
                      setTaskCreateDraft((prev) => (prev ? { ...prev, categoryMiddle2: value } : prev))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>소분류</Label>
                  <SuggestionInput
                    options={smallCategoryOptions}
                    value={taskCreateDraft.categorySmall}
                    onValueChange={(value) =>
                      setTaskCreateDraft((prev) => (prev ? { ...prev, categorySmall: value } : prev))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>대표공종</Label>
                  <SuggestionInput
                    options={siteMainCategoryOptions}
                    value={taskCreateDraft.siteMainCategory}
                    onValueChange={(value) =>
                      setTaskCreateDraft((prev) => (prev ? { ...prev, siteMainCategory: value } : prev))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>담당자</Label>
                  <SuggestionInput
                    options={assigneeOptions}
                    value={taskCreateDraft.assignee}
                    onValueChange={(value) =>
                      setTaskCreateDraft((prev) => (prev ? { ...prev, assignee: value } : prev))
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>업체</Label>
                  <SuggestionInput
                    options={companyNameOptions}
                    value={taskCreateDraft.companyName}
                    onValueChange={(value) =>
                      setTaskCreateDraft((prev) => (prev ? { ...prev, companyName: value } : prev))
                    }
                    placeholder="입력하거나 기존 업체 선택"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>시작일</Label>
                  <Input
                    type="date"
                    value={taskCreateDraft.startDate}
                    onChange={(event) => {
                      const startDate = event.target.value;
                      setTaskCreateDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              startDate,
                              endDate: addDaysToDateString(startDate, prev.durationDays - 1),
                            }
                          : prev,
                      );
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>종료일</Label>
                  <Input
                    type="date"
                    value={taskCreateDraft.endDate}
                    onChange={(event) => {
                      const endDate = event.target.value;
                      setTaskCreateDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              endDate,
                              durationDays: getDurationDays(prev.startDate, endDate),
                            }
                          : prev,
                      );
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>기간 (일)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={taskCreateDraft.durationDays}
                    onChange={(event) => {
                      const durationDays = Math.max(1, Number(event.target.value) || 1);
                      setTaskCreateDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              durationDays,
                              endDate: addDaysToDateString(prev.startDate, durationDays - 1),
                            }
                          : prev,
                      );
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>진척률</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={taskCreateDraft.progress}
                    onChange={(event) =>
                      setTaskCreateDraft((prev) =>
                        prev ? { ...prev, progress: Number(event.target.value) || 0 } : prev,
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>색상</Label>
                  <Input
                    type="color"
                    value={taskCreateDraft.color}
                    onChange={(event) =>
                      setTaskCreateDraft((prev) => (prev ? { ...prev, color: event.target.value } : prev))
                    }
                    className="h-10 p-1"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
                <Switch
                  checked={taskCreateDraft.isMilestone}
                  onCheckedChange={(checked) =>
                    setTaskCreateDraft((prev) => (prev ? { ...prev, isMilestone: checked } : prev))
                  }
                />
                마일스톤으로 생성
              </label>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setTaskCreateDialogOpen(false)}>
                  취소
                </Button>
                <Button onClick={() => void handleCreateTask()}>저장 후 생성</Button>
              </div>

            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={dependencyDialogOpen}
        onOpenChange={(open) => {
          setDependencyDialogOpen(open);
          if (!open) {
            setDependencyConnectState(null);
            setPendingDependencySourceTaskId(null);
            setDependencyDraft({
              predecessorTaskId: "",
              successorTaskId: "",
              type: "FS",
              mode: "lag",
              offsetDays: 0,
              drivesSchedule: false,
            });
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>연결관계 생성</DialogTitle>
            <DialogDescription>선행과 후행 사이의 관계 타입과 Lead/Lag를 설정합니다.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>선행 작업</Label>
              <div className="rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
                {tasks.find((task) => task.id === dependencyDraft.predecessorTaskId)?.activityName ??
                  tasks.find((task) => task.id === dependencyDraft.predecessorTaskId)?.name ??
                  "-"}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>후행 작업</Label>
              <div className="rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
                {tasks.find((task) => task.id === dependencyDraft.successorTaskId)?.activityName ??
                  tasks.find((task) => task.id === dependencyDraft.successorTaskId)?.name ??
                  "-"}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>관계</Label>
                <Select
                  value={dependencyDraft.type}
                  onValueChange={(value) =>
                    setDependencyDraft((prev) => ({ ...prev, type: value as DependencyType }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FS">FS</SelectItem>
                    <SelectItem value="SS">SS</SelectItem>
                    <SelectItem value="FF">FF</SelectItem>
                    <SelectItem value="SF">SF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>모드</Label>
                <Select
                  value={dependencyDraft.mode}
                  onValueChange={(value) =>
                    setDependencyDraft((prev) => ({ ...prev, mode: value as "lag" | "lead" }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lag">Lag</SelectItem>
                    <SelectItem value="lead">Lead</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>일수</Label>
                <Input
                  type="number"
                  min={0}
                  value={dependencyDraft.offsetDays}
                  onChange={(event) =>
                    setDependencyDraft((prev) => ({
                      ...prev,
                      offsetDays: Math.max(0, Number(event.target.value) || 0),
                    }))
                  }
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
              <div>
                <p className="text-sm font-medium">스케줄 연동</p>
                <p className="text-xs text-muted">끄면 연결만 추가하고 일정은 그대로 둡니다.</p>
              </div>
              <Switch
                checked={dependencyDraft.drivesSchedule}
                onCheckedChange={(checked) =>
                  setDependencyDraft((prev) => ({ ...prev, drivesSchedule: checked }))
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDependencyDialogOpen(false)}>
                취소
              </Button>
              <Button onClick={() => void handleCreateDependencyFromDialog()}>저장</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}



















