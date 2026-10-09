// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  CheckCircleFillIcon,
  CircleIcon,
  ClockIcon,
  DownloadIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button, Heading, Label, Text } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cancelDbJob, getJobDetails, getJobLogs } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { CircleIconButton } from "../components/SharedStyles";
import { usePageTitle } from "../util/title";

interface JobStep {
  id: number;
  name: string;
  status: string;
}

const ScriptDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  usePageTitle(id ? `Job #${id}` : "Job Details");
  const navigate = useNavigate();
  const { token } = useAuth();
  const [job, setJob] = useState<Record<string, unknown> | null>(null);
  const [steps, setSteps] = useState<JobStep[]>([]);
  const [logs, setLogs] = useState<string>("");
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;

    // Fetch initial details immediately
    getJobDetails(id)
      .then((res) => {
        if (res?.job) {
          setJob(res.job);
          if (res.steps) setSteps(res.steps);
          if (res.job.status === "SUCCESS" || res.job.status === "FAILED" || res.job.status === "CANCELLED") {
            getJobLogs(id)
              .then((text) => setLogs(typeof text === "string" ? text : JSON.stringify(text, null, 2)))
              .catch(console.error);
          }
        }
      })
      .catch(console.error);

    const streamUrl = token
      ? `/api/v1/jobs/${id}/stream?token=${encodeURIComponent(token)}`
      : `/api/v1/jobs/${id}/stream`;
    const evtSource = new EventSource(streamUrl);

    evtSource.addEventListener("status", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.job) setJob(data.job);
        if (data.steps) setSteps(data.steps);
      } catch {
        /* ignore */
      }
    });

    evtSource.addEventListener("log", (e) => {
      try {
        const text = JSON.parse(e.data);
        setLogs((prev) => prev + text);
      } catch {
        /* ignore */
      }
    });

    evtSource.addEventListener("complete", () => {
      evtSource.close();
      getJobLogs(id)
        .then((text) => setLogs(typeof text === "string" ? text : JSON.stringify(text, null, 2)))
        .catch(console.error);
    });

    return () => {
      evtSource.close();
    };
  }, [id, token]);

  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "SUCCESS":
        return <CheckCircleFillIcon color="var(--color-success-fg)" />;
      case "FAILED":
        return <XCircleFillIcon color="var(--color-danger-fg)" />;
      case "RUNNING":
        return <CircleIcon color="var(--color-attention-fg)" />;
      default:
        return <ClockIcon color="var(--color-fg-muted)" />;
    }
  };

  const handleDownloadResult = () => {
    if (!id) return;
    const url = `/api/v1/jobs/${id}/result${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    window.open(url, "_blank");
  };

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
        <Box flex={1}>
          <Heading as="h2" style={{ fontSize: "20px", fontWeight: 800, margin: 0, color: "var(--color-fg-default)" }}>
            {job ? (job.name as string) : `Job #${id}`}
          </Heading>
          {job && (job.started_at || job.type) && (
            <Text fontSize="12px" color="var(--color-fg-muted)">
              {job.type ? `${job.type} • ` : ""}
              Started: {job.started_at ? new Date(job.started_at as string).toLocaleString() : "N/A"}
            </Text>
          )}
        </Box>
        {job && (
          <Box display="flex" alignItems="center" gap={2}>
            <Label
              variant={
                job.status === "SUCCESS"
                  ? "success"
                  : job.status === "FAILED" || job.status === "CANCELLED"
                    ? "danger"
                    : "attention"
              }
            >
              {job.status as string}
            </Label>
            {job.status === "SUCCESS" && (
              <Button size="small" leadingVisual={DownloadIcon} onClick={handleDownloadResult}>
                Download Result
              </Button>
            )}
            {(job.status === "RUNNING" || job.status === "QUEUED") && (
              <Button
                variant="danger"
                size="small"
                onClick={async () => {
                  if (!id) return;
                  try {
                    await cancelDbJob(id);
                    setJob((prev) => (prev ? { ...prev, status: "CANCELLED" } : prev));
                  } catch (err) {
                    console.error("Failed to cancel job:", err);
                  }
                }}
              >
                Cancel Run
              </Button>
            )}
          </Box>
        )}
      </Box>

      <Box display="flex" flex={1} style={{ overflow: "hidden" }}>
        {/* Left Sidebar (Steps) */}
        <Box
          width="300px"
          borderRight="1px solid var(--color-border-subtle)"
          bg="var(--color-canvas-subtle)"
          p={3}
          style={{ overflowY: "auto" }}
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
          flex={1}
          bg="var(--color-canvas-inset, var(--color-canvas-default, #0d1117))"
          color="var(--color-text-primary, #c9d1d9)"
          p={3}
          style={{ overflowY: "auto", fontFamily: "monospace", fontSize: "13px" }}
        >
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordWrap: "break-word" }}>
            {logs || "Waiting for logs..."}
          </pre>
          <div ref={terminalEndRef} />
        </Box>
      </Box>
    </Box>
  );
};

export default ScriptDetailPage;
