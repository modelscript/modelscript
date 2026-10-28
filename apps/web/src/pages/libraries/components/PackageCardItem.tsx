// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertFillIcon,
  AlertIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DesktopDownloadIcon,
  DownloadIcon,
  HourglassIcon,
  LawIcon,
  SyncIcon,
  TerminalIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, Button, Heading, Label, Text } from "@primer/react";
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import type { LibraryListItem } from "../../../api";
import Box from "../../../components/Box";
import { formatDomainLabel, formatTimeAgo } from "../constants";
import { DomainBadge } from "../styles";
import { PackageIcon } from "./PackageIcon";

export interface PackageCardItemProps {
  lib: LibraryListItem;
  copiedPkg: string | null;
  onCopyInstall: (pkgName: string) => void;
}

export const PackageCardItem: React.FC<PackageCardItemProps> = ({ lib, copiedPkg, onCopyInstall }) => {
  const navigate = useNavigate();
  const displayHandle = lib.name.startsWith("@")
    ? lib.name.split("/")[0] || `@${lib.author || lib.name}`
    : `@${lib.author || lib.name}`;
  const domains = lib.domains && lib.domains.length > 0 ? lib.domains : ["modelica"];
  const timeAgoText = formatTimeAgo(lib.publishedAt);

  return (
    <Box
      display="flex"
      alignItems="flex-start"
      justifyContent="space-between"
      p={3}
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
        style={{ textDecoration: "none", color: "inherit", display: "flex", gap: "12px", flex: 1 }}
      >
        <PackageIcon name={lib.name} version={lib.latestVersion || "1.0.0"} />
        <Box flex={1}>
          <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
            <Heading
              as="h4"
              style={{
                fontSize: "15px",
                fontWeight: "bold",
                margin: 0,
                color: "var(--color-text-heading)",
              }}
            >
              {lib.name}
            </Heading>
            {lib.latestVersion && (
              <Label variant="secondary" style={{ fontSize: 11 }}>
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
              margin: "6px 0 8px 0",
              color: "var(--color-text-primary)",
              lineHeight: 1.4,
            }}
          >
            {lib.description || "Engineering model & artifact package"}
          </Text>

          {/* Metadata Footer Row */}
          <Box display="flex" alignItems="center" gap="14px" flexWrap="wrap">
            <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{displayHandle}</Text>
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
            {typeof lib.totalDownloads === "number" && (
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
            {timeAgoText && <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{timeAgoText}</Text>}
          </Box>

          {lib.jobStatus && (lib.jobStatus.status === "pending" || lib.jobStatus.status === "processing") && (
            <Box display="flex" alignItems="center" gap="8px" mt="8px">
              {lib.jobStatus.status === "pending" ? (
                <HourglassIcon size={16} fill="var(--color-text-muted)" />
              ) : (
                <SyncIcon size={16} className="spinner-spin" fill="var(--color-text-muted)" />
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

      {/* Install / Open Action Menu */}
      <Box display="flex" alignItems="center" gap={1} style={{ flexShrink: 0 }}>
        <Button
          size="small"
          leadingVisual={copiedPkg === lib.name ? CheckIcon : CopyIcon}
          onClick={(e) => {
            e.preventDefault();
            onCopyInstall(lib.name);
          }}
          title={`Copy: msx install ${lib.name}`}
        >
          {copiedPkg === lib.name ? "Copied" : "msx install"}
        </Button>
        <ActionMenu>
          <ActionMenu.Button size="small" aria-label={`Install options for ${lib.name}`}>
            Open
          </ActionMenu.Button>
          <ActionMenu.Overlay align="end">
            <ActionList>
              <ActionList.Item onSelect={() => navigate(`/ide#memfs:package-${lib.name}`)}>
                <ActionList.LeadingVisual>
                  <CodeIcon size={14} />
                </ActionList.LeadingVisual>
                Open in ModelScript Web IDE
              </ActionList.Item>
              <ActionList.Item onSelect={() => onCopyInstall(lib.name)}>
                <ActionList.LeadingVisual>
                  <TerminalIcon size={14} />
                </ActionList.LeadingVisual>
                Copy CLI Command (msx install)
              </ActionList.Item>
              <ActionList.Item
                onSelect={() => {
                  window.location.href = `vscode://modelscript.modelscript/install?package=${encodeURIComponent(lib.name)}`;
                }}
              >
                <ActionList.LeadingVisual>
                  <DesktopDownloadIcon size={14} />
                </ActionList.LeadingVisual>
                Install in VS Code Desktop
              </ActionList.Item>
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      </Box>
    </Box>
  );
};
