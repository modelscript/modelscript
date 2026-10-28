// SPDX-License-Identifier: AGPL-3.0-or-later

import {
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
  ShieldCheckIcon,
  VerifiedIcon,
} from "@primer/octicons-react";
import { Button, Label, Text } from "@primer/react";
import React, { useState } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import {
  getPackageAasxExportUrl,
  getPackageDownloadUrl,
  getPackageOkhExportUrl,
  getPackageSalsaIndexUrl,
  type LibraryDetail,
  type NpmPackument,
  type NpmVersionManifest,
  type PackageCollaborator,
  type PackageDependent,
  type PackageStats,
} from "../../../api";
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
  packageOwner,
  collaborators,
  canManage,
  onOpenManageCollaborators,
  hasSalsaIndex,
}) => {
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
      ? installCmd
      : installTab === "manifest"
        ? `"${name}": "^${version}"`
        : `import { ${importIdentifier} } from "${importSpecifier}";`;

  const handleCopyInstall = () => {
    navigator.clipboard.writeText(currentSnippet);
    setCopiedInstall(true);
    setTimeout(() => setCopiedInstall(false), 2000);
  };

  const handleCopyHash = () => {
    if (contentHash) {
      navigator.clipboard.writeText(contentHash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  return (
    <aside style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <MetaLabel style={{ marginBottom: 0 }}>Install</MetaLabel>
        <div
          style={{
            display: "inline-flex",
            background: "var(--color-canvas-subtle, rgba(255,255,255,0.05))",
            borderRadius: 6,
            padding: 2,
            border: "1px solid var(--color-border-subtle, rgba(255,255,255,0.08))",
          }}
        >
          {(["cli", "manifest", "import"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setInstallTab(tab)}
              style={{
                background: installTab === tab ? "var(--color-bg-card, rgba(255,255,255,0.15))" : "transparent",
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
      >
        <code style={{ fontSize: 12 }}>
          {installTab === "cli" && <span style={{ color: "var(--color-text-muted)" }}>&gt;&nbsp;</span>}
          {currentSnippet}
        </code>
        <span className="copy-icon">{copiedInstall ? <VerifiedIcon size={16} /> : <CopyIcon size={16} />}</span>
      </InstallBox>

      <Link
        to={`/ide#memfs:package-${name || "model"}`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          width: "100%",
          padding: "10px 16px",
          borderRadius: "8px",
          background: "linear-gradient(135deg, var(--color-accent-emphasis, #0969da), #2563eb)",
          color: "white",
          fontSize: "14px",
          fontWeight: 600,
          textDecoration: "none",
          marginBottom: "16px",
          boxShadow: "0 2px 8px rgba(9, 105, 218, 0.25)",
          boxSizing: "border-box",
          transition: "all 0.2s ease",
        }}
      >
        <CodeIcon size={16} />
        Open in ModelScript IDE
      </Link>

      {/* Direct Exports & Downloads */}
      {name && version && (
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
          </div>
        </MetaBlock>
      )}

      {packument?.repository?.url && (
        <MetaBlock>
          <MetaLabel>Repository</MetaLabel>
          <MetaValue>
            <BookIcon size={16} />
            <a
              href={packument.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--color-heading)", textDecoration: "none" }}
            >
              {packument.repository.url.replace(/^git\+https:\/\//, "").replace(/\.git$/, "")}
            </a>
          </MetaValue>
        </MetaBlock>
      )}

      {packument?.homepage && (
        <MetaBlock>
          <MetaLabel>Homepage</MetaLabel>
          <MetaValue>
            <LinkIcon size={16} />
            <a
              href={packument.homepage}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--color-heading)", textDecoration: "none" }}
            >
              {packument.homepage.replace(/^https?:\/\//, "")}
            </a>
          </MetaValue>
        </MetaBlock>
      )}

      <Divider />

      <MetaGrid>
        <MetaBlock style={{ marginBottom: 0 }}>
          <MetaLabel>Version</MetaLabel>
          <MetaValue>{version}</MetaValue>
        </MetaBlock>
        {(libraryDetail?.license || packument?.license) && (
          <MetaBlock style={{ marginBottom: 0 }}>
            <MetaLabel>License</MetaLabel>
            <MetaValue>{libraryDetail?.license || packument?.license}</MetaValue>
          </MetaBlock>
        )}
      </MetaGrid>

      <MetaBlock>
        <MetaLabel>Last publish</MetaLabel>
        <MetaValue>{publishedAt ? timeAgo(publishedAt) : "—"}</MetaValue>
      </MetaBlock>

      {currentManifest?.modelscript?.modelicaVersion && (
        <MetaBlock>
          <MetaLabel>Modelica Version</MetaLabel>
          <MetaValue>{currentManifest.modelscript.modelicaVersion}</MetaValue>
        </MetaBlock>
      )}

      {/* Cryptographic Provenance */}
      {(contentHash || packageSignature) && (
        <MetaBlock>
          <MetaLabel style={{ marginBottom: 6 }}>Provenance &amp; Integrity</MetaLabel>
          {contentHash && (
            <div
              onClick={handleCopyHash}
              title={`Click to copy full digest: ${contentHash}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 6,
                background: "var(--color-canvas-subtle, rgba(0, 0, 0, 0.25))",
                border: "1px solid var(--color-border)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-text-primary)",
                cursor: "pointer",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <ShieldCheckIcon size={13} fill="var(--color-success-fg, #2da44e)" />
                <span>sha256:{contentHash.slice(0, 14)}…</span>
              </span>
              {copiedHash ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
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

      {/* Polyglot Engineering Domains */}
      {availableDomains.filter((d) => d.id !== "all").length > 1 && (
        <MetaBlock>
          <MetaLabel style={{ marginBottom: 8 }}>
            Polyglot Domains ({availableDomains.filter((d) => d.id !== "all").length})
          </MetaLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {availableDomains
              .filter((d) => d.id !== "all")
              .map((d) => (
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
                    background: "var(--color-glass-bg, rgba(255,255,255,0.04))",
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

      <Divider />

      {/* 30-Day Download Trends */}
      <MetaBlock>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <MetaLabel>Downloads</MetaLabel>
          <Text style={{ fontSize: 13, fontWeight: 600, color: "var(--color-heading)" }}>
            {(packageStats?.daily?.reduce((acc, d) => acc + d.downloads, 0) ?? 0).toLocaleString()}
          </Text>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--color-text-muted)",
            marginTop: 2,
          }}
        >
          <span>Total: {(packageStats?.totalDownloads ?? 0).toLocaleString()}</span>
          <span>Last 30 days</span>
        </div>
        {packageStats?.daily &&
          packageStats.daily.length > 0 &&
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

      <Divider />

      {/* Dependents ("Used by") */}
      <MetaBlock>
        <MetaLabel style={{ marginBottom: 8 }}>Used by ({dependents.length})</MetaLabel>
        {dependents.length > 0 ? (
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
        ) : (
          <Text style={{ fontSize: 12, color: "var(--color-text-muted)", fontStyle: "italic" }}>
            0 packages depend on this library
          </Text>
        )}
      </MetaBlock>

      <Divider />

      {/* Maintainers & Collaborators */}
      <MetaBlock>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <MetaLabel>Maintainers ({(packageOwner ? 1 : 0) + collaborators.length})</MetaLabel>
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
                background: "var(--color-glass-bg, rgba(255,255,255,0.04))",
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
                background: "var(--color-glass-bg, rgba(255,255,255,0.04))",
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
            <Text style={{ fontSize: 12, color: "var(--color-text-muted)", fontStyle: "italic" }}>
              Core registry library
            </Text>
          )}
        </div>
      </MetaBlock>
    </aside>
  );
};
