// SPDX-License-Identifier: AGPL-3.0-or-later

import { Text } from "@primer/react";
import React from "react";
import { PolyglotVersionDiffView } from "../../../components/PolyglotVersionDiffView";
import { SectionTitle } from "../types";

export interface PackageCompareTabProps {
  name: string;
  version: string;
  versionList: string[];
}

export const PackageCompareTab: React.FC<PackageCompareTabProps> = ({ name, version, versionList }) => {
  return (
    <>
      <SectionTitle as="h3">Polyglot Release Comparison</SectionTitle>
      <Text as="p" style={{ color: "var(--color-text-muted)", marginBottom: 24, fontSize: 14 }}>
        Inspect multi-domain architectural, equation, CAD geometry, and parameter shifts between package releases.
      </Text>
      <PolyglotVersionDiffView packageName={name} currentVersion={version} allVersions={versionList} />
    </>
  );
};
