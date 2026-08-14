import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROXY_SETTINGS,
  normalizeProxySettings,
  proxySettingsError,
} from "./proxySettings";

describe("proxySettings", () => {
  it("normalizes missing fields", () => {
    expect(normalizeProxySettings(undefined)).toEqual(DEFAULT_PROXY_SETTINGS);
    expect(
      normalizeProxySettings({
        enabled: true,
        proxyType: "http",
        host: " 127.0.0.1 ",
        port: 11080,
        authEnabled: true,
        username: " alice ",
        password: " secret ",
      }),
    ).toEqual({
      enabled: true,
      proxyType: "http",
      host: "127.0.0.1",
      port: 11080,
      authEnabled: true,
      username: "alice",
      password: " secret ",
    });
  });

  it("rejects invalid type and port", () => {
    expect(normalizeProxySettings({ proxyType: "ftp" as never, port: 99999 }).proxyType).toBe(
      "socks5",
    );
    expect(normalizeProxySettings({ port: -1 }).port).toBe(0);
  });

  it("validates enabled proxy", () => {
    const messages = {
      hostRequired: "host",
      portRequired: "port",
      usernameRequired: "user",
    };
    expect(proxySettingsError(DEFAULT_PROXY_SETTINGS, messages)).toBeNull();
    expect(
      proxySettingsError({ ...DEFAULT_PROXY_SETTINGS, enabled: true }, messages),
    ).toBe("host");
    expect(
      proxySettingsError(
        { ...DEFAULT_PROXY_SETTINGS, enabled: true, host: "127.0.0.1" },
        messages,
      ),
    ).toBe("port");
    expect(
      proxySettingsError(
        {
          ...DEFAULT_PROXY_SETTINGS,
          enabled: true,
          host: "127.0.0.1",
          port: 11080,
          authEnabled: true,
        },
        messages,
      ),
    ).toBe("user");
    expect(
      proxySettingsError(
        {
          ...DEFAULT_PROXY_SETTINGS,
          enabled: true,
          host: "127.0.0.1",
          port: 11080,
        },
        messages,
      ),
    ).toBeNull();
  });
});
