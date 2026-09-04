import { Link } from "@tanstack/react-router";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { Button } from "@video-transcriber/ui/components/button";

import type { Segment, TranscriptionData } from "../../core/transcription";
import type { VideoMetadata } from "../../core/video";
import { exportTranscriptionSrt, exportTranscriptionTxt } from "../../server/transcription";
import { formatVideoDuration, formatVideoStatus } from "../videos/video-view-model";
import { ThinkingState } from "./thinking-state";
import { TranscriptionHistory } from "./transcription-history";
import { useTranscriptionJob } from "./use-transcription-job";

const transcriptionDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

interface VideoTranscriptionScreenProps {
  video: VideoMetadata | null;
  transcriptions: TranscriptionData[];
  latest: TranscriptionData | null;
}

function VideoTranscriptionScreen({
  video,
  transcriptions: initialTranscriptions,
  latest: initialLatest,
}: VideoTranscriptionScreenProps) {
  const transcriptionJob = useTranscriptionJob({
    videoId: video?.id ?? Number.NaN,
    initialTranscriptions,
    initialLatest,
  });

  if (!video) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="text-sm text-muted-foreground">Video not found.</p>
        <BackLink />
      </div>
    );
  }

  const hasCompletedTranscription = transcriptionJob.transcriptions.some(
    (transcription) => transcription.status === "completed",
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <BackLink />
      <VideoHeader video={video} />

      <TranscribeSection
        video={video}
        hasExistingTranscription={hasCompletedTranscription}
        submitting={transcriptionJob.submitting}
        error={transcriptionJob.error}
        onTranscribe={transcriptionJob.commands.startTranscription}
      />

      {transcriptionJob.activeTranscription &&
        transcriptionJob.activeTranscription.status !== "completed" && (
          <section className="mt-4">
            <ThinkingState transcription={transcriptionJob.activeTranscription} />
          </section>
        )}

      {transcriptionJob.selectedTranscription?.segments && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">Transcription</h2>
            <ExportButtons
              transcriptionId={transcriptionJob.selectedTranscription.id}
              videoTitle={video.title}
            />
          </div>
          <TranscriptionText segments={transcriptionJob.selectedTranscription.segments} />
          <TranscriptionMeta transcription={transcriptionJob.selectedTranscription} />
        </section>
      )}

      <TranscriptionHistory
        transcriptions={transcriptionJob.transcriptions}
        latest={transcriptionJob.latest}
        selectedTranscriptionId={transcriptionJob.selectedTranscription?.id ?? null}
        onSelect={transcriptionJob.commands.selectTranscription}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/"
      className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" />
      Back to library
    </Link>
  );
}

function VideoHeader({ video }: { video: VideoMetadata }) {
  return (
    <header>
      <h1 className="text-balance text-lg font-semibold tracking-tight">{video.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {video.channel}
        {video.channel && video.duration != null && <span> &middot; </span>}
        {video.duration != null && (
          <span className="tabular-nums">{formatVideoDuration(video.duration)}</span>
        )}
        <span> &middot; </span>
        <span className="capitalize">{formatVideoStatus(video.status)}</span>
      </p>
      <p className="mt-2 truncate font-mono text-xs text-muted-foreground">{video.originUrl}</p>
    </header>
  );
}

function TranscribeSection({
  video,
  hasExistingTranscription,
  submitting,
  error,
  onTranscribe,
}: {
  video: VideoMetadata;
  hasExistingTranscription: boolean;
  submitting: boolean;
  error: string | null;
  onTranscribe: () => Promise<void>;
}) {
  if (video.status !== "downloaded") return null;

  return (
    <section className="mt-6">
      <Button onClick={() => void onTranscribe()} disabled={submitting}>
        {submitting ? (
          <>
            <Loader2 className="animate-spin" data-icon="inline-start" />
            Transcribing...
          </>
        ) : hasExistingTranscription ? (
          "Retranscribe"
        ) : (
          "Transcribe"
        )}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  );
}

function triggerDownload(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(title: string): string {
  return title.replace(/[^a-zA-Z0-9_\- ]/g, "").trim() || "transcription";
}

function ExportButtons({
  transcriptionId,
  videoTitle,
}: {
  transcriptionId: number;
  videoTitle: string;
}) {
  const baseName = sanitizeFilename(videoTitle);
  return (
    <div className="flex gap-1.5">
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          const result = await exportTranscriptionTxt({ data: { transcriptionId } });
          if (result.ok) triggerDownload(result.content, `${baseName}.txt`);
        }}
      >
        <Download data-icon="inline-start" />
        .txt
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          const result = await exportTranscriptionSrt({ data: { transcriptionId } });
          if (result.ok) triggerDownload(result.content, `${baseName}.srt`);
        }}
      >
        <Download data-icon="inline-start" />
        .srt
      </Button>
    </div>
  );
}

function TranscriptionMeta({ transcription }: { transcription: TranscriptionData }) {
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      {transcription.engine}
      {transcription.model && <span> / {transcription.model}</span>}
      {transcription.language && <span> / {transcription.language}</span>}
      {" / "}
      {transcriptionDateFormatter.format(new Date(transcription.createdAt))}
    </p>
  );
}

function TranscriptionText({ segments }: { segments: Segment[] }) {
  const text = segments.map((segment) => segment.text).join(" ");
  return (
    <div
      className="max-h-[min(52svh,32rem)] overflow-y-auto overscroll-contain rounded-xl bg-card p-4 shadow-card [scrollbar-gutter:stable]"
      role="region"
      aria-label="Transcription text"
      tabIndex={0}
    >
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
    </div>
  );
}

export { VideoTranscriptionScreen };
