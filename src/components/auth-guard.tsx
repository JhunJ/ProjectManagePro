"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

const LOGIN_PATH = "/login";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  React.useEffect(() => {
    if (typeof window === "undefined" || !pathname) return;
    if (pathname === LOGIN_PATH) return;
    if (pathname.startsWith("/_next") || pathname.includes(".")) return;

    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => {
        if (!res.ok) {
          const from = encodeURIComponent(pathname);
          window.location.href = `${LOGIN_PATH}?from=${from}`;
        }
      })
      .catch(() => {
        const from = encodeURIComponent(pathname);
        window.location.href = `${LOGIN_PATH}?from=${from}`;
      });
  }, [pathname]);

  return <>{children}</>;
}
