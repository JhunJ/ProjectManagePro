import { describe, expect, it } from "vitest";

import { DEFAULT_WORKING_CALENDAR } from "@/server/schedulers/business-days";
import {
  ScheduleCycleError,
  assertNoDependencyCycle,
  recalculateSuccessorTasks,
  type ScheduleDependency,
  type ScheduleTask,
} from "@/server/schedulers/dependency-recalc";

const makeTask = (id: string, start: string, end: string, durationDays: number): ScheduleTask => ({
  id,
  projectId: "p1",
  startDate: new Date(`${start}T00:00:00.000Z`),
  endDate: new Date(`${end}T00:00:00.000Z`),
  durationDays,
  isMilestone: false,
});

const fsDependency = (id: string, predecessorTaskId: string, successorTaskId: string): ScheduleDependency => ({
  id,
  predecessorTaskId,
  successorTaskId,
  type: "FS",
  lagDays: 0,
});

const typedDependency = (
  id: string,
  predecessorTaskId: string,
  successorTaskId: string,
  type: ScheduleDependency["type"],
  lagDays: number,
): ScheduleDependency => ({
  id,
  predecessorTaskId,
  successorTaskId,
  type,
  lagDays,
});

describe("dependency-recalc", () => {
  it("recalculates successors in FS chain", () => {
    const tasks: ScheduleTask[] = [
      makeTask("a", "2026-03-02", "2026-03-04", 3),
      makeTask("b", "2026-03-05", "2026-03-06", 2),
    ];

    tasks[0].startDate = new Date("2026-03-03T00:00:00.000Z");
    tasks[0].endDate = new Date("2026-03-05T00:00:00.000Z");

    const changed = recalculateSuccessorTasks({
      tasks,
      dependencies: [fsDependency("d1", "a", "b")],
      calendar: DEFAULT_WORKING_CALENDAR,
      anchorTaskIds: ["a"],
    });

    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe("b");
    expect(changed[0].startDate.toISOString().slice(0, 10)).toBe("2026-03-06");
  });

  it("throws cycle error", () => {
    const tasks: ScheduleTask[] = [
      makeTask("a", "2026-03-02", "2026-03-03", 2),
      makeTask("b", "2026-03-04", "2026-03-05", 2),
    ];

    const dependencies: ScheduleDependency[] = [
      fsDependency("d1", "a", "b"),
      fsDependency("d2", "b", "a"),
    ];

    expect(() => assertNoDependencyCycle(tasks, dependencies)).toThrowError(ScheduleCycleError);
  });

  it("applies signed lag/lead for FS", () => {
    const predecessor = makeTask("a", "2026-03-03", "2026-03-05", 3);
    const successor = makeTask("b", "2026-03-04", "2026-03-05", 2);
    const tasks = [predecessor, successor];

    const withLead = recalculateSuccessorTasks({
      tasks: tasks.map((task) => ({ ...task })),
      dependencies: [typedDependency("d1", "a", "b", "FS", -1)],
      calendar: DEFAULT_WORKING_CALENDAR,
      anchorTaskIds: ["a"],
    });
    expect(withLead[0].startDate.toISOString().slice(0, 10)).toBe("2026-03-05");

    const withLag = recalculateSuccessorTasks({
      tasks: tasks.map((task) => ({ ...task })),
      dependencies: [typedDependency("d2", "a", "b", "FS", 2)],
      calendar: DEFAULT_WORKING_CALENDAR,
      anchorTaskIds: ["a"],
    });
    expect(withLag[0].startDate.toISOString().slice(0, 10)).toBe("2026-03-10");
  });

  it("applies signed lag/lead for SS", () => {
    const tasks: ScheduleTask[] = [
      makeTask("a", "2026-03-10", "2026-03-12", 3),
      makeTask("b", "2026-03-05", "2026-03-06", 2),
    ];

    const changed = recalculateSuccessorTasks({
      tasks,
      dependencies: [typedDependency("d1", "a", "b", "SS", -1)],
      calendar: DEFAULT_WORKING_CALENDAR,
      anchorTaskIds: ["a"],
    });

    expect(changed).toHaveLength(1);
    expect(changed[0].startDate.toISOString().slice(0, 10)).toBe("2026-03-09");
  });

  it("applies signed lag/lead for FF", () => {
    const tasks: ScheduleTask[] = [
      makeTask("a", "2026-03-10", "2026-03-12", 3),
      makeTask("b", "2026-03-05", "2026-03-09", 3),
    ];

    const changed = recalculateSuccessorTasks({
      tasks,
      dependencies: [typedDependency("d1", "a", "b", "FF", -1)],
      calendar: DEFAULT_WORKING_CALENDAR,
      anchorTaskIds: ["a"],
    });

    expect(changed).toHaveLength(1);
    expect(changed[0].endDate.toISOString().slice(0, 10)).toBe("2026-03-11");
    expect(changed[0].startDate.toISOString().slice(0, 10)).toBe("2026-03-09");
  });

  it("applies signed lag/lead for SF", () => {
    const tasks: ScheduleTask[] = [
      makeTask("a", "2026-03-10", "2026-03-12", 3),
      makeTask("b", "2026-03-06", "2026-03-09", 2),
    ];

    const changed = recalculateSuccessorTasks({
      tasks,
      dependencies: [typedDependency("d1", "a", "b", "SF", 0)],
      calendar: DEFAULT_WORKING_CALENDAR,
      anchorTaskIds: ["a"],
    });

    expect(changed).toHaveLength(1);
    expect(changed[0].endDate.toISOString().slice(0, 10)).toBe("2026-03-10");
    expect(changed[0].startDate.toISOString().slice(0, 10)).toBe("2026-03-09");
  });
});
