"use client";

import { useState, useEffect } from "react";

export type AuthUser = {
  userId: string;
  username: string;
  role: "ADMIN" | "USER";
};

export function useAuthSession(): {
  user: AuthUser | null;
  isLoggedIn: boolean;
  isLoading: boolean;
} {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          return res.json().then((data) => {
            if (
              data &&
              typeof data.userId === "string" &&
              typeof data.username === "string" &&
              (data.role === "ADMIN" || data.role === "USER")
            ) {
              setUser({
                userId: data.userId,
                username: data.username,
                role: data.role,
              });
            } else {
              setUser(null);
            }
          });
        }
        setUser(null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    user,
    isLoggedIn: user !== null,
    isLoading,
  };
}
