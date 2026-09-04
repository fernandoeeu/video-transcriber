"use client";

import { Check, ChevronDown, CircleAlert, Clock3 } from "lucide-react";
import { useState } from "react";

import type { TranscriptionWithQueue } from "../../core/transcription";
import { toThinkingStatus } from "./transcription-status";

export type ThinkingStatus = "queued" | "converting" | "transcribing" | "completed" | "error";

type StepState = "waiting" | "running" | "completed" | "error";

type PipelineStep = {
  key: string;
  label: string;
  meta?: string;
  progress?: number;
  state: StepState;
};

function StepIcon({ state }: { state: StepState }) {
  if (state === "completed")
    return <Check className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2.5} />;
  if (state === "error") return <CircleAlert className="size-3.5 shrink-0 text-destructive" />;
  if (state === "running") {
    return (
      <span
        className="size-3.5 shrink-0 rounded-full border-[1.5px] border-foreground/20 border-t-foreground/75"
        style={{ animation: "spin 700ms linear infinite" }}
      />
    );
  }
  return <Clock3 className="size-3.5 shrink-0 text-muted-foreground" />;
}

function buildSteps({
  status,
  progress,
  queuePosition,
  errorMessage,
}: {
  status: ThinkingStatus;
  progress?: number | null;
  queuePosition?: number | null;
  errorMessage?: string | null;
}): PipelineStep[] {
  const rank =
    status === "queued"
      ? 0
      : status === "converting"
        ? 1
        : status === "transcribing"
          ? 2
          : status === "completed"
            ? 3
            : 0;
  const activeKey =
    status === "error"
      ? null
      : status === "queued"
        ? "queue"
        : status === "converting"
          ? "convert"
          : "transcribe";

  const steps: PipelineStep[] = [
    {
      key: "queue",
      label: "Queued transcription",
      meta: queuePosition != null && queuePosition > 0 ? `position ${queuePosition}` : undefined,
      state: rank > 0 ? "completed" : activeKey === "queue" ? "running" : "waiting",
    },
    {
      key: "convert",
      label: "Convert audio to 16 kHz mono",
      meta: status === "converting" && progress != null ? `${progress}%` : undefined,
      progress: status === "converting" && progress != null ? progress : undefined,
      state: rank > 1 ? "completed" : activeKey === "convert" ? "running" : "waiting",
    },
    {
      key: "transcribe",
      label: "Transcribe with Whisper",
      meta: status === "transcribing" && progress != null ? `${progress}%` : undefined,
      progress: status === "transcribing" && progress != null ? progress : undefined,
      state:
        status === "completed" ? "completed" : activeKey === "transcribe" ? "running" : "waiting",
    },
  ];

  if (status === "error") {
    steps.push({ key: "error", label: errorMessage || "Transcription failed", state: "error" });
  }

  return steps;
}

/** Ported from Beautiful UI's Thinking trace, driven by the real transcription pipeline. */
function ThinkingState({ transcription }: { transcription: TranscriptionWithQueue }) {
  const status = toThinkingStatus(transcription.status);
  const { progress, queuePosition, errorMessage } = transcription;
  const working = status !== "completed" && status !== "error";
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const expanded = manualExpanded ?? working;
  const steps = buildSteps({ status, progress, queuePosition, errorMessage });
  const activeLabel =
    status === "queued"
      ? "Waiting in queue"
      : status === "converting"
        ? "Converting audio"
        : "Transcribing";
  const settledLabel = status === "completed" ? "Transcription completed" : "Transcription failed";
  const statusAnnouncement = working
    ? `${activeLabel}${progress != null ? `, ${progress}%` : ""}`
    : settledLabel;

  return (
    <div
      data-beautiful-ui
      data-slot="thinking-state"
      className="w-full rounded-xl bg-card p-3 shadow-card"
    >
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusAnnouncement}
      </span>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded((current) => !(current ?? working))}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-150 hover:bg-accent/80"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill={
            working
              ? "color-mix(in oklch, var(--foreground) 76%, var(--background))"
              : "var(--muted-foreground)"
          }
          aria-hidden="true"
        >
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        {working ? (
          <span
            className="bg-clip-text text-[13px] font-medium text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(90deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%)",
              backgroundSize: "200% 100%",
              animation: "shimmer-text 1.4s linear infinite",
            }}
          >
            {activeLabel}
          </span>
        ) : (
          <span
            className={`text-[13px] font-medium ${status === "error" ? "text-destructive" : "text-foreground/75"}`}
          >
            {settledLabel}
          </span>
        )}
        <ChevronDown
          className="ml-auto size-3.5 text-muted-foreground transition-transform duration-200 ease-out"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
        />
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr", opacity: expanded ? 1 : 0 }}
      >
        <div className="overflow-hidden">
          <div className="relative mt-1 ml-[5px] pl-4">
            <span aria-hidden className="absolute top-0 bottom-2 left-[3px] w-px bg-border" />
            <div className="flex flex-col gap-1 py-1">
              {steps.map((step, index) => (
                <div
                  key={step.key}
                  className="flex min-h-7 items-center gap-2 rounded-md px-1.5 py-0.5"
                  style={{
                    animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${index * 80}ms both`,
                  }}
                >
                  <StepIcon state={step.state} />
                  <span
                    className={`min-w-0 flex-1 text-[12.5px] ${step.state === "waiting" ? "text-muted-foreground" : step.state === "error" ? "text-destructive" : "font-medium text-foreground"}`}
                  >
                    {step.label}
                  </span>
                  {step.progress != null && (
                    <progress
                      className="sr-only"
                      aria-label={`${step.label} progress`}
                      max={100}
                      value={step.progress}
                    >
                      {step.progress}%
                    </progress>
                  )}
                  {step.meta && (
                    <span
                      aria-hidden="true"
                      className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground"
                    >
                      {step.meta}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { ThinkingState };
