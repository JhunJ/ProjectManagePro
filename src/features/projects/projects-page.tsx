"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { CalendarClock, FolderKanban, LogIn, LogOut, Plus, Settings, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useProjectsQuery, useProjectMutations } from "@/features/projects/hooks";
import { formatDateKorean } from "@/lib/utils";

export function ProjectsPage() {
  const { data, isLoading } = useProjectsQuery();
  const { createProject, deleteProject, setProjectFavorite } = useProjectMutations();
  const { isLoggedIn, isLoading: authLoading } = useAuthSession();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const create = async (formData: FormData) => {
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const startDate = String(formData.get("startDate") ?? "");

    if (!name || !startDate) {
      toast.error("프로젝트명과 시작일을 입력해주세요.");
      return;
    }

    try {
      await createProject.mutateAsync({
        name,
        description: description || null,
        startDate: new Date(startDate).toISOString(),
      });
      toast.success("프로젝트를 생성했습니다.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "프로젝트 생성에 실패했습니다.");
    }
  };

  const removeProject = async (projectId: string) => {
    if (!window.confirm("프로젝트를 삭제할까요? 모든 작업 데이터가 함께 삭제됩니다.")) {
      return;
    }

    try {
      await deleteProject.mutateAsync(projectId);
      toast.success("프로젝트를 삭제했습니다.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제 중 오류가 발생했습니다.");
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-8 sm:px-6 lg:px-8">
      <header className="glass-panel sticky top-4 z-20 mb-6 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
        <div className="min-w-0 shrink-0">
          <p className="text-xs uppercase tracking-[0.18em] text-muted">ProjectManagePro</p>
          <h1 className="text-xl font-semibold">공정/프로젝트 관리</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {mounted ? (
            <>
              <ThemeToggle />
              {authLoading ? (
                <div className="flex items-center gap-2" aria-hidden="true">
                  <div className="size-9 rounded-xl bg-zinc-200/60 dark:bg-zinc-700/60" />
                </div>
              ) : isLoggedIn ? (
                <>
                  <Link href="/settings/users" className={buttonVariants({ variant: "ghost", size: "sm" })} title="설정 (관리자)">
                    <Settings className="size-4" />
                    <span className="hidden sm:inline">설정</span>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    title="로그아웃"
                    onClick={async () => {
                      await fetch("/api/auth/logout", { method: "POST" });
                      window.location.href = "/login";
                    }}
                  >
                    <LogOut className="size-4" />
                    <span className="hidden sm:inline">로그아웃</span>
                  </Button>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="size-4" /> 프로젝트 생성
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>새 프로젝트</DialogTitle>
                        <DialogDescription>기준 시작일과 함께 공정표를 시작합니다.</DialogDescription>
                      </DialogHeader>
                      <form
                        className="space-y-4"
                        action={async (formData) => {
                          await create(formData);
                        }}
                      >
                        <div className="space-y-1.5">
                          <Label htmlFor="name">프로젝트명</Label>
                          <Input id="name" name="name" placeholder="예: 건축 마감 공정" required />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="startDate">시작일</Label>
                          <Input id="startDate" name="startDate" type="date" required />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="description">설명</Label>
                          <Textarea id="description" name="description" placeholder="프로젝트 설명" />
                        </div>
                        <Button type="submit" className="w-full" disabled={createProject.isPending}>
                          {createProject.isPending ? "생성 중..." : "생성"}
                        </Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                </>
              ) : (
                <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })} title="로그인 페이지">
                  <LogIn className="size-4" />
                  <span className="hidden sm:inline">로그인</span>
                </Link>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2" aria-hidden="true">
              <div className="size-9 rounded-xl" />
              <div className="h-9 w-[132px] rounded-xl" />
            </div>
          )}
        </div>
      </header>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((project, index) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.05 }}
            >
              <Card className="h-full border-zinc-200/60">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h2 className="line-clamp-1 text-lg font-semibold">{project.name}</h2>
                      <p className="line-clamp-2 text-sm text-muted">
                        {project.description || "설명이 없습니다."}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-amber-500 dark:hover:bg-zinc-800 dark:hover:text-amber-400"
                        onClick={() =>
                          void setProjectFavorite.mutateAsync({
                            projectId: project.id,
                            favorite: !project.isFavorite,
                          })
                        }
                        disabled={setProjectFavorite.isPending}
                        title={project.isFavorite ? "즐겨찾기 해제" : "즐겨찾기"}
                      >
                        <Star
                          className={project.isFavorite ? "size-[18px] fill-amber-500 text-amber-500 dark:fill-amber-400 dark:text-amber-400" : "size-[18px]"}
                        />
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
                        onClick={() => void removeProject(project.id)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-xs text-muted">
                    <div className="rounded-xl border border-zinc-200/60 p-2 dark:border-zinc-700">
                      <p className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide">
                        <CalendarClock className="size-3" /> 시작일
                      </p>
                      <p className="font-mono text-sm text-zinc-800 dark:text-zinc-200">
                        {formatDateKorean(project.startDate)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-zinc-200/60 p-2 dark:border-zinc-700">
                      <p className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide">
                        <FolderKanban className="size-3" /> 수정
                      </p>
                      <p className="font-mono text-sm text-zinc-800 dark:text-zinc-200">
                        {formatDateKorean(project.updatedAt, "MM.dd HH:mm")}
                      </p>
                    </div>
                  </div>
                  <Link href={`/projects/${project.id}`}>
                    <Button className="w-full">공정표 열기</Button>
                  </Link>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      ) : (
        <Card className="mx-auto mt-12 max-w-xl border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="rounded-2xl bg-[var(--accent-soft)] p-4 text-[var(--accent)]">
              <FolderKanban className="size-7" />
            </div>
            <div>
              <h2 className="mb-1 text-lg font-semibold">아직 프로젝트가 없습니다</h2>
              <p className="text-sm text-muted">첫 프로젝트를 만들면 간트 기반 공정 운영을 바로 시작할 수 있습니다.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
