import { describe, expect, it } from "vitest";

import { isWorkingDay } from "@/server/schedulers/business-days";
import { buildTaskCalendarByTaskId } from "@/server/services/schedule-service";

const BASE_CALENDAR = {
  workMon: true,
  workTue: true,
  workWed: true,
  workThu: true,
  workFri: true,
  workSat: false,
  workSun: false,
};

describe("schedule-service calendar merge", () => {
  it("merges project + company holidays per task", () => {
    const map = buildTaskCalendarByTaskId({
      tasks: [
        { id: "t1", companyId: "c1" },
        { id: "t2", companyId: null },
      ],
      calendar: BASE_CALENDAR,
      holidays: [
        {
          scope: "PROJECT",
          companyId: null,
          startDate: new Date("2026-03-04T00:00:00.000Z"),
          endDate: new Date("2026-03-04T00:00:00.000Z"),
        },
        {
          scope: "COMPANY",
          companyId: "c1",
          startDate: new Date("2026-03-05T00:00:00.000Z"),
          endDate: new Date("2026-03-05T00:00:00.000Z"),
        },
      ],
    });

    const taskCompanyCalendar = map.get("t1");
    const taskProjectCalendar = map.get("t2");
    if (!taskCompanyCalendar || !taskProjectCalendar) {
      throw new Error("Expected calendars for all tasks.");
    }

    expect(isWorkingDay(new Date("2026-03-04T00:00:00.000Z"), taskCompanyCalendar)).toBe(false);
    expect(isWorkingDay(new Date("2026-03-05T00:00:00.000Z"), taskCompanyCalendar)).toBe(false);

    expect(isWorkingDay(new Date("2026-03-04T00:00:00.000Z"), taskProjectCalendar)).toBe(false);
    expect(isWorkingDay(new Date("2026-03-05T00:00:00.000Z"), taskProjectCalendar)).toBe(true);
  });
});
