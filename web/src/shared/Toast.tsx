import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import clsx from "clsx";

/**
 * Toasts. Every action that changes something says so.
 *
 * Silence after a destructive click is the most common way an operations tool
 * loses a user'\''s trust - they cannot tell whether it worked, so they click again.
 */

type Tone = "info" | "ok" | "warn" | "danger";
type Toast = { id: number; tone: Tone; message: string };

const Ctx = createContext<(message: string, tone?: Tone) => void>(() => {});
export const useToast = () => useContext(Ctx);

const TONES: Record<Tone, string> = {
  info: "bg-paper-raised text-ink",
  ok: "bg-ok-pale text-ok border-ok",
  warn: "bg-warn-pale text-warn border-warn",
  danger: "bg-danger-pale text-danger border-danger",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Tone = "info") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, tone, message }]);
    setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), 4200);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      {/* aria-live so a screen reader announces the same thing sighted users see. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "rule pointer-events-auto flex items-start gap-2 p-2.5 shadow-hard",
              TONES[t.tone],
            )}
          >
            <span className="min-w-0 flex-1 text-sm break-words">
              {t.message}
            </span>
            <button
              onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
              aria-label="Dismiss"
              className="shrink-0 opacity-60 hover:opacity-100"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
