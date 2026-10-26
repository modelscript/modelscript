// SPDX-License-Identifier: AGPL-3.0-or-later

import { Text } from "@primer/react";
import React from "react";
import type { ArtifactViewerInfo, ClassDetail, ClassSummary } from "../../../api";
import DigitalThreadExplorer from "../../../components/DigitalThreadExplorer";
import { SectionTitle } from "../types";

export interface PackageDigitalThreadTabProps {
  name: string;
  version: string;
  classes: ClassSummary[];
  rootClass?: ClassDetail | null | undefined;
  artifactViewers: ArtifactViewerInfo[];
  onOpenArtifact: (av: ArtifactViewerInfo) => void;
  onNavigateToClass: (className: string) => void;
}

export const PackageDigitalThreadTab: React.FC<PackageDigitalThreadTabProps> = ({
  name,
  version,
  classes,
  rootClass,
  artifactViewers,
  onOpenArtifact,
  onNavigateToClass,
}) => {
  return (
    <>
      <SectionTitle as="h3">Digital Thread Twins &amp; Parity Matrix</SectionTitle>
      <Text as="p" style={{ color: "var(--color-text-muted)", marginBottom: 24, fontSize: 14 }}>
        Inspect interconnected cyber-physical twins spanning continuous Modelica differential equations, SysML v2
        requirements &amp; block definitions, and STEP CAD 3D solids with real-time physical quantity parity.
      </Text>
      <DigitalThreadExplorer
        packageName={name}
        packageVersion={version}
        classes={classes}
        rootClass={rootClass}
        artifactViewers={artifactViewers}
        onNavigateToArtifact={(p) => {
          const av = artifactViewers.find((a) => a.path === p);
          if (av) onOpenArtifact(av);
        }}
        onNavigateToClass={onNavigateToClass}
      />
    </>
  );
};
