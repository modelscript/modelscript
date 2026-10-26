// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleFillIcon,
  CodeIcon,
  CpuIcon,
  DatabaseIcon,
  FileCodeIcon,
  GitPullRequestIcon,
  LinkExternalIcon,
  LinkIcon,
  PackageIcon,
  WorkflowIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button, Label, Text } from "@primer/react";
import React from "react";
import Box from "../../Box";
import {
  ActionsRow,
  ConnectorLine,
  DomainTag,
  NodeBox,
  NodeSub,
  NodeTitle,
  ParityChip,
  ThreadVisualizer,
  TwinCard,
  TwinHeader,
} from "../styles";
import type { DigitalThreadTwin } from "../types";

export interface DigitalThreadTwinCardProps {
  twin: DigitalThreadTwin;
  onJumpToClass: (className: string) => void;
  onJumpToArtifact: (artifactPath: string) => void;
  onLaunchCad: (url: string, title: string) => void;
  onProposeResolution: (twin: DigitalThreadTwin) => void;
}

export const DigitalThreadTwinCard: React.FC<DigitalThreadTwinCardProps> = ({
  twin,
  onJumpToClass,
  onJumpToArtifact,
  onLaunchCad,
  onProposeResolution,
}) => {
  return (
    <TwinCard>
      <TwinHeader>
        <Box display="flex" alignItems="center" gap={2}>
          <Label variant="accent" style={{ fontSize: 11, textTransform: "uppercase" }}>
            {twin.relationship}
          </Label>
          <Text style={{ fontSize: 14, fontWeight: 600, color: "var(--color-fg-default)" }}>
            {twin.source.variable ? `${twin.source.name}.${twin.source.variable}` : twin.source.name}
          </Text>
        </Box>

        <ParityChip $status={twin.parity.status} title={twin.parity.message}>
          {twin.parity.status === "compatible" ? (
            <CheckCircleFillIcon size={14} fill="#3fb950" />
          ) : (
            <XCircleFillIcon size={14} fill="#f85149" />
          )}
          <span>{twin.parity.message}</span>
        </ParityChip>
      </TwinHeader>

      {/* Visualizer Thread Line */}
      <ThreadVisualizer>
        <NodeBox $domain={twin.source.domain}>
          <DomainTag $domain={twin.source.domain}>
            {twin.source.domain === "modelica" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <FileCodeIcon size={12} /> Modelica Class / DAE
              </span>
            )}
            {twin.source.domain === "sysml2" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <WorkflowIcon size={12} /> SysML v2 Definition
              </span>
            )}
            {twin.source.domain === "cad" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <PackageIcon size={12} /> STEP CAD Assembly
              </span>
            )}
            {twin.source.domain === "dataset" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <DatabaseIcon size={12} /> Calibration Dataset
              </span>
            )}
          </DomainTag>
          <NodeTitle title={twin.source.name}>{twin.source.name}</NodeTitle>
          <NodeSub>
            <span>Kind: {twin.source.kind}</span>
            {twin.source.unit && (
              <Label variant="secondary" style={{ fontSize: 10, fontFamily: "monospace" }}>
                unit: {twin.source.unit}
              </Label>
            )}
          </NodeSub>
        </NodeBox>

        <ConnectorLine>
          <LinkIcon size={14} fill="var(--color-fg-muted)" />
        </ConnectorLine>

        <NodeBox $domain={twin.target.domain}>
          <DomainTag $domain={twin.target.domain}>
            {twin.target.domain === "modelica" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <FileCodeIcon size={12} /> Modelica Counterpart
              </span>
            )}
            {twin.target.domain === "sysml2" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <WorkflowIcon size={12} /> SysML v2 Architecture
              </span>
            )}
            {twin.target.domain === "cad" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <PackageIcon size={12} /> STEP CAD 3D B-Rep
              </span>
            )}
            {twin.target.domain === "dataset" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <DatabaseIcon size={12} /> Benchmark Telemetry
              </span>
            )}
          </DomainTag>
          <NodeTitle title={twin.target.name}>{twin.target.name}</NodeTitle>
          <NodeSub>
            <span>Kind: {twin.target.kind}</span>
            {twin.target.unit && (
              <Label variant="secondary" style={{ fontSize: 10, fontFamily: "monospace" }}>
                unit: {twin.target.unit}
              </Label>
            )}
          </NodeSub>
        </NodeBox>
      </ThreadVisualizer>

      {/* 1-Click Cross-Domain Action Triggers */}
      <ActionsRow>
        <Box display="flex" gap={2} flexWrap="wrap">
          {twin.source.domain === "modelica" && (
            <Button
              size="small"
              variant="invisible"
              leadingVisual={CodeIcon}
              onClick={() => onJumpToClass(twin.source.name.split(".").pop() || twin.source.name)}
            >
              View Modelica Code
            </Button>
          )}

          {twin.target.domain === "sysml2" && (
            <Button
              size="small"
              variant="invisible"
              leadingVisual={LinkExternalIcon}
              onClick={() => onJumpToArtifact(twin.target.resourcePath || "sysml/chassis.sysml")}
            >
              Open SysML Architecture
            </Button>
          )}

          {(twin.target.domain === "cad" || twin.source.domain === "cad") && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={CpuIcon}
              onClick={() => onLaunchCad(twin.cadViewerConfig?.url || twin.target.resourcePath || "", twin.target.name)}
            >
              Launch 3D CAD Viewer
            </Button>
          )}

          <Button
            size="small"
            variant="default"
            leadingVisual={GitPullRequestIcon}
            onClick={() => onProposeResolution(twin)}
          >
            Propose Resolution
          </Button>
        </Box>

        <Text style={{ fontSize: 12, color: "var(--color-fg-muted)", fontFamily: "monospace" }}>
          Cross-Domain Salsa Binding Active
        </Text>
      </ActionsRow>
    </TwinCard>
  );
};
