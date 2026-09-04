export type FilterTableStatus = "queued" | "active" | "completed" | "error";
export type ThinkingStatus = "queued" | "converting" | "transcribing" | "completed" | "error";

export function isActiveTranscriptionStatus(status: string): boolean {
  return status === "queued" || status === "converting" || status === "transcribing";
}

export function toThinkingStatus(status: string): ThinkingStatus {
  if (
    status === "queued" ||
    status === "converting" ||
    status === "transcribing" ||
    status === "completed" ||
    status === "error"
  ) {
    return status;
  }
  return "queued";
}

export function toFilterStatus(status: string): FilterTableStatus {
  if (status === "queued") return "queued";
  if (status === "converting" || status === "transcribing") return "active";
  if (status === "error") return "error";
  return "completed";
}
