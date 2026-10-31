// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BeakerIcon,
  CheckCircleFillIcon,
  CodeIcon,
  DownloadIcon,
  FileCodeIcon,
  LinkIcon,
  PlayIcon,
  PlusCircleIcon,
  RepoForkedIcon,
  ShieldCheckIcon,
  SyncIcon,
  VerifiedIcon,
} from "@primer/octicons-react";
import { Button, Label, Spinner, Text } from "@primer/react";
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getJobStudyInstance,
  rerunStudyJob,
  saveJobAsStudyTemplate,
  type LinkedStudyJobItemPayload,
  type StudyDefinitionPayload,
  type StudyStandardFormat,
} from "../../../api/compute";
import Box from "../../../components/Box";
import { GlassCard, SectionTitle, timeAgo } from "../types";

const STANDARD_BADGE_META: Record<
  StudyStandardFormat,
  { label: string; ext: string; color: string; bg: string; border: string }
> = {
  sedml: {
    label: "SED-ML L1V4",
    ext: ".sedml",
    color: "#38bdf8",
    bg: "rgba(56, 189, 248, 0.12)",
    border: "rgba(56, 189, 248, 0.35)",
  },
  "ssp-ssv": {
    label: "ASAM SSP 2.0",
    ext: ".ssv",
    color: "#a855f7",
    bg: "rgba(168, 85, 247, 0.12)",
    border: "rgba(168, 85, 247, 0.35)",
  },
  dakota: {
    label: "Sandia Dakota",
    ext: ".dakota",
    color: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.12)",
    border: "rgba(245, 158, 11, 0.35)",
  },
};

export interface PackageStudiesTabProps {
  name: string;
  version: string;
  rootClassName?: string | undefined;
  targetModelFilter?: string | undefined;
  targetArtifactFilter?: string | undefined;
  onClearArtifactFilter?: (() => void) | undefined;
  bundledStudies: (StudyDefinitionPayload & { dbId?: number | undefined })[];
  linkedTemplates: (StudyDefinitionPayload & { dbId?: number | undefined })[];
  compatibleTemplates: (StudyDefinitionPayload & { dbId?: number | undefined })[];
  linkedJobs: LinkedStudyJobItemPayload[];
  loading?: boolean | undefined;
  onRefresh?: (() => void) | undefined;
}

export const PackageStudiesTab: React.FC<PackageStudiesTabProps> = ({
  name,
  version,
  rootClassName,
  targetModelFilter,
  targetArtifactFilter,
  onClearArtifactFilter,
  bundledStudies,
  linkedTemplates,
  compatibleTemplates,
  linkedJobs,
  loading,
  onRefresh,
}) => {
  const navigate = useNavigate();
  const [standardFilter, setStandardFilter] = useState<"all" | StudyStandardFormat>("all");
  const [expandedJobInstanceId, setExpandedJobInstanceId] = useState<number | null>(null);
  const [jobInstanceSources, setJobInstanceSources] = useState<Record<number, { filename: string; content: string }>>(
    {},
  );
  const [busyJobId, setBusyJobId] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const activeTarget = targetModelFilter || targetArtifactFilter || "";

  const matchesFilters = (std?: StudyStandardFormat, itemModel?: string | null, itemArt?: string | null) => {
    if (standardFilter !== "all" && (std || "sedml") !== standardFilter) {
      return false;
    }
    if (activeTarget) {
      const q = activeTarget.toLowerCase();
      const shortQ = q.split(/[/.]/).pop() || q;
      const m = (itemModel || "").toLowerCase();
      const a = (itemArt || "").toLowerCase();
      if (m && a && !m.includes(shortQ) && !a.includes(shortQ)) {
        return false;
      }
    }
    return true;
  };

  const filteredJobs = linkedJobs.filter((j) => matchesFilters(j.standardFormat, j.modelName, j.targetArtifact));
  const filteredBundled = bundledStudies.filter((t) =>
    matchesFilters(t.standardFormat, t.targetModel, t.targetArtifact || t.artifactPath),
  );
  const filteredLinkedTemplates = linkedTemplates.filter((t) =>
    matchesFilters(t.standardFormat, t.targetModel, t.targetArtifact),
  );
  const filteredCompatible = compatibleTemplates.filter((t) =>
    standardFilter === "all" ? true : (t.standardFormat || "sedml") === standardFilter,
  );

  const handleToggleInspectInstance = async (job: LinkedStudyJobItemPayload) => {
    if (expandedJobInstanceId === job.id) {
      setExpandedJobInstanceId(null);
      return;
    }
    setExpandedJobInstanceId(job.id);
    if (jobInstanceSources[job.id]) return;

    if (job.studyInstance?.sourceContent) {
      setJobInstanceSources((prev) => ({
        ...prev,
        [job.id]: {
          filename: job.studyInstance!.filename || job.studyInstance!.fileName || `study-${job.id}.sedml`,
          content: job.studyInstance!.sourceContent,
        },
      }));
      return;
    }

    try {
      const res = await getJobStudyInstance(job.id);
      if (res?.studyInstance) {
        setJobInstanceSources((prev) => ({
          ...prev,
          [job.id]: {
            filename: res.studyInstance.filename || res.studyInstance.fileName || `study-${job.id}.sedml`,
            content: res.studyInstance.sourceContent,
          },
        }));
      }
    } catch (err) {
      console.error("Failed to load study instance artifact:", err);
    }
  };

  const handleRerunJob = async (job: LinkedStudyJobItemPayload) => {
    setBusyJobId(job.id);
    setToastMessage(null);
    try {
      const res = await rerunStudyJob(job.id);
      setToastMessage(`Re-executed "${job.name}" as Job #${res.jobId}`);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Failed to re-run study instance:", err);
      setToastMessage("Failed to re-run study instance.");
    } finally {
      setBusyJobId(null);
    }
  };

  const handleSaveJobAsLinkedTemplate = async (job: LinkedStudyJobItemPayload) => {
    setBusyJobId(job.id);
    setToastMessage(null);
    try {
      const res = await saveJobAsStudyTemplate(job.id, {
        name: `${job.name} Blueprint`,
        packageName: name,
        packageVersion: version,
        standardFormat: job.standardFormat,
      });
      setToastMessage(`Saved & linked template "${res.studyDefinition?.name || res.slug}" to ${name}`);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Failed to save job as template:", err);
      setToastMessage("Failed to save job as linked study template.");
    } finally {
      setBusyJobId(null);
    }
  };

  const buildWizardUrl = (slug: string, targetModelOrArtifact?: string | null) => {
    const modelParam = targetModelOrArtifact || activeTarget || rootClassName || name;
    const params = new URLSearchParams();
    params.set("package", name);
    params.set("version", version);
    if (modelParam) params.set("model", modelParam);
    if (targetArtifactFilter) params.set("artifact", targetArtifactFilter);
    return `/jobs/templates/${slug}?${params.toString()}`;
  };

  if (loading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" p={5}>
        <Spinner size="medium" />
      </Box>
    );
  }

  return (
    <div>
      {/* ── Provenance & Cryptographic Immutability Banner ── */}
      <GlassCard
        style={{
          border: "1px solid rgba(6, 182, 212, 0.3)",
          background: "linear-gradient(135deg, rgba(6, 182, 212, 0.07), rgba(168, 85, 247, 0.05))",
          marginBottom: 20,
        }}
      >
        <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={3} flexWrap="wrap">
          <Box style={{ flex: 1, minWidth: 260 }}>
            <Box display="flex" alignItems="center" gap={2} mb={1}>
              <ShieldCheckIcon size={16} fill="#06b6d4" />
              <Text style={{ fontWeight: 700, fontSize: 15, color: "var(--color-text-heading)" }}>
                Linked Engineering Studies, Instances &amp; Jobs
              </Text>
              <Label
                variant="secondary"
                style={{
                  fontSize: 10,
                  borderColor: "rgba(16, 185, 129, 0.4)",
                  color: "#10b981",
                }}
              >
                Signed Release Preserved
              </Label>
            </Box>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
              Published packages are cryptographically signed and immutable. Study instances (<code>.sedml</code>,{" "}
              <code>.ssv</code>, <code>.dakota</code>), reusable study templates, and executed simulation jobs are
              relationally linked to <strong>{name}</strong> and its individual models/artifacts — just like package
              dependents.
            </Text>
          </Box>
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <Button
              variant="primary"
              size="small"
              leadingVisual={PlusCircleIcon}
              onClick={() =>
                navigate(
                  `/jobs?tab=templates&q=${encodeURIComponent(activeTarget || rootClassName || "")}&package=${encodeURIComponent(name)}`,
                )
              }
            >
              Browse Study Gallery
            </Button>
            {filteredCompatible[0] && (
              <Button
                size="small"
                leadingVisual={PlayIcon}
                onClick={() => navigate(buildWizardUrl(filteredCompatible[0]!.slug))}
              >
                Quick Run Study
              </Button>
            )}
          </Box>
        </Box>

        {/* Filter Bar: Open Standards + Active Target Artifact/Model */}
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          gap={2}
          flexWrap="wrap"
          mt={3}
          pt={2}
          style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
        >
          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
            <Text style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginRight: 4, fontWeight: 600 }}>
              Open Standard:
            </Text>
            {(
              [
                { id: "all", label: "All Standards" },
                { id: "sedml", label: "SED-ML (.sedml)" },
                { id: "ssp-ssv", label: "SSP 2.0 (.ssv)" },
                { id: "dakota", label: "Dakota (.dakota)" },
              ] as const
            ).map((pill) => {
              const active = standardFilter === pill.id;
              return (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setStandardFilter(pill.id)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    fontSize: 11.5,
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    border: active ? "1px solid #06b6d4" : "1px solid rgba(255,255,255,0.12)",
                    background: active ? "rgba(6, 182, 212, 0.16)" : "rgba(255,255,255,0.04)",
                    color: active ? "#38bdf8" : "var(--color-text-muted)",
                    transition: "all 0.15s ease",
                  }}
                >
                  {pill.label}
                </button>
              );
            })}
          </Box>

          {activeTarget && (
            <Box display="flex" alignItems="center" gap={2}>
              <Label
                variant="accent"
                style={{
                  fontSize: 11,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <LinkIcon size={11} />
                Filtered to: {activeTarget}
              </Label>
              {onClearArtifactFilter && (
                <Button size="small" variant="invisible" onClick={onClearArtifactFilter} style={{ fontSize: 11 }}>
                  Show All in Package
                </Button>
              )}
            </Box>
          )}
        </Box>
      </GlassCard>

      {toastMessage && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            marginBottom: 16,
            background: "rgba(16, 185, 129, 0.12)",
            border: "1px solid rgba(16, 185, 129, 0.35)",
            color: "#34d399",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 12 }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Section 1: Linked Study Instances & Executed Jobs ── */}
      <SectionTitle as="h3" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <PlayIcon size={16} />
        Linked Study Instances &amp; Executed Jobs ({filteredJobs.length})
      </SectionTitle>
      {filteredJobs.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
          {filteredJobs.map((job) => {
            const stdMeta = STANDARD_BADGE_META[job.standardFormat] || STANDARD_BADGE_META.sedml;
            const instanceData = jobInstanceSources[job.id];
            const isExpanded = expandedJobInstanceId === job.id;
            const isSuccess = job.status === "SUCCESS" || job.status === "completed";

            return (
              <GlassCard key={job.id} style={{ marginBottom: 0, padding: 16 }}>
                <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={3} flexWrap="wrap">
                  <Box style={{ flex: 1, minWidth: 240 }}>
                    <Box display="flex" alignItems="center" gap={2} flexWrap="wrap" mb={1}>
                      <Link
                        to={`/jobs/${job.id}`}
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: "var(--color-text-heading)",
                          textDecoration: "none",
                        }}
                      >
                        {job.name}
                      </Link>
                      <Label variant={isSuccess ? "success" : "attention"} style={{ fontSize: 10 }}>
                        {isSuccess ? <CheckCircleFillIcon size={11} /> : null} {job.status}
                      </Label>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 6,
                          color: stdMeta.color,
                          background: stdMeta.bg,
                          border: `1px solid ${stdMeta.border}`,
                          fontFamily: "var(--font-mono, monospace)",
                        }}
                      >
                        {stdMeta.label} ({stdMeta.ext})
                      </span>
                      <Label variant="secondary" style={{ fontSize: 10 }}>
                        {job.executionTarget === "hpc-cluster" || job.executionTarget === "hpc-slurm"
                          ? "🚀 Slurm HPC"
                          : "⚡ Local WASM"}
                      </Label>
                    </Box>

                    <Box display="flex" alignItems="center" gap={3} flexWrap="wrap" mt={1}>
                      <Text style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                        Bound Model / Artifact:{" "}
                        <code style={{ color: "var(--color-text-primary)" }}>
                          {job.targetArtifact || job.modelName}
                        </code>
                      </Text>
                      {job.sampleCount > 1 && (
                        <Text style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                          Samples: <strong>{job.sampleCount}</strong>
                        </Text>
                      )}
                      {job.createdAt && (
                        <Text style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                          Ran {timeAgo(job.createdAt)}
                        </Text>
                      )}
                    </Box>

                    {/* Top KPIs */}
                    {job.kpis && job.kpis.length > 0 && (
                      <Box display="flex" gap={2} flexWrap="wrap" mt={2}>
                        {job.kpis.slice(0, 4).map((kpi) => (
                          <span
                            key={kpi.id}
                            style={{
                              fontSize: 11,
                              padding: "3px 8px",
                              borderRadius: 6,
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.09)",
                            }}
                          >
                            <span style={{ color: "var(--color-text-muted)" }}>{kpi.label}: </span>
                            <strong style={{ color: "var(--color-text-heading)", fontFamily: "var(--font-mono)" }}>
                              {kpi.value}
                              {kpi.unit ? ` ${kpi.unit}` : ""}
                            </strong>
                          </span>
                        ))}
                      </Box>
                    )}
                  </Box>

                  {/* Action Buttons */}
                  <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                    <Button size="small" leadingVisual={CodeIcon} onClick={() => void handleToggleInspectInstance(job)}>
                      {isExpanded ? `Hide ${stdMeta.ext}` : `Inspect ${stdMeta.ext}`}
                    </Button>
                    <Button
                      as="a"
                      href={`/api/v1/jobs/${job.id}/study-instance?download=1`}
                      download
                      size="small"
                      leadingVisual={DownloadIcon}
                    >
                      {stdMeta.ext}
                    </Button>
                    <Button
                      size="small"
                      leadingVisual={SyncIcon}
                      disabled={busyJobId === job.id}
                      onClick={() => void handleRerunJob(job)}
                    >
                      Re-run
                    </Button>
                    <Button
                      size="small"
                      leadingVisual={RepoForkedIcon}
                      disabled={busyJobId === job.id}
                      onClick={() => void handleSaveJobAsLinkedTemplate(job)}
                    >
                      Save as Template
                    </Button>
                    <Button size="small" variant="primary" onClick={() => navigate(`/jobs/${job.id}`)}>
                      Open Run →
                    </Button>
                  </Box>
                </Box>

                {isExpanded && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 8,
                      background: "rgba(0,0,0,0.35)",
                      border: `1px solid ${stdMeta.border}`,
                    }}
                  >
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                      <Text style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: stdMeta.color }}>
                        {instanceData?.filename || job.studyInstance?.filename || `study-${job.id}${stdMeta.ext}`}
                      </Text>
                      <Text style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                        Reproducible Study Instance Artifact
                      </Text>
                    </Box>
                    <pre
                      style={{
                        margin: 0,
                        maxHeight: 240,
                        overflow: "auto",
                        fontSize: 11.5,
                        lineHeight: 1.45,
                        fontFamily: "var(--font-mono, monospace)",
                        color: "var(--color-text-primary)",
                      }}
                    >
                      {instanceData?.content ||
                        job.studyInstance?.sourceContent ||
                        "Loading study instance artifact..."}
                    </pre>
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      ) : (
        <GlassCard style={{ marginBottom: 28 }}>
          <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0, fontSize: 13.5 }}>
            No executed study instances linked to {activeTarget || name} yet. Select a Study Template below to
            synthesize a <code>.sedml</code>, <code>.ssv</code>, or <code>.dakota</code> study instance and execute a
            job.
          </Text>
        </GlassCard>
      )}

      {/* ── Section 2: Bundled & Linked Study Templates ── */}
      <SectionTitle as="h3" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <BeakerIcon size={16} />
        Linked &amp; Bundled Study Templates ({filteredBundled.length + filteredLinkedTemplates.length})
      </SectionTitle>
      {filteredBundled.length + filteredLinkedTemplates.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 14,
            marginBottom: 28,
          }}
        >
          {[...filteredBundled, ...filteredLinkedTemplates].map((tpl) => {
            const stdFormat = (tpl.standardFormat || "sedml") as StudyStandardFormat;
            const stdMeta = STANDARD_BADGE_META[stdFormat] || STANDARD_BADGE_META.sedml;
            return (
              <GlassCard
                key={tpl.slug}
                style={{
                  marginBottom: 0,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} mb={1}>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 6,
                        color: stdMeta.color,
                        background: stdMeta.bg,
                        border: `1px solid ${stdMeta.border}`,
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    >
                      {stdMeta.label} ({stdMeta.ext})
                    </span>
                    {tpl.bundledInRelease ? (
                      <Label variant="success" style={{ fontSize: 10 }}>
                        <VerifiedIcon size={11} /> Signed in Release
                      </Label>
                    ) : (
                      <Label variant="accent" style={{ fontSize: 10 }}>
                        <LinkIcon size={11} /> Linked Template
                      </Label>
                    )}
                  </Box>
                  <Text
                    style={{
                      fontWeight: 700,
                      fontSize: 15,
                      color: "var(--color-text-heading)",
                      display: "block",
                      marginTop: 6,
                    }}
                  >
                    {tpl.name}
                  </Text>
                  <Text
                    as="p"
                    style={{ fontSize: 12.5, color: "var(--color-text-muted)", margin: "6px 0 10px", lineHeight: 1.45 }}
                  >
                    {tpl.description}
                  </Text>
                  {(tpl.targetModel || tpl.targetArtifact || tpl.artifactPath) && (
                    <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginBottom: 12 }}>
                      Target:{" "}
                      <code style={{ color: "var(--color-text-primary)" }}>
                        {tpl.targetModel || tpl.targetArtifact || tpl.artifactPath}
                      </code>
                    </div>
                  )}
                </div>
                <Button
                  size="small"
                  variant="primary"
                  leadingVisual={PlayIcon}
                  onClick={() => navigate(buildWizardUrl(tpl.slug, tpl.targetModel || tpl.targetArtifact))}
                  style={{ width: "100%" }}
                >
                  Configure &amp; Run Study
                </Button>
              </GlassCard>
            );
          })}
        </div>
      ) : (
        <GlassCard style={{ marginBottom: 28 }}>
          <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0, fontSize: 13.5 }}>
            No custom or bundled study templates linked yet. Run any compatible study template below or save a completed
            job as a linked template.
          </Text>
        </GlassCard>
      )}

      {/* ── Section 3: Compatible Open-Standard Study Templates for 1-Click Launch ── */}
      {filteredCompatible.length > 0 && (
        <>
          <SectionTitle as="h3" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FileCodeIcon size={16} />
            Compatible Open-Standard Study Templates ({filteredCompatible.length})
          </SectionTitle>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 14,
            }}
          >
            {filteredCompatible.map((tpl) => {
              const stdFormat = (tpl.standardFormat || "sedml") as StudyStandardFormat;
              const stdMeta = STANDARD_BADGE_META[stdFormat] || STANDARD_BADGE_META.sedml;
              return (
                <GlassCard
                  key={tpl.slug}
                  style={{
                    marginBottom: 0,
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} mb={1}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 6,
                          color: stdMeta.color,
                          background: stdMeta.bg,
                          border: `1px solid ${stdMeta.border}`,
                          fontFamily: "var(--font-mono, monospace)",
                        }}
                      >
                        {stdMeta.label} ({stdMeta.ext})
                      </span>
                      <Label variant="secondary" style={{ fontSize: 10 }}>
                        {tpl.kind || tpl.category}
                      </Label>
                    </Box>
                    <Text
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        color: "var(--color-text-heading)",
                        display: "block",
                        marginTop: 6,
                      }}
                    >
                      {tpl.name}
                    </Text>
                    <Text
                      as="p"
                      style={{
                        fontSize: 12,
                        color: "var(--color-text-muted)",
                        margin: "6px 0 12px",
                        lineHeight: 1.45,
                      }}
                    >
                      {tpl.description}
                    </Text>
                  </div>
                  <Button
                    size="small"
                    leadingVisual={PlayIcon}
                    onClick={() => navigate(buildWizardUrl(tpl.slug))}
                    style={{ width: "100%" }}
                  >
                    Run on {activeTarget ? activeTarget.split(/[/.]/).pop() : rootClassName || name}
                  </Button>
                </GlassCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
