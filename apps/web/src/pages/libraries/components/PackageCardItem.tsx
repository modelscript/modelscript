// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertFillIcon, AlertIcon, DownloadIcon, HourglassIcon, LawIcon } from "@primer/octicons-react";
import { Heading, Label, Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import type { LibraryListItem } from "../../../api";
import Box from "../../../components/Box";
import Spinner from "../../../components/Spinner";
import { formatDomainLabel, formatTimeAgo, inferPackageDomains, splitScopedPackageName } from "../constants";
import { DomainBadge } from "../styles";
import { PackageIcon } from "./PackageIcon";

export interface PackageCardItemProps {
  lib: LibraryListItem;
  copiedPkg?: string | null | undefined;
  onCopyInstall?: ((pkgName: string) => void) | undefined;
}

export const PackageCardItem: React.FC<PackageCardItemProps> = ({ lib }) => {
  const { scope, baseName } = splitScopedPackageName(lib.name);
  const rawScope = scope ? scope.slice(1) : lib.scope;
  const distinctAuthor =
    lib.author &&
    lib.author.toLowerCase() !== lib.name.toLowerCase() &&
    lib.author.toLowerCase() !== (rawScope || "").toLowerCase()
      ? `@${lib.author.replace(/^@/, "")}`
      : null;
  const domains = inferPackageDomains(lib);
  const timeAgoText = formatTimeAgo(lib.publishedAt);
  const hasVisibleRecommendation = Boolean(
    lib.recommendationReason &&
    !lib.recommendationReason.startsWith("Matches #") &&
    (!lib.dependentsCount || !lib.recommendationReason.startsWith("Used by ")),
  );
  const hasFooterMeta = Boolean(
    distinctAuthor ||
    lib.license ||
    (typeof lib.totalDownloads === "number" && lib.totalDownloads > 0) ||
    (typeof lib.dependentsCount === "number" && lib.dependentsCount > 0) ||
    hasVisibleRecommendation ||
    timeAgoText,
  );

  return (
    <Box
      display="flex"
      alignItems="flex-start"
      justifyContent="space-between"
      px="20px"
      py="16px"
      borderBottom="1px solid var(--color-border)"
      sx={{
        gap: "16px",
        transition: "background 0.15s ease",
        "&:hover": {
          background: "var(--surface-row-hover)",
        },
      }}
    >
      <Link
        to={lib.latestVersion ? `/packages/${lib.name}/${lib.latestVersion}` : `/packages/${lib.name}`}
        style={{ textDecoration: "none", color: "inherit", display: "flex", gap: "12px", flex: 1, minWidth: 0 }}
      >
        <PackageIcon
          name={lib.name}
          version={lib.latestVersion || "1.0.0"}
          domains={domains}
          description={lib.description}
        />
        <Box flex={1} minWidth={0}>
          <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
            <Heading
              as="h4"
              style={{
                fontSize: "15px",
                fontWeight: 700,
                margin: 0,
                color: "var(--color-text-heading)",
                lineHeight: 1.3,
              }}
            >
              {scope && <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>{scope}/</span>}
              {baseName}
            </Heading>
            {lib.latestVersion && (
              <Label variant="secondary" style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>
                v{lib.latestVersion}
              </Label>
            )}
            {lib.isYanked && (
              <Label variant="danger" style={{ fontSize: 10 }}>
                <AlertFillIcon size={10} /> yanked
              </Label>
            )}
            {lib.isDeprecated && (
              <Label variant="attention" style={{ fontSize: 10 }} title={lib.deprecationReason || undefined}>
                <AlertIcon size={10} /> deprecated
              </Label>
            )}
            {domains.map((dom) => (
              <DomainBadge key={dom} $domain={dom}>
                {formatDomainLabel(dom)}
              </DomainBadge>
            ))}
          </Box>

          <Text
            as="p"
            style={{
              fontSize: "14px",
              margin: hasFooterMeta ? "6px 0 8px 0" : "6px 0 0 0",
              color: "var(--color-text-primary)",
              lineHeight: 1.4,
            }}
          >
            {lib.description || "Engineering model & artifact package"}
          </Text>

          {/* Metadata Footer Row */}
          {hasFooterMeta && (
            <Box display="flex" alignItems="center" gap="14px" flexWrap="wrap">
              {distinctAuthor && (
                <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{distinctAuthor}</Text>
              )}
              {lib.license && (
                <Text
                  style={{
                    fontSize: "12px",
                    color: "var(--color-text-muted)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <LawIcon size={12} /> {lib.license}
                </Text>
              )}
              {typeof lib.totalDownloads === "number" && lib.totalDownloads > 0 && (
                <Text
                  style={{
                    fontSize: "12px",
                    color: "var(--color-text-muted)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <DownloadIcon size={12} /> {lib.totalDownloads.toLocaleString()} downloads
                </Text>
              )}
              {typeof lib.dependentsCount === "number" && lib.dependentsCount > 0 && (
                <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                  Used by {lib.dependentsCount} {lib.dependentsCount === 1 ? "package" : "packages"}
                </Text>
              )}
              {hasVisibleRecommendation && (
                <Text style={{ fontSize: "11px", color: "var(--color-accent-cyan)", fontWeight: 600 }}>
                  {lib.recommendationReason}
                </Text>
              )}
              {timeAgoText && <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{timeAgoText}</Text>}
            </Box>
          )}

          {lib.jobStatus && (lib.jobStatus.status === "pending" || lib.jobStatus.status === "processing") && (
            <Box display="flex" alignItems="center" gap="8px" mt="8px">
              {lib.jobStatus.status === "pending" ? (
                <HourglassIcon size={16} fill="var(--color-text-muted)" />
              ) : (
                <Spinner size="small" />
              )}
              <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                {lib.jobStatus.status === "pending"
                  ? "Queued for processing..."
                  : `Processing... ${lib.jobStatus.classesProcessed ? `(${lib.jobStatus.classesProcessed} classes)` : ""}`}
              </Text>
            </Box>
          )}
          {lib.jobStatus?.status === "failed" && (
            <Box display="flex" alignItems="center" gap="6px" mt="8px">
              <AlertIcon size={14} fill="var(--color-error)" />
              <Text style={{ fontSize: "12px", color: "var(--color-error)" }}>
                Processing failed: {lib.jobStatus.error || "Unknown error"}
              </Text>
            </Box>
          )}
        </Box>
      </Link>
    </Box>
  );
};
