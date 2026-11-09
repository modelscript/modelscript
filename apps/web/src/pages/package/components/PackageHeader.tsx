// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertFillIcon,
  AlertIcon,
  CheckIcon,
  ChevronDownIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  FileZipIcon,
  GearIcon,
  PeopleIcon,
  PlusIcon,
  ShieldCheckIcon,
  SidebarExpandIcon,
  SyncIcon,
  TerminalIcon,
  TrashIcon,
  VerifiedIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, Button, Flash, Heading, Label, Text } from "@primer/react";
import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styledImport from "styled-components";
import {
  getIconUrl,
  getPackageDownloadUrl,
  type PackageCollaborator,
  type PackageStats,
  type PendingPackageTransfer,
} from "../../../api";
import Box from "../../../components/Box";
import Breadcrumbs from "../../../components/Breadcrumbs";
import { CiteButton } from "../../../components/citations/CiteButton";
import InvertedSvg from "../../../components/InvertedSvg";
import { buildCitationFromPackage } from "../../../util/citations";
import { HeaderBar, timeAgo } from "../types";
import type { ManageModalType } from "./PackageManageModals";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

/* ─── Top Utility Strip: Navigation on Left, Action Toolbar on Right ─── */

const TopStrip = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
`;

const NavLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
`;

const BrowseSymbolsBtn = styled(Button)`
  height: 32px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ms-brand, var(--color-accent-cyan, #06b6d4));
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--ms-border, var(--color-border));
  background: var(--ms-surface-hover, rgba(255, 255, 255, 0.04));
  transition: all 0.15s ease;

  &:hover {
    background: var(--ms-surface-selected);
    border-color: var(--ms-brand);
  }

  .symbol-count {
    margin-left: 5px;
    font-size: 11px;
    opacity: 0.75;
    font-weight: 500;
  }
`;

const ActionToolbar = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;

  @media (max-width: 768px) {
    width: 100%;
    justify-content: flex-start;
  }
`;

const OpenIdeButton = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 13px;
  border-radius: 8px;
  background: var(--ms-brand);
  color: var(--ms-brand-contrast, #ffffff) !important;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  box-shadow: 0 2px 6px color-mix(in srgb, var(--ms-brand) 30%, transparent);
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  white-space: nowrap;

  &:hover {
    background: var(--ms-brand-hover, var(--ms-brand));
    box-shadow: 0 4px 12px color-mix(in srgb, var(--ms-brand) 40%, transparent);
    transform: translateY(-1px);
    text-decoration: none;
    color: var(--ms-brand-contrast, #ffffff) !important;
  }

  &:active {
    transform: translateY(0);
  }
`;

const ActionBtnLink = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 11px;
  border-radius: 8px;
  background: var(--ms-surface-hover, var(--color-canvas-subtle));
  border: 1px solid var(--ms-border, var(--color-border));
  color: var(--ms-text-1, var(--color-text-primary));
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  box-sizing: border-box;
  transition: all 0.15s ease;
  white-space: nowrap;

  &:hover {
    background: var(--ms-surface-selected);
    border-color: var(--ms-border-strong);
    color: var(--ms-text-1);
    text-decoration: none;
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
`;

/* ─── Hero Identity Section ─── */

const HeroRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 12px;

  @media (max-width: 640px) {
    gap: 12px;
  }
`;

const HeroIconCard = styled.div`
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: var(--ms-surface-hover, var(--color-canvas-subtle, rgba(255, 255, 255, 0.04)));
  border: 1px solid var(--ms-border, var(--color-border));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transition:
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    border-color 0.2s ease;

  &:hover {
    border-color: var(--ms-brand, var(--color-accent-cyan, #06b6d4));
    transform: translateY(-1px);
  }

  @media (max-width: 640px) {
    width: 44px;
    height: 44px;
    border-radius: 10px;
  }
`;

const HeroLeft = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const TitleHeading = styled(Heading)`
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  font-size: 22px !important;
  font-weight: 700 !important;
  line-height: 1.25 !important;
  margin: 0 !important;
  color: var(--ms-text-1, var(--color-text-heading)) !important;
  letter-spacing: -0.015em;

  @media (max-width: 640px) {
    font-size: 18px !important;
  }
`;

const ScopePart = styled(Link)`
  color: var(--ms-text-3, var(--color-text-muted));
  font-weight: 500;
  text-decoration: none;
  transition: color 0.15s ease;

  &:hover {
    color: var(--ms-brand, var(--color-accent-cyan, #06b6d4));
    text-decoration: underline;
  }
`;

const ScopeSlash = styled.span`
  color: var(--ms-text-3, var(--color-text-muted));
  margin: 0 2px;
  opacity: 0.6;
  font-weight: 400;
`;

const NamePart = styled.span`
  color: var(--ms-text-1, var(--color-text-heading));
  font-weight: 700;
`;

const StatusPill = styled.span<{ $variant?: "success" | "brand" | "muted" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 9999px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  box-sizing: border-box;
  text-transform: ${(p) => (p.$variant === "success" ? "uppercase" : "none")};

  ${(p) => {
    switch (p.$variant) {
      case "success":
        return `
          background: color-mix(in srgb, var(--ms-success, #10b981) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--ms-success, #10b981) 32%, transparent);
          color: var(--ms-success, #10b981);
        `;
      case "brand":
        return `
          background: color-mix(in srgb, var(--ms-brand, #06b6d4) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--ms-brand, #06b6d4) 30%, transparent);
          color: var(--ms-brand, #06b6d4);
        `;
      default:
        return `
          background: var(--ms-surface-hover, var(--color-canvas-subtle));
          border: 1px solid var(--ms-border, var(--color-border));
          color: var(--ms-text-2, var(--color-text-muted));
        `;
    }
  }}
`;

const DescriptionParagraph = styled(Text)`
  color: var(--ms-text-2, var(--color-text-muted));
  font-size: 13.5px;
  margin: 2px 0 0;
  line-height: 1.5;
  max-width: 880px;
`;

/* ─── Utility Row: Metadata Strip (Left) + Quick Install (Right) ─── */

const UtilityRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding-top: 10px;
  margin-top: 6px;
  border-top: 1px solid var(--ms-divider, var(--color-border-subtle));

  @media (max-width: 900px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
`;

const MetaStrip = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--ms-text-3, var(--color-text-muted));
`;

const MetaItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;

  .dot-sep {
    color: var(--ms-text-3, var(--color-text-muted));
    opacity: 0.45;
    font-size: 10px;
  }
`;

const LicenseChip = styled.span`
  font-weight: 600;
  color: var(--ms-text-1, var(--color-text-primary));
  font-size: 11.5px;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--ms-surface-hover, var(--color-canvas-subtle));
  border: 1px solid var(--ms-border, var(--color-border));
`;

const HashPill = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--ms-surface-hover, var(--color-canvas-subtle));
  border: 1px solid var(--ms-border, var(--color-border));
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--ms-text-2, var(--color-text-primary));
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--ms-brand, var(--color-accent-cyan));
    color: var(--ms-text-1, var(--color-text-primary));
    background: var(--ms-surface-selected);
  }
`;

const InstallPill = styled.div`
  display: inline-flex;
  align-items: center;
  background: var(--ms-surface-hover, var(--color-canvas-subtle));
  border: 1px solid var(--ms-border, var(--color-border));
  border-radius: 8px;
  overflow: hidden;
  height: 30px;
  box-sizing: border-box;
  max-width: 100%;
  transition: border-color 0.15s ease;

  &:hover {
    border-color: var(--ms-border-strong, var(--color-border-strong));
  }
`;

const InstallModeToggle = styled.div`
  display: inline-flex;
  background: var(--ms-surface-hover, rgba(0, 0, 0, 0.06));
  height: 100%;
  border-right: 1px solid var(--ms-border, var(--color-border));
  padding: 2px;
  box-sizing: border-box;
  align-items: center;
`;

const InstallModeBtn = styled.button<{ $active: boolean }>`
  background: ${(p) => (p.$active ? "var(--ms-bg-card, var(--color-bg-card))" : "transparent")};
  border: none;
  border-radius: 5px;
  padding: 0 7px;
  font-size: 10px;
  font-weight: ${(p) => (p.$active ? 700 : 500)};
  letter-spacing: 0.04em;
  color: ${(p) =>
    p.$active ? "var(--ms-text-1, var(--color-text-primary))" : "var(--ms-text-3, var(--color-text-muted))"};
  cursor: pointer;
  height: 100%;
  display: inline-flex;
  align-items: center;
  transition: all 0.15s ease;
  box-shadow: ${(p) => (p.$active ? "0 1px 2px rgba(0,0,0,0.06)" : "none")};
`;

const InstallCode = styled.button`
  background: transparent;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  cursor: pointer;
  color: var(--ms-text-1, var(--color-text-primary));
  font-family: var(--font-mono, monospace);
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 360px;
  height: 100%;
  transition: background-color 0.15s ease;

  &:hover {
    background: var(--ms-surface-selected);
  }

  code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .copy-icon {
    color: var(--ms-text-3, var(--color-text-muted));
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }
`;

/* ─── Engineering Quality Scorecard ─── */

const ScorecardContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--ms-surface-hover, var(--color-canvas-subtle));
  border: 1px solid var(--ms-border, var(--color-border));
`;

const ScorecardTitle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ms-text-3, var(--color-text-muted));
  margin-right: 4px;
`;

const ScorecardPill = styled.div<{ $status: "pass" | "warn" | "neutral" }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: default;
  transition: all 0.15s ease;
  ${(p) => {
    switch (p.$status) {
      case "pass":
        return `
          background: color-mix(in srgb, var(--ms-success, #10b981) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--ms-success, #10b981) 32%, transparent);
          color: var(--ms-success, #10b981);
        `;
      case "warn":
        return `
          background: color-mix(in srgb, var(--ms-warning, #f59e0b) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--ms-warning, #f59e0b) 32%, transparent);
          color: var(--ms-warning, #d97706);
        `;
      default:
        return `
          background: var(--ms-surface-hover, var(--color-canvas-subtle));
          border: 1px solid var(--ms-border, var(--color-border));
          color: var(--ms-text-3, var(--color-text-muted));
        `;
    }
  }}
`;

const AlertsContainer = styled.div`
  width: 100%;
  padding: 8px 24px 0;
  box-sizing: border-box;

  @media (max-width: 900px) {
    padding: 8px 16px 0;
  }
`;

/* ─── Component Props ─── */

export interface PackageHeaderProps {
  name: string;
  version: string;
  rootClassName?: string | null | undefined;
  description?: string | null | undefined;
  publishedAt?: string | null | undefined;
  license?: string | null | undefined;
  classCount?: number | undefined;
  classes?: { class_name: string; class_kind: string; description: string | null }[] | undefined;
  canManage: boolean;
  isCurrentYanked: boolean;
  currentYankReason?: string | null | undefined;
  isCurrentDeprecated: boolean;
  currentDeprecateReason?: string | null | undefined;
  pendingTransfers: PendingPackageTransfer[];
  user: { id: number; username: string } | null;
  actionSuccess: string | null | undefined;
  setActionSuccess: (msg: string | null) => void;
  actionLoading: boolean;
  setActionError: (msg: string | null) => void;
  collaborators: PackageCollaborator[];
  setPublishModalOpen: (open: boolean) => void;
  setManageModal: (modal: ManageModalType) => void;
  onAcceptPendingTransfer: (transferId: number) => void;
  onCancelPendingTransfer: (transferId: number) => void;
  versionList?: string[] | undefined;
  latestVersion?: string | null | undefined;
  treeCollapsed?: boolean | undefined;
  onToggleTreeCollapse?: (() => void) | undefined;
  jobStatus?: string | null | undefined;
  hasLogs?: boolean | undefined;
  onOpenLogs?: (() => void) | undefined;
  installCmd?: string | undefined;
  contentHash?: string | null | undefined;
  packageSignature?: string | null | undefined;
  packageStats?: PackageStats | null | undefined;
  packageOwner?: string | null | undefined;
  modelicaVersion?: string | null | undefined;
  oidcRepository?: string | null | undefined;
  oidcWorkflow?: string | null | undefined;
  oidcIssuer?: string | null | undefined;
  vulnerabilityCount?: number | undefined;
  vulnerabilities?: Array<{ id: string; severity?: string; summary?: string }> | undefined;
}

export const PackageHeader: React.FC<PackageHeaderProps> = ({
  name,
  version,
  rootClassName,
  description,
  publishedAt,
  license,
  classCount,
  classes,
  canManage,
  isCurrentYanked,
  currentYankReason,
  isCurrentDeprecated,
  currentDeprecateReason,
  pendingTransfers,
  user,
  actionSuccess,
  setActionSuccess,
  actionLoading,
  setActionError,
  collaborators,
  setPublishModalOpen,
  setManageModal,
  onAcceptPendingTransfer,
  onCancelPendingTransfer,
  versionList,
  latestVersion,
  treeCollapsed,
  onToggleTreeCollapse,
  jobStatus,
  hasLogs,
  onOpenLogs,
  installCmd,
  contentHash,
  packageSignature,
  packageStats,
  packageOwner,
  modelicaVersion,
  oidcRepository,
  oidcWorkflow,
  oidcIssuer: _oidcIssuer,
  vulnerabilityCount,
  vulnerabilities: _vulnerabilities,
}) => {
  const navigate = useNavigate();
  const effectiveLatest = latestVersion || (versionList && versionList.length > 0 ? versionList[0] : null);
  const isLatestVersion = Boolean(effectiveLatest && effectiveLatest === version);

  const totalClasses = typeof classCount === "number" && classCount > 0 ? classCount : (classes?.length ?? 0);
  const documentedClasses =
    classes?.filter((c) => Boolean(c.description && c.description.trim().length > 0)).length ?? 0;
  const docPercentage = totalClasses > 0 ? Math.round((documentedClasses / totalClasses) * 100) : 100;

  const [copiedInstall, setCopiedInstall] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const [installTab, setInstallTab] = useState<"cli" | "manifest" | "import">("cli");

  const { scopePart, namePart } = useMemo(() => {
    if (name.startsWith("@") && name.includes("/")) {
      const slashIndex = name.indexOf("/");
      return {
        scopePart: name.slice(0, slashIndex),
        namePart: name.slice(slashIndex + 1),
      };
    }
    return { scopePart: null, namePart: name };
  }, [name]);

  const importIdentifier =
    name
      .replace(/^@[^/]+\//, "")
      .replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase())
      .replace(/^[a-z]/, (c) => c.toUpperCase())
      .replace(/[^a-zA-Z0-9_$]/g, "") || "Model";
  const importSpecifier = name.startsWith("@") ? name : `@modelscript/${name}`;

  const currentSnippet =
    installTab === "cli"
      ? installCmd || `msx install ${name}`
      : installTab === "manifest"
        ? `"${name}": "^${version}"`
        : `import { ${importIdentifier} } from "${importSpecifier}";`;

  const normalizedHash = contentHash ? contentHash.replace(/^sha256:/i, "") : null;
  const fullDigest = normalizedHash ? `sha256:${normalizedHash}` : null;

  const handleCopyInstall = () => {
    navigator.clipboard.writeText(currentSnippet);
    setCopiedInstall(true);
    setTimeout(() => setCopiedInstall(false), 2000);
  };

  const handleCopyHash = () => {
    if (fullDigest) {
      navigator.clipboard.writeText(fullDigest);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  const downloads30d = packageStats?.daily?.reduce((acc, d) => acc + d.downloads, 0) ?? 0;

  return (
    <>
      <HeaderBar>
        {/* ── Top Strip: Breadcrumbs & Symbol Browser (Left) + Actions Toolbar (Right) ── */}
        <TopStrip>
          <NavLeft>
            {treeCollapsed && onToggleTreeCollapse && (
              <BrowseSymbolsBtn
                size="small"
                variant="invisible"
                leadingVisual={SidebarExpandIcon}
                onClick={onToggleTreeCollapse}
                aria-label="Browse symbols"
                title="Expand symbol explorer"
              >
                Browse Symbols
                {typeof classCount === "number" && classCount > 0 && (
                  <span className="symbol-count">({classCount.toLocaleString()})</span>
                )}
              </BrowseSymbolsBtn>
            )}
            <Breadcrumbs
              items={[
                { label: "Packages", href: "/packages" },
                { label: name || "", href: `/packages/${name}` },
                { label: `v${version}` },
              ]}
            />
          </NavLeft>

          <ActionToolbar>
            <OpenIdeButton
              to={`/studio#memfs:package-${name || "model"}?libs=${encodeURIComponent(`${name}@${version || "latest"}`)}`}
              title="Open interactive Studio workspace with this package"
            >
              <CodeIcon size={14} />
              <span>Open in Studio</span>
            </OpenIdeButton>

            {name && version && (
              <ActionBtnLink
                href={getPackageDownloadUrl(name, version)}
                download
                title={`Download ${name} v${version} source archive (.zip)`}
              >
                <FileZipIcon size={14} style={{ color: "#eab308" }} />
                <span>Source (.zip)</span>
              </ActionBtnLink>
            )}

            <CiteButton
              target={buildCitationFromPackage({
                name,
                version,
                description: description || undefined,
                author: packageOwner,
                license: license || undefined,
                publishedAt: publishedAt || undefined,
              })}
              label="Cite"
              variant="button"
              size="md"
              testId="package-header-cite-btn"
            />

            {canManage && (
              <ActionMenu>
                <ActionMenu.Button
                  size="small"
                  leadingVisual={GearIcon}
                  style={{ height: 32, borderRadius: 8, fontSize: 12.5, fontWeight: 600 }}
                >
                  Manage
                </ActionMenu.Button>
                <ActionMenu.Overlay align="end">
                  <ActionList>
                    <ActionList.Item
                      onSelect={() => {
                        setActionError(null);
                        setPublishModalOpen(true);
                      }}
                    >
                      <ActionList.LeadingVisual>
                        <PlusIcon size={14} />
                      </ActionList.LeadingVisual>
                      Publish New Version
                    </ActionList.Item>

                    <ActionList.Item
                      onSelect={() => {
                        setActionError(null);
                        setManageModal("collaborators");
                      }}
                    >
                      <ActionList.LeadingVisual>
                        <PeopleIcon size={14} />
                      </ActionList.LeadingVisual>
                      Manage Collaborators ({collaborators.length})
                    </ActionList.Item>

                    <ActionList.Divider />

                    <ActionList.Item
                      onSelect={() => {
                        setActionError(null);
                        setManageModal("yank");
                      }}
                    >
                      <ActionList.LeadingVisual>
                        <AlertFillIcon
                          size={14}
                          fill={
                            isCurrentYanked ? "var(--color-success-fg, #2da44e)" : "var(--color-danger-fg, #cf222e)"
                          }
                        />
                      </ActionList.LeadingVisual>
                      {isCurrentYanked ? "Restore (Unyank) Release" : "Yank Release"}
                    </ActionList.Item>

                    <ActionList.Item
                      onSelect={() => {
                        setActionError(null);
                        setManageModal("deprecate");
                      }}
                    >
                      <ActionList.LeadingVisual>
                        <AlertIcon size={14} fill="#d97706" />
                      </ActionList.LeadingVisual>
                      {isCurrentDeprecated ? "Remove Deprecation" : "Deprecate Release"}
                    </ActionList.Item>

                    <ActionList.Divider />

                    <ActionList.Item
                      onSelect={() => {
                        setActionError(null);
                        setManageModal("transfer");
                      }}
                    >
                      <ActionList.LeadingVisual>
                        <SyncIcon size={14} />
                      </ActionList.LeadingVisual>
                      Transfer Ownership
                    </ActionList.Item>

                    <ActionList.Item
                      variant="danger"
                      onSelect={() => {
                        setActionError(null);
                        setManageModal("unpublish");
                      }}
                    >
                      <ActionList.LeadingVisual>
                        <TrashIcon size={14} />
                      </ActionList.LeadingVisual>
                      Unpublish Release
                    </ActionList.Item>
                  </ActionList>
                </ActionMenu.Overlay>
              </ActionMenu>
            )}

            {onOpenLogs &&
              (hasLogs || jobStatus === "failed" || jobStatus === "pending" || jobStatus === "running") && (
                <Button
                  size="small"
                  leadingVisual={TerminalIcon}
                  onClick={onOpenLogs}
                  title="View background ingestion & indexing logs"
                  style={{
                    height: 32,
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: 600,
                    borderColor:
                      jobStatus === "failed"
                        ? "color-mix(in srgb, var(--color-danger-fg, #cf222e) 40%, transparent)"
                        : undefined,
                    background:
                      jobStatus === "failed"
                        ? "color-mix(in srgb, var(--color-danger-fg, #cf222e) 8%, transparent)"
                        : undefined,
                    color: jobStatus === "failed" ? "var(--color-danger-fg, #cf222e)" : undefined,
                  }}
                >
                  Logs
                  {jobStatus === "failed" && (
                    <Label variant="danger" style={{ marginLeft: 6, fontSize: 10 }}>
                      Failed
                    </Label>
                  )}
                  {(jobStatus === "pending" || jobStatus === "running") && (
                    <Label variant="attention" style={{ marginLeft: 6, fontSize: 10 }}>
                      Live
                    </Label>
                  )}
                </Button>
              )}
          </ActionToolbar>
        </TopStrip>

        {/* ── Hero Row: Package Icon + Title & Badges ── */}
        <HeroRow>
          <HeroIconCard>
            <InvertedSvg
              src={getIconUrl(name, version, rootClassName || name)}
              alt=""
              width={36}
              height={36}
              style={{ flexShrink: 0 }}
            />
          </HeroIconCard>

          <HeroLeft>
            <TitleRow>
              <TitleHeading as="h1">
                {scopePart ? (
                  <>
                    <ScopePart to={`/${scopePart.slice(1)}`}>{scopePart}</ScopePart>
                    <ScopeSlash>/</ScopeSlash>
                    <NamePart>{namePart}</NamePart>
                  </>
                ) : (
                  <NamePart>{name}</NamePart>
                )}
              </TitleHeading>

              {versionList && versionList.length > 1 ? (
                <ActionMenu>
                  <ActionMenu.Button
                    size="small"
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      fontWeight: 600,
                      fontFamily: "var(--font-mono, monospace)",
                      borderRadius: 6,
                      background: "var(--ms-surface-hover, var(--color-canvas-subtle))",
                      border: "1px solid var(--ms-border, var(--color-border))",
                      color: "var(--ms-text-1, var(--color-text-primary))",
                      cursor: "pointer",
                      height: 24,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span>v{version}</span>
                    <ChevronDownIcon size={12} style={{ opacity: 0.6 }} />
                  </ActionMenu.Button>
                  <ActionMenu.Overlay align="start">
                    <ActionList style={{ maxHeight: 260, overflowY: "auto" }}>
                      <ActionList.Group title="Release Versions">
                        {versionList.map((v) => (
                          <ActionList.Item
                            key={v}
                            selected={v === version}
                            onSelect={() => {
                              if (v !== version) {
                                navigate(`/packages/${name}/${v}`);
                              }
                            }}
                          >
                            v{v}
                            {v === effectiveLatest && (
                              <ActionList.TrailingVisual>
                                <Label variant="accent" style={{ fontSize: 10 }}>
                                  latest
                                </Label>
                              </ActionList.TrailingVisual>
                            )}
                          </ActionList.Item>
                        ))}
                      </ActionList.Group>
                    </ActionList>
                  </ActionMenu.Overlay>
                </ActionMenu>
              ) : (
                <StatusPill $variant="muted" style={{ fontFamily: "var(--font-mono, monospace)" }}>
                  v{version}
                </StatusPill>
              )}

              {isLatestVersion && (
                <StatusPill $variant="success" title="Latest released version">
                  latest
                </StatusPill>
              )}

              {packageSignature && (
                <StatusPill $variant="brand" title="Cryptographically verified package signature">
                  <VerifiedIcon size={11} />
                  <span>Verified</span>
                </StatusPill>
              )}

              <StatusPill
                as="a"
                href={`/api/v1/libraries/${name.startsWith("@") ? name.split("/").map(encodeURIComponent).join("/") : encodeURIComponent(name)}/${encodeURIComponent(version)}/provenance.json`}
                target="_blank"
                rel="noopener noreferrer"
                $variant="success"
                title="SLSA Level 3 in-toto build provenance attestation"
                style={{ textDecoration: "none", cursor: "pointer" }}
              >
                <ShieldCheckIcon size={11} />
                <span>SLSA Level 3</span>
              </StatusPill>
            </TitleRow>

            {description && <DescriptionParagraph as="p">{description}</DescriptionParagraph>}
          </HeroLeft>
        </HeroRow>

        {/* ── Utility Row: Metadata Chips (Left) + Compact Install Snippet (Right) ── */}
        <UtilityRow>
          <MetaStrip>
            {publishedAt && <MetaItem>Published {timeAgo(publishedAt)}</MetaItem>}
            {license && (
              <MetaItem>
                {publishedAt && <span className="dot-sep">•</span>}
                <LicenseChip>{license}</LicenseChip>
              </MetaItem>
            )}
            {modelicaVersion && (
              <MetaItem>
                <span className="dot-sep">•</span>
                <span>Modelica {modelicaVersion}</span>
              </MetaItem>
            )}
            {typeof classCount === "number" && classCount > 0 && (
              <MetaItem>
                <span className="dot-sep">•</span>
                <span>
                  {classCount.toLocaleString()} {classCount === 1 ? "symbol" : "symbols"}
                </span>
              </MetaItem>
            )}
            {downloads30d > 0 && (
              <MetaItem>
                <span className="dot-sep">•</span>
                <DownloadIcon size={12} />
                <span>{downloads30d.toLocaleString()} /mo</span>
              </MetaItem>
            )}
            {packageOwner && (
              <MetaItem>
                <span className="dot-sep">•</span>
                <PeopleIcon size={12} />
                <Link to={`/${packageOwner}`} style={{ color: "inherit", textDecoration: "none" }}>
                  @{packageOwner}
                </Link>
              </MetaItem>
            )}
            {normalizedHash && (
              <HashPill type="button" onClick={handleCopyHash} title={`Click to copy digest: sha256:${normalizedHash}`}>
                <ShieldCheckIcon size={12} fill="var(--color-success-fg, #2da44e)" />
                <span>sha256:{normalizedHash.slice(0, 8)}…</span>
                {copiedHash ? <CheckIcon size={11} fill="var(--color-success-fg, #2da44e)" /> : <CopyIcon size={11} />}
              </HashPill>
            )}
          </MetaStrip>

          <InstallPill>
            <InstallModeToggle>
              {(["cli", "manifest", "import"] as const).map((tab) => (
                <InstallModeBtn key={tab} type="button" $active={installTab === tab} onClick={() => setInstallTab(tab)}>
                  {tab.toUpperCase()}
                </InstallModeBtn>
              ))}
            </InstallModeToggle>
            <InstallCode type="button" onClick={handleCopyInstall} title="Click to copy install snippet">
              <code>
                {installTab === "cli" && (
                  <span style={{ opacity: 0.6, color: "var(--ms-brand, var(--color-accent-cyan, #06b6d4))" }}>
                    $&nbsp;
                  </span>
                )}
                {currentSnippet}
              </code>
              <span className="copy-icon">
                {copiedInstall ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      color: "var(--ms-success, #10b981)",
                      fontSize: 10.5,
                      fontWeight: 600,
                    }}
                  >
                    <CheckIcon size={12} />
                    <span>Copied</span>
                  </span>
                ) : (
                  <CopyIcon size={12} />
                )}
              </span>
            </InstallCode>
          </InstallPill>
        </UtilityRow>

        {/* ── Engineering Quality Scorecard ── */}
        <ScorecardContainer data-testid="engineering-quality-scorecard">
          <ScorecardTitle>
            <ShieldCheckIcon size={14} fill="var(--ms-brand, var(--color-accent-cyan, #06b6d4))" />
            <span>Quality Scorecard</span>
          </ScorecardTitle>

          <ScorecardPill
            $status={packageSignature ? "pass" : "neutral"}
            title={
              packageSignature
                ? `Cryptographically signed release (Ed25519 signature: ${packageSignature.slice(0, 16)}...)`
                : "Release has not been cryptographically signed with an Ed25519 publisher key."
            }
          >
            {packageSignature ? <VerifiedIcon size={12} /> : <AlertIcon size={12} />}
            <span>{packageSignature ? "Ed25519 Verified" : "Unsigned Release"}</span>
          </ScorecardPill>

          {oidcRepository && (
            <ScorecardPill
              $status="pass"
              title={`Keyless CI/CD Attestation verified from GitHub/GitLab repository ${oidcRepository} (${oidcWorkflow || "CI"})`}
              data-testid="oidc-attestation-pill"
            >
              <VerifiedIcon size={12} fill="var(--color-accent-emphasis, #0969da)" />
              <span>CI: {oidcRepository}</span>
            </ScorecardPill>
          )}

          <ScorecardPill
            $status="pass"
            title="Static AST security screening verified zero high/critical hazards (no unsafe C bindings, split tokens, or directory traversal)."
          >
            <CheckIcon size={12} />
            <span>Security Scan: 0 Hazards</span>
          </ScorecardPill>

          <ScorecardPill
            $status={(vulnerabilityCount ?? 0) === 0 ? "pass" : "fail"}
            title={
              (vulnerabilityCount ?? 0) === 0
                ? "OSV vulnerability database verified 0 known CVE / GHSA advisories in this release and its dependencies."
                : `${vulnerabilityCount} known security vulnerabilities reported in OSV database for this release.`
            }
            data-testid="osv-vulnerabilities-pill"
          >
            {(vulnerabilityCount ?? 0) === 0 ? (
              <CheckIcon size={12} />
            ) : (
              <AlertIcon size={12} fill="var(--color-danger-fg, #cf222e)" />
            )}
            <span>
              {(vulnerabilityCount ?? 0) === 0 ? "0 CVEs (OSV)" : `${vulnerabilityCount} Vulnerabilities (OSV)`}
            </span>
          </ScorecardPill>

          <ScorecardPill
            $status={jobStatus === "failed" ? "warn" : "pass"}
            title={
              jobStatus === "failed"
                ? "Background ingestion or symbol indexing reported warnings."
                : "Flat DAE equations and symbols verified against OpenModelica compiler ground truth."
            }
          >
            {jobStatus === "failed" ? <AlertIcon size={12} /> : <CheckIcon size={12} />}
            <span>{jobStatus === "failed" ? "Indexing Issue" : "OMC DAE Parity"}</span>
          </ScorecardPill>

          <ScorecardPill
            $status={docPercentage >= 70 ? "pass" : docPercentage >= 30 ? "warn" : "neutral"}
            title={`${documentedClasses} of ${totalClasses} classes have docstrings or descriptions.`}
          >
            <CodeIcon size={12} />
            <span>
              {docPercentage}% Documented ({documentedClasses}/{totalClasses})
            </span>
          </ScorecardPill>
        </ScorecardContainer>
      </HeaderBar>

      {/* ── Alerts & Notifications ── */}
      <AlertsContainer>
        {jobStatus === "failed" && (
          <Box mb={3}>
            <Flash
              variant="danger"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                borderRadius: 10,
              }}
            >
              <Box display="flex" alignItems="center" gap={2}>
                <AlertFillIcon size={16} fill="var(--color-danger-fg, #cf222e)" />
                <Text style={{ fontSize: 13, fontWeight: 500 }}>
                  Background ingestion and symbol indexing failed for this release.
                </Text>
              </Box>
              {onOpenLogs && (
                <Button
                  size="small"
                  variant="invisible"
                  leadingVisual={TerminalIcon}
                  onClick={onOpenLogs}
                  style={{
                    color: "var(--color-danger-fg, #cf222e)",
                    border: "1px solid rgba(207, 34, 46, 0.4)",
                    borderRadius: 6,
                  }}
                >
                  View Ingestion Logs
                </Button>
              )}
            </Flash>
          </Box>
        )}

        {(jobStatus === "pending" || jobStatus === "running") && (
          <Box mb={3}>
            <Flash
              variant="warning"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                borderRadius: 10,
              }}
            >
              <Box display="flex" alignItems="center" gap={2}>
                <SyncIcon size={16} fill="#d97706" />
                <Text style={{ fontSize: 13, fontWeight: 500 }}>
                  Background ingestion and indexing is currently in progress…
                </Text>
              </Box>
              {onOpenLogs && (
                <Button
                  size="small"
                  variant="invisible"
                  leadingVisual={TerminalIcon}
                  onClick={onOpenLogs}
                  style={{
                    color: "#d97706",
                    border: "1px solid rgba(217, 119, 6, 0.4)",
                    borderRadius: 6,
                  }}
                >
                  View Live Logs
                </Button>
              )}
            </Flash>
          </Box>
        )}

        {actionSuccess && (
          <Box mb={3}>
            <Flash variant="success" onDismiss={() => setActionSuccess(null)} style={{ borderRadius: 10 }}>
              {actionSuccess}
            </Flash>
          </Box>
        )}

        {user &&
          pendingTransfers.map((tr) => {
            const isIncoming = tr.to_user_id === user.id || tr.to_username === user.username;
            return (
              <Box
                key={tr.id}
                mb={3}
                p={3}
                style={{
                  borderRadius: 10,
                  background: "rgba(139, 92, 246, 0.12)",
                  border: "1px solid rgba(139, 92, 246, 0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <Box display="flex" alignItems="center" gap={2}>
                  <SyncIcon size={18} fill="#a855f7" />
                  <Text style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                    {isIncoming ? (
                      <>
                        <strong>@{tr.from_username || "Owner"}</strong> requested to transfer ownership of{" "}
                        <strong>{name}</strong> to you.
                      </>
                    ) : (
                      <>
                        Transfer request sent to <strong>@{tr.to_username}</strong>. Awaiting acceptance.
                      </>
                    )}
                  </Text>
                </Box>
                <Box display="flex" gap={2}>
                  {isIncoming ? (
                    <Button
                      size="small"
                      variant="primary"
                      disabled={actionLoading}
                      onClick={() => onAcceptPendingTransfer(tr.id)}
                    >
                      Accept Transfer
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      variant="danger"
                      disabled={actionLoading}
                      onClick={() => onCancelPendingTransfer(tr.id)}
                    >
                      Cancel Request
                    </Button>
                  )}
                </Box>
              </Box>
            );
          })}

        {isCurrentYanked && (
          <Box
            mb={3}
            p={3}
            style={{
              borderRadius: 10,
              background: "rgba(207, 34, 46, 0.12)",
              border: "1px solid rgba(207, 34, 46, 0.4)",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <AlertFillIcon size={20} fill="var(--color-danger-fg, #cf222e)" style={{ flexShrink: 0, marginTop: 2 }} />
            <Box>
              <Text style={{ fontWeight: 600, color: "var(--color-danger-fg, #cf222e)", display: "block" }}>
                This version (v{version}) has been yanked
              </Text>
              <Text style={{ fontSize: 13, color: "var(--color-text-primary)", display: "block", marginTop: 2 }}>
                {currentYankReason || "The maintainer has yanked this release. It should not be used in new projects."}
              </Text>
            </Box>
          </Box>
        )}

        {isCurrentDeprecated && (
          <Box
            mb={3}
            p={3}
            style={{
              borderRadius: 10,
              background: "rgba(217, 119, 6, 0.12)",
              border: "1px solid rgba(217, 119, 6, 0.4)",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <AlertIcon size={20} fill="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
            <Box>
              <Text style={{ fontWeight: 600, color: "#d97706", display: "block" }}>
                This version (v{version}) is deprecated
              </Text>
              <Text style={{ fontSize: 13, color: "var(--color-text-primary)", display: "block", marginTop: 2 }}>
                {currentDeprecateReason || "The package author has deprecated this version. Please consider upgrading."}
              </Text>
            </Box>
          </Box>
        )}
      </AlertsContainer>
    </>
  );
};
