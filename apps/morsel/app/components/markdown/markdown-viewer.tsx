import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import { DiagramMacro } from "./macros/diagram-macro.js";
import { RequirementsMacro } from "./macros/requirements-macro.js";
import { remarkInterpolation } from "./remark-interpolation-plugin.js";

// Convert remark-directive and var nodes to HAST elements that react-markdown can map to React components
function remarkDirectiveToHast() {
  return (tree: any) => {
    visit(tree, ["textDirective", "leafDirective", "containerDirective"], (node) => {
      const data = node.data || (node.data = {});
      data.hName = node.name;
      data.hProperties = node.attributes || {};
    });
  };
}

interface MarkdownViewerProps {
  content: string;
  context?: Record<string, any>;
  className?: string;
}

export function MarkdownViewer({ content, context, className }: MarkdownViewerProps) {
  const resolveVariable = (path: string) => {
    if (!context) return undefined;
    const parts = path.split(".");
    let current: any = context;
    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }
    return current;
  };

  const components = useMemo<NonNullable<React.ComponentProps<typeof ReactMarkdown>["components"]>>(
    () => ({
      diagram: (props: any) => {
        // Avoid passing down the 'node' prop to clean up the DOM
        const { node, ...rest } = props;
        return <DiagramMacro {...rest} />;
      },
      requirements: (props: any) => {
        const { node, ...rest } = props;
        return <RequirementsMacro {...rest} />;
      },
      var: (props: any) => {
        const { name, node, children, ...rest } = props;
        const value = resolveVariable(name);
        const displayValue = value !== undefined ? String(value) : `{{${name}}}`;
        return (
          <span
            {...rest}
            className="morsel-var bg-blue-50 text-blue-700 px-1 py-0.5 rounded font-mono text-sm border border-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800"
            title={`Variable: ${name}`}
          >
            {displayValue}
          </span>
        );
      },
    }),
    [context],
  );

  return (
    <div className={`morsel-markdown-viewer prose dark:prose-invert max-w-none ${className || ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkInterpolation, remarkDirectiveToHast]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
