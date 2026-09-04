import type { TaskRowStatus } from "@video-transcriber/ui/components/task-rows";

export function formatVideoDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function toDownloadTaskStatus(status: string): TaskRowStatus {
  if (status === "downloading") return "running";
  if (status === "error") return "error";
  if (status === "downloaded") return "completed";
  return "pending";
}

export function formatVideoStatus(status: string): string {
  return status.replace(/_/g, " ");
}
