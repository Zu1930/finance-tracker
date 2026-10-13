"use client";

import { useSyncExternalStore } from "react";

const NARROW = "(max-width: 639px)";
/** На узких экранах шкала короче, чтобы влезть в 360px без горизонтального скролла */
const NARROW_WIDTH = 16;

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const isNarrow = () => window.matchMedia(NARROW).matches;
/** true на экранах уже 640px */
export const useNarrow = () => useSyncExternalStore(subscribe, isNarrow, () => false);

type Props = {
  value: number;
  max: number;
  /** Ширина шкалы в символах на широких экранах */
  width?: number;
  /** limit: STABLE / WARNING / OVERLOAD; goal: COLLECTING / COMPLETE */
  variant?: "limit" | "goal";
  label: string;
};

/** [████████░░░░░░] 62% - STABLE */
export function AsciiBar({ value, max, width = 32, variant = "limit", label }: Props) {
  const narrow = useNarrow();
  const w = narrow ? Math.min(width, NARROW_WIDTH) : width;
  const pct = max > 0 ? (value / max) * 100 : value > 0 ? Infinity : 0;
  const shown = Number.isFinite(pct) ? Math.round(pct) : 100;
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * w);

  let status: string, tone = "";
  if (variant === "goal") status = pct >= 100 ? "COMPLETE" : "COLLECTING";
  else if (pct > 100) [status, tone] = ["OVERLOAD", "text-bad"];
  else if (pct >= 80) [status, tone] = ["WARNING", "text-warn"];
  else status = "STABLE";

  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(100, shown)} aria-valuenow={shown}
      aria-valuetext={`${shown}% ${status}`} className="flex flex-wrap items-baseline gap-x-2 whitespace-pre">
      <span aria-hidden="true">
        [<span className="text-ink">{"█".repeat(filled)}</span><span className="text-dim">{"░".repeat(w - filled)}</span>]
      </span>
      <span aria-hidden="true" className={tone}>{shown}% - {status}</span>
    </div>
  );
}
