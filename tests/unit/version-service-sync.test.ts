import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/services/schedule-service", () => ({
  getProjectSchedule: async () => ({
    project: {
      id: "project-1",
      name: "Project Alpha",
      description: "current",
      startDate: "2026-03-01T00:00:00.000Z",
      endDate: "2026-03-31T00:00:00.000Z",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
    },
    tasks: [
      {
        id: "task-1",
        projectId: "project-1",
        parentTaskId: null,
        timelineHeadTaskId: null,
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
        startDate: "2026-03-03T00:00:00.000Z",
        endDate: "2026-03-05T00:00:00.000Z",
        durationDays: 3,
        progress: 50,
        assignee: null,
        color: "#3B82F6",
        isMilestone: false,
        notes: null,
        sortOrder: 0,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:00.000Z",
      },
    ],
    dependencies: [],
    calendar: {
      id: "cal-1",
      projectId: "project-1",
      workMon: true,
      workTue: true,
      workWed: true,
      workThu: true,
      workFri: true,
      workSat: false,
      workSun: false,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
    },
    companies: [],
    holidays: [],
  }),
}));

import { syncProjectVersionSnapshot } from "@/server/services/version-service";
import type { ProjectVersionModel } from "@/types/domain";

type SnapshotUpdatePayload = {
  taskCount?: number;
  dependencyCount?: number;
  snapshotJson?: unknown;
};

describe("version-service sync", () => {
  it("overwrites snapshotJson from current schedule", async () => {
    const row = {
      id: "version-1",
      projectId: "project-1",
      versionType: "PLAN" as const,
      versionNo: 1,
      title: "Plan v1",
      description: null,
      createdBy: "planner",
      createdAt: new Date("2026-03-05T00:00:00.000Z"),
      snapshotJson: "{}",
      taskCount: 0,
      dependencyCount: 0,
    };

    const capturedUpdate: { current: SnapshotUpdatePayload | null } = { current: null };
    const db = {
      projectVersion: {
        findFirst: async ({ where }: { where: { id: string; projectId: string } }) =>
          where.id === row.id && where.projectId === row.projectId ? row : null,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          capturedUpdate.current = data as SnapshotUpdatePayload;
          return {
            ...row,
            ...data,
          };
        },
      },
    };

    const result: ProjectVersionModel | null = await syncProjectVersionSnapshot(
      "project-1",
      "version-1",
      db as unknown as Parameters<typeof syncProjectVersionSnapshot>[2],
    );

    expect(result?.taskCount).toBe(1);
    expect(result?.dependencyCount).toBe(0);
    expect(capturedUpdate.current?.taskCount).toBe(1);
    expect(capturedUpdate.current?.dependencyCount).toBe(0);
    expect(typeof capturedUpdate.current?.snapshotJson).toBe("string");

    const snapshot = JSON.parse(String(capturedUpdate.current?.snapshotJson)) as {
      project: { name: string };
      tasks: Array<{ activityName: string }>;
    };
    expect(snapshot.project.name).toBe("Project Alpha");
    expect(snapshot.tasks[0]?.activityName).toBe("Activity 1");
  });
});
