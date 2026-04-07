import { describe, expect, it } from "vitest";

import {
  buildProjectHolidayLabelSegments,
  DEFAULT_TIMELINE_VISIBILITY,
  getTimelineDayKey,
  getTimelineRange,
  isFixedHoliday,
  isProjectHoliday,
  isWeekend,
} from "@/features/gantt/timeline";
import type { TaskModel } from "@/types/domain";

function createFutureTask(daysFromNow: number): TaskModel {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + daysFromNow);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 5);

  return {
    id: "future-task",
    projectId: "p1",
    parentTaskId: null,
    timelineHeadTaskId: null,
    name: "Future Task",
    activityName: "Future Task",
    categoryMajor: "골조",
    categoryMiddle1: "기초",
    categoryMiddle2: "콘크리트",
    categorySmall: "타설",
    companyId: null,
    siteMainCategory: "怨⑥“",
    siteDisplayText: "Future Task",
    categoryMiddle: "기초",
    categoryMinor: "콘크리트",
    wbsCode: null,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    durationDays: 6,
    progress: 0,
    assignee: null,
    color: "#3B82F6",
    isMilestone: false,
    notes: null,
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("timeline range", () => {
  it("always includes today even when all tasks are far in the future", () => {
    const futureTask = createFutureTask(400);
    const range = getTimelineRange([futureTask], "week", DEFAULT_TIMELINE_VISIBILITY);

    const dayKeys = new Set(range.days.map((day) => getTimelineDayKey(day)));
    expect(dayKeys.has(getTimelineDayKey(new Date()))).toBe(true);
  });

  it("distinguishes weekends and project holidays separately", () => {
    expect(isWeekend("2026-03-07T00:00:00.000Z")).toBe(true);
    expect(isFixedHoliday("2026-03-01T00:00:00.000Z")).toBe(true);
    expect(isProjectHoliday("2026-03-12T00:00:00.000Z", new Set(["2026-03-12"]))).toBe(true);
    expect(isProjectHoliday("2026-03-13T00:00:00.000Z", new Set(["2026-03-12"]))).toBe(false);
  });
});

describe("buildProjectHolidayLabelSegments", () => {
  it("merges consecutive days with the same label", () => {
    const days = [
      new Date("2026-04-01T00:00:00.000Z"),
      new Date("2026-04-02T00:00:00.000Z"),
      new Date("2026-04-03T00:00:00.000Z"),
    ];
    const holidays = [
      {
        scope: "PROJECT" as const,
        name: "창립기념일",
        startDate: "2026-04-01T00:00:00.000Z",
        endDate: "2026-04-02T00:00:00.000Z",
      },
    ];
    const segs = buildProjectHolidayLabelSegments(days, holidays);
    expect(segs).toEqual([{ startIndex: 0, endIndex: 1, label: "창립기념일" }]);
  });

  it("uses 휴일 when project holiday has no name; ignores company scope", () => {
    const days = [new Date("2026-04-10T00:00:00.000Z")];
    const holidays = [
      { scope: "PROJECT" as const, name: null, startDate: "2026-04-10T00:00:00.000Z", endDate: "2026-04-10T00:00:00.000Z" },
      {
        scope: "COMPANY" as const,
        name: "업체휴일",
        startDate: "2026-04-10T00:00:00.000Z",
        endDate: "2026-04-10T00:00:00.000Z",
      },
    ];
    expect(buildProjectHolidayLabelSegments(days, holidays)).toEqual([{ startIndex: 0, endIndex: 0, label: "휴일" }]);
  });

  it("shows 휴일 from projectHolidayDayKeys when holiday list does not match that day", () => {
    const days = [new Date("2026-05-01T00:00:00.000Z")];
    const keys = new Set(["2026-05-01"]);
    expect(buildProjectHolidayLabelSegments(days, [], keys)).toEqual([{ startIndex: 0, endIndex: 0, label: "휴일" }]);
  });
});
