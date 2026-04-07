"use client";

import { create } from "zustand";

import type {
  FieldScheduleScale,
  PlannerViewMode,
  PersistedState,
  ProjectVersionCompareResult,
  TaskModel,
  ZoomLevel,
} from "@/types/domain";

interface Filters {
  query: string;
  assignee: string;
  companyId: string;
  siteMainCategories: string[];
  majorCategories: string[];
  middle1Categories: string[];
  middle2Categories: string[];
  smallCategories: string[];
  completion: "all" | "complete" | "incomplete";
  milestoneOnly: boolean;
  sortBy: "sortOrder" | "startDate" | "endDate";
  /** 진행률 100%인 태스크 목록에서 숨김 */
  hideCompleted: boolean;
  /** 종료일이 오늘 이전인(지난) 태스크 목록에서 숨김 */
  hidePast: boolean;
}

interface TimelineVisibility {
  hideSaturday: boolean;
  hideSunday: boolean;
  hideHoliday: boolean;
}

interface HistoryState {
  past: TaskModel[][];
  future: TaskModel[][];
}

interface GanttStore extends PersistedState {
  zoomLevel: ZoomLevel;
  plannerViewMode: PlannerViewMode;
  fieldScheduleScale: FieldScheduleScale;
  fieldAnchorDate: string;
  selectedTaskIds: string[];
  activeTaskId: string | null;
  expandedTaskIds: string[];
  sidePanelOpen: boolean;
  compareEnabled: boolean;
  selectedPlanVersionId: string | null;
  selectedActualVersionId: string | null;
  compareVisualization: "split" | "baseline";
  compareResult: ProjectVersionCompareResult | null;
  filters: Filters;
  timelineVisibility: TimelineVisibility;
  history: HistoryState;
  setZoomLevel: (zoomLevel: ZoomLevel) => void;
  setPlannerViewMode: (mode: PlannerViewMode) => void;
  setFieldScheduleScale: (scale: FieldScheduleScale) => void;
  setFieldAnchorDate: (anchorDate: string) => void;
  setSelectedTaskIds: (taskIds: string[]) => void;
  toggleTaskSelection: (taskId: string, additive?: boolean) => void;
  setActiveTaskId: (taskId: string | null) => void;
  setExpandedTaskIds: (taskIds: string[]) => void;
  toggleExpanded: (taskId: string) => void;
  setSidePanelOpen: (open: boolean) => void;
  setCompareEnabled: (enabled: boolean) => void;
  setSelectedPlanVersionId: (versionId: string | null) => void;
  setSelectedActualVersionId: (versionId: string | null) => void;
  setCompareVisualization: (mode: "split" | "baseline") => void;
  setCompareResult: (result: ProjectVersionCompareResult | null) => void;
  clearCompare: () => void;
  updateFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  updateTimelineVisibility: <K extends keyof TimelineVisibility>(key: K, value: TimelineVisibility[K]) => void;
  setSavingState: (next: Partial<PersistedState>) => void;
  pushHistory: (tasks: TaskModel[]) => void;
  undo: (current: TaskModel[]) => TaskModel[] | null;
  redo: (current: TaskModel[]) => TaskModel[] | null;
  clearHistory: () => void;
}

const HISTORY_LIMIT = 80;

export const useGanttStore = create<GanttStore>((set, get) => ({
  zoomLevel: "week",
  plannerViewMode: "GANTT",
  fieldScheduleScale: "MONTHLY",
  fieldAnchorDate: new Date().toISOString(),
  selectedTaskIds: [],
  activeTaskId: null,
  expandedTaskIds: [],
  sidePanelOpen: false,
  compareEnabled: false,
  selectedPlanVersionId: null,
  selectedActualVersionId: null,
  compareVisualization: "baseline",
  compareResult: null,
  filters: {
    query: "",
    assignee: "all",
    companyId: "all",
    siteMainCategories: [],
    majorCategories: [],
    middle1Categories: [],
    middle2Categories: [],
    smallCategories: [],
    completion: "all",
    milestoneOnly: false,
    sortBy: "sortOrder",
    hideCompleted: false,
    hidePast: false,
  },
  timelineVisibility: {
    hideSaturday: false,
    hideSunday: false,
    hideHoliday: false,
  },
  lastSavedAt: null,
  saving: false,
  error: null,
  history: {
    past: [],
    future: [],
  },
  setZoomLevel: (zoomLevel) => set({ zoomLevel }),
  setPlannerViewMode: (plannerViewMode) => set({ plannerViewMode }),
  setFieldScheduleScale: (fieldScheduleScale) => set({ fieldScheduleScale }),
  setFieldAnchorDate: (fieldAnchorDate) => set({ fieldAnchorDate }),
  setSelectedTaskIds: (taskIds) =>
    set({
      selectedTaskIds: taskIds,
    }),
  toggleTaskSelection: (taskId, additive = false) => {
    const selectedTaskIds = get().selectedTaskIds;

    if (!additive) {
      set({ selectedTaskIds: [taskId], activeTaskId: taskId });
      return;
    }

    if (selectedTaskIds.includes(taskId)) {
      set({ selectedTaskIds: selectedTaskIds.filter((id) => id !== taskId), activeTaskId: taskId });
      return;
    }

    set({ selectedTaskIds: [...selectedTaskIds, taskId], activeTaskId: taskId });
  },
  setExpandedTaskIds: (taskIds) => set({ expandedTaskIds: taskIds }),
  setActiveTaskId: (taskId) => set({ activeTaskId: taskId }),
  toggleExpanded: (taskId) => {
    const expandedTaskIds = get().expandedTaskIds;
    if (expandedTaskIds.includes(taskId)) {
      set({ expandedTaskIds: expandedTaskIds.filter((id) => id !== taskId) });
      return;
    }
    set({ expandedTaskIds: [...expandedTaskIds, taskId] });
  },
  setSidePanelOpen: (open) => set({ sidePanelOpen: open }),
  setCompareEnabled: (enabled) => set({ compareEnabled: enabled }),
  setSelectedPlanVersionId: (versionId) => set({ selectedPlanVersionId: versionId }),
  setSelectedActualVersionId: (versionId) => set({ selectedActualVersionId: versionId }),
  setCompareVisualization: (mode) => set({ compareVisualization: mode }),
  setCompareResult: (result) => set({ compareResult: result }),
  clearCompare: () =>
    set({
      compareEnabled: false,
      selectedPlanVersionId: null,
      selectedActualVersionId: null,
      compareResult: null,
    }),
  updateFilter: (key, value) =>
    set((state) => ({
      filters: {
        ...state.filters,
        [key]: value,
      },
    })),
  updateTimelineVisibility: (key, value) =>
    set((state) => ({
      timelineVisibility: {
        ...state.timelineVisibility,
        [key]: value,
      },
    })),
  setSavingState: (next) => set((state) => ({ ...state, ...next })),
  pushHistory: (tasks) =>
    set((state) => {
      const nextPast = [...state.history.past, tasks.map((task) => ({ ...task }))].slice(-HISTORY_LIMIT);
      return {
        history: {
          past: nextPast,
          future: [],
        },
      };
    }),
  undo: (current) => {
    const history = get().history;
    if (history.past.length === 0) {
      return null;
    }

    const previous = history.past[history.past.length - 1];
    const nextPast = history.past.slice(0, -1);

    set({
      history: {
        past: nextPast,
        future: [current.map((task) => ({ ...task })), ...history.future],
      },
    });

    return previous.map((task) => ({ ...task }));
  },
  redo: (current) => {
    const history = get().history;
    if (history.future.length === 0) {
      return null;
    }

    const next = history.future[0];
    const nextFuture = history.future.slice(1);

    set({
      history: {
        past: [...history.past, current.map((task) => ({ ...task }))].slice(-HISTORY_LIMIT),
        future: nextFuture,
      },
    });

    return next.map((task) => ({ ...task }));
  },
  clearHistory: () =>
    set({
      history: {
        past: [],
        future: [],
      },
    }),
}));
