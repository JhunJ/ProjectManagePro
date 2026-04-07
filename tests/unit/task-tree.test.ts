import { describe, expect, it } from "vitest";

import {
  buildVisibleTaskList,
  collectCategoryRowIds,
  DEFAULT_TASK_LIST_CATEGORY_VISIBILITY,
  moveRowBlock,
  moveTaskInArray,
  UNCATEGORIZED_LABEL,
} from "@/features/tasks/task-tree";
import type { TaskListRow } from "@/types/domain";
import type { TaskModel } from "@/types/domain";

const FILTERS = {
  query: "",
  assignee: "all",
  companyId: "all",
  majorCategories: [],
  middle1Categories: [],
  middle2Categories: [],
  smallCategories: [],
  completion: "all" as const,
  milestoneOnly: false,
  sortBy: "sortOrder" as const,
};

function createTask(
  id: string,
  sortOrder: number,
  category: Partial<Pick<TaskModel, "categoryMajor" | "categoryMiddle1" | "categoryMiddle2" | "categorySmall">>,
): TaskModel {
  return {
    id,
    projectId: "p1",
    parentTaskId: null,
    timelineHeadTaskId: null,
    name: `Task ${id}`,
    activityName: `Activity ${id}`,
    categoryMajor: category.categoryMajor ?? null,
    categoryMiddle1: category.categoryMiddle1 ?? null,
    categoryMiddle2: category.categoryMiddle2 ?? null,
    categorySmall: category.categorySmall ?? null,
    companyId: null,
    siteMainCategory: category.categoryMajor ?? null,
    siteDisplayText: `Activity ${id}`,
    categoryMiddle: category.categoryMiddle1 ?? null,
    categoryMinor: category.categoryMiddle2 ?? null,
    wbsCode: null,
    startDate: "2026-03-03T00:00:00.000Z",
    endDate: "2026-03-05T00:00:00.000Z",
    durationDays: 3,
    progress: 0,
    assignee: null,
    color: "#3B82F6",
    isMilestone: false,
    notes: null,
    sortOrder,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  };
}

describe("task-tree virtual category rows", () => {
  it("builds 4-level category rows and activity leaf rows", () => {
    const tasks = [
      createTask("a1", 0, { categoryMajor: "골조", categoryMiddle1: "기초", categoryMiddle2: "콘크리트", categorySmall: "타설" }),
      createTask("a2", 1, { categoryMajor: "골조", categoryMiddle1: "기초", categoryMiddle2: "콘크리트", categorySmall: "타설" }),
      createTask("b1", 2, { categoryMajor: "마감", categoryMiddle1: "도장", categoryMiddle2: "벽체", categorySmall: "1층" }),
    ];

    const rows = buildVisibleTaskList(tasks, collectCategoryRowIds(tasks), FILTERS);
    const categoryRows = rows.filter((row) => row.rowType === "CATEGORY_ROW");
    const activityRows = rows.filter((row) => row.rowType === "ACTIVITY_ROW");

    expect(rows.length).toBeGreaterThan(tasks.length);
    expect(categoryRows.length).toBe(8);
    expect(activityRows.length).toBe(3);
    expect(activityRows[0]?.taskId).toBe("a1");
    expect(activityRows[1]?.taskId).toBe("a2");
  });

  it("maps empty categories into uncategorized bucket", () => {
    const tasks = [createTask("x1", 0, {})];
    const rows = buildVisibleTaskList(tasks, collectCategoryRowIds(tasks), FILTERS);

    const labels = rows.filter((row) => row.rowType === "CATEGORY_ROW").map((row) => row.label);
    expect(labels).toContain(UNCATEGORIZED_LABEL);
  });

  it("hides middle1 headers when showMiddle1Category is false", () => {
    const tasks = [
      createTask("a1", 0, { categoryMajor: "골조", categoryMiddle1: "기초", categoryMiddle2: "콘크리트", categorySmall: "타설" }),
      createTask("b1", 1, { categoryMajor: "마감", categoryMiddle1: "도장", categoryMiddle2: "벽체", categorySmall: "1층" }),
    ];
    const visibility = { ...DEFAULT_TASK_LIST_CATEGORY_VISIBILITY, showMiddle1Category: false };
    const expanded = collectCategoryRowIds(tasks, visibility);
    const rows = buildVisibleTaskList(tasks, expanded, FILTERS, visibility);
    const m1 = rows.filter((row) => row.rowType === "CATEGORY_ROW" && row.level === "middle1");
    expect(m1).toHaveLength(0);
    expect(rows.filter((row) => row.rowType === "ACTIVITY_ROW")).toHaveLength(2);
  });

  it("hides category rows when no activity matches filters", () => {
    const tasks = [
      createTask("a1", 0, { categoryMajor: "골조", categoryMiddle1: "기초", categoryMiddle2: "콘크리트", categorySmall: "타설" }),
      createTask("b1", 1, { categoryMajor: "마감", categoryMiddle1: "도장", categoryMiddle2: "벽체", categorySmall: "1층" }),
    ];

    const rows = buildVisibleTaskList(tasks, collectCategoryRowIds(tasks), {
      ...FILTERS,
      majorCategories: ["마감"],
    });

    const categoryLabels = rows.filter((row) => row.rowType === "CATEGORY_ROW").map((row) => row.label);
    expect(categoryLabels).toContain("마감");
    expect(categoryLabels).not.toContain("골조");
  });

  it("orders major categories by global sortOrder, not alphabetically", () => {
    const tasks = [
      createTask("m1", 0, { categoryMajor: "마감", categoryMiddle1: "도장", categoryMiddle2: "벽", categorySmall: "1층" }),
      createTask("g1", 1, { categoryMajor: "골조", categoryMiddle1: "기초", categoryMiddle2: "콘", categorySmall: "타설" }),
    ];
    const expanded = collectCategoryRowIds(tasks);
    const rows = buildVisibleTaskList(tasks, expanded, FILTERS);
    const majorRows = rows.filter((row) => row.rowType === "CATEGORY_ROW" && row.level === "major");
    expect(majorRows.map((r) => r.label)).toEqual(["마감", "골조"]);
  });

  it("moveRowBlock swapping major blocks updates visible major order", () => {
    const tasks = [
      createTask("m1", 0, { categoryMajor: "마감", categoryMiddle1: "도장", categoryMiddle2: "벽", categorySmall: "1층" }),
      createTask("g1", 1, { categoryMajor: "골조", categoryMiddle1: "기초", categoryMiddle2: "콘", categorySmall: "타설" }),
    ];
    const expanded = collectCategoryRowIds(tasks);
    const beforeRows = buildVisibleTaskList(tasks, expanded, FILTERS);
    const majorMajuem = beforeRows.find(
      (r): r is TaskListRow & { rowType: "CATEGORY_ROW" } =>
        r.rowType === "CATEGORY_ROW" && r.level === "major" && r.label === "마감",
    );
    const majorGoljo = beforeRows.find(
      (r): r is TaskListRow & { rowType: "CATEGORY_ROW" } =>
        r.rowType === "CATEGORY_ROW" && r.level === "major" && r.label === "골조",
    );
    expect(majorMajuem && majorGoljo).toBeTruthy();
    /** 골조 블록을 마감 앞(sortOrder상 더 앞)으로 옮기면 목록에서 골조 대분류가 먼저 보인다. */
    const reordered = moveRowBlock(majorGoljo!, majorMajuem!, tasks);
    const afterRows = buildVisibleTaskList(reordered, collectCategoryRowIds(reordered), FILTERS);
    const majorRows = afterRows.filter((row) => row.rowType === "CATEGORY_ROW" && row.level === "major");
    expect(majorRows.map((r) => r.label)).toEqual(["골조", "마감"]);
  });

  it("reorders only inside the same small category group", () => {
    const t1 = createTask("a1", 0, { categoryMajor: "골조", categoryMiddle1: "기초", categoryMiddle2: "콘크리트", categorySmall: "타설" });
    const t2 = createTask("a2", 1, { categoryMajor: "골조", categoryMiddle1: "기초", categoryMiddle2: "콘크리트", categorySmall: "타설" });
    const t3 = createTask("b1", 2, { categoryMajor: "마감", categoryMiddle1: "도장", categoryMiddle2: "벽체", categorySmall: "1층" });
    const tasks = [t1, t2, t3];

    const movedInside = moveTaskInArray(tasks, "a2", "a1");
    expect(movedInside.find((task) => task.id === "a2")?.sortOrder).toBeLessThan(
      movedInside.find((task) => task.id === "a1")?.sortOrder ?? 0,
    );

    const movedAcross = moveTaskInArray(tasks, "a1", "b1");
    expect(movedAcross).toBe(tasks);
  });
});
