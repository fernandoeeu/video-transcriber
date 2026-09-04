import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PreviewResult, VideoMetadata } from "../../core/video";
import {
  downloadVideo,
  getVideo,
  previewVideo,
  redownloadVideo,
  removeVideo,
} from "../../server/video";
import type { VideoCommands } from "./video-commands";

interface OperationError {
  title: string;
  message: string;
  source: "operation" | "polling";
}

interface VideoLibraryApi {
  preview: (args: { data: { url: string; refererUrl?: string } }) => Promise<PreviewResult>;
  get: (args: { data: { videoId: number } }) => Promise<VideoMetadata | null>;
  download: (args: { data: { videoId: number } }) => Promise<VideoMetadata | null>;
  redownload: (args: { data: { videoId: number } }) => Promise<VideoMetadata | null>;
  remove: (args: {
    data: { videoId: number };
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}

interface UseVideoLibraryOptions {
  initialVideos: VideoMetadata[];
  onPreviewAccepted: () => Promise<void> | void;
  api?: VideoLibraryApi;
  pollIntervalMs?: number;
}

interface AuthoritativeVideoUpdate {
  videoId: number;
  video: VideoMetadata | null;
}

type VideoPollResult = AuthoritativeVideoUpdate | { videoId: number; error: unknown };

const defaultApi: VideoLibraryApi = {
  preview: previewVideo,
  get: getVideo,
  download: downloadVideo,
  redownload: redownloadVideo,
  remove: removeVideo,
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function useVideoLibrary({
  initialVideos,
  onPreviewAccepted,
  api = defaultApi,
  pollIntervalMs = 1000,
}: UseVideoLibraryOptions) {
  const [videos, setVideos] = useState<VideoMetadata[]>(initialVideos);
  const [url, setUrl] = useState("");
  const [refererUrl, setRefererUrl] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [fetchingPreview, setFetchingPreview] = useState(false);
  const [operationError, setOperationError] = useState<OperationError | null>(null);
  const operationsRef = useRef(new Set<number>());
  const downloadOperationsRef = useRef(new Set<number>());
  const startingDownloadsRef = useRef(new Set<number>());
  const [pendingVideoIds, setPendingVideoIds] = useState<ReadonlySet<number>>(() => new Set());
  const [downloadVideoIds, setDownloadVideoIds] = useState<ReadonlySet<number>>(() => new Set());

  const syncOperationState = useCallback(() => {
    setPendingVideoIds(new Set(operationsRef.current));
    setDownloadVideoIds(new Set(downloadOperationsRef.current));
  }, []);

  const beginVideoOperation = useCallback(
    (videoId: number) => {
      if (operationsRef.current.has(videoId)) return false;
      operationsRef.current.add(videoId);
      syncOperationState();
      return true;
    },
    [syncOperationState],
  );

  const finishVideoOperation = useCallback(
    (videoId: number) => {
      operationsRef.current.delete(videoId);
      downloadOperationsRef.current.delete(videoId);
      syncOperationState();
    },
    [syncOperationState],
  );

  const applyAuthoritativeUpdates = useCallback(
    (updates: AuthoritativeVideoUpdate[]) => {
      const acceptedUpdates = updates.filter(
        ({ videoId, video }) =>
          video === null ||
          video.status === "downloading" ||
          !startingDownloadsRef.current.has(videoId),
      );

      if (acceptedUpdates.length > 0) {
        const removedIds = new Set(
          acceptedUpdates.filter(({ video }) => video === null).map(({ videoId }) => videoId),
        );
        const updatesById = new Map(
          acceptedUpdates.flatMap(({ videoId, video }) =>
            video === null ? [] : [[videoId, video] as const],
          ),
        );
        setVideos((current) =>
          current
            .filter((video) => !removedIds.has(video.id))
            .map((video) => updatesById.get(video.id) ?? video),
        );
      }

      for (const { videoId, video } of acceptedUpdates) {
        if (video === null || video.status !== "downloading") finishVideoOperation(videoId);
      }
    },
    [finishVideoOperation],
  );

  useEffect(() => {
    setVideos((current) => {
      const currentById = new Map(current.map((video) => [video.id, video]));
      return initialVideos.map((video) =>
        operationsRef.current.has(video.id) ? (currentById.get(video.id) ?? video) : video,
      );
    });
  }, [initialVideos]);

  const pollingIds = useMemo(
    () =>
      [
        ...new Set([
          ...videos.filter((video) => video.status === "downloading").map((video) => video.id),
          ...downloadVideoIds,
        ]),
      ].sort((left, right) => left - right),
    [downloadVideoIds, videos],
  );
  const pollingKey = pollingIds.join(",");

  useEffect(() => {
    if (!pollingKey) return;

    const ids = pollingKey.split(",").map(Number);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function pollVideos() {
      const results = await Promise.all(
        ids.map(async (videoId): Promise<VideoPollResult> => {
          try {
            return { videoId, video: await api.get({ data: { videoId } }) };
          } catch (error) {
            return { videoId, error };
          }
        }),
      );
      if (cancelled) return;

      applyAuthoritativeUpdates(results.flatMap((result) => ("video" in result ? [result] : [])));

      const failedResult = results.find((result) => "error" in result);
      if (failedResult) {
        setOperationError((current) =>
          current?.source === "operation"
            ? current
            : {
                title: "Failed to refresh download status",
                message: getErrorMessage(failedResult.error),
                source: "polling",
              },
        );
      } else {
        setOperationError((current) => (current?.source === "polling" ? null : current));
      }

      if (!cancelled) timer = setTimeout(() => void pollVideos(), pollIntervalMs);
    }

    void pollVideos();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, applyAuthoritativeUpdates, pollIntervalMs, pollingKey]);

  const submitPreview = useCallback(async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || fetchingPreview) return;

    setFetchingPreview(true);
    try {
      const trimmedReferer = refererUrl.trim();
      const result = await api.preview({
        data: trimmedReferer
          ? { url: trimmedUrl, refererUrl: trimmedReferer }
          : { url: trimmedUrl },
      });
      setPreview(result);
      if (result.ok) {
        setUrl("");
        setRefererUrl("");
        await onPreviewAccepted();
      }
    } catch (error) {
      setPreview({ ok: false, error: getErrorMessage(error) });
    } finally {
      setFetchingPreview(false);
    }
  }, [api, fetchingPreview, onPreviewAccepted, refererUrl, url]);

  const startDownload = useCallback(
    async (
      videoId: number,
      request: (args: { data: { videoId: number } }) => Promise<VideoMetadata | null>,
    ) => {
      if (!beginVideoOperation(videoId)) return;

      downloadOperationsRef.current.add(videoId);
      startingDownloadsRef.current.add(videoId);
      syncOperationState();
      setOperationError(null);
      setVideos((current) =>
        current.map((video) =>
          video.id === videoId
            ? { ...video, status: "downloading", progress: 0, errorMessage: null }
            : video,
        ),
      );

      try {
        const result = await request({ data: { videoId } });
        startingDownloadsRef.current.delete(videoId);
        applyAuthoritativeUpdates([{ videoId, video: result }]);
      } catch (error) {
        startingDownloadsRef.current.delete(videoId);
        setOperationError({
          title: "Failed to start download",
          message: getErrorMessage(error),
          source: "operation",
        });

        try {
          const authoritativeVideo = await api.get({ data: { videoId } });
          applyAuthoritativeUpdates([{ videoId, video: authoritativeVideo }]);
        } catch {
          // The command outcome is uncertain. Polling remains active until getVideo succeeds.
        }
      } finally {
        startingDownloadsRef.current.delete(videoId);
      }
    },
    [api, applyAuthoritativeUpdates, beginVideoOperation, syncOperationState],
  );

  const handleDelete = useCallback(
    async (videoId: number) => {
      if (!beginVideoOperation(videoId)) return;

      setOperationError(null);
      try {
        const result = await api.remove({ data: { videoId } });
        if (result.ok) {
          setVideos((current) => current.filter((video) => video.id !== videoId));
        } else {
          setOperationError({
            title: "Failed to delete video",
            message: result.error,
            source: "operation",
          });
        }
      } catch (error) {
        setOperationError({
          title: "Failed to delete video",
          message: getErrorMessage(error),
          source: "operation",
        });
      } finally {
        finishVideoOperation(videoId);
      }
    },
    [api, beginVideoOperation, finishVideoOperation],
  );

  const commands = useMemo<VideoCommands>(
    () => ({
      download: (videoId) => startDownload(videoId, api.download),
      redownload: (videoId) => startDownload(videoId, api.redownload),
      delete: handleDelete,
    }),
    [api, handleDelete, startDownload],
  );

  return {
    videos,
    url,
    setUrl,
    refererUrl,
    setRefererUrl,
    showRefererField: needsRefererField(url, preview),
    preview,
    fetchingPreview,
    submitPreview,
    clearPreview: () => setPreview(null),
    operationError,
    clearOperationError: () => setOperationError(null),
    pendingVideoIds,
    commands,
  };
}

export { useVideoLibrary };
export type { VideoLibraryApi };

/** True when the URL is a Vimeo player embed or yt-dlp asked for the embedding page. */
function needsRefererField(url: string, preview: PreviewResult | null): boolean {
  if (preview && !preview.ok && preview.needsReferer) return true;
  return /^https?:\/\/player\.vimeo\.com\//i.test(url.trim());
}
