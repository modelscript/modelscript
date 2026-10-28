// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertFillIcon, AlertIcon, GitCompareIcon } from "@primer/octicons-react";
import { Button, Label, Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import type { NpmPackument } from "../../../api";
import Box from "../../../components/Box";
import { formatDate, GlassCard, SectionTitle, VersionRow } from "../types";

export interface PackageVersionsTabProps {
  name: string;
  version: string;
  versionList: string[];
  packument?: NpmPackument | null | undefined;
  onCompare: (version?: string) => void;
}

export const PackageVersionsTab: React.FC<PackageVersionsTabProps> = ({
  name,
  version,
  versionList,
  packument,
  onCompare,
}) => {
  return (
    <>
      <SectionTitle as="h3">Version History</SectionTitle>
      <GlassCard>
        {versionList.length > 0 ? (
          versionList.map((v) => {
            const vManifest = packument?.versions?.[v];
            const isVManifestYanked = Boolean(vManifest?.yanked || vManifest?.is_yanked);
            const vYankReason =
              typeof vManifest?.yanked === "string" ? vManifest.yanked : (vManifest?.yank_reason as string | undefined);
            const isVManifestDeprecated = Boolean(vManifest?.deprecated);
            const vDepReason = typeof vManifest?.deprecated === "string" ? vManifest.deprecated : null;

            return (
              <VersionRow
                key={v}
                style={{
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 6,
                  padding: "14px 0",
                }}
              >
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
                    <Link
                      to={`/packages/${name}/${v}`}
                      style={{
                        color: "var(--color-link)",
                        textDecoration: "none",
                        fontWeight: v === version ? 600 : 400,
                        fontSize: 14,
                      }}
                    >
                      {v}
                    </Link>
                    {packument?.["dist-tags"]?.["latest"] === v && (
                      <Label variant="accent" style={{ fontSize: 10, padding: "0 6px" }}>
                        latest
                      </Label>
                    )}
                    {v === version && (
                      <Label variant="success" style={{ fontSize: 10, padding: "0 6px" }}>
                        current
                      </Label>
                    )}
                    {isVManifestYanked && (
                      <Label
                        variant="danger"
                        style={{
                          fontSize: 10,
                          padding: "0 6px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <AlertFillIcon size={11} /> yanked
                      </Label>
                    )}
                    {isVManifestDeprecated && (
                      <Label
                        variant="attention"
                        style={{
                          fontSize: 10,
                          padding: "0 6px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <AlertIcon size={11} /> deprecated
                      </Label>
                    )}
                  </Box>
                  <Box display="flex" alignItems="center" gap="12px">
                    {v !== version && (
                      <Button
                        size="small"
                        variant="invisible"
                        leadingVisual={GitCompareIcon}
                        onClick={() => onCompare(v)}
                        style={{ fontSize: 12, padding: "2px 8px" }}
                      >
                        Compare
                      </Button>
                    )}
                    <Text style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
                      {packument?.time?.[v] ? formatDate(packument.time[v]) : ""}
                    </Text>
                  </Box>
                </Box>

                {isVManifestYanked && (
                  <Box
                    style={{
                      fontSize: 12,
                      color: "var(--color-danger-fg, #cf222e)",
                      background: "rgba(207, 34, 46, 0.08)",
                      padding: "4px 8px",
                      borderRadius: 4,
                      marginTop: 2,
                    }}
                  >
                    <strong>Yank reason:</strong> {vYankReason || "Yanked by author"}
                  </Box>
                )}

                {isVManifestDeprecated && vDepReason && (
                  <Box
                    style={{
                      fontSize: 12,
                      color: "#b45309",
                      background: "rgba(217, 119, 6, 0.08)",
                      padding: "4px 8px",
                      borderRadius: 4,
                      marginTop: 2,
                    }}
                  >
                    <strong>Deprecated:</strong> {vDepReason}
                  </Box>
                )}
              </VersionRow>
            );
          })
        ) : (
          <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
            No version history available.
          </Text>
        )}
      </GlassCard>
    </>
  );
};
