"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  activateProjectVersion,
  compareProjectVersion,
  createCompany,
  createHoliday,
  createProjectVersion,
  createDependency,
  createProject,
  createTask,
  deleteCompany,
  deleteHoliday,
  deleteDependency,
  deleteProject,
  deleteTask,
  getCompanies,
  getHolidays,
  getProjectSchedule,
  getProjectVersion,
  getProjectVersionSchedule,
  getProjectVersions,
  getProjects,
  reorderTasks,
  setProjectFavorite,
  syncProjectVersion,
  updateCompany,
  updateCalendar,
  updateHoliday,
  updateDependency,
  updateProjectVersion,
  updateProject,
  updateTask,
} from "@/lib/api-client";
import { queryKeys } from "@/features/projects/query-keys";

export function useProjectsQuery() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: getProjects,
  });
}

export function useProjectScheduleQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectSchedule(projectId),
    queryFn: () => getProjectSchedule(projectId),
    enabled: Boolean(projectId),
  });
}

export function useProjectVersionsQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectVersions(projectId),
    queryFn: () => getProjectVersions(projectId),
    enabled: Boolean(projectId),
  });
}

export function useProjectVersionDetailQuery(projectId: string, versionId: string | null) {
  return useQuery({
    queryKey: queryKeys.projectVersionDetail(projectId, versionId ?? "none"),
    queryFn: () => getProjectVersion(projectId, versionId!),
    enabled: Boolean(projectId && versionId),
    placeholderData: (previousData) => previousData,
  });
}

export function useProjectVersionScheduleQuery(projectId: string, versionId: string | null) {
  return useQuery({
    queryKey: queryKeys.projectVersionSchedule(projectId, versionId ?? "none"),
    queryFn: () => getProjectVersionSchedule(projectId, versionId!),
    enabled: Boolean(projectId && versionId),
  });
}

export function useProjectVersionCompareQuery(
  projectId: string,
  planVersionId: string | null,
  actualVersionId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.projectVersionCompare(projectId, planVersionId ?? "none", actualVersionId ?? "none"),
    queryFn: () => compareProjectVersion(projectId, planVersionId!, actualVersionId!),
    enabled: Boolean(projectId && planVersionId && actualVersionId && enabled),
  });
}

export function useCompaniesQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.companies(projectId),
    queryFn: () => getCompanies(projectId),
    enabled: Boolean(projectId),
  });
}

export function useHolidaysQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.holidays(projectId),
    queryFn: () => getHolidays(projectId),
    enabled: Boolean(projectId),
  });
}

export function useProjectMutations(projectId?: string) {
  const queryClient = useQueryClient();

  const invalidateSchedule = async () => {
    if (!projectId) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.projectSchedule(projectId) });
    await queryClient.invalidateQueries({ queryKey: ["project-version-compare", projectId] });
    await queryClient.invalidateQueries({ queryKey: queryKeys.companies(projectId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.holidays(projectId) });
  };

  return {
    createProject: useMutation({
      mutationFn: createProject,
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      },
    }),
    setProjectFavorite: useMutation({
      mutationFn: ({ projectId, favorite }: { projectId: string; favorite: boolean }) =>
        setProjectFavorite(projectId, favorite),
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      },
    }),
    updateProject: useMutation({
      mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateProject>[1] }) =>
        updateProject(id, payload),
      onSuccess: async (_, variables) => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
        await queryClient.invalidateQueries({ queryKey: queryKeys.projectSchedule(variables.id) });
      },
    }),
    deleteProject: useMutation({
      mutationFn: deleteProject,
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      },
    }),
    createVersion: useMutation({
      mutationFn: (payload: Parameters<typeof createProjectVersion>[1]) =>
        createProjectVersion(projectId!, payload),
      onSuccess: async () => {
        if (!projectId) return;
        await queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) });
      },
    }),
    updateVersion: useMutation({
      mutationFn: ({ versionId, payload }: { versionId: string; payload: Parameters<typeof updateProjectVersion>[2] }) =>
        updateProjectVersion(projectId!, versionId, payload),
      onSuccess: async () => {
        if (!projectId) return;
        await queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) });
        await queryClient.invalidateQueries({ queryKey: ["project-version-compare", projectId] });
      },
    }),
    activateVersion: useMutation({
      mutationFn: (versionId: string) => activateProjectVersion(projectId!, versionId),
      onSuccess: invalidateSchedule,
    }),
    syncVersion: useMutation({
      mutationFn: (versionId: string) => syncProjectVersion(projectId!, versionId),
      onSuccess: async (_, versionId) => {
        if (!projectId) return;
        await queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.projectVersionDetail(projectId, versionId) });
        await queryClient.invalidateQueries({ queryKey: ["project-version-compare", projectId] });
      },
    }),
    createTask: useMutation({
      mutationFn: (payload: Parameters<typeof createTask>[1]) => createTask(projectId!, payload),
      onSuccess: invalidateSchedule,
    }),
    updateTask: useMutation({
      mutationFn: ({ taskId, payload }: { taskId: string; payload: Parameters<typeof updateTask>[1] }) =>
        updateTask(taskId, payload),
      onSuccess: invalidateSchedule,
    }),
    deleteTask: useMutation({
      mutationFn: deleteTask,
      onSuccess: invalidateSchedule,
    }),
    reorderTasks: useMutation({
      mutationFn: (items: Parameters<typeof reorderTasks>[1]) => reorderTasks(projectId!, items),
      onSuccess: invalidateSchedule,
    }),
    createDependency: useMutation({
      mutationFn: (payload: Parameters<typeof createDependency>[1]) => createDependency(projectId!, payload),
      onSuccess: invalidateSchedule,
    }),
    updateDependency: useMutation({
      mutationFn: ({ dependencyId, payload }: { dependencyId: string; payload: Parameters<typeof updateDependency>[1] }) =>
        updateDependency(dependencyId, payload),
      onSuccess: invalidateSchedule,
    }),
    deleteDependency: useMutation({
      mutationFn: deleteDependency,
      onSuccess: invalidateSchedule,
    }),
    updateCalendar: useMutation({
      mutationFn: (payload: Parameters<typeof updateCalendar>[1]) => updateCalendar(projectId!, payload),
      onSuccess: invalidateSchedule,
    }),
    createCompany: useMutation({
      mutationFn: (payload: Parameters<typeof createCompany>[1]) => createCompany(projectId!, payload),
      onSuccess: invalidateSchedule,
    }),
    updateCompany: useMutation({
      mutationFn: ({ companyId, payload }: { companyId: string; payload: Parameters<typeof updateCompany>[1] }) =>
        updateCompany(companyId, payload),
      onSuccess: invalidateSchedule,
    }),
    deleteCompany: useMutation({
      mutationFn: deleteCompany,
      onSuccess: invalidateSchedule,
    }),
    createHoliday: useMutation({
      mutationFn: (payload: Parameters<typeof createHoliday>[1]) => createHoliday(projectId!, payload),
      onSuccess: invalidateSchedule,
    }),
    updateHoliday: useMutation({
      mutationFn: ({ holidayId, payload }: { holidayId: string; payload: Parameters<typeof updateHoliday>[1] }) =>
        updateHoliday(holidayId, payload),
      onSuccess: invalidateSchedule,
    }),
    deleteHoliday: useMutation({
      mutationFn: deleteHoliday,
      onSuccess: invalidateSchedule,
    }),
  };
}
