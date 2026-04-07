"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  GitCommitHorizontal,
  Loader2,
  LogIn,
  LogOut,
  PencilLine,
  Settings,
} from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { GanttWorkspace } from "@/features/gantt/gantt-workspace";
import { cn } from "@/lib/utils";
import {
  useProjectMutations,
  useProjectScheduleQuery,
  useProjectVersionsQuery,
  useProjectVersionScheduleQuery,
} from "@/features/projects/hooks";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useGanttStore } from "@/stores/gantt-store";
import type { ProjectVersionType } from "@/types/domain";

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const [versionSelectType, setVersionSelectType] = React.useState<ProjectVersionType>("PLAN");
  const [activeVersionId, setActiveVersionId] = React.useState<string | null>(null);
  const [editMode, setEditMode] = React.useState(false);

  const { data, isLoading, isError, refetch } = useProjectScheduleQuery(projectId);
  const { data: versionScheduleData, isLoading: versionScheduleLoading, refetch: refetchVersionSchedule } =
    useProjectVersionScheduleQuery(projectId, activeVersionId);
  const { updateProject, createVersion, activateVersion, syncVersion } = useProjectMutations(projectId);
  const { data: versions } = useProjectVersionsQuery(projectId);
  const { isLoggedIn, isLoading: authLoading } = useAuthSession();

  const saving = useGanttStore((state) => state.saving);
  const lastSavedAt = useGanttStore((state) => state.lastSavedAt);
  const error = useGanttStore((state) => state.error);

  const [editDialogOpen, setEditDialogOpen] = React.useState(false);
  const [versionDialogOpen, setVersionDialogOpen] = React.useState(false);

  const [projectName, setProjectName] = React.useState("");
  const [projectDescription, setProjectDescription] = React.useState("");

  const [versionTitle, setVersionTitle] = React.useState("");
  const [versionDescription, setVersionDescription] = React.useState("");
  const [versionCreatedBy, setVersionCreatedBy] = React.useState("");
  const [versionType, setVersionType] = React.useState<ProjectVersionType>("PLAN");

  /** 펼침 여부만 "1"로 저장. 없으면·그 외는 기본 접힘 */
  const projectTopBarExpandedKey = React.useMemo(() => `pmp:project-topbar-expanded:${projectId}`, [projectId]);
  const [projectTopBarHidden, setProjectTopBarHidden] = React.useState(true);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setProjectTopBarHidden(window.localStorage.getItem(projectTopBarExpandedKey) !== "1");
    } catch {
      // ignore
    }
  }, [projectTopBarExpandedKey]);

  const setProjectTopBarHiddenPersist = React.useCallback(
    (hidden: boolean) => {
      setProjectTopBarHidden(hidden);
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(projectTopBarExpandedKey, hidden ? "0" : "1");
      } catch {
        // ignore
      }
    },
    [projectTopBarExpandedKey],
  );

  const versionList = React.useMemo(() => versions ?? [], [versions]);
  const activeTypeVersions = React.useMemo(
    () => versionList.filter((version) => version.versionType === versionSelectType),
    [versionSelectType, versionList],
  );
  const activeVersionStorageKey = React.useMemo(() => `pmp:active-version:${projectId}`, [projectId]);
  const latestVersion = React.useMemo(() => versionList[0] ?? null, [versionList]);
  const selectedActiveVersion = React.useMemo(
    () => versionList.find((version) => version.id === activeVersionId) ?? null,
    [activeVersionId, versionList],
  );
  const activeVersionSelectValue =
    selectedActiveVersion?.versionType === versionSelectType ? selectedActiveVersion.id : activeVersionId ?? undefined;

  React.useEffect(() => {
    if (!data) return;
    setProjectName(data.project.name);
    setProjectDescription(data.project.description ?? "");
  }, [data]);

  React.useEffect(() => {
    if (versionList.length === 0) {
      if (activeVersionId !== null) {
        setActiveVersionId(null);
      }
      return;
    }

    if (!versionList.some((version) => version.versionType === versionSelectType)) {
      setVersionSelectType(versionList[0].versionType);
    }
  }, [activeVersionId, versionSelectType, versionList]);

  React.useEffect(() => {
    if (versionList.length === 0) {
      return;
    }
    if (activeVersionId !== null) {
      return;
    }

    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(activeVersionStorageKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as { versionId?: string };
          if (parsed.versionId) {
            const storedVersion = versionList.find((version) => version.id === parsed.versionId);
            if (storedVersion) {
              setVersionSelectType(storedVersion.versionType);
              setActiveVersionId(storedVersion.id);
              return;
            }
          }
        } catch {
          window.localStorage.removeItem(activeVersionStorageKey);
        }
      }
    }
    setVersionSelectType(versionList[0].versionType);
    setActiveVersionId(versionList[0].id);
  }, [activeVersionId, activeVersionStorageKey, versionList]);

  const isViewingVersion = Boolean(activeVersionId) && !editMode;
  const scheduleForGantt =
    activeVersionId && !editMode && versionScheduleData
      ? versionScheduleData
      : data;
  const isLoadingGantt =
    activeVersionId && !editMode
      ? isLoading || versionScheduleLoading
      : isLoading;

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!selectedActiveVersion) {
      window.localStorage.removeItem(activeVersionStorageKey);
      return;
    }

    window.localStorage.setItem(
      activeVersionStorageKey,
      JSON.stringify({
        versionId: selectedActiveVersion.id,
        versionType: selectedActiveVersion.versionType,
      }),
    );
  }, [activeVersionStorageKey, selectedActiveVersion]);

  const refetchWithVersionSync = React.useCallback(async () => {
    if (activeVersionId) {
      try {
        await syncVersion.mutateAsync(activeVersionId);
      } catch (syncError) {
        toast.error(syncError instanceof Error ? syncError.message : "활성 버전 동기화에 실패했습니다.");
      }
    }
    await refetch();
    if (activeVersionId) {
      await refetchVersionSchedule();
    }
  }, [activeVersionId, refetch, refetchVersionSchedule, syncVersion]);

  const handleSaveProjectInfo = React.useCallback(async () => {
    const nextName = projectName.trim();
    if (!nextName) {
      toast.error("프로젝트 이름을 입력해 주세요.");
      return;
    }

    try {
      await updateProject.mutateAsync({
        id: projectId,
        payload: {
          name: nextName,
          description: projectDescription.trim() ? projectDescription.trim() : null,
        },
      });
      await refetchWithVersionSync();
      setEditDialogOpen(false);
      toast.success("프로젝트 정보가 저장되었습니다.");
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "프로젝트 저장에 실패했습니다.");
    }
  }, [projectDescription, projectId, projectName, refetchWithVersionSync, updateProject]);

  const handleCreateVersion = React.useCallback(async () => {
    const title = versionTitle.trim();
    const createdBy = versionCreatedBy.trim();

    if (!title) {
      toast.error("버전 제목을 입력해 주세요.");
      return;
    }
    if (!createdBy) {
      toast.error("작성자를 입력해 주세요.");
      return;
    }

    try {
      await createVersion.mutateAsync({
        title,
        description: versionDescription.trim() ? versionDescription.trim() : null,
        createdBy,
        versionType,
      });
      setVersionDialogOpen(false);
      setVersionTitle("");
      setVersionDescription("");
      setVersionCreatedBy("");
      setVersionType("PLAN");
      toast.success("버전이 생성되었습니다.");
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : "버전 생성에 실패했습니다.");
    }
  }, [createVersion, versionCreatedBy, versionDescription, versionTitle, versionType]);

  const handleSelectVersion = React.useCallback(
    (value: string) => {
      if (value === activeVersionId) return;
      const nextVersion = versionList.find((v) => v.id === value);
      if (!nextVersion) return;
      setVersionSelectType(nextVersion.versionType);
      setActiveVersionId(value);
      setEditMode(false);
    },
    [activeVersionId, versionList],
  );

  const handleToggleEditMode = React.useCallback(
    async (toEdit: boolean) => {
      if (!activeVersionId) return;
      if (toEdit) {
        try {
          await activateVersion.mutateAsync(activeVersionId);
          setEditMode(true);
          await refetch();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "버전을 편집 대상으로 적용하지 못했습니다.");
        }
      } else {
        setEditMode(false);
      }
    },
    [activeVersionId, activateVersion, refetch],
  );

  if (isLoadingGantt) {
    return (
      <div className="p-6">
        <Skeleton className="mb-4 h-12 w-full rounded-2xl" />
        <Skeleton className="h-[70vh] w-full rounded-2xl" />
      </div>
    );
  }

  if (isError || !scheduleForGantt) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-lg font-semibold">프로젝트를 불러오지 못했습니다.</p>
        <Button onClick={() => void refetch()}>다시 시도</Button>
        <Link href="/projects">
          <Button variant="ghost">목록으로 이동</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen min-w-0 flex-col p-2 sm:p-4 lg:p-6">
      {projectTopBarHidden ? (
        <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
          {activeVersionId ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200/80 bg-zinc-50/90 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900/90">
              <span className="shrink-0 text-xs font-medium text-zinc-600 dark:text-zinc-300">모드</span>
              <button
                type="button"
                onClick={() => editMode && setEditMode(false)}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  !editMode
                    ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-600 dark:text-zinc-100"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
                )}
              >
                읽기
              </button>
              <button
                type="button"
                onClick={() => !editMode && void handleToggleEditMode(true)}
                disabled={activateVersion.isPending}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                  editMode
                    ? "bg-sky-600 text-white dark:bg-sky-500"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
                )}
              >
                {activateVersion.isPending ? "적용 중…" : "편집"}
              </button>
            </div>
          ) : (
            <span className="min-w-0 flex-1" aria-hidden />
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0 gap-1.5 rounded-full border-zinc-200/90 bg-white/95 px-3.5 text-zinc-700 shadow-sm backdrop-blur-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900/95 dark:text-zinc-200 dark:hover:bg-zinc-800/90"
            title="프로젝트·버전 설정 펼치기"
            aria-label="프로젝트·버전 설정 펼치기"
            onClick={() => setProjectTopBarHiddenPersist(false)}
          >
            <ChevronDown className="size-4 shrink-0 opacity-70" aria-hidden />
            <span className="text-xs font-medium tracking-tight">버전 설정</span>
          </Button>
        </div>
      ) : (
      <header className="glass-panel mb-4 flex min-w-0 max-w-full flex-col gap-3 overflow-x-hidden rounded-2xl px-4 py-3">
        <div className="flex min-w-0 max-w-full items-center gap-2 border-b border-zinc-200/70 pb-3 dark:border-zinc-700/80 sm:gap-3">
          <Link href="/projects" className="shrink-0">
            <Button variant="ghost" size="icon" aria-label="목록으로">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold sm:text-xl">{scheduleForGantt.project.name}</h1>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5 border-zinc-300 bg-white px-2.5 py-2 text-xs font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 sm:px-3"
            title="프로젝트·버전 상단 영역 접기"
            aria-label="프로젝트·버전 상단 영역 접기"
            onClick={() => setProjectTopBarHiddenPersist(true)}
          >
            <ChevronUp className="size-4 shrink-0 opacity-90" aria-hidden />
            <span className="hidden sm:inline">상단 접기</span>
            <span className="sm:hidden">접기</span>
          </Button>
        </div>
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">

          {/* 버전 불러오기: 현재 스케줄(편집) 또는 저장된 버전(읽기 전용) */}
          <div
            className={cn(
              "flex min-w-0 w-full max-w-full flex-col gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900/50",
              "sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-2 sm:px-2 sm:py-2 lg:w-auto lg:max-w-full",
            )}
          >
            <div className="flex min-w-0 w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
              <span className="shrink-0 text-xs font-medium text-zinc-600 dark:text-zinc-300">구분</span>
              <Select
                value={versionSelectType}
                onValueChange={(value) => setVersionSelectType(value as ProjectVersionType)}
                disabled={versionList.length === 0}
              >
                <SelectTrigger className="h-9 min-w-0 w-full border-zinc-200 bg-white/80 text-zinc-900 shadow-none dark:border-zinc-700 dark:bg-zinc-950 sm:h-8 sm:w-[130px] sm:shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PLAN">초기계획</SelectItem>
                  <SelectItem value="ACTUAL">실적</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-0 w-full flex-col gap-1.5 sm:w-auto sm:min-w-0 sm:max-w-full sm:flex-1 sm:flex-row sm:items-center sm:gap-2">
              <span className="shrink-0 text-xs font-medium text-zinc-600 dark:text-zinc-300">불러올 버전</span>
              <Select
                value={activeVersionSelectValue}
                onValueChange={handleSelectVersion}
                disabled={activeTypeVersions.length === 0}
              >
                <SelectTrigger className="h-9 min-w-0 w-full border-zinc-200 bg-white/80 text-zinc-900 shadow-none dark:border-zinc-700 dark:bg-zinc-950 sm:h-8 sm:w-[200px] sm:max-w-[min(100%,240px)] [&>span]:truncate">
                  <SelectValue
                    placeholder={
                      activeTypeVersions[0]
                        ? `v${activeTypeVersions[0].versionNo} · ${activeTypeVersions[0].title}`
                        : "버전 선택"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {activeTypeVersions.map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      {`v${version.versionNo} · ${version.title}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {activeVersionId ? (
              <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 bg-white/80 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950 sm:w-auto sm:flex-nowrap sm:px-1.5 sm:py-1">
                <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">모드</span>
                <button
                  type="button"
                  onClick={() => editMode && setEditMode(false)}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    !editMode
                      ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-600 dark:text-zinc-100"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  읽기
                </button>
                <button
                  type="button"
                  onClick={() => !editMode && void handleToggleEditMode(true)}
                  disabled={activateVersion.isPending}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                    editMode
                      ? "bg-sky-600 text-white dark:bg-sky-500"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {activateVersion.isPending ? "적용 중…" : "편집"}
                </button>
              </div>
            ) : null}
          </div>

          {/* 주요 액션: 프로젝트 수정, 버전 생성 */}
          <div className="flex min-w-0 w-full flex-wrap items-center gap-2 lg:w-auto">
          <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <PencilLine className="size-4" /> 프로젝트 수정
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>프로젝트 수정</DialogTitle>
                <DialogDescription>프로젝트 이름과 설명을 수정합니다.</DialogDescription>
              </DialogHeader>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSaveProjectInfo();
                }}
              >
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="project-name">
                    프로젝트 이름
                  </label>
                  <Input
                    id="project-name"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder="예: 건축 마감 공정"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="project-description">
                    설명
                  </label>
                  <Textarea
                    id="project-description"
                    value={projectDescription}
                    onChange={(event) => setProjectDescription(event.target.value)}
                    placeholder="프로젝트 설명"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={updateProject.isPending}>
                  {updateProject.isPending ? "저장 중..." : "저장"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={versionDialogOpen} onOpenChange={setVersionDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <GitCommitHorizontal className="size-4" /> 버전 생성
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>버전 생성</DialogTitle>
                <DialogDescription>PLAN/ACTUAL 타입으로 스냅샷 버전을 생성합니다.</DialogDescription>
              </DialogHeader>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleCreateVersion();
                }}
              >
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="version-title">
                    제목
                  </label>
                  <Input
                    id="version-title"
                    value={versionTitle}
                    onChange={(event) => setVersionTitle(event.target.value)}
                    placeholder="버전 제목"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="version-created-by">
                    작성자
                  </label>
                  <Input
                    id="version-created-by"
                    value={versionCreatedBy}
                    onChange={(event) => setVersionCreatedBy(event.target.value)}
                    placeholder="작성자명"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="version-description">
                    변경 사유/내용
                  </label>
                  <Textarea
                    id="version-description"
                    value={versionDescription}
                    onChange={(event) => setVersionDescription(event.target.value)}
                    placeholder="무엇이 변경되었는지 입력"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">버전 타입</label>
                  <Select value={versionType} onValueChange={(value) => setVersionType(value as ProjectVersionType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PLAN">초기계획</SelectItem>
                      <SelectItem value="ACTUAL">실적</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full" disabled={createVersion.isPending}>
                  {createVersion.isPending ? "생성 중..." : "버전 생성"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
          </div>

          {/* 5. 상태 + 6. 보조 */}
          <div className="flex min-w-0 w-full flex-shrink-0 flex-wrap items-center gap-2 lg:ml-auto lg:w-auto">
            <Badge variant={saving ? "warning" : error ? "danger" : "success"}>
              {saving ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" /> 저장 중...
                </span>
              ) : error ? (
                "저장 오류"
              ) : (
                `저장됨${lastSavedAt ? ` · ${new Date(lastSavedAt).toLocaleTimeString("ko-KR")}` : ""}`
              )}
            </Badge>
            {authLoading ? (
              <div className="size-9 rounded-lg bg-zinc-200/60 dark:bg-zinc-700/60" aria-hidden="true" />
            ) : isLoggedIn ? (
              <>
                <Link href="/settings/users" className={buttonVariants({ variant: "ghost", size: "icon" })} title="설정 (관리자)">
                  <Settings className="size-4" />
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  title="로그아웃"
                  onClick={async () => {
                    await fetch("/api/auth/logout", { method: "POST" });
                    window.location.href = "/login";
                  }}
                >
                  <LogOut className="size-4" />
                </Button>
              </>
            ) : (
              <Link href="/login" className={buttonVariants({ variant: "ghost", size: "icon" })} title="로그인 페이지">
                <LogIn className="size-4" />
              </Link>
            )}
            <ThemeToggle />
          </div>
        </div>

        {/* 4. 설명 */}
        <p className="text-sm text-muted">{scheduleForGantt.project.description || "설명 없음"}</p>
      </header>
      )}

      <GanttWorkspace
        projectId={projectId}
        initialSchedule={scheduleForGantt}
        onRefetch={editMode ? refetchWithVersionSync : () => refetchVersionSchedule()}
        readOnlyMode={Boolean(activeVersionId) && !editMode}
      />
    </div>
  );
}
