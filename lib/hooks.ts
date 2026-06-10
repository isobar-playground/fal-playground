"use client";

import { useCallback, useEffect, useState } from "react";

type Storage = "local" | "session";

function read<T>(storage: Storage, key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = (storage === "local" ? window.localStorage : window.sessionStorage).getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function usePersistentState<T>(storage: Storage, key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);

  // Hydrate after mount to avoid SSR/client mismatch.
  useEffect(() => {
    setValue(read(storage, key, initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          const store = storage === "local" ? window.localStorage : window.sessionStorage;
          store.setItem(key, JSON.stringify(resolved));
        } catch {
          /* ignore quota / private-mode errors */
        }
        return resolved;
      });
    },
    [storage, key],
  );

  return [value, set] as const;
}

export const useLocalStorage = <T,>(key: string, initial: T) =>
  usePersistentState<T>("local", key, initial);

export const useSessionStorage = <T,>(key: string, initial: T) =>
  usePersistentState<T>("session", key, initial);
