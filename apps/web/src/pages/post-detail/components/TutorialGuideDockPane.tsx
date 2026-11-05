// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BookIcon,
  CheckIcon,
  CommentDiscussionIcon,
  CpuIcon,
  DownloadIcon,
  LinkIcon,
  ListUnorderedIcon,
  PackageIcon,
  PulseIcon,
  SlidersIcon,
  ZapIcon,
} from "@primer/octicons-react";
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PostItem } from "../../../types/api";
import { buildEditorUrlForArtifact, isMultiFileArtifact } from "../../../util/editor-routing";
import type { NotebookHeading, NotebookMetadata } from "../../../util/notebook";

export interface TutorialGuideDockPaneProps {
  post: PostItem;
  notebookData: NotebookMetadata;
  notebookHeadings: NotebookHeading[];
  readTimeMinutes: number;
  activeHeadingSlug: string;
  setActiveHeadingSlug: (slug: string) => void;
  readingProgress?: number | undefined;
}

export const TutorialGuideDockPane: React.FC<TutorialGuideDockPaneProps> = ({
  post,
  notebookData,
  notebookHeadings,
  readTimeMinutes,
  activeHeadingSlug,
  setActiveHeadingSlug,
  readingProgress = 0,
}) => {
  const navigate = useNavigate();
  const [copiedLink, setCopiedLink] = useState(false);

  const postAny = post as any;
  const primaryArtifactId = postAny.artifact_view_id ?? post.artifact_id ?? notebookData.artifactIds?.[0];
  const primaryArtifactView =
    (primaryArtifactId ? postAny.artifact_views?.[primaryArtifactId] : undefined) || postAny.artifact_view;
  const isMultiFileArticle = Boolean(
    primaryArtifactView &&
    isMultiFileArtifact({
      ...primaryArtifactView,
      view_type: primaryArtifactView.view_type || primaryArtifactView.artifact_type || postAny.artifact_type,
    }),
  );

  const codeFenceMatches = useMemo(
    () => Array.from((post.content || "").matchAll(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g)),
    [post.content],
  );

  const hasRunnableContent = Boolean(primaryArtifactId || codeFenceMatches.length > 0);

  const artifactCells = useMemo(
    () => notebookData.cells.filter((c): c is Extract<typeof c, { type: "artifact" }> => c.type === "artifact"),
    [notebookData.cells],
  );

  const properties = useMemo(() => {
    const items: { icon: React.ReactNode; label: string; value: string; href?: string | undefined }[] = [];
    if (notebookData.series?.trim()) {
      items.push({
        icon: <BookIcon size={12} />,
        label: "Series",
        value: `${notebookData.series.trim()}${notebookData.seriesPart ? ` · Part ${notebookData.seriesPart}` : ""}`,
      });
    }
    if (notebookData.difficulty?.trim()) {
      items.push({
        icon: <SlidersIcon size={12} />,
        label: "Difficulty",
        value: notebookData.difficulty.trim(),
      });
    }
    if (notebookData.dialect?.trim()) {
      items.push({
        icon: <CpuIcon size={12} />,
        label: "Dialect",
        value: notebookData.dialect.trim(),
      });
    }
    if (notebookData.companionRepo?.trim()) {
      items.push({
        icon: <PackageIcon size={12} />,
        label: "Repository",
        value: notebookData.companionRepo.trim(),
        href: notebookData.companionRepo.trim(),
      });
    }
    return items;
  }, [
    notebookData.series,
    notebookData.seriesPart,
    notebookData.difficulty,
    notebookData.dialect,
    notebookData.companionRepo,
  ]);

  const handleOpenPlayground = () => {
    const firstFenceLang = codeFenceMatches[0]?.[1]?.trim();
    const codeBlocks = codeFenceMatches.map((m) => m[2]?.trim()).filter(Boolean);
    const combinedSource = codeBlocks.join("\n\n");
    const targetUrl = buildEditorUrlForArtifact({
      artifactId: primaryArtifactId,
      viewType: primaryArtifactView?.view_type || primaryArtifactView?.artifact_type || postAny.artifact_type,
      viewConfig: primaryArtifactView?.view_config || postAny.artifact_config,
      code: combinedSource || (!primaryArtifactId ? post.content || "" : undefined),
      title: notebookData.title || `Article-${post.id}`,
      dialect: notebookData.dialect || firstFenceLang || undefined,
    });
    navigate(targetUrl);
  };

  const handleCopyLink = () => {
    const url = `${window.location.origin}/@${post.username}/status/${post.id}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleDownloadMarkdown = () => {
    const blob = new Blob([post.content || ""], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(notebookData.title || `article-${post.id}`).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const replyCount = Number((post as any).reply_count || 0);

  return (
    <div
      style={{
        background: "var(--color-bg-card)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid var(--color-border-glass)",
        borderRadius: "16px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        color: "var(--color-text-primary)",
        boxShadow: "var(--glow-card)",
      }}
    >
      {/* Header Row: On this page + Read Time */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--color-text-secondary)",
            }}
          >
            <ListUnorderedIcon size={13} />
            <span>On this page</span>
          </span>
          <span
            style={{
              fontSize: "11.5px",
              fontFamily: "var(--font-mono, monospace)",
              color: "var(--color-text-muted)",
              fontWeight: 500,
            }}
          >
            {readTimeMinutes} min read
          </span>
        </div>

        {/* Subtle Reading Progress Bar */}
        <div
          style={{
            height: "2px",
            width: "100%",
            background: "var(--color-border-subtle)",
            borderRadius: "999px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, Math.max(0, readingProgress))}%`,
              background: "var(--ms-gradient, var(--ms-brand))",
              transition: "width 0.15s ease-out",
            }}
          />
        </div>
      </div>

      {/* Table of Contents Tree */}
      <nav
        aria-label="Article table of contents"
        style={{
          display: "flex",
          flexDirection: "column",
          borderLeft: "1.5px solid var(--color-border-subtle)",
          maxHeight: "280px",
          overflowY: "auto",
        }}
      >
        {notebookHeadings.length > 0 ? (
          notebookHeadings.map((h, i) => {
            const isActive = activeHeadingSlug === h.id;
            return (
              <a
                key={`${h.id}-${i}`}
                href={`#${h.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  setActiveHeadingSlug(h.id);
                  document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                style={{
                  position: "relative",
                  padding: "5px 10px",
                  paddingLeft: h.level === 3 ? "22px" : "12px",
                  marginLeft: "-1.5px",
                  borderLeft: isActive ? "2px solid var(--ms-brand)" : "2px solid transparent",
                  fontSize: h.level === 3 ? "12.5px" : "13px",
                  lineHeight: "1.4",
                  fontWeight: isActive ? 650 : 450,
                  color: isActive
                    ? "var(--ms-brand)"
                    : h.level === 3
                      ? "var(--color-text-muted)"
                      : "var(--color-text-secondary)",
                  background: isActive ? "var(--ms-brand-soft)" : "transparent",
                  borderRadius: "0 6px 6px 0",
                  textDecoration: "none",
                  transition: "all 0.15s ease",
                }}
              >
                {h.text}
              </a>
            );
          })
        ) : (
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            style={{
              padding: "5px 12px",
              marginLeft: "-1.5px",
              borderLeft: "2px solid var(--ms-brand)",
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--ms-brand)",
              background: "var(--ms-brand-soft)",
              borderRadius: "0 6px 6px 0",
              textDecoration: "none",
            }}
          >
            {notebookData.title || "Article overview"}
          </a>
        )}

        {/* Jump to Discussion anchor */}
        <a
          href="#article-discussion"
          onClick={(e) => {
            e.preventDefault();
            const el = document.getElementById("article-discussion");
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "start" });
            } else {
              window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
            }
          }}
          style={{
            padding: "5px 12px",
            marginLeft: "-1.5px",
            borderLeft: "2px solid transparent",
            fontSize: "12.5px",
            fontWeight: 500,
            color: "var(--color-text-muted)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            marginTop: "2px",
          }}
        >
          <CommentDiscussionIcon size={12} />
          <span>Discussion{replyCount > 0 ? ` (${replyCount})` : ""}</span>
        </a>
      </nav>

      {/* Interactive Figures */}
      {artifactCells.length > 0 && (
        <div
          style={{
            borderTop: "1px solid var(--color-border-subtle)",
            paddingTop: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <PulseIcon size={12} />
            <span>Interactive Figures ({artifactCells.length})</span>
          </span>
          {artifactCells.map((artCell, idx) => (
            <button
              key={artCell.id}
              type="button"
              onClick={() => {
                document.getElementById(`fig-${idx + 1}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              style={{
                textAlign: "left",
                padding: "6px 10px",
                borderRadius: "8px",
                border: "1px solid var(--color-border-subtle)",
                background: "var(--color-canvas-subtle)",
                color: "var(--color-text-primary)",
                fontSize: "12.5px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                transition: "background-color 0.15s ease",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontWeight: 600,
                  fontSize: "11.5px",
                  color: "var(--ms-brand)",
                  flexShrink: 0,
                }}
              >
                Fig. {idx + 1}
              </span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--color-text-secondary)",
                }}
              >
                {artCell.caption || artCell.title || `Model #${artCell.artifactId}`}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Notion-style Article Properties (only rendered when properties are set) */}
      {properties.length > 0 && (
        <div
          style={{
            borderTop: "1px solid var(--color-border-subtle)",
            paddingTop: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {properties.map((prop) => (
            <div
              key={prop.label}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
                fontSize: "12.5px",
                lineHeight: "18px",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  color: "var(--color-text-muted)",
                  fontWeight: 500,
                }}
              >
                {prop.icon}
                <span>{prop.label}</span>
              </span>
              {prop.href ? (
                <button
                  type="button"
                  onClick={() => {
                    const repo = prop.href!;
                    if (repo.startsWith("http://") || repo.startsWith("https://")) {
                      window.open(repo, "_blank", "noopener,noreferrer");
                    } else {
                      navigate(`/explore?q=${encodeURIComponent(repo)}`);
                    }
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--ms-brand)",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {prop.value}
                </button>
              ) : (
                <span
                  style={{
                    color: "var(--color-text-primary)",
                    fontWeight: 600,
                    fontSize: "12.5px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {prop.value}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Article Actions */}
      <div
        style={{
          borderTop: "1px solid var(--color-border-subtle)",
          paddingTop: "12px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {hasRunnableContent && (
          <button
            type="button"
            className="ms-btn ms-btn-primary ms-btn-sm"
            onClick={handleOpenPlayground}
            style={{
              width: "100%",
              justifyContent: "center",
              gap: "6px",
              height: "34px",
              borderRadius: "8px",
              fontSize: "12.5px",
              fontWeight: 600,
            }}
          >
            <ZapIcon size={13} />
            <span>{isMultiFileArticle ? "Open in Studio" : "Open in Ansatz Sketch"}</span>
          </button>
        )}

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={handleCopyLink}
            style={{
              flex: 1,
              height: "32px",
              borderRadius: "8px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-btn-secondary-bg)",
              color: "var(--color-text-secondary)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              fontFamily: "inherit",
            }}
            title="Copy link to article"
          >
            {copiedLink ? <CheckIcon size={13} /> : <LinkIcon size={13} />}
            <span>{copiedLink ? "Copied" : "Copy link"}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadMarkdown}
            style={{
              flex: 1,
              height: "32px",
              borderRadius: "8px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-btn-secondary-bg)",
              color: "var(--color-text-secondary)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              fontFamily: "inherit",
            }}
            title="Download article as Markdown"
          >
            <DownloadIcon size={13} />
            <span>Export .md</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export const ArticleGuideDockPane = TutorialGuideDockPane;
export type ArticleGuideDockPaneProps = TutorialGuideDockPaneProps;

export default TutorialGuideDockPane;
