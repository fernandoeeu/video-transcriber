// @vitest-environment jsdom

import "../test-dom";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptionData, TranscriptionWithQueue } from "../../core/transcription";

const mockedGetTranscription = vi.fn();
const mockedGetVideoTranscriptions = vi.fn();
const mockedTranscribeVideo = vi.fn();

vi.mock("../../server/transcription", () => ({
  getTranscription: mockedGetTranscription,
  getVideoTranscriptions: mockedGetVideoTranscriptions,
  transcribeVideo: mockedTranscribeVideo,
}));

const { useTranscriptionJob } = await import("./use-transcription-job");

function makeTranscription(
  overrides: Partial<TranscriptionWithQueue> = {},
): TranscriptionWithQueue {
  return {
    id: 1,
    videoId: 10,
    status: "queued",
    progress: null,
    engine: null,
    model: null,
    language: null,
    segments: null,
    sourceAudioPath: "/tmp/audio.opus",
    errorMessage: null,
    createdAt: new Date("2026-03-10T12:00:00.000Z"),
    queuePosition: null,
    ...overrides,
  };
}

function renderTranscriptionJob(
  initialLatest: TranscriptionData | null = null,
  initialTranscriptions: TranscriptionData[] = initialLatest ? [initialLatest] : [],
) {
  return renderHook(() =>
    useTranscriptionJob({
      videoId: 10,
      initialTranscriptions,
      initialLatest,
    }),
  );
}

describe("useTranscriptionJob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedGetTranscription.mockReset();
    mockedGetVideoTranscriptions.mockReset();
    mockedTranscribeVideo.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  for (const status of ["queued", "converting", "transcribing"] as const) {
    it(`resumes polling a ${status} Transcription from loader data after reload`, async () => {
      const active = makeTranscription({ id: 7, status });
      const completed = makeTranscription({
        id: 7,
        status: "completed",
        progress: 100,
        segments: [{ start: 0, end: 1, text: "Reloaded" }],
      });
      mockedGetTranscription.mockResolvedValueOnce(completed);

      const { result } = renderTranscriptionJob(active, [active]);

      expect(result.current.submitting).toBe(true);
      expect(result.current.activeTranscription?.id).toBe(7);

      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });

      expect(mockedGetTranscription).toHaveBeenCalledWith({ data: { transcriptionId: 7 } });
      expect(result.current.latest?.id).toBe(7);
      expect(result.current.submitting).toBe(false);
    });
  }

  it("reconciles a lost start response to the newly active Transcription", async () => {
    const previous = makeTranscription({
      id: 1,
      status: "completed",
      segments: [{ start: 0, end: 1, text: "Previous" }],
    });
    const created = makeTranscription({ id: 2 });
    mockedTranscribeVideo.mockRejectedValueOnce(new Error("response lost"));
    mockedGetVideoTranscriptions.mockResolvedValueOnce([created, previous]);
    const { result } = renderTranscriptionJob(previous);

    await act(async () => {
      await result.current.commands.startTranscription();
    });

    expect(mockedGetVideoTranscriptions).toHaveBeenCalledWith({ data: { videoId: 10 } });
    expect(result.current.activeTranscription?.id).toBe(2);
    expect(result.current.transcriptions.map(({ id }) => id)).toEqual([2, 1]);
    expect(result.current.submitting).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("keeps start disabled while a rejected request is being reconciled", async () => {
    let resolveList!: (transcriptions: TranscriptionData[]) => void;
    mockedTranscribeVideo.mockRejectedValueOnce(new Error("response lost"));
    mockedGetVideoTranscriptions.mockReturnValueOnce(
      new Promise<TranscriptionData[]>((resolve) => {
        resolveList = resolve;
      }),
    );
    const { result } = renderTranscriptionJob();

    let startPromise!: Promise<void>;
    await act(async () => {
      startPromise = result.current.commands.startTranscription();
      await Promise.resolve();
    });

    expect(result.current.submitting).toBe(true);

    await act(async () => {
      resolveList([]);
      await startPromise;
    });

    expect(result.current.submitting).toBe(false);
    expect(result.current.error).toBe("Could not start transcription. Please try again.");
  });

  it("keeps start disabled when authoritative reconciliation also fails", async () => {
    mockedTranscribeVideo.mockRejectedValueOnce(new Error("response lost"));
    mockedGetVideoTranscriptions.mockRejectedValueOnce(new Error("list unavailable"));
    const { result } = renderTranscriptionJob();

    await act(async () => {
      await result.current.commands.startTranscription();
    });

    expect(result.current.submitting).toBe(true);
    expect(result.current.error).toBe(
      "Could not confirm whether transcription started. Reload this page to check its status.",
    );

    await act(async () => {
      await result.current.commands.startTranscription();
    });
    expect(mockedTranscribeVideo).toHaveBeenCalledTimes(1);
  });

  it("stops polling with a presentable error after bounded retries", async () => {
    mockedTranscribeVideo.mockResolvedValueOnce({
      ok: true,
      transcription: makeTranscription(),
    });
    mockedGetTranscription.mockRejectedValue(new Error("connection reset"));
    const { result } = renderTranscriptionJob();

    await act(async () => {
      await result.current.commands.startTranscription();
    });

    expect(result.current.submitting).toBe(true);

    for (const delay of [1000, 1000, 2000, 4000]) {
      await act(async () => {
        vi.advanceTimersByTime(delay);
        await Promise.resolve();
      });
    }

    expect(mockedGetTranscription).toHaveBeenCalledTimes(4);
    expect(result.current.submitting).toBe(false);
    expect(result.current.error).toBe(
      "Could not refresh transcription progress after 4 attempts. Please try again.",
    );
  });

  it("selects a completed poll result while preserving transcription history", async () => {
    const previous = makeTranscription({
      id: 1,
      status: "completed",
      segments: [{ start: 0, end: 1, text: "Previous" }],
    });
    const created = makeTranscription({ id: 2 });
    const completed = makeTranscription({
      id: 2,
      status: "completed",
      progress: 100,
      segments: [{ start: 0, end: 1, text: "Latest" }],
    });
    mockedTranscribeVideo.mockResolvedValueOnce({ ok: true, transcription: created });
    mockedGetTranscription.mockResolvedValueOnce(completed);
    const { result } = renderTranscriptionJob(previous);

    await act(async () => {
      await result.current.commands.startTranscription();
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(result.current.transcriptions.map(({ id }) => id)).toEqual([2, 1]);
    expect(result.current.latest?.id).toBe(2);
    expect(result.current.selectedTranscription?.id).toBe(2);
    expect(result.current.submitting).toBe(false);
  });

  it("cleans up scheduled polling when unmounted", async () => {
    mockedTranscribeVideo.mockResolvedValueOnce({
      ok: true,
      transcription: makeTranscription(),
    });
    const { result, unmount } = renderTranscriptionJob();

    await act(async () => {
      await result.current.commands.startTranscription();
    });
    unmount();

    vi.advanceTimersByTime(10_000);
    await Promise.resolve();

    expect(mockedGetTranscription).not.toHaveBeenCalled();
  });
});
