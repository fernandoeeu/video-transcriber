import { useRouter } from "@tanstack/react-router";
import { CheckCircle2, Video, X, XCircle } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@video-transcriber/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@video-transcriber/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@video-transcriber/ui/components/empty";
import { Input } from "@video-transcriber/ui/components/input";
import { Label } from "@video-transcriber/ui/components/label";
import { PromptBar } from "@video-transcriber/ui/components/prompt-bar";

import type { DependencyReport } from "../../core/dependencies";
import type { VideoMetadata } from "../../core/video";
import { ActiveVideoTasks } from "./active-video-tasks";
import { useVideoLibrary } from "./use-video-library";
import { VideoLibrary } from "./video-library";
import { VideoStatusPill } from "./video-status-pill";
import { formatVideoDuration } from "./video-view-model";

function HomeScreen({
  report,
  initialVideos,
}: {
  report: DependencyReport;
  initialVideos: VideoMetadata[];
}) {
  const router = useRouter();
  const refreshHome = useCallback(() => router.invalidate(), [router]);
  const {
    videos,
    url,
    setUrl,
    refererUrl,
    setRefererUrl,
    showRefererField,
    preview,
    fetchingPreview,
    submitPreview,
    clearPreview,
    operationError,
    clearOperationError,
    pendingVideoIds,
    commands,
  } = useVideoLibrary({ initialVideos, onPreviewAccepted: refreshHome });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PromptBar value={url} onChange={setUrl} onSubmit={submitPreview} loading={fetchingPreview} />

      {showRefererField && (
        <div className="mt-3 grid gap-1.5">
          <Label htmlFor="referer-url">Embedding page URL</Label>
          <Input
            id="referer-url"
            type="url"
            value={refererUrl}
            onChange={(event) => setRefererUrl(event.target.value)}
            placeholder="https://example.com/lesson-that-embeds-this-video"
            disabled={fetchingPreview}
            autoComplete="url"
          />
          <p className="text-muted-foreground text-xs">
            Vimeo embed-only videos need the page that embeds them. Paste that page URL here.
          </p>
        </div>
      )}

      {!report.ok && <DependencyPanel report={report} />}

      {preview && (
        <div className="mt-4">
          {preview.ok ? (
            <PreviewCard video={preview.video} existing={preview.existing} />
          ) : (
            <ErrorBanner
              title="Failed to fetch metadata"
              message={preview.error}
              onDismiss={clearPreview}
            />
          )}
        </div>
      )}

      {operationError && (
        <div className="mt-4">
          <ErrorBanner
            title={operationError.title}
            message={operationError.message}
            onDismiss={clearOperationError}
          />
        </div>
      )}

      <ActiveVideoTasks videos={videos} commands={commands} pendingVideoIds={pendingVideoIds} />
      <VideoLibrary videos={videos} commands={commands} pendingVideoIds={pendingVideoIds} />

      {videos.length === 0 && (
        <Empty className="mt-8 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Video />
            </EmptyMedia>
            <EmptyTitle>No videos yet</EmptyTitle>
            <EmptyDescription>
              Paste a video URL above to download its audio and transcribe it locally.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}

function PreviewCard({ video, existing }: { video: VideoMetadata; existing?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-balance">{video.title}</CardTitle>
        <CardDescription>
          {video.channel}
          {video.channel && video.duration != null && <span> &middot; </span>}
          {video.duration != null && (
            <span className="tabular-nums">{formatVideoDuration(video.duration)}</span>
          )}
        </CardDescription>
        <CardAction>
          <VideoStatusPill status={video.status} />
        </CardAction>
      </CardHeader>
      {existing && (
        <CardContent>
          <p className="text-xs font-medium text-warning">
            This video already exists in your library.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

function ErrorBanner({
  title,
  message,
  onDismiss,
}: {
  title: string;
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
    >
      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex-1">
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-xs">{message}</p>
      </div>
      <Button variant="ghost" size="icon-xs" onClick={onDismiss} aria-label="Dismiss">
        <X />
      </Button>
    </div>
  );
}

function DependencyPanel({ report }: { report: DependencyReport }) {
  return (
    <section className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <h2 className="text-sm font-medium text-destructive">Missing dependencies</h2>
      <p className="mt-1 text-xs text-muted-foreground">Install them before proceeding.</p>
      <ul className="mt-3 space-y-2">
        {report.dependencies.map((dependency) => (
          <li key={dependency.name} className="flex items-start gap-2 text-sm">
            {dependency.status === "ok" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            )}
            <div>
              <span className="font-medium">{dependency.name}</span>
              {dependency.status === "ok" && dependency.version && (
                <span className="ml-1 text-muted-foreground">v{dependency.version}</span>
              )}
              {dependency.status === "missing" && (
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {dependency.installHint}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export { HomeScreen };
