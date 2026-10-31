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
  initialBaseVersion?: string | undefined;
}

export const PackageCompareTab: React.FC<PackageCompareTabProps> = ({
  name,
  version,
  versionList,
  baseVersion,
  initialBaseVersion,
}) => {
  const effectiveInitialBase = initialBaseVersion ?? baseVersion;
  const [baseVer, setBaseVer] = React.useState<string | undefined>(effectiveInitialBase);

  React.useEffect(() => {
    if (effectiveInitialBase) {
      setBaseVer(effectiveInitialBase);
    }
  }, [effectiveInitialBase]);

  const orderedVersions = React.useMemo(() => {
    if (!baseVer || baseVer === version || !versionList.includes(baseVer)) {
      return versionList;
    }
    const withoutBase = versionList.filter((v) => v !== baseVer);
    const currentIdx = withoutBase.indexOf(version);
    if (currentIdx === -1) return versionList;
    const next = [...withoutBase];
    next.splice(currentIdx, 0, baseVer);
    return next;
  }, [versionList, version, baseVer]);

  return (
    <>
      <SectionTitle as="h3">Polyglot Release Comparison</SectionTitle>
      <Text as="p" style={{ color: "var(--color-text-muted)", marginBottom: 24, fontSize: 14 }}>
        Inspect multi-domain architectural, equation, CAD geometry, and parameter shifts between package releases.
      </Text>
      <PolyglotVersionDiffView
        key={`${baseVer || "default"}-${version}`}
        packageName={name}
        currentVersion={version}
        allVersions={orderedVersions}
      />
    </>
  );
};
