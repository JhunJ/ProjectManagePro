import { z } from "zod";

export const dependencyTypeSchema = z.enum(["FS", "SS", "FF", "SF"]);
export const projectVersionTypeSchema = z.enum(["PLAN", "ACTUAL"]);
export const holidayScopeSchema = z.enum(["PROJECT", "COMPANY"]);

const dateSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), "유효한 날짜가 아닙니다.");

export const projectCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  startDate: dateSchema,
  endDate: dateSchema.nullable().optional(),
});

export const projectUpdateSchema = projectCreateSchema.partial();

export const taskCreateSchema = z.object({
  parentTaskId: z.string().nullable().optional(),
  timelineHeadTaskId: z.string().min(1).nullable().optional(),
  name: z.string().min(1).max(200),
  activityName: z.string().max(200).nullable().optional(),
  categoryMajor: z.string().max(100).nullable().optional(),
  categoryMiddle1: z.string().max(100).nullable().optional(),
  categoryMiddle2: z.string().max(100).nullable().optional(),
  categorySmall: z.string().max(100).nullable().optional(),
  companyId: z.string().nullable().optional(),
  siteMainCategory: z.string().max(100).nullable().optional(),
  siteDisplayText: z.string().max(200).nullable().optional(),
  categoryMiddle: z.string().max(100).nullable().optional(),
  categoryMinor: z.string().max(100).nullable().optional(),
  wbsCode: z.string().max(60).nullable().optional(),
  startDate: dateSchema,
  endDate: dateSchema,
  durationDays: z.number().int().positive(),
  progress: z.number().int().min(0).max(100).default(0),
  assignee: z.string().max(100).nullable().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#3B82F6"),
  isMilestone: z.boolean().default(false),
  notes: z.string().max(5000).nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

/** PATCH용: 보내지 않은 필드는 undefined → DB 갱신 제외. progress는 기본값 없이 optional만 (스케줄만 수정 시 진척률 유지) */
export const taskUpdateSchema = taskCreateSchema
  .partial()
  .extend({
    progress: z.number().int().min(0).max(100).optional(),
    /** false면 이 작업만 수정하고 후행 작업 일정 재계산 생략. 클라이언트 스케줄 연동 토글용 */
    recalculateSuccessors: z.boolean().optional(),
    /** true면 후행 재계산 시 drivesSchedule 무시하고 연결된 구속 모두 반영 */
    forceAllDependencies: z.boolean().optional(),
  });

export const taskReorderSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        sortOrder: z.number().int().nonnegative(),
        parentTaskId: z.string().nullable(),
      }),
    )
    .min(1),
});

export const dependencyCreateSchema = z.object({
  predecessorTaskId: z.string(),
  successorTaskId: z.string(),
  type: dependencyTypeSchema.default("FS"),
  lagDays: z.number().int().default(0),
  /** false면 연결만 추가하고 스케줄 재계산 생략. 기본 false로 두어 기존 일정 유지 */
  drivesSchedule: z.boolean().optional().default(false),
});

export const dependencyUpdateSchema = dependencyCreateSchema.partial();

export const calendarPatchSchema = z.object({
  workMon: z.boolean().optional(),
  workTue: z.boolean().optional(),
  workWed: z.boolean().optional(),
  workThu: z.boolean().optional(),
  workFri: z.boolean().optional(),
  workSat: z.boolean().optional(),
  workSun: z.boolean().optional(),
});

export const recalculateSchema = z.object({
  anchorTaskIds: z.array(z.string()).default([]),
});

export const projectVersionCreateSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(4000).nullable().optional(),
  createdBy: z.string().min(1).max(120),
  versionType: projectVersionTypeSchema,
});

export const projectVersionUpdateSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  description: z.string().max(4000).nullable().optional(),
  createdBy: z.string().min(1).max(120).optional(),
});

export const projectVersionCompareSchema = z.object({
  planVersionId: z.string().min(1),
  actualVersionId: z.string().min(1),
});

export const companyCreateSchema = z.object({
  name: z.string().min(1).max(120),
});

export const companyUpdateSchema = companyCreateSchema.partial();

const holidayBaseSchema = z.object({
  scope: holidayScopeSchema,
  companyId: z.string().nullable().optional(),
  name: z.string().max(200).nullable().optional(),
  startDate: dateSchema,
  endDate: dateSchema,
});

export const holidayCreateSchema = holidayBaseSchema
  .refine(
    (value) => {
      if (value.scope === "COMPANY") {
        return Boolean(value.companyId);
      }
      return true;
    },
    {
      message: "companyId is required for COMPANY scope.",
      path: ["companyId"],
    },
  );

export const holidayUpdateSchema = holidayBaseSchema.partial().refine(
  (value) => {
    if (value.scope === "COMPANY") {
      return Boolean(value.companyId);
    }
    return true;
  },
  {
    message: "companyId is required for COMPANY scope.",
    path: ["companyId"],
  },
);
