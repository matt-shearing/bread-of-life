/**
 * Small, self-contained safety helpers:
 *
 *  - `useConfirm()` — an in-tree Radix confirm dialog you can `await`. Render the
 *    returned `confirmElement` inside whatever dialog or page asks, so Radix nests
 *    it as the top layer (Escape and outside taps then close only the confirm).
 *  - `showUndoToast()` — an imperative "Done · Undo" toast. It mounts its own tiny
 *    React root on first use, so no provider has to be added to the app shell.
 *  - `useBackGuard()` — lets a modal claim the Android back button (and browser
 *    Back) so it closes the modal instead of leaving the page underneath.
 *
 * Kept deliberately independent of `ui.tsx` beyond Button/Dialog so it can later be
 * folded into the shared primitives without untangling anything.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Undo2, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

/* ---------------------------------- confirm ----------------------------------- */

export type ConfirmResult = "confirm" | "extra" | "cancel";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Paint the confirm button as destructive (delete, discard). */
  destructive?: boolean;
  /** An optional third choice, e.g. "Discard" beside "Save" / "Keep editing". */
  extraLabel?: string;
  extraDestructive?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (r: ConfirmResult) => void;
}

/**
 * `const { confirm, confirmElement } = useConfirm();`
 * `if ((await confirm({ title: "Delete?" })) === "confirm") …`
 */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<ConfirmResult>((resolve) => {
        setPending({ ...opts, resolve });
      }),
    [],
  );

  const settle = (r: ConfirmResult) => {
    pending?.resolve(r);
    setPending(null);
  };

  const confirmElement = pending ? (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && settle("cancel")}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/40 animate-fade-in" />
        <DialogPrimitive.Content
          role="alertdialog"
          data-testid="confirm-dialog"
          className="fixed left-1/2 top-1/2 z-[70] grid w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 gap-3 rounded-lg border border-border bg-card p-5 shadow-xl animate-fade-in"
          onOpenAutoFocus={(e) => {
            // Focus the safe choice first, never the destructive one.
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-safe]")?.focus();
          }}
        >
          <DialogPrimitive.Title className="text-base font-semibold">{pending.title}</DialogPrimitive.Title>
          {pending.description ? (
            <DialogPrimitive.Description className="text-sm text-muted-foreground">
              {pending.description}
            </DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{pending.title}</DialogPrimitive.Description>
          )}
          <div className="mt-1 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" data-safe className={COARSE_H} onClick={() => settle("cancel")}>
              {pending.cancelLabel ?? "Cancel"}
            </Button>
            {pending.extraLabel && (
              <Button
                variant="outline"
                className={cn(COARSE_H, pending.extraDestructive && "text-destructive")}
                onClick={() => settle("extra")}
              >
                {pending.extraLabel}
              </Button>
            )}
            <Button
              variant={pending.destructive ? "destructive" : "primary"}
              className={COARSE_H}
              onClick={() => settle("confirm")}
            >
              {pending.confirmLabel ?? "OK"}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  ) : null;

  return { confirm, confirmElement };
}

/** 44px tall on touch screens; unchanged with a mouse. */
export const COARSE_H = "[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-h-[44px]";

/* --------------------------------- undo toast --------------------------------- */

export interface ToastOptions {
  message: string;
  /** Called if the user taps Undo before the toast times out. */
  onUndo?: () => void | Promise<void>;
  undoLabel?: string;
  /** Milliseconds before the toast goes away (default 6s; 8s with an undo). */
  duration?: number;
}

interface ToastState extends ToastOptions {
  id: number;
}

let toast: ToastState | null = null;
let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let mounted = false;

function dismissToast(id?: number) {
  if (id !== undefined && toast?.id !== id) return;
  toast = null;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  emit();
}

function ensureMounted() {
  if (mounted || typeof document === "undefined") return;
  mounted = true;
  const host = document.createElement("div");
  host.setAttribute("data-bol-toast-root", "");
  document.body.appendChild(host);
  createRoot(host).render(<ToastHost />);
}

/** Show a short confirmation, optionally with Undo. Replaces any toast already showing. */
export function showUndoToast(opts: ToastOptions): void {
  ensureMounted();
  if (toastTimer) clearTimeout(toastTimer);
  const id = ++toastSeq;
  toast = { ...opts, id };
  emit();
  const ms = opts.duration ?? (opts.onUndo ? 8000 : 5000);
  toastTimer = setTimeout(() => dismissToast(id), ms);
}

function ToastHost() {
  const t = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toast,
  );
  if (!t) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-6"
      style={{ pointerEvents: "none" }}
    >
      <div
        role="status"
        aria-live="polite"
        data-testid="undo-toast"
        className="flex max-w-md items-center gap-2 rounded-lg bg-foreground py-1.5 pl-4 pr-1.5 text-sm text-background shadow-xl animate-fade-in"
        style={{ pointerEvents: "auto" }}
      >
        <span className="min-w-0 flex-1 py-1.5">{t.message}</span>
        {t.onUndo && (
          <button
            type="button"
            onClick={async () => {
              dismissToast(t.id);
              await t.onUndo?.();
            }}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md px-3 font-semibold text-primary-300 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 dark:text-primary-700 dark:hover:bg-black/10 [@media(pointer:coarse)]:min-h-[44px]"
          >
            <Undo2 size={15} /> {t.undoLabel ?? "Undo"}
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => dismissToast(t.id)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md opacity-70 hover:bg-white/10 hover:opacity-100 dark:hover:bg-black/10 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

/* --------------------------------- back guard --------------------------------- */

/*
 * One shared same-URL history entry ("the guard") sits on top while any guarded
 * modal is open; a stack of handlers decides what Back does. Sharing one entry
 * (rather than one per modal) keeps nested modals, mode switches and React
 * StrictMode's mount-unmount-mount from racing history.back() against pushState.
 */
type GuardHandler = { current: () => boolean | void };
const guardStack: GuardHandler[] = [];
let guardOnTop = false;
let ignoreNextPop = false;
let guardListening = false;

function pushGuard() {
  window.history.pushState({ ...(window.history.state ?? {}), __bolGuard: true }, "");
  guardOnTop = true;
}

function onGuardPop() {
  if (ignoreNextPop) {
    ignoreNextPop = false;
    return;
  }
  if (window.history.state?.__bolGuard) return; // moved forward onto a guard entry
  guardOnTop = false;
  const top = guardStack[guardStack.length - 1];
  if (!top) return;
  const keep = top.current();
  // Re-arm for this modal (it asked to stay) or for any modal still open below it.
  setTimeout(() => {
    if (guardStack.length && !guardOnTop && (keep || guardStack[guardStack.length - 1] !== top)) pushGuard();
  }, 0);
}

/**
 * While `active`, the Android back gesture (and the browser's Back) calls `onBack`
 * instead of leaving the page. Return `true` from `onBack` to keep guarding — e.g.
 * when it opened an "unsaved changes?" confirm rather than closing.
 */
export function useBackGuard(active: boolean, onBack: () => boolean | void) {
  const cb = useRef(onBack);
  cb.current = onBack;

  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    if (!guardListening) {
      guardListening = true;
      window.addEventListener("popstate", onGuardPop);
    }
    const handler: GuardHandler = cb;
    guardStack.push(handler);
    if (!guardOnTop) pushGuard();
    return () => {
      const i = guardStack.lastIndexOf(handler);
      if (i >= 0) guardStack.splice(i, 1);
      // Closed normally: drop the guard entry once no modal needs it — but only if
      // it is still on top (the app may have navigated on from here).
      setTimeout(() => {
        if (guardStack.length || !guardOnTop) return;
        guardOnTop = false;
        if (window.history.state?.__bolGuard) {
          ignoreNextPop = true;
          window.history.back();
        }
      }, 0);
    };
  }, [active]);
}
