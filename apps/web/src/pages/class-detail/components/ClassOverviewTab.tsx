// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowRightIcon,
  BookIcon,
  CpuIcon,
  DashIcon,
  PackageIcon,
  PlugIcon,
  PlusIcon,
  SlidersIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import { Label, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getDiagramUrl, getIconUrl, rewriteModelicaUris, type ClassSummary } from "../../../api";
import CadStepViewer from "../../../components/artifacts/CadStepViewer";
import SysmlViewer from "../../../components/artifacts/SysmlViewer";
import Box from "../../../components/Box";
import type { CategorizedClassComponents } from "../../../components/classTreeUtils";
import InvertedSvg from "../../../components/InvertedSvg";
import {
  DiagramWrap,
  DocCard,
  GlassCard,
  JavadocSection,
  JavadocTable,
  JavadocTableWrap,
  SectionTitle,
  TypeLink,
} from "../styles";
import type { ClassDetail, JobStatus } from "../types";

export interface ClassOverviewTabProps {
  cls: ClassDetail;
  className: string;
  libraryName: string;
  version: string;
  allClasses?: ClassSummary[] | undefined;
  diagramLoaded: boolean;
  setDiagramLoaded: (loaded: boolean) => void;
  diagramError: boolean;
  setDiagramError: (error: boolean) => void;
  retryCount: number;
  setRetryCount: React.Dispatch<React.SetStateAction<number>>;
  jobStatus: JobStatus | null;
  categorized: CategorizedClassComponents;
  renderTypeCell?: ((typeName: string) => React.ReactNode) | undefined;
  onViewParameters?: (() => void) | undefined;
}

export const ClassOverviewTab: React.FC<ClassOverviewTabProps> = ({
  cls,
  className,
  libraryName,
  version,
  allClasses = [],
  diagramLoaded,
  setDiagramLoaded,
  diagramError,
  setDiagramError,
  retryCount,
  setRetryCount,
  jobStatus,
  categorized,
  onViewParameters,
}) => {
  const [diagramZoom, setDiagramZoom] = useState(1);
  const childClasses = useMemo(() => {
    const prefix = `${className}.`;
    const direct = allClasses.filter(
      (c) => c.class_name.startsWith(prefix) && !c.class_name.slice(prefix.length).includes("."),
    );
    if (direct.length > 0) return direct;
    // If this is the root package of a library whose children aren't prefixed by rootName (e.g. SysML -> ISQ, SI, Parts)
    if (className === libraryName) {
      return allClasses.filter((c) => c.class_name !== className && !c.class_name.includes("."));
    }
    return [];
  }, [allClasses, className, libraryName]);

  const isModelicaNoDiagram =
    libraryName.toLowerCase().includes("modelica") &&
    (cls.classKind === "package" ||
      cls.classKind === "type" ||
      cls.classKind === "record" ||
      cls.classKind === "function" ||
      categorized.submodels.length === 0);

  const totalMembersCount =
    categorized.parameters.length + categorized.connectors.length + categorized.submodels.length;

  return (
    <>
      {/* Embedded SysML v2 Architecture Viewer for SysML classes */}
      {cls.sysmlConfig && (
        <JavadocSection>
          <SectionTitle as="h3">
            <WorkflowIcon size={14} /> SysML v2 Architecture &amp; Requirements
          </SectionTitle>
          <SysmlViewer
            viewConfig={{
              title: className,
              ...cls.sysmlConfig,
            }}
          />
        </JavadocSection>
      )}

      {/* Embedded 3D STEP B-Rep Viewer for CAD classes */}
      {cls.cadResourceUrl && (
        <JavadocSection>
          <SectionTitle as="h3">
            <CpuIcon size={14} /> 3D STEP Solid Geometry
          </SectionTitle>
          <CadStepViewer viewConfig={{ url: cls.cadResourceUrl }} />
        </JavadocSection>
      )}

      {/* Schematic / Block Definition Diagram */}
      {!diagramError && !cls.cadResourceUrl && !isModelicaNoDiagram && (
        <div>
          <SectionTitle as="h3">Diagram</SectionTitle>
          <div style={{ position: "relative" }}>
            <DiagramWrap style={{ overflow: "hidden", position: "relative" }}>
              {!diagramLoaded && !diagramError && (
                <div className="skeleton" style={{ width: "100%", height: "280px", borderRadius: "8px" }} />
              )}
              {diagramLoaded && (
                <div
                  style={{
                    position: "absolute",
                    top: 12,
                    right: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    zIndex: 2,
                    background: "var(--color-bg-card, rgba(15, 23, 42, 0.75))",
                    backdropFilter: "blur(8px)",
                    padding: "3px 6px",
                    borderRadius: 6,
                    border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.1))",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setDiagramZoom((z) => Math.max(Number((z - 0.25).toFixed(2)), 0.5))}
                    title="Zoom Out"
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--color-text-muted)",
                      cursor: "pointer",
                      padding: "2px 6px",
                      display: "flex",
                      alignItems: "center",
                      borderRadius: 4,
                    }}
                  >
                    <DashIcon size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiagramZoom(1)}
                    title="Reset Zoom"
                    style={{
                      background: "none",
                      border: "none",
                      color: diagramZoom !== 1 ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-text-muted)",
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "2px 4px",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  >
                    {Math.round(diagramZoom * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiagramZoom((z) => Math.min(Number((z + 0.25).toFixed(2)), 3))}
                    title="Zoom In"
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--color-text-muted)",
                      cursor: "pointer",
                      padding: "2px 6px",
                      display: "flex",
                      alignItems: "center",
                      borderRadius: 4,
                    }}
                  >
                    <PlusIcon size={13} />
                  </button>
                </div>
              )}
              <div
                style={
                  diagramLoaded
                    ? {
                        transform: `scale(${diagramZoom})`,
                        transformOrigin: "center center",
                        transition: "transform 0.15s ease",
                        width: "100%",
                        display: "flex",
                        justifyContent: "center",
                      }
                    : {
                        position: "absolute",
                        opacity: 0,
                        pointerEvents: "none",
                      }
                }
              >
                <InvertedSvg
                  src={`${getDiagramUrl(libraryName, version, className)}?t=${retryCount}`}
                  alt={`${className} diagram`}
                  onLoad={() => setDiagramLoaded(true)}
                  onError={() => {
                    if (jobStatus && jobStatus !== "completed" && jobStatus !== "failed") {
                      setTimeout(() => setRetryCount((p) => p + 1), 3000);
                    } else {
                      setDiagramError(true);
                    }
                  }}
                />
              </div>
            </DiagramWrap>
          </div>
        </div>
      )}

      {/* Documentation */}
      <JavadocSection>
        <SectionTitle as="h3">
          <BookIcon size={14} /> Documentation
        </SectionTitle>
        <DocCard>
          {cls.documentation ? (
            <div
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(rewriteModelicaUris(cls.documentation, version, libraryName)),
              }}
            />
          ) : cls.description ? (
            <Text as="p" style={{ color: "var(--color-text-primary)", lineHeight: 1.7, margin: 0 }}>
              {cls.description}
            </Text>
          ) : (
            <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
              No additional prose documentation declared on this symbol.
            </Text>
          )}
        </DocCard>
      </JavadocSection>

      {/* Package Contents / Nested Classes & Definitions Summary Table */}
      {childClasses.length > 0 && (
        <JavadocSection>
          <SectionTitle as="h3">
            <PackageIcon size={14} /> Package Contents &amp; Nested Definitions ({childClasses.length})
          </SectionTitle>
          <JavadocTableWrap>
            <JavadocTable>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Kind</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {childClasses.map((child) => {
                  const shortChildName = child.class_name.startsWith(`${className}.`)
                    ? child.class_name.slice(className.length + 1)
                    : child.class_name;
                  return (
                    <tr key={child.class_name}>
                      <td>
                        <Box display="flex" alignItems="center" gap="8px">
                          <InvertedSvg
                            src={getIconUrl(libraryName, version, child.class_name)}
                            fallback={<PackageIcon size={14} />}
                            alt=""
                            width={18}
                            height={18}
                          />
                          <TypeLink
                            as={Link}
                            to={`/packages/${libraryName}/${version}/classes/${child.class_name}`}
                            style={{ fontWeight: 600 }}
                          >
                            {shortChildName}
                          </TypeLink>
                        </Box>
                      </td>
                      <td>
                        <Label variant="secondary" style={{ fontSize: 10 }}>
                          {child.class_kind}
                        </Label>
                      </td>
                      <td style={{ color: "var(--color-text-muted)", lineHeight: 1.5 }}>{child.description || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </JavadocTable>
          </JavadocTableWrap>
        </JavadocSection>
      )}

      {/* Compact summary link to Parameters & Ports tab */}
      {totalMembersCount > 0 && onViewParameters && (
        <GlassCard
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
            padding: "14px 20px",
          }}
        >
          <Box display="flex" alignItems="center" gap="12px" flexWrap="wrap">
            {categorized.parameters.length > 0 && (
              <Label variant="secondary" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <SlidersIcon size={12} /> {categorized.parameters.length}{" "}
                {categorized.parameters.length === 1 ? "parameter" : "parameters"}
              </Label>
            )}
            {categorized.connectors.length > 0 && (
              <Label variant="secondary" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <PlugIcon size={12} /> {categorized.connectors.length}{" "}
                {categorized.connectors.length === 1 ? "port" : "ports"}
              </Label>
            )}
            {categorized.submodels.length > 0 && (
              <Label variant="secondary" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <PackageIcon size={12} /> {categorized.submodels.length}{" "}
                {categorized.submodels.length === 1 ? "submodel" : "submodels"}
              </Label>
            )}
          </Box>
          <button
            type="button"
            onClick={onViewParameters}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-accent-cyan, #06b6d4)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: 0,
            }}
          >
            View all parameters, ports &amp; submodels <ArrowRightIcon size={14} />
          </button>
        </GlassCard>
      )}
    </>
  );
};
