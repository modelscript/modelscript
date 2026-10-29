// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CodeIcon, CopyIcon, PlayIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";

export interface FortranViewerProps {
  artifactId?: string | number | undefined;
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    rawText?: string | undefined;
    source?: string | undefined;
    title?: string | undefined;
    filename?: string | undefined;
    standalone?: boolean | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

interface FortranSymbolPill {
  kind: "module" | "program" | "subroutine" | "function";
  name: string;
  attributes: string[];
  line: number;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(p) => (p.$isFullScreen ? "100%" : "auto")};
  background: var(--color-canvas-default);
  border-radius: ${(p) => (p.$isFullScreen ? "0" : "6px")};
  border: ${(p) => (p.$isFullScreen ? "none" : "1px solid var(--color-border-default)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

const Toolbar = styled.div`
  min-height: 38px;
  background: var(--color-canvas-default);
  border-bottom: 1px solid var(--color-border-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  gap: 8px;
  flex-wrap: wrap;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
`;

const DialectBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 700;
  letter-spacing: 0.03em;
  white-space: nowrap;
  background: rgba(99, 102, 241, 0.12);
  color: #6366f1;
  border: 1px solid rgba(99, 102, 241, 0.35);
`;

const MetaBadge = styled.span`
  display: inline-flex;
  align-items: center;
  font-size: 10.5px;
  font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
  padding: 1px 7px;
  border-radius: 4px;
  font-weight: 600;
  white-space: nowrap;
  background: var(--color-canvas-subtle);
  color: var(--color-fg-muted);
  border: 1px solid var(--color-border-muted);
`;

const SymbolBar = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-muted);
  overflow-x: auto;
`;

const SymbolChip = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid ${(p) => (p.$active ? "rgba(99, 102, 241, 0.5)" : "var(--color-border-default)")};
  background: ${(p) => (p.$active ? "rgba(99, 102, 241, 0.12)" : "var(--color-canvas-default)")};
  color: ${(p) => (p.$active ? "#6366f1" : "var(--color-fg-default)")};
  border-radius: 5px;
  padding: 2px 8px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s ease;

  &:hover {
    border-color: rgba(99, 102, 241, 0.45);
  }
`;

const CodePane = styled.div<{ $isFullScreen?: boolean | undefined }>`
  background: var(--color-canvas-default);
  overflow: auto;
  max-height: ${(p) => (p.$isFullScreen ? "100%" : "440px")};
  min-height: ${(p) => (p.$isFullScreen ? "100%" : "320px")};
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  padding: 10px 0;
  flex: 1;
`;

const CodeLine = styled.div<{ $highlight?: boolean }>`
  display: flex;
  padding: 0 14px;
  background: ${(p) => (p.$highlight ? "rgba(99, 102, 241, 0.1)" : "transparent")};
  &:hover {
    background: var(--color-canvas-subtle);
  }
`;

const LineNo = styled.span`
  user-select: none;
  width: 36px;
  min-width: 36px;
  text-align: right;
  padding-right: 12px;
  color: var(--color-fg-subtle);
  font-size: 11px;
`;

const LineText = styled.span`
  white-space: pre;
  color: var(--color-fg-default);
`;

function cleanFortranSource(raw: string): string {
  if (!raw) return "";
  const lines = raw.split(/\r?\n/);
  const filtered = lines.filter(
    (line) => !/^\s*!\s*(?:block\s+[A-Za-z0-9_]+\s*;|connect\s*\([^)]+\)\s*;)\s*$/i.test(line),
  );
  return filtered
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractFortranSymbols(source: string): FortranSymbolPill[] {
  const lines = source.split(/\r?\n/);
  const symbols: FortranSymbolPill[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const modMatch = /^\s*(module|program)\s+(?!procedure\b)([A-Za-z_][A-Za-z0-9_]*)/i.exec(line);
    if (modMatch?.[1] && modMatch[2]) {
      symbols.push({
        kind: modMatch[1].toLowerCase() as "module" | "program",
        name: modMatch[2],
        attributes: [],
        line: i + 1,
      });
      continue;
    }

    const procMatch =
      /^\s*((?:(?:pure|elemental|impure|recursive|module)\s+)*)(subroutine|function)\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(
        line,
      );
    if (procMatch?.[2] && procMatch[3]) {
      const attrs = (procMatch[1] || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((a) => a.toLowerCase());
      symbols.push({
        kind: procMatch[2].toLowerCase() as "subroutine" | "function",
        name: procMatch[3],
        attributes: attrs,
        line: i + 1,
      });
    }
  }

  return symbols;
}

function highlightFortranLine(line: string): React.ReactNode {
  const commentIdx = line.indexOf("!");
  if (commentIdx === 0 || /^\s*!/.test(line)) {
    return <span style={{ color: "var(--color-fg-muted)", fontStyle: "italic" }}>{line}</span>;
  }

  const codePart = commentIdx > 0 ? line.slice(0, commentIdx) : line;
  const commentPart = commentIdx > 0 ? line.slice(commentIdx) : "";

  const tokens = codePart.split(/(\s+|[=,:;(){}[\]+*/<>-]+|::|=>)/);
  return (
    <>
      {tokens.map((tok, idx) => {
        if (!tok) return null;
        if (/^(?:-?\d+(?:\.\d*)?(?:[eEdD][+-]?\d+)?(?:_[A-Za-z0-9_]+)?)$/.test(tok)) {
          return (
            <span key={idx} style={{ color: "#0284c7", fontWeight: 600 }}>
              {tok}
            </span>
          );
        }
        if (
          /^(?:module|endmodule|contains|use|intrinsic|only|implicit|none|private|public|pure|elemental|impure|recursive|subroutine|function|program|result|end|if|then|elseif|else|endif|do|enddo|select|case|return)$/i.test(
            tok,
          )
        ) {
          return (
            <span key={idx} style={{ color: "#e11d48", fontWeight: 600 }}>
              {tok}
            </span>
          );
        }
        if (
          /^(?:real|integer|logical|character|complex|type|class|intent|in|out|inout|parameter|dimension|allocatable|dp|real64|real32|int32|int64|iso_fortran_env)$/i.test(
            tok,
          )
        ) {
          return (
            <span key={idx} style={{ color: "#7c3aed", fontWeight: 600 }}>
              {tok}
            </span>
          );
        }
        if (/^(?:sqrt|abs|min|max|sin|cos|tan|exp|log|matmul|dot_product|sum|size|allocated)$/i.test(tok)) {
          return (
            <span key={idx} style={{ color: "#0d9488", fontWeight: 600 }}>
              {tok}
            </span>
          );
        }
        if (tok === "::" || tok === "=>" || tok === "&") {
          return (
            <span key={idx} style={{ color: "#6366f1", fontWeight: 600 }}>
              {tok}
            </span>
          );
        }
        return tok;
      })}
      {commentPart && <span style={{ color: "var(--color-fg-muted)", fontStyle: "italic" }}>{commentPart}</span>}
    </>
  );
}

export const FortranViewer: React.FC<FortranViewerProps> = ({ artifactId, viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [fetchedText, setFetchedText] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const codePaneRef = useRef<HTMLDivElement | null>(null);

  const inlineCode: string =
    viewConfig?.code ||
    viewConfig?.rawText ||
    viewConfig?.source ||
    (viewConfig?.files ? (Object.values(viewConfig.files as Record<string, string>)[0] ?? "") : "") ||
    "";

  useEffect(() => {
    if (!inlineCode && viewConfig?.url) {
      setLoadingText(true);
      fetch(viewConfig.url)
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => {
          if (txt) setFetchedText(txt);
        })
        .catch(() => {})
        .finally(() => setLoadingText(false));
    }
  }, [inlineCode, viewConfig?.url]);

  const rawCode = useMemo(() => cleanFortranSource(inlineCode || fetchedText || ""), [inlineCode, fetchedText]);
  const codeLines = useMemo(() => (rawCode ? rawCode.split(/\r?\n/) : []), [rawCode]);
  const symbols = useMemo(() => extractFortranSymbols(rawCode), [rawCode]);

  const title = viewConfig?.filename || viewConfig?.title || symbols[0]?.name || "Fortran Source";

  const handleCopy = () => {
    if (!rawCode) return;
    navigator.clipboard.writeText(rawCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleJumpToLine = (line: number) => {
    setSelectedLine(line);
    const container = codePaneRef.current;
    if (!container) return;
    const rowEl = container.querySelector(`[data-line="${line}"]`) as HTMLElement | null;
    if (rowEl) {
      rowEl.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };

  const handleOpenPlayground = () => {
    const resolvedId = artifactId ?? viewConfig?.artifactId ?? Date.now();
    const resolvedTitle =
      viewConfig?.filename || (title.endsWith(".f90") ? title : `${title.replace(/\s+/g, "_")}.f90`);
    const hash = compressMorselPayload({
      v: 1,
      lang: "fortran" as any,
      code: rawCode,
      title: resolvedTitle,
    });
    navigate(`/playground?fromArtifact=${resolvedId}#m=${hash}`);
  };

  if (loadingText) {
    return (
      <CardWrapper $isFullScreen={isFullScreen}>
        <Box p={4} display="flex" flexDirection="column" alignItems="center" justifyContent="center" flex={1}>
          <Spinner size="medium" />
          <Text style={{ fontSize: 12, color: "var(--color-fg-muted)", marginTop: 8 }}>Loading Fortran source…</Text>
        </Box>
      </CardWrapper>
    );
  }

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <DialectBadge>
            <CodeIcon size={12} /> FORTRAN
          </DialectBadge>
          {!isFullScreen && (
            <Text
              style={{
                fontWeight: 600,
                fontSize: "12.5px",
                color: "var(--color-fg-default)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={title}
            >
              {title}
            </Text>
          )}
          {codeLines.length > 0 && <MetaBadge>{codeLines.length} lines</MetaBadge>}
        </HeaderLeft>

        <Box style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {rawCode && (
            <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
          {Boolean(viewConfig?.standalone) && !isFullScreen && (
            <Button size="small" variant="primary" leadingVisual={PlayIcon} onClick={handleOpenPlayground}>
              Open in Playground
            </Button>
          )}
        </Box>
      </Toolbar>

      {symbols.length > 0 && (
        <SymbolBar>
          {symbols.map((sym) => (
            <SymbolChip
              key={`${sym.kind}-${sym.name}-${sym.line}`}
              type="button"
              $active={selectedLine === sym.line}
              onClick={() => handleJumpToLine(sym.line)}
              title={`Jump to line ${sym.line}`}
            >
              <span style={{ color: "var(--color-fg-muted)", fontWeight: 500 }}>
                {sym.attributes.length > 0 ? `${sym.attributes.join(" ")} ${sym.kind}` : sym.kind}
              </span>
              <span>{sym.name}</span>
              <span style={{ color: "var(--color-fg-subtle)", fontSize: 10 }}>L{sym.line}</span>
            </SymbolChip>
          ))}
        </SymbolBar>
      )}

      <CodePane ref={codePaneRef} $isFullScreen={isFullScreen}>
        {codeLines.length > 0 ? (
          codeLines.map((line, i) => {
            const lineNum = i + 1;
            return (
              <CodeLine key={i} data-line={lineNum} $highlight={selectedLine === lineNum}>
                <LineNo>{lineNum}</LineNo>
                <LineText>{highlightFortranLine(line)}</LineText>
              </CodeLine>
            );
          })
        ) : (
          <Box style={{ padding: 24, color: "var(--color-fg-muted)", textAlign: "center" }}>
            No Fortran source code available.
          </Box>
        )}
      </CodePane>
    </CardWrapper>
  );
};

export default FortranViewer;
