import type {
  CompanyModel,
  DependencyModel,
  HolidayModel,
  ProjectModel,
  ProjectSchedulePayload,
  ProjectVersionCompareResult,
  ProjectVersionDetail,
  ProjectVersionModel,
  ProjectVersionType,
  TaskModel,
  WorkingCalendarModel,
} from "@/types/domain";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      const from = encodeURIComponent(window.location.pathname || "/projects");
      window.location.href = `/login?from=${from}`;
      return new Promise(() => {}) as Promise<T>;
    }
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "요청 처리에 실패했습니다.");
  }

  return response.json() as Promise<T>;
}

export async function getProjects() {
  return request<ProjectModel[]>("/api/projects");
}

export async function createProject(input: {
  name: string;
  description?: string | null;
  startDate: string;
  endDate?: string | null;
}) {
  return request<ProjectModel>("/api/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateProject(projectId: string, input: Partial<{ name: string; description: string | null; startDate: string; endDate: string | null }>) {
  return request<ProjectModel>(`/api/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteProject(projectId: string) {
  return request<{ success: boolean }>(`/api/projects/${projectId}`, {
    method: "DELETE",
  });
}

export async function setProjectFavorite(projectId: string, favorite: boolean) {
  return request<{ favorite: boolean }>(`/api/projects/${projectId}/favorite`, {
    method: "PUT",
    body: JSON.stringify({ favorite }),
  });
}

export async function getProjectSchedule(projectId: string) {
  return request<ProjectSchedulePayload>(`/api/projects/${projectId}`);
}

export async function createTask(projectId: string, input: Partial<TaskModel> & { name: string; startDate: string; endDate: string; durationDays: number }) {
  return request<TaskModel>(`/api/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateTask(
  taskId: string,
  input: Partial<TaskModel> & { recalculateSuccessors?: boolean; forceAllDependencies?: boolean },
) {
  return request<TaskModel>(`/api/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteTask(taskId: string) {
  return request<{ success: boolean }>(`/api/tasks/${taskId}`, {
    method: "DELETE",
  });
}

export async function reorderTasks(projectId: string, items: Array<{ id: string; sortOrder: number; parentTaskId: string | null }>) {
  return request<TaskModel[]>(`/api/projects/${projectId}/tasks/reorder`, {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export async function createDependency(
  projectId: string,
  input: {
    predecessorTaskId: string;
    successorTaskId: string;
    type: "FS" | "SS" | "FF" | "SF";
    lagDays: number;
    /** false면 연결만 추가하고 스케줄 재계산 생략 */
    drivesSchedule?: boolean;
  },
) {
  return request<DependencyModel>(`/api/projects/${projectId}/dependencies`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateDependency(
  dependencyId: string,
  input: Partial<{
    predecessorTaskId: string;
    successorTaskId: string;
    type: "FS" | "SS" | "FF" | "SF";
    lagDays: number;
    /** false면 수정 후 스케줄 재계산 생략 */
    drivesSchedule?: boolean;
  }>,
) {
  return request<DependencyModel>(`/api/dependencies/${dependencyId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteDependency(dependencyId: string) {
  return request<{ success: boolean }>(`/api/dependencies/${dependencyId}`, {
    method: "DELETE",
  });
}

export async function updateCalendar(projectId: string, input: Partial<WorkingCalendarModel>) {
  return request<WorkingCalendarModel>(`/api/projects/${projectId}/calendar`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function recalculateSchedule(projectId: string, anchorTaskIds: string[]) {
  return request<{ changedTaskIds: string[]; count: number }>(`/api/projects/${projectId}/schedule/recalculate`, {
    method: "POST",
    body: JSON.stringify({ anchorTaskIds }),
  });
}

export async function getProjectVersions(projectId: string) {
  return request<ProjectVersionModel[]>(`/api/projects/${projectId}/versions`);
}

export async function createProjectVersion(
  projectId: string,
  input: { title: string; description?: string | null; createdBy: string; versionType: ProjectVersionType },
) {
  return request<ProjectVersionModel>(`/api/projects/${projectId}/versions`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getProjectVersion(projectId: string, versionId: string) {
  return request<ProjectVersionDetail>(`/api/projects/${projectId}/versions/${versionId}`);
}

export async function getProjectVersionSchedule(projectId: string, versionId: string) {
  return request<ProjectSchedulePayload>(`/api/projects/${projectId}/versions/${versionId}/schedule`);
}

export async function updateProjectVersion(
  projectId: string,
  versionId: string,
  input: Partial<{ title: string; description: string | null; createdBy: string }>,
) {
  return request<ProjectVersionModel>(`/api/projects/${projectId}/versions/${versionId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function activateProjectVersion(projectId: string, versionId: string) {
  return request<ProjectSchedulePayload>(`/api/projects/${projectId}/versions/${versionId}/activate`, {
    method: "POST",
  });
}

export async function syncProjectVersion(projectId: string, versionId: string) {
  return request<ProjectVersionModel>(`/api/projects/${projectId}/versions/${versionId}/sync`, {
    method: "POST",
  });
}

export async function compareProjectVersion(projectId: string, planVersionId: string, actualVersionId: string) {
  return request<ProjectVersionCompareResult>(`/api/projects/${projectId}/versions/compare`, {
    method: "POST",
    body: JSON.stringify({ planVersionId, actualVersionId }),
  });
}

export async function getCompanies(projectId: string) {
  return request<CompanyModel[]>(`/api/projects/${projectId}/companies`);
}

export async function createCompany(projectId: string, input: { name: string }) {
  return request<CompanyModel>(`/api/projects/${projectId}/companies`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateCompany(companyId: string, input: Partial<{ name: string }>) {
  return request<CompanyModel>(`/api/companies/${companyId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteCompany(companyId: string) {
  return request<{ success: boolean }>(`/api/companies/${companyId}`, {
    method: "DELETE",
  });
}

export async function getHolidays(projectId: string) {
  return request<HolidayModel[]>(`/api/projects/${projectId}/holidays`);
}

export async function createHoliday(
  projectId: string,
  input: {
    scope: "PROJECT" | "COMPANY";
    companyId?: string | null;
    name?: string | null;
    startDate: string;
    endDate: string;
  },
) {
  return request<HolidayModel>(`/api/projects/${projectId}/holidays`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateHoliday(
  holidayId: string,
  input: Partial<{
    scope: "PROJECT" | "COMPANY";
    companyId: string | null;
    name: string | null;
    startDate: string;
    endDate: string;
  }>,
) {
  return request<HolidayModel>(`/api/holidays/${holidayId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteHoliday(holidayId: string) {
  return request<{ success: boolean }>(`/api/holidays/${holidayId}`, {
    method: "DELETE",
  });
}
