import { businessDaysBetween } from "@/server/schedulers/business-days";
import type { DependencyType } from "@/types/domain";
import type { WorkingCalendarConfig } from "@/server/schedulers/business-days";

export interface TaskDates {
  startDate: string;
  endDate: string;
}

/** 프로젝트 관리: FS 대신 SS/FF/SF를 쓰려면, 그 타입의 |lag|가 FS보다 이 값(영업일) 이상 작아야 함 */
const FS_PREFERENCE_THRESHOLD_DAYS = 2;

/**
 * 기존 선행/후행 작업의 일자를 기준으로 FS, SS, FF, SF 및 LAG/LEAD를 추천합니다.
 * 재계산 엔진(dependency-recalc)과 동일한 정의를 사용해, 추천값을 그대로 저장해도
 * 기존 일정이 밀리지 않도록 합니다.
 *
 * - FS: successor_start = addBusinessDays(predEnd, lagDays+1) → lagDays = (predEnd~succStart 영업일 수) - 2
 * - SS: successor_start = addBusinessDays(predStart, lagDays) → lagDays = (predStart~succStart 영업일 수) - 1
 * - FF/SF: 동일 방식으로 end 기준 영업일 차이 - 1
 *
 * lagDays >= 0 → Lag, lagDays < 0 → Lead
 */
export function inferDependencyFromTaskDates(
  predecessor: TaskDates,
  successor: TaskDates,
  calendar: WorkingCalendarConfig,
): { type: DependencyType; lagDays: number } {
  const predStart = predecessor.startDate;
  const predEnd = predecessor.endDate;
  const succStart = successor.startDate;
  const succEnd = successor.endDate;

  // recalc와 동일: FS는 addBusinessDays(predEnd, lagDays+1), SS는 addBusinessDays(predStart, lagDays) 등
  const fsLag = businessDaysBetween(predEnd, succStart, calendar) - 2;
  const ssLag = businessDaysBetween(predStart, succStart, calendar) - 1;
  const ffLag = businessDaysBetween(predEnd, succEnd, calendar) - 1;
  const sfLag = businessDaysBetween(predStart, succEnd, calendar) - 1;

  const candidates: Array<{ type: DependencyType; lagDays: number }> = [
    { type: "FS", lagDays: fsLag },
    { type: "SS", lagDays: ssLag },
    { type: "FF", lagDays: ffLag },
    { type: "SF", lagDays: sfLag },
  ];

  const abs = (n: number) => Math.abs(n);
  const fsAbs = abs(fsLag);

  // SS/FF/SF 중 |lag| 최소인 타입
  const nonFS = candidates.filter((c) => c.type !== "FS");
  const bestNonFS = nonFS.reduce((a, b) => (abs(a.lagDays) <= abs(b.lagDays) ? a : b));
  const minNonFSAbs = abs(bestNonFS.lagDays);

  // 다른 타입이 FS보다 임계값(영업일) 이상 더 잘 맞을 때만 SS/FF/SF 추천
  if (minNonFSAbs <= fsAbs - FS_PREFERENCE_THRESHOLD_DAYS) {
    return bestNonFS;
  }
  return { type: "FS", lagDays: fsLag };
}
