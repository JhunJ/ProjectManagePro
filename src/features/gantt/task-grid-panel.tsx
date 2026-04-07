"use client";

import * as React from "react";
import type { DragEndEvent, SensorDescriptor, SensorOptions } from "@dnd-kit/core";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn, formatDateKorean } from "@/lib/utils";
import { rollupTimelineActivityRow } from "@/features/tasks/timeline-row-rollup";
import type { TaskCompareItem, TaskListRow, TaskModel } from "@/types/domain";

export const ROW_HEIGHT = 52;
const GRID_TEMPLATE_COLUMNS = "minmax(290px,1fr) 96px 68px 94px 94px 56px";
const GRID_TEMPLATE_COLUMNS_NARROW = "minmax(200px,1fr) 72px 56px 72px 72px 44px";
const GRID_MIN_WIDTH_PX = 700;
const GRID_MIN_WIDTH_PX_NARROW = 520;

const COLUMN_STORAGE_KEY = "pmp:task-grid-column-widths";
const COLUMN_KEYS = ["task", "assignee", "duration", "start", "end", "progress"] as const;
const DEFAULT_COLUMN_WIDTHS: Record<(typeof COLUMN_KEYS)[number], number> = {
  task: 290,
  assignee: 96,
  duration: 68,
  start: 94,
  end: 94,
  progress: 56,
};
const MIN_COLUMN_WIDTHS: Record<(typeof COLUMN_KEYS)[number], number> = {
  task: 200,
  assignee: 60,
  duration: 50,
  start: 70,
  end: 70,
  progress: 44,
};

function buildGridTemplateFromWidths(widths: number[]): string {
  if (widths.length !== 6) return GRID_TEMPLATE_COLUMNS;
  // 첫 컬럼도 고정 px 사용 → 리사이즈 시 경계가 마우스를 따라가도록
  return `${widths[0]}px ${widths[1]}px ${widths[2]}px ${widths[3]}px ${widths[4]}px ${widths[5]}px`;
}

function getCompareStatusLabel(status: TaskCompareItem["status"]) {
  if (status === "ADDED") return "추가";
  if (status === "REMOVED") return "삭제";
  if (status === "UPDATED") return "변경";
  return "동일";
}

function getCategoryTone(level: "major" | "middle1" | "middle2" | "small") {
  if (level === "major") {
    return {
      rowClass: "bg-slate-50/85 dark:bg-zinc-900/30",
      leftClass: "bg-slate-100/90 dark:bg-zinc-900/55",
      labelClass: "text-zinc-900 dark:text-zinc-100",
      badgeClass: "bg-slate-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
    };
  }

  if (level === "middle1") {
    return {
      rowClass: "bg-slate-100/70 dark:bg-zinc-900/40",
      leftClass: "bg-slate-200/75 dark:bg-zinc-800/65",
      labelClass: "text-zinc-900 dark:text-zinc-100",
      badgeClass: "bg-slate-300 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
    };
  }

  if (level === "middle2") {
    return {
      rowClass: "bg-slate-200/55 dark:bg-zinc-800/45",
      leftClass: "bg-slate-300/65 dark:bg-zinc-800/75",
      labelClass: "text-zinc-800 dark:text-zinc-100",
      badgeClass: "bg-slate-300 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
    };
  }

  return {
    rowClass: "bg-slate-300/45 dark:bg-zinc-800/50",
    leftClass: "bg-slate-300/70 dark:bg-zinc-700/70",
    labelClass: "text-zinc-800 dark:text-zinc-100",
    badgeClass: "bg-slate-400 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  };
}

interface RowProps {
  row: TaskListRow;
  selected: boolean;
  active: boolean;
  canReorder: boolean;
  compareMode: boolean;
  compareItem: TaskCompareItem | null;
  isExpanded: boolean;
  gridTemplate: string;
  gridMinWidth: number;
  onToggleExpand: (rowId: string) => void;
  onSelectRow: (row: TaskListRow, additive: boolean) => void;
  forceAdditiveSelect?: boolean;
  onPatchActivity: (taskId: string, patch: Partial<TaskModel>) => void;
}

function SortableTaskRow({
  row,
  selected,
  active,
  canReorder,
  compareMode,
  compareItem,
  isExpanded,
  gridTemplate,
  gridMinWidth,
  onToggleExpand,
  onSelectRow,
  forceAdditiveSelect = false,
  onPatchActivity,
}: RowProps) {
  const isCategoryRow = row.rowType === "CATEGORY_ROW";
  const task = row.rowType === "ACTIVITY_ROW" ? row.task : null;
  const timelineRollup =
    row.rowType === "ACTIVITY_ROW" && row.timelineSegmentTasks?.length
      ? rollupTimelineActivityRow(row.task, row.timelineSegmentTasks)
      : null;
  const listStartDate = timelineRollup?.startDate ?? task?.startDate;
  const listEndDate = timelineRollup?.endDate ?? task?.endDate;
  const listWorkingDays = timelineRollup?.workingDaysTotal ?? task?.durationDays;
  const categoryTone = isCategoryRow ? getCategoryTone(row.level) : null;

  const [name, setName] = React.useState(task?.activityName ?? task?.name ?? row.label);
  const [progress, setProgress] = React.useState(task?.progress ?? 0);
  const isComplete = task ? task.progress >= 100 : false;
  const isAdded = compareItem?.status === "ADDED";
  const isRemoved = compareItem?.status === "REMOVED";
  const isUpdated = compareItem?.status === "UPDATED";
  const showCompareStatus = compareMode && Boolean(compareItem && compareItem.status !== "UNCHANGED");
  const categoryPath = task
    ? [task.categoryMajor, task.categoryMiddle1, task.categoryMiddle2, task.categorySmall]
        .filter((value): value is string => Boolean(value))
        .join(" / ")
    : "";
  const activityLabel = task?.activityName?.trim() || task?.name || row.label;

  React.useEffect(() => {
    setName(activityLabel);
    setProgress(task?.progress ?? 0);
  }, [activityLabel, task?.progress]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.rowId,
    disabled: !canReorder,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        height: ROW_HEIGHT,
        gridTemplateColumns: gridTemplate,
        minWidth: gridMinWidth,
      }}
      className={cn(
        "group relative grid items-center border-b border-zinc-200/70 text-sm dark:border-zinc-800",
        isComplete && !selected && "task-complete-hatch",
        active && !selected && "ring-1 ring-inset ring-[var(--accent)]",
        selected &&
          (isCategoryRow
            ? "bg-[var(--selection)] ring-2 ring-inset ring-amber-500/80 dark:ring-amber-400/75"
            : "bg-amber-50/95 ring-2 ring-inset ring-amber-500/90 dark:bg-amber-950/45 dark:ring-amber-400/85"),
        isDragging && "opacity-60",
        isAdded && "border-l-4 border-emerald-500",
        isUpdated && "border-l-4 border-amber-500",
        isRemoved && "border-l-4 border-red-500",
        isCategoryRow && categoryTone?.rowClass,
      )}
      onClick={(event) =>
        onSelectRow(row, event.shiftKey || event.metaKey || event.ctrlKey || forceAdditiveSelect)
      }
    >
      <div
        className={cn(
          "sticky left-0 z-20 flex h-full items-center gap-1 border-r border-zinc-200/70 bg-slate-50 pl-2 pr-1 dark:border-zinc-800 dark:bg-zinc-950",
          isComplete && !selected && "task-complete-hatch",
          selected && !isCategoryRow && "bg-amber-100/95 dark:bg-amber-950/55",
          selected && isCategoryRow && "bg-amber-100/80 dark:bg-amber-950/40",
          isCategoryRow && categoryTone?.leftClass,
        )}
        style={{ paddingLeft: `${row.depth * 16 + 8}px` }}
      >
        {isCategoryRow ? (
          <button
            type="button"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-700"
            {...attributes}
            {...listeners}
            disabled={!canReorder || compareMode}
            aria-label="순서 변경"
          >
            <GripVertical className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-700"
            {...attributes}
            {...listeners}
            disabled={!canReorder || compareMode}
          >
            <GripVertical className="size-3.5" />
          </button>
        )}

        {row.hasChildren ? (
          <button
            type="button"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-700"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand(row.rowId);
            }}
          >
            {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="size-5" />
        )}

        <div className="min-w-0 flex-1">
          {isCategoryRow ? (
            <div className="flex items-center gap-2 px-2">
              <p className={cn("truncate text-sm font-semibold", categoryTone?.labelClass)}>{row.label}</p>
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", categoryTone?.badgeClass)}>
                {row.childCount}
              </span>
            </div>
          ) : (
            <>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => {
                  if (!task) return;
                  if (name.trim() && name !== activityLabel) {
                    onPatchActivity(task.id, { name: name.trim(), activityName: name.trim() });
                  }
                }}
                disabled={compareMode}
                className={cn(
                  "h-7 border-transparent bg-transparent px-2 text-sm text-zinc-900 shadow-none focus-visible:border-zinc-300 focus-visible:bg-white dark:bg-transparent dark:text-zinc-100 dark:focus-visible:bg-zinc-800/80",
                  isRemoved && "line-through opacity-70",
                )}
              />
              {categoryPath || showCompareStatus ? (
                <div className="mt-0.5 flex items-center gap-1 px-2">
                  {categoryPath ? (
                    <p className="min-w-0 flex-1 truncate text-[10px] text-zinc-600 dark:text-zinc-400">{categoryPath}</p>
                  ) : (
                    <span className="flex-1" />
                  )}
                  {showCompareStatus ? (
                    <span
                      className={cn(
                        "shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                        isAdded && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
                        isRemoved && "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
                        isUpdated && "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
                      )}
                    >
                      {compareItem ? getCompareStatusLabel(compareItem.status) : ""}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {isCategoryRow ? (
        <>
          <span />
          <span />
          <span />
          <span />
          <span />
        </>
      ) : (
        <>
          <div className="truncate px-2 text-xs text-zinc-700 dark:text-zinc-300">{task?.assignee?.trim() || "-"}</div>
          <div
            className="px-2 text-right font-mono text-xs text-sky-700 dark:text-sky-300"
            title={
              timelineRollup
                ? "구간별 영업일 합계(캘린더 시작~종료 일수와 다를 수 있음)"
                : "영업일(달력·휴일 반영)"
            }
          >
            {listWorkingDays ?? 0}d
          </div>
          <div
            className="truncate px-2 text-right font-mono text-xs text-muted"
            title={
              listStartDate
                ? timelineRollup
                  ? `${formatDateKorean(listStartDate)} — 분할 전체의 가장 이른 시작`
                  : formatDateKorean(listStartDate)
                : ""
            }
          >
            {listStartDate ? formatDateKorean(listStartDate, "MM.dd") : "-"}
          </div>
          <div
            className="truncate px-2 text-right font-mono text-xs text-muted"
            title={
              listEndDate
                ? timelineRollup
                  ? `${formatDateKorean(listEndDate)} — 분할 전체의 가장 늦은 종료`
                  : formatDateKorean(listEndDate)
                : ""
            }
          >
            {listEndDate ? formatDateKorean(listEndDate, "MM.dd") : "-"}
          </div>
          <Input
            type="number"
            min={0}
            max={100}
            value={progress}
            onChange={(event) => setProgress(Number(event.target.value))}
            onBlur={() => {
              if (!task) return;
              if (progress !== task.progress) {
                onPatchActivity(task.id, { progress });
              }
            }}
            disabled={compareMode}
            className="h-7 w-14 justify-self-end"
          />
        </>
      )}
    </div>
  );
}

interface TaskGridPanelProps {
  rows: TaskListRow[];
  selectedRowIds: string[];
  activeTaskId: string | null;
  expandedRowIds: string[];
  canReorder: boolean;
  compareMode: boolean;
  taskDiffById?: Record<string, TaskCompareItem>;
  widthPx: number;
  sensors: SensorDescriptor<SensorOptions>[];
  onToggleExpand: (rowId: string) => void;
  onSelectRow: (row: TaskListRow, additive: boolean) => void;
  forceAdditiveSelect?: boolean;
  onPatchActivity: (taskId: string, patch: Partial<TaskModel>) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export function TaskGridPanel({
  rows,
  selectedRowIds,
  activeTaskId,
  expandedRowIds,
  canReorder,
  compareMode,
  taskDiffById = {},
  widthPx,
  sensors,
  onToggleExpand,
  onSelectRow,
  forceAdditiveSelect = false,
  onPatchActivity,
  onDragEnd,
  onScroll,
  scrollRef,
}: TaskGridPanelProps) {
  const safeTaskDiffById = taskDiffById ?? {};
  const headerScrollRef = React.useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = React.useState(false);

  const [columnWidths, setColumnWidths] = React.useState<number[]>(() => {
    if (typeof window === "undefined") return COLUMN_KEYS.map((k) => DEFAULT_COLUMN_WIDTHS[k]);
    try {
      const raw = window.localStorage.getItem(COLUMN_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as number[];
        if (Array.isArray(parsed) && parsed.length === 6 && parsed.every((n) => typeof n === "number" && n >= 40)) {
          return parsed.map((w, i) => {
            const minW = MIN_COLUMN_WIDTHS[COLUMN_KEYS[i]];
            const rounded = Math.round(w);
            if (i === 0) {
              // 첫 컬럼(액티비티명)은 기본값(290) 미만으로 복원하지 않음 → 줄어든 상태로 고정 방지
              return Math.max(minW, DEFAULT_COLUMN_WIDTHS.task, rounded);
            }
            return Math.max(minW, rounded);
          });
        }
      }
    } catch {
      // ignore
    }
    return COLUMN_KEYS.map((k) => DEFAULT_COLUMN_WIDTHS[k]);
  });

  const [resizingCol, setResizingCol] = React.useState<number | null>(null);
  const resizeStartRef = React.useRef<{
    colIndex: number;
    startX: number;
    startWidth: number;
    /** true = 핸들이 컬럼 왼쪽(경계를 오른쪽으로 당기면 컬럼이 줄어듦) */
    handleOnLeft: boolean;
  } | null>(null);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  React.useEffect(() => {
    const m = window.matchMedia("(max-width: 639px)");
    const set = () => setNarrow(m.matches);
    set();
    m.addEventListener("change", set);
    return () => m.removeEventListener("change", set);
  }, []);

  React.useEffect(() => {
    if (resizingCol === null) return;
    const colIndex = resizingCol;
    const minW = MIN_COLUMN_WIDTHS[COLUMN_KEYS[colIndex]];

    const onPointerMove = (e: PointerEvent) => {
      if (!resizeStartRef.current || resizeStartRef.current.colIndex !== colIndex) return;
      const delta = e.clientX - resizeStartRef.current.startX;
      // 경계를 잡고 오른쪽으로 당기면 경계도 오른쪽으로 → 왼쪽 컬럼 넓어짐(+). 왼쪽으로 당기면 경계도 왼쪽으로 → 왼쪽 컬럼 줄어듦(-).
      // 오른쪽 핸들(컬럼 오른쪽 끝): 이 컬럼이 “경계 왼쪽” → 드래그 방향과 동일하게 +delta.
      // 왼쪽 핸들(컬럼 왼쪽 끝): 이 컬럼이 “경계 오른쪽” → 경계 오른쪽으로 가려면 이 컬럼이 줄어들어야 함 → -delta.
      const sign = resizeStartRef.current.handleOnLeft ? -1 : 1;
      const nextWidth = Math.max(minW, resizeStartRef.current.startWidth + sign * delta);
      setColumnWidths((prev) => {
        const next = [...prev];
        next[colIndex] = nextWidth;
        return next;
      });
    };
    const onPointerUp = () => {
      setResizingCol(null);
      resizeStartRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizingCol]);

  const gridMinWidth = narrow ? GRID_MIN_WIDTH_PX_NARROW : Math.max(GRID_MIN_WIDTH_PX, columnWidths.reduce((a, b) => a + b, 0));
  const gridTemplate = narrow ? GRID_TEMPLATE_COLUMNS_NARROW : buildGridTemplateFromWidths(columnWidths);

  const handleColumnResizeStart = React.useCallback((colIndex: number, clientX: number, handleOnLeft: boolean) => {
    setResizingCol(colIndex);
    resizeStartRef.current = {
      colIndex,
      startX: clientX,
      startWidth: columnWidths[colIndex] ?? DEFAULT_COLUMN_WIDTHS[COLUMN_KEYS[colIndex]],
      handleOnLeft,
    };
  }, [columnWidths]);

  const handleScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (headerScrollRef.current) {
        headerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
      }
      onScroll(event);
    },
    [onScroll],
  );

  const headerLabels = ["Task", "Assignee", "영업일", "시작", "종료", "%"];
  const headerAlign = ["left", "left", "right", "right", "right", "right"] as const;

  return (
    <div
      className="flex flex-col overflow-hidden border-r border-zinc-200/70 dark:border-zinc-800"
      style={{
        width: widthPx,
        minWidth: widthPx,
        flex: `0 0 ${widthPx}px`,
      }}
    >
      <div ref={headerScrollRef} className="overflow-hidden border-b border-zinc-200/80 dark:border-zinc-800">
        <div
          className="grid h-11 items-stretch bg-slate-100/75 text-[11px] font-semibold uppercase tracking-wide text-muted backdrop-blur dark:bg-zinc-900/60"
          style={{ gridTemplateColumns: gridTemplate, minWidth: gridMinWidth }}
        >
          {COLUMN_KEYS.map((_, colIndex) => (
            <div
              key={COLUMN_KEYS[colIndex]}
              className={cn(
                "relative flex items-center truncate border-r border-zinc-200/70 dark:border-zinc-800",
                colIndex === 0 && "sticky left-0 z-20 bg-slate-100 dark:bg-zinc-900",
                headerAlign[colIndex] === "right" && "justify-end",
              )}
            >
              <span className={cn("truncate px-2", colIndex === 0 ? "pr-2" : "px-2")}>{headerLabels[colIndex]}</span>
              {!narrow && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${headerLabels[colIndex]} column`}
                  className={cn(
                    "absolute top-0 z-30 h-full w-1.5 cursor-col-resize touch-none shrink-0 hover:bg-sky-500/30 active:bg-sky-500/40",
                    colIndex === 0 ? "right-0" : "left-0",
                    resizingCol === colIndex && "bg-sky-500/40",
                  )}
                  style={{ touchAction: "none" }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    handleColumnResizeStart(colIndex, e.clientX, colIndex !== 0);
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <div
        ref={scrollRef}
        className={cn("min-h-0 flex-1 overflow-auto", narrow && "touch-manipulation")}
        style={narrow ? ({ WebkitOverflowScrolling: "touch" } as React.CSSProperties) : undefined}
        onScroll={handleScroll}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rows.map((row) => row.rowId)} strategy={verticalListSortingStrategy}>
            <div style={{ minHeight: ROW_HEIGHT * rows.length, minWidth: gridMinWidth }}>
              {rows.map((row) => (
                <SortableTaskRow
                  key={row.rowId}
                  row={row}
                  canReorder={canReorder}
                  compareMode={compareMode}
                  compareItem={compareMode && row.rowType === "ACTIVITY_ROW" ? safeTaskDiffById?.[row.taskId] ?? null : null}
                  selected={
                    selectedRowIds.includes(row.rowId) ||
                    (row.rowType === "ACTIVITY_ROW" &&
                      Boolean(row.timelineSegmentTasks?.some((s) => selectedRowIds.includes(s.id))))
                  }
                  active={
                    row.rowType === "ACTIVITY_ROW" &&
                    (activeTaskId === row.taskId ||
                      Boolean(row.timelineSegmentTasks?.some((s) => s.id === activeTaskId)))
                  }
                  isExpanded={expandedRowIds.includes(row.rowId)}
                  gridTemplate={gridTemplate}
                  gridMinWidth={gridMinWidth}
                  onToggleExpand={onToggleExpand}
                  onSelectRow={onSelectRow}
                  forceAdditiveSelect={forceAdditiveSelect}
                  onPatchActivity={onPatchActivity}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
