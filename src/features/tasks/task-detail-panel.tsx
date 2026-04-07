"use client";

import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SuggestionInput } from "@/components/ui/suggestion-input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { inferDependencyFromTaskDates } from "@/lib/infer-dependency";
import { isSiteDisplayTextManual, resolveSiteDisplayText } from "@/lib/site-display-text";
import type {
  CompanyModel,
  DependencyModel,
  HolidayModel,
  HolidayScope,
  TaskModel,
  WorkingCalendarModel,
} from "@/types/domain";

interface Props {
  task: TaskModel | null;
  /** true면 상세만 표시하고 편집·삭제·구속 추가/수정/삭제 비활성화 */
  readOnly?: boolean;
  tasks: TaskModel[];
  dependencies: DependencyModel[];
  calendar: WorkingCalendarModel;
  companies: CompanyModel[];
  holidays: HolidayModel[];
  onTaskSave: (taskId: string, patch: Partial<TaskModel>) => Promise<void>;
  onTaskDelete: (taskId: string) => Promise<void>;
  onCreateDependency: (payload: {
    predecessorTaskId: string;
    successorTaskId: string;
    type: "FS" | "SS" | "FF" | "SF";
    lagDays: number;
    drivesSchedule?: boolean;
  }) => Promise<void>;
  onDeleteDependency: (dependencyId: string) => Promise<void>;
  onUpdateDependency: (dependencyId: string, payload: { type: "FS" | "SS" | "FF" | "SF"; lagDays: number; drivesSchedule?: boolean }) => Promise<void>;
  onUpdateCalendar: (patch: Partial<WorkingCalendarModel>) => Promise<void>;
  onCreateCompany: (payload: { name: string }) => Promise<CompanyModel>;
  onDeleteCompany: (companyId: string) => Promise<void>;
  onCreateHoliday: (payload: {
    scope: HolidayScope;
    companyId?: string | null;
    name?: string | null;
    startDate: string;
    endDate: string;
  }) => Promise<void>;
  onUpdateHoliday: (
    holidayId: string,
    payload: {
      scope: HolidayScope;
      companyId?: string | null;
      name?: string | null;
      startDate: string;
      endDate: string;
    },
  ) => Promise<void>;
  onDeleteHoliday: (holidayId: string) => Promise<void>;
}

function toDateInputValue(date: string) {
  return new Date(date).toISOString().slice(0, 10);
}

function toIsoDay(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function addDaysToDateString(dateStr: string, days: number) {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getDurationDays(startStr: string, endStr: string) {
  const start = new Date(`${startStr.slice(0, 10)}T00:00:00.000Z`).getTime();
  const end = new Date(`${endStr.slice(0, 10)}T00:00:00.000Z`).getTime();
  return Math.max(1, Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1);
}

function normalizeNullableField(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))]
    .map((value) => value.trim())
    .sort((a, b) => a.localeCompare(b, "ko-KR"));
}

function normalizeLookupText(value: string) {
  return value.trim().toLocaleLowerCase("ko-KR");
}

const CALENDAR_DAY_OPTIONS = [
  ["workMon", "월"],
  ["workTue", "화"],
  ["workWed", "수"],
  ["workThu", "목"],
  ["workFri", "금"],
  ["workSat", "토"],
  ["workSun", "일"],
] as const;

function formatOffsetLabel(days: number) {
  if (days === 0) return "Lag 0";
  if (days < 0) return `Lead ${Math.abs(days)}`;
  return `Lag ${days}`;
}

export function TaskDetailPanel({
  task,
  readOnly = false,
  tasks,
  dependencies,
  calendar,
  companies,
  holidays,
  onTaskSave,
  onTaskDelete,
  onCreateDependency,
  onDeleteDependency,
  onUpdateDependency,
  onUpdateCalendar,
  onCreateCompany,
  onDeleteCompany,
  onCreateHoliday,
  onUpdateHoliday,
  onDeleteHoliday,
}: Props) {
  const [draft, setDraft] = React.useState<Partial<TaskModel>>({});
  const [siteDisplayTextManual, setSiteDisplayTextManual] = React.useState(false);
  const [companyNameDraft, setCompanyNameDraft] = React.useState("");
  const [newCompanyName, setNewCompanyName] = React.useState("");
  const [holidayDraft, setHolidayDraft] = React.useState<{
    scope: HolidayScope;
    companyId: string;
    name: string;
    startDate: string;
    endDate: string;
  }>({
    scope: "PROJECT",
    companyId: "",
    name: "",
    startDate: "",
    endDate: "",
  });
  const [depDraft, setDepDraft] = React.useState<{
    predecessorTaskId: string;
    type: "FS" | "SS" | "FF" | "SF";
    mode: "lag" | "lead";
    offsetDays: number;
    drivesSchedule: boolean;
  }>({
    predecessorTaskId: "",
    type: "FS",
    mode: "lag",
    offsetDays: 0,
    drivesSchedule: false,
  });
  const [editingDependency, setEditingDependency] = React.useState<DependencyModel | null>(null);
  const [editDepDraft, setEditDepDraft] = React.useState<{
    type: "FS" | "SS" | "FF" | "SF";
    mode: "lag" | "lead";
    offsetDays: number;
    drivesSchedule: boolean;
  }>({ type: "FS", mode: "lag", offsetDays: 0, drivesSchedule: false });

  React.useEffect(() => {
    if (editingDependency) {
      setEditDepDraft({
        type: editingDependency.type,
        mode: editingDependency.lagDays >= 0 ? "lag" : "lead",
        offsetDays: Math.abs(editingDependency.lagDays),
        drivesSchedule: editingDependency.drivesSchedule !== false,
      });
    }
  }, [editingDependency]);

  const [editingHoliday, setEditingHoliday] = React.useState<HolidayModel | null>(null);
  const [editHolidayDraft, setEditHolidayDraft] = React.useState<{
    scope: HolidayScope;
    companyId: string;
    name: string;
    startDate: string;
    endDate: string;
  }>({ scope: "PROJECT", companyId: "", name: "", startDate: "", endDate: "" });

  React.useEffect(() => {
    if (editingHoliday) {
      setEditHolidayDraft({
        scope: editingHoliday.scope,
        companyId: editingHoliday.companyId ?? "",
        name: editingHoliday.name ?? "",
        startDate: toDateInputValue(editingHoliday.startDate),
        endDate: toDateInputValue(editingHoliday.endDate),
      });
    }
  }, [editingHoliday]);

  React.useEffect(() => {
    if (!task) {
      setDraft({});
      setSiteDisplayTextManual(false);
      return;
    }

    setDraft({
      name: task.activityName || task.name,
      activityName: task.activityName || task.name,
      categoryMajor: task.categoryMajor,
      categoryMiddle1: task.categoryMiddle1,
      categoryMiddle2: task.categoryMiddle2,
      categorySmall: task.categorySmall,
      siteMainCategory: task.siteMainCategory ?? task.categoryMajor,
      siteDisplayText: resolveSiteDisplayText({
        siteDisplayText: task.siteDisplayText,
        activityName: task.activityName,
        name: task.name,
      }),
      companyId: task.companyId,
      assignee: task.assignee,
      progress: task.progress,
      startDate: task.startDate,
      endDate: task.endDate,
      durationDays: task.durationDays,
      color: task.color,
      isMilestone: task.isMilestone,
      notes: task.notes,
      wbsCode: task.wbsCode,
    });
    setSiteDisplayTextManual(
      isSiteDisplayTextManual({
        siteDisplayText: task.siteDisplayText,
        activityName: task.activityName,
        name: task.name,
      }),
    );
  }, [task]);

  React.useEffect(() => {
    if (!task) {
      setCompanyNameDraft("");
      return;
    }

    const selectedCompany = companies.find((company) => company.id === task.companyId);
    setCompanyNameDraft(selectedCompany?.name ?? "");
  }, [companies, task]);

  const projectHolidayDayKeys = React.useMemo(() => {
    const result = new Set<string>();
    for (const h of holidays) {
      if (h.scope !== "PROJECT") continue;
      const start = new Date(h.startDate);
      const end = new Date(h.endDate);
      const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
      const finish = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
      while (current.getTime() <= finish.getTime()) {
        result.add(current.toISOString().slice(0, 10));
        current.setUTCDate(current.getUTCDate() + 1);
      }
    }
    return result;
  }, [holidays]);

  React.useEffect(() => {
    if (!task || !depDraft.predecessorTaskId || depDraft.predecessorTaskId === task.id) return;
    const pred = tasks.find((t) => t.id === depDraft.predecessorTaskId);
    if (!pred) return;
    const calendarConfig = {
      workMon: calendar.workMon,
      workTue: calendar.workTue,
      workWed: calendar.workWed,
      workThu: calendar.workThu,
      workFri: calendar.workFri,
      workSat: calendar.workSat,
      workSun: calendar.workSun,
      holidayDayKeys: projectHolidayDayKeys,
    };
    const inferred = inferDependencyFromTaskDates(
      { startDate: pred.startDate, endDate: pred.endDate },
      { startDate: task.startDate, endDate: task.endDate },
      calendarConfig,
    );
    setDepDraft((prev) => ({
      ...prev,
      type: inferred.type,
      mode: inferred.lagDays >= 0 ? "lag" : "lead",
      offsetDays: Math.abs(inferred.lagDays),
    }));
  }, [depDraft.predecessorTaskId, task, tasks, calendar, projectHolidayDayKeys]);

  const incomingDependencies = React.useMemo(
    () => (task ? dependencies.filter((dependency) => dependency.successorTaskId === task.id) : []),
    [dependencies, task],
  );

  const predecessorCandidates = React.useMemo(
    () => tasks.filter((candidate) => candidate.id !== task?.id),
    [tasks, task],
  );

  const majorCategoryOptions = React.useMemo(
    () => uniqueSorted(tasks.map((item) => item.categoryMajor)),
    [tasks],
  );
  const middle1CategoryOptions = React.useMemo(() => {
    const major = (draft.categoryMajor ?? "").trim();
    const candidates = tasks.filter((item) => (major ? (item.categoryMajor ?? "").trim() === major : true));
    return uniqueSorted(candidates.map((item) => item.categoryMiddle1));
  }, [tasks, draft.categoryMajor]);

  const middle2CategoryOptions = React.useMemo(() => {
    const major = (draft.categoryMajor ?? "").trim();
    const middle1 = (draft.categoryMiddle1 ?? "").trim();
    const candidates = tasks.filter((item) => {
      const majorMatches = major ? (item.categoryMajor ?? "").trim() === major : true;
      const middle1Matches = middle1 ? (item.categoryMiddle1 ?? "").trim() === middle1 : true;
      return majorMatches && middle1Matches;
    });
    return uniqueSorted(candidates.map((item) => item.categoryMiddle2));
  }, [tasks, draft.categoryMajor, draft.categoryMiddle1]);

  const smallCategoryOptions = React.useMemo(() => {
    const major = (draft.categoryMajor ?? "").trim();
    const middle1 = (draft.categoryMiddle1 ?? "").trim();
    const middle2 = (draft.categoryMiddle2 ?? "").trim();
    const candidates = tasks.filter((item) => {
      const majorMatches = major ? (item.categoryMajor ?? "").trim() === major : true;
      const middle1Matches = middle1 ? (item.categoryMiddle1 ?? "").trim() === middle1 : true;
      const middle2Matches = middle2 ? (item.categoryMiddle2 ?? "").trim() === middle2 : true;
      return majorMatches && middle1Matches && middle2Matches;
    });
    return uniqueSorted(candidates.map((item) => item.categorySmall));
  }, [tasks, draft.categoryMajor, draft.categoryMiddle1, draft.categoryMiddle2]);

  const siteMainCategoryOptions = React.useMemo(
    () => uniqueSorted(tasks.map((item) => item.siteMainCategory ?? item.categoryMajor)),
    [tasks],
  );

  const assigneeOptions = React.useMemo(
    () => uniqueSorted(tasks.map((item) => item.assignee)),
    [tasks],
  );

  const companyNameOptions = React.useMemo(
    () => uniqueSorted(companies.map((item) => item.name)),
    [companies],
  );

  const handleSave = React.useCallback(() => {
    if (!task) return;
    void (async () => {
      const nextActivityName = (draft.activityName ?? draft.name ?? "").trim();
      if (!nextActivityName) {
        return;
      }

      const nextCompanyName = companyNameDraft.trim();
      let nextCompanyId: string | null = null;

      if (nextCompanyName) {
        const existingCompany = companies.find(
          (company) => normalizeLookupText(company.name) === normalizeLookupText(nextCompanyName),
        );

        if (existingCompany) {
          nextCompanyId = existingCompany.id;
          if (existingCompany.name !== companyNameDraft) {
            setCompanyNameDraft(existingCompany.name);
          }
        } else {
          const createdCompany = await onCreateCompany({ name: nextCompanyName });
          nextCompanyId = createdCompany.id;
          setCompanyNameDraft(createdCompany.name);
        }
      }

      const patch: Partial<TaskModel> = {
        ...draft,
        name: nextActivityName,
        activityName: nextActivityName,
        categoryMajor: normalizeNullableField(draft.categoryMajor),
        categoryMiddle1: normalizeNullableField(draft.categoryMiddle1),
        categoryMiddle2: normalizeNullableField(draft.categoryMiddle2),
        categorySmall: normalizeNullableField(draft.categorySmall),
        siteMainCategory:
          normalizeNullableField(draft.siteMainCategory) ?? normalizeNullableField(draft.categoryMajor) ?? null,
        siteDisplayText: siteDisplayTextManual ? normalizeNullableField(draft.siteDisplayText) : null,
        companyId: nextCompanyId,
        assignee: normalizeNullableField(draft.assignee),
        wbsCode: normalizeNullableField(draft.wbsCode),
        notes: normalizeNullableField(draft.notes),
      };

      await onTaskSave(task.id, patch);
    })();
  }, [companyNameDraft, companies, draft, onCreateCompany, onTaskSave, siteDisplayTextManual, task]);

  const taskHolidays = !task?.companyId
    ? holidays.filter((item) => item.scope === "PROJECT")
    : holidays.filter((item) => item.scope === "PROJECT" || item.companyId === task.companyId);

  return (
    <Card className="h-full overflow-auto">
      <CardHeader>
        <div className="space-y-1">
          <h3 className="text-base font-semibold">프로젝트 상세</h3>
          <p className="text-xs text-muted">프로젝트/작업관리 관련 데이터 일괄 수정</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {task ? (
          <section className="space-y-3">
            <div className="space-y-1.5">
              <Label>Activity</Label>
              <Input
                value={draft.activityName ?? draft.name ?? ""}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    activityName: event.target.value,
                    name: event.target.value,
                    siteDisplayText: siteDisplayTextManual ? prev.siteDisplayText : event.target.value,
                  }))
                }
                readOnly={readOnly}
                className={readOnly ? "bg-muted" : undefined}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>대분류</Label>
                <SuggestionInput
                  options={majorCategoryOptions}
                  value={draft.categoryMajor ?? ""}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, categoryMajor: value }))}
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>중분류1</Label>
                <SuggestionInput
                  options={middle1CategoryOptions}
                  value={draft.categoryMiddle1 ?? ""}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, categoryMiddle1: value }))}
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>중분류2</Label>
                <SuggestionInput
                  options={middle2CategoryOptions}
                  value={draft.categoryMiddle2 ?? ""}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, categoryMiddle2: value }))}
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>소분류</Label>
                <SuggestionInput
                  options={smallCategoryOptions}
                  value={draft.categorySmall ?? ""}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, categorySmall: value }))}
                  disabled={readOnly}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>업체</Label>
                <SuggestionInput
                  options={companyNameOptions}
                  value={companyNameDraft}
                  onValueChange={setCompanyNameDraft}
                  placeholder="Type or select a company"
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>담당자</Label>
                <SuggestionInput
                  options={assigneeOptions}
                  value={draft.assignee ?? ""}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, assignee: value }))}
                  disabled={readOnly}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>대표공종</Label>
                <SuggestionInput
                  options={siteMainCategoryOptions}
                  value={draft.siteMainCategory ?? ""}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, siteMainCategory: value }))}
                  placeholder="현장표 메인 공종"
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>현장표 문구</Label>
                  {!readOnly && (
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span>별도 수정</span>
                      <Switch
                        checked={siteDisplayTextManual}
                        onCheckedChange={(checked) => {
                          setSiteDisplayTextManual(checked);
                          setDraft((prev) => ({
                            ...prev,
                            siteDisplayText: checked
                              ? resolveSiteDisplayText({
                                  siteDisplayText: prev.siteDisplayText,
                                  activityName: prev.activityName,
                                  name: prev.name,
                                })
                              : prev.activityName ?? prev.name ?? "",
                          }));
                        }}
                      />
                    </div>
                  )}
                </div>
                <Input
                  value={siteDisplayTextManual ? draft.siteDisplayText ?? "" : draft.activityName ?? draft.name ?? ""}
                  disabled={!siteDisplayTextManual || readOnly}
                  readOnly={readOnly}
                  onChange={(event) => setDraft((prev) => ({ ...prev, siteDisplayText: event.target.value }))}
                  placeholder={siteDisplayTextManual ? "현장표 셀 문구" : "Activity와 자동 연동"}
                  className={readOnly ? "bg-muted" : undefined}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>시작일</Label>
                <Input
                  type="date"
                  value={draft.startDate ? toDateInputValue(draft.startDate) : ""}
                  onChange={(event) => {
                    const startDateStr = event.target.value;
                    setDraft((prev) => {
                      if (!prev) return prev;
                      const durationDays = Math.max(1, prev.durationDays ?? 1);
                      const endDateStr = addDaysToDateString(startDateStr, durationDays - 1);
                      return {
                        ...prev,
                        startDate: toIsoDay(startDateStr),
                        endDate: toIsoDay(endDateStr),
                      };
                    });
                  }}
                  readOnly={readOnly}
                  disabled={readOnly}
                  className={readOnly ? "bg-muted" : undefined}
                />
              </div>
              <div className="space-y-1.5">
                <Label>종료일</Label>
                <Input
                  type="date"
                  value={draft.endDate ? toDateInputValue(draft.endDate) : ""}
                  onChange={(event) => {
                    const endDateStr = event.target.value;
                    setDraft((prev) => {
                      if (!prev || !prev.startDate) return prev;
                      const durationDays = getDurationDays(prev.startDate, endDateStr);
                      return {
                        ...prev,
                        endDate: toIsoDay(endDateStr),
                        durationDays,
                      };
                    });
                  }}
                  readOnly={readOnly}
                  disabled={readOnly}
                  className={readOnly ? "bg-muted" : undefined}
                />
              </div>
              <div className="space-y-1.5">
                <Label>기간(일)</Label>
                <Input
                  type="number"
                  min={1}
                  value={draft.durationDays ?? 1}
                  onChange={(event) => {
                    const durationDays = Math.max(1, Number(event.target.value) || 1);
                    setDraft((prev) => {
                      if (!prev || !prev.startDate) return prev;
                      const endDateStr = addDaysToDateString(prev.startDate, durationDays - 1);
                      return {
                        ...prev,
                        durationDays,
                        endDate: toIsoDay(endDateStr),
                      };
                    });
                  }}
                  readOnly={readOnly}
                  disabled={readOnly}
                  className={readOnly ? "bg-muted" : undefined}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>진척률(%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.progress ?? 0}
                  onChange={(event) => setDraft((prev) => ({ ...prev, progress: Number(event.target.value) }))}
                  readOnly={readOnly}
                  disabled={readOnly}
                  className={readOnly ? "bg-muted" : undefined}
                />
              </div>
              <div className="space-y-1.5">
                <Label>색상</Label>
                <Input
                  type="color"
                  value={draft.color ?? "#3B82F6"}
                  onChange={(event) => setDraft((prev) => ({ ...prev, color: event.target.value }))}
                  className="h-9 p-1"
                  disabled={readOnly}
                  readOnly={readOnly}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
              <div>
                <p className="text-sm font-medium">마일스톤</p>
                <p className="text-xs text-muted">생성 시 시작일과 종료일을 같은 날짜로 고정합니다.</p>
              </div>
              {!readOnly && (
                <Switch
                  checked={Boolean(draft.isMilestone)}
                  onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, isMilestone: checked }))}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>메모</Label>
              <Textarea
                value={draft.notes ?? ""}
                onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
                readOnly={readOnly}
                disabled={readOnly}
                className={readOnly ? "bg-muted" : undefined}
              />
            </div>

            {!readOnly && (
              <div className="flex items-center gap-2">
                <Button onClick={handleSave} className="flex-1">
                  저장
                </Button>
                <Button variant="danger" size="icon" onClick={() => void onTaskDelete(task.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            )}
          </section>
        ) : (
            <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-muted dark:border-zinc-700">
              작업을 선택하면 상세 편집이 표시됩니다.
            </div>
        )}

        {task ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">선행 작업</h4>
              <Badge>{incomingDependencies.length}</Badge>
            </div>
            <div className="space-y-2">
              {incomingDependencies.length > 0 ? (
                incomingDependencies.map((dependency) => {
                  const predecessor = tasks.find((candidate) => candidate.id === dependency.predecessorTaskId);
                  return (
                    <div
                      key={dependency.id}
                      className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700"
                    >
                      <div>
                         <p className="font-medium">{predecessor?.activityName || predecessor?.name || "(삭제된 작업)"}</p>
                        <p className="text-muted">
                          {dependency.type} · {formatOffsetLabel(dependency.lagDays)}
                        </p>
                      </div>
                      {!readOnly && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="구속 수정"
                            onClick={() => setEditingDependency(dependency)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => void onDeleteDependency(dependency.id)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                 <p className="text-xs text-muted">연결된 선행 작업이 없습니다.</p>
              )}
            </div>

            {!readOnly && (
            <div className="space-y-2 rounded-xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
              <Label>선후행 관계 추가</Label>
              <Select value={depDraft.predecessorTaskId} onValueChange={(value) => setDepDraft((prev) => ({ ...prev, predecessorTaskId: value }))}>
                <SelectTrigger>
                    <SelectValue placeholder="선행 작업 선택" />
                </SelectTrigger>
                <SelectContent>
                  {predecessorCandidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.activityName || candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-3 gap-2">
                <Select value={depDraft.type} onValueChange={(value) => setDepDraft((prev) => ({ ...prev, type: value as "FS" | "SS" | "FF" | "SF" }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["FS", "SS", "FF", "SF"] as const).map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={depDraft.mode} onValueChange={(value) => setDepDraft((prev) => ({ ...prev, mode: value as "lag" | "lead" }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lag">Lag</SelectItem>
                    <SelectItem value="lead">Lead</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={0}
                  value={depDraft.offsetDays}
                  onChange={(event) =>
                    setDepDraft((prev) => ({
                      ...prev,
                      offsetDays: Math.max(0, Number(event.target.value) || 0),
                    }))
                  }
                  placeholder="일수"
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-zinc-200 p-2 dark:border-zinc-700">
                <div>
                  <p className="text-xs font-medium">스케줄 연동</p>
                  <p className="text-[11px] text-muted">켜면 선행 작업 변경 시 후행 일정이 자동 재계산됩니다.</p>
                </div>
                <Switch
                  checked={depDraft.drivesSchedule}
                  onCheckedChange={(checked) => setDepDraft((prev) => ({ ...prev, drivesSchedule: checked }))}
                />
              </div>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  if (!depDraft.predecessorTaskId) return;
                  const signedOffset = depDraft.mode === "lead" ? -depDraft.offsetDays : depDraft.offsetDays;
                  void onCreateDependency({
                    predecessorTaskId: depDraft.predecessorTaskId,
                    successorTaskId: task.id,
                    type: depDraft.type,
                    lagDays: signedOffset,
                    drivesSchedule: depDraft.drivesSchedule,
                  });
                }}
              >
                <Plus className="size-4" /> 선후행 관계 추가
              </Button>
            </div>
            )}
          </section>
        ) : null}

        <Dialog open={Boolean(editingDependency)} onOpenChange={(open) => !open && setEditingDependency(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>구속(선후행) 수정</DialogTitle>
            </DialogHeader>
            {editingDependency ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>선행 작업</Label>
                  <div className="rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
                    {tasks.find((t) => t.id === editingDependency.predecessorTaskId)?.activityName ||
                      tasks.find((t) => t.id === editingDependency.predecessorTaskId)?.name ||
                      "-"}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>후행 작업</Label>
                  <div className="rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
                    {tasks.find((t) => t.id === editingDependency.successorTaskId)?.activityName ||
                      tasks.find((t) => t.id === editingDependency.successorTaskId)?.name ||
                      "-"}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label>관계</Label>
                    <Select
                      value={editDepDraft.type}
                      onValueChange={(value) => setEditDepDraft((prev) => ({ ...prev, type: value as "FS" | "SS" | "FF" | "SF" }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["FS", "SS", "FF", "SF"] as const).map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>모드</Label>
                    <Select
                      value={editDepDraft.mode}
                      onValueChange={(value) => setEditDepDraft((prev) => ({ ...prev, mode: value as "lag" | "lead" }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lag">Lag</SelectItem>
                        <SelectItem value="lead">Lead</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>일수</Label>
                    <Input
                      type="number"
                      min={0}
                      value={editDepDraft.offsetDays}
                      onChange={(event) =>
                        setEditDepDraft((prev) => ({
                          ...prev,
                          offsetDays: Math.max(0, Number(event.target.value) || 0),
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
                  <div>
                    <p className="text-sm font-medium">스케줄 연동</p>
                    <p className="text-xs text-muted">켜면 수정 후 일정을 재계산합니다.</p>
                  </div>
                  <Switch
                    checked={editDepDraft.drivesSchedule}
                    onCheckedChange={(checked) => setEditDepDraft((prev) => ({ ...prev, drivesSchedule: checked }))}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setEditingDependency(null)}>
                    취소
                  </Button>
                  <Button
                    onClick={() => {
                      if (!editingDependency) return;
                      const signedOffset = editDepDraft.mode === "lead" ? -editDepDraft.offsetDays : editDepDraft.offsetDays;
                      void onUpdateDependency(editingDependency.id, {
                        type: editDepDraft.type,
                        lagDays: signedOffset,
                        drivesSchedule: editDepDraft.drivesSchedule,
                      });
                      setEditingDependency(null);
                    }}
                  >
                    저장
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(editingHoliday)} onOpenChange={(open) => !open && setEditingHoliday(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>휴일 수정</DialogTitle>
            </DialogHeader>
            {editingHoliday ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>범위</Label>
                    <Select
                      value={editHolidayDraft.scope}
                      onValueChange={(value) =>
                        setEditHolidayDraft((prev) => ({
                          ...prev,
                          scope: value as HolidayScope,
                          companyId: value === "PROJECT" ? "" : prev.companyId,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PROJECT">프로젝트</SelectItem>
                        <SelectItem value="COMPANY">업체</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>업체</Label>
                    <Select
                      value={editHolidayDraft.companyId || "none"}
                      disabled={editHolidayDraft.scope !== "COMPANY"}
                      onValueChange={(value) =>
                        setEditHolidayDraft((prev) => ({ ...prev, companyId: value === "none" ? "" : value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="업체 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">업체 선택</SelectItem>
                        {companies.map((company) => (
                          <SelectItem key={company.id} value={company.id}>
                            {company.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>시작일</Label>
                    <Input
                      type="date"
                      value={editHolidayDraft.startDate}
                      onChange={(event) =>
                        setEditHolidayDraft((prev) => ({ ...prev, startDate: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>종료일</Label>
                    <Input
                      type="date"
                      value={editHolidayDraft.endDate}
                      onChange={(event) =>
                        setEditHolidayDraft((prev) => ({ ...prev, endDate: event.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>휴일명(선택)</Label>
                  <Input
                    value={editHolidayDraft.name}
                    onChange={(event) =>
                      setEditHolidayDraft((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="휴일명"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setEditingHoliday(null)}>
                    취소
                  </Button>
                  <Button
                    onClick={() => {
                      if (!editingHoliday) return;
                      if (!editHolidayDraft.startDate || !editHolidayDraft.endDate) return;
                      if (editHolidayDraft.scope === "COMPANY" && !editHolidayDraft.companyId) return;
                      void onUpdateHoliday(editingHoliday.id, {
                        scope: editHolidayDraft.scope,
                        companyId: editHolidayDraft.scope === "COMPANY" ? editHolidayDraft.companyId : null,
                        name: editHolidayDraft.name.trim() ? editHolidayDraft.name.trim() : null,
                        startDate: toIsoDay(editHolidayDraft.startDate),
                        endDate: toIsoDay(editHolidayDraft.endDate),
                      });
                      setEditingHoliday(null);
                    }}
                  >
                    저장
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <section className="space-y-3">
          <h4 className="text-sm font-semibold">근무일 캘린더</h4>
          <div className="grid grid-cols-2 gap-2">
            {CALENDAR_DAY_OPTIONS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`rounded-xl border px-3 py-2 text-sm transition ${
                  calendar[key]
                    ? "border-blue-400 bg-blue-500/10 text-blue-600"
                  : "border-zinc-200 text-zinc-500 dark:border-zinc-700"
                } ${readOnly ? "cursor-default" : ""}`}
                onClick={() => !readOnly && void onUpdateCalendar({ [key]: !calendar[key] })}
                disabled={readOnly}
              >
                {label}요일 {calendar[key] ? "근무" : "휴무"}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">업체 관리</h4>
            <Badge>{companies.length}</Badge>
          </div>
          <div className="space-y-2">
            {companies.map((company) => (
              <div key={company.id} className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                <span>{company.name}</span>
                {!readOnly && (
                  <Button variant="ghost" size="icon" onClick={() => void onDeleteCompany(company.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {!readOnly && (
            <div className="flex gap-2">
              <Input
                value={newCompanyName}
                onChange={(event) => setNewCompanyName(event.target.value)}
                placeholder="새 업체명"
              />
              <Button
                variant="secondary"
                onClick={() => {
                  const name = newCompanyName.trim();
                  if (!name) return;
                  setNewCompanyName("");
                  void onCreateCompany({ name });
                }}
              >
                <Plus className="size-4" /> 추가
              </Button>
            </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">휴일(프로젝트+업체)</h4>
            <Badge>{holidays.length}</Badge>
          </div>
          <div className="space-y-2">
            {holidays.map((holiday) => {
              const companyName = holiday.companyId
                ? companies.find((item) => item.id === holiday.companyId)?.name ?? "-"
                : "-";
              return (
                <div key={holiday.id} className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                  <div>
                    <p className="font-medium">
                        {holiday.scope === "PROJECT" ? "프로젝트" : `업체:${companyName}`} · {holiday.name || "휴일"}
                    </p>
                    <p className="text-muted">
                      {toDateInputValue(holiday.startDate)} ~ {toDateInputValue(holiday.endDate)}
                    </p>
                  </div>
                  {!readOnly && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="휴일 수정"
                        onClick={() => setEditingHoliday(holiday)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => void onDeleteHoliday(holiday.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {!readOnly && (
            <div className="space-y-2 rounded-xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
              <Label>휴일 추가</Label>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={holidayDraft.scope}
                  onValueChange={(value) =>
                    setHolidayDraft((prev) => ({
                      ...prev,
                      scope: value as HolidayScope,
                      companyId: value === "PROJECT" ? "" : prev.companyId,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PROJECT">프로젝트</SelectItem>
                    <SelectItem value="COMPANY">업체</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={holidayDraft.companyId || "none"}
                  disabled={holidayDraft.scope !== "COMPANY"}
                  onValueChange={(value) =>
                    setHolidayDraft((prev) => ({ ...prev, companyId: value === "none" ? "" : value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="업체 선택" />
                  </SelectTrigger>
                  <SelectContent>
                      <SelectItem value="none">업체 선택</SelectItem>
                    {companies.map((company) => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  value={holidayDraft.startDate}
                  onChange={(event) => setHolidayDraft((prev) => ({ ...prev, startDate: event.target.value }))}
                />
                <Input
                  type="date"
                  value={holidayDraft.endDate}
                  onChange={(event) => setHolidayDraft((prev) => ({ ...prev, endDate: event.target.value }))}
                />
              </div>
              <Input
                value={holidayDraft.name}
                onChange={(event) => setHolidayDraft((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="휴일명(선택)"
              />
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  if (!holidayDraft.startDate || !holidayDraft.endDate) return;
                  if (holidayDraft.scope === "COMPANY" && !holidayDraft.companyId) return;
                  void onCreateHoliday({
                    scope: holidayDraft.scope,
                    companyId: holidayDraft.scope === "COMPANY" ? holidayDraft.companyId : null,
                    name: holidayDraft.name.trim() ? holidayDraft.name.trim() : null,
                    startDate: toIsoDay(holidayDraft.startDate),
                    endDate: toIsoDay(holidayDraft.endDate),
                  });
                  setHolidayDraft({
                    scope: "PROJECT",
                    companyId: "",
                    name: "",
                    startDate: "",
                    endDate: "",
                  });
                }}
              >
                <Plus className="size-4" /> 휴일 추가
              </Button>
            </div>
            )}
          </div>
          {task ? (
            <div className="rounded-lg border border-zinc-200 p-2 text-xs text-muted dark:border-zinc-700">
              현재 작업 적용 휴일 수: {taskHolidays.length} (프로젝트 + 매핑 업체)
            </div>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}

