import { ArrowLeftIcon, CheckCircleFillIcon, CircleIcon, ClockIcon, XCircleFillIcon } from "@primer/octicons-react";
import { Heading, Label, Text } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Box from "../components/Box";
import { CircleIconButton } from "../components/SharedStyles";

interface JobStep {
  id: number;
  name: string;
  status: string;
}

const ScriptDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<Record<string, unknown> | null>(null);
  const [steps, setSteps] = useState<JobStep[]>([]);
  const [logs, setLogs] = useState<string>("");
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const evtSource = new EventSource(`/api/v1/jobs/${id}/stream`);

    evtSource.addEventListener("status", (e) => {
      try {
        const data = JSON.parse(e.data);
        setJob(data.job);
        setSteps(data.steps || []);
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
      // Fetch historical logs just in case the stream missed something fast
      fetch(`/api/v1/jobs/${id}/logs`)
        .then((res) => res.text())
        .then((text) => setLogs(text))
        .catch(console.error);
    });

    return () => {
      evtSource.close();
    };
  }, [id]);

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
        <CircleIconButton onClick={() => navigate("/scripts")} aria-label="Back">
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        <Box flex={1}>
          <Heading as="h2" style={{ fontSize: "20px", fontWeight: 800, margin: 0, color: "var(--color-fg-default)" }}>
            {job ? job.name : `Job #${id}`}
          </Heading>
        </Box>
        {job && (
          <Label variant={job.status === "SUCCESS" ? "success" : job.status === "FAILED" ? "danger" : "attention"}>
            {job.status}
          </Label>
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
              Waiting for steps...
            </Text>
          )}
        </Box>

        {/* Right Main Content (Logs) */}
        <Box
          flex={1}
          bg="#0d1117"
          color="#c9d1d9"
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
