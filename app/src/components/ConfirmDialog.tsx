import { useEffect, useRef, type ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  busy: boolean;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  tone = "default",
  busy,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    // 危险操作默认聚焦「取消」，降低误确认风险
    (tone === "danger" ? cancelRef : confirmRef).current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel, open, tone]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4">
      <div
        className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h2 id="confirm-dialog-title" className="m-0 text-[16px] font-semibold text-ink">
          {title}
        </h2>
        <p className="mt-2 text-[13px] leading-6 text-ink-2">{message}</p>
        {children ? <div className="mt-3">{children}</div> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink hover:bg-hover disabled:opacity-55"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            ref={confirmRef}
            className={
              tone === "danger"
                ? "rounded-lg bg-red-600 px-3 py-1.5 text-[13px] text-white hover:bg-red-700 disabled:opacity-55"
                : "rounded-lg bg-brand px-3 py-1.5 text-[13px] text-white hover:bg-blue-700 disabled:opacity-55"
            }
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
