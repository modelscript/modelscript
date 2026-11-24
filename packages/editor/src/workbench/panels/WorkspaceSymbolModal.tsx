// SPDX-License-Identifier: AGPL-3.0-or-later

import { SearchIcon, XIcon } from "@primer/octicons-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { getWorkspaceSymbols } from "../util/lsp-bridge";

export interface WorkspaceSymbolModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSymbol: (uri: string, line: number, symbolName?: string) => void;
  colorMode?: "dark" | "light" | undefined;
}

interface NormalizedWorkspaceSymbol {
  name: string;
  kindLabel: string;
  containerName?: string | undefined;
  uri: string;
  fileName: string;
  /** 1-based line number */
  line: number;
}

const LSP_SYMBOL_KIND_LABELS: Record<number, string> = {
  1: "File",
  2: "Module",
  3: "Namespace",
  4: "Package",
  5: "Class",
  6: "Method",
  7: "Property",
  8: "Field",
  9: "Constructor",
  10: "Enum",
  11: "Interface",
  12: "Function",
  13: "Variable",
  14: "Constant",
  15: "String",
  16: "Number",
  17: "Boolean",
  18: "Array",
  19: "Object",
  20: "Key",
  21: "Null",
  22: "EnumMember",
  23: "Struct",
  24: "Event",
  25: "Operator",
  26: "TypeParam",
};

function formatSymbolKind(kind: unknown): string {
  if (typeof kind === "number") {
    return LSP_SYMBOL_KIND_LABELS[kind] ?? "Symbol";
  }
  if (typeof kind === "string" && kind.trim()) {
    return kind.trim();
  }
  return "Symbol";
}

function getBasenameFromUri(uri: string): string {
  if (!uri) return "";
  const clean = uri.split(/[?#]/)[0] ?? uri;
  const decoded = (() => {
    try {
      return decodeURIComponent(clean);
    } catch {
      return clean;
    }
  })();
  const parts = decoded.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? decoded;
}

function normalizeWorkspaceSymbol(raw: unknown): NormalizedWorkspaceSymbol | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as {
    name?: unknown;
    uri?: unknown;
    kind?: number;
    containerName?: unknown;
    location?: { uri?: unknown; range?: { start?: { line?: unknown } } };
    range?: { start?: { line?: unknown } };
  };
  const name = typeof r.name === "string" ? r.name : "";
  if (!name) return null;
  const uri: string = typeof r.location?.uri === "string" ? r.location.uri : typeof r.uri === "string" ? r.uri : "";
  const zeroBasedLine =
    typeof r.location?.range?.start?.line === "number"
      ? r.location.range.start.line
      : typeof r.range?.start?.line === "number"
        ? r.range.start.line
        : 0;
  const containerName =
    typeof r.containerName === "string" && r.containerName.trim() ? r.containerName.trim() : undefined;

  return {
    name,
    kindLabel: formatSymbolKind(r.kind),
    containerName,
    uri,
    fileName: getBasenameFromUri(uri),
    line: Math.max(1, zeroBasedLine + 1),
  };
}

export const WorkspaceSymbolModal: React.FC<WorkspaceSymbolModalProps> = ({
  isOpen,
  onClose,
  onSelectSymbol,
  colorMode = "light",
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NormalizedWorkspaceSymbol[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const requestSeqRef = useRef(0);

  const isDark = colorMode === "dark";

  // Reset and auto-focus when opened
  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setResults([]);
    setSelectedIndex(0);
    setIsLoading(false);
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  // Debounced workspace/symbol query (150ms)
  useEffect(() => {
    if (!isOpen) return;
    const trimmed = query.trim();
    const seq = ++requestSeqRef.current;

    if (!trimmed) {
      setResults([]);
      setSelectedIndex(0);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const rawSymbols = await getWorkspaceSymbols(trimmed);
        if (requestSeqRef.current !== seq) return;
        const normalized = (Array.isArray(rawSymbols) ? rawSymbols : [])
          .map(normalizeWorkspaceSymbol)
          .filter((item): item is NormalizedWorkspaceSymbol => item !== null);
        setResults(normalized);
        setSelectedIndex(0);
      } catch {
        if (requestSeqRef.current !== seq) return;
        setResults([]);
        setSelectedIndex(0);
      } finally {
        if (requestSeqRef.current === seq) {
          setIsLoading(false);
        }
      }
    }, 150);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, query]);

  // Keep active row scrolled into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(`[data-symbol-index="${selectedIndex}"]`);
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [isOpen, selectedIndex]);

  const handleChoose = useCallback(
    (sym: NormalizedWorkspaceSymbol) => {
      onSelectSymbol(sym.uri, sym.line, sym.name);
      onClose();
    },
    [onClose, onSelectSymbol],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (results.length > 0) {
          setSelectedIndex((prev) => (prev + 1) % results.length);
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (results.length > 0) {
          setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
        }
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const chosen = results[selectedIndex];
        if (chosen) {
          handleChoose(chosen);
        }
      }
    },
    [handleChoose, onClose, results, selectedIndex],
  );

  if (!isOpen) return null;

  const surfaceBg = isDark ? "var(--bgColor-default, #161b22)" : "var(--bgColor-default, #ffffff)";
  const borderColor = isDark ? "var(--borderColor-default, #30363d)" : "var(--borderColor-default, #d0d7de)";
  const textPrimary = isDark ? "var(--fgColor-default, #e6edf3)" : "var(--fgColor-default, #1f2328)";
  const textMuted = isDark ? "var(--fgColor-muted, #8b949e)" : "var(--fgColor-muted, #656d76)";
  const hoverBg = isDark ? "rgba(56, 139, 253, 0.18)" : "rgba(9, 105, 218, 0.1)";
  const badgeBg = isDark ? "rgba(110, 118, 129, 0.25)" : "rgba(175, 184, 193, 0.28)";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Go to Symbol in Workspace"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        backgroundColor: isDark ? "rgba(1, 4, 9, 0.55)" : "rgba(31, 35, 40, 0.32)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        style={{
          width: "min(600px, calc(100vw - 32px))",
          maxHeight: "66vh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: surfaceBg,
          color: textPrimary,
          border: `1px solid ${borderColor}`,
          borderRadius: 10,
          boxShadow: isDark ? "0 16px 48px rgba(0, 0, 0, 0.55)" : "0 16px 48px rgba(31, 35, 40, 0.22)",
          overflow: "hidden",
        }}
      >
        {/* Search header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            borderBottom: `1px solid ${borderColor}`,
          }}
        >
          <span style={{ color: textMuted, display: "inline-flex", flexShrink: 0 }}>
            <SearchIcon size={16} />
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Go to symbol in workspace…"
            aria-label="Search workspace symbols"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              color: textPrimary,
              fontSize: 14,
              lineHeight: "20px",
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              style={{
                border: "none",
                background: "transparent",
                color: textMuted,
                cursor: "pointer",
                padding: 2,
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <XIcon size={14} />
            </button>
          )}
          <kbd
            style={{
              fontSize: 11,
              padding: "2px 6px",
              borderRadius: 4,
              border: `1px solid ${borderColor}`,
              color: textMuted,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            Esc
          </kbd>
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          role="listbox"
          style={{
            overflowY: "auto",
            padding: "6px 0",
            minHeight: 72,
          }}
        >
          {isLoading ? (
            <div style={{ padding: "18px 16px", fontSize: 13, color: textMuted, textAlign: "center" }}>
              Searching workspace symbols…
            </div>
          ) : results.length > 0 ? (
            results.map((sym, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={`${sym.uri}#${sym.name}#${sym.line}#${idx}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-symbol-index={idx}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => handleChoose(sym)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    backgroundColor: isSelected ? hoverBg : "transparent",
                    color: textPrimary,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "7px 14px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "1px 6px",
                        borderRadius: 4,
                        backgroundColor: badgeBg,
                        color: textMuted,
                        textTransform: "uppercase",
                        letterSpacing: "0.02em",
                        flexShrink: 0,
                      }}
                    >
                      {sym.kindLabel}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {sym.name}
                    </span>
                    {sym.containerName && (
                      <span
                        style={{
                          fontSize: 12,
                          color: textMuted,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {sym.containerName}
                      </span>
                    )}
                  </div>
                  {(sym.fileName || sym.line > 0) && (
                    <span
                      style={{
                        fontSize: 11,
                        color: textMuted,
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        flexShrink: 0,
                      }}
                    >
                      {sym.fileName ? `${sym.fileName}:${sym.line}` : `:${sym.line}`}
                    </span>
                  )}
                </button>
              );
            })
          ) : (
            <div style={{ padding: "18px 16px", fontSize: 13, color: textMuted, textAlign: "center" }}>
              {query.trim().length < 2
                ? "Type at least 2 characters to search workspace symbols…"
                : "No matching workspace symbols found."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkspaceSymbolModal;
