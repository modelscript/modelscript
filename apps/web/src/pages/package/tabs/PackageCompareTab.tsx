// SPDX-License-Identifier: AGPL-3.0-or-later

import { Text } from "@primer/react";
import React from "react";
import { PolyglotVersionDiffView } from "../../../components/PolyglotVersionDiffView";
import { SectionTitle } from "../types";

export interface PackageCompareTabProps {
  name: string;
  version: string;
  versionList: string[];
  baseVersion?: string | undefined;
}

export const PackageCompareTab: React.FC<PackageCompareTabProps> = ({ name, version, versionList, baseVersion }) => {
  const orderedVersions = React.useMemo(() => {
    if (!baseVersion || baseVersion === version || !versionList.includes(baseVersion)) {
      return versionList;
    }
    const withoutBase = versionList.filter((v) => v !== baseVersion);
    const currentIdx = withoutBase.indexOf(version);
    if (currentIdx === -1) return versionList;
    const next = [...withoutBase];
    next.splice(currentIdx + 1, 0, baseVersion);
    return next;
  }, [versionList, version, baseVersion]);

  return (
    <>
      <SectionTitle as="h3">Polyglot Release Comparison</SectionTitle>
      <Text as="p" style={{ color: "var(--color-text-muted)", marginBottom: 24, fontSize: 14 }}>
        Inspect multi-domain architectural, equation, CAD geometry, and parameter shifts between package releases.
      </Text>
      <PolyglotVersionDiffView
        key={`${baseVersion || "default"}-${version}`}
        packageName={name}
        currentVersion={version}
        allVersions={orderedVersions}
      />
    </>
  );
};
