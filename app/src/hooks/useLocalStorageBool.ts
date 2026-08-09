import { useEffect, useState } from "react";

/** 布尔值持久化到 localStorage，用于面板折叠等 UI 状态。 */
export function useLocalStorageBool(key: string, defaultValue = false) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) {
        return defaultValue;
      }
      return raw === "1" || raw === "true";
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, value ? "1" : "0");
    } catch {
      // ignore quota / private mode
    }
  }, [key, value]);

  return [value, setValue] as const;
}
