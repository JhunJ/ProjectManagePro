"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function safeRedirectPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "/projects";
  const path = raw.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path === "/login" || path === "/") return "/projects";
  return path;
}

interface LoginFormProps {
  redirectFrom: string;
}

export function LoginForm({ redirectFrom }: LoginFormProps) {
  const from = safeRedirectPath(redirectFrom);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "로그인에 실패했습니다.");
        return;
      }
      window.location.href = from;
    } catch {
      setError("로그인 요청 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm space-y-6 rounded-2xl border border-zinc-200 bg-zinc-50/80 p-8 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/80">
      <h1 className="text-center text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        ProjectManagePro
      </h1>
      <p className="text-center text-sm text-zinc-500">
        관리자가 생성한 계정으로 로그인하세요.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="username">아이디</Label>
          <Input
            id="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">비밀번호</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "로그인 중..." : "로그인"}
        </Button>
      </form>
    </div>
  );
}
