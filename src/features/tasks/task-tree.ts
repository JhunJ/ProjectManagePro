import type { CategoryLevel, CategoryPath, TaskListRow, TaskModel } from "@/types/domain";

interface Filters {
  query: string;
  assignee: string;
  companyId: string;
  majorCategories: string[];
  middle1Categories: string[];
  middle2Categories: string[];
  smallCategories: string[];
  completion: "all" | "complete" | "incomplete";
  milestoneOnly: boolean;
  sortBy: "sortOrder" | "startDate" | "endDate";
}

/** 작업뷰(간트) 목록에서 대/중/소 분류 행 표시 여부 — 끄면 해당 헤더만 숨기고 하위는 부모 펼침으로 탐색 */
export interface TaskListCategoryVisibility {
  showMajorCategory: boolean;
  showMiddle1Category: boolean;
  showMiddle2Category: boolean;
  showSmallCategory: boolean;
}

export const DEFAULT_TASK_LIST_CATEGORY_VISIBILITY: TaskListCategoryVisibility = {
  showMajorCategory: true,
  showMiddle1Category: true,
  showMiddle2Category: true,
  showSmallCategory: true,
};

export const UNCATEGORIZED_LABEL = "미분류";

type SmallCategoryMap = Map<string, TaskModel[]>;
type Middle2CategoryMap = Map<string, SmallCategoryMap>;
type Middle1CategoryMap = Map<string, Middle2CategoryMap>;
type MajorCategoryMap = Map<string, Middle1CategoryMap>;

function normalizeCategoryValue(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : UNCATEGORIZED_LABEL;
}

function toCategoryPath(task: TaskModel): CategoryPath {
  return {
    major: normalizeCategoryValue(task.categoryMajor),
    middle1: normalizeCategoryValue(task.categoryMiddle1),
    middle2: normalizeCategoryValue(task.categoryMiddle2),
    small: normalizeCategoryValue(task.categorySmall),
  };
}

function categoryPathKey(path: CategoryPath) {
  return `${path.major}||${path.middle1}||${path.middle2}||${path.small}`;
}

function isSameSmallCategoryGroup(left: TaskModel, right: TaskModel) {
  return categoryPathKey(toCategoryPath(left)) === categoryPathKey(toCategoryPath(right));
}

function compareCategoryPath(left: CategoryPath, right: CategoryPath) {
  return (
    left.major.localeCompare(right.major, "ko-KR") ||
    left.middle1.localeCompare(right.middle1, "ko-KR") ||
    left.middle2.localeCompare(right.middle2, "ko-KR") ||
    left.small.localeCompare(right.small, "ko-KR")
  );
}

function sortTasksForCategoryTree(tasks: TaskModel[]) {
  return [...tasks].sort((left, right) => {
    const categoryCompare = compareCategoryPath(toCategoryPath(left), toCategoryPath(right));
    if (categoryCompare !== 0) {
      return categoryCompare;
    }
    return left.sortOrder - right.sortOrder;
  });
}

/**
 * 분류 맵의 키를 전역 sortOrder(목록 순서)에서 처음 나타나는 순으로 정렬한다.
 * 드래그로 대/중/소 순서를 바꾼 뒤에도 화면 순서가 유지되도록 한다. 맵에만 있고
 * 순회에서 안 잡힌 키는 가나다순으로 뒤에 붙인다.
 */
function orderCategoryKeysByTaskSort(
  sortedByOrder: TaskModel[],
  mapKeys: Iterable<string>,
  pickKeyInBranch: (task: TaskModel) => string | null,
): string[] {
  const inSet = new Set(mapKeys);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const task of sortedByOrder) {
    if (task.timelineHeadTaskId) {
      continue;
    }
    const key = pickKeyInBranch(task);
    if (key === null || !inSet.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    ordered.push(key);
  }
  const rest = [...inSet]
    .filter((k) => !seen.has(k))
    .sort((left, right) => left.localeCompare(right, "ko-KR"));
  return [...ordered, ...rest];
}

function buildCategoryMap(tasks: TaskModel[]) {
  const majorMap: MajorCategoryMap = new Map();

  for (const task of tasks) {
    if (task.timelineHeadTaskId) {
      continue;
    }
    const path = toCategoryPath(task);
    const middle1Map = majorMap.get(path.major) ?? new Map<string, Middle2CategoryMap>();
    const middle2Map = middle1Map.get(path.middle1) ?? new Map<string, SmallCategoryMap>();
    const smallMap = middle2Map.get(path.middle2) ?? new Map<string, TaskModel[]>();
    const activityList = smallMap.get(path.small) ?? [];

    activityList.push(task);
    smallMap.set(path.small, activityList);
    middle2Map.set(path.middle2, smallMap);
    middle1Map.set(path.middle1, middle2Map);
    majorMap.set(path.major, middle1Map);
  }

  return majorMap;
}

function countActivitiesByMiddle1(map: Middle2CategoryMap) {
  let count = 0;
  for (const smallMap of map.values()) {
    for (const activities of smallMap.values()) {
      count += activities.length;
    }
  }
  return count;
}

function countActivitiesByMiddle2(map: SmallCategoryMap) {
  let count = 0;
  for (const activities of map.values()) {
    count += activities.length;
  }
  return count;
}

function countActivitiesByMajor(map: Middle1CategoryMap) {
  let count = 0;
  for (const middle2Map of map.values()) {
    count += countActivitiesByMiddle1(middle2Map);
  }
  return count;
}

function applyFilter(task: TaskModel, filters: Filters) {
  const activityName = (task.activityName?.trim() || task.name).toLowerCase();

  if (filters.query && !activityName.includes(filters.query.toLowerCase())) {
    return false;
  }

  if (filters.assignee !== "all" && (task.assignee ?? "") !== filters.assignee) {
    return false;
  }

  if (filters.companyId !== "all" && (task.companyId ?? "") !== filters.companyId) {
    return false;
  }

  if (filters.majorCategories.length > 0 && !filters.majorCategories.includes(normalizeCategoryValue(task.categoryMajor))) {
    return false;
  }

  if (filters.middle1Categories.length > 0 && !filters.middle1Categories.includes(normalizeCategoryValue(task.categoryMiddle1))) {
    return false;
  }

  if (filters.middle2Categories.length > 0 && !filters.middle2Categories.includes(normalizeCategoryValue(task.categoryMiddle2))) {
    return false;
  }

  if (filters.smallCategories.length > 0 && !filters.smallCategories.includes(normalizeCategoryValue(task.categorySmall))) {
    return false;
  }

  if (filters.completion === "complete" && task.progress < 100) {
    return false;
  }

  if (filters.completion === "incomplete" && task.progress >= 100) {
    return false;
  }

  if (filters.milestoneOnly && !task.isMilestone) {
    return false;
  }

  return true;
}

function toMajorRowId(major: string) {
  return `cat:major:${major}`;
}

function toMiddle1RowId(major: string, middle1: string) {
  return `cat:middle1:${major}||${middle1}`;
}

function toMiddle2RowId(major: string, middle1: string, middle2: string) {
  return `cat:middle2:${major}||${middle1}||${middle2}`;
}

function toSmallRowId(major: string, middle1: string, middle2: string, small: string) {
  return `cat:small:${major}||${middle1}||${middle2}||${small}`;
}

export function collectCategoryRowIds(
  tasks: TaskModel[],
  visibility: TaskListCategoryVisibility = DEFAULT_TASK_LIST_CATEGORY_VISIBILITY,
) {
  const sortedByOrder = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);
  const majorMap = buildCategoryMap(sortedByOrder);
  const ids: string[] = [];
  const v = visibility;

  const flatNone =
    !v.showMajorCategory && !v.showMiddle1Category && !v.showMiddle2Category && !v.showSmallCategory;
  if (flatNone) {
    return ids;
  }

  const majorKeys = orderCategoryKeysByTaskSort(sortedByOrder, majorMap.keys(), (task) =>
    normalizeCategoryValue(task.categoryMajor),
  );
  for (const major of majorKeys) {
    const middle1Map = majorMap.get(major)!;
    if (v.showMajorCategory) {
      ids.push(toMajorRowId(major));
    }

    const middle1Keys = orderCategoryKeysByTaskSort(sortedByOrder, middle1Map.keys(), (task) => {
      const p = toCategoryPath(task);
      return p.major === major ? p.middle1 : null;
    });
    for (const middle1 of middle1Keys) {
      const middle2Map = middle1Map.get(middle1)!;
      if (v.showMiddle1Category) {
        ids.push(toMiddle1RowId(major, middle1));
      }

      const middle2Keys = orderCategoryKeysByTaskSort(sortedByOrder, middle2Map.keys(), (task) => {
        const p = toCategoryPath(task);
        return p.major === major && p.middle1 === middle1 ? p.middle2 : null;
      });
      for (const middle2 of middle2Keys) {
        const smallMap = middle2Map.get(middle2)!;
        if (v.showMiddle2Category) {
          ids.push(toMiddle2RowId(major, middle1, middle2));
        }

        const smallKeys = orderCategoryKeysByTaskSort(sortedByOrder, smallMap.keys(), (task) => {
          const p = toCategoryPath(task);
          return p.major === major && p.middle1 === middle1 && p.middle2 === middle2 ? p.small : null;
        });
        for (const small of smallKeys) {
          if (v.showSmallCategory) {
            ids.push(toSmallRowId(major, middle1, middle2, small));
          }
        }
      }
    }
  }

  return ids;
}

export function buildVisibleTaskList(
  tasks: TaskModel[],
  expandedRowIds: string[],
  filters: Filters,
  visibility: TaskListCategoryVisibility = DEFAULT_TASK_LIST_CATEGORY_VISIBILITY,
): TaskListRow[] {
  const filtered = tasks.filter((task) => applyFilter(task, filters));
  const sortedByOrder = [...filtered].sort((a, b) => a.sortOrder - b.sortOrder);
  const majorMap = buildCategoryMap(sortedByOrder);
  const expanded = new Set(expandedRowIds);
  const rows: TaskListRow[] = [];
  const v = visibility;

  const pushActivityRow = (task: TaskModel, depth: number) => {
    const timelineSegmentTasks = sortedByOrder
      .filter((t) => t.timelineHeadTaskId === task.id)
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          new Date(left.startDate).getTime() - new Date(right.startDate).getTime(),
      );
    rows.push({
      rowId: task.id,
      rowType: "ACTIVITY_ROW",
      depth,
      hasChildren: false,
      label: task.activityName?.trim() || task.name,
      taskId: task.id,
      task,
      ...(timelineSegmentTasks.length > 0 ? { timelineSegmentTasks } : {}),
    });
  };

  const flatNone =
    !v.showMajorCategory && !v.showMiddle1Category && !v.showMiddle2Category && !v.showSmallCategory;
  if (flatNone) {
    const heads = sortedByOrder.filter((t) => !t.timelineHeadTaskId);
    for (const task of heads) {
      pushActivityRow(task, 0);
    }
    return rows;
  }

  const sortedMajorKeys = orderCategoryKeysByTaskSort(sortedByOrder, majorMap.keys(), (task) =>
    normalizeCategoryValue(task.categoryMajor),
  );

  for (const major of sortedMajorKeys) {
    const middle1Map = majorMap.get(major)!;
    const majorRowId = toMajorRowId(major);
    let depth = 0;

    if (v.showMajorCategory) {
      rows.push({
        rowId: majorRowId,
        rowType: "CATEGORY_ROW",
        depth: 0,
        hasChildren: countActivitiesByMajor(middle1Map) > 0,
        label: major,
        level: "major",
        categoryPath: {
          major,
          middle1: UNCATEGORIZED_LABEL,
          middle2: UNCATEGORIZED_LABEL,
          small: UNCATEGORIZED_LABEL,
        },
        childCount: countActivitiesByMajor(middle1Map),
      });
      depth = 1;
      if (!expanded.has(majorRowId)) {
        continue;
      }
    }

    const middle1Keys = orderCategoryKeysByTaskSort(sortedByOrder, middle1Map.keys(), (task) => {
      const p = toCategoryPath(task);
      return p.major === major ? p.middle1 : null;
    });
    for (const middle1 of middle1Keys) {
      const middle2Map = middle1Map.get(middle1)!;
      const middle1RowId = toMiddle1RowId(major, middle1);

      if (v.showMiddle1Category) {
        rows.push({
          rowId: middle1RowId,
          rowType: "CATEGORY_ROW",
          depth,
          hasChildren: countActivitiesByMiddle1(middle2Map) > 0,
          label: middle1,
          level: "middle1",
          categoryPath: {
            major,
            middle1,
            middle2: UNCATEGORIZED_LABEL,
            small: UNCATEGORIZED_LABEL,
          },
          childCount: countActivitiesByMiddle1(middle2Map),
        });
        const d1 = depth + 1;
        if (!expanded.has(middle1RowId)) {
          continue;
        }
        walkMiddle2(major, middle1, middle2Map, d1);
      } else {
        walkMiddle2(major, middle1, middle2Map, depth);
      }
    }
  }

  function walkMiddle2(major: string, middle1: string, middle2Map: Middle2CategoryMap, baseDepth: number) {
    const middle1RowId = toMiddle1RowId(major, middle1);
    const majorRowIdLocal = toMajorRowId(major);
    const middle2Keys = orderCategoryKeysByTaskSort(sortedByOrder, middle2Map.keys(), (task) => {
      const p = toCategoryPath(task);
      return p.major === major && p.middle1 === middle1 ? p.middle2 : null;
    });
    for (const middle2 of middle2Keys) {
      const smallMap = middle2Map.get(middle2)!;
      const middle2RowId = toMiddle2RowId(major, middle1, middle2);

      if (v.showMiddle2Category) {
        rows.push({
          rowId: middle2RowId,
          rowType: "CATEGORY_ROW",
          depth: baseDepth,
          hasChildren: countActivitiesByMiddle2(smallMap) > 0,
          label: middle2,
          level: "middle2",
          categoryPath: {
            major,
            middle1,
            middle2,
            small: UNCATEGORIZED_LABEL,
          },
          childCount: countActivitiesByMiddle2(smallMap),
        });
        const d2 = baseDepth + 1;
        if (!expanded.has(middle2RowId)) {
          continue;
        }
        walkSmall(major, middle1, middle2, smallMap, d2, v.showSmallCategory ? null : middle2RowId);
      } else {
        const mergedGate =
          v.showMiddle1Category ? middle1RowId : v.showMajorCategory ? majorRowIdLocal : null;
        walkSmall(major, middle1, middle2, smallMap, baseDepth, v.showSmallCategory ? null : mergedGate);
      }
    }
  }

  function walkSmall(
    major: string,
    middle1: string,
    middle2: string,
    smallMap: SmallCategoryMap,
    baseDepth: number,
    /** 소분류 숨김 시 병합 작업 행 표시 조건: 해당 분류 행이 펼쳐져 있어야 함. null이면 항상 표시 */
    mergedExpandId: string | null,
  ) {
    const smallKeys = orderCategoryKeysByTaskSort(sortedByOrder, smallMap.keys(), (task) => {
      const p = toCategoryPath(task);
      return p.major === major && p.middle1 === middle1 && p.middle2 === middle2 ? p.small : null;
    });

    if (v.showSmallCategory) {
      for (const small of smallKeys) {
        const activities = [...(smallMap.get(small) ?? [])].sort((left, right) => left.sortOrder - right.sortOrder);
        const smallRowId = toSmallRowId(major, middle1, middle2, small);

        rows.push({
          rowId: smallRowId,
          rowType: "CATEGORY_ROW",
          depth: baseDepth,
          hasChildren: activities.length > 0,
          label: small,
          level: "small",
          categoryPath: {
            major,
            middle1,
            middle2,
            small,
          },
          childCount: activities.length,
        });

        if (!expanded.has(smallRowId)) {
          continue;
        }

        for (const task of activities) {
          pushActivityRow(task, baseDepth + 1);
        }
      }
      return;
    }

    if (mergedExpandId !== null && !expanded.has(mergedExpandId)) {
      return;
    }

    const merged = smallKeys.flatMap((sk) => smallMap.get(sk) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
    for (const task of merged) {
      pushActivityRow(task, baseDepth);
    }
  }

  return rows;
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "ko-KR"));
}

export function collectAssignees(tasks: TaskModel[]) {
  return [...new Set(tasks.map((task) => task.assignee).filter((value): value is string => Boolean(value)))].sort();
}

export function collectMajorCategories(tasks: TaskModel[]) {
  return uniqueSorted(tasks.map((task) => normalizeCategoryValue(task.categoryMajor)));
}

export function collectMiddle1Categories(tasks: TaskModel[], majorCategories: string[] = []) {
  const majorSet = new Set(majorCategories);
  return uniqueSorted(
    tasks
      .filter((task) => majorSet.size === 0 || majorSet.has(normalizeCategoryValue(task.categoryMajor)))
      .map((task) => normalizeCategoryValue(task.categoryMiddle1)),
  );
}

export function collectMiddle2Categories(
  tasks: TaskModel[],
  majorCategories: string[] = [],
  middle1Categories: string[] = [],
) {
  const majorSet = new Set(majorCategories);
  const middle1Set = new Set(middle1Categories);
  return uniqueSorted(
    tasks
      .filter((task) => {
        const majorMatched = majorSet.size === 0 || majorSet.has(normalizeCategoryValue(task.categoryMajor));
        const middle1Matched = middle1Set.size === 0 || middle1Set.has(normalizeCategoryValue(task.categoryMiddle1));
        return majorMatched && middle1Matched;
      })
      .map((task) => normalizeCategoryValue(task.categoryMiddle2)),
  );
}

export function collectSmallCategories(
  tasks: TaskModel[],
  majorCategories: string[] = [],
  middle1Categories: string[] = [],
  middle2Categories: string[] = [],
) {
  const majorSet = new Set(majorCategories);
  const middle1Set = new Set(middle1Categories);
  const middle2Set = new Set(middle2Categories);
  return uniqueSorted(
    tasks
      .filter((task) => {
        const majorMatched = majorSet.size === 0 || majorSet.has(normalizeCategoryValue(task.categoryMajor));
        const middle1Matched = middle1Set.size === 0 || middle1Set.has(normalizeCategoryValue(task.categoryMiddle1));
        const middle2Matched = middle2Set.size === 0 || middle2Set.has(normalizeCategoryValue(task.categoryMiddle2));
        return majorMatched && middle1Matched && middle2Matched;
      })
      .map((task) => normalizeCategoryValue(task.categorySmall)),
  );
}

/** 해당 분류(레벨)에 속한 작업 ID 목록을 sortOrder 순서로 반환. 접힌 분류도 전체 작업 목록 기준으로 계산. */
function getTaskIdsInCategory(
  tasks: TaskModel[],
  path: CategoryPath,
  level: CategoryLevel,
): string[] {
  const sorted = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);
  const result: string[] = [];
  for (const task of sorted) {
    if (task.timelineHeadTaskId) {
      continue;
    }
    const p = toCategoryPath(task);
    if (level === "major" && p.major === path.major) result.push(task.id);
    else if (level === "middle1" && p.major === path.major && p.middle1 === path.middle1) result.push(task.id);
    else if (
      level === "middle2" &&
      p.major === path.major &&
      p.middle1 === path.middle1 &&
      p.middle2 === path.middle2
    )
      result.push(task.id);
    else if (
      level === "small" &&
      p.major === path.major &&
      p.middle1 === path.middle1 &&
      p.middle2 === path.middle2 &&
      p.small === path.small
    )
      result.push(task.id);
  }
  return result;
}

/** 해당 분류(레벨)의 첫 작업이 전체 목록(sortOrder 기준)에서 가지는 인덱스. 없으면 0. */
function getFirstTaskIndexInCategory(
  tasks: TaskModel[],
  path: CategoryPath,
  level: CategoryLevel,
): number {
  const sorted = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].timelineHeadTaskId) {
      continue;
    }
    const p = toCategoryPath(sorted[i]);
    if (level === "major" && p.major === path.major) return i;
    if (level === "middle1" && p.major === path.major && p.middle1 === path.middle1) return i;
    if (
      level === "middle2" &&
      p.major === path.major &&
      p.middle1 === path.middle1 &&
      p.middle2 === path.middle2
    )
      return i;
    if (
      level === "small" &&
      p.major === path.major &&
      p.middle1 === path.middle1 &&
      p.middle2 === path.middle2 &&
      p.small === path.small
    )
      return i;
  }
  return 0;
}

function timelineBlockIdsForHead(headId: string, tasks: TaskModel[]): string[] {
  const segs = tasks
    .filter((t) => t.timelineHeadTaskId === headId)
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    );
  return [headId, ...segs.map((s) => s.id)];
}

function timelineBlockIdsForHeads(headIds: string[], tasks: TaskModel[]): string[] {
  const out: string[] = [];
  for (const hid of headIds) {
    out.push(...timelineBlockIdsForHead(hid, tasks));
  }
  return out;
}

/** 분류 행 또는 액티비티 행 드래그 시 블록 단위로 순서 변경. 전체 작업 목록 기준이라 접힌 분류도 하위 포함 정확히 이동. */
export function moveRowBlock(
  draggedRow: TaskListRow,
  targetRow: TaskListRow,
  tasks: TaskModel[],
): TaskModel[] {
  const sortedOrder = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => t.id);

  let block: string[];
  if (draggedRow.rowType === "ACTIVITY_ROW") {
    block = timelineBlockIdsForHead(draggedRow.taskId, tasks);
  } else {
    block = timelineBlockIdsForHeads(getTaskIdsInCategory(tasks, draggedRow.categoryPath, draggedRow.level), tasks);
  }
  if (block.length === 0) return tasks;

  let targetIdx: number;
  if (targetRow.rowType === "ACTIVITY_ROW") {
    const idx = sortedOrder.indexOf(targetRow.taskId);
    targetIdx = idx >= 0 ? idx : 0;
  } else {
    targetIdx = getFirstTaskIndexInCategory(tasks, targetRow.categoryPath, targetRow.level);
  }

  const rest = sortedOrder.filter((id) => !block.includes(id));
  const insertIdx = Math.min(
    sortedOrder.slice(0, targetIdx).filter((id) => !block.includes(id)).length,
    rest.length,
  );
  const newOrder = [...rest.slice(0, insertIdx), ...block, ...rest.slice(insertIdx)];

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  return newOrder
    .map((id, index) => {
      const task = taskById.get(id);
      if (!task) return null;
      return { ...task, sortOrder: index };
    })
    .filter((t): t is TaskModel => t != null);
}

export function moveTaskInArray(tasks: TaskModel[], fromId: string, toId: string) {
  const active = tasks.find((task) => task.id === fromId);
  const over = tasks.find((task) => task.id === toId);
  if (!active || !over) {
    return tasks;
  }

  if (!isSameSmallCategoryGroup(active, over)) {
    return tasks;
  }

  const canonical = sortTasksForCategoryTree(tasks);
  const fromIndex = canonical.findIndex((task) => task.id === fromId);
  const toIndex = canonical.findIndex((task) => task.id === toId);

  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return tasks;
  }

  const [moved] = canonical.splice(fromIndex, 1);
  canonical.splice(toIndex, 0, moved);

  return canonical.map((task, index) => ({
    ...task,
    sortOrder: index,
  }));
}
