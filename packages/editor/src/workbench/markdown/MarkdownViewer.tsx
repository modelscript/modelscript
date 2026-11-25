// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import { DiagramMacro } from "./macros/DiagramMacro.js";
import { RequirementsMacro } from "./macros/RequirementsMacro.js";
import { remarkInterpolation } from "./remark-interpolation-plugin.js";

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
        data.hName = node.name;
        data.hProperties = node.attributes || {};
      }
    });
  };
}

interface MarkdownViewerProps {
  content: string;
  context?: Record<string, unknown> | undefined;
  className?: string | undefined;
}

export function MarkdownViewer({ content, context, className }: MarkdownViewerProps) {
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
