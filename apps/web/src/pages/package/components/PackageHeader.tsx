// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertFillIcon,
  AlertIcon,
  CheckIcon,
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
import React, { useState } from "react";
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

const HeroRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 12px;

  @media (max-width: 640px) {
    flex-direction: column;
    gap: 14px;
  }
`;

const HeroLeft = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const HeroIconCard = styled.div`
  width: 100px;
  height: 100px;
  border-radius: 18px;
  background: var(--ms-surface-hover, var(--color-canvas-subtle, rgba(255, 255, 255, 0.04)));
  border: 1px solid var(--ms-border, var(--color-border));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  transition:
    transform 0.2s ease,
    border-color 0.2s ease;

  &:hover {
    border-color: var(--ms-brand, var(--color-accent-cyan, #06b6d4));
    transform: translateY(-2px);
  }

  @media (max-width: 640px) {
    width: 64px;
    height: 64px;
    border-radius: 12px;
  }
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

const MetaStrip = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12.5px;
  color: var(--ms-text-3, var(--color-text-muted));
  margin-top: 4px;
`;

const MetaItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
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

const ActionRibbon = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 14px;
  margin-bottom: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--ms-divider, var(--color-border-subtle));
`;

const InstallPill = styled.div`
  display: inline-flex;
  align-items: center;
  background: var(--ms-surface-hover, var(--color-canvas-subtle));
  border: 1px solid var(--ms-border, var(--color-border));
  border-radius: 8px;
  overflow: hidden;
  height: 34px;
  box-sizing: border-box;
  max-width: 100%;
`;

const InstallModeToggle = styled.div`
  display: inline-flex;
  background: var(--ms-surface-hover, rgba(0, 0, 0, 0.1));
  height: 100%;
  border-right: 1px solid var(--ms-border, var(--color-border));
  padding: 2px;
  box-sizing: border-box;
`;

const InstallModeBtn = styled.button<{ $active: boolean }>`
  background: ${(p) => (p.$active ? "var(--ms-bg-card, var(--color-bg-card))" : "transparent")};
  border: none;
  border-radius: 6px;
  padding: 0 8px;
  font-size: 10.5px;
  font-weight: ${(p) => (p.$active ? 700 : 500)};
  color: ${(p) =>
    p.$active ? "var(--ms-text-1, var(--color-text-primary))" : "var(--ms-text-3, var(--color-text-muted))"};
  cursor: pointer;
  height: 100%;
  transition: all 0.15s ease;
`;

const InstallCode = styled.button`
  background: transparent;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  cursor: pointer;
  color: var(--ms-text-1, var(--color-text-primary));
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 380px;
  height: 100%;
  transition: background-color 0.15s ease;

  &:hover {
    background: var(--ms-surface-selected);
  }

  .copy-icon {
    color: var(--ms-text-3, var(--color-text-muted));
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }
`;

const ActionButtonsRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const OpenIdeButton = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  background: var(--ms-brand);
  color: var(--ms-brand-contrast, #ffffff) !important;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--ms-brand) 30%, transparent);
  transition: all 0.15s ease;

  &:hover {
    background: var(--ms-brand-hover, var(--ms-brand));
    box-shadow: 0 4px 12px color-mix(in srgb, var(--ms-brand) 40%, transparent);
    transform: translateY(-1px);
    text-decoration: none;
  }
`;

const DownloadZipButton = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--ms-surface-hover, var(--color-canvas-subtle));
  border: 1px solid var(--ms-border, var(--color-border));
  color: var(--ms-text-1, var(--color-text-primary));
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.15s ease;

  &:hover {
    background: var(--ms-surface-selected);
    border-color: var(--ms-border-strong);
    color: var(--ms-text-1);
    text-decoration: none;
  }
`;

export interface PackageHeaderProps {
  name: string;
  version: string;
  rootClassName?: string | null | undefined;
  description?: string | null | undefined;
  publishedAt?: string | null | undefined;
  license?: string | null | undefined;
  classCount?: number | undefined;
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
}

export const PackageHeader: React.FC<PackageHeaderProps> = ({
  name,
  version,
  rootClassName,
  description,
  publishedAt,
  license,
  classCount,
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
}) => {
  const navigate = useNavigate();
  const effectiveLatest = latestVersion || (versionList && versionList.length > 0 ? versionList[0] : null);
  const isLatestVersion = Boolean(effectiveLatest && effectiveLatest === version);

  const [copiedInstall, setCopiedInstall] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const [installTab, setInstallTab] = useState<"cli" | "manifest" | "import">("cli");

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
        {/* ── Breadcrumbs & Collapse Toggle ── */}
        <Box mb={2} display="flex" alignItems="center" gap="8px" flexWrap="wrap">
          {treeCollapsed && onToggleTreeCollapse && (
            <Button
              size="small"
              variant="invisible"
              leadingVisual={SidebarExpandIcon}
              onClick={onToggleTreeCollapse}
              aria-label="Browse symbols"
              title="Expand symbol explorer"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--ms-brand, var(--color-accent-cyan, #06b6d4))",
                padding: "2px 8px",
                borderRadius: 6,
                border: "1px solid var(--ms-border, var(--color-border))",
                background: "var(--ms-surface-hover, rgba(255,255,255,0.04))",
              }}
            >
              Browse Symbols
              {typeof classCount === "number" && classCount > 0 && (
                <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.8 }}>({classCount.toLocaleString()})</span>
              )}
            </Button>
          )}
          <Breadcrumbs
            items={[
              { label: "Packages", href: "/packages" },
              { label: name || "", href: `/packages/${name}` },
              { label: `v${version}` },
            ]}
          />
        </Box>

        {/* ── Hero Row: Package Icon (Left) + Title & Meta (Right) ── */}
        <HeroRow>
          <HeroIconCard>
            <InvertedSvg
              src={getIconUrl(name, version, rootClassName || name)}
              alt=""
              width={72}
              height={72}
              style={{ flexShrink: 0 }}
            />
          </HeroIconCard>

          <HeroLeft>
            <TitleRow>
              <Heading
                as="h1"
                style={{
                  color: "var(--ms-text-1, var(--color-text-heading))",
                  fontWeight: 700,
                  fontSize: 26,
                  lineHeight: 1.2,
                  margin: 0,
                }}
              >
                {name}
              </Heading>
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
                    }}
                  >
                    v{version}
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
                <Label
                  variant="secondary"
                  style={{ fontSize: 12, padding: "2px 8px", fontFamily: "var(--font-mono, monospace)" }}
                >
                  v{version}
                </Label>
              )}
              {isLatestVersion && (
                <Label variant="success" style={{ fontSize: 11, padding: "0 6px" }}>
                  latest
                </Label>
              )}
              {packageSignature && (
                <Label variant="success" style={{ fontSize: 11, padding: "0 6px" }}>
                  <VerifiedIcon size={11} /> Verified
                </Label>
              )}
            </TitleRow>

            {description && (
              <Text
                as="p"
                style={{
                  color: "var(--ms-text-2, var(--color-text-muted))",
                  fontSize: 14,
                  margin: "2px 0 0",
                  lineHeight: 1.45,
                }}
              >
                {description}
              </Text>
            )}

            <MetaStrip>
              {publishedAt && <MetaItem>Published {timeAgo(publishedAt)}</MetaItem>}
              {license && (
                <MetaItem>
                  <span>•</span>
                  <span style={{ fontWeight: 600, color: "var(--ms-text-1)" }}>{license}</span>
                </MetaItem>
              )}
              {modelicaVersion && (
                <MetaItem>
                  <span>•</span>
                  <span>Modelica {modelicaVersion}</span>
                </MetaItem>
              )}
              {typeof classCount === "number" && classCount > 0 && (
                <MetaItem>
                  <span>•</span>
                  <span>
                    {classCount.toLocaleString()} {classCount === 1 ? "symbol" : "symbols"}
                  </span>
                </MetaItem>
              )}
              {downloads30d > 0 && (
                <MetaItem>
                  <span>•</span>
                  <DownloadIcon size={12} />
                  <span>{downloads30d.toLocaleString()} (30d)</span>
                </MetaItem>
              )}
              {packageOwner && (
                <MetaItem>
                  <span>•</span>
                  <PeopleIcon size={12} />
                  <Link to={`/${packageOwner}`} style={{ color: "inherit", textDecoration: "none" }}>
                    @{packageOwner}
                  </Link>
                </MetaItem>
              )}
              {normalizedHash && (
                <HashPill
                  type="button"
                  onClick={handleCopyHash}
                  title={`Click to copy digest: sha256:${normalizedHash}`}
                >
                  <ShieldCheckIcon size={12} fill="var(--color-success-fg, #2da44e)" />
                  <span>sha256:{normalizedHash.slice(0, 10)}…</span>
                  {copiedHash ? (
                    <CheckIcon size={11} fill="var(--color-success-fg, #2da44e)" />
                  ) : (
                    <CopyIcon size={11} />
                  )}
                </HashPill>
              )}
            </MetaStrip>
          </HeroLeft>
        </HeroRow>

        {/* ── Action & Install Ribbon ── */}
        <ActionRibbon>
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
                {installTab === "cli" && <span style={{ opacity: 0.6 }}>&gt;&nbsp;</span>}
                {currentSnippet}
              </code>
              <span className="copy-icon">{copiedInstall ? <CheckIcon size={14} /> : <CopyIcon size={14} />}</span>
            </InstallCode>
          </InstallPill>

          <ActionButtonsRow>
            <OpenIdeButton
              to={`/ide#memfs:package-${name || "model"}?libs=${encodeURIComponent(`${name}@${version || "latest"}`)}`}
            >
              <CodeIcon size={14} />
              <span>Open in Web IDE</span>
            </OpenIdeButton>

            {name && version && (
              <DownloadZipButton
                href={getPackageDownloadUrl(name, version)}
                download
                title={`Download ${name} v${version} source archive (.zip)`}
              >
                <FileZipIcon size={14} style={{ color: "#eab308" }} />
                <span>Source (.zip)</span>
              </DownloadZipButton>
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
              testId="package-header-cite-btn"
            />

            {canManage && (
              <ActionMenu>
                <ActionMenu.Button size="small" leadingVisual={GearIcon}>
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
          </ActionButtonsRow>
        </ActionRibbon>
      </HeaderBar>

      {/* Alerts & Notifications */}
      <Box px={5} pt={2}>
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
            <Flash variant="success" onDismiss={() => setActionSuccess(null)}>
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
                  borderRadius: 8,
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
              borderRadius: 8,
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
              borderRadius: 8,
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
      </Box>
    </>
  );
};
