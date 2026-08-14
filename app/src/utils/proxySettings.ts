import type { ProxySettings, ProxyType } from "../model/skill";

export const PROXY_TYPE_OPTIONS: ProxyType[] = ["http", "https", "socks5"];

export const DEFAULT_PROXY_SETTINGS: ProxySettings = {
  enabled: false,
  proxyType: "socks5",
  host: "",
  port: 0,
  authEnabled: false,
  username: "",
  password: "",
};

export function normalizeProxySettings(
  proxy?: Partial<ProxySettings> | null,
): ProxySettings {
  const type = proxy?.proxyType;
  const port = Number(proxy?.port);
  return {
    enabled: Boolean(proxy?.enabled),
    proxyType: type === "http" || type === "https" || type === "socks5" ? type : "socks5",
    host: proxy?.host?.trim() ?? "",
    port: Number.isFinite(port) && port > 0 && port <= 65535 ? Math.floor(port) : 0,
    authEnabled: Boolean(proxy?.authEnabled),
    username: proxy?.username?.trim() ?? "",
    password: proxy?.password ?? "",
  };
}

export function proxySettingsError(
  proxy: ProxySettings,
  messages: {
    hostRequired: string;
    portRequired: string;
    usernameRequired: string;
  },
): string | null {
  if (!proxy.enabled) return null;
  if (!proxy.host.trim()) return messages.hostRequired;
  if (proxy.port < 1 || proxy.port > 65535) return messages.portRequired;
  if (proxy.authEnabled && !proxy.username.trim()) return messages.usernameRequired;
  return null;
}
