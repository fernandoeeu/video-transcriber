"use client";

import { Check, ChevronDown, Clock3, X } from "lucide-react";
import { useState, type ReactNode } from "react";

export type TaskRowStatus = "pending" | "running" | "completed" | "error";

export type TaskRowItem = {
  id: string;
  label: string;
  meta?: string;
  status: TaskRowStatus;
  progress?: number | null;
  details?: Array<{ label: string; meta?: string; role?: "alert" }>;
  action?: ReactNode;
};

function SpinnerRing({ progress, label }: Pick<TaskRowItem, "progress" | "label">) {
  const size = 24;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const determinate = progress != null;
  const value = Math.max(0, Math.min(progress ?? 0, 100));

  return (
    <>
      <progress
        aria-label={`Progress for ${label}`}
        className="sr-only"
        max={100}
        value={determinate ? value : undefined}
      />
      <span
        aria-hidden="true"
        className="relative inline-flex size-6 shrink-0 items-center justify-center"
      >
        <svg
          width={size}
          height={size}
          className="absolute inset-0"
          style={!determinate ? { animation: "spin 1.1s linear infinite" } : undefined}
        >
          <circle
            cx={12}
            cy={12}
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth={stroke}
          />
          <circle
            cx={12}
            cy={12}
            r={radius}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={
              determinate
                ? `${circumference * (value / 100)} ${circumference}`
                : `${circumference * 0.28} ${circumference * 0.72}`
            }
            transform="rotate(-90 12 12)"
          />
        </svg>
        {determinate && (
          <span className="relative text-[8px] font-semibold tabular-nums text-foreground">
            {Math.round(value)}
          </span>
        )}
      </span>
    </>
  );
}

function StatusIcon({
  status,
  progress,
  label,
}: Pick<TaskRowItem, "status" | "progress" | "label">) {
  if (status === "running") return <SpinnerRing progress={progress} label={label} />;

  const className =
    status === "completed"
      ? "bg-success"
      : status === "error"
        ? "bg-destructive"
        : "bg-secondary text-muted-foreground";

  return (
    <span
      className={`flex size-5.5 shrink-0 items-center justify-center rounded-full ${className}`}
      style={{ animation: "pop-in 300ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      {status === "completed" ? (
        <Check className="size-3.5 text-white" strokeWidth={3} />
      ) : status === "error" ? (
        <X className="size-3.5 text-white" strokeWidth={3} />
      ) : (
        <Clock3 className="size-3" />
      )}
    </span>
  );
}

function StatusPill({ status }: Pick<TaskRowItem, "status">) {
  const styles = {
    pending: "bg-secondary text-muted-foreground",
    running: "bg-muted text-foreground/75",
    completed: "bg-success/[12%] text-success",
    error: "bg-destructive/[12%] text-destructive",
  } as const;
  const labels = {
    pending: "Ready",
    running: "Running",
    completed: "Completed",
    error: "Failed",
  } as const;

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`inline-flex h-5.5 items-center rounded-full px-2 text-[11px] font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

/** Ported from Beautiful UI's live Task Rows, driven by real application state. */
function TaskRows({ rows }: { rows: TaskRowItem[] }) {
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});

  return (
    <div data-beautiful-ui data-slot="task-rows" className="flex w-full flex-col gap-2">
      {rows.map((row, index) => {
        const hasDetails = Boolean(row.details?.length);
        const open = manualOpen[row.id] ?? row.status === "running";

        return (
          <div
            key={row.id}
            className="self-stretch overflow-hidden bg-card shadow-card transition-[border-radius] duration-300 ease-out"
            style={{
              borderRadius: open && hasDetails ? 14 : 22,
              animation: `fade-up 450ms cubic-bezier(0.23,1,0.32,1) ${index * 80}ms both`,
            }}
          >
            <div className="flex min-h-11 items-center gap-1 px-2.5">
              <button
                type="button"
                aria-expanded={open}
                disabled={!hasDetails}
                onClick={() =>
                  hasDetails && setManualOpen((current) => ({ ...current, [row.id]: !open }))
                }
                className="flex min-w-0 flex-1 items-center gap-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="flex size-6 shrink-0 items-center justify-center">
                  <StatusIcon status={row.status} progress={row.progress} label={row.label} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                  {row.label}
                </span>
                {row.meta && (
                  <span className="hidden shrink-0 text-[12px] tabular-nums text-foreground/75 sm:inline">
                    {row.meta}
                  </span>
                )}
                <StatusPill status={row.status} />
                {hasDetails && (
                  <ChevronDown
                    className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out"
                    style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }}
                  />
                )}
              </button>
              {row.action && <div className="shrink-0 pl-1">{row.action}</div>}
            </div>

            {hasDetails && (
              <div
                className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
                style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
              >
                <div className="overflow-hidden">
                  <div className="mb-2.5 grid grid-cols-[24px_1fr] gap-2.5 px-2.5">
                    <span aria-hidden className="mx-auto h-full w-px bg-border" />
                    <div className="flex flex-col gap-1.5">
                      {row.details?.map((detail, detailIndex) => (
                        <div
                          key={`${row.id}-${detail.label}`}
                          className="flex items-center justify-between gap-3"
                          style={
                            open
                              ? {
                                  animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${120 + detailIndex * 80}ms both`,
                                }
                              : undefined
                          }
                        >
                          <span role={detail.role} className="text-xs text-foreground/75">
                            {detail.label}
                          </span>
                          {detail.meta && (
                            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                              {detail.meta}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export { TaskRows };
