// @vitest-environment jsdom

import "../test-dom";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VideoMetadata } from "../../core/video";
import type { VideoLibraryApi } from "./use-video-library";

vi.mock("../../server/video", () => ({
  downloadVideo: vi.fn(),
  getVideo: vi.fn(),
  previewVideo: vi.fn(),
  redownloadVideo: vi.fn(),
  removeVideo: vi.fn(),
}));

const { useVideoLibrary } = await import("./use-video-library");

function makeVideo(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
  return {
    id: 1,
    originUrl: "https://example.com/video",
    refererUrl: null,
    title: "Test video",
    duration: 60,
    channel: "Test channel",
    status: "ready_to_download",
    progress: null,
    audioFilePath: null,
    errorMessage: null,
    ...overrides,
  };
}

function makeApi(overrides: Partial<VideoLibraryApi> = {}): VideoLibraryApi {
  return {
    preview: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    download: vi.fn(),
    redownload: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}

function renderVideoLibrary(initialVideo: VideoMetadata, api: VideoLibraryApi) {
  const initialVideos = [initialVideo];
  const onPreviewAccepted = vi.fn();
  return renderHook(() =>
    useVideoLibrary({
      initialVideos,
      onPreviewAccepted,
      api,
      pollIntervalMs: 1000,
    }),
  );
}

describe("useVideoLibrary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("treats a missing video as terminal after a rejected download RPC", async () => {
    const get = vi.fn().mockResolvedValue(null);
    const api = makeApi({
      download: vi.fn().mockRejectedValue(new Error("RPC response was lost")),
      get,
    });
    const { result } = renderVideoLibrary(makeVideo(), api);

    await act(async () => {
      await result.current.commands.download(1);
    });

    expect(api.get).toHaveBeenCalledWith({ data: { videoId: 1 } });
    expect(result.current.videos).toEqual([]);
    expect(result.current.pendingVideoIds.has(1)).toBe(false);
    expect(result.current.operationError).toMatchObject({
      title: "Failed to start download",
      message: "RPC response was lost",
    });

    const getCallCount = get.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(api.get).toHaveBeenCalledTimes(getCallCount);
  });

  it("removes a video deleted in another tab while polling a claimed download", async () => {
    let resolveGet: ((video: VideoMetadata | null) => void) | undefined;
    const get = vi.fn(
      () =>
        new Promise<VideoMetadata | null>((resolve) => {
          resolveGet = resolve;
        }),
    );
    const api = makeApi({
      download: vi.fn().mockResolvedValue(makeVideo({ status: "downloading", progress: 0 })),
      get,
    });
    const { result } = renderVideoLibrary(makeVideo(), api);

    await act(async () => {
      await result.current.commands.download(1);
    });
    expect(result.current.pendingVideoIds.has(1)).toBe(true);

    await act(async () => {
      resolveGet?.(null);
      await Promise.resolve();
    });

    expect(result.current.videos).toEqual([]);
    expect(result.current.pendingVideoIds.has(1)).toBe(false);
    expect(result.current.operationError).toBeNull();

    const getCallCount = get.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(api.get).toHaveBeenCalledTimes(getCallCount);
  });

  it("keeps the video and polling lock when getVideo RPC rejects", async () => {
    const downloading = makeVideo({ status: "downloading", progress: 20 });
    const api = makeApi({
      get: vi
        .fn()
        .mockRejectedValueOnce(new Error("getVideo unavailable"))
        .mockResolvedValueOnce(null),
    });
    const { result } = renderVideoLibrary(downloading, api);

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.videos).toEqual([downloading]);
    expect(result.current.operationError).toMatchObject({
      title: "Failed to refresh download status",
      message: "getVideo unavailable",
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(result.current.videos).toEqual([]);
    expect(result.current.operationError).toBeNull();
  });

  it("uses getVideo after a rejected redownload without inventing a video error", async () => {
    const downloaded = makeVideo({
      status: "downloaded",
      progress: 100,
      audioFilePath: "/tmp/video.opus",
    });
    const api = makeApi({
      redownload: vi.fn().mockRejectedValue(new Error("request rejected")),
      get: vi.fn().mockResolvedValue(downloaded),
    });
    const { result } = renderVideoLibrary(downloaded, api);

    await act(async () => {
      await result.current.commands.redownload(1);
    });

    expect(api.get).toHaveBeenCalledWith({ data: { videoId: 1 } });
    expect(result.current.videos[0]).toEqual(downloaded);
    expect(result.current.pendingVideoIds.has(1)).toBe(false);
    expect(result.current.operationError?.message).toBe("request rejected");
  });

  it("allows only one download command per video at a time", async () => {
    let resolveDownload: ((video: VideoMetadata) => void) | undefined;
    const api = makeApi({
      get: vi.fn().mockResolvedValue(makeVideo({ status: "downloading", progress: 0 })),
      download: vi.fn(
        () =>
          new Promise<VideoMetadata>((resolve) => {
            resolveDownload = resolve;
          }),
      ),
    });
    const { result } = renderVideoLibrary(makeVideo(), api);

    await act(async () => {
      const first = result.current.commands.download(1);
      const second = result.current.commands.download(1);
      resolveDownload?.(makeVideo({ status: "downloading", progress: 0 }));
      await Promise.all([first, second]);
    });

    expect(api.download).toHaveBeenCalledTimes(1);
    expect(result.current.pendingVideoIds.has(1)).toBe(true);
  });
});
