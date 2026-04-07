export type DependencyType = "FS" | "SS" | "FF" | "SF";
export type ProjectVersionType = "PLAN" | "ACTUAL";
export type HolidayScope = "PROJECT" | "COMPANY";

export type ZoomLevel = "day" | "week" | "month";
export type PlannerViewMode = "GANTT" | "FIELD";
export type FieldScheduleScale = "WEEKLY" | "MONTHLY";

export interface ProjectModel {
  id: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
  /** 계정별 즐겨찾기 여부 (목록에서 즐겨찾기가 먼저 나옴) */
  isFavorite?: boolean;
}

export interface TaskModel {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  /** 나눈 뒤 이어지는 구간이면 루트 작업(행) id. null이면 목록 한 줄의 기준 작업. */
  timelineHeadTaskId: string | null;
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
  createdAt: string;
  updatedAt: string;
}

export type CategoryLevel = "major" | "middle1" | "middle2" | "small";

export interface CategoryPath {
  major: string;
  middle1: string;
  middle2: string;
  small: string;
}

export interface TaskListRowBase {
  rowId: string;
  rowType: "CATEGORY_ROW" | "ACTIVITY_ROW";
  depth: number;
  hasChildren: boolean;
  label: string;
}

export interface CategoryTaskListRow extends TaskListRowBase {
  rowType: "CATEGORY_ROW";
  level: CategoryLevel;
  categoryPath: CategoryPath;
  childCount: number;
}

export interface ActivityTaskListRow extends TaskListRowBase {
  rowType: "ACTIVITY_ROW";
  taskId: string;
  task: TaskModel;
  /** 같은 행에 표시할 후속 구간(중간 공백 = 작업 중단 표현) */
  timelineSegmentTasks?: TaskModel[];
}

export type TaskListRow = CategoryTaskListRow | ActivityTaskListRow;

export interface DependencyModel {
  id: string;
  projectId: string;
  predecessorTaskId: string;
  successorTaskId: string;
  type: DependencyType;
  lagDays: number;
  /** true면 선행 작업 변경 시 후행 일정 자동 재계산. false면 연결만 표시하고 수동 편집 일정 유지 */
  drivesSchedule?: boolean;
  createdAt: string;
}

export interface CompanyModel {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface HolidayModel {
  id: string;
  projectId: string;
  scope: HolidayScope;
  companyId: string | null;
  name: string | null;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkingCalendarModel {
  id: string;
  projectId: string;
  workMon: boolean;
  workTue: boolean;
  workWed: boolean;
  workThu: boolean;
  workFri: boolean;
  workSat: boolean;
  workSun: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectVersionSnapshot {
  schemaVersion: number;
  capturedAt: string;
  project: {
    id: string;
    name: string;
    description: string | null;
    startDate: string;
    endDate: string | null;
  };
  calendar: Pick<
    WorkingCalendarModel,
    "workMon" | "workTue" | "workWed" | "workThu" | "workFri" | "workSat" | "workSun"
  >;
  tasks: Array<{
    id: string;
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
    parentTaskId: string | null;
    timelineHeadTaskId: string | null;
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
  dependencies: Array<{
    predecessorTaskId: string;
    successorTaskId: string;
    type: DependencyType;
    lagDays: number;
  }>;
}

export interface ProjectVersionModel {
  id: string;
  projectId: string;
  versionType: ProjectVersionType;
  versionNo: number;
  title: string;
  description: string | null;
  createdBy: string;
  createdAt: string;
  taskCount: number;
  dependencyCount: number;
}

export interface ProjectVersionDetail extends ProjectVersionModel {
  snapshot: ProjectVersionSnapshot;
}

export type TaskDiffStatus = "ADDED" | "REMOVED" | "UPDATED" | "UNCHANGED";

export interface TaskCompareItem {
  key: string;
  status: TaskDiffStatus;
  before: TaskModel | null;
  after: TaskModel | null;
  changedFields: string[];
  scheduleDelta: {
    startDateBefore: string | null;
    startDateAfter: string | null;
    endDateBefore: string | null;
    endDateAfter: string | null;
    durationBefore: number | null;
    durationAfter: number | null;
    endDelayDays: number | null;
  } | null;
}

export interface DependencyCompareItem {
  key: string;
  before: {
    predecessorTaskId: string;
    successorTaskId: string;
    type: DependencyType;
    lagDays: number;
  } | null;
  after: {
    predecessorTaskId: string;
    successorTaskId: string;
    type: DependencyType;
    lagDays: number;
  } | null;
}

export interface ProjectVersionCompareResult {
  comparison: {
    planVersion: ProjectVersionModel;
    actualVersion: ProjectVersionModel;
  };
  summary: {
    added: number;
    removed: number;
    updated: number;
    unchanged: number;
    dependencyAdded: number;
    dependencyRemoved: number;
    dependencyChanged: number;
    calendarChanged: boolean;
  };
  tasks: TaskCompareItem[];
  dependenciesDiff: {
    added: DependencyCompareItem[];
    removed: DependencyCompareItem[];
    changed: DependencyCompareItem[];
  };
  calendarDiff: {
    changedFields: Array<keyof Pick<WorkingCalendarModel, "workMon" | "workTue" | "workWed" | "workThu" | "workFri" | "workSat" | "workSun">>;
    before: Pick<WorkingCalendarModel, "workMon" | "workTue" | "workWed" | "workThu" | "workFri" | "workSat" | "workSun">;
    after: Pick<WorkingCalendarModel, "workMon" | "workTue" | "workWed" | "workThu" | "workFri" | "workSat" | "workSun">;
  };
}

export interface ProjectSchedulePayload {
  project: ProjectModel;
  tasks: TaskModel[];
  dependencies: DependencyModel[];
  calendar: WorkingCalendarModel;
  companies: CompanyModel[];
  holidays: HolidayModel[];
}

export interface TaskTreeNode extends TaskModel {
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
}

export interface PersistedState {
  lastSavedAt: string | null;
  saving: boolean;
  error: string | null;
}
