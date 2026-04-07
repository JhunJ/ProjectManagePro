"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Loader2, Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectVersionModel, ProjectVersionType } from "@/types/domain";

function formatVersionDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

interface VersionListProps {
  versionList: ProjectVersionModel[];
  activeVersionId: string | null;
  versionSelectType: ProjectVersionType;
  onVersionTypeChange: (type: ProjectVersionType) => void;
  onActivate: (versionId: string) => void;
  activatingVersionId: string | null;
  disabled?: boolean;
}

export function VersionList({
  versionList,
  activeVersionId,
  versionSelectType,
  onVersionTypeChange,
  onActivate,
  activatingVersionId,
  disabled,
}: VersionListProps) {
  const [expanded, setExpanded] = React.useState(true);
  const planVersions = versionList.filter((v) => v.versionType === "PLAN");
  const actualVersions = versionList.filter((v) => v.versionType === "ACTUAL");

  const activeVersion = versionList.find((v) => v.id === activeVersionId);
  const summary =
    activeVersion ? `v${activeVersion.versionNo} · ${activeVersion.title} (${activeVersion.versionType})` : "버전 없음";

  return (
    <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 dark:border-zinc-700 dark:bg-zinc-900/50">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-100/80 dark:text-zinc-200 dark:hover:bg-zinc-800/80"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="flex items-center gap-1.5">
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <span className="text-xs text-zinc-500 dark:text-zinc-400">활성 버전</span>
          <span className="truncate text-zinc-800 dark:text-zinc-100">{summary}</span>
        </span>
        <Badge variant="neutral" className="shrink-0">
          {versionList.length}개
        </Badge>
      </button>
      {expanded ? (
        <div className="border-t border-zinc-200/70 px-2 pb-2 pt-1 dark:border-zinc-700">
          <div className="flex gap-2">
            <Button
              variant={versionSelectType === "PLAN" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => onVersionTypeChange("PLAN")}
            >
              PLAN ({planVersions.length})
            </Button>
            <Button
              variant={versionSelectType === "ACTUAL" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => onVersionTypeChange("ACTUAL")}
            >
              ACTUAL ({actualVersions.length})
            </Button>
          </div>
          <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto">
            {(versionSelectType === "PLAN" ? planVersions : actualVersions).map((version) => {
              const isActive = version.id === activeVersionId;
              return (
                <li
                  key={version.id}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-xs transition",
                    isActive
                      ? "border-sky-300 bg-sky-50/80 dark:border-sky-600 dark:bg-sky-950/40"
                      : "border-zinc-200/70 bg-white/80 dark:border-zinc-700 dark:bg-zinc-950/60",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
                          v{version.versionNo}
                        </span>
                        <span className="truncate font-medium">{version.title}</span>
                        {isActive ? (
                          <Check className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                        작성: {version.createdBy}
                        {version.description ? ` · ${version.description}` : ""}
                      </p>
                      <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                        {formatVersionDate(version.createdAt)} · 작업 {version.taskCount} / 연결 {version.dependencyCount}
                      </p>
                    </div>
                    <Button
                      variant={isActive ? "secondary" : "outline"}
                      size="sm"
                      className="h-7 shrink-0 text-[10px]"
                      disabled={disabled || Boolean(activatingVersionId) || isActive}
                      onClick={() => onActivate(version.id)}
                    >
                      {activatingVersionId === version.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : isActive ? (
                        "활성"
                      ) : (
                        "활성화"
                      )}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {versionSelectType === "PLAN" && planVersions.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-zinc-500 dark:text-zinc-400">PLAN 버전이 없습니다.</p>
          ) : null}
          {versionSelectType === "ACTUAL" && actualVersions.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-zinc-500 dark:text-zinc-400">ACTUAL 버전이 없습니다.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
