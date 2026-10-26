// SPDX-License-Identifier: AGPL-3.0-or-later

import { BookIcon, CpuIcon, WorkflowIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import DOMPurify from "dompurify";
import React from "react";
import { getDiagramUrl, rewriteModelicaUris } from "../../../api";
import CadStepViewer from "../../../components/artifacts/CadStepViewer";
import SysmlViewer from "../../../components/artifacts/SysmlViewer";
import type { CategorizedClassComponents } from "../../../components/classTreeUtils";
import InvertedSvg from "../../../components/InvertedSvg";
import { DiagramWrap, DocCard, JavadocSection, SectionTitle } from "../styles";
import type { ClassDetail, JobStatus } from "../types";
import { ClassParametersSection } from "./ClassParametersSection";

export interface ClassOverviewTabProps {
  cls: ClassDetail;
  className: string;
  libraryName: string;
  version: string;
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

      {/* Modelica Schematic Diagram */}
      {!diagramError && !cls.sysmlConfig && !cls.cadResourceUrl && (
        <div style={diagramLoaded ? undefined : { position: "absolute", opacity: 0, pointerEvents: "none" }}>
          <SectionTitle as="h3">Diagram</SectionTitle>
          <DiagramWrap>
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
          </DiagramWrap>
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
              No documentation available for this class.
            </Text>
          )}
        </DocCard>
      </JavadocSection>

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
