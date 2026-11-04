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
import {
  DependentBadge,
  Divider,
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

const ExportTile = styled.a<{ $activeColor?: string | undefined }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-glass-bg, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--color-border);
  color: ${(p) => p.$activeColor || "var(--color-text-primary)"};
  text-decoration: none;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--color-accent-cyan, #06b6d4);
    background: var(--surface-row-hover, rgba(255, 255, 255, 0.08));
    transform: translateY(-1px);
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
      {/* ── Install Snippet ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <MetaLabel style={{ marginBottom: 0 }}>Install</MetaLabel>
        <div
          style={{
            display: "inline-flex",
            background: "var(--color-canvas-subtle)",
            borderRadius: 6,
            padding: 2,
            border: "1px solid var(--color-border)",
          }}
        >
          {(["cli", "manifest", "import"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setInstallTab(tab)}
              style={{
                background: installTab === tab ? "var(--color-bg-card)" : "transparent",
                border: "none",
                borderRadius: 4,
                padding: "2px 8px",
                fontSize: 11,
                fontWeight: installTab === tab ? 600 : 400,
                color: installTab === tab ? "var(--color-text-primary)" : "var(--color-text-muted)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {tab.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
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
        style={{ marginBottom: 14 }}
      >
        <code style={{ fontSize: 12 }}>
          {installTab === "cli" && <span style={{ color: "var(--color-text-muted)" }}>&gt;&nbsp;</span>}
          {currentSnippet}
        </code>
        <span className="copy-icon">{copiedInstall ? <CheckIcon size={16} /> : <CopyIcon size={16} />}</span>
      </InstallBox>

      {/* ── Workspace & Source Download Actions ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {(activeIdeTitle || addedToIde) && (
          <button
            type="button"
            onClick={handleAddToActiveIde}
            title={`Hot-mount ${name}@${version} into active VS Code workspace (${activeIdeTitle || "Active Workspace"})`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              width: "100%",
              padding: "9px 14px",
              borderRadius: "8px",
              background: addedToIde
                ? "linear-gradient(135deg, #059669, #10b981)"
                : "linear-gradient(135deg, var(--color-accent-emphasis, #0969da), #2563eb)",
              color: "white",
              fontSize: "13px",
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(9, 105, 218, 0.25)",
              boxSizing: "border-box",
              transition: "all 0.2s ease",
            }}
          >
            {addedToIde ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
            {addedToIde ? `Added ${name}@${version} to Libraries!` : `Add to Active VS Code (${activeIdeTitle})`}
          </button>
        )}

        <Link
          to={`/ide#memfs:package-${name || "model"}?libs=${encodeURIComponent(`${name}@${version || "latest"}`)}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            width: "100%",
            padding: "9px 14px",
            borderRadius: "8px",
            background:
              activeIdeTitle || addedToIde
                ? "var(--color-canvas-subtle)"
                : "linear-gradient(135deg, var(--color-accent-emphasis, #0969da), #2563eb)",
            border: activeIdeTitle || addedToIde ? "1px solid var(--color-border)" : "none",
            color: activeIdeTitle || addedToIde ? "var(--color-text-primary)" : "#ffffff",
            fontSize: "13px",
            fontWeight: 600,
            textDecoration: "none",
            boxShadow: activeIdeTitle || addedToIde ? "none" : "0 2px 8px rgba(9, 105, 218, 0.2)",
            boxSizing: "border-box",
            transition: "all 0.2s ease",
          }}
        >
          <CodeIcon size={15} />
          Open in Web IDE Workspace
        </Link>

        {name && version && !hasAdvancedExports && (
          <a
            href={getPackageDownloadUrl(name, version)}
            download
            title={`Download ${name} v${version} source archive (.zip)`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              width: "100%",
              padding: "8px 14px",
              borderRadius: "8px",
              background: "var(--color-canvas-subtle)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
              fontSize: "13px",
              fontWeight: 600,
              textDecoration: "none",
              boxSizing: "border-box",
              transition: "all 0.15s ease",
            }}
          >
            <FileZipIcon size={15} style={{ color: "#eab308" }} />
            Download Source (.zip)
          </a>
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
          label="Cite Package (APA, BibTeX, CFF…)"
          variant="sidebar"
          testId="package-sidebar-cite-btn"
        />
      </div>

      {/* ── Advanced Exports & Downloads (Feature-Gated by package_advanced_exports) ── */}
      {hasAdvancedExports && name && version && (
        <MetaBlock style={{ marginBottom: 16 }}>
          <MetaLabel style={{ marginBottom: 8 }}>Download &amp; Export</MetaLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <ExportTile
              href={getPackageDownloadUrl(name, version)}
              download
              title="Download complete package ZIP archive"
            >
              <FileZipIcon size={16} style={{ color: "#eab308", flexShrink: 0 }} />
              <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Source</div>
                <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>.zip archive</div>
              </div>
            </ExportTile>
            <ExportTile
              href={getPackageAasxExportUrl(name, version)}
              download
              title="Export Industry 4.0 Asset Administration Shell (.aasx)"
            >
              <DownloadIcon size={16} style={{ color: "#a855f7", flexShrink: 0 }} />
              <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Asset Shell</div>
                <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>.aasx twin</div>
              </div>
            </ExportTile>
            <ExportTile
              href={getPackageOkhExportUrl(name, version)}
              download
              title="Export Open Know-How hardware manifest (.okh.json)"
            >
              <PackageIcon size={16} style={{ color: "var(--color-accent-cyan, #06b6d4)", flexShrink: 0 }} />
              <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Hardware</div>
                <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>.okh.json</div>
              </div>
            </ExportTile>
            <ExportTile
              href={getPackageSalsaIndexUrl(name, version)}
              download
              $activeColor={hasSalsaIndex ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-text-muted)"}
              title={
                hasSalsaIndex
                  ? "Download pre-indexed Salsa query database for instant WASM IDE indexing"
                  : "Salsa database will be compiled on demand"
              }
            >
              <DatabaseIcon size={16} style={{ color: "#3b82f6", flexShrink: 0 }} />
              <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Salsa DB</div>
                <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>.db index</div>
              </div>
            </ExportTile>
            <ExportTile
              href={getPackageDataPackageExportUrl(name, version)}
              download
              title="Export Frictionless Engineering Data Package manifest (datapackage.json) with dataset schemas & units"
            >
              <DatabaseIcon size={16} style={{ color: "#10b981", flexShrink: 0 }} />
              <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Data Package</div>
                <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>datapackage.json</div>
              </div>
            </ExportTile>
            <ExportTile
              href={getPackageLockfileExportUrl(name, version)}
              download
              title="Export reproducible environment & dataset lockfile (datapackage.lock.json)"
            >
              <ShieldCheckIcon size={16} style={{ color: "#22d3ee", flexShrink: 0 }} />
              <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Lockfile</div>
                <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>datapackage.lock</div>
              </div>
            </ExportTile>
          </div>
        </MetaBlock>
      )}

      <Divider style={{ margin: "12px 0 18px" }} />

      {/* ── Package Metadata Grid ── */}
      <MetaGrid style={{ gap: 16, marginBottom: 16 }}>
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
        <MetaBlock style={{ marginBottom: 14 }}>
          <MetaLabel>Repository</MetaLabel>
          <MetaValue style={{ fontSize: 13 }}>
            <BookIcon size={14} />
            <a
              href={packument.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "var(--color-link)",
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
        <MetaBlock style={{ marginBottom: 14 }}>
          <MetaLabel>Homepage</MetaLabel>
          <MetaValue style={{ fontSize: 13 }}>
            <LinkIcon size={14} />
            <a
              href={packument.homepage}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "var(--color-link)",
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

      {/* ── Cryptographic Provenance (Fixed duplicate sha256: prefix) ── */}
      {(normalizedHash || packageSignature) && (
        <MetaBlock style={{ marginBottom: 16 }}>
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
                background: "var(--color-canvas-subtle)",
                border: "1px solid var(--color-border)",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 11.5,
                color: "var(--color-text-primary)",
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
              <span style={{ color: "var(--color-text-muted)", flexShrink: 0, display: "inline-flex" }}>
                {copiedHash ? <CheckIcon size={13} fill="var(--color-success-fg, #2da44e)" /> : <CopyIcon size={13} />}
              </span>
            </div>
          )}
          {packageSignature && (
            <div style={{ marginTop: 6 }}>
              <Label variant="success" style={{ fontSize: 10 }}>
                <VerifiedIcon size={11} /> Signed Release
              </Label>
            </div>
          )}
        </MetaBlock>
      )}

      {/* ── Polyglot Engineering Domains ── */}
      {showPolyglotDomains && (
        <MetaBlock style={{ marginBottom: 16 }}>
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
                  background: "var(--color-canvas-subtle)",
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
        </MetaBlock>
      )}

      <Divider style={{ margin: "4px 0 16px" }} />

      {/* ── 30-Day Download Trends ── */}
      <MetaBlock style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <MetaLabel style={{ marginBottom: 0 }}>Downloads (30d)</MetaLabel>
          <Text
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--color-text-heading)",
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
              color: "var(--color-text-muted)",
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

      {/* ── Dependents ("Used by") ── */}
      {dependents.length > 0 && (
        <MetaBlock style={{ marginBottom: 16 }}>
          <MetaLabel style={{ marginBottom: 8 }}>Used by ({dependents.length})</MetaLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {dependents.slice(0, 8).map((dep) => (
              <DependentBadge key={dep.name} to={`/packages/${dep.name}/${dep.version}`}>
                <PackageIcon size={12} />
                {dep.name}
              </DependentBadge>
            ))}
            {dependents.length > 8 && (
              <Text style={{ fontSize: 11, color: "var(--color-text-muted)", alignSelf: "center" }}>
                +{dependents.length - 8} more
              </Text>
            )}
          </div>
        </MetaBlock>
      )}

      {/* ── Linked Studies, Study Instances & Jobs (Feature-Gated by cae_cloud_solver) ── */}
      {hasCae && <Divider style={{ margin: "4px 0 16px" }} />}
      {hasCae &&
        (() => {
          const bundled = linkedStudies?.bundledStudies || [];
          const templates = linkedStudies?.linkedTemplates || [];
          const jobs = linkedStudies?.linkedJobs || [];
          const totalLinked = bundled.length + templates.length + jobs.length;

          return (
            <MetaBlock style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <MetaLabel style={{ marginBottom: 0 }}>Linked Studies &amp; Jobs ({totalLinked})</MetaLabel>
                {onOpenStudiesTab && (
                  <Button
                    size="small"
                    variant="invisible"
                    onClick={onOpenStudiesTab}
                    style={{ fontSize: 11, padding: "2px 6px", color: "var(--color-accent-cyan, #06b6d4)" }}
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
                  <Text style={{ fontSize: 12, color: "var(--color-text-muted)", fontStyle: "italic" }}>
                    No linked study instances yet
                  </Text>
                  {onOpenStudiesTab && (
                    <Button size="small" leadingVisual={BeakerIcon} onClick={onOpenStudiesTab} style={{ fontSize: 11 }}>
                      Run Study on {name.split("/").pop()}
                    </Button>
                  )}
                </div>
              )}
            </MetaBlock>
          );
        })()}

      <Divider style={{ margin: "4px 0 16px" }} />

      {/* ── Maintainers & Collaborators ── */}
      <MetaBlock style={{ marginBottom: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <MetaLabel style={{ marginBottom: 0 }}>
            Maintainers
            {(packageOwner ? 1 : 0) + collaborators.length > 0
              ? ` (${(packageOwner ? 1 : 0) + collaborators.length})`
              : ""}
          </MetaLabel>
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
        </div>
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
                background: "var(--color-canvas-subtle)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
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
              to={`/${c.username}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px",
                borderRadius: 6,
                fontSize: 12,
                background: "var(--color-canvas-subtle)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
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
                background: "var(--color-canvas-subtle)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-muted)",
              }}
            >
              <VerifiedIcon size={13} fill="var(--color-accent-cyan, #06b6d4)" />
              <span>Official Standard Library</span>
            </span>
          )}
        </div>
      </MetaBlock>
    </aside>
  );
};
