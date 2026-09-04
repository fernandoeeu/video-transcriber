import { useCallback, useEffect, useRef, useState } from "react";

import type { TranscriptionData, TranscriptionWithQueue } from "../../core/transcription";
import {
  getTranscription,
  getVideoTranscriptions,
  transcribeVideo,
} from "../../server/transcription";
import { isActiveTranscriptionStatus } from "./transcription-status";

const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_FAILURES = 4;

function getPollRetryDelay(failureCount: number) {
  return POLL_INTERVAL_MS * 2 ** Math.max(0, failureCount - 1);
}

function findActiveTranscription(
  transcriptions: TranscriptionData[],
  ignoredIds: ReadonlySet<number> = new Set(),
): TranscriptionData | null {
  return (
    transcriptions.find(
      (transcription) =>
        isActiveTranscriptionStatus(transcription.status) && !ignoredIds.has(transcription.id),
    ) ?? null
  );
}

function withQueuePosition(transcription: TranscriptionData): TranscriptionWithQueue {
  return { ...transcription, queuePosition: null };
}

function upsertTranscription(
  transcriptions: TranscriptionData[],
  updated: TranscriptionData,
): TranscriptionData[] {
  if (!transcriptions.some((transcription) => transcription.id === updated.id)) {
    return [updated, ...transcriptions];
  }

  return transcriptions.map((transcription) =>
    transcription.id === updated.id ? updated : transcription,
  );
}

interface UseTranscriptionJobOptions {
  videoId: number;
  initialTranscriptions: TranscriptionData[];
  initialLatest: TranscriptionData | null;
}

export function useTranscriptionJob({
  videoId,
  initialTranscriptions,
  initialLatest,
}: UseTranscriptionJobOptions) {
  const [transcriptions, setTranscriptions] = useState(initialTranscriptions);
  const [latest, setLatest] = useState(initialLatest);
  const [selectedTranscription, setSelectedTranscription] = useState<TranscriptionData | null>(
    initialLatest,
  );
  const initialActiveTranscription = findActiveTranscription(initialTranscriptions);
  const [activeTranscription, setActiveTranscription] = useState<TranscriptionWithQueue | null>(
    () => (initialActiveTranscription ? withQueuePosition(initialActiveTranscription) : null),
  );
  const [submitting, setSubmitting] = useState(initialActiveTranscription !== null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const submittingRef = useRef(initialActiveTranscription !== null);

  const stopPolling = useCallback(() => {
    pollGenerationRef.current += 1;
    if (pollRef.current !== null) clearTimeout(pollRef.current);
    pollRef.current = null;
  }, []);

  const finishSubmitting = useCallback(() => {
    submittingRef.current = false;
    if (mountedRef.current) setSubmitting(false);
  }, []);

  const beginPolling = useCallback(
    (transcriptionId: number, generation: number) => {
      let consecutiveFailures = 0;
      let poll: () => Promise<void>;

      const isCurrent = () => mountedRef.current && pollGenerationRef.current === generation;

      const schedule = (delay: number) => {
        if (!isCurrent()) return;
        pollRef.current = setTimeout(() => {
          pollRef.current = null;
          void poll();
        }, delay);
      };

      poll = async () => {
        if (!isCurrent()) return;

        let nextDelay: number | null = null;
        try {
          const updated = await getTranscription({ data: { transcriptionId } });
          if (!isCurrent()) return;

          if (!updated) {
            setError("Transcription could not be found. Please try again.");
            return;
          }

          consecutiveFailures = 0;
          setTranscriptions((current) => upsertTranscription(current, updated));
          setActiveTranscription(updated);

          if (updated.status === "completed") {
            setLatest(updated);
            setSelectedTranscription(updated);
            return;
          }

          if (updated.status === "error") {
            setError(updated.errorMessage || "Transcription failed. Please try again.");
            return;
          }

          nextDelay = POLL_INTERVAL_MS;
        } catch {
          if (!isCurrent()) return;

          consecutiveFailures += 1;
          if (consecutiveFailures >= MAX_POLL_FAILURES) {
            setError(
              `Could not refresh transcription progress after ${MAX_POLL_FAILURES} attempts. Please try again.`,
            );
            return;
          }

          nextDelay = getPollRetryDelay(consecutiveFailures);
        } finally {
          if (isCurrent()) {
            if (nextDelay === null) {
              stopPolling();
              finishSubmitting();
            } else {
              schedule(nextDelay);
            }
          }
        }
      };

      schedule(POLL_INTERVAL_MS);
    },
    [finishSubmitting, stopPolling],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      submittingRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  useEffect(() => {
    stopPolling();
    setTranscriptions(initialTranscriptions);
    setLatest(initialLatest);
    setSelectedTranscription(initialLatest);
    setError(null);

    const initialActive = findActiveTranscription(initialTranscriptions);
    setActiveTranscription(initialActive ? withQueuePosition(initialActive) : null);
    submittingRef.current = initialActive !== null;
    setSubmitting(initialActive !== null);

    if (initialActive && Number.isFinite(videoId)) {
      beginPolling(initialActive.id, pollGenerationRef.current);
    }
  }, [beginPolling, initialLatest, initialTranscriptions, stopPolling, videoId]);

  const startTranscription = useCallback(async () => {
    if (submittingRef.current) return;

    const knownTranscriptionIds = new Set(transcriptions.map((transcription) => transcription.id));
    stopPolling();
    const generation = pollGenerationRef.current;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    let pollingStarted = false;
    let stateIsCertain = true;
    try {
      const result = await transcribeVideo({ data: { videoId } });
      if (!mountedRef.current || pollGenerationRef.current !== generation) return;

      if (!result.ok) {
        setError(result.error);
        return;
      }

      const created = result.transcription;
      setTranscriptions((current) => upsertTranscription(current, created));
      setActiveTranscription(withQueuePosition(created));

      if (isActiveTranscriptionStatus(created.status)) {
        beginPolling(created.id, generation);
        pollingStarted = true;
      } else if (created.status === "completed") {
        setLatest(created);
        setSelectedTranscription(created);
      } else {
        setError(created.errorMessage || "Transcription failed. Please try again.");
      }
    } catch {
      if (!mountedRef.current || pollGenerationRef.current !== generation) return;

      setError("Could not confirm whether transcription started. Checking current jobs...");

      let authoritativeTranscriptions: TranscriptionData[];
      try {
        authoritativeTranscriptions = await getVideoTranscriptions({ data: { videoId } });
      } catch {
        if (mountedRef.current && pollGenerationRef.current === generation) {
          stateIsCertain = false;
          setError(
            "Could not confirm whether transcription started. Reload this page to check its status.",
          );
        }
        return;
      }

      if (!mountedRef.current || pollGenerationRef.current !== generation) return;

      setTranscriptions(authoritativeTranscriptions);
      const activeTranscription =
        findActiveTranscription(authoritativeTranscriptions, knownTranscriptionIds) ??
        findActiveTranscription(authoritativeTranscriptions);

      if (!activeTranscription) {
        setError("Could not start transcription. Please try again.");
        return;
      }

      setError(null);
      setActiveTranscription(withQueuePosition(activeTranscription));
      beginPolling(activeTranscription.id, generation);
      pollingStarted = true;
    } finally {
      if (
        !pollingStarted &&
        stateIsCertain &&
        mountedRef.current &&
        pollGenerationRef.current === generation
      ) {
        finishSubmitting();
      }
    }
  }, [beginPolling, finishSubmitting, stopPolling, transcriptions, videoId]);

  const selectTranscription = useCallback((transcription: TranscriptionData) => {
    if (transcription.status === "completed" && transcription.segments) {
      setSelectedTranscription(transcription);
    }
  }, []);

  return {
    activeTranscription,
    error,
    latest,
    selectedTranscription,
    submitting,
    transcriptions,
    commands: {
      selectTranscription,
      startTranscription,
    },
  };
}
