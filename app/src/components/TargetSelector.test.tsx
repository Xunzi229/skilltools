import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { Provider } from "../model/skill";
import { TargetSelector } from "./TargetSelector";

function I18nWrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

function renderSelector(ui: Parameters<typeof render>[0]) {
  return render(ui, { wrapper: I18nWrapper });
}

describe("TargetSelector", () => {
  it("dirty 时显示取消与应用；取消只重置本地草稿", async () => {
    const onApply = vi.fn(async () => undefined);
    const user = userEvent.setup();
    renderSelector(<TargetSelector installedProviders={[]} onApply={onApply} />);

    await user.click(screen.getByRole("checkbox", { name: "安装到 Cursor" }));
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("checkbox", { name: "安装到 Cursor" })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "取消" })).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("installedProviders 数组引用变化但内容不变时保留脏态与取消", async () => {
    const onApply = vi.fn(async () => undefined);
    const user = userEvent.setup();
    const installed: Provider[] = ["claude"];
    const { rerender } = renderSelector(
      <TargetSelector installedProviders={installed} onApply={onApply} />,
    );

    await user.click(screen.getByRole("checkbox", { name: "安装到 Cursor" }));
    expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();

    rerender(
      <TargetSelector installedProviders={[...installed]} onApply={onApply} />,
    );

    expect(screen.getByRole("checkbox", { name: "安装到 Cursor" })).toBeChecked();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("checkbox", { name: "安装到 Cursor" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "安装到 Claude" })).toBeChecked();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("应用中取消仍可点击并只重置草稿", async () => {
    let resolveApply: (() => void) | undefined;
    const onApply = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveApply = resolve;
        }),
    );
    const user = userEvent.setup();
    renderSelector(<TargetSelector installedProviders={["cursor"]} onApply={onApply} />);

    await user.click(screen.getByRole("checkbox", { name: "安装到 Cursor" }));
    await user.click(screen.getByRole("button", { name: "应用" }));
    expect(screen.getByRole("button", { name: "应用中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("checkbox", { name: "安装到 Cursor" })).toBeChecked();
    resolveApply?.();
  });
});
