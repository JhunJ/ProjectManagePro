import { describe, expect, it } from "vitest";

import {
  buildFieldScheduleRows,
  collectSiteMainCategories,
  FIELD_UNCATEGORIZED_LABEL,
  getFieldScheduleRange,
} from "@/features/field-schedule/field-schedule";
import type { TaskModel } from "@/types/domain";

function createTask(
  id: string,
  patch: Partial<
    Pick<
      TaskModel,
      | "name"
      | "activityName"
      | "categoryMajor"
      | "categoryMiddle1"
      | "categoryMiddle2"
      | "categorySmall"
      | "siteMainCategory"
      | "siteDisplayText"
      | "startDate"
      | "endDate"
      | "durationDays"
      | "sortOrder"
    >
  >,
): TaskModel {
  return {
    id,
    projectId: "p1",
    parentTaskId: null,
    timelineHeadTaskId: null,
    name: patch.name ?? `Task ${id}`,
    activityName: patch.activityName ?? patch.name ?? `Task ${id}`,
    categoryMajor: patch.categoryMajor ?? null,
    categoryMiddle1: patch.categoryMiddle1 ?? null,
    categoryMiddle2: patch.categoryMiddle2 ?? null,
    categorySmall: patch.categorySmall ?? null,
    companyId: null,
    siteMainCategory: patch.siteMainCategory ?? null,
    siteDisplayText: patch.siteDisplayText ?? null,
    categoryMiddle: patch.categoryMiddle1 ?? null,
    categoryMinor: patch.categoryMiddle2 ?? null,
    wbsCode: null,
    startDate: patch.startDate ?? "2026-01-12T00:00:00.000Z",
    endDate: patch.endDate ?? "2026-01-14T00:00:00.000Z",
    durationDays: patch.durationDays ?? 3,
    progress: 0,
    assignee: null,
    color: "#3B82F6",
    isMilestone: false,
    notes: null,
    sortOrder: patch.sortOrder ?? 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("field schedule builder", () => {
  it("falls back to categoryMajor for site main category and uncategorized small rows", () => {
    const task = createTask("a1", {
      categoryMajor: "Building",
      categorySmall: null,
    });

    const categories = collectSiteMainCategories([task]);
    const result = buildFieldScheduleRows({
      tasks: [task],
      filters: {
        query: "",
        siteMainCategories: [],
        middle1Categories: [],
        middle2Categories: [],
        smallCategories: [],
      },
      scale: "MONTHLY",
      anchorDate: "2026-01-15T00:00:00.000Z",
    });

    expect(categories).toEqual(["Building"]);
    expect(result.rows[0]?.mainCategory).toBe("Building");
    expect(result.rows[0]?.smallCategory).toBe(FIELD_UNCATEGORIZED_LABEL);
  });

  it("maps categorySmall into row axis and sorts by main category then small category", () => {
    const tasks = [
      createTask("b1", { categoryMajor: "Wet", categorySmall: "Masonry", sortOrder: 1 }),
      createTask("a1", { categoryMajor: "Building", categorySmall: "201", sortOrder: 0 }),
      createTask("a2", { categoryMajor: "Building", categorySmall: "202", sortOrder: 2 }),
    ];

    const result = buildFieldScheduleRows({
      tasks,
      filters: {
        query: "",
        siteMainCategories: [],
        middle1Categories: [],
        middle2Categories: [],
        smallCategories: [],
      },
      scale: "MONTHLY",
      anchorDate: "2026-01-15T00:00:00.000Z",
    });

    expect(result.rows.map((row) => `${row.mainCategory}/${row.smallCategory}`)).toEqual([
      "Building/201",
      "Building/202",
      "Wet/Masonry",
    ]);
  });

  it("allocates separate lanes when tasks overlap in the same row", () => {
    const tasks = [
      createTask("a1", {
        categoryMajor: "Building",
        categorySmall: "201",
        startDate: "2026-01-12T00:00:00.000Z",
        endDate: "2026-01-16T00:00:00.000Z",
        durationDays: 5,
      }),
      createTask("a2", {
        categoryMajor: "Building",
        categorySmall: "201",
        startDate: "2026-01-14T00:00:00.000Z",
        endDate: "2026-01-17T00:00:00.000Z",
        durationDays: 4,
        sortOrder: 1,
      }),
    ];

    const result = buildFieldScheduleRows({
      tasks,
      filters: {
        query: "",
        siteMainCategories: [],
        middle1Categories: [],
        middle2Categories: [],
        smallCategories: [],
      },
      scale: "MONTHLY",
      anchorDate: "2026-01-15T00:00:00.000Z",
    });

    expect(result.rows[0]?.laneCount).toBe(2);
    expect(result.rows[0]?.segments.map((segment) => segment.lane)).toEqual([0, 1]);
  });

  it("builds monthly and 3-week weekly ranges from the anchor date", () => {
    const monthly = getFieldScheduleRange("2026-01-15T00:00:00.000Z", "MONTHLY");
    const weekly = getFieldScheduleRange("2026-01-15T00:00:00.000Z", "WEEKLY");

    expect(monthly.days).toHaveLength(31);
    expect(monthly.days[0]?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(monthly.days[30]?.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(weekly.days).toHaveLength(21);
    expect(weekly.days[0]?.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect(weekly.days[20]?.toISOString()).toBe("2026-01-25T00:00:00.000Z");
  });

  it("applies site main and small category filters before building rows", () => {
    const tasks = [
      createTask("a1", { categoryMajor: "Building", siteMainCategory: "Building", categorySmall: "201" }),
      createTask("a2", { categoryMajor: "Building", siteMainCategory: "Building", categorySmall: "202" }),
      createTask("b1", { categoryMajor: "Wet", siteMainCategory: "Wet", categorySmall: "Masonry" }),
    ];

    const result = buildFieldScheduleRows({
      tasks,
      filters: {
        query: "",
        siteMainCategories: ["Building"],
        middle1Categories: [],
        middle2Categories: [],
        smallCategories: ["202"],
      },
      scale: "MONTHLY",
      anchorDate: "2026-01-15T00:00:00.000Z",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.mainCategory).toBe("Building");
    expect(result.rows[0]?.smallCategory).toBe("202");
  });

  it("merges rows when hidden middle categories are turned off", () => {
    const tasks = [
      createTask("a1", {
        categoryMajor: "Building",
        siteMainCategory: "Building",
        categoryMiddle1: "Frame",
        categoryMiddle2: "Form",
        categorySmall: "201",
      }),
      createTask("a2", {
        categoryMajor: "Building",
        siteMainCategory: "Building",
        categoryMiddle1: "Finish",
        categoryMiddle2: "Paint",
        categorySmall: "201",
        sortOrder: 1,
      }),
    ];

    const visibleResult = buildFieldScheduleRows({
      tasks,
      filters: {
        query: "",
        siteMainCategories: [],
        middle1Categories: [],
        middle2Categories: [],
        smallCategories: [],
      },
      scale: "MONTHLY",
      anchorDate: "2026-01-15T00:00:00.000Z",
      showMiddle1Category: true,
      showMiddle2Category: true,
    });

    const mergedResult = buildFieldScheduleRows({
      tasks,
      filters: {
        query: "",
        siteMainCategories: [],
        middle1Categories: [],
        middle2Categories: [],
        smallCategories: [],
      },
      scale: "MONTHLY",
      anchorDate: "2026-01-15T00:00:00.000Z",
      showMiddle1Category: false,
      showMiddle2Category: false,
    });

    expect(visibleResult.rows).toHaveLength(2);
    expect(mergedResult.rows).toHaveLength(1);
    expect(mergedResult.rows[0]?.segments).toHaveLength(2);
  });

  it("applies middle category filters in field schedule", () => {
    const tasks = [
      createTask("a1", {
        categoryMajor: "Building",
        siteMainCategory: "Building",
        categoryMiddle1: "Frame",
        categoryMiddle2: "Form",
        categorySmall: "201",
      }),
      createTask("a2", {
        categoryMajor: "Building",
        siteMainCategory: "Building",
        categoryMiddle1: "Finish",
        categoryMiddle2: "Paint",
        categorySmall: "201",
        sortOrder: 1,
      }),
    ];

    const result = buildFieldScheduleRows({
      tasks,
      filters: {
        query: "",
        siteMainCategories: ["Building"],
        middle1Categories: ["Frame"],
        middle2Categories: ["Form"],
        smallCategories: ["201"],
      },
      scale: "MONTHLY",
      anchorDate: "2026-01-15T00:00:00.000Z",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.segments).toHaveLength(1);
    expect(result.rows[0]?.segments[0]?.task.id).toBe("a1");
  });
});
