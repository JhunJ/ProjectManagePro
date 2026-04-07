export const queryKeys = {
  projects: ["projects"] as const,
  projectSchedule: (projectId: string) => ["project-schedule", projectId] as const,
  projectVersions: (projectId: string) => ["project-versions", projectId] as const,
  projectVersionDetail: (projectId: string, versionId: string) =>
    ["project-version-detail", projectId, versionId] as const,
  projectVersionSchedule: (projectId: string, versionId: string) =>
    ["project-version-schedule", projectId, versionId] as const,
  projectVersionCompare: (projectId: string, planVersionId: string, actualVersionId: string) =>
    ["project-version-compare", projectId, planVersionId, actualVersionId] as const,
  companies: (projectId: string) => ["companies", projectId] as const,
  holidays: (projectId: string) => ["holidays", projectId] as const,
};
