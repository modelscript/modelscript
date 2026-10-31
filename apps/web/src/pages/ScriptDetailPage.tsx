// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  BookmarkIcon,
  CheckCircleFillIcon,
  CircleIcon,
  ClockIcon,
  DownloadIcon,
  FileCodeIcon,
  GraphIcon,
  LockIcon,
  PackageIcon,
  PlayIcon,
  ShieldCheckIcon,
  SlidersIcon,
  SyncIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button, Heading, Label, Text } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  cancelJob,
  getJob,
  getJobLogs,
  rerunStudyJob,
  retryJob,
  saveJobAsStudyTemplate,
  type ComputeJob,
  type ComputeJobStep,
  type StudyEnsembleBand,
  type StudyRunResultsPayload,
  type StudyTimeSeries,
} from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { CircleIconButton } from "../components/SharedStyles";
import { parseAnsiLine, renderSpan } from "../components/terminal/AnsiRenderer";
import { safeJsonParse } from "../util/json";
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

const CHART_COLORS = ["#06b6d4", "#10b981", "#a855f7", "#f59e0b", "#ec4899", "#3b82f6"];

function normalizeTimeSeriesVars(series: StudyTimeSeries): {
  t: number[];
  variables: { name: string; unit?: string | undefined; values: number[] }[];
} {
  const t = series.time || series.t || [];
  if (Array.isArray(series.variables) && series.variables.length > 0) {
    return { t, variables: series.variables };
  }
  if (series.series && typeof series.series === "object") {
    const variables = Object.entries(series.series).map(([name, values]) => ({
      name,
      values: Array.isArray(values) ? values : [],
    }));
    return { t, variables };
  }
  return { t, variables: [] };
}

const EnsembleFanChartSvg: React.FC<{ band: StudyEnsembleBand }> = ({ band }) => {
  const width = 620;
  const height = 240;
  const padLeft = 52;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const tVec = band.time || band.t || [];
  const n = Math.min(tVec.length, band.p05.length, band.p50.length, band.p95.length);
  if (n < 2) return null;

  const tMin = tVec[0] ?? 0;
  const tMax = tVec[n - 1] ?? 1;
  const allVals = [...band.p05.slice(0, n), ...band.p95.slice(0, n), ...band.mean.slice(0, n)];
  let yMin = Math.min(...allVals);
  let yMax = Math.max(...allVals);
  if (Math.abs(yMax - yMin) < 1e-9) {
    yMin -= 1;
    yMax += 1;
  } else {
    const margin = (yMax - yMin) * 0.08;
    yMin -= margin;
    yMax += margin;
  }

  const toX = (t: number) => padLeft + ((t - tMin) / Math.max(1e-9, tMax - tMin)) * plotW;
  const toY = (v: number) => padTop + plotH - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * plotH;

  const upperPts: string[] = [];
  const lowerPts: string[] = [];
  const p50Pts: string[] = [];
  const meanPts: string[] = [];

  for (let i = 0; i < n; i++) {
    const x = toX(tVec[i]!).toFixed(1);
    upperPts.push(`${x},${toY(band.p95[i]!).toFixed(1)}`);
    lowerPts.unshift(`${x},${toY(band.p05[i]!).toFixed(1)}`);
    p50Pts.push(`${x},${toY(band.p50[i]!).toFixed(1)}`);
    if (band.mean[i] !== undefined) {
      meanPts.push(`${x},${toY(band.mean[i]!).toFixed(1)}`);
    }
  }

  const areaPolygon = [...upperPts, ...lowerPts].join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((frac, idx) => {
        const y = padTop + frac * plotH;
        const val = yMax - frac * (yMax - yMin);
        return (
          <g key={idx}>
            <line
              x1={padLeft}
              y1={y}
              x2={width - padRight}
              y2={y}
              stroke="rgba(148, 163, 184, 0.16)"
              strokeDasharray="3 3"
            />
            <text
              x={padLeft - 6}
              y={y + 4}
              textAnchor="end"
              fill="var(--color-fg-muted)"
              fontSize="10"
              fontFamily="monospace"
            >
              {val.toFixed(2)}
            </text>
          </g>
        );
      })}

      {/* P05 - P95 Confidence Envelope */}
      <polygon points={areaPolygon} fill="rgba(168, 85, 247, 0.20)" />
      <polyline
        fill="none"
        stroke="rgba(168, 85, 247, 0.55)"
        strokeWidth="1.2"
        strokeDasharray="4 3"
        points={upperPts.join(" ")}
      />
      <polyline
        fill="none"
        stroke="rgba(168, 85, 247, 0.55)"
        strokeWidth="1.2"
        strokeDasharray="4 3"
        points={[...lowerPts].reverse().join(" ")}
      />

      {/* Mean Curve */}
      {meanPts.length > 1 && (
        <polyline fill="none" stroke="#06b6d4" strokeWidth="1.8" strokeDasharray="2 2" points={meanPts.join(" ")} />
      )}

      {/* P50 Median Curve */}
      <polyline fill="none" stroke="#a855f7" strokeWidth="2.4" points={p50Pts.join(" ")} />

      {/* X axis labels */}
      {[0, 0.5, 1].map((frac, idx) => {
        const x = padLeft + frac * plotW;
        const tVal = tMin + frac * (tMax - tMin);
        return (
          <text
            key={idx}
            x={x}
            y={height - 10}
            textAnchor="middle"
            fill="var(--color-fg-muted)"
            fontSize="10"
            fontFamily="monospace"
          >
            t={tVal.toFixed(2)}s
          </text>
        );
      })}
    </svg>
  );
};

const TimeSeriesChartSvg: React.FC<{ series: StudyTimeSeries }> = ({ series }) => {
  const width = 620;
  const height = 240;
  const padLeft = 52;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const { t, variables } = normalizeTimeSeriesVars(series);
  const n = t.length;
  if (n < 2 || variables.length === 0) return null;

  const tMin = t[0] ?? 0;
  const tMax = t[n - 1] ?? 1;
  const allVals = variables.flatMap((v: { name: string; values: number[] }) => v.values.slice(0, n));
  let yMin = Math.min(...allVals);
  let yMax = Math.max(...allVals);
  if (Math.abs(yMax - yMin) < 1e-9) {
    yMin -= 1;
    yMax += 1;
  } else {
    const margin = (yMax - yMin) * 0.08;
    yMin -= margin;
    yMax += margin;
  }

  const toX = (timeVal: number) => padLeft + ((timeVal - tMin) / Math.max(1e-9, tMax - tMin)) * plotW;
  const toY = (v: number) => padTop + plotH - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * plotH;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((frac, idx) => {
        const y = padTop + frac * plotH;
        const val = yMax - frac * (yMax - yMin);
        return (
          <g key={idx}>
            <line
              x1={padLeft}
              y1={y}
              x2={width - padRight}
              y2={y}
              stroke="rgba(148, 163, 184, 0.16)"
              strokeDasharray="3 3"
            />
            <text
              x={padLeft - 6}
              y={y + 4}
              textAnchor="end"
              fill="var(--color-fg-muted)"
              fontSize="10"
              fontFamily="monospace"
            >
              {val.toFixed(2)}
            </text>
          </g>
        );
      })}

      {variables.map((v: { name: string; values: number[] }, vIdx: number) => {
        const color = CHART_COLORS[vIdx % CHART_COLORS.length]!;
        const pts: string[] = [];
        for (let i = 0; i < Math.min(n, v.values.length); i++) {
          pts.push(`${toX(t[i]!).toFixed(1)},${toY(v.values[i]!).toFixed(1)}`);
        }
        return <polyline key={v.name} fill="none" stroke={color} strokeWidth="2.2" points={pts.join(" ")} />;
      })}

      {[0, 0.5, 1].map((frac, idx) => {
        const x = padLeft + frac * plotW;
        const tVal = tMin + frac * (tMax - tMin);
        return (
          <text
            key={idx}
            x={x}
            y={height - 10}
            textAnchor="middle"
            fill="var(--color-fg-muted)"
            fontSize="10"
            fontFamily="monospace"
          >
            t={tVal.toFixed(2)}s
          </text>
        );
      })}
    </svg>
  );
};

const ScriptDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  usePageTitle(id ? `Study Run #${id}` : "Study Run Details");
  const navigate = useNavigate();
  const { token } = useAuth();
  const [job, setJob] = useState<ComputeJob | null>(null);
  const [studyResults, setStudyResults] = useState<StudyRunResultsPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [steps, setSteps] = useState<ComputeJobStep[]>([]);
  const [logs, setLogs] = useState<string>("");
  const [followLogs, setFollowLogs] = useState<boolean>(true);
  const [showLockfile, setShowLockfile] = useState<boolean>(false);
  const [showStudyInstance, setShowStudyInstance] = useState<boolean>(false);
  const [isRerunning, setIsRerunning] = useState<boolean>(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState<boolean>(false);
  const [savedTemplateMessage, setSavedTemplateMessage] = useState<string | null>(null);
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

        // Extract studyResults from response or job metadata
        const rawMeta =
          typeof resolvedJob.metadata === "string"
            ? safeJsonParse<Record<string, unknown>>(resolvedJob.metadata, {})
            : (resolvedJob.metadata as Record<string, unknown>) || {};
        const resolvedResults =
          (res as { studyResults?: StudyRunResultsPayload })?.studyResults ||
          (resolvedJob as { studyResults?: StudyRunResultsPayload }).studyResults ||
          (rawMeta as { studyResults?: StudyRunResultsPayload }).studyResults ||
          null;
        setStudyResults(resolvedResults);

        if (res.steps) setSteps(res.steps);
        setLoading(false);

        getJobLogs(id)
          .then((text) => {
            if (active && text) setLogs(formatLogsText(text));
          })
          .catch(() => {
            /* ignore log fetch fallback */
          });
      } catch (err: unknown) {
        if (!active) return;
        setJob(null);
        const errObj = err as { response?: { data?: { error?: string } }; message?: string } | null | undefined;
        setLoadError(errObj?.response?.data?.error || errObj?.message || `Job #${id} could not be found.`);
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

  const handleDownloadStudyInstance = () => {
    const instance = studyResults?.studyInstance;
    if (!instance?.sourceContent) return;
    const blob = new Blob([instance.sourceContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", instance.fileName || "study-instance.sedml");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRerunStudyInstance = async () => {
    if (!id) return;
    setIsRerunning(true);
    try {
      const res = await rerunStudyJob(id);
      if (res?.jobId) {
        navigate(`/jobs/${res.jobId}`);
      }
    } catch (err) {
      console.error("Failed to re-run study instance:", err);
    } finally {
      setIsRerunning(false);
    }
  };

  const handleSaveAsStudyTemplate = async () => {
    if (!id) return;
    setIsSavingTemplate(true);
    setSavedTemplateMessage(null);
    try {
      const defaultName = job?.name ? `${job.name} (Saved Template)` : `Saved Study Template #${id}`;
      const res = await saveJobAsStudyTemplate(id, { name: defaultName });
      const savedName = res?.template?.name || res?.studyDefinition?.name || defaultName;
      if (res?.slug || res?.template?.slug) {
        setSavedTemplateMessage(`Saved to Gallery: ${savedName}`);
      }
    } catch (err) {
      console.error("Failed to save job as study template:", err);
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const normalizedStatus = job ? normalizeJobStatus(job.status) : "QUEUED";

  const activeBand = useMemo(
    () => (studyResults?.ensembleBands && studyResults.ensembleBands.length > 0 ? studyResults.ensembleBands[0] : null),
    [studyResults],
  );

  const normalizedSeriesVars = useMemo(
    () => (studyResults?.timeSeries ? normalizeTimeSeriesVars(studyResults.timeSeries).variables : []),
    [studyResults],
  );

  const lockHash = studyResults?.provenance?.sha256Lock || studyResults?.provenance?.sha256LockHash;
  const resolvedPkgName = studyResults?.packageName || studyResults?.provenance?.packageName;

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
      {/* Top Provenance & Action Header */}
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
        <Box flex={1} style={{ minWidth: 220 }}>
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <Heading as="h2" style={{ fontSize: "20px", fontWeight: 800, margin: 0, color: "var(--color-fg-default)" }}>
              {job ? job.name : `Job #${id}`}
            </Heading>
            {studyResults?.modelName && (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: "var(--font-mono)",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  background: "rgba(6, 182, 212, 0.14)",
                  color: "#06b6d4",
                }}
              >
                Model: {studyResults.modelName}
              </span>
            )}
            {resolvedPkgName && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: "var(--font-mono)",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  background: "rgba(168, 85, 247, 0.14)",
                  color: "#a855f7",
                }}
              >
                <PackageIcon size={12} />
                {resolvedPkgName}
              </span>
            )}
            {studyResults?.studyInstance && (
              <span
                title={`Synthesized Open-Standard Study Instance (${studyResults.studyInstance.fileName})`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: "var(--font-mono)",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  background: "rgba(16, 185, 129, 0.14)",
                  color: "#10b981",
                }}
              >
                <FileCodeIcon size={11} />
                {studyResults.studyInstance.fileName}
              </span>
            )}
            {lockHash && (
              <span
                title="Reproducible Study Lockfile Hash"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  padding: "2px 7px",
                  borderRadius: "6px",
                  background: "var(--color-canvas-subtle)",
                  border: "1px solid var(--color-border-subtle)",
                  color: "var(--color-fg-muted)",
                }}
              >
                <LockIcon size={11} />
                {lockHash.slice(0, 14)}
              </span>
            )}
          </Box>
          {job && (job.started_at || job.type) && (
            <Text fontSize="12px" color="var(--color-fg-muted)">
              {studyResults?.templateName || job.type ? `${studyResults?.templateName || job.type} • ` : ""}
              {studyResults?.executionTarget
                ? `${studyResults.executionTarget === "local-wasm" ? "⚡ Local WASM Engine" : "🚀 Slurm HPC Cluster"} • `
                : ""}
              Started: {job.started_at ? new Date(job.started_at).toLocaleString() : "N/A"}
              {savedTemplateMessage ? ` • ✓ ${savedTemplateMessage}` : ""}
            </Text>
          )}
        </Box>

        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
          {studyResults && (
            <>
              <Button size="small" leadingVisual={PlayIcon} onClick={handleRerunStudyInstance} disabled={isRerunning}>
                {isRerunning ? "Re-running..." : "Re-run Study Instance"}
              </Button>
              <Button
                size="small"
                leadingVisual={BookmarkIcon}
                onClick={handleSaveAsStudyTemplate}
                disabled={isSavingTemplate}
              >
                {isSavingTemplate ? "Saving..." : "Save as Study Template"}
              </Button>
            </>
          )}
          {studyResults?.templateSlug && (
            <Button
              size="small"
              leadingVisual={SlidersIcon}
              onClick={() =>
                navigate(
                  `/jobs/templates/${studyResults.templateSlug}${
                    studyResults.modelName ? `?model=${encodeURIComponent(studyResults.modelName)}` : ""
                  }`,
                )
              }
            >
              Modify in Study Studio
            </Button>
          )}
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

      {/* Scientific Study Results Dashboard (when studyResults payload is present) */}
      {studyResults && (
        <Box
          p={4}
          bg="var(--color-canvas-subtle)"
          borderBottom="1px solid var(--color-border-subtle)"
          display="flex"
          flexDirection="column"
          gap={3}
        >
          {/* KPI Summary Strip */}
          {Array.isArray(studyResults.kpis) && studyResults.kpis.length > 0 && (
            <Box
              display="grid"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                gap: "12px",
              }}
            >
              {studyResults.kpis.map(
                (kpi: {
                  id: string;
                  label: string;
                  value: number | string;
                  unit?: string | undefined;
                  status?: string | undefined;
                }) => {
                  const statusColor =
                    kpi.status === "pass"
                      ? "#10b981"
                      : kpi.status === "warn"
                        ? "#f59e0b"
                        : kpi.status === "fail"
                          ? "#ef4444"
                          : "#06b6d4";
                  return (
                    <Box
                      key={kpi.id}
                      p={3}
                      borderRadius="8px"
                      bg="var(--color-canvas-default)"
                      border="1px solid var(--color-border-default)"
                      style={{ borderLeft: `3px solid ${statusColor}` }}
                    >
                      <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
                        {kpi.label}
                      </Text>
                      <Text
                        fontSize="18px"
                        fontWeight="bold"
                        color="var(--color-fg-default)"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {kpi.value}
                        {kpi.unit ? (
                          <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-fg-muted)" }}>
                            {" "}
                            {kpi.unit}
                          </span>
                        ) : null}
                      </Text>
                    </Box>
                  );
                },
              )}
            </Box>
          )}

          {/* Visualizations Row: Trajectory / Ensemble Fan Chart + Sensitivity / Compliance / Pareto */}
          <Box
            display="grid"
            sx={{
              gridTemplateColumns: ["1fr", "1fr", "minmax(0, 1.35fr) minmax(0, 1fr)"],
              gap: 3,
              alignItems: "stretch",
            }}
          >
            {/* Left Chart Panel: Ensemble Quantile Fan Chart OR Multi-Variable Time-Series */}
            <Box
              p={3}
              borderRadius="10px"
              bg="var(--color-canvas-default)"
              border="1px solid var(--color-border-default)"
            >
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={2}>
                <Box display="flex" alignItems="center" gap={2}>
                  <GraphIcon size={16} />
                  <Heading as="h3" style={{ fontSize: "14px", fontWeight: 700, margin: 0 }}>
                    {activeBand
                      ? `Stochastic Confidence Envelope (P05 / P50 / P95) — ${
                          activeBand.observable || activeBand.variable || "y"
                        }${activeBand.unit ? ` [${activeBand.unit}]` : ""}`
                      : "Simulated State Trajectories"}
                  </Heading>
                </Box>
                {activeBand ? (
                  <Box display="flex" gap={3} fontSize="11px" style={{ fontFamily: "var(--font-mono)" }}>
                    <span style={{ color: "#a855f7" }}>━ P50 Median</span>
                    <span style={{ color: "#06b6d4" }}>┅ Mean</span>
                    <span style={{ color: "rgba(168, 85, 247, 0.8)" }}>▒ P05–P95 Band</span>
                  </Box>
                ) : normalizedSeriesVars.length > 0 ? (
                  <Box
                    display="flex"
                    gap={2}
                    flexWrap="wrap"
                    fontSize="11px"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {normalizedSeriesVars.map((v: { name: string; unit?: string | undefined }, idx: number) => (
                      <span key={v.name} style={{ color: CHART_COLORS[idx % CHART_COLORS.length] }}>
                        ━ {v.name}
                        {v.unit ? ` (${v.unit})` : ""}
                      </span>
                    ))}
                  </Box>
                ) : null}
              </Box>

              {activeBand ? (
                <EnsembleFanChartSvg band={activeBand} />
              ) : studyResults.timeSeries ? (
                <TimeSeriesChartSvg series={studyResults.timeSeries} />
              ) : (
                <Text fontSize="12px" color="var(--color-fg-muted)">
                  No time-series waveform recorded for this study run.
                </Text>
              )}
            </Box>

            {/* Right Panel: Sobol Indices OR Compliance Matrix OR Sweep Sample Summary */}
            <Box
              p={3}
              borderRadius="10px"
              bg="var(--color-canvas-default)"
              border="1px solid var(--color-border-default)"
              display="flex"
              flexDirection="column"
              justifyContent="space-between"
            >
              {Array.isArray(studyResults.complianceMatrix) && studyResults.complianceMatrix.length > 0 ? (
                <Box>
                  <Box display="flex" alignItems="center" gap={2} mb={2}>
                    <ShieldCheckIcon size={16} fill="#10b981" />
                    <Heading as="h3" style={{ fontSize: "14px", fontWeight: 700, margin: 0 }}>
                      Standards Compliance Verification Matrix
                    </Heading>
                  </Box>
                  <Box display="flex" flexDirection="column" gap={2}>
                    {studyResults.complianceMatrix.map(
                      (
                        c: {
                          caseId?: string | undefined;
                          clause?: string | undefined;
                          standardRef?: string | undefined;
                          description?: string | undefined;
                          requirement?: string | undefined;
                          measuredValue?: string | undefined;
                          measured?: string | undefined;
                          limitSpec?: string | undefined;
                          passed?: boolean | undefined;
                          status?: string | undefined;
                        },
                        idx: number,
                      ) => {
                        const titleText = c.standardRef || c.clause || c.caseId || `Clause ${idx + 1}`;
                        const reqText = c.limitSpec || c.requirement || c.description || "";
                        const measText = c.measuredValue || c.measured || "";
                        const badgeStatus = c.status || (c.passed ? "PASS" : "FAIL");
                        return (
                          <Box
                            key={c.caseId || c.clause || idx}
                            p={2}
                            borderRadius="6px"
                            bg="var(--color-canvas-subtle)"
                            border="1px solid var(--color-border-subtle)"
                            display="flex"
                            justifyContent="space-between"
                            alignItems="center"
                            gap={2}
                          >
                            <Box>
                              <Text fontWeight="bold" fontSize="12px" display="block">
                                {titleText}
                                {c.description && c.standardRef ? ` — ${c.description}` : ""}
                              </Text>
                              <Text fontSize="11px" color="var(--color-fg-muted)">
                                Limit: {reqText} · Measured: <strong>{measText}</strong>
                              </Text>
                            </Box>
                            <Label
                              variant={
                                badgeStatus === "PASS" ? "success" : badgeStatus === "WARN" ? "attention" : "danger"
                              }
                            >
                              {badgeStatus}
                            </Label>
                          </Box>
                        );
                      },
                    )}
                  </Box>
                </Box>
              ) : Array.isArray(studyResults.sobolIndices) && studyResults.sobolIndices.length > 0 ? (
                <Box>
                  <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                    <Heading as="h3" style={{ fontSize: "14px", fontWeight: 700, margin: 0 }}>
                      Global Sensitivity Indices (Sobol S₁ & S_T)
                    </Heading>
                    <Text fontSize="11px" color="var(--color-fg-muted)" style={{ fontFamily: "var(--font-mono)" }}>
                      Variance Decomposition
                    </Text>
                  </Box>
                  <Box display="flex" flexDirection="column" gap={2}>
                    {studyResults.sobolIndices.map(
                      (s: { parameter: string; firstOrder: number; totalOrder: number }) => (
                        <Box key={s.parameter}>
                          <Box display="flex" justifyContent="space-between" fontSize="11px" mb={1}>
                            <Text fontWeight="bold" style={{ fontFamily: "var(--font-mono)" }}>
                              {s.parameter}
                            </Text>
                            <Text color="var(--color-fg-muted)" style={{ fontFamily: "var(--font-mono)" }}>
                              S₁={(s.firstOrder * 100).toFixed(1)}% · S_T={(s.totalOrder * 100).toFixed(1)}%
                            </Text>
                          </Box>
                          <div
                            style={{
                              height: "8px",
                              borderRadius: "4px",
                              background: "var(--color-canvas-subtle)",
                              overflow: "hidden",
                              position: "relative",
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.min(100, s.totalOrder * 100)}%`,
                                height: "100%",
                                background: "rgba(168, 85, 247, 0.35)",
                                position: "absolute",
                                left: 0,
                                top: 0,
                              }}
                            />
                            <div
                              style={{
                                width: `${Math.min(100, s.firstOrder * 100)}%`,
                                height: "100%",
                                background: "#06b6d4",
                                position: "absolute",
                                left: 0,
                                top: 0,
                              }}
                            />
                          </div>
                        </Box>
                      ),
                    )}
                  </Box>
                </Box>
              ) : null}

              {/* Provenance Lockfile & Synthesized Study Instance Artifact (.sedml / .ssv / .dakota) */}
              {(studyResults.provenance || studyResults.studyInstance) && (
                <Box mt={3} pt={2} borderTop="1px solid var(--color-border-subtle)">
                  <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                    <Text fontSize="11px" color="var(--color-fg-muted)" style={{ fontFamily: "var(--font-mono)" }}>
                      {studyResults.studyInstance
                        ? `Study Instance: ${studyResults.studyInstance.fileName}`
                        : `Lockfile: ${lockHash}`}
                    </Text>
                    <Box display="flex" gap={1} flexWrap="wrap">
                      {studyResults.studyInstance && (
                        <>
                          <Button size="small" onClick={() => setShowStudyInstance((prev) => !prev)}>
                            {showStudyInstance
                              ? "Hide Study Instance"
                              : `Inspect ${studyResults.studyInstance.fileExtension}`}
                          </Button>
                          <Button size="small" leadingVisual={DownloadIcon} onClick={handleDownloadStudyInstance}>
                            Download {studyResults.studyInstance.fileExtension}
                          </Button>
                        </>
                      )}
                      {studyResults.provenance && (
                        <Button size="small" onClick={() => setShowLockfile((prev) => !prev)}>
                          {showLockfile ? "Hide Lockfile" : "Inspect Lockfile JSON"}
                        </Button>
                      )}
                    </Box>
                  </Box>
                  {showStudyInstance && studyResults.studyInstance && (
                    <pre
                      style={{
                        marginTop: "8px",
                        padding: "10px",
                        borderRadius: "6px",
                        background: "var(--color-canvas-subtle)",
                        border: "1px solid var(--color-border-subtle)",
                        fontSize: "11px",
                        fontFamily: "var(--font-mono)",
                        maxHeight: "180px",
                        overflowY: "auto",
                      }}
                    >
                      {studyResults.studyInstance.sourceContent}
                    </pre>
                  )}
                  {showLockfile && studyResults.provenance && (
                    <pre
                      style={{
                        marginTop: "8px",
                        padding: "10px",
                        borderRadius: "6px",
                        background: "var(--color-canvas-subtle)",
                        border: "1px solid var(--color-border-subtle)",
                        fontSize: "11px",
                        fontFamily: "var(--font-mono)",
                        maxHeight: "150px",
                        overflowY: "auto",
                      }}
                    >
                      {JSON.stringify(studyResults.provenance, null, 2)}
                    </pre>
                  )}
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      )}

      {/* Execution Steps & Live Console Logs */}
      <Box
        display="flex"
        flex={1}
        sx={{
          flexDirection: ["column", "column", "row"],
          overflow: "hidden",
          minHeight: "280px",
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
