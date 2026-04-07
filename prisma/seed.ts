import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const defaultCalendar = {
  workMon: true,
  workTue: true,
  workWed: true,
  workThu: true,
  workFri: true,
  workSat: false,
  workSun: false,
};

type TaskSeed = {
  id: string;
  name: string;
  activityName?: string;
  siteDisplayText?: string;
  categoryMajor: string;
  categoryMiddle1: string | null;
  categoryMiddle2: string | null;
  categorySmall: string | null;
  siteMainCategory?: string | null;
  companyName?: string | null;
  assignee?: string | null;
  color: string;
  startOffset: number;
  durationDays: number;
  progress: number;
};

type HolidaySeed = {
  scope: "PROJECT" | "COMPANY";
  name: string;
  startDate: Date;
  endDate: Date;
  companyName?: string;
};

function toUtcDay(date: Date | string) {
  const source = typeof date === "string" ? new Date(date) : date;
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
}

function dayKey(date: Date | string) {
  return toUtcDay(date).toISOString().slice(0, 10);
}

function isWorkingDay(date: Date, holidayDayKeys: Set<string>) {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) {
    return false;
  }
  return !holidayDayKeys.has(dayKey(date));
}

function addBusinessDays(baseDate: Date, days: number, holidayDayKeys: Set<string>) {
  if (days === 0) {
    let current = toUtcDay(baseDate);
    while (!isWorkingDay(current, holidayDayKeys)) {
      current = new Date(current.getTime() + MS_PER_DAY);
    }
    return current;
  }

  let current = toUtcDay(baseDate);
  let remaining = Math.abs(days);
  const direction = days > 0 ? 1 : -1;

  while (remaining > 0) {
    current = new Date(current.getTime() + direction * MS_PER_DAY);
    if (isWorkingDay(current, holidayDayKeys)) {
      remaining -= 1;
    }
  }

  return current;
}

function expandHolidayKeys(holidays: Array<Pick<HolidaySeed, "startDate" | "endDate">>) {
  const keys = new Set<string>();
  for (const holiday of holidays) {
    const start = toUtcDay(holiday.startDate);
    const end = toUtcDay(holiday.endDate);
    const current = new Date(start.getTime());
    while (current.getTime() <= end.getTime()) {
      keys.add(dayKey(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }
  }
  return keys;
}

function createTaskDates(projectStart: Date, startOffset: number, durationDays: number, holidayDayKeys: Set<string>) {
  const startDate = addBusinessDays(projectStart, startOffset, holidayDayKeys);
  const endDate = durationDays <= 1 ? startDate : addBusinessDays(startDate, durationDays - 1, holidayDayKeys);
  return { startDate, endDate };
}

function shiftTaskDates(task: {
  startDate: string;
  endDate: string;
  durationDays: number;
}, shiftDays: number, holidayDayKeys: Set<string>) {
  const startDate = addBusinessDays(new Date(task.startDate), shiftDays, holidayDayKeys);
  const endDate = task.durationDays <= 1 ? startDate : addBusinessDays(startDate, task.durationDays - 1, holidayDayKeys);
  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  };
}

async function main() {
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD ?? "admin123";
  const adminHash = await bcrypt.hash(adminPassword, 10);
  await prisma.user.upsert({
    where: { username: "admin" },
    create: { username: "admin", passwordHash: adminHash, role: "ADMIN" },
    update: {},
  });
  console.log("Admin user ensured (login: admin / ADMIN_INITIAL_PASSWORD or admin123).");

  await prisma.projectVersion.deleteMany();
  await prisma.dependency.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.task.deleteMany();
  await prisma.workingCalendar.deleteMany();
  await prisma.company.deleteMany();
  await prisma.project.deleteMany();

  const projectStart = new Date(Date.UTC(2026, 0, 5));

  const project = await prisma.project.create({
    data: {
      name: "영등 푸르지오 파인비르 A2BL 신축공사",
      description: "MS Project형 작업뷰와 현장 공정표 뷰를 함께 검증하기 위한 데모 프로젝트",
      startDate: projectStart,
    },
  });

  await prisma.workingCalendar.create({
    data: {
      projectId: project.id,
      ...defaultCalendar,
    },
  });

  const companyNames = ["골조팀", "조적팀", "견출팀", "창호팀", "내장팀", "방수팀", "도장팀"];
  const companies = await Promise.all(
    companyNames.map((name) =>
      prisma.company.upsert({
        where: { projectId_name: { projectId: project.id, name } },
        create: { projectId: project.id, name },
        update: {},
      }),
    ),
  );
  const companyIdByName = new Map(companies.map((company) => [company.name, company.id]));

  const holidaySeeds: HolidaySeed[] = [
    {
      scope: "PROJECT",
      name: "현장 휴무",
      startDate: new Date(Date.UTC(2026, 0, 21)),
      endDate: new Date(Date.UTC(2026, 0, 21)),
    },
    {
      scope: "PROJECT",
      name: "신정",
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: new Date(Date.UTC(2026, 0, 1)),
    },
    {
      scope: "COMPANY",
      name: "조적팀 휴무",
      companyName: "조적팀",
      startDate: new Date(Date.UTC(2026, 0, 28)),
      endDate: new Date(Date.UTC(2026, 0, 29)),
    },
  ];

  await Promise.all(
    holidaySeeds.map((holiday) =>
      prisma.holiday.create({
        data: {
          projectId: project.id,
          scope: holiday.scope,
          companyId: holiday.companyName ? companyIdByName.get(holiday.companyName) ?? null : null,
          name: holiday.name,
          startDate: holiday.startDate,
          endDate: holiday.endDate,
        },
      }),
    ),
  );

  const projectHolidayKeys = expandHolidayKeys(holidaySeeds.filter((holiday) => holiday.scope === "PROJECT"));

  const actualTaskSeeds: TaskSeed[] = [
    {
      id: "act-201-meok",
      name: "201동 1~8층 먹메김",
      activityName: "201동 먹메김",
      siteDisplayText: "201동 1~8층 먹메김",
      categoryMajor: "건축",
      categoryMiddle1: "골조공사",
      categoryMiddle2: "먹메김",
      categorySmall: "201동",
      companyName: "골조팀",
      assignee: "박기준",
      color: "#2563EB",
      startOffset: 0,
      durationDays: 4,
      progress: 100,
    },
    {
      id: "act-202-meok",
      name: "202동 1~8층 먹메김",
      activityName: "202동 먹메김",
      siteDisplayText: "202동 1~8층 먹메김",
      categoryMajor: "건축",
      categoryMiddle1: "골조공사",
      categoryMiddle2: "먹메김",
      categorySmall: "202동",
      companyName: "골조팀",
      assignee: "정시공",
      color: "#2563EB",
      startOffset: 1,
      durationDays: 4,
      progress: 100,
    },
    {
      id: "act-203-plaster",
      name: "203,204동 B1F 견출",
      activityName: "203,204동 B1F 견출",
      siteDisplayText: "203,204동 B1F 견출",
      categoryMajor: "습식공사",
      categoryMiddle1: "견출공사",
      categoryMiddle2: "B1F",
      categorySmall: "견출공사",
      companyName: "견출팀",
      assignee: "김연지",
      color: "#F97316",
      startOffset: 3,
      durationDays: 5,
      progress: 80,
    },
    {
      id: "act-205-masonry",
      name: "205,206동 9층 조적쌓기",
      activityName: "205,206동 9층 조적",
      siteDisplayText: "205,206동 9층 조적쌓기",
      categoryMajor: "습식공사",
      categoryMiddle1: "조적공사",
      categoryMiddle2: "층별시공",
      categorySmall: "조적공사",
      companyName: "조적팀",
      assignee: "최성배",
      color: "#16A34A",
      startOffset: 7,
      durationDays: 5,
      progress: 55,
    },
    {
      id: "act-201-b1-waterproof",
      name: "201동 지하층 방수",
      activityName: "201동 지하층 방수",
      siteDisplayText: "지하층 방수공사 (6~7층 사이)",
      categoryMajor: "방수공사",
      categoryMiddle1: "지하층",
      categoryMiddle2: "우레탄",
      categorySmall: "방수공사",
      companyName: "방수팀",
      assignee: "오민수",
      color: "#0EA5E9",
      startOffset: 9,
      durationDays: 4,
      progress: 40,
    },
    {
      id: "act-201-gypsum",
      name: "201동 1~4층 단열시공",
      activityName: "201동 단열시공",
      siteDisplayText: "201동 1~4층 단열시공",
      categoryMajor: "내장공사",
      categoryMiddle1: "단열/경량",
      categoryMiddle2: "세대내부",
      categorySmall: "단열/경량",
      siteMainCategory: "습식공사",
      companyName: "내장팀",
      assignee: "모델러",
      color: "#22C55E",
      startOffset: 12,
      durationDays: 6,
      progress: 35,
    },
    {
      id: "act-202-gypsum",
      name: "202동 1~4층 단열시공",
      activityName: "202동 단열시공",
      siteDisplayText: "202동 1~4층 단열시공",
      categoryMajor: "내장공사",
      categoryMiddle1: "단열/경량",
      categoryMiddle2: "세대내부",
      categorySmall: "단열/경량",
      siteMainCategory: "습식공사",
      companyName: "내장팀",
      assignee: "BIM팀",
      color: "#22C55E",
      startOffset: 13,
      durationDays: 6,
      progress: 20,
    },
    {
      id: "act-203-pl-window",
      name: "203동 1~4층 PL창호설치",
      activityName: "203동 PL창호",
      siteDisplayText: "203동 1~4층 PL창호설치",
      categoryMajor: "PL/창호공사",
      categoryMiddle1: "PL창호",
      categoryMiddle2: "세대창호",
      categorySmall: "PL창호",
      siteMainCategory: "건축",
      companyName: "창호팀",
      assignee: "자동화",
      color: "#14B8A6",
      startOffset: 16,
      durationDays: 5,
      progress: 10,
    },
    {
      id: "act-204-pl-window",
      name: "204동 1~4층 PL창호설치",
      activityName: "204동 PL창호",
      siteDisplayText: "204동 1~4층 PL창호설치",
      categoryMajor: "PL/창호공사",
      categoryMiddle1: "PL창호",
      categoryMiddle2: "세대창호",
      categorySmall: "PL창호",
      siteMainCategory: "건축",
      companyName: "창호팀",
      assignee: "자동화",
      color: "#14B8A6",
      startOffset: 17,
      durationDays: 5,
      progress: 5,
    },
    {
      id: "act-205-door",
      name: "205동 목창호 설치",
      activityName: "205동 목창호",
      siteDisplayText: "205동 1~8F 목창호설치",
      categoryMajor: "목창호공사",
      categoryMiddle1: "목창호",
      categoryMiddle2: "세대문틀",
      categorySmall: "목창호공사",
      companyName: "창호팀",
      assignee: "최성배",
      color: "#84CC16",
      startOffset: 20,
      durationDays: 4,
      progress: 0,
    },
    {
      id: "act-206-paint",
      name: "206동 세대 내부 도장",
      activityName: "206동 도장",
      siteDisplayText: "206동 내부 도장",
      categoryMajor: "도장",
      categoryMiddle1: "세대도장",
      categoryMiddle2: "내부",
      categorySmall: "도장공사",
      companyName: "도장팀",
      assignee: "김윤호",
      color: "#EC4899",
      startOffset: 22,
      durationDays: 4,
      progress: 0,
    },
    {
      id: "act-pc-zone",
      name: "PC 부재 설치",
      activityName: "PC 부재 설치",
      siteDisplayText: "에어링실 하부 PC설치",
      categoryMajor: "건축",
      categoryMiddle1: "골조공사",
      categoryMiddle2: "PC공사",
      categorySmall: "PC공사",
      companyName: "골조팀",
      assignee: "박기준",
      color: "#8B5CF6",
      startOffset: 5,
      durationDays: 6,
      progress: 70,
    },
    {
      id: "act-201-concrete",
      name: "201,202동 B1F 견출 보수",
      activityName: "B1F 견출 보수",
      siteDisplayText: "201,202동 B1F 견출 보수",
      categoryMajor: "습식공사",
      categoryMiddle1: "견출공사",
      categoryMiddle2: "보수",
      categorySmall: "견출공사",
      companyName: "견출팀",
      assignee: "김연지",
      color: "#F59E0B",
      startOffset: 14,
      durationDays: 3,
      progress: 15,
    },
    {
      id: "act-207-masonry",
      name: "207동 3층 조적 준비",
      activityName: "207동 조적 준비",
      siteDisplayText: "207동 3층 조적 준비",
      categoryMajor: "습식공사",
      categoryMiddle1: "조적공사",
      categoryMiddle2: "준비작업",
      categorySmall: "조적공사",
      companyName: "조적팀",
      assignee: "최성배",
      color: "#16A34A",
      startOffset: 11,
      durationDays: 2,
      progress: 100,
    },
    {
      id: "act-rework-203",
      name: "203동 2층 재시공",
      activityName: "203동 재시공",
      siteDisplayText: "203동 2층 재시공",
      categoryMajor: "내장공사",
      categoryMiddle1: "보수공사",
      categoryMiddle2: "재시공",
      categorySmall: "203동",
      companyName: "내장팀",
      assignee: "모델러",
      color: "#EF4444",
      startOffset: 24,
      durationDays: 3,
      progress: 0,
    },
  ];

  const actualTasks = [] as Array<{
    id: string;
    projectId: string;
    parentTaskId: string | null;
    name: string;
    activityName: string | null;
    categoryMajor: string | null;
    categoryMiddle1: string | null;
    categoryMiddle2: string | null;
    categorySmall: string | null;
    companyId: string | null;
    siteMainCategory: string | null;
    siteDisplayText: string | null;
    categoryMiddle: string | null;
    categoryMinor: string | null;
    wbsCode: string | null;
    startDate: string;
    endDate: string;
    durationDays: number;
    progress: number;
    assignee: string | null;
    color: string;
    isMilestone: boolean;
    notes: string | null;
    sortOrder: number;
  }>;

  for (const [index, seed] of actualTaskSeeds.entries()) {
    const dates = createTaskDates(projectStart, seed.startOffset, seed.durationDays, projectHolidayKeys);
    const created = await prisma.task.create({
      data: {
        id: seed.id,
        projectId: project.id,
        name: seed.activityName ?? seed.name,
        activityName: seed.activityName ?? seed.name,
        categoryMajor: seed.categoryMajor,
        categoryMiddle1: seed.categoryMiddle1,
        categoryMiddle2: seed.categoryMiddle2,
        categorySmall: seed.categorySmall,
        siteMainCategory: seed.siteMainCategory ?? seed.categoryMajor,
        siteDisplayText: seed.siteDisplayText ?? seed.activityName ?? seed.name,
        companyId: seed.companyName ? companyIdByName.get(seed.companyName) ?? null : null,
        categoryMiddle: seed.categoryMiddle1,
        categoryMinor: seed.categoryMiddle2,
        startDate: dates.startDate,
        endDate: dates.endDate,
        durationDays: seed.durationDays,
        progress: seed.progress,
        assignee: seed.assignee ?? null,
        color: seed.color,
        isMilestone: false,
        notes: null,
        sortOrder: index,
      },
    });

    actualTasks.push({
      id: created.id,
      projectId: created.projectId,
      parentTaskId: created.parentTaskId,
      name: created.name,
      activityName: created.activityName,
      categoryMajor: created.categoryMajor,
      categoryMiddle1: created.categoryMiddle1,
      categoryMiddle2: created.categoryMiddle2,
      categorySmall: created.categorySmall,
      companyId: created.companyId,
      siteMainCategory: created.siteMainCategory,
      siteDisplayText: created.siteDisplayText,
      categoryMiddle: created.categoryMiddle,
      categoryMinor: created.categoryMinor,
      wbsCode: created.wbsCode,
      startDate: created.startDate.toISOString(),
      endDate: created.endDate.toISOString(),
      durationDays: created.durationDays,
      progress: created.progress,
      assignee: created.assignee,
      color: created.color,
      isMilestone: created.isMilestone,
      notes: created.notes,
      sortOrder: created.sortOrder,
    });
  }

  const dependencySeeds = [
    ["act-201-meok", "act-203-plaster"],
    ["act-202-meok", "act-203-plaster"],
    ["act-pc-zone", "act-205-masonry"],
    ["act-205-masonry", "act-201-gypsum"],
    ["act-201-gypsum", "act-203-pl-window"],
    ["act-202-gypsum", "act-204-pl-window"],
    ["act-203-pl-window", "act-205-door"],
    ["act-205-door", "act-206-paint"],
    ["act-203-plaster", "act-201-concrete"],
    ["act-201-concrete", "act-201-b1-waterproof"],
  ] as const;

  for (const [predecessorTaskId, successorTaskId] of dependencySeeds) {
    await prisma.dependency.create({
      data: {
        projectId: project.id,
        predecessorTaskId,
        successorTaskId,
        type: "FS",
        lagDays: 0,
      },
    });
  }

  const dbDependencies = await prisma.dependency.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "asc" },
  });

  const projectEnd = actualTasks.reduce((max, task) => {
    const date = new Date(task.endDate);
    return !max || date.getTime() > max.getTime() ? date : max;
  }, null as Date | null);

  if (projectEnd) {
    await prisma.project.update({
      where: { id: project.id },
      data: { endDate: projectEnd },
    });
  }

  const buildSnapshot = (tasks: typeof actualTasks, dependencies: Array<{ predecessorTaskId: string; successorTaskId: string; type: string; lagDays: number }>) => ({
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      startDate: project.startDate.toISOString(),
      endDate: projectEnd?.toISOString() ?? null,
    },
    calendar: { ...defaultCalendar },
    tasks: tasks.map((task) => ({
      id: task.id,
      name: task.activityName ?? task.name,
      activityName: task.activityName ?? task.name,
      categoryMajor: task.categoryMajor,
      categoryMiddle1: task.categoryMiddle1,
      categoryMiddle2: task.categoryMiddle2,
      categorySmall: task.categorySmall,
      companyId: task.companyId,
      siteMainCategory: task.siteMainCategory,
      siteDisplayText: task.siteDisplayText,
      categoryMiddle: task.categoryMiddle,
      categoryMinor: task.categoryMinor,
      wbsCode: task.wbsCode,
      parentTaskId: task.parentTaskId,
      startDate: task.startDate,
      endDate: task.endDate,
      durationDays: task.durationDays,
      progress: task.progress,
      assignee: task.assignee,
      color: task.color,
      isMilestone: task.isMilestone,
      notes: task.notes,
      sortOrder: task.sortOrder,
    })),
    dependencies: dependencies.map((dependency) => ({
      predecessorTaskId: dependency.predecessorTaskId,
      successorTaskId: dependency.successorTaskId,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
  });

  const actualSnapshot = buildSnapshot(
    actualTasks,
    dbDependencies.map((dependency) => ({
      predecessorTaskId: dependency.predecessorTaskId,
      successorTaskId: dependency.successorTaskId,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
  );

  const planTasks = actualTasks
    .filter((task) => task.id !== "act-rework-203")
    .map((task) => {
      const shift = task.id.startsWith("act-203-pl-window") || task.id.startsWith("act-204-pl-window") ? -4 : -2;
      const shifted = shiftTaskDates(task, shift, projectHolidayKeys);
      return {
        ...task,
        startDate: shifted.startDate,
        endDate: shifted.endDate,
        progress: 0,
      };
    });

  planTasks.push({
    id: "plan-207-masonry",
    projectId: project.id,
    parentTaskId: null,
    name: "207동 4층 조적쌓기",
    activityName: "207동 4층 조적",
    categoryMajor: "습식공사",
    categoryMiddle1: "조적공사",
    categoryMiddle2: "층별시공",
    categorySmall: "조적공사",
    companyId: companyIdByName.get("조적팀") ?? null,
    siteMainCategory: "습식공사",
    siteDisplayText: "207동 4층 조적쌓기",
    categoryMiddle: "조적공사",
    categoryMinor: "층별시공",
    wbsCode: null,
    startDate: addBusinessDays(projectStart, 10, projectHolidayKeys).toISOString(),
    endDate: addBusinessDays(projectStart, 14, projectHolidayKeys).toISOString(),
    durationDays: 5,
    progress: 0,
    assignee: "최성배",
    color: "#16A34A",
    isMilestone: false,
    notes: null,
    sortOrder: 999,
  });

  const planDependencies = [
    ...dbDependencies
      .filter((dependency) => dependency.predecessorTaskId !== "act-rework-203" && dependency.successorTaskId !== "act-rework-203")
      .map((dependency) => ({
        predecessorTaskId: dependency.predecessorTaskId,
        successorTaskId: dependency.successorTaskId,
        type: dependency.type,
        lagDays: dependency.lagDays,
      })),
    {
      predecessorTaskId: "act-207-masonry",
      successorTaskId: "plan-207-masonry",
      type: "FS",
      lagDays: 0,
    },
  ];

  const planSnapshot = buildSnapshot(planTasks, planDependencies);

  await prisma.projectVersion.create({
    data: {
      projectId: project.id,
      versionType: "PLAN",
      versionNo: 1,
      title: "초기계획 1월 기준",
      description: "월간/주간 현장 공정표 기준선 데모",
      createdBy: "system",
      snapshotJson: JSON.stringify(planSnapshot),
      taskCount: planSnapshot.tasks.length,
      dependencyCount: planSnapshot.dependencies.length,
    },
  });

  await prisma.projectVersion.create({
    data: {
      projectId: project.id,
      versionType: "ACTUAL",
      versionNo: 1,
      title: "실적 1월 4주차",
      description: "지연, 재시공, 공종 재배치가 포함된 실적 데모",
      createdBy: "system",
      snapshotJson: JSON.stringify(actualSnapshot),
      taskCount: actualSnapshot.tasks.length,
      dependencyCount: actualSnapshot.dependencies.length,
    },
  });

  console.log(`Seed completed: ${project.name}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
