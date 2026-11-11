// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BeakerIcon,
  BookIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DatabaseIcon,
  DownloadIcon,
  FileZipIcon,
  LinkIcon,
  PackageIcon,
  PeopleIcon,
  PlayIcon,
  PlusIcon,
  ShieldCheckIcon,
  VerifiedIcon,
} from "@primer/octicons-react";
import { Button, Label, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import styledImport from "styled-components";
import { useFeatureFlag } from "../../../FeatureFlagContext";
import {
  getPackageAasxExportUrl,
  getPackageDataPackageExportUrl,
  getPackageDownloadUrl,
  getPackageLockfileExportUrl,
  getPackageOkhExportUrl,
  getPackageSalsaIndexUrl,
  type LibraryDetail,
  type NpmPackument,
  type NpmVersionManifest,
  type PackageCollaborator,
  type PackageDependent,
  type PackageStats,
} from "../../../api";
import type { LinkedStudyJobItemPayload, StudyDefinitionPayload } from "../../../api/compute";
import { CiteButton } from "../../../components/citations/CiteButton";
import { buildCitationFromPackage } from "../../../util/citations";
import { buildVsCodeWorkbenchUrlForPackage } from "../../../util/editor-routing";
import {
  DependentBadge,
  InstallBox,
  MetaBlock,
  MetaGrid,
  MetaLabel,
  MetaValue,
  SparklineBar,
  SparklineContainer,
  timeAgo,
} from "../types";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

const SidebarCard = styled.div`
  background: var(--ms-bg-elv, var(--color-bg-card, rgba(15, 23, 42, 0.65)));
  border: 1px solid var(--ms-border, var(--color-border));
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
  box-sizing: border-box;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
`;

const SidebarCardHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
`;

const SidebarCardTitle = styled.h3`
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ms-text-3, var(--color-text-muted));
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const ActionPrimaryLink = styled.a`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 9px 14px;
  border-radius: 8px;
  background: var(--ms-brand);
  color: var(--ms-brand-contrast, #ffffff) !important;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  border: none;
  cursor: pointer;
  box-sizing: border-box;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--ms-brand) 30%, transparent);
  transition: all 0.15s ease;

  &:hover {
    background: var(--ms-brand-hover, var(--ms-brand));
    color: var(--ms-brand-contrast, #ffffff) !important;
    text-decoration: none;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--ms-brand) 40%, transparent);
    transform: translateY(-1px);
  }
`;

const ActionSecondaryLink = styled.a`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  background: var(--ms-surface-hover, var(--color-canvas-subtle));
  border: 1px solid var(--ms-border, var(--color-border));
  color: var(--ms-text-1, var(--color-text-primary));
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  box-sizing: border-box;
  transition: all 0.15s ease;

  &:hover {
    background: var(--ms-surface-selected, var(--surface-row-hover));
    border-color: var(--ms-border-strong, var(--color-border-strong));
    color: var(--ms-text-1, var(--color-text-primary));
    text-decoration: none;
  }
`;

const ExportTile = styled.a<{ $activeColor?: string | undefined }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--ms-surface-hover, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--ms-border, var(--color-border));
  color: var(--ms-text-1, var(--color-text-primary));
  text-decoration: none;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--ms-brand, var(--color-accent-cyan, #06b6d4));
    background: var(--ms-surface-selected, var(--surface-row-hover, rgba(255, 255, 255, 0.08)));
    transform: translateY(-1px);
    text-decoration: none;
  }
`;

export interface PackageRightSidebarProps {
  name: string;
  version: string;
  installCmd: string;
  packument?: NpmPackument | null | undefined;
  libraryDetail?: LibraryDetail | null | undefined;
  currentManifest?: NpmVersionManifest | null | undefined;
  publishedAt?: string | null | undefined;
  contentHash?: string | null | undefined;
  packageSignature?: string | null | undefined;
  availableDomains: {
    id: string;
    label: string;
    icon: React.ReactNode | React.ComponentType<{ size?: number }>;
    count: number;
    color: string;
  }[];
  packageStats?: PackageStats | null | undefined;
  dependents: PackageDependent[];
  linkedStudies?:
    | {
        bundledStudies: (StudyDefinitionPayload & { dbId?: number | undefined })[];
        linkedTemplates: (StudyDefinitionPayload & { dbId?: number | undefined })[];
        compatibleTemplates: (StudyDefinitionPayload & { dbId?: number | undefined })[];
        linkedJobs: LinkedStudyJobItemPayload[];
      }
    | undefined;
  onOpenStudiesTab?: (() => void) | undefined;
  packageOwner?: string | null | undefined;
  collaborators: PackageCollaborator[];
  canManage: boolean;
  onOpenManageCollaborators: () => void;
  hasSalsaIndex?: boolean | undefined;
}

export const PackageRightSidebar: React.FC<PackageRightSidebarProps> = ({
  name,
  version,
  installCmd,
  packument,
  libraryDetail,
  currentManifest,
  publishedAt,
  contentHash,
  packageSignature,
  availableDomains,
  packageStats,
  dependents,
  linkedStudies,
  onOpenStudiesTab,
  packageOwner,
  collaborators,
  canManage,
  onOpenManageCollaborators,
  hasSalsaIndex,
}) => {
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const [installTab, setInstallTab] = useState<"cli" | "manifest" | "import">("cli");
  const [activeIdeTitle, setActiveIdeTitle] = useState<string | null>(null);
  const [addedToIde, setAddedToIde] = useState(false);
  const hasCae = useFeatureFlag("cae_cloud_solver");
  const hasAdvancedExports = useFeatureFlag("package_advanced_exports");
  const hasArtifactsTab = useFeatureFlag("package_artifacts_tab");

  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("modelscript:host-bridge");
      channel.onmessage = (ev) => {
        if (ev.data?.type === "MODELSCRIPT_IDE_HEARTBEAT") {
          setActiveIdeTitle(ev.data.workspaceTitle || "Active Workspace");
        } else if (ev.data?.type === "MODELSCRIPT_PACKAGE_INSTALLED" && ev.data?.name === name) {
          setAddedToIde(true);
          setTimeout(() => setAddedToIde(false), 3000);
        }
      };
      channel.postMessage({ type: "MODELSCRIPT_PING_IDE", requestId: `ping-${Date.now()}` });
    } catch {
      // ignore if BroadcastChannel unsupported
    }
    return () => {
      try {
        channel?.close();
      } catch {
        // ignore
      }
    };
  }, [name]);

  const handleAddToActiveIde = () => {
    try {
      const channel = new BroadcastChannel("modelscript:host-bridge");
      channel.postMessage({
        type: "MODELSCRIPT_INSTALL_PACKAGE",
        name,
        version: version || "latest",
        requestId: `install-${Date.now()}`,
      });
      setAddedToIde(true);
      setTimeout(() => {
        setAddedToIde(false);
        try {
          channel.close();
        } catch {
          // ignore
        }
      }, 2500);
    } catch {
      // ignore
    }
  };

  const importIdentifier =
    name
      .replace(/^@[^/]+\//, "")
      .replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase())
      .replace(/^[a-z]/, (c) => c.toUpperCase())
      .replace(/[^a-zA-Z0-9_$]/g, "") || "Model";
  const importSpecifier = name.startsWith("@") ? name : `@modelscript/${name}`;

  const currentSnippet =
    installTab === "cli"
      ? installCmd
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

  const nonAllDomains = availableDomains.filter((d) => d.id !== "all");
  const modelingDomains = nonAllDomains.filter((d) => ["modelica", "sysml2", "cad", "fmu"].includes(d.id));
  const showPolyglotDomains = hasArtifactsTab ? nonAllDomains.length > 1 : modelingDomains.length > 1;
  const displayedDomains = hasArtifactsTab ? nonAllDomains : modelingDomains;

  const downloads30d = packageStats?.daily?.reduce((acc, d) => acc + d.downloads, 0) ?? 0;
  const totalDownloads = packageStats?.totalDownloads ?? 0;
  const hasNonZeroSparkline = Boolean(packageStats?.daily && packageStats.daily.some((d) => d.downloads > 0));

  return (
    <aside style={{ display: "flex", flexDirection: "column" }}>
      {/* ── Card 1: Installation & Actions ── */}
      <SidebarCard>
        <SidebarCardHeader>
          <SidebarCardTitle>Installation</SidebarCardTitle>
          <div
            style={{
              display: "inline-flex",
              background: "var(--ms-surface-hover, var(--color-canvas-subtle))",
              borderRadius: 6,
              padding: 2,
              border: "1px solid var(--ms-border, var(--color-border))",
            }}
          >
            {(["cli", "manifest", "import"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setInstallTab(tab)}
                style={{
                  background: installTab === tab ? "var(--ms-bg-card, var(--color-bg-card))" : "transparent",
                  border: "none",
                  borderRadius: 4,
                  padding: "2px 8px",
                  fontSize: 11,
                  fontWeight: installTab === tab ? 600 : 400,
                  color:
                    installTab === tab
                      ? "var(--ms-text-1, var(--color-text-primary))"
                      : "var(--ms-text-3, var(--color-text-muted))",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {tab.toUpperCase()}
              </button>
            ))}
          </div>
        </SidebarCardHeader>

        <InstallBox
          role="button"
          tabIndex={0}
          onClick={handleCopyInstall}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleCopyInstall();
            }
          }}
          title="Click to copy snippet"
          style={{ marginBottom: 12 }}
        >
          <code style={{ fontSize: 12 }}>
            {installTab === "cli" && (
              <span style={{ color: "var(--ms-text-3, var(--color-text-muted))" }}>&gt;&nbsp;</span>
            )}
            {currentSnippet}
          </code>
          <span className="copy-icon">{copiedInstall ? <CheckIcon size={16} /> : <CopyIcon size={16} />}</span>
        </InstallBox>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(activeIdeTitle || addedToIde) && (
            <button
              type="button"
              onClick={handleAddToActiveIde}
              title={`Hot-mount ${name}@${version} into active Studio workspace (${activeIdeTitle || "Active Workspace"})`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                width: "100%",
                padding: "9px 14px",
                borderRadius: "8px",
                background: addedToIde ? "linear-gradient(135deg, #059669, #10b981)" : "var(--ms-brand)",
                color: "var(--ms-brand-contrast, #ffffff)",
                fontSize: "13px",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                boxShadow: "0 2px 8px color-mix(in srgb, var(--ms-brand) 30%, transparent)",
                boxSizing: "border-box",
                transition: "all 0.2s ease",
              }}
            >
              {addedToIde ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
              {addedToIde ? `Added ${name}@${version} to Libraries!` : `Add to Active Studio (${activeIdeTitle})`}
            </button>
          )}

          <ActionPrimaryLink
            href={buildVsCodeWorkbenchUrlForPackage(name || "", version)}
            target="_blank"
            rel="noopener noreferrer"
            style={
              activeIdeTitle || addedToIde
                ? {
                    background: "var(--ms-surface-hover, var(--color-canvas-subtle))",
                    border: "1px solid var(--ms-border, var(--color-border))",
                    color: "var(--ms-text-1, var(--color-text-primary))",
                    boxShadow: "none",
                  }
                : undefined
            }
          >
            <CodeIcon size={15} />
            Open in Studio Workspace
          </ActionPrimaryLink>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: name && version && !hasAdvancedExports ? "1fr 1fr" : "1fr",
              gap: 8,
            }}
          >
            {name && version && !hasAdvancedExports && (
              <ActionSecondaryLink
                href={getPackageDownloadUrl(name, version)}
                download
                title={`Download ${name} v${version} source archive (.zip)`}
              >
                <FileZipIcon size={14} style={{ color: "#eab308" }} />
                <span>Download Source (.zip)</span>
              </ActionSecondaryLink>
            )}

            <CiteButton
              target={buildCitationFromPackage({
                name,
                version,
                description: libraryDetail?.description || packument?.description,
                author: packageOwner || currentManifest?.author?.name,
                license: currentManifest?.license,
                publishedAt,
              })}
              label="Cite Package"
              variant="sidebar"
              testId="package-sidebar-cite-btn"
            />
          </div>

          {/* ── Advanced Exports & Downloads (Feature-Gated by package_advanced_exports) ── */}
          {hasAdvancedExports && name && version && (
            <div style={{ marginTop: 6, paddingTop: 10, borderTop: "1px solid var(--ms-border, var(--color-border))" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 650,
                  color: "var(--ms-text-3, var(--color-text-muted))",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                Download &amp; Export
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <ExportTile
                  href={getPackageDownloadUrl(name, version)}
                  download
                  title="Download complete package ZIP archive"
                >
                  <FileZipIcon size={15} style={{ color: "#eab308", flexShrink: 0 }} />
                  <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Source</div>
                    <div style={{ fontSize: 10, color: "var(--ms-text-3, var(--color-text-muted))" }}>.zip archive</div>
                  </div>
                </ExportTile>
                <ExportTile
                  href={getPackageAasxExportUrl(name, version)}
                  download
                  title="Export Industry 4.0 Asset Administration Shell (.aasx)"
                >
                  <DownloadIcon size={15} style={{ color: "#a855f7", flexShrink: 0 }} />
                  <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Asset Shell</div>
                    <div style={{ fontSize: 10, color: "var(--ms-text-3, var(--color-text-muted))" }}>.aasx twin</div>
                  </div>
                </ExportTile>
                <ExportTile
                  href={getPackageOkhExportUrl(name, version)}
                  download
                  title="Export Open Know-How hardware manifest (.okh.json)"
                >
                  <PackageIcon size={15} style={{ color: "var(--ms-brand, #06b6d4)", flexShrink: 0 }} />
                  <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Hardware</div>
                    <div style={{ fontSize: 10, color: "var(--ms-text-3, var(--color-text-muted))" }}>.okh.json</div>
                  </div>
                </ExportTile>
                <ExportTile
                  href={getPackageSalsaIndexUrl(name, version)}
                  download
                  $activeColor={
                    hasSalsaIndex ? "var(--ms-brand, #06b6d4)" : "var(--ms-text-3, var(--color-text-muted))"
                  }
                  title={
                    hasSalsaIndex
                      ? "Download pre-indexed Salsa query database for instant WASM IDE indexing"
                      : "Salsa database will be compiled on demand"
                  }
                >
                  <DatabaseIcon size={15} style={{ color: "#3b82f6", flexShrink: 0 }} />
                  <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Salsa DB</div>
                    <div style={{ fontSize: 10, color: "var(--ms-text-3, var(--color-text-muted))" }}>.db index</div>
                  </div>
                </ExportTile>
                <ExportTile
                  href={getPackageDataPackageExportUrl(name, version)}
                  download
                  title="Export Frictionless Engineering Data Package manifest (datapackage.json) with dataset schemas & units"
                >
                  <DatabaseIcon size={15} style={{ color: "#10b981", flexShrink: 0 }} />
                  <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Data Package</div>
                    <div style={{ fontSize: 10, color: "var(--ms-text-3, var(--color-text-muted))" }}>
                      datapackage.json
                    </div>
                  </div>
                </ExportTile>
                <ExportTile
                  href={getPackageLockfileExportUrl(name, version)}
                  download
                  title="Export reproducible environment & dataset lockfile (datapackage.lock.json)"
                >
                  <ShieldCheckIcon size={15} style={{ color: "#22d3ee", flexShrink: 0 }} />
                  <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Lockfile</div>
                    <div style={{ fontSize: 10, color: "var(--ms-text-3, var(--color-text-muted))" }}>
                      datapackage.lock
                    </div>
                  </div>
                </ExportTile>
              </div>
            </div>
          )}
        </div>
      </SidebarCard>

      {/* ── Card 2: Package Details & Provenance ── */}
      <SidebarCard>
        <SidebarCardHeader>
          <SidebarCardTitle>Package Details</SidebarCardTitle>
        </SidebarCardHeader>

        <MetaGrid style={{ gap: 14, marginBottom: packument?.repository?.url || packument?.homepage ? 14 : 0 }}>
          <MetaBlock style={{ marginBottom: 0 }}>
            <MetaLabel>Version</MetaLabel>
            <MetaValue style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13 }}>v{version}</MetaValue>
          </MetaBlock>
          <MetaBlock style={{ marginBottom: 0 }}>
            <MetaLabel>License</MetaLabel>
            <MetaValue style={{ fontSize: 13 }}>{libraryDetail?.license || packument?.license || "—"}</MetaValue>
          </MetaBlock>
          <MetaBlock style={{ marginBottom: 0 }}>
            <MetaLabel>Last publish</MetaLabel>
            <MetaValue style={{ fontSize: 13 }}>{publishedAt ? timeAgo(publishedAt) : "—"}</MetaValue>
          </MetaBlock>
          {currentManifest?.modelscript?.modelicaVersion && (
            <MetaBlock style={{ marginBottom: 0 }}>
              <MetaLabel>Standard</MetaLabel>
              <MetaValue style={{ fontSize: 13 }}>Modelica {currentManifest.modelscript.modelicaVersion}</MetaValue>
            </MetaBlock>
          )}
        </MetaGrid>

        {packument?.repository?.url && (
          <MetaBlock style={{ marginBottom: packument?.homepage ? 10 : 0, marginTop: 10 }}>
            <MetaLabel>Repository</MetaLabel>
            <MetaValue style={{ fontSize: 13 }}>
              <BookIcon size={14} />
              <a
                href={packument.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "var(--ms-brand, var(--color-link))",
                  textDecoration: "none",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {packument.repository.url
                  .replace(/^git\+https?:\/\//, "")
                  .replace(/^https?:\/\//, "")
                  .replace(/\.git$/, "")}
              </a>
            </MetaValue>
          </MetaBlock>
        )}

        {packument?.homepage && (
          <MetaBlock style={{ marginBottom: 0, marginTop: 10 }}>
            <MetaLabel>Homepage</MetaLabel>
            <MetaValue style={{ fontSize: 13 }}>
              <LinkIcon size={14} />
              <a
                href={packument.homepage}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "var(--ms-brand, var(--color-link))",
                  textDecoration: "none",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {packument.homepage.replace(/^https?:\/\//, "")}
              </a>
            </MetaValue>
          </MetaBlock>
        )}

        {/* Cryptographic Provenance */}
        {(normalizedHash || packageSignature) && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--ms-border, var(--color-border))" }}>
            <MetaLabel style={{ marginBottom: 6 }}>Provenance &amp; Integrity</MetaLabel>
            {normalizedHash && (
              <div
                onClick={handleCopyHash}
                title={`Click to copy full digest: sha256:${normalizedHash}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "7px 10px",
                  borderRadius: 6,
                  background: "var(--ms-surface-hover, var(--color-canvas-subtle))",
                  border: "1px solid var(--ms-border, var(--color-border))",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 11.5,
                  color: "var(--ms-text-1, var(--color-text-primary))",
                  cursor: "pointer",
                  transition: "border-color 0.15s ease",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <ShieldCheckIcon size={13} fill="var(--color-success-fg, #2da44e)" />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    sha256:{normalizedHash.slice(0, 12)}…
                  </span>
                </span>
                <span
                  style={{ color: "var(--ms-text-3, var(--color-text-muted))", flexShrink: 0, display: "inline-flex" }}
                >
                  {copiedHash ? (
                    <CheckIcon size={13} fill="var(--color-success-fg, #2da44e)" />
                  ) : (
                    <CopyIcon size={13} />
                  )}
                </span>
              </div>
            )}
            <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {packageSignature && (
                <Label variant="success" style={{ fontSize: 10 }}>
                  <VerifiedIcon size={11} /> Signed Release
                </Label>
              )}
              <a
                href={`/api/v1/libraries/${name.startsWith("@") ? name.split("/").map(encodeURIComponent).join("/") : encodeURIComponent(name)}/${encodeURIComponent(version)}/provenance.json`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "none" }}
              >
                <Label variant="accent" style={{ fontSize: 10, cursor: "pointer" }}>
                  <ShieldCheckIcon size={11} /> SLSA Level 3
                </Label>
              </a>
            </div>
          </div>
        )}
      </SidebarCard>

      {/* ── Card 3: Activity & Ecosystem ── */}
      <SidebarCard>
        <SidebarCardHeader>
          <SidebarCardTitle>Activity &amp; Ecosystem</SidebarCardTitle>
        </SidebarCardHeader>

        {/* 30-Day Download Trends */}
        <MetaBlock style={{ marginBottom: showPolyglotDomains || dependents.length > 0 || hasCae ? 14 : 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <MetaLabel style={{ marginBottom: 0 }}>Downloads (30d)</MetaLabel>
            <Text
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ms-text-1, var(--color-text-heading))",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              {downloads30d.toLocaleString()}
            </Text>
          </div>
          {totalDownloads > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "var(--ms-text-3, var(--color-text-muted))",
                marginTop: 2,
              }}
            >
              <span>All-time total</span>
              <span>{totalDownloads.toLocaleString()}</span>
            </div>
          )}
          {hasNonZeroSparkline &&
            packageStats?.daily &&
            (() => {
              const maxVal = Math.max(...packageStats.daily.map((d) => d.downloads), 1);
              return (
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
              );
            })()}
        </MetaBlock>

        {/* Polyglot Engineering Domains */}
        {showPolyglotDomains && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--ms-border, var(--color-border))" }}>
            <MetaLabel style={{ marginBottom: 8 }}>Polyglot Domains ({displayedDomains.length})</MetaLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {displayedDomains.map((d) => (
                <span
                  key={d.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    borderRadius: "6px",
                    fontSize: 12,
                    fontWeight: 600,
                    background: "var(--ms-surface-hover, var(--color-canvas-subtle))",
                    border: `1px solid ${d.color}44`,
                    color: d.color,
                  }}
                >
                  <span>
                    {React.isValidElement(d.icon)
                      ? d.icon
                      : d.icon
                        ? React.createElement(d.icon as React.ComponentType<{ size?: number }>, { size: 12 })
                        : null}
                  </span>
                  <span>{d.label}</span>
                  <span style={{ opacity: 0.7, fontSize: 11 }}>({d.count})</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Dependents ("Used by") */}
        {dependents.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--ms-border, var(--color-border))" }}>
            <MetaLabel style={{ marginBottom: 8 }}>Used by ({dependents.length})</MetaLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {dependents.slice(0, 8).map((dep) => (
                <DependentBadge key={dep.name} to={`/packages/${dep.name}/${dep.version}`}>
                  <PackageIcon size={12} />
                  {dep.name}
                </DependentBadge>
              ))}
              {dependents.length > 8 && (
                <Text style={{ fontSize: 11, color: "var(--ms-text-3, var(--color-text-muted))", alignSelf: "center" }}>
                  +{dependents.length - 8} more
                </Text>
              )}
            </div>
          </div>
        )}

        {/* Linked Studies & Jobs (Feature-Gated by cae_cloud_solver) */}
        {hasCae &&
          (() => {
            const bundled = linkedStudies?.bundledStudies || [];
            const templates = linkedStudies?.linkedTemplates || [];
            const jobs = linkedStudies?.linkedJobs || [];
            const totalLinked = bundled.length + templates.length + jobs.length;

            return (
              <div
                style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--ms-border, var(--color-border))" }}
              >
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}
                >
                  <MetaLabel style={{ marginBottom: 0 }}>Linked Studies &amp; Jobs ({totalLinked})</MetaLabel>
                  {onOpenStudiesTab && (
                    <Button
                      size="small"
                      variant="invisible"
                      onClick={onOpenStudiesTab}
                      style={{
                        fontSize: 11,
                        padding: "2px 6px",
                        color: "var(--ms-brand, var(--color-accent-cyan, #06b6d4))",
                      }}
                    >
                      View all →
                    </Button>
                  )}
                </div>
                {totalLinked > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {[...bundled, ...templates].slice(0, 3).map((tpl) => (
                      <DependentBadge
                        key={`tpl-${tpl.slug}`}
                        to={`/jobs/templates/${tpl.slug}?package=${encodeURIComponent(name)}&version=${encodeURIComponent(version)}`}
                        title={`Study Template (${(tpl.standardFormat || "sedml").toUpperCase()})`}
                      >
                        <BeakerIcon size={12} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {tpl.name}
                        </span>
                        <Label variant="secondary" style={{ fontSize: 9, padding: "0 4px", marginLeft: "auto" }}>
                          .
                          {tpl.standardFormat === "ssp-ssv"
                            ? "ssv"
                            : tpl.standardFormat === "dakota"
                              ? "dakota"
                              : "sedml"}
                        </Label>
                      </DependentBadge>
                    ))}
                    {jobs.slice(0, 3).map((job) => (
                      <DependentBadge
                        key={`job-${job.id}`}
                        to={`/jobs/${job.id}`}
                        title={`Study Instance Run #${job.id}`}
                      >
                        <PlayIcon size={12} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {job.name}
                        </span>
                        <Label variant="accent" style={{ fontSize: 9, padding: "0 4px", marginLeft: "auto" }}>
                          #{job.id}
                        </Label>
                      </DependentBadge>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <Text
                      style={{ fontSize: 12, color: "var(--ms-text-3, var(--color-text-muted))", fontStyle: "italic" }}
                    >
                      No linked study instances yet
                    </Text>
                    {onOpenStudiesTab && (
                      <Button
                        size="small"
                        leadingVisual={BeakerIcon}
                        onClick={onOpenStudiesTab}
                        style={{ fontSize: 11 }}
                      >
                        Run Study on {name.split("/").pop()}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
      </SidebarCard>

      {/* ── Card 4: Maintainers ── */}
      <SidebarCard style={{ marginBottom: 0 }}>
        <SidebarCardHeader>
          <SidebarCardTitle>
            Maintainers
            {(packageOwner ? 1 : 0) + collaborators.length > 0
              ? ` (${(packageOwner ? 1 : 0) + collaborators.length})`
              : ""}
          </SidebarCardTitle>
          {canManage && (
            <Button
              size="small"
              variant="invisible"
              onClick={onOpenManageCollaborators}
              style={{ fontSize: 11, padding: "2px 6px" }}
            >
              Manage
            </Button>
          )}
        </SidebarCardHeader>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {packageOwner && (
            <Link
              to={`/${packageOwner}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px",
                borderRadius: 6,
                fontSize: 12,
                background: "var(--ms-surface-hover, var(--color-canvas-subtle))",
                border: "1px solid var(--ms-border, var(--color-border))",
                color: "var(--ms-text-1, var(--color-text-primary))",
                textDecoration: "none",
              }}
            >
              <PeopleIcon size={12} />
              <span>@{packageOwner}</span>
              <Label variant="accent" style={{ fontSize: 9, padding: "0 4px" }}>
                owner
              </Label>
            </Link>
          )}
          {collaborators.map((c) => (
            <Link
              key={c.username}
              to={`/@${c.username}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px",
                borderRadius: 6,
                fontSize: 12,
                background: "var(--ms-surface-hover, var(--color-canvas-subtle))",
                border: "1px solid var(--ms-border, var(--color-border))",
                color: "var(--ms-text-1, var(--color-text-primary))",
                textDecoration: "none",
              }}
            >
              <PeopleIcon size={12} />
              <span>@{c.username}</span>
              <Label variant="secondary" style={{ fontSize: 9, padding: "0 4px" }}>
                {c.permission}
              </Label>
            </Link>
          ))}
          {!packageOwner && collaborators.length === 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 12,
                background: "var(--ms-surface-hover, var(--color-canvas-subtle))",
                border: "1px solid var(--ms-border, var(--color-border))",
                color: "var(--ms-text-3, var(--color-text-muted))",
              }}
            >
              <VerifiedIcon size={13} fill="var(--ms-brand, var(--color-accent-cyan, #06b6d4))" />
              <span>Official Standard Library</span>
            </span>
          )}
        </div>
      </SidebarCard>
    </aside>
  );
};
