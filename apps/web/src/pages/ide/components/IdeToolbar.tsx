// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, CodeIcon, GitBranchIcon, LinkExternalIcon, ShareIcon, SyncIcon } from "@primer/octicons-react";
import { Button, IconButton, Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import { Badge, BreadcrumbText, Toolbar, ToolbarLeft, ToolbarRight } from "../styles";
import type { IdeArtifactMetadata, LspStatusState } from "../types";

export interface IdeToolbarProps {
  backUrl?: string | undefined;
  onBack: () => void;
  namespace?: string | undefined;
  project?: string | undefined;
  provider?: string | undefined;
  branchName?: string | undefined;
  displayTitle: string;
  artifactMetadata: IdeArtifactMetadata | null;
  packageNameFromHash: string | null;
  isDeprecated: boolean;
  lspStatus: LspStatusState | null;
  shareLabel?: string | undefined;
  onOpenInPlayground?: (() => void) | undefined;
  onRestartLsp: () => void;
  onShare: () => void;
  onReload: () => void;
  onOpenDedicatedTab: () => void;
}

export const IdeToolbar: React.FC<IdeToolbarProps> = ({
  backUrl,
  onBack,
  namespace,
  project,
  provider,
  branchName,
  displayTitle,
  artifactMetadata,
  packageNameFromHash,
  isDeprecated,
  lspStatus,
  shareLabel,
  onOpenInPlayground,
  onRestartLsp,
  onShare,
  onReload,
  onOpenDedicatedTab,
}) => {
  return (
    <Toolbar>
      <ToolbarLeft>
        {backUrl && (
          <IconButton
            aria-label="Back"
            icon={ArrowLeftIcon}
            size="small"
            variant="invisible"
            onClick={onBack}
            sx={{ color: "var(--color-fg-muted)" }}
          />
        )}

        <BreadcrumbText>
          <CodeIcon />
          {namespace && project ? (
            <>
              <Link to={`/repos/${provider || "github"}/${namespace}/${project}`}>{namespace}</Link>
              <span className="separator">/</span>
              <Link to={`/repos/${provider || "github"}/${namespace}/${project}`}>
                <strong>{project}</strong>
              </Link>
              {branchName && (
                <Badge>
                  <GitBranchIcon size={12} />
                  {branchName}
                </Badge>
              )}
            </>
          ) : (
            <>
              <Text style={{ fontWeight: 600 }}>{displayTitle}</Text>
              <Badge>memfs</Badge>
              {artifactMetadata?.viewType && (
                <Badge sx={{ textTransform: "uppercase", background: "rgba(6, 182, 212, 0.15)", color: "#06b6d4" }}>
                  {artifactMetadata.viewType}
                </Badge>
              )}
              {packageNameFromHash && (
                <Badge sx={{ background: "rgba(139, 92, 246, 0.15)", color: "#a78bfa" }}>package</Badge>
              )}
              {isDeprecated && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "11px",
                    fontFamily: "var(--font-mono, monospace)",
                    padding: "1px 6px",
                    borderRadius: "4px",
                    backgroundColor: "rgba(210, 153, 34, 0.15)",
                    color: "#d29922",
                    border: "1px solid rgba(210, 153, 34, 0.3)",
                    fontWeight: 600,
                  }}
                >
                  Deprecated
                </span>
              )}
            </>
          )}
        </BreadcrumbText>
      </ToolbarLeft>

      <ToolbarRight>
        {lspStatus && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              fontSize: "11px",
              fontFamily: "var(--font-mono, monospace)",
              padding: "2px 8px",
              borderRadius: "999px",
              background:
                lspStatus.status === "ready"
                  ? "rgba(46, 160, 67, 0.15)"
                  : lspStatus.status === "loading"
                    ? "rgba(210, 153, 34, 0.15)"
                    : "rgba(248, 81, 73, 0.15)",
              color:
                lspStatus.status === "ready"
                  ? "var(--ms-success)"
                  : lspStatus.status === "loading"
                    ? "#d29922"
                    : "var(--ms-danger)",
              border: `1px solid ${
                lspStatus.status === "ready"
                  ? "rgba(46, 160, 67, 0.3)"
                  : lspStatus.status === "loading"
                    ? "rgba(210, 153, 34, 0.3)"
                    : "rgba(248, 81, 73, 0.3)"
              }`,
              cursor: lspStatus.status === "error" || lspStatus.status === "offline" ? "pointer" : "default",
              fontWeight: 600,
            }}
            title={lspStatus.message || "ModelScript Language Server"}
            onClick={lspStatus.status === "error" || lspStatus.status === "offline" ? onRestartLsp : undefined}
          >
            {lspStatus.status === "ready"
              ? "● LSP Ready"
              : lspStatus.status === "loading"
                ? "◐ Reconnecting…"
                : "⚠ LSP Offline (Restart)"}
          </span>
        )}

        {onOpenInPlayground && (
          <Button size="small" variant="default" leadingVisual={CodeIcon} onClick={onOpenInPlayground}>
            Open in Playground
          </Button>
        )}

        <Button size="small" variant="primary" leadingVisual={ShareIcon} onClick={onShare}>
          {shareLabel || "Share to Feed"}
        </Button>

        <IconButton
          aria-label="Reload Workbench"
          icon={SyncIcon}
          size="small"
          variant="invisible"
          onClick={onReload}
          sx={{ color: "var(--color-fg-muted)" }}
        />

        <IconButton
          aria-label="Open in Dedicated Tab"
          icon={LinkExternalIcon}
          size="small"
          variant="invisible"
          onClick={onOpenDedicatedTab}
          sx={{ color: "var(--color-fg-muted)" }}
        />
      </ToolbarRight>
    </Toolbar>
  );
};
