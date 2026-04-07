import { describe, expect, it } from "vitest";

import {
  holidayCreateSchema,
  projectVersionCompareSchema,
  projectVersionUpdateSchema,
  taskCreateSchema,
} from "@/lib/validations/schemas";

describe("validation schemas", () => {
  it("accepts task payload with expanded category hierarchy + activity + company", () => {
    const parsed = taskCreateSchema.safeParse({
      name: "Activity A",
      activityName: "Activity A",
      categoryMajor: "구조",
      categoryMiddle1: "골조",
      categoryMiddle2: "슬래브",
      categorySmall: "3층",
      companyId: "company-1",
      siteMainCategory: "건축",
      siteDisplayText: "3층 바닥 먹메김",
      startDate: "2026-03-02T00:00:00.000Z",
      endDate: "2026-03-04T00:00:00.000Z",
      durationDays: 3,
      progress: 10,
      color: "#3B82F6",
      isMilestone: false,
    });

    expect(parsed.success).toBe(true);
  });

  it("requires PLAN+ACTUAL ids for version compare request", () => {
    const missingActual = projectVersionCompareSchema.safeParse({
      planVersionId: "plan-v1",
    });
    const valid = projectVersionCompareSchema.safeParse({
      planVersionId: "plan-v1",
      actualVersionId: "actual-v1",
    });

    expect(missingActual.success).toBe(false);
    expect(valid.success).toBe(true);
  });

  it("accepts partial payload for version update", () => {
    const parsed = projectVersionUpdateSchema.safeParse({
      title: "PLAN v1 (updated)",
      createdBy: "scheduler",
    });

    expect(parsed.success).toBe(true);
  });

  it("requires companyId when holiday scope is COMPANY", () => {
    const invalid = holidayCreateSchema.safeParse({
      scope: "COMPANY",
      startDate: "2026-03-10T00:00:00.000Z",
      endDate: "2026-03-10T00:00:00.000Z",
    });
    const valid = holidayCreateSchema.safeParse({
      scope: "COMPANY",
      companyId: "c1",
      startDate: "2026-03-10T00:00:00.000Z",
      endDate: "2026-03-10T00:00:00.000Z",
    });

    expect(invalid.success).toBe(false);
    expect(valid.success).toBe(true);
  });
});
