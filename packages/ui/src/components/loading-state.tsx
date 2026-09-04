"use client";

import { useEffect, useState } from "react";

const chevron = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, index) => {
  const position = ORBIT_ORDER.indexOf(index);
  return position === -1 ? null : position * 110;
});

const PATTERNS = {
  Drive: { delays: chevron, duration: 650, round: false },
  Dots: { delays: chevron, duration: 650, round: true },
  Orbit: { delays: orbit, duration: 950, round: false },
} as const;

export type LoadingStateVariant = keyof typeof PATTERNS;

function useElapsed() {
  const [deciseconds, setDeciseconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setDeciseconds((value) => value + 1), 100);
    return () => clearInterval(timer);
  }, []);

  const total = deciseconds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

/** Ported from Beautiful UI's Loading State, mapped to shadcn tokens. */
function LoadingState({
  label = "Working",
  variant = "Drive",
  className,
}: {
  label?: string;
  variant?: LoadingStateVariant;
  className?: string;
}) {
  const elapsed = useElapsed();
  const { delays, duration, round } = PATTERNS[variant];

  return (
    <div
      data-beautiful-ui
      data-slot="loading-state"
      className={`flex w-fit items-center gap-2.5 ${className ?? ""}`}
    >
      <span aria-hidden className="grid grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {delays.map((delay, index) => (
          <span
            key={index}
            className={`size-1 bg-foreground ${round ? "rounded-full" : "rounded-[1px]"}`}
            style={{
              opacity: delay === null ? 0.07 : 0.15,
              animation:
                delay === null ? "none" : `pixel-on ${duration}ms ease-in-out ${delay}ms infinite`,
            }}
          />
        ))}
      </span>
      <span
        role="status"
        className="bg-clip-text text-[13px] font-medium text-transparent"
        style={{
          backgroundImage:
            "linear-gradient(90deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%)",
          backgroundSize: "200% 100%",
          animation: "shimmer-text 1.4s linear infinite",
        }}
      >
        {label}
      </span>
      <span aria-hidden className="font-mono text-xs tabular-nums text-muted-foreground">
        {elapsed}
      </span>
    </div>
  );
}

export { LoadingState };
