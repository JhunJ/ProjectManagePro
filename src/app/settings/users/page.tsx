"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FolderKanban, LogOut, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuthSession } from "@/hooks/use-auth-session";

type User = { id: string; username: string; role: string; createdAt: string; projectIds: string[] };
type Project = { id: string; name: string };

export default function SettingsUsersPage() {
  const router = useRouter();
  const { user, isLoggedIn, isLoading: authLoading } = useAuthSession();
  const [users, setUsers] = React.useState<User[]>([]);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [usersLoading, setUsersLoading] = React.useState(true);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [assignUser, setAssignUser] = React.useState<User | null>(null);
  const [assignSelectedIds, setAssignSelectedIds] = React.useState<Set<string>>(new Set());
  const [assignSaving, setAssignSaving] = React.useState(false);

  const loadUsers = React.useCallback(async () => {
    try {
      const usersRes = await fetch("/api/users");
      if (usersRes.ok) {
        const list = await usersRes.json();
        setUsers(list);
      }
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadProjects = React.useCallback(async () => {
    const res = await fetch("/api/projects");
    if (res.ok) {
      const list = await res.json();
      setProjects(list);
    }
  }, []);

  React.useEffect(() => {
    if (!authLoading && !isLoggedIn) {
      router.push("/login?from=/settings/users");
      return;
    }
    if (user?.role === "ADMIN") {
      loadUsers();
      loadProjects();
    } else {
      setUsersLoading(false);
    }
  }, [authLoading, isLoggedIn, user?.role, router, loadUsers, loadProjects]);

  const openAssignDialog = (u: User) => {
    setAssignUser(u);
    setAssignSelectedIds(new Set(u.projectIds ?? []));
  };

  const closeAssignDialog = () => {
    setAssignUser(null);
  };

  const toggleProject = (projectId: string) => {
    setAssignSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const saveAssign = async () => {
    if (!assignUser) return;
    setAssignSaving(true);
    try {
      const res = await fetch(`/api/users/${assignUser.id}/projects`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectIds: Array.from(assignSelectedIds) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error ?? "저장에 실패했습니다.");
        return;
      }
      toast.success("프로젝트 할당을 저장했습니다.");
      loadUsers();
      closeAssignDialog();
    } finally {
      setAssignSaving(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.error("아이디와 비밀번호를 입력하세요.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "추가에 실패했습니다.");
        return;
      }
      toast.success("사용자를 추가했습니다.");
      setUsername("");
      setPassword("");
      loadUsers();
    } finally {
      setSubmitting(false);
    }
  };

  const loading = authLoading || (user?.role === "ADMIN" && usersLoading);

  if (loading) {
    return (
      <div className="mx-auto flex min-h-screen max-w-2xl items-center justify-center p-4">
        <p className="text-muted-foreground">로딩 중...</p>
      </div>
    );
  }

  if (!isLoggedIn || !user) return null;

  if (user.role !== "ADMIN") {
    return (
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-4">
        <p className="text-center text-zinc-600 dark:text-zinc-400">
          관리자만 접근할 수 있습니다.
        </p>
        <div className="flex justify-center">
          <Link href="/projects" className={buttonVariants({ variant: "outline" })}>
            프로젝트로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/projects" className={buttonVariants({ variant: "ghost", size: "icon" })}>
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-xl font-semibold">사용자 관리</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500">{user.username}</span>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="size-4" /> 로그아웃
          </Button>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-4" /> 사용자 추가
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddUser} className="flex flex-wrap items-end gap-4">
            <div className="min-w-[140px] space-y-2">
              <Label htmlFor="new-username">아이디</Label>
              <Input
                id="new-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="아이디"
                disabled={submitting}
              />
            </div>
            <div className="min-w-[140px] space-y-2">
              <Label htmlFor="new-password">비밀번호</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호"
                disabled={submitting}
              />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? "추가 중..." : "추가"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">등록된 사용자</CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-zinc-500">등록된 사용자가 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {users.map((u) => (
                <li
                  key={u.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium">{u.username}</span>
                    <span className="text-xs text-zinc-500">{u.role}</span>
                    {u.role === "USER" && (
                      <span className="text-xs text-zinc-400">
                        프로젝트 {u.projectIds?.length ?? 0}개
                      </span>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openAssignDialog(u)}
                  >
                    <FolderKanban className="size-3.5" /> 프로젝트 할당
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!assignUser} onOpenChange={(open) => !open && closeAssignDialog()}>
        <DialogContent className="max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              프로젝트 할당 {assignUser ? `– ${assignUser.username}` : ""}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-500">
            이 사용자가 접근할 수 있는 프로젝트를 선택하세요. (관리자는 전체 접근)
          </p>
          <div className="flex-1 overflow-y-auto space-y-2 py-2">
            {projects.length === 0 ? (
              <p className="text-sm text-zinc-500">등록된 프로젝트가 없습니다.</p>
            ) : (
              projects.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 cursor-pointer rounded-lg border border-zinc-200 px-3 py-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  <input
                    type="checkbox"
                    checked={assignSelectedIds.has(p.id)}
                    onChange={() => toggleProject(p.id)}
                    className="rounded border-zinc-300"
                  />
                  <span className="text-sm font-medium">{p.name}</span>
                </label>
              ))
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
            <Button type="button" variant="ghost" onClick={closeAssignDialog}>
              취소
            </Button>
            <Button type="button" onClick={saveAssign} disabled={assignSaving}>
              {assignSaving ? "저장 중..." : "저장"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
