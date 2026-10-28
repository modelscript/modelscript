// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CodeIcon, CopyIcon, FileCodeIcon, PlayIcon, WorkflowIcon } from "@primer/octicons-react";
import { Button, Label, Text } from "@primer/react";
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Box from "../../../components/Box";
import { CodeBlockHeader, CodeBlockPre, CodeBlockWrap, GlassCard, JavadocSection, SectionTitle } from "../styles";

const MODELICA_KEYWORDS = new Set([
  "model",
  "block",
  "connector",
  "record",
  "package",
  "function",
  "type",
  "class",
  "operator",
  "expandable",
  "extends",
  "import",
  "within",
  "public",
  "protected",
  "parameter",
  "constant",
  "discrete",
  "input",
  "output",
  "flow",
  "stream",
  "equation",
  "initial",
  "algorithm",
  "if",
  "then",
  "else",
  "elseif",
  "for",
  "loop",
  "in",
  "while",
  "when",
  "elsewhen",
  "end",
  "annotation",
  "redeclare",
  "replaceable",
  "constrainedby",
  "each",
  "final",
  "inner",
  "outer",
  "encapsulated",
  "partial",
  "pure",
  "impure",
  "return",
  "break",
  "and",
  "or",
  "not",
  "part",
  "def",
  "port",
  "attribute",
  "item",
  "action",
  "state",
  "calc",
  "requirement",
  "constraint",
  "connection",
  "interface",
  "doc",
]);

const MODELICA_TYPES = new Set([
  "Real",
  "Integer",
  "Boolean",
  "String",
  "StateSelect",
  "ExternalObject",
  "true",
  "false",
  "time",
]);

const MODELICA_BUILTINS = new Set([
  "connect",
  "der",
  "pre",
  "edge",
  "change",
  "reinit",
  "sample",
  "smooth",
  "noEvent",
  "terminal",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "sqrt",
  "exp",
  "log",
  "log10",
  "abs",
  "sign",
  "min",
  "max",
  "sum",
  "product",
  "zeros",
  "ones",
  "fill",
  "identity",
  "diagonal",
  "transpose",
  "symmetric",
  "cross",
  "skew",
  "size",
  "ndims",
  " scalar",
  "vector",
  "matrix",
  "array",
]);

const TOKEN_REGEX =
  /(\/\/.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;

function highlightCodeLine(line: string): React.ReactNode[] {
  if (!line) return [" "];
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_REGEX.lastIndex = 0;

  while ((match = TOKEN_REGEX.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${match.index}-${token}`;

    if (token.startsWith("//") || token.startsWith("/*")) {
      nodes.push(
        <span key={key} style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>
          {token}
        </span>,
      );
    } else if (token.startsWith('"') || token.startsWith("'")) {
      nodes.push(
        <span key={key} style={{ color: "var(--color-accent-emerald, #10b981)" }}>
          {token}
        </span>,
      );
    } else if (/^\d/.test(token)) {
      nodes.push(
        <span key={key} style={{ color: "var(--color-accent-amber, #f59e0b)" }}>
          {token}
        </span>,
      );
    } else if (MODELICA_KEYWORDS.has(token)) {
      nodes.push(
        <span key={key} style={{ color: "var(--color-accent-purple, #8b5cf6)", fontWeight: 600 }}>
          {token}
        </span>,
      );
    } else if (MODELICA_TYPES.has(token)) {
      nodes.push(
        <span key={key} style={{ color: "var(--color-accent-cyan, #06b6d4)", fontWeight: 500 }}>
          {token}
        </span>,
      );
    } else if (MODELICA_BUILTINS.has(token)) {
      nodes.push(
        <span key={key} style={{ color: "var(--color-accent-blue, #3b82f6)" }}>
          {token}
        </span>,
      );
    } else {
      nodes.push(token);
    }

    lastIndex = TOKEN_REGEX.lastIndex;
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex));
  }

  return nodes;
}

const HighlightedCodeView: React.FC<{ code: string }> = ({ code }) => {
  const lines = useMemo(() => code.replace(/\r\n/g, "\n").split("\n"), [code]);

  return (
    <CodeBlockPre style={{ padding: "12px 0" }}>
      <code style={{ display: "block" }}>
        {lines.map((line, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              alignItems: "baseline",
              padding: "0 20px 0 12px",
              minHeight: "20.5px",
            }}
          >
            <span
              style={{
                userSelect: "none",
                WebkitUserSelect: "none",
                minWidth: 34,
                paddingRight: 16,
                textAlign: "right",
                color: "var(--color-text-tertiary, var(--color-text-muted))",
                opacity: 0.55,
                fontSize: 11.5,
                flexShrink: 0,
              }}
            >
              {idx + 1}
            </span>
            <span style={{ flex: 1, whiteSpace: "pre" }}>{highlightCodeLine(line)}</span>
          </div>
        ))}
      </code>
    </CodeBlockPre>
  );
};

export interface ClassEquationsTabProps {
  equations: string[];
  className?: string | undefined;
}

export const ClassEquationsTab: React.FC<ClassEquationsTabProps> = ({ equations, className }) => {
  const [copiedEquations, setCopiedEquations] = useState(false);
  const equationsText = useMemo(() => equations.join("\n"), [equations]);

  const handleCopyEquations = () => {
    if (equations.length === 0) return;
    void navigator.clipboard.writeText(equationsText);
    setCopiedEquations(true);
    setTimeout(() => setCopiedEquations(false), 2000);
  };

  const playgroundSnippet = useMemo(() => {
    const shortName = className ? className.split(".").pop() || "Model" : "Model";
    const body = equations.map((eq) => `  ${eq.endsWith(";") ? eq : `${eq};`}`).join("\n");
    return `model ${shortName}\nequation\n${body}\nend ${shortName};\n`;
  }, [equations, className]);

  return (
    <JavadocSection>
      <SectionTitle as="h3">
        <WorkflowIcon size={14} /> Equations &amp; Connections ({equations.length})
      </SectionTitle>
      {equations.length > 0 ? (
        <CodeBlockWrap>
          <CodeBlockHeader>
            <Box display="flex" alignItems="center" gap="8px">
              <Text style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-muted)" }}>
                Declarative Equation &amp; Connect Clauses
              </Text>
              <Label variant="secondary" style={{ fontSize: 11 }}>
                {equations.length} {equations.length === 1 ? "equation" : "equations"}
              </Label>
            </Box>
            <Box display="flex" alignItems="center" gap="6px">
              <Button
                as={Link}
                to={`/playground?source=${encodeURIComponent(playgroundSnippet)}&title=${encodeURIComponent(className || "Equations")}`}
                size="small"
                variant="invisible"
                leadingVisual={PlayIcon}
                style={{ textDecoration: "none" }}
              >
                Open in Playground
              </Button>
              <Button
                size="small"
                variant="invisible"
                leadingVisual={copiedEquations ? CheckIcon : CopyIcon}
                onClick={handleCopyEquations}
              >
                {copiedEquations ? "Copied" : "Copy"}
              </Button>
            </Box>
          </CodeBlockHeader>
          <HighlightedCodeView code={equationsText} />
        </CodeBlockWrap>
      ) : (
        <GlassCard>
          <Text style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>
            No top-level equations or connect clauses declared directly in this class.
          </Text>
        </GlassCard>
      )}
    </JavadocSection>
  );
};

export interface ClassSourceTabProps {
  sourceCode: string | null | undefined;
  sourceFile?: string | null | undefined;
  className: string;
}

export const ClassSourceTab: React.FC<ClassSourceTabProps> = ({ sourceCode, sourceFile, className }) => {
  const [copiedSource, setCopiedSource] = useState(false);

  const handleCopySource = () => {
    if (!sourceCode) return;
    void navigator.clipboard.writeText(sourceCode);
    setCopiedSource(true);
    setTimeout(() => setCopiedSource(false), 2000);
  };

  return (
    <JavadocSection>
      <SectionTitle as="h3">
        <FileCodeIcon size={14} /> Class Definition Source
      </SectionTitle>
      {sourceCode ? (
        <CodeBlockWrap>
          <CodeBlockHeader>
            <Box display="flex" alignItems="center" gap="8px">
              <CodeIcon size={14} />
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: "var(--font-mono, monospace)",
                  color: "var(--color-text-heading)",
                }}
              >
                {sourceFile || className}
              </Text>
            </Box>
            <Box display="flex" alignItems="center" gap="6px">
              <Button
                as={Link}
                to={`/playground?source=${encodeURIComponent(sourceCode)}&title=${encodeURIComponent(className)}`}
                size="small"
                variant="invisible"
                leadingVisual={PlayIcon}
                style={{ textDecoration: "none" }}
              >
                Open in Playground
              </Button>
              <Button
                size="small"
                variant="invisible"
                leadingVisual={copiedSource ? CheckIcon : CopyIcon}
                onClick={handleCopySource}
              >
                {copiedSource ? "Copied" : "Copy"}
              </Button>
            </Box>
          </CodeBlockHeader>
          <HighlightedCodeView code={sourceCode} />
        </CodeBlockWrap>
      ) : (
        <GlassCard>
          <Text style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>
            Source code is not available for this class.
          </Text>
        </GlassCard>
      )}
    </JavadocSection>
  );
};
