import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKING_CALENDAR,
  addBusinessDays,
  businessDaysBetween,
  isWorkingDay,
  normalizeTaskDates,
  shiftToNearestWorkingDay,
} from "@/server/schedulers/business-days";

describe("business-days", () => {
  it("skips weekend when adding days", () => {
    const friday = new Date(Date.UTC(2026, 2, 6));
    const next = addBusinessDays(friday, 1, DEFAULT_WORKING_CALENDAR);
    expect(next.toISOString().slice(0, 10)).toBe("2026-03-09");
  });

  it("counts business days inclusively", () => {
    const start = new Date(Date.UTC(2026, 2, 2));
    const end = new Date(Date.UTC(2026, 2, 6));
    expect(businessDaysBetween(start, end, DEFAULT_WORKING_CALENDAR)).toBe(5);
  });

  it("normalizes milestone to single day", () => {
    const normalized = normalizeTaskDates(
      {
        startDate: new Date(Date.UTC(2026, 2, 7)),
        endDate: new Date(Date.UTC(2026, 2, 10)),
        isMilestone: true,
      },
      DEFAULT_WORKING_CALENDAR,
    );

    expect(normalized.durationDays).toBe(1);
    expect(normalized.startDate.getTime()).toBe(normalized.endDate.getTime());
    expect(isWorkingDay(normalized.startDate, DEFAULT_WORKING_CALENDAR)).toBe(true);
  });

  it("moves weekend to nearest working day", () => {
    const sunday = new Date(Date.UTC(2026, 2, 8));
    const shifted = shiftToNearestWorkingDay(sunday, DEFAULT_WORKING_CALENDAR, "forward");
    expect(shifted.toISOString().slice(0, 10)).toBe("2026-03-09");
  });

  it("treats project holiday as non-working day", () => {
    const calendar = {
      ...DEFAULT_WORKING_CALENDAR,
      holidayDayKeys: new Set(["2026-03-04"]),
    };

    const holiday = new Date(Date.UTC(2026, 2, 4));
    const next = addBusinessDays(new Date(Date.UTC(2026, 2, 3)), 1, calendar);

    expect(isWorkingDay(holiday, calendar)).toBe(false);
    expect(next.toISOString().slice(0, 10)).toBe("2026-03-05");
  });

  it("counts business days with holiday exclusions", () => {
    const calendar = {
      ...DEFAULT_WORKING_CALENDAR,
      holidayDayKeys: new Set(["2026-03-04"]),
    };
    const start = new Date(Date.UTC(2026, 2, 2));
    const end = new Date(Date.UTC(2026, 2, 6));

    expect(businessDaysBetween(start, end, calendar)).toBe(4);
  });
});
