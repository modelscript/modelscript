// SPDX-License-Identifier: AGPL-3.0-or-later

import { Spinner, Text } from "@primer/react";
import React, { Suspense } from "react";
import type { ArtifactViewerInfo } from "../../../api";
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
}

export const PackageArtifactsTab: React.FC<PackageArtifactsTabProps> = ({
  name,
  version,
  availableDomains,
  artifactTabDomainFilter,
  setArtifactTabDomainFilter,
  displayedArtifactViewers,
  fallbackArtifacts,
}) => {
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

            // Render interactive viewers based on handler-provided descriptors
            if (viewerId === "fmu-simulator" || av.type === "fmu") {
              return (
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 16 }}>
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
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 16 }}>
                  <CadStepViewer viewConfig={{ url: resolvedUrl, ...cfg }} />
                </div>
              );
            }

            if (viewerId === "sysml-architecture-viewer" || av.type === "sysml2" || av.type === "sysml") {
              return (
                <div id={`artifact-${av.id}`} key={av.id} style={{ marginBottom: 16 }}>
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
              <ArtifactCard id={`artifact-${av.id}`} key={av.id}>
                <ArtifactBadge $type={av.type}>{av.type}</ArtifactBadge>
                <Box flex={1}>
                  <Text style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-heading)" }}>{av.path}</Text>
                  <Text as="p" style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                    {av.displayName}
                  </Text>
                </Box>
              </ArtifactCard>
            );
          })}
        </Suspense>
      ) : fallbackArtifacts.length > 0 ? (
        // Fallback to basic artifact list from packument metadata
        fallbackArtifacts.map((artifact, i) => (
          <ArtifactCard key={i}>
            <ArtifactBadge $type={artifact.type}>{artifact.type}</ArtifactBadge>
            <Box flex={1}>
              <Text style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-heading)" }}>{artifact.path}</Text>
              {artifact.description && (
                <Text as="p" style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                  {artifact.description}
                </Text>
              )}
            </Box>
          </ArtifactCard>
        ))
      ) : (
        <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
          No artifacts bundled with this version.
        </Text>
      )}
    </>
  );
};
