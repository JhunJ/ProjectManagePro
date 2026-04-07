import { describe, expect, it } from "vitest";

import { updateProjectVersionMeta } from "@/server/services/version-service";

function buildVersionRow() {
  return {
    id: "version-1",
    projectId: "project-1",
    versionType: "PLAN" as const,
    versionNo: 1,
    title: "Initial title",
    description: "initial description",
    createdBy: "planner",
    createdAt: new Date("2026-03-06T00:00:00.000Z"),
    snapshotJson: "{}",
    taskCount: 5,
    dependencyCount: 3,
  };
}

describe("version-service update", () => {
  it("returns null when target version is missing", async () => {
    const db = {
      projectVersion: {
        findFirst: async () => null,
        update: async () => {
          throw new Error("should not be called");
        },
      },
    };

    const result = await updateProjectVersionMeta({
      projectId: "project-1",
      versionId: "missing",
      title: "next",
      db: db as never,
    });

    expect(result).toBeNull();
  });

  it("trims title/createdBy and normalizes blank description to null", async () => {
    const row = buildVersionRow();
    let lastUpdateData: Record<string, unknown> | null = null;

    const db = {
      projectVersion: {
        findFirst: async ({ where }: { where: { id: string; projectId: string } }) =>
          where.id === row.id && where.projectId === row.projectId ? row : null,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          lastUpdateData = data;
          const next = { ...row } as Record<string, unknown>;
          for (const [key, value] of Object.entries(data)) {
            if (value !== undefined) {
              next[key] = value;
            }
          }
          return next;
        },
      },
    };

    const result = await updateProjectVersionMeta({
      projectId: "project-1",
      versionId: "version-1",
      title: "  PLAN v1 revised  ",
      description: "   ",
      createdBy: "  scheduler  ",
      db: db as never,
    });

    expect(lastUpdateData).toEqual({
      title: "PLAN v1 revised",
      description: null,
      createdBy: "scheduler",
    });
    expect(result?.title).toBe("PLAN v1 revised");
    expect(result?.description).toBeNull();
    expect(result?.createdBy).toBe("scheduler");
  });
});

