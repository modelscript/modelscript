// SPDX-License-Identifier: AGPL-3.0-or-later

import { DownloadIcon, ZapIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
import Box from "../../../components/Box";
import type { PostItem } from "../../../types/api";
import { buildEditorUrlForArtifact, isMultiFileArtifact } from "../../../util/editor-routing";
import type { NotebookHeading, NotebookMetadata } from "../../../util/notebook";
import { ActionDockBtn, DockTitle, SimulationDockPane, TelemetryCard, TelemetryGrid } from "../styles";

export interface TutorialGuideDockPaneProps {
  post: PostItem;
  notebookData: NotebookMetadata;
  notebookHeadings: NotebookHeading[];
  readTimeMinutes: number;
  activeHeadingSlug: string;
  setActiveHeadingSlug: (slug: string) => void;
}

export const TutorialGuideDockPane: React.FC<TutorialGuideDockPaneProps> = ({
  post,
  notebookData,
  notebookHeadings,
  readTimeMinutes,
  activeHeadingSlug,
  setActiveHeadingSlug,
}) => {
  const navigate = useNavigate();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postAny = post as any;
  const primaryArtifactId = postAny.artifact_view_id ?? post.artifact_id ?? notebookData.artifactIds?.[0];
  const primaryArtifactView =
    (primaryArtifactId ? postAny.artifact_views?.[primaryArtifactId] : undefined) || postAny.artifact_view;
  const isMultiFileTutorial = Boolean(
    primaryArtifactView &&
    isMultiFileArtifact({
      ...primaryArtifactView,
      view_type: primaryArtifactView.view_type || primaryArtifactView.artifact_type || postAny.artifact_type,
    }),
  );

  return (
    <SimulationDockPane style={{ position: "static" }}>
      <DockTitle>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>📑</span>
          <span>ON THIS PAGE</span>
        </div>
        <span
          style={{
            fontSize: "10.5px",
            color: "var(--color-accent-cyan)",
            background: "rgba(6, 182, 212, 0.12)",
            border: "1px solid rgba(6, 182, 212, 0.28)",
            padding: "2px 8px",
            borderRadius: "12px",
            fontWeight: 600,
          }}
        >
          ⏱ {readTimeMinutes} MIN READ
        </span>
      </DockTitle>

      {notebookHeadings.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            borderLeft: "2px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1))",
            paddingLeft: "10px",
            maxHeight: "300px",
            overflowY: "auto",
          }}
        >
          {notebookHeadings.map((h, i) => {
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
                  padding: "4px 8px",
                  marginLeft: h.level === 3 ? "10px" : "0px",
                  borderRadius: "6px",
                  fontSize: h.level === 3 ? "12px" : "12.5px",
                  fontWeight: isActive ? 700 : h.level === 3 ? 500 : 600,
                  color: isActive
                    ? "var(--color-accent-cyan)"
                    : h.level === 3
                      ? "var(--color-text-muted)"
                      : "var(--color-text-secondary)",
                  background: isActive ? "rgba(6, 182, 212, 0.12)" : "transparent",
                  textDecoration: "none",
                  transition: "all 0.15s ease",
                }}
              >
                {h.text}
              </a>
            );
          })}
        </div>
      ) : (
        <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
          Add <code>## Section</code> headings in Markdown to populate the interactive Table of Contents.
        </Text>
      )}

      {notebookData.cells.some((c) => c.type === "artifact") && (
        <div
          style={{
            borderTop: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))",
            paddingTop: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
            }}
          >
            Interactive Figures
          </span>
          {notebookData.cells
            .filter((c): c is Extract<typeof c, { type: "artifact" }> => c.type === "artifact")
            .map((artCell, idx) => (
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
                  border: "1px solid rgba(139, 92, 246, 0.25)",
                  background: "rgba(139, 92, 246, 0.08)",
                  color: "var(--color-text-primary)",
                  fontSize: "12px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontWeight: 700,
                    color: "var(--color-accent-cyan)",
                  }}
                >
                  Fig. {idx + 1}:
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {artCell.caption || artCell.title || `Artifact #${artCell.artifactId}`}
                </span>
              </button>
            ))}
        </div>
      )}

      <TelemetryGrid>
        <TelemetryCard>
          <span className="label">DIFFICULTY</span>
          <span className="val">{notebookData.difficulty || "Intermediate"}</span>
          <span className="sub">{notebookData.series || "Engineering Guide"}</span>
        </TelemetryCard>
        <TelemetryCard>
          <span className="label">DIALECT / ENGINE</span>
          <span className="val">{notebookData.dialect || "Modelica 3.4"}</span>
          <span className="sub">WASM Linear DAE Arena</span>
        </TelemetryCard>
      </TelemetryGrid>

      <Box display="flex" gap={2} flexWrap="wrap">
        <ActionDockBtn
          $primary
          style={{ flex: 1.3 }}
          onClick={() => {
            const matches = Array.from((post.content || "").matchAll(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g));
            const firstFenceLang = matches[0]?.[1]?.trim();
            const codeBlocks = matches.map((m) => m[2]?.trim()).filter(Boolean);
            const combinedSource = codeBlocks.join("\n\n");
            const targetUrl = buildEditorUrlForArtifact({
              artifactId: primaryArtifactId,
              viewType: primaryArtifactView?.view_type || primaryArtifactView?.artifact_type || postAny.artifact_type,
              viewConfig: primaryArtifactView?.view_config || postAny.artifact_config,
              code: combinedSource || (!primaryArtifactId ? post.content || "" : undefined),
              title: notebookData.title || `Tutorial-${post.id}`,
              dialect: notebookData.dialect || firstFenceLang || undefined,
            });
            navigate(targetUrl);
          }}
        >
          <ZapIcon />
          {isMultiFileTutorial ? "Open in Web IDE" : "Open in Playground"}
        </ActionDockBtn>
        <ActionDockBtn
          style={{ flex: 1 }}
          onClick={() => {
            const blob = new Blob([post.content || ""], { type: "text/markdown;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${(notebookData.title || `tutorial-${post.id}`).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }}
          title="Download tutorial as Markdown"
        >
          <DownloadIcon />
          .md
        </ActionDockBtn>
      </Box>
    </SimulationDockPane>
  );
};

export default TutorialGuideDockPane;
