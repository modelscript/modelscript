// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertFillIcon,
  AlertIcon,
  DownloadIcon,
  GitCompareIcon,
  HistoryIcon,
  ShieldCheckIcon,
  TagIcon,
} from "@primer/octicons-react";
import { Button, Label, Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import { getPackageDownloadUrl, type NpmPackument, type PackageStats } from "../../../api";
import Box from "../../../components/Box";
import { useFeatureFlag } from "../../../FeatureFlagContext";
import { formatDate, GlassCard, SectionTitle, SparklineBar, SparklineContainer, timeAgo, VersionRow } from "../types";

export interface PackageVersionsTabProps {
  name: string;
  version: string;
  versionList: string[];
  packument?: NpmPackument | null | undefined;
  onCompare: (version?: string) => void;
  packageStats?: PackageStats | null | undefined;
}

export const PackageVersionsTab: React.FC<PackageVersionsTabProps> = ({
  name,
  version,
  versionList,
  packument,
  onCompare,
  packageStats,
}) => {
  const hasCompare = useFeatureFlag("package_version_compare");
  const latestTagVersion = packument?.["dist-tags"]?.["latest"] || versionList[0];

  return (
    <>
      {packageStats?.daily &&
        packageStats.daily.some((d) => d.downloads > 0) &&
        (() => {
          const maxVal = Math.max(...packageStats.daily.map((d) => d.downloads), 1);
          const total = packageStats.totalDownloads ?? 0;
          return (
            <GlassCard style={{ padding: "16px 20px", marginBottom: 20 }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}
              >
                <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ms-text-1, var(--color-text-heading))" }}>
                  30-Day Download Trend
                </div>
                <div style={{ fontSize: 12, color: "var(--ms-text-3, var(--color-text-muted))" }}>
                  All-time downloads:{" "}
                  <strong
                    style={{
                      color: "var(--ms-text-1, var(--color-text-primary))",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  >
                    {total.toLocaleString()}
                  </strong>
                </div>
              </div>
              <SparklineContainer>
                {packageStats.daily.map((d) => (
                  <SparklineBar
                    key={d.date}
                    $heightPct={(d.downloads / maxVal) * 100}
                    $active={d.downloads > 0}
                    title={`${d.date}: ${d.downloads} download${d.downloads === 1 ? "" : "s"}`}
                  />
                ))}
              </SparklineContainer>
            </GlassCard>
          );
        })()}

      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3} flexWrap="wrap" gap={2}>
        <Box display="flex" alignItems="center" gap="8px">
          <HistoryIcon size={16} fill="var(--color-text-muted)" />
          <SectionTitle as="h3" style={{ margin: 0 }}>
            Release History
          </SectionTitle>
          <Label variant="secondary" style={{ fontSize: 11, padding: "0 6px" }}>
            {versionList.length} {versionList.length === 1 ? "release" : "releases"}
          </Label>
        </Box>
        {latestTagVersion && (
          <Text style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Latest stable:{" "}
            <strong style={{ color: "var(--color-text-primary)", fontFamily: "var(--font-mono, monospace)" }}>
              v{latestTagVersion}
            </strong>
          </Text>
        )}
      </Box>

      <GlassCard style={{ padding: "8px 20px" }}>
        {versionList.length > 0 ? (
          versionList.map((v) => {
            const vManifest = packument?.versions?.[v];
            const isVManifestYanked = Boolean(vManifest?.yanked || vManifest?.is_yanked);
            const vYankReason =
              typeof vManifest?.yanked === "string" ? vManifest.yanked : (vManifest?.yank_reason as string | undefined);
            const isVManifestDeprecated = Boolean(vManifest?.deprecated);
            const vDepReason = typeof vManifest?.deprecated === "string" ? vManifest.deprecated : null;
            const isLatest =
              packument?.["dist-tags"]?.["latest"] === v || (!packument?.["dist-tags"] && v === versionList[0]);
            const isCurrent = v === version;
            const publishedTime = packument?.time?.[v];
            const rawShasum = vManifest?.dist?.shasum;
            const cleanShasum = rawShasum ? rawShasum.replace(/^sha256:/i, "") : null;

            const dotColor = isVManifestYanked
              ? "var(--color-danger-fg, #cf222e)"
              : isVManifestDeprecated
                ? "#d97706"
                : isCurrent
                  ? "var(--color-success-fg, #2da44e)"
                  : isLatest
                    ? "var(--color-accent-cyan, #06b6d4)"
                    : "var(--color-text-muted)";

            return (
              <VersionRow
                key={v}
                style={{
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 8,
                  padding: "16px 0",
                }}
              >
                <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="12px">
                  <Box display="flex" flexDirection="column" gap="4px" style={{ minWidth: 0 }}>
                    <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: dotColor,
                          boxShadow: isCurrent ? `0 0 8px ${dotColor}` : "none",
                          flexShrink: 0,
                        }}
                      />
                      <Link
                        to={`/packages/${name}/${v}`}
                        style={{
                          color: isCurrent ? "var(--color-text-heading)" : "var(--color-link)",
                          textDecoration: "none",
                          fontWeight: 700,
                          fontSize: 15,
                          fontFamily: "var(--font-mono, monospace)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <TagIcon size={13} />v{v}
                      </Link>
                      {isLatest && (
                        <Label variant="accent" style={{ fontSize: 10, padding: "0 6px" }}>
                          latest
                        </Label>
                      )}
                      {isCurrent && (
                        <Label variant="success" style={{ fontSize: 10, padding: "0 6px" }}>
                          viewing
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

                    <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap" style={{ paddingLeft: 16 }}>
                      {publishedTime ? (
                        <Text style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                          Published {timeAgo(publishedTime)} · {formatDate(publishedTime)}
                        </Text>
                      ) : (
                        <Text style={{ color: "var(--color-text-muted)", fontSize: 12 }}>Release archive</Text>
                      )}
                      {cleanShasum && (
                        <>
                          <span style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>·</span>
                          <span
                            title={`sha256:${cleanShasum}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 11,
                              fontFamily: "var(--font-mono, monospace)",
                              color: "var(--color-text-muted)",
                            }}
                          >
                            <ShieldCheckIcon size={12} fill="var(--color-success-fg, #2da44e)" />
                            sha256:{cleanShasum.slice(0, 10)}…
                          </span>
                        </>
                      )}
                    </Box>
                  </Box>

                  <Box display="flex" alignItems="center" gap="8px">
                    {hasCompare && versionList.length > 1 && v !== version && (
                      <Button
                        size="small"
                        leadingVisual={GitCompareIcon}
                        onClick={() => onCompare(v)}
                        style={{ fontSize: 12 }}
                      >
                        Compare
                      </Button>
                    )}
                    <Button
                      as="a"
                      href={getPackageDownloadUrl(name, v)}
                      download
                      size="small"
                      leadingVisual={DownloadIcon}
                      title={`Download ${name} v${v} source archive (.zip)`}
                      style={{ fontSize: 12, textDecoration: "none" }}
                    >
                      .zip
                    </Button>
                  </Box>
                </Box>

                {isVManifestYanked && (
                  <Box
                    style={{
                      fontSize: 12,
                      color: "var(--color-danger-fg, #cf222e)",
                      background: "rgba(207, 34, 46, 0.08)",
                      padding: "6px 10px",
                      borderRadius: 6,
                      marginLeft: 16,
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
                      padding: "6px 10px",
                      borderRadius: 6,
                      marginLeft: 16,
                    }}
                  >
                    <strong>Deprecated:</strong> {vDepReason}
                  </Box>
                )}
              </VersionRow>
            );
          })
        ) : (
          <Box style={{ padding: "24px 0", textAlign: "center" }}>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
              No version history available.
            </Text>
          </Box>
        )}
      </GlassCard>
    </>
  );
};
