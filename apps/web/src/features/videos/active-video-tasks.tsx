import { Download, RefreshCw } from "lucide-react";
import { Button } from "@video-transcriber/ui/components/button";
import { TaskRows, type TaskRowItem } from "@video-transcriber/ui/components/task-rows";

import type { VideoMetadata } from "../../core/video";
import { DeleteVideoButton } from "./delete-video-button";
import type { VideoCommands } from "./video-commands";
import { formatVideoDuration, toDownloadTaskStatus } from "./video-view-model";

function ActiveVideoTasks({
  videos,
  commands,
  pendingVideoIds,
}: {
  videos: VideoMetadata[];
  commands: VideoCommands;
  pendingVideoIds: ReadonlySet<number>;
}) {
  const activeVideos = videos.filter((video) => video.status !== "downloaded");
  if (activeVideos.length === 0) return null;

  const rows: TaskRowItem[] = activeVideos.map((video) => ({
    id: String(video.id),
    label: video.title,
    meta:
      video.duration != null ? formatVideoDuration(video.duration) : (video.channel ?? undefined),
    status: toDownloadTaskStatus(video.status),
    progress: video.progress,
    details: [
      ...(video.channel ? [{ label: "Source", meta: video.channel }] : []),
      ...(video.duration != null
        ? [{ label: "Duration", meta: formatVideoDuration(video.duration) }]
        : []),
      ...(video.errorMessage ? [{ label: video.errorMessage, role: "alert" as const }] : []),
    ],
    action:
      video.status === "ready_to_download" ? (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            disabled={pendingVideoIds.has(video.id)}
            onClick={() => void commands.download(video.id)}
          >
            <Download data-icon="inline-start" />
            Download
          </Button>
          <DeleteVideoButton
            video={video}
            onDelete={commands.delete}
            disabled={pendingVideoIds.has(video.id)}
          />
        </div>
      ) : video.status === "error" ? (
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Retry download"
            disabled={pendingVideoIds.has(video.id)}
            onClick={() => void commands.redownload(video.id)}
          >
            <RefreshCw />
          </Button>
          <DeleteVideoButton
            video={video}
            onDelete={commands.delete}
            disabled={pendingVideoIds.has(video.id)}
          />
        </div>
      ) : null,
  }));

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Active</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{rows.length}</span>
      </div>
      <TaskRows rows={rows} />
    </section>
  );
}

export { ActiveVideoTasks };
