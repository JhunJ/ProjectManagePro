import type { FieldScheduleScale, TaskCompareItem, TaskDiffStatus, TaskModel } from "@/types/domain";
import { DEFAULT_TIMELINE_VISIBILITY, type TimelineVisibilityFilter } from "@/features/gantt/timeline";
import { toUtcDay } from "@/server/schedulers/business-days";

export const FIELD_UNCATEGORIZED_LABEL = "미분류";
export const FIELD_CELL_WIDTH = 34;
export const FIELD_LANE_HEIGHT = 28;

export interface FieldScheduleRange {
  start: Date;
  end: Date;
  days: Date[];
}

export interface FieldScheduleSegment {
  taskId: string;
  task: TaskModel;
  mainCategory: string;
  middle1Category: string;
  middle2Category: string;
  smallCategory: string;
  displayText: string;
  lane: number;
  startIndex: number;
  endIndex: number;
  status: TaskDiffStatus;
}

export interface FieldScheduleRow {
  rowId: string;
  mainCategory: string;
  middle1Category: string;
  middle2Category: string;
  smallCategory: string;
  segments: FieldScheduleSegment[];
  laneCount: number;
  rowHeight: number;
  showMainCategoryLabel: boolean;
  mainCategoryRowCount: number;
}

export interface FieldScheduleBuildInput {
  tasks: TaskModel[];
  filters: {
    query: string;
    siteMainCategories: string[];
    middle1Categories: string[];
    middle2Categories: string[];
    smallCategories: string[];
  };
  scale: FieldScheduleScale;
  anchorDate: string;
  showMiddle1Category?: boolean;
  showMiddle2Category?: boolean;
  showSmallCategory?: boolean;
  timelineVisibility?: TimelineVisibilityFilter;
  projectHolidayDayKeys?: Set<string>;
  taskDiffById?: Record<string, TaskCompareItem>;
}

function normalizeText(value: string | null | undefined, fallback = FIELD_UNCATEGORIZED_LABEL) {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function addUtcDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 86_400_000);
}

function eachUtcDay(start: Date, end: Date) {
  const days: Date[] = [];
  const current = new Date(start.getTime());
  while (current.getTime() <= end.getTime()) {
    days.push(new Date(current.getTime()));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function startOfUtcWeek(date: Date) {
  const offset = (date.getUTCDay() + 6) % 7;
  return addUtcDays(toUtcDay(date), -offset);
}

export function getFieldMainCategory(task: TaskModel) {
  return normalizeText(task.siteMainCategory ?? task.categoryMajor);
}

export function getFieldMiddle1Category(task: TaskModel) {
  return normalizeText(task.categoryMiddle1);
}

export function getFieldMiddle2Category(task: TaskModel) {
  return normalizeText(task.categoryMiddle2);
}

export function getFieldSmallCategory(task: TaskModel) {
  return normalizeText(task.categorySmall);
}

export function getFieldDisplayText(task: TaskModel) {
  return normalizeText(task.siteDisplayText ?? task.activityName ?? task.name, task.name);
}

export function collectSiteMainCategories(tasks: TaskModel[]) {
  return [...new Set(tasks.map((task) => getFieldMainCategory(task)))].sort((left, right) =>
    left.localeCompare(right, "ko-KR"),
  );
}

export function collectFieldMiddle1Categories(tasks: TaskModel[], siteMainCategories: string[] = []) {
  const siteMainSet = new Set(siteMainCategories);
  return [
    ...new Set(
      tasks
        .filter((task) => siteMainSet.size === 0 || siteMainSet.has(getFieldMainCategory(task)))
        .map((task) => getFieldMiddle1Category(task)),
    ),
  ].sort((left, right) => left.localeCompare(right, "ko-KR"));
}

export function collectFieldMiddle2Categories(
  tasks: TaskModel[],
  siteMainCategories: string[] = [],
  middle1Categories: string[] = [],
) {
  const siteMainSet = new Set(siteMainCategories);
  const middle1Set = new Set(middle1Categories);

  return [
    ...new Set(
      tasks
        .filter((task) => {
          const siteMainMatched = siteMainSet.size === 0 || siteMainSet.has(getFieldMainCategory(task));
          const middle1Matched = middle1Set.size === 0 || middle1Set.has(getFieldMiddle1Category(task));
          return siteMainMatched && middle1Matched;
        })
        .map((task) => getFieldMiddle2Category(task)),
    ),
  ].sort((left, right) => left.localeCompare(right, "ko-KR"));
}

export function collectFieldSmallCategories(
  tasks: TaskModel[],
  siteMainCategories: string[] = [],
  middle1Categories: string[] = [],
  middle2Categories: string[] = [],
) {
  const siteMainSet = new Set(siteMainCategories);
  const middle1Set = new Set(middle1Categories);
  const middle2Set = new Set(middle2Categories);

  return [
    ...new Set(
      tasks
        .filter((task) => {
          const siteMainMatched = siteMainSet.size === 0 || siteMainSet.has(getFieldMainCategory(task));
          const middle1Matched = middle1Set.size === 0 || middle1Set.has(getFieldMiddle1Category(task));
          const middle2Matched = middle2Set.size === 0 || middle2Set.has(getFieldMiddle2Category(task));
          return siteMainMatched && middle1Matched && middle2Matched;
        })
        .map((task) => getFieldSmallCategory(task)),
    ),
  ].sort((left, right) => left.localeCompare(right, "ko-KR"));
}

function shouldHideDay(date: Date, visibility: TimelineVisibilityFilter, projectHolidayDayKeys?: Set<string>) {
  const day = date.getUTCDay();
  const key = date.toISOString().slice(0, 10);

  if (visibility.hideSaturday && day === 6) {
    return true;
  }

  if (visibility.hideSunday && day === 0) {
    return true;
  }

  if (visibility.hideHoliday && projectHolidayDayKeys?.has(key)) {
    return true;
  }

  return false;
}

export function getFieldScheduleRange(
  anchorDate: string,
  scale: FieldScheduleScale,
  visibility: TimelineVisibilityFilter = DEFAULT_TIMELINE_VISIBILITY,
  projectHolidayDayKeys?: Set<string>,
): FieldScheduleRange {
  const anchor = toUtcDay(anchorDate);
  const start = scale === "MONTHLY" ? startOfUtcMonth(anchor) : addUtcDays(startOfUtcWeek(anchor), -7);
  const end = scale === "MONTHLY" ? endOfUtcMonth(anchor) : addUtcDays(startOfUtcWeek(anchor), 13);

  const allDays = eachUtcDay(toUtcDay(start), toUtcDay(end));
  const days = allDays.filter((day) => !shouldHideDay(day, visibility, projectHolidayDayKeys));

  return {
    start: days[0] ?? allDays[0],
    end: days[days.length - 1] ?? allDays[allDays.length - 1],
    days: days.length > 0 ? days : allDays,
  };
}

function matchesFilters(task: TaskModel, filters: FieldScheduleBuildInput["filters"]) {
  const query = filters.query.trim().toLowerCase();
  const mainCategory = getFieldMainCategory(task);
  const middle1Category = getFieldMiddle1Category(task);
  const middle2Category = getFieldMiddle2Category(task);
  const smallCategory = getFieldSmallCategory(task);
  const searchable = [
    getFieldDisplayText(task),
    task.activityName ?? task.name,
    task.name,
    mainCategory,
    middle1Category,
    middle2Category,
    smallCategory,
  ]
    .join(" ")
    .toLowerCase();

  if (query && !searchable.includes(query)) {
    return false;
  }

  if (filters.siteMainCategories.length > 0 && !filters.siteMainCategories.includes(mainCategory)) {
    return false;
  }

  if (filters.middle1Categories.length > 0 && !filters.middle1Categories.includes(middle1Category)) {
    return false;
  }

  if (filters.middle2Categories.length > 0 && !filters.middle2Categories.includes(middle2Category)) {
    return false;
  }

  if (filters.smallCategories.length > 0 && !filters.smallCategories.includes(smallCategory)) {
    return false;
  }

  return true;
}

function sortTasks(left: TaskModel, right: TaskModel) {
  const startCompare = new Date(left.startDate).getTime() - new Date(right.startDate).getTime();
  if (startCompare !== 0) {
    return startCompare;
  }

  const orderCompare = left.sortOrder - right.sortOrder;
  if (orderCompare !== 0) {
    return orderCompare;
  }

  return (left.activityName ?? left.name).localeCompare(right.activityName ?? right.name, "ko-KR");
}

export function buildFieldScheduleRows({
  tasks,
  filters,
  scale,
  anchorDate,
  showMiddle1Category = true,
  showMiddle2Category = true,
  showSmallCategory = true,
  timelineVisibility = DEFAULT_TIMELINE_VISIBILITY,
  projectHolidayDayKeys,
  taskDiffById,
}: FieldScheduleBuildInput) {
  const range = getFieldScheduleRange(anchorDate, scale, timelineVisibility, projectHolidayDayKeys);
  const dayIndexByKey = new Map(range.days.map((day, index) => [day.toISOString().slice(0, 10), index]));

  const rowMap = new Map<
    string,
    {
      mainCategory: string;
      middle1Category: string;
      middle2Category: string;
      smallCategory: string;
      middle1Values: Set<string>;
      middle2Values: Set<string>;
      smallValues: Set<string>;
      tasks: TaskModel[];
    }
  >();

  for (const task of tasks) {
    if (!matchesFilters(task, filters)) {
      continue;
    }
    if (task.timelineHeadTaskId) {
      continue;
    }

    const mainCategory = getFieldMainCategory(task);
    const middle1Category = getFieldMiddle1Category(task);
    const middle2Category = getFieldMiddle2Category(task);
    const smallCategory = getFieldSmallCategory(task);
    const rowId = `${mainCategory}||${showMiddle1Category ? middle1Category : ""}||${showMiddle2Category ? middle2Category : ""}||${showSmallCategory ? smallCategory : ""}`;
    const entry = rowMap.get(rowId) ?? {
      mainCategory,
      middle1Category: showMiddle1Category ? middle1Category : "",
      middle2Category: showMiddle2Category ? middle2Category : "",
      smallCategory,
      middle1Values: new Set<string>(),
      middle2Values: new Set<string>(),
      smallValues: new Set<string>(),
      tasks: [],
    };

    entry.middle1Values.add(middle1Category);
    entry.middle2Values.add(middle2Category);
    entry.smallValues.add(smallCategory);
    entry.tasks.push(task);
    rowMap.set(rowId, entry);
  }

  const grouped = [...rowMap.values()].sort((left, right) => {
    const mainCompare = left.mainCategory.localeCompare(right.mainCategory, "ko-KR");
    if (mainCompare !== 0) {
      return mainCompare;
    }

    if (showMiddle1Category) {
      const middle1Compare = left.middle1Category.localeCompare(right.middle1Category, "ko-KR");
      if (middle1Compare !== 0) {
        return middle1Compare;
      }
    }

    if (showMiddle2Category) {
      const middle2Compare = left.middle2Category.localeCompare(right.middle2Category, "ko-KR");
      if (middle2Compare !== 0) {
        return middle2Compare;
      }
    }

    if (showSmallCategory) {
      return left.smallCategory.localeCompare(right.smallCategory, "ko-KR");
    }
    return 0;
  });

  const rows: FieldScheduleRow[] = [];

  const segmentTasksByHead = new Map<string, TaskModel[]>();
  for (const task of tasks) {
    if (!task.timelineHeadTaskId || !matchesFilters(task, filters)) {
      continue;
    }
    const list = segmentTasksByHead.get(task.timelineHeadTaskId) ?? [];
    list.push(task);
    segmentTasksByHead.set(task.timelineHeadTaskId, list);
  }
  for (const [, list] of segmentTasksByHead) {
    list.sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    );
  }

  for (const group of grouped) {
    const segments: FieldScheduleSegment[] = [];
    const laneEndIndices: number[] = [];
    const sortedTasks = group.tasks.slice().sort(sortTasks);

    for (const task of sortedTasks) {
      const taskStart = toUtcDay(task.startDate).toISOString().slice(0, 10);
      const taskEnd = toUtcDay(task.endDate).toISOString().slice(0, 10);
      const startIndex = dayIndexByKey.get(taskStart);
      const endIndex = dayIndexByKey.get(taskEnd);

      if (startIndex === undefined && endIndex === undefined) {
        const startTime = toUtcDay(task.startDate).getTime();
        const endTime = toUtcDay(task.endDate).getTime();
        if (endTime < range.start.getTime() || startTime > range.end.getTime()) {
          continue;
        }
      }

      const clippedStart = Math.max(
        0,
        startIndex ?? Math.ceil((toUtcDay(task.startDate).getTime() - range.start.getTime()) / 86_400_000),
      );
      const clippedEnd = Math.min(
        range.days.length - 1,
        endIndex ?? Math.floor((toUtcDay(task.endDate).getTime() - range.start.getTime()) / 86_400_000),
      );

      if (clippedEnd < 0 || clippedStart > range.days.length - 1 || clippedStart > clippedEnd) {
        continue;
      }

      let lane = laneEndIndices.findIndex((currentEnd) => clippedStart > currentEnd);
      if (lane < 0) {
        lane = laneEndIndices.length;
      }
      laneEndIndices[lane] = clippedEnd;

      const compareItem = taskDiffById?.[task.id];
      segments.push({
        taskId: task.id,
        task,
        mainCategory: group.mainCategory,
        middle1Category: group.middle1Category,
        middle2Category: group.middle2Category,
        smallCategory: group.smallCategory,
        displayText: getFieldDisplayText(task),
        lane,
        startIndex: clippedStart,
        endIndex: clippedEnd,
        status: compareItem?.status ?? "UNCHANGED",
      });

      const timelineChildren = segmentTasksByHead.get(task.id);
      if (timelineChildren) {
        for (const child of timelineChildren) {
          const cStart = toUtcDay(child.startDate).toISOString().slice(0, 10);
          const cEnd = toUtcDay(child.endDate).toISOString().slice(0, 10);
          const cStartIndex = dayIndexByKey.get(cStart);
          const cEndIndex = dayIndexByKey.get(cEnd);
          const childClippedStart = Math.max(
            0,
            cStartIndex ?? Math.ceil((toUtcDay(child.startDate).getTime() - range.start.getTime()) / 86_400_000),
          );
          const childClippedEnd = Math.min(
            range.days.length - 1,
            cEndIndex ?? Math.floor((toUtcDay(child.endDate).getTime() - range.start.getTime()) / 86_400_000),
          );
          if (childClippedEnd < 0 || childClippedStart > range.days.length - 1 || childClippedStart > childClippedEnd) {
            continue;
          }
          laneEndIndices[lane] = Math.max(laneEndIndices[lane] ?? childClippedEnd, childClippedEnd);
          const childCompare = taskDiffById?.[child.id];
          segments.push({
            taskId: child.id,
            task: child,
            mainCategory: group.mainCategory,
            middle1Category: group.middle1Category,
            middle2Category: group.middle2Category,
            smallCategory: group.smallCategory,
            displayText: getFieldDisplayText(child),
            lane,
            startIndex: childClippedStart,
            endIndex: childClippedEnd,
            status: childCompare?.status ?? "UNCHANGED",
          });
        }
      }
    }

    rows.push({
      rowId: `${group.mainCategory}||${group.middle1Category}||${group.middle2Category}||${group.smallCategory}`,
      mainCategory: group.mainCategory,
      middle1Category:
        showMiddle1Category || group.middle1Values.size === 1
          ? [...group.middle1Values][0] ?? group.middle1Category
          : "",
      middle2Category:
        showMiddle2Category || group.middle2Values.size === 1
          ? [...group.middle2Values][0] ?? group.middle2Category
          : "",
      smallCategory:
        showSmallCategory || group.smallValues.size === 1
          ? [...group.smallValues][0] ?? group.smallCategory
          : "",
      segments,
      laneCount: Math.max(1, laneEndIndices.length),
      rowHeight: Math.max(40, Math.max(1, laneEndIndices.length) * FIELD_LANE_HEIGHT + 8),
      showMainCategoryLabel: false,
      mainCategoryRowCount: 0,
    });
  }

  let currentMainCategory = "";
  let currentStartIndex = 0;

  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].mainCategory !== currentMainCategory) {
      currentMainCategory = rows[index].mainCategory;
      currentStartIndex = index;
      rows[index].showMainCategoryLabel = true;
    }

    const nextRow = rows[index + 1];
    const groupEnded = !nextRow || nextRow.mainCategory !== currentMainCategory;
    if (!groupEnded) {
      continue;
    }

    const count = index - currentStartIndex + 1;
    for (let cursor = currentStartIndex; cursor <= index; cursor += 1) {
      rows[cursor].mainCategoryRowCount = count;
    }
  }

  return {
    range,
    rows,
  };
}
