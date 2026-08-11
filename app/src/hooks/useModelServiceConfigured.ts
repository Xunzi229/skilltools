import { useEffect, useState } from "react";
import type { SkillApi } from "../api/skillApi";
import { isModelServiceConfigured } from "../utils/translateSettings";

/**
 * 是否已配置「模型功能服务」。
 * 未配置时所有依赖模型的 UI 必须隐藏（返回 false → 组件 return null）。
 */
export function useModelServiceConfigured(api: SkillApi): boolean {
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getSettings()
      .then((settings) => {
        if (!cancelled) setConfigured(isModelServiceConfigured(settings));
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return configured;
}
