// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

/* ─── ANSI & Syntax Highlight Engine ─── */
export interface StyledSpan {
  text: string;
  color?: string | undefined;
  bold?: boolean | undefined;
  dim?: boolean | undefined;
}

export const ANSI_COLORS: Record<number, string> = {
  30: "#484f58", // black
  31: "#ff7b72", // red
  32: "#3fb950", // green
  33: "#d29922", // yellow
  34: "#58a6ff", // blue
  35: "#bc8cff", // magenta
  36: "#39c5cf", // cyan
  37: "#f0f6fc", // white
  90: "#8b949e", // bright black / gray
  91: "#ffa198", // bright red
  92: "#56d364", // bright green
  93: "#e3b341", // bright yellow
  94: "#79c0ff", // bright blue
  95: "#d2a8ff", // bright magenta
  96: "#56d4dd", // bright cyan
  97: "#ffffff", // bright white
};

/**
 * Parses ANSI escape sequences and enhances plain text tokens with syntactic highlights.
 */
export function parseAnsiLine(rawLine: string): StyledSpan[] {
  const result: StyledSpan[] = [];
  // Regex to split by ANSI escape codes: \u001b[...m
  // eslint-disable-next-line no-control-regex
  const ansiRegex = /\u001b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentColor: string | undefined;
  let isBold = false;
  let isDim = false;

  let match: RegExpExecArray | null;
  while ((match = ansiRegex.exec(rawLine)) !== null) {
    const textBefore = rawLine.substring(lastIndex, match.index);
    if (textBefore) {
      result.push({ text: textBefore, color: currentColor, bold: isBold, dim: isDim });
    }

    const codeStr = match[1] || "0";
    const codes = codeStr.split(";").map(Number);
    for (const code of codes) {
      if (code === 0) {
        currentColor = undefined;
        isBold = false;
        isDim = false;
      } else if (code === 1) {
        isBold = true;
      } else if (code === 2) {
        isDim = true;
      } else if (ANSI_COLORS[code]) {
        currentColor = ANSI_COLORS[code];
      }
    }
    lastIndex = ansiRegex.lastIndex;
  }

  const remaining = rawLine.substring(lastIndex);
  if (remaining) {
    result.push({ text: remaining, color: currentColor, bold: isBold, dim: isDim });
  }

  return result.length > 0 ? result : [{ text: rawLine }];
}

/**
 * Format a styled span or tokenized span into a React element
 */
export function renderSpan(span: StyledSpan, index: number): React.ReactNode {
  // If span already has an ANSI color, respect it
  if (span.color || span.bold || span.dim) {
    return (
      <span
        key={index}
        style={{
          color: span.color,
          fontWeight: span.bold ? 700 : undefined,
          opacity: span.dim ? 0.75 : undefined,
        }}
      >
        {span.text}
      </span>
    );
  }

  // Tokenize plain segments: e.g. [publish], ✔, ERR, (342ms), @scope/pkg
  const text = span.text;
  const tagRegex =
    /(\[[a-zA-Z0-9_-]+\]|✔|✖|⚠|ERR|Error|failed|completed|done|\(\d+(\.\d+)?ms\)|@[\w-]+\/[\w-]+@[\d.]+|[\w-]+\.(wasm|mo|sysml|step|json|db|zip))/g;

  const parts = text.split(tagRegex);
  if (parts.length === 1) {
    return <span key={index}>{text}</span>;
  }

  return (
    <span key={index}>
      {parts.map((part, pIdx) => {
        if (!part) return null;
        if (part.startsWith("[") && part.endsWith("]")) {
          return (
            <span
              key={pIdx}
              style={{
                color: "var(--color-accent-fg, #58a6ff)",
                background: "rgba(56, 139, 253, 0.12)",
                borderRadius: "3px",
                padding: "0 4px",
                marginRight: "2px",
                fontWeight: 600,
              }}
            >
              {part}
            </span>
          );
        }
        if (part === "✔" || part.toLowerCase() === "completed" || part.toLowerCase() === "done") {
          return (
            <span key={pIdx} style={{ color: "var(--color-success-fg, #3fb950)", fontWeight: 700 }}>
              {part}
            </span>
          );
        }
        if (
          part === "✖" ||
          part.startsWith("ERR") ||
          part.toLowerCase() === "error" ||
          part.toLowerCase() === "failed"
        ) {
          return (
            <span key={pIdx} style={{ color: "var(--color-danger-fg, #f85149)", fontWeight: 700 }}>
              {part}
            </span>
          );
        }
        if (part === "⚠" || part.toLowerCase() === "warn" || part.toLowerCase() === "warning") {
          return (
            <span key={pIdx} style={{ color: "var(--color-attention-fg, #d29922)", fontWeight: 700 }}>
              {part}
            </span>
          );
        }
        if (part.startsWith("(") && part.endsWith("ms)")) {
          return (
            <span key={pIdx} style={{ color: "var(--color-text-muted, #8b949e)", fontStyle: "italic" }}>
              {part}
            </span>
          );
        }
        if (part.startsWith("@") && part.includes("/")) {
          return (
            <span key={pIdx} style={{ color: "var(--color-accent-cyan, #39c5cf)", fontWeight: 600 }}>
              {part}
            </span>
          );
        }
        return <span key={pIdx}>{part}</span>;
      })}
    </span>
  );
}
