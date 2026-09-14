// Minimal toast manager — built on Radix Toast. The ToasterProvider mounts
// the viewport; useToast() exposes a fire-and-forget `toast()` function.
import * as React from "react";
import type { ToastActionElement, ToastProps } from "@/components/ui/toast";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider as Provider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";

type ToastOptions = {
  id?: string;
  title?: string;
  description?: React.ReactNode;
  variant?: ToastProps["variant"];
  duration?: number;
  action?: ToastActionElement;
};

type State = { toasts: (ToastOptions & { id: string })[] };

const ToastContext = React.createContext<{
  toast: (opts: ToastOptions) => void;
  dismiss: (id: string) => void;
} | null>(null);

let counter = 0;
const genId = () => `t-${Date.now()}-${counter++}`;

export function ToasterProvider({ children = null }: { children?: React.ReactNode }) {
  const [state, setState] = React.useState<State>({ toasts: [] });

  const dismiss = React.useCallback((id: string) => {
    setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }, []);

  const toast = React.useCallback(
    (opts: ToastOptions) => {
      const id = opts.id ?? genId();
      setState((s) => ({ toasts: [...s.toasts, { ...opts, id }] }));
      return id;
    },
    []
  );

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      <Provider swipeDirection="right" duration={5000}>
        {children}
        {state.toasts.map((t) => (
          <Toast
            key={t.id}
            variant={t.variant}
            duration={t.duration}
            onOpenChange={(open) => {
              if (!open) dismiss(t.id);
            }}
          >
            <div className="grid gap-1">
              {t.title && <ToastTitle>{t.title}</ToastTitle>}
              {t.description && <ToastDescription>{t.description}</ToastDescription>}
            </div>
            {t.action}
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToasterProvider");
  return ctx;
}
