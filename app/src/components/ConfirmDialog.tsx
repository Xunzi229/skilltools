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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-[2px]">
      <div
        className="macos-sheet max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h2
          id="confirm-dialog-title"
          className="m-0 text-center text-[15px] font-semibold tracking-tight text-ink"
        >
          {title}
        </h2>
        <p className="mt-2 text-center text-[13px] leading-6 text-ink-2">{message}</p>
        {children ? <div className="mt-3">{children}</div> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            className="macos-btn-ghost h-8 px-3.5 text-[13px]"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            ref={confirmRef}
            className={
              tone === "danger"
                ? "macos-btn-danger h-8 px-3.5 text-[13px]"
                : "macos-btn-primary h-8 px-3.5 text-[13px]"
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
