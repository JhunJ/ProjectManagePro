import type { DependencyType } from "@/types/domain";

const DEPENDENCY_TYPE_SET: ReadonlySet<DependencyType> = new Set(["FS", "SS", "FF", "SF"]);

export function isDependencyType(value: string): value is DependencyType {
  return DEPENDENCY_TYPE_SET.has(value as DependencyType);
}

export function toDependencyType(value: string): DependencyType {
  return isDependencyType(value) ? value : "FS";
}
