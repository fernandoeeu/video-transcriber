import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@video-transcriber/ui/components/button";

import type { VideoMetadata } from "../../core/video";
import { DeleteVideoButton } from "./delete-video-button";
import { RecordsTable, type RecordsTableRow } from "./records-table";
import type { VideoCommands } from "./video-commands";
import { VideoStatusPill } from "./video-status-pill";
import { formatVideoDuration } from "./video-view-model";

function VideoLibrary({
  videos,
  commands,
  pendingVideoIds,
}: {
  videos: VideoMetadata[];
  commands: VideoCommands;
  pendingVideoIds: ReadonlySet<number>;
}) {
  const libraryVideos = videos.filter((video) => video.status === "downloaded");
  if (libraryVideos.length === 0) return null;

  const rows: RecordsTableRow[] = libraryVideos.map((video) => ({
    id: String(video.id),
    sortTitle: video.title,
    title: (
      <Link
        to="/videos/$videoId"
        params={{ videoId: String(video.id) }}
        className="block truncate transition-colors duration-150 hover:text-foreground/75"
      >
        {video.title}
      </Link>
    ),
    source: video.channel,
    duration: video.duration != null ? formatVideoDuration(video.duration) : null,
    durationSeconds: video.duration,
    status: <VideoStatusPill status={video.status} />,
    actions: (
      <>
        <Link
          to="/videos/$videoId"
          params={{ videoId: String(video.id) }}
          aria-disabled={pendingVideoIds.has(video.id)}
          tabIndex={pendingVideoIds.has(video.id) ? -1 : undefined}
          className={buttonVariants({
            size: "sm",
            className: pendingVideoIds.has(video.id) ? "pointer-events-none opacity-50" : undefined,
          })}
          onClick={(event) => {
            if (pendingVideoIds.has(video.id)) event.preventDefault();
          }}
        >
          Transcribe
        </Link>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Download ${video.title} again`}
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
      </>
    ),
  }));

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Library</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {rows.length} {rows.length === 1 ? "video" : "videos"}
        </span>
      </div>
      <RecordsTable rows={rows} />
    </section>
  );
}

export { VideoLibrary };
