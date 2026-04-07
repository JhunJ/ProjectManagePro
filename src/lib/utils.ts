import { type ClassValue, clsx } from "clsx";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ko } from "date-fns/locale";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toStartOfUtcDay(date: Date | string): Date {
  const source = typeof date === "string" ? new Date(date) : date;
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
}

export function formatDateKorean(date: Date | string, pattern = "yyyy.MM.dd") {
  const source = typeof date === "string" ? new Date(date) : date;
  return format(source, pattern, { locale: ko });
}

export function formatRelativeKorean(date: Date | string) {
  const source = typeof date === "string" ? new Date(date) : date;
  return `${formatDistanceToNowStrict(source, { addSuffix: true, locale: ko })}`;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** iPhone·iPad·iPod Safari(및 iPadOS 데스크톱 UA): 터치 제스처·메뉴 동작이 달라 별도 분기에 사용 */
export function isIOSTouchDevice(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const ua = navigator.userAgent;
  if (/iPhone|iPod|iPad/i.test(ua)) {
    return true;
  }
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) {
    return true;
  }
  return false;
}
