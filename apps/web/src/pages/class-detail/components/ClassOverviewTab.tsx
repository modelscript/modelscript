// SPDX-License-Identifier: AGPL-3.0-or-later

import { BookIcon, CpuIcon, DashIcon, PackageIcon, PlusIcon, WorkflowIcon } from "@primer/octicons-react";
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
  JavadocSection,
  JavadocTable,
  JavadocTableWrap,
  SectionTitle,
  TypeLink,
} from "../styles";
import type { ClassDetail, JobStatus } from "../types";
import { ClassParametersSection } from "./ClassParametersSection";

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
  renderTypeCell: (typeName: string) => React.ReactNode;
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
  renderTypeCell,
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
        <div style={diagramLoaded ? undefined : { position: "absolute", opacity: 0, pointerEvents: "none" }}>
          <SectionTitle as="h3">Diagram</SectionTitle>
          <div style={{ position: "relative" }}>
            <DiagramWrap style={{ overflow: "hidden", position: "relative" }}>
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
              <div
                style={{
                  transform: `scale(${diagramZoom})`,
                  transformOrigin: "center center",
                  transition: "transform 0.15s ease",
                  width: "100%",
                  display: "flex",
                  justifyContent: "center",
                }}
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

      {/* Javadoc Summary Tables on Overview */}
      <ClassParametersSection
        parameters={categorized.parameters}
        connectors={categorized.connectors}
        submodels={categorized.submodels}
        renderTypeCell={renderTypeCell}
        libraryName={libraryName}
        version={version}
      />
    </>
  );
};
