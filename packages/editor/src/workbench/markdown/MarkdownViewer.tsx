// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import type { AnsatzRelationalHypergraphRecord } from "../util/lsp-bridge.js";
import type { ZonotopePendingOverride, ZonotopeWorkbenchState } from "../util/zonotope-workbench-state.js";
import { DiagramMacro } from "./macros/DiagramMacro.js";
import { RequirementsMacro } from "./macros/RequirementsMacro.js";
import { remarkInterpolation } from "./remark-interpolation-plugin.js";
import { ZonotopeProseAnnotator } from "./ZonotopeProseAnnotator.js";

interface DirectiveNode {
  type: string;
  name?: string;
  attributes?: Record<string, string>;
  data?: {
    hName?: string;
    hProperties?: Record<string, string>;
    [key: string]: unknown;
  };
}

// Convert remark-directive and var nodes to HAST elements that react-markdown can map to React components
function remarkDirectiveToHast() {
  return (tree: Parameters<typeof visit>[0]) => {
    visit(tree, (rawNode) => {
      const node = rawNode as unknown as DirectiveNode;
      if (node.type === "textDirective" || node.type === "leafDirective" || node.type === "containerDirective") {
        const data = node.data || (node.data = {});
        if (node.name !== undefined) {
          data.hName = node.name;
        }
        data.hProperties = node.attributes || {};
      }
    });
  };
}

export interface MarkdownViewerProps {
  content: string;
  context?: Record<string, unknown> | undefined;
  className?: string | undefined;
  zonotopeWorkbenchState?: ZonotopeWorkbenchState | undefined;
  hypergraphRecord?: AnsatzRelationalHypergraphRecord | null | undefined;
  showZonotopeOverlay?: boolean | undefined;
  colorMode?: "light" | "dark" | undefined;
  onAddZonotopeOverride?: ((override: ZonotopePendingOverride) => void) | undefined;
  onSelectZonotopeGroup?: ((groupId: number | null) => void) | undefined;
}

export function MarkdownViewer({
  content,
  context,
  className,
  zonotopeWorkbenchState,
  hypergraphRecord,
  showZonotopeOverlay,
  colorMode,
  onAddZonotopeOverride,
  onSelectZonotopeGroup,
}: MarkdownViewerProps) {
  const zonotopeActive = Boolean(showZonotopeOverlay && zonotopeWorkbenchState);
  const [zonotopeSurfaceMode, setZonotopeSurfaceMode] = useState<"annotator" | "markdown">("annotator");

  // Default to ZonotopeProseAnnotator whenever labeling mode is turned on
  useEffect(() => {
    if (zonotopeActive) {
      setZonotopeSurfaceMode("annotator");
    }
  }, [zonotopeActive]);

  const resolveVariable = (path: string): unknown => {
    if (!context) return undefined;
    const parts = path.split(".");
    let current: unknown = context;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  };

  const components = useMemo(
    () =>
      ({
        diagram: (props: Record<string, unknown> & { node?: unknown; model?: string; type?: string }) => {
          // Avoid passing down the 'node' prop to clean up the DOM
          const { node: _node, ...rest } = props;
          return <DiagramMacro {...rest} />;
        },
        requirements: (props: Record<string, unknown> & { node?: unknown; target?: string }) => {
          const { node: _node, ...rest } = props;
          return <RequirementsMacro {...rest} />;
        },
        var: (
          props: React.HTMLAttributes<HTMLSpanElement> & { name?: string; node?: unknown; children?: React.ReactNode },
        ) => {
          const { name = "", node: _node, children: _children, ...rest } = props;
          const value = resolveVariable(name);
          const displayValue = value !== undefined ? String(value) : `{{${name}}}`;
          return (
            <span
              {...rest}
              className="ansatz-var"
              style={{
                padding: "2px 4px",
                borderRadius: 4,
                border: "1px solid color-mix(in srgb, var(--ms-brand) 30%, transparent)",
                background: "var(--ms-brand-soft)",
                color: "var(--ms-brand)",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.875em",
              }}
              title={`Variable: ${name}`}
            >
              {displayValue}
            </span>
          );
        },
      }) as NonNullable<React.ComponentProps<typeof ReactMarkdown>["components"]>,
    [context],
  );

  if (!zonotopeActive || !zonotopeWorkbenchState) {
    return (
      <div className={`ansatz-markdown-viewer prose dark:prose-invert max-w-none ${className || ""}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkDirective, remarkInterpolation, remarkDirectiveToHast]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  const isDark = colorMode !== "light";

  return (
    <div className={`ansatz-markdown-viewer prose dark:prose-invert max-w-none ${className || ""}`}>
      <div
        role="region"
        aria-label="Zonotope prose labeling controls"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "6px 10px",
          marginBottom: 10,
          borderRadius: 999,
          background: isDark ? "rgba(14, 165, 233, 0.14)" : "rgba(2, 132, 199, 0.08)",
          border: `1px solid ${isDark ? "rgba(56, 189, 248, 0.42)" : "rgba(2, 132, 199, 0.3)"}`,
          fontSize: 12,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 600,
            color: isDark ? "#7dd3fc" : "#0369a1",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#38bdf8",
              boxShadow: "0 0 8px rgba(56, 189, 248, 0.8)",
            }}
          />
          Zonotope Prose Labeling Active
        </span>

        <div
          role="tablist"
          aria-label="Prose view mode"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 2,
            padding: 2,
            borderRadius: 999,
            background: isDark ? "rgba(15, 23, 42, 0.65)" : "rgba(255, 255, 255, 0.85)",
            border: `1px solid ${isDark ? "rgba(148, 163, 184, 0.25)" : "rgba(15, 23, 42, 0.12)"}`,
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={zonotopeSurfaceMode === "annotator"}
            onClick={() => setZonotopeSurfaceMode("annotator")}
            style={{
              padding: "2px 9px",
              borderRadius: 999,
              border: "none",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              background:
                zonotopeSurfaceMode === "annotator"
                  ? isDark
                    ? "rgba(56, 189, 248, 0.28)"
                    : "rgba(2, 132, 199, 0.16)"
                  : "transparent",
              color:
                zonotopeSurfaceMode === "annotator" ? (isDark ? "#e0f2fe" : "#0c4a6e") : isDark ? "#94a3b8" : "#475569",
            }}
          >
            Zonotope Annotator
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={zonotopeSurfaceMode === "markdown"}
            onClick={() => setZonotopeSurfaceMode("markdown")}
            style={{
              padding: "2px 9px",
              borderRadius: 999,
              border: "none",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              background:
                zonotopeSurfaceMode === "markdown"
                  ? isDark
                    ? "rgba(56, 189, 248, 0.28)"
                    : "rgba(2, 132, 199, 0.16)"
                  : "transparent",
              color:
                zonotopeSurfaceMode === "markdown" ? (isDark ? "#e0f2fe" : "#0c4a6e") : isDark ? "#94a3b8" : "#475569",
            }}
          >
            Rendered Markdown
          </button>
        </div>
      </div>

      {zonotopeSurfaceMode === "annotator" ? (
        <ZonotopeProseAnnotator
          content={content}
          colorMode={colorMode}
          hypergraphRecord={hypergraphRecord}
          workbenchState={zonotopeWorkbenchState}
          onAddOverride={onAddZonotopeOverride}
          onSelectGroup={onSelectZonotopeGroup}
        />
      ) : (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkDirective, remarkInterpolation, remarkDirectiveToHast]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      )}
    </div>
  );
}
