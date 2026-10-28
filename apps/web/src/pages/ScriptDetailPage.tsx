// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  CheckCircleFillIcon,
  CircleIcon,
  ClockIcon,
  DownloadIcon,
  SyncIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button, Heading, Label, Text } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cancelJob, getJob, getJobLogs, retryJob, type ComputeJob, type ComputeJobStep } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { CircleIconButton } from "../components/SharedStyles";
import { parseAnsiLine, renderSpan } from "../components/terminal/AnsiRenderer";
import { usePageTitle } from "../util/title";

const AnsiRenderer: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split("\n");
  return (
    <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordWrap: "break-word", lineHeight: 1.55 }}>
      {lines.map((line, lineIdx) => (
        <div key={lineIdx}>{parseAnsiLine(line).map((span, spanIdx) => renderSpan(span, spanIdx))}</div>
      ))}
    </pre>
  );
};

function normalizeJobStatus(status: unknown): string {
  const s = String(status || "").toUpperCase();
  if (s === "SUCCESS" || s === "COMPLETED") return "SUCCESS";
  if (s === "FAILED" || s === "ERROR") return "FAILED";
  if (s === "CANCELLED" || s === "CANCELED") return "CANCELLED";
  if (s === "RUNNING" || s === "PROCESSING" || s === "IN_PROGRESS") return "RUNNING";
  if (s === "QUEUED" || s === "PENDING") return "QUEUED";
  return s || "QUEUED";
}

function formatLogsText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const rec = payload as { logs?: unknown };
    if (Array.isArray(rec.logs)) {
      return rec.logs.map((line) => String(line)).join("\n");
    }
  }
  return JSON.stringify(payload, null, 2);
}

const ScriptDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  usePageTitle(id ? `Job #${id}` : "Job Details");
  const navigate = useNavigate();
  const { token } = useAuth();
  const [job, setJob] = useState<ComputeJob | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [steps, setSteps] = useState<ComputeJobStep[]>([]);
  const [logs, setLogs] = useState<string>("");
  const [followLogs, setFollowLogs] = useState<boolean>(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setLoadError("Job ID is missing.");
      return;
    }
    let active = true;
    setLoading(true);
    setLoadError(null);

    const loadInitial = async () => {
      try {
        const res = await getJob(id);
        if (!active) return;
        const resolvedJob = res?.job ?? res;
        if (!resolvedJob || (typeof resolvedJob === "object" && "error" in resolvedJob && !("status" in resolvedJob))) {
          setJob(null);
          setLoadError((resolvedJob as { error?: string })?.error || `Job #${id} not found.`);
          setLoading(false);
          return;
        }
        const normStatus = normalizeJobStatus(resolvedJob.status);
        setJob({ ...resolvedJob, status: normStatus });
        if (res.steps) setSteps(res.steps);
        setLoading(false);

        getJobLogs(id)
          .then((text) => {
            if (active && text) setLogs(formatLogsText(text));
          })
          .catch(() => {
            /* ignore log fetch fallback */
          });
      } catch (err: any) {
        if (!active) return;
        setJob(null);
        setLoadError(err?.response?.data?.error || err?.message || `Job #${id} could not be found.`);
        setLoading(false);
      }
    };

    void loadInitial();

    if (typeof EventSource === "undefined") {
      return () => {
        active = false;
      };
    }

    const strId = String(id);
    const isCloudJob = strId.startsWith("cloud-") || strId.startsWith("cloud_");
    const isCaeJob = strId.startsWith("cae-") || strId.startsWith("cae_");
    const rawId = strId.startsWith("cloud-")
      ? strId.slice("cloud-".length)
      : strId.startsWith("cae-")
        ? strId.slice("cae-".length)
        : strId;

    const baseStreamPath = isCloudJob
      ? `/api/v1/cloud/jobs/${rawId}/events`
      : isCaeJob
        ? `/api/v1/cae/jobs/${rawId}/events`
        : `/api/v1/jobs/${rawId}/stream`;

    const streamUrl = token ? `${baseStreamPath}?token=${encodeURIComponent(token)}` : baseStreamPath;
    const evtSource = new EventSource(streamUrl);

    evtSource.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === "init") {
          if (Array.isArray(payload.logs) && payload.logs.length > 0) {
            setLogs(payload.logs.join("\n"));
          }
          if (payload.status) {
            setJob((prev) => (prev ? { ...prev, status: normalizeJobStatus(payload.status) } : prev));
          }
        } else if (payload.type === "log" && payload.data) {
          setLogs((prev) => (prev ? `${prev}\n${String(payload.data)}` : String(payload.data)));
        } else if (payload.type === "status" && payload.data) {
          const nextStatus = normalizeJobStatus(payload.data.status);
          setJob((prev) => (prev ? { ...prev, status: nextStatus } : prev));
        }
      } catch {
        /* ignore */
      }
    };

    evtSource.addEventListener("status", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        if (data.job) {
          setJob({
            ...data.job,
            status: normalizeJobStatus(data.job.status),
          });
        }
        if (data.steps) setSteps(data.steps);
      } catch {
        /* ignore */
      }
    });

    evtSource.addEventListener("log", (e) => {
      try {
        const text = JSON.parse((e as MessageEvent).data);
        setLogs((prev) => prev + String(text));
      } catch {
        /* ignore */
      }
    });

    evtSource.addEventListener("complete", () => {
      evtSource.close();
      getJobLogs(id)
        .then((text) => {
          if (active) setLogs(formatLogsText(text));
        })
        .catch(() => {
          /* ignore */
        });
    });

    evtSource.onerror = () => {
      evtSource.close();
    };

    return () => {
      active = false;
      evtSource.close();
    };
  }, [id, token]);

  useEffect(() => {
    const container = logContainerRef.current;
    if (container && followLogs) {
      container.scrollTop = container.scrollHeight;
    }
  }, [logs, followLogs]);

  const getStatusIcon = (status: string) => {
    switch (normalizeJobStatus(status)) {
      case "SUCCESS":
        return <CheckCircleFillIcon fill="var(--color-success-fg)" />;
      case "FAILED":
        return <XCircleFillIcon fill="var(--color-danger-fg)" />;
      case "RUNNING":
        return <CircleIcon fill="var(--color-attention-fg)" />;
      default:
        return <ClockIcon fill="var(--color-fg-muted)" />;
    }
  };

  const handleDownloadResult = () => {
    if (!id) return;
    const strId = String(id);
    const isCloudJob = strId.startsWith("cloud-") || strId.startsWith("cloud_");
    const isCaeJob = strId.startsWith("cae-") || strId.startsWith("cae_");
    const rawId = strId.startsWith("cloud-")
      ? strId.slice("cloud-".length)
      : strId.startsWith("cae-")
        ? strId.slice("cae-".length)
        : strId;
    const baseResultPath = isCloudJob
      ? `/api/v1/cloud/jobs/${rawId}/result`
      : isCaeJob
        ? `/api/v1/cae/jobs/${rawId}/results`
        : `/api/v1/jobs/${rawId}/result`;
    const url = `${baseResultPath}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    window.open(url, "_blank");
  };

  const normalizedStatus = job ? normalizeJobStatus(job.status) : "QUEUED";

  if (!loading && loadError && !job) {
    return (
      <Box display="flex" flexDirection="column" style={{ minHeight: "100%", height: "100%" }}>
        <Box
          p={3}
          display="flex"
          alignItems="center"
          gap={3}
          borderBottom="1px solid var(--color-border-subtle)"
          bg="var(--color-canvas-default)"
        >
          <CircleIconButton onClick={() => navigate("/jobs")} aria-label="Back">
            <ArrowLeftIcon size={20} />
          </CircleIconButton>
          <Heading as="h2" style={{ fontSize: "20px", fontWeight: 800, margin: 0, color: "var(--color-fg-default)" }}>
            Job #{id}
          </Heading>
        </Box>
        <Box p={5} display="flex" flexDirection="column" alignItems="center" justifyContent="center" gap={3}>
          <XCircleFillIcon size={32} fill="var(--color-danger-fg)" />
          <Text fontWeight="bold" fontSize={2} color="var(--color-fg-default)">
            Job Not Found
          </Text>
          <Text color="var(--color-fg-muted)" fontSize={1}>
            {loadError}
          </Text>
          <Button onClick={() => navigate("/jobs")}>Back to Cloud Jobs</Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" style={{ minHeight: "100%", height: "100%" }}>
      <Box
        p={3}
        display="flex"
        alignItems="center"
        flexWrap="wrap"
        gap={3}
        borderBottom="1px solid var(--color-border-subtle)"
        bg="var(--color-canvas-default)"
      >
        <CircleIconButton onClick={() => navigate("/jobs")} aria-label="Back">
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        <Box flex={1} style={{ minWidth: 180 }}>
          <Heading as="h2" style={{ fontSize: "20px", fontWeight: 800, margin: 0, color: "var(--color-fg-default)" }}>
            {job ? job.name : `Job #${id}`}
          </Heading>
          {job && (job.started_at || job.type) && (
            <Text fontSize="12px" color="var(--color-fg-muted)">
              {job.type ? `${job.type} • ` : ""}
              Started: {job.started_at ? new Date(job.started_at).toLocaleString() : "N/A"}
            </Text>
          )}
        </Box>
        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
          <Button
            size="small"
            variant={followLogs ? "primary" : "default"}
            aria-pressed={followLogs}
            onClick={() => setFollowLogs((prev) => !prev)}
          >
            {followLogs ? "Following Logs" : "Follow Logs"}
          </Button>
          {job && (
            <>
              <Label
                variant={
                  normalizedStatus === "SUCCESS"
                    ? "success"
                    : normalizedStatus === "FAILED" || normalizedStatus === "CANCELLED"
                      ? "danger"
                      : "attention"
                }
              >
                {normalizedStatus}
              </Label>
              {normalizedStatus === "SUCCESS" && (
                <Button size="small" leadingVisual={DownloadIcon} onClick={handleDownloadResult}>
                  Download Result
                </Button>
              )}
              {(normalizedStatus === "FAILED" || normalizedStatus === "CANCELLED") && (
                <Button
                  size="small"
                  leadingVisual={SyncIcon}
                  onClick={async () => {
                    if (!id) return;
                    try {
                      const retried = await retryJob(id);
                      const nextJob = retried.job ?? retried;
                      setJob({ ...nextJob, status: normalizeJobStatus(nextJob.status) });
                    } catch (err) {
                      console.error("Failed to retry job:", err);
                    }
                  }}
                >
                  Retry Run
                </Button>
              )}
              {(normalizedStatus === "RUNNING" || normalizedStatus === "QUEUED") && (
                <Button
                  variant="danger"
                  size="small"
                  onClick={async () => {
                    if (!id) return;
                    try {
                      await cancelJob(id);
                      setJob((prev) => (prev ? { ...prev, status: "CANCELLED" } : prev));
                    } catch (err) {
                      console.error("Failed to cancel job:", err);
                    }
                  }}
                >
                  Cancel Run
                </Button>
              )}
            </>
          )}
        </Box>
      </Box>

      <Box
        display="flex"
        flex={1}
        sx={{
          flexDirection: ["column", "column", "row"],
          overflow: "hidden",
        }}
      >
        {/* Left Sidebar (Steps) */}
        <Box
          bg="var(--color-canvas-subtle)"
          p={3}
          sx={{
            width: ["100%", "100%", "300px"],
            maxHeight: ["200px", "200px", "none"],
            borderRight: ["none", "none", "1px solid var(--color-border-subtle)"],
            borderBottom: ["1px solid var(--color-border-subtle)", "1px solid var(--color-border-subtle)", "none"],
            overflowY: "auto",
            flexShrink: 0,
          }}
        >
          <Text fontWeight="bold" display="block" mb={3}>
            Execution Steps
          </Text>
          {steps.map((step) => (
            <Box
              key={step.id}
              display="flex"
              alignItems="center"
              p={2}
              mb={2}
              borderRadius="6px"
              bg="var(--color-canvas-default)"
              border="1px solid var(--color-border-default)"
            >
              <Box mr={2}>{getStatusIcon(step.status)}</Box>
              <Text fontSize="14px" fontWeight={step.status === "RUNNING" ? "bold" : "normal"}>
                {step.name}
              </Text>
            </Box>
          ))}
          {steps.length === 0 && (
            <Text color="var(--color-fg-muted)" fontSize="14px">
              No discrete pipeline steps recorded.
            </Text>
          )}
        </Box>

        {/* Right Main Content (Logs) */}
        <Box
          ref={logContainerRef}
          flex={1}
          bg="var(--color-canvas-inset, var(--color-canvas-default, #0d1117))"
          color="var(--color-text-primary, #c9d1d9)"
          p={3}
          style={{ overflowY: "auto", fontFamily: "monospace", fontSize: "13px" }}
          onScroll={(e) => {
            const el = e.currentTarget;
            const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            if (!isNearBottom && followLogs) {
              setFollowLogs(false);
            } else if (isNearBottom && !followLogs) {
              setFollowLogs(true);
            }
          }}
        >
          <AnsiRenderer text={logs || "Waiting for logs..."} />
        </Box>
      </Box>
    </Box>
  );
};

export default ScriptDetailPage;
