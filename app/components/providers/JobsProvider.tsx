"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "../../lib/authClient";
import { useGames } from "./GamesProvider";
import type { PendingJob, QueuedJob, StatusResponse } from "../types/app";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 40;

type JobsContextValue = {
  pendingJobs: PendingJob[];
  enqueueJobs: (jobs: QueuedJob[]) => void;
  dismissJob: (jobId: string) => void;
  clearFinishedJobs: () => void;
  recentlyLoggedGameIds: string[];
  clearRecentlyLoggedGameIds: () => void;
  isPolling: boolean;
  loggedVersion: number;
};

const JobsContext = createContext<JobsContextValue | null>(null);

type PendingBatch = {
  jobIds: string[];
  loggedGameIds: string[];
} | null;

async function parseJsonResponse<T>(response: Response) {
  const raw = await response.text();
  if (!raw) {
    return {} as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Request failed with non-JSON response (${response.status}).`);
  }
}

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const { loadGames, loadGameFromJobId } = useGames();
  const [pendingJobs, setPendingJobs] = useState<PendingJob[]>([]);
  const [pendingBatch, setPendingBatch] = useState<PendingBatch>(null);
  const [recentlyLoggedGameIds, setRecentlyLoggedGameIds] = useState<string[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [loggedVersion, setLoggedVersion] = useState(0);
  const pendingJobsRef = useRef<PendingJob[]>([]);
  const pollCountsRef = useRef<Record<string, number>>({});
  const dismissTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {}
  );

  useEffect(() => {
    pendingJobsRef.current = pendingJobs;
  }, [pendingJobs]);

  useEffect(() => {
    if (!pendingBatch) {
      return;
    }
    if (pendingBatch.loggedGameIds.length !== pendingBatch.jobIds.length) {
      return;
    }
    setRecentlyLoggedGameIds(pendingBatch.loggedGameIds);
    setPendingBatch(null);
  }, [pendingBatch]);

  useEffect(() => {
    const activeIds = new Set(pendingJobs.map((job) => job.jobId));
    Object.entries(dismissTimersRef.current).forEach(([jobId, timer]) => {
      if (!activeIds.has(jobId)) {
        clearTimeout(timer);
        delete dismissTimersRef.current[jobId];
      }
    });
  }, [pendingJobs]);

  useEffect(() => {
    return () => {
      Object.values(dismissTimersRef.current).forEach((timer) => {
        clearTimeout(timer);
      });
      dismissTimersRef.current = {};
    };
  }, []);

  const dismissJob = useCallback((jobId: string) => {
    setPendingJobs((current) => current.filter((job) => job.jobId !== jobId));
  }, []);

  const clearFinishedJobs = useCallback(() => {
    setPendingJobs((current) =>
      current.filter(
        (job) =>
          job.status === "queued" || job.status === "processing" || job.isStale
      )
    );
  }, []);

  const clearRecentlyLoggedGameIds = useCallback(() => {
    setRecentlyLoggedGameIds([]);
  }, []);

  const enqueueJobs = useCallback((jobs: QueuedJob[]) => {
    setPendingJobs((current) => {
      const existingIds = new Set(current.map((job) => job.jobId));
      const nextJobs = jobs
        .filter((job) => !existingIds.has(job.jobId))
        .map((job) => ({
          jobId: job.jobId,
          status: "queued" as const,
          message: job.message
        }));
      return [...current, ...nextJobs];
    });
    if (jobs.length > 0) {
      setPendingBatch({
        jobIds: jobs.map((job) => job.jobId),
        loggedGameIds: []
      });
    }
  }, []);

  useEffect(() => {
    const hasActiveJobs = pendingJobs.some(
      (job) =>
        !job.isStale &&
        (job.status === "queued" || job.status === "processing")
    );
    if (!hasActiveJobs) {
      setIsPolling(false);
      return;
    }

    setIsPolling(true);
    let isActive = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const updateJob = (jobId: string, updates: Partial<PendingJob>) => {
      setPendingJobs((current) =>
        current.map((job) =>
          job.jobId === jobId ? { ...job, ...updates } : job
        )
      );
    };

    const scheduleDismiss = (jobId: string, delayMs = 4000) => {
      if (dismissTimersRef.current[jobId]) {
        return;
      }
      dismissTimersRef.current[jobId] = setTimeout(() => {
        dismissJob(jobId);
        delete dismissTimersRef.current[jobId];
      }, delayMs);
    };

    const checkStatus = async () => {
      if (!isActive) {
        return;
      }
      const jobs = pendingJobsRef.current;
      for (const job of jobs) {
        if (
          job.isStale ||
          job.status === "logged" ||
          job.status === "error"
        ) {
          continue;
        }

        pollCountsRef.current[job.jobId] =
          (pollCountsRef.current[job.jobId] ?? 0) + 1;

        let nextStatus: StatusResponse["status"] | null = null;
        try {
          const response = await authFetch(`/api/status?jobId=${job.jobId}`);
          if (!response.ok) {
            const payload = await parseJsonResponse<{ error?: string }>(response);
            throw new Error(payload.error || "Status check failed.");
          }
          const payload = await parseJsonResponse<StatusResponse>(response);
          nextStatus = payload.status;
          let nextMessage = job.message;

          if (payload.status === "queued") {
            nextMessage = "Queued. Waiting for the worker to pick it up.";
          } else if (payload.status === "processing") {
            nextMessage = "Processing with Gemini...";
          } else if (payload.status === "logged") {
            nextMessage = "Extraction complete. Logged.";
            setLoggedVersion((current) => current + 1);
            const loggedId =
              payload.gameId || (await loadGameFromJobId(job.jobId))?.id || null;
            await loadGames();
            if (loggedId) {
              setPendingBatch((current) => {
                if (!current || !current.jobIds.includes(job.jobId)) {
                  return current;
                }
                if (current.loggedGameIds.includes(loggedId)) {
                  return current;
                }
                return {
                  ...current,
                  loggedGameIds: [...current.loggedGameIds, loggedId]
                };
              });
            }
            scheduleDismiss(job.jobId);
          } else if (payload.status === "error") {
            nextMessage = payload.lastError
              ? `Job failed: ${payload.lastError}`
              : "Job failed during processing.";
          }

          updateJob(job.jobId, {
            status: payload.status,
            message: nextMessage,
            lastError: payload.lastError ?? undefined,
            isStale:
              payload.status === "queued" || payload.status === "processing"
                ? job.isStale
                : false
          });
        } catch (error) {
          nextStatus = "error";
          updateJob(job.jobId, {
            status: "error",
            message:
              error instanceof Error ? error.message : "Status check failed.",
            isStale: false
          });
        }

        if (pollCountsRef.current[job.jobId] >= MAX_POLLS) {
          const staleStatus = nextStatus ?? job.status;
          if (staleStatus === "queued" || staleStatus === "processing") {
            updateJob(job.jobId, {
              isStale: true,
              message: "Still queued. Refresh later to check again."
            });
          }
        }
      }
    };

    checkStatus();
    intervalId = setInterval(checkStatus, POLL_INTERVAL_MS);

    return () => {
      isActive = false;
      setIsPolling(false);
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [pendingJobs, dismissJob, loadGames, loadGameFromJobId]);

  const value = useMemo<JobsContextValue>(
    () => ({
      pendingJobs,
      enqueueJobs,
      dismissJob,
      clearFinishedJobs,
      recentlyLoggedGameIds,
      clearRecentlyLoggedGameIds,
      isPolling,
      loggedVersion
    }),
    [
      pendingJobs,
      enqueueJobs,
      dismissJob,
      clearFinishedJobs,
      recentlyLoggedGameIds,
      clearRecentlyLoggedGameIds,
      isPolling,
      loggedVersion
    ]
  );

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs() {
  const context = useContext(JobsContext);
  if (!context) {
    throw new Error("useJobs must be used within a JobsProvider.");
  }
  return context;
}
