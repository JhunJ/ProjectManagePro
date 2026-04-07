import { describe, expect, it } from "vitest";

import { compareProjectVersions } from "@/server/services/version-service";
import type { ProjectVersionSnapshot } from "@/types/domain";

function buildSnapshot(taskEndDate: string): ProjectVersionSnapshot {
  return {
    schemaVersion: 2,
    capturedAt: "2026-03-06T00:00:00.000Z",
    project: {
      id: "p1",
      name: "Project",
      description: null,
      startDate: "2026-03-01T00:00:00.000Z",
      endDate: "2026-03-31T00:00:00.000Z",
    },
    calendar: {
      workMon: true,
      workTue: true,
      workWed: true,
      workThu: true,
      workFri: true,
      workSat: false,
      workSun: false,
    },
    tasks: [
      {
        id: "t1",
        name: "Activity 1",
        activityName: "Activity 1",
        categoryMajor: "A",
        categoryMiddle1: "B1",
        categoryMiddle2: "B2",
        categorySmall: "C",
        companyId: null,
        siteMainCategory: "A",
        siteDisplayText: "Activity 1",
        categoryMiddle: "B1",
        categoryMinor: "B2",
        wbsCode: "1",
        parentTaskId: null,
        timelineHeadTaskId: null,
        startDate: "2026-03-03T00:00:00.000Z",
        endDate: taskEndDate,
        durationDays: 3,
        progress: 0,
        assignee: null,
        color: "#3B82F6",
        isMilestone: false,
        notes: null,
        sortOrder: 0,
      },
    ],
    dependencies: [],
  };
}

function buildDbStub(options: { planType?: "PLAN" | "ACTUAL"; actualType?: "PLAN" | "ACTUAL" }) {
  const planType = options.planType ?? "PLAN";
  const actualType = options.actualType ?? "ACTUAL";

  const rows = {
    plan: {
      id: "plan-v1",
      projectId: "p1",
      versionType: planType,
      versionNo: 1,
      title: "Plan v1",
      description: null,
      createdBy: "tester",
      createdAt: new Date("2026-03-06T00:00:00.000Z"),
      snapshotJson: JSON.stringify(buildSnapshot("2026-03-05T00:00:00.000Z")),
      taskCount: 1,
      dependencyCount: 0,
    },
    actual: {
      id: "actual-v1",
      projectId: "p1",
      versionType: actualType,
      versionNo: 1,
      title: "Actual v1",
      description: null,
      createdBy: "tester",
      createdAt: new Date("2026-03-06T00:00:00.000Z"),
      snapshotJson: JSON.stringify(buildSnapshot("2026-03-07T00:00:00.000Z")),
      taskCount: 1,
      dependencyCount: 0,
    },
  };

  return {
    projectVersion: {
      findFirst: async ({ where }: { where: { id?: string } }) => {
        if (where.id === "plan-v1") return rows.plan;
        if (where.id === "actual-v1") return rows.actual;
        return null;
      },
    },
  };
}

describe("version-service compare", () => {
  it("compares PLAN vs ACTUAL and returns end delay delta", async () => {
    const db = buildDbStub({});
    const result = await compareProjectVersions("p1", "plan-v1", "actual-v1", db as never);

    expect(result.comparison.planVersion.versionType).toBe("PLAN");
    expect(result.comparison.actualVersion.versionType).toBe("ACTUAL");
    expect(result.summary.updated).toBe(1);
    expect(result.tasks[0]?.scheduleDelta?.endDelayDays).toBe(2);
  });

  it("rejects when selected versions are not PLAN vs ACTUAL", async () => {
    const db = buildDbStub({ actualType: "PLAN" });
    await expect(compareProjectVersions("p1", "plan-v1", "actual-v1", db as never)).rejects.toThrow(
      "actualVersionId must reference ACTUAL version.",
    );
  });
});
