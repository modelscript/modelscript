import {
  BeakerIcon,
  CheckCircleFillIcon,
  ClockIcon,
  FlameIcon,
  GraphIcon,
  LinkIcon,
  PulseIcon,
  RocketIcon,
  ShieldCheckIcon,
  TerminalIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Heading, Label, Text, UnderlineNav } from "@primer/react";
import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Box from "../components/Box";

// ── Types ──────────────────────────────────────────────────────────

interface ScriptTemplate {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon: string;
  config: string;
}

interface Job {
  id: number;
  name: string;
  status: string;
  type: string;
  metadata: string | null;
  started_at: string;
  completed_at: string | null;
}

// ── Icon helpers ───────────────────────────────────────────────────

const statusIcon = (status: string) => {
  switch (status) {
    case "SUCCESS":
      return <CheckCircleFillIcon size={16} fill="var(--color-success-fg)" />;
    case "FAILED":
      return <XCircleFillIcon size={16} fill="var(--color-danger-fg)" />;
    case "RUNNING":
      return <PulseIcon size={16} fill="var(--color-attention-fg)" />;
    default:
      return <ClockIcon size={16} fill="var(--color-fg-muted)" />;
  }
};

const categoryIcon = (icon: string) => {
  switch (icon) {
    case "wind":
      return <RocketIcon size={24} />;
    case "clock":
      return <ClockIcon size={24} />;
    case "flame":
      return <FlameIcon size={24} />;
    case "shield":
      return <ShieldCheckIcon size={24} />;
    case "pulse":
      return <PulseIcon size={24} />;
    case "thermometer":
      return <BeakerIcon size={24} />;
    case "link":
      return <LinkIcon size={24} />;
    case "graph":
      return <GraphIcon size={24} />;
    default:
      return <TerminalIcon size={24} />;
  }
};

const relativeTime = (dateStr: string): string => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

// ── Template Card ──────────────────────────────────────────────────

const TemplateCard: React.FC<{ template: ScriptTemplate; onClick: () => void; isFirst: boolean }> = ({
  template,
  onClick,
  isFirst,
}) => {
  const config = JSON.parse(template.config || "{}");
  return (
    <Box
      onClick={onClick}
      display="flex"
      alignItems="flex-start"
      gap={3}
      p={3}
      style={{
        cursor: "pointer",
        transition: "background 0.15s",
        borderTop: isFirst ? "none" : "1px solid var(--color-border-subtle)",
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) =>
        (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")
      }
      onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        style={{
          width: 24,
          height: 24,
          marginTop: 2,
          color: "var(--color-fg-muted)",
          flexShrink: 0,
        }}
      >
        {categoryIcon(template.icon)}
      </Box>
      <Box flex={1} style={{ minWidth: 0 }}>
        <Box display="flex" alignItems="center" gap={2}>
          <Text fontSize="16px" display="block" color="var(--color-fg-default)">
            {template.name}
          </Text>
          <Label
            variant="outline"
            style={{ fontWeight: "normal", color: "var(--color-fg-muted)", borderColor: "var(--color-border-default)" }}
          >
            {template.category}
          </Label>
        </Box>

        <Text
          fontSize="14px"
          color="var(--color-fg-muted)"
          display="block"
          style={{ lineHeight: 1.5, marginTop: 12, marginBottom: 16 }}
        >
          {template.description.length > 200 ? template.description.slice(0, 200) + "…" : template.description}
        </Text>

        <Box display="flex" alignItems="center" gap={4}>
          {config.solver && (
            <Text fontSize="14px" color="var(--color-fg-default)">
              {config.solver}
            </Text>
          )}
          {config.estimatedDuration && (
            <Box display="flex" alignItems="center" gap={1} color="var(--color-fg-default)">
              <ClockIcon size={14} color="var(--color-fg-muted)" />
              <Text fontSize="14px">{config.estimatedDuration}</Text>
            </Box>
          )}
          {config.steps && (
            <Text fontSize="14px" color="var(--color-fg-default)">
              {config.steps.length} steps
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
};

// ── Job Row ────────────────────────────────────────────────────────

const JobRow: React.FC<{ job: Job; onClick: () => void }> = ({ job, onClick }) => {
  const meta = job.metadata ? JSON.parse(job.metadata) : {};
  return (
    <Box
      p={3}
      display="flex"
      alignItems="center"
      style={{
        cursor: "pointer",
        transition: "background 0.1s",
      }}
      onClick={onClick}
      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) =>
        (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")
      }
      onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      <Box mr={3} display="flex" alignItems="center">
        {statusIcon(job.status)}
      </Box>
      <Box flex={1} style={{ minWidth: 0 }}>
        <Text fontWeight="bold" fontSize="14px" display="block">
          {job.name}
        </Text>
        <Text fontSize="12px" color="var(--color-fg-muted)" display="block">
          #{job.id} · {job.type}
          {meta.templateSlug && (
            <>
              {" "}
              · <code style={{ fontSize: 11 }}>{meta.templateSlug}</code>
            </>
          )}
          {" · "}
          {relativeTime(job.started_at)}
          {job.completed_at && ` · finished ${relativeTime(job.completed_at)}`}
        </Text>
      </Box>
      <Box display="flex" alignItems="center" gap={2}>
        {job.status === "RUNNING" && (
          <Box
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: "var(--color-attention-fg)",
              animation: "pulse 1.5s infinite",
            }}
          />
        )}
        <Label
          variant={
            job.status === "SUCCESS"
              ? "success"
              : job.status === "FAILED"
                ? "danger"
                : job.status === "RUNNING"
                  ? "attention"
                  : "primary"
          }
        >
          {job.status}
        </Label>
      </Box>
    </Box>
  );
};

// ── Main Page ──────────────────────────────────────────────────────

const ScriptsListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "templates";
  const [templates, setTemplates] = useState<ScriptTemplate[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/api/v1/jobs/templates")
      .then((res) => res.json())
      .then((data) => setTemplates(data.templates || []))
      .catch(console.error);

    fetch("/api/v1/jobs")
      .then((res) => res.json())
      .then((data) => setJobs(data.jobs || []))
      .catch(console.error);
  }, []);

  const runningJobs = jobs.filter((j) => j.status === "RUNNING");
  const completedJobs = jobs.filter((j) => j.status !== "RUNNING");
  const grouped = templates.reduce<Record<string, ScriptTemplate[]>>((acc, t) => {
    (acc[t.category] ??= []).push(t);
    return acc;
  }, {});

  return (
    <Box display="flex" flexDirection="column" style={{ minHeight: "100%" }}>
      {/* Header */}
      <Box p={3} borderBottom="1px solid var(--color-border-subtle)" bg="var(--color-canvas-default)">
        <Heading as="h2" style={{ fontSize: "20px", fontWeight: 800, margin: 0, color: "var(--color-fg-default)" }}>
          Scripts & Automations
        </Heading>
        <Text fontSize="13px" color="var(--color-fg-muted)" display="block" style={{ marginTop: 4 }}>
          Reusable simulation templates and their execution history
        </Text>
      </Box>

      {/* Tabs */}
      <Box borderBottom="1px solid var(--color-border-subtle)" bg="var(--color-canvas-default)" px={3}>
        <UnderlineNav aria-label="Scripts navigation">
          <UnderlineNav.Item
            aria-current={activeTab === "templates" ? "page" : undefined}
            onClick={() => setSearchParams({ tab: "templates" })}
            icon={BeakerIcon}
            counter={templates.length}
          >
            Templates
          </UnderlineNav.Item>
          <UnderlineNav.Item
            aria-current={activeTab === "runs" ? "page" : undefined}
            onClick={() => setSearchParams({ tab: "runs" })}
            icon={PlayIcon}
            counter={jobs.length}
          >
            Job Runs
          </UnderlineNav.Item>
        </UnderlineNav>
      </Box>

      {/* Content */}
      <Box p={4} flex={1} style={{ overflowY: "auto" }}>
        {activeTab === "templates" ? (
          /* ── Templates Tab ────────────────────────────── */
          Object.keys(grouped).length === 0 ? (
            <Box p={5} textAlign="center" color="var(--color-fg-muted)">
              <TerminalIcon size={32} />
              <Text display="block" mt={2}>
                No script templates available
              </Text>
            </Box>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <Box key={category} mb={4}>
                <Text fontSize="16px" color="var(--color-fg-default)" display="block" mb={2} px={3}>
                  {category}
                </Text>
                <Box display="flex" flexDirection="column">
                  {items.map((t, idx) => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      isFirst={idx === 0}
                      onClick={() => navigate(`/scripts/templates/${t.id}`)}
                    />
                  ))}
                </Box>
              </Box>
            ))
          )
        ) : (
          /* ── Job Runs Tab ─────────────────────────────── */
          <Box>
            {runningJobs.length > 0 && (
              <Box mb={4}>
                <Text
                  fontWeight="bold"
                  fontSize="13px"
                  color="var(--color-attention-fg)"
                  display="block"
                  mb={2}
                  style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}
                >
                  Running ({runningJobs.length})
                </Text>
                <Box
                  border="1px solid var(--color-attention-emphasis)"
                  borderRadius="6px"
                  overflow="hidden"
                  bg="var(--color-canvas-default)"
                  style={{
                    boxShadow: "0 0 0 1px var(--color-attention-emphasis)",
                  }}
                >
                  {runningJobs.map((job, idx) => (
                    <Box key={job.id} borderTop={idx > 0 ? "1px solid var(--color-border-subtle)" : "none"}>
                      <JobRow job={job} onClick={() => navigate(`/scripts/${job.id}`)} />
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            {completedJobs.length > 0 ? (
              <Box>
                <Text
                  fontWeight="bold"
                  fontSize="13px"
                  color="var(--color-fg-muted)"
                  display="block"
                  mb={2}
                  style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}
                >
                  History ({completedJobs.length})
                </Text>
                <Box
                  border="1px solid var(--color-border-default)"
                  borderRadius="6px"
                  overflow="hidden"
                  bg="var(--color-canvas-default)"
                >
                  {completedJobs.map((job, idx) => (
                    <Box key={job.id} borderTop={idx > 0 ? "1px solid var(--color-border-subtle)" : "none"}>
                      <JobRow job={job} onClick={() => navigate(`/scripts/${job.id}`)} />
                    </Box>
                  ))}
                </Box>
              </Box>
            ) : jobs.length === 0 ? (
              <Box p={5} textAlign="center" color="var(--color-fg-muted)">
                <PlayIcon size={32} />
                <Text display="block" mt={2}>
                  No jobs have been run yet
                </Text>
              </Box>
            ) : null}
          </Box>
        )}
      </Box>

      {/* Pulse animation for running indicator */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </Box>
  );
};

export default ScriptsListPage;
