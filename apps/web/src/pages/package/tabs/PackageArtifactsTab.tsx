// SPDX-License-Identifier: AGPL-3.0-or-later

import { BeakerIcon, PlayIcon } from "@primer/octicons-react";
import { Button, Label, Spinner, Text } from "@primer/react";
import React, { Suspense } from "react";
import { useNavigate } from "react-router-dom";
import type { ArtifactViewerInfo } from "../../../api";
import type { LinkedStudyJobItemPayload, StudyDefinitionPayload } from "../../../api/compute";
import Box from "../../../components/Box";
import DatasetTableViewer from "../../../components/DatasetTableViewer";
import { ArtifactBadge, ArtifactCard, DomainPill, SectionTitle, type PolyglotDomain } from "../types";

// Lazy-loaded artifact viewers to prevent initial bundle bloat
const AasPackageViewer = React.lazy(() => import("../../../components/artifacts/AasPackageViewer"));
const CadStepViewer = React.lazy(() => import("../../../components/artifacts/CadStepViewer"));
const CfdAnimationViewer = React.lazy(() => import("../../../components/artifacts/CfdAnimationViewer"));
const FmuViewer = React.lazy(() => import("../../../components/artifacts/FmuViewer"));
const GCodeViewer = React.lazy(() => import("../../../components/artifacts/GCodeViewer"));
const MermaidViewer = React.lazy(() => import("../../../components/artifacts/MermaidViewer"));
const SimulationResultViewer = React.lazy(() => import("../../../components/artifacts/SimulationResultViewer"));
const StudyTemplateViewer = React.lazy(() => import("../../../components/artifacts/StudyTemplateViewer"));
const SysmlViewer = React.lazy(() => import("../../../components/artifacts/SysmlViewer"));
const TeiViewer = React.lazy(() => import("../../../components/artifacts/TeiViewer"));
const UsdViewer = React.lazy(() => import("../../../components/artifacts/UsdViewer"));
const VegaViewer = React.lazy(() => import("../../../components/artifacts/VegaViewer"));

export interface PackageArtifactsTabProps {
  name: string;
  version: string;
  availableDomains: { id: string; label: string; count: number; color?: string }[];
  artifactTabDomainFilter: PolyglotDomain;
  setArtifactTabDomainFilter: (filter: PolyglotDomain) => void;
  displayedArtifactViewers: ArtifactViewerInfo[];
  fallbackArtifacts: { path: string; type: string; description?: string }[];
  linkedStudies?:
    | {
        bundledStudies: (StudyDefinitionPayload & { dbId?: number | undefined })[];
        linkedTemplates: (StudyDefinitionPayload & { dbId?: number | undefined })[];
        compatibleTemplates: (StudyDefinitionPayload & { dbId?: number | undefined })[];
        linkedJobs: LinkedStudyJobItemPayload[];
      }
    | undefined;
  onViewArtifactStudies?: ((artifactPath: string) => void) | undefined;
}

function defaultTemplateForArtifact(type: string, pathStr: string): string {
  const t = type.toLowerCase();
  const p = pathStr.toLowerCase();
  if (t.includes("fmu") || p.endsWith(".fmu")) return "fmi-cosim-master";
  if (t.includes("cad") || p.endsWith(".step") || p.endsWith(".stp") || p.endsWith(".scad")) {
    return "calculix-nonlinear-fea";
  }
  if (t.includes("cfd") || p.endsWith(".su2") || p.endsWith(".cfg")) return "su2-rans-polar-sweep";
  if (t.includes("sysml") || p.endsWith(".sysml")) return "sysmlv2-req-verification";
  return "modelica-sundials-dae";
}

export const PackageArtifactsTab: React.FC<PackageArtifactsTabProps> = ({
  name,
  version,
  availableDomains,
  artifactTabDomainFilter,
  setArtifactTabDomainFilter,
  displayedArtifactViewers,
  fallbackArtifacts,
  linkedStudies,
  onViewArtifactStudies,
}) => {
  const navigate = useNavigate();

  const countLinkedForArtifact = (artPath: string, displayName?: string) => {
    if (!linkedStudies) return 0;
    const p = artPath.toLowerCase();
    const shortP = p.split("/").pop() || p;
    const d = (displayName || "").toLowerCase();
    const matchItem = (m?: string | null, a?: string | null) => {
      const mStr = (m || "").toLowerCase();
      const aStr = (a || "").toLowerCase();
      return (
        aStr === p ||
        aStr.endsWith(`/${shortP}`) ||
        mStr.includes(shortP.replace(/\.[^.]+$/, "")) ||
        (d.length > 0 && mStr.includes(d))
      );
    };
    const jobsCount = linkedStudies.linkedJobs.filter((j) => matchItem(j.modelName, j.targetArtifact)).length;
    const tplsCount = linkedStudies.linkedTemplates.filter((t) => matchItem(t.targetModel, t.targetArtifact)).length;
    return jobsCount + tplsCount;
  };

  const renderArtifactStudyHeader = (artPath: string, artType: string, displayName?: string) => {
    const linkedCount = countLinkedForArtifact(artPath, displayName);
    const tplSlug = defaultTemplateForArtifact(artType, artPath);
    const wizardUrl = `/jobs/templates/${tplSlug}?package=${encodeURIComponent(name)}&version=${encodeURIComponent(version)}&artifact=${encodeURIComponent(artPath)}&model=${encodeURIComponent(displayName || artPath)}`;

    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
          padding: "6px 12px",
          marginBottom: 6,
          borderRadius: "8px",
          background: "rgba(15, 23, 42, 0.55)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <code style={{ fontSize: 12, color: "var(--color-text-heading)", fontWeight: 600 }}>{artPath}</code>
          <Label variant="secondary" style={{ fontSize: 10 }}>
            {artType}
          </Label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {onViewArtifactStudies && (
            <Button
              size="small"
              variant="invisible"
              leadingVisual={BeakerIcon}
              onClick={() => onViewArtifactStudies(artPath)}
              style={{ fontSize: 11.5, color: linkedCount > 0 ? "#38bdf8" : "var(--color-text-muted)" }}
            >
              Linked Studies ({linkedCount})
            </Button>
          )}
          <Button size="small" leadingVisual={PlayIcon} onClick={() => navigate(wizardUrl)} style={{ fontSize: 11.5 }}>
            Run Study →
          </Button>
        </div>
      </div>
    );
  };

  return (
    <>
      <SectionTitle as="h3">Bundled Artifacts</SectionTitle>
      <Text as="p" style={{ color: "var(--color-text-muted)", marginBottom: 24, fontSize: 14 }}>
        Artifacts are compiled resources, datasets, or external files bundled with this artifact version. They provide
        pre-compiled simulations (FMUs), CAD models, or supplementary data that can be executed or viewed directly in
        the browser.
      </Text>

      {/* Domain filter buttons in artifacts tab */}
      {availableDomains.filter((d) => d.id !== "modelica").length > 2 && (
        <Box display="flex" gap={2} mb={3} flexWrap="wrap">
          {availableDomains
            .filter((d) => d.id !== "modelica")
            .map((d) => (
              <DomainPill
                key={d.id}
                $active={artifactTabDomainFilter === d.id}
                $color={d.color}
                onClick={() => setArtifactTabDomainFilter(d.id as PolyglotDomain)}
              >
                <span>{d.label}</span>
                <span className="domain-count">{d.count}</span>
              </DomainPill>
            ))}
        </Box>
      )}

      {/* Render enriched artifact viewers from the API */}
      {displayedArtifactViewers.length > 0 ? (
        <Suspense fallback={<Spinner size="small" />}>
          {displayedArtifactViewers.map((av) => {
            const viewerId = av.viewer?.viewer;
            const cfg = (av.viewer?.config || {}) as Record<string, unknown>;
            const resolvedUrl = (cfg.resourceUrl as string) || (cfg.url as string) || av.path;

            if (
              viewerId === "study-template" ||
              av.type === "study-template" ||
              /\.(sedml|ssv|dakota)$/i.test(av.path || "")
            ) {
              return (
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 20 }}>
                  {renderArtifactStudyHeader(av.path, av.type, av.displayName)}
                  <StudyTemplateViewer
                    viewConfig={{
                      title: av.displayName,
                      packageName: name,
                      ...cfg,
                    }}
                    artifactPath={av.path}
                  />
                </div>
              );
            }

            // Render interactive viewers based on handler-provided descriptors
            if (viewerId === "fmu-simulator" || av.type === "fmu") {
              return (
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 20 }}>
                  {renderArtifactStudyHeader(av.path, av.type, av.displayName)}
                  <FmuViewer
                    viewConfig={{
                      url: resolvedUrl,
                      modelName: av.displayName,
                      ...cfg,
                    }}
                  />
                </div>
              );
            }

            if (viewerId === "dataset-table" || av.type === "dataset" || av.type === "csv") {
              return (
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 16 }}>
                  <DatasetTableViewer
                    config={
                      cfg as Record<string, unknown> & {
                        columns?:
                          | {
                              name: string;
                              type: "number" | "string" | "boolean";
                              min?: number | undefined;
                              max?: number | undefined;
                              mean?: number | undefined;
                              unique?: number | undefined;
                            }[]
                          | undefined;
                        rowCount?: number | undefined;
                        format?: string | undefined;
                        previewRows?: string[][] | undefined;
                        hasHeader?: boolean | undefined;
                      }
                    }
                    artifactPath={av.path}
                  />
                </div>
              );
            }

            if (viewerId === "cad-3d-viewer" || av.type === "cad") {
              return (
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 20 }}>
                  {renderArtifactStudyHeader(av.path, av.type, av.displayName)}
                  <CadStepViewer viewConfig={{ url: resolvedUrl, ...cfg }} />
                </div>
              );
            }

            if (viewerId === "sysml-architecture-viewer" || av.type === "sysml2" || av.type === "sysml") {
              return (
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 20 }}>
                  {renderArtifactStudyHeader(av.path, av.type, av.displayName)}
                  <SysmlViewer
                    viewConfig={{
                      title: av.displayName,
                      ...cfg,
                    }}
                  />
                </div>
              );
            }

            if (viewerId === "vega-plot" || av.type === "vega") {
              return (
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 16 }}>
                  <VegaViewer
                    viewConfig={{
                      title: av.displayName,
                      specUrl: resolvedUrl,
                      ...cfg,
                    }}
                  />
                </div>
              );
            }

            if (viewerId === "mermaid-diagram" || av.type === "mermaid") {
              return (
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 16 }}>
                  <MermaidViewer
                    viewConfig={{
                      title: av.displayName,
                      codeUrl: resolvedUrl,
                      ...cfg,
                    }}
                  />
                </div>
              );
            }

            if (viewerId === "simulation-result" || av.type === "simulation-result") {
              return (
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 16 }}>
                  <SimulationResultViewer viewConfig={{ url: resolvedUrl, ...cfg }} />
                </div>
              );
            }

            if (viewerId === "cfd-animation" || av.type === "cfd-animation") {
              return (
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 16 }}>
                  <CfdAnimationViewer viewConfig={{ url: resolvedUrl, ...cfg }} />
                </div>
              );
            }

            if (viewerId === "aas-package" || av.type === "aasx" || av.type === "aas") {
              return (
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 16 }}>
                  <AasPackageViewer
                    viewConfig={{
                      packageName: name || "",
                      version: version || "",
                      ...cfg,
                    }}
                  />
                </div>
              );
            }

            if (viewerId === "gcode-viewer" || av.type === "gcode") {
              return (
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 16 }}>
                  <GCodeViewer viewConfig={{ url: resolvedUrl, ...cfg }} />
                </div>
              );
            }

            if (viewerId === "usd-viewer" || av.type === "usd") {
              return (
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 16 }}>
                  <UsdViewer viewConfig={{ url: resolvedUrl, ...cfg }} />
                </div>
              );
            }

            if (viewerId === "tei-viewer" || viewerId === "tei-document" || av.type === "tei") {
              return (
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 16 }}>
                  <TeiViewer viewConfig={{ url: resolvedUrl, ...cfg }} />
                </div>
              );
            }

            // Fallback: render a generic artifact card for unrecognized types
            return (
              <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 16 }}>
                {renderArtifactStudyHeader(av.path, av.type, av.displayName)}
                <ArtifactCard>
                  <ArtifactBadge $type={av.type}>{av.type}</ArtifactBadge>
                  <Box flex={1}>
                    <Text style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-heading)" }}>{av.path}</Text>
                    <Text as="p" style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                      {av.displayName}
                    </Text>
                  </Box>
                </ArtifactCard>
              </div>
            );
          })}
        </Suspense>
      ) : fallbackArtifacts.length > 0 ? (
        // Fallback to basic artifact list from packument metadata
        <Suspense fallback={<Spinner size="small" />}>
          {fallbackArtifacts.map((artifact, i) => {
            if (artifact.type === "study-template" || /\.(sedml|ssv|dakota)$/i.test(artifact.path || "")) {
              return (
                <div key={i} style={{ marginBottom: 16 }}>
                  {renderArtifactStudyHeader(artifact.path, artifact.type)}
                  <StudyTemplateViewer
                    viewConfig={{
                      title: artifact.path
                        .split("/")
                        .pop()
                        ?.replace(/\.(sedml|ssv|dakota)$/i, ""),
                      description: artifact.description,
                      packageName: name,
                    }}
                    artifactPath={artifact.path}
                  />
                </div>
              );
            }
            return (
              <div key={i} style={{ marginBottom: 16 }}>
                {renderArtifactStudyHeader(artifact.path, artifact.type)}
                <ArtifactCard>
                  <ArtifactBadge $type={artifact.type}>{artifact.type}</ArtifactBadge>
                  <Box flex={1}>
                    <Text style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-heading)" }}>
                      {artifact.path}
                    </Text>
                    {artifact.description && (
                      <Text as="p" style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                        {artifact.description}
                      </Text>
                    )}
                  </Box>
                </ArtifactCard>
              </div>
            );
          })}
        </Suspense>
      ) : (
        <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
          No artifacts bundled with this version.
        </Text>
      )}
    </>
  );
};
