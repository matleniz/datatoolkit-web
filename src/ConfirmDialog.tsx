import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface ConfirmRequest {
  title: string;
  message: string;
  /** Label of the destructive action (the safe action is always "Cancel"). */
  confirmLabel: string;
}

/**
 * Modal confirmation (replaces `window.confirm`): a native `<dialog>` opened
 * with `showModal()`, so focus stays inside, the page behind is inert and
 * Escape cancels. Focus starts on Cancel, the safe action.
 */
function ConfirmDialog({
  request,
  onAnswer,
}: {
  request: ConfirmRequest;
  onAnswer: (ok: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      opener?.focus?.();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      // Escape: keep the native close out of it, answer "no" ourselves.
      onCancel={(e) => {
        e.preventDefault();
        onAnswer(false);
      }}
      onClick={(e) => {
        e.stopPropagation();
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === ref.current) onAnswer(false);
      }}
    >
      <h2 id={titleId} className="confirm-title">
        {request.title}
      </h2>
      <p id={bodyId} className="confirm-body">
        {request.message}
      </p>
      <div className="confirm-actions">
        <button
          ref={cancelRef}
          type="button"
          className="btn-secondary"
          onClick={() => onAnswer(false)}
        >
          Cancel
        </button>
        <button type="button" className="btn-danger" onClick={() => onAnswer(true)}>
          {request.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/**
 * `confirm(request)` resolves true/false once the user answers; render `dialog`
 * once in the component. A new request cancels the one still open.
 */
export function useConfirm(): {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [open, setOpen] = useState<{
    request: ConfirmRequest;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const confirm = useCallback((request: ConfirmRequest) => {
    openRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => setOpen({ request, resolve }));
  }, []);

  // Unmounted with the dialog open: the caller must not wait forever.
  useEffect(() => () => openRef.current?.resolve(false), []);

  const dialog = open ? (
    <ConfirmDialog
      request={open.request}
      onAnswer={(ok) => {
        open.resolve(ok);
        setOpen(null);
      }}
    />
  ) : null;
  return { confirm, dialog };
}
