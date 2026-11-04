// SPDX-License-Identifier: AGPL-3.0-or-later

import { BookIcon, CheckIcon, FileIcon, LinkExternalIcon, PlusIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getReferenceLibrary,
  type ReferenceLibraryEntry,
  type ScholarlyWork,
  searchScholarlyWorks,
} from "../../api/references";
import { useAuth } from "../../AuthContext";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { buildSourcePageUrl, normalizeCitationUrn } from "../../util/citations";

export type CitationInsertFormat = "urn-tag" | "markdown-link" | "doi-tag";

export interface ComposeCitationPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertCitation: (citationText: string, work?: ScholarlyWork) => void;
}

export function buildInsertedCitationSnippet(
  work: Pick<ScholarlyWork, "urn" | "title" | "authors" | "publicationYear" | "doi">,
  format: CitationInsertFormat = "urn-tag",
): string {
  const normalizedUrn = normalizeCitationUrn(work.urn);
  const firstAuthor = work.authors?.[0]?.name || "Source";
  const lastName = firstAuthor.split(/\s+/).pop() || firstAuthor;
  const etAl =
    (work.authors?.length || 0) > 2
      ? " et al."
      : (work.authors?.length || 0) === 2
        ? ` & ${work.authors![1]!.name.split(/\s+/).pop()}`
        : "";
  const year = work.publicationYear || "n.d.";
  const label = `${lastName}${etAl} (${year})`;

  if (format === "markdown-link") {
    return `[${label}](${buildSourcePageUrl(normalizedUrn)})`;
  }
  if (format === "doi-tag" && work.doi) {
    const cleanDoi = work.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim();
    return `[@doi:${cleanDoi}]`;
  }
  return `[@${normalizedUrn}]`;
}

export const ComposeCitationPickerModal: React.FC<ComposeCitationPickerModalProps> = ({
  isOpen,
  onClose,
  onInsertCitation,
}) => {
  const { token } = useAuth();
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(modalRef, isOpen, onClose);

  const [activeTab, setActiveTab] = useState<"search" | "library" | "direct">("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<ScholarlyWork[]>([]);
  const [loading, setLoading] = useState(false);
  const [libraryItems, setLibraryItems] = useState<ReferenceLibraryEntry[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);

  const [directInput, setDirectInput] = useState("");
  const [directLabel, setDirectLabel] = useState("");
  const [insertFormat, setInsertFormat] = useState<CitationInsertFormat>("urn-tag");

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    searchScholarlyWorks(searchQuery, { limit: 12 })
      .then((res) => {
        if (!cancelled) setResults(res.works || []);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, searchQuery]);

  useEffect(() => {
    if (!isOpen || activeTab !== "library" || !token) return;
    let cancelled = false;
    setLoadingLibrary(true);
    getReferenceLibrary(token)
      .then((res) => {
        if (!cancelled) setLibraryItems(res.items || []);
      })
      .catch(() => {
        if (!cancelled) setLibraryItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLibrary(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeTab, token]);

  if (!isOpen) return null;

  const handleSelectWork = (work: ScholarlyWork) => {
    const snippet = buildInsertedCitationSnippet(work, insertFormat);
    onInsertCitation(snippet, work);
    onClose();
  };

  const handleInsertDirect = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = directInput.trim();
    if (!raw) return;
    const normalized = normalizeCitationUrn(raw);
    if (insertFormat === "markdown-link") {
      const label = directLabel.trim() || normalized.replace(/^urn:/i, "");
      onInsertCitation(`[${label}](${buildSourcePageUrl(normalized)})`);
    } else {
      onInsertCitation(`[@${normalized}]`);
    }
    onClose();
  };

  const normalizedDirectPreview = directInput.trim()
    ? normalizeCitationUrn(directInput.trim())
    : "urn:doi:10.1137/0909014";

  const content = (
    <div
      data-testid="compose-citation-picker-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        backgroundColor: "rgba(3, 7, 18, 0.72)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="compose-citation-picker-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "680px",
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--color-bg-elevated, #0f172a)",
          border: "1px solid var(--color-border-default, rgba(148, 163, 184, 0.22))",
          borderRadius: "16px",
          boxShadow: "0 24px 56px rgba(0, 0, 0, 0.55)",
          color: "var(--color-text-primary, #f8fafc)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--color-border-default, rgba(148, 163, 184, 0.16))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "9px",
                background: "rgba(6, 182, 212, 0.14)",
                border: "1px solid rgba(6, 182, 212, 0.35)",
                color: "var(--color-accent-cyan, #06b6d4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <BookIcon size={17} />
            </div>
            <div>
              <h2 id={titleId} style={{ margin: 0, fontSize: "15.5px", fontWeight: 700 }}>
                Insert Scholarly Citation
              </h2>
              <div style={{ fontSize: "12px", color: "var(--color-text-muted, #94a3b8)" }}>
                Search OpenAlex, pick from your library, or cite by URN / DOI / ArXiv ID
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close citation picker"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-text-muted, #94a3b8)",
              cursor: "pointer",
              padding: "6px",
              borderRadius: "8px",
            }}
          >
            <XIcon size={18} />
          </button>
        </div>

        {/* Mode Tabs & Insertion Format Selector */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            padding: "10px 20px",
            borderBottom: "1px solid var(--color-border-default, rgba(148, 163, 184, 0.14))",
            background: "rgba(15, 23, 42, 0.35)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: "6px" }}>
            {(
              [
                { id: "search", label: "OpenAlex & Catalog" },
                { id: "library", label: "My Library" },
                { id: "direct", label: "By URN / DOI / ArXiv" },
              ] as const
            ).map((t) => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  data-testid={`citation-picker-tab-${t.id}`}
                  style={{
                    padding: "5px 11px",
                    borderRadius: "8px",
                    border: active ? "1px solid var(--color-accent-cyan, #06b6d4)" : "1px solid transparent",
                    background: active ? "rgba(6, 182, 212, 0.14)" : "transparent",
                    color: active ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-text-muted, #94a3b8)",
                    fontSize: "12.5px",
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px" }}>
            <span style={{ color: "var(--color-text-muted)" }}>Syntax:</span>
            {(
              [
                { id: "urn-tag" as const, label: "[@urn:...]" },
                { id: "doi-tag" as const, label: "[@doi:...]" },
                { id: "markdown-link" as const, label: "[Author (Year)](/sources/...)" },
              ] as const
            ).map((fmt) => {
              const active = insertFormat === fmt.id;
              return (
                <button
                  key={fmt.id}
                  type="button"
                  onClick={() => setInsertFormat(fmt.id)}
                  data-testid={`citation-insert-format-${fmt.id}`}
                  style={{
                    padding: "3px 8px",
                    borderRadius: "6px",
                    border: active
                      ? "1px solid var(--color-accent-cyan, #06b6d4)"
                      : "1px solid var(--color-border-default, rgba(148, 163, 184, 0.2))",
                    background: active ? "rgba(6, 182, 212, 0.14)" : "transparent",
                    color: active ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-text-muted)",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "11px",
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                  }}
                >
                  {fmt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            padding: "16px 20px",
            overflowY: "auto",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {activeTab === "search" && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 12px",
                  borderRadius: "10px",
                  background: "rgba(2, 6, 23, 0.55)",
                  border: "1px solid var(--color-border-default, rgba(148, 163, 184, 0.25))",
                }}
              >
                <SearchIcon size={15} />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search OpenAlex papers, authors, DOIs, DAE index reduction, Modelica, FMI..."
                  data-testid="citation-picker-search-input"
                  autoFocus
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "var(--color-text-primary, #f8fafc)",
                    fontSize: "13.5px",
                  }}
                />
              </div>

              {loading ? (
                <div
                  style={{ padding: "24px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "13px" }}
                >
                  Searching OpenAlex & Ansatz scholarly catalog...
                </div>
              ) : results.length === 0 ? (
                <div
                  style={{ padding: "24px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "13px" }}
                >
                  No matching works found. Try searching by title, author, or switch to &ldquo;By URN / DOI /
                  ArXiv&rdquo;.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {results.map((work) => (
                    <div
                      key={work.urn}
                      data-testid={`citation-picker-result-${work.urn}`}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: "12px",
                        padding: "12px 14px",
                        borderRadius: "10px",
                        border: "1px solid var(--color-border-default, rgba(148, 163, 184, 0.16))",
                        background: "rgba(15, 23, 42, 0.45)",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: "13.5px",
                            color: "var(--color-text-heading)",
                            lineHeight: 1.35,
                          }}
                        >
                          {work.title}
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "3px" }}>
                          {work.authors?.map((a) => a.name).join(", ") || "Unknown authors"}
                          {work.publicationYear ? ` · ${work.publicationYear}` : ""}
                          {work.venue ? ` · ${work.venue}` : ""}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "6px",
                            marginTop: "6px",
                            alignItems: "center",
                          }}
                        >
                          <code
                            style={{
                              fontSize: "10.5px",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              background: "rgba(6, 182, 212, 0.12)",
                              color: "var(--color-accent-cyan, #06b6d4)",
                            }}
                          >
                            {work.urn}
                          </code>
                          {work.localPdfUrl && (
                            <span
                              style={{
                                fontSize: "10.5px",
                                padding: "1px 6px",
                                borderRadius: "4px",
                                background: "rgba(16, 185, 129, 0.14)",
                                color: "#10b981",
                                fontWeight: 600,
                              }}
                            >
                              <FileIcon size={11} /> Local PDF Hosted
                            </span>
                          )}
                          {work.openAccessUrl && (
                            <span
                              style={{
                                fontSize: "10.5px",
                                padding: "1px 6px",
                                borderRadius: "4px",
                                background: "rgba(59, 130, 246, 0.14)",
                                color: "#60a5fa",
                              }}
                            >
                              <LinkExternalIcon size={10} /> Open Access PDF
                            </span>
                          )}
                          {typeof work.citedByCount === "number" && work.citedByCount > 0 && (
                            <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                              Cited by {work.citedByCount.toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSelectWork(work)}
                        data-testid={`citation-picker-insert-${work.urn}`}
                        style={{
                          flexShrink: 0,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          padding: "6px 12px",
                          borderRadius: "8px",
                          border: "1px solid rgba(6, 182, 212, 0.45)",
                          background: "rgba(6, 182, 212, 0.16)",
                          color: "var(--color-accent-cyan, #06b6d4)",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        <PlusIcon size={13} /> Insert
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === "library" && (
            <>
              {!token ? (
                <div
                  style={{ padding: "24px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "13px" }}
                >
                  Sign in to access your personal saved Reference Library, or use the OpenAlex search tab above.
                </div>
              ) : loadingLibrary ? (
                <div
                  style={{ padding: "24px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "13px" }}
                >
                  Loading your reference library...
                </div>
              ) : libraryItems.length === 0 ? (
                <div
                  style={{ padding: "24px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "13px" }}
                >
                  Your personal library is empty. Save papers from the References page or search OpenAlex in the first
                  tab.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {libraryItems.map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: "12px",
                        padding: "12px 14px",
                        borderRadius: "10px",
                        border: "1px solid var(--color-border-default, rgba(148, 163, 184, 0.16))",
                        background: "rgba(15, 23, 42, 0.45)",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: "13.5px" }}>{entry.work.title}</div>
                        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
                          {entry.work.authors?.map((a) => a.name).join(", ")} · {entry.work.publicationYear}
                        </div>
                        <code style={{ fontSize: "10.5px", color: "var(--color-accent-cyan, #06b6d4)" }}>
                          {entry.work.urn}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSelectWork(entry.work)}
                        style={{
                          flexShrink: 0,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          padding: "6px 12px",
                          borderRadius: "8px",
                          border: "1px solid rgba(6, 182, 212, 0.45)",
                          background: "rgba(6, 182, 212, 0.16)",
                          color: "var(--color-accent-cyan, #06b6d4)",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        <PlusIcon size={13} /> Insert
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === "direct" && (
            <form onSubmit={handleInsertDirect} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 700,
                    marginBottom: "6px",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  Citation URN, DOI, ArXiv ID, OpenAlex ID, or Ansatz Entity URN
                </label>
                <input
                  type="text"
                  value={directInput}
                  onChange={(e) => setDirectInput(e.target.value)}
                  placeholder="e.g. 10.1137/0909014, arxiv:1706.03762, W2108598243, or urn:ansatz:package:Modelica@4.1.0"
                  data-testid="citation-picker-direct-input"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: "8px",
                    background: "rgba(2, 6, 23, 0.6)",
                    border: "1px solid var(--color-border-default, rgba(148, 163, 184, 0.25))",
                    color: "var(--color-text-primary, #f8fafc)",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {insertFormat === "markdown-link" && (
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "12px",
                      fontWeight: 700,
                      marginBottom: "6px",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    Display Label (optional)
                  </label>
                  <input
                    type="text"
                    value={directLabel}
                    onChange={(e) => setDirectLabel(e.target.value)}
                    placeholder="e.g. Pantelides (1988)"
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      borderRadius: "8px",
                      background: "rgba(2, 6, 23, 0.6)",
                      border: "1px solid var(--color-border-default, rgba(148, 163, 184, 0.25))",
                      color: "var(--color-text-primary, #f8fafc)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              )}

              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  background: "rgba(6, 182, 212, 0.08)",
                  border: "1px solid rgba(6, 182, 212, 0.22)",
                  fontSize: "12px",
                }}
              >
                <div style={{ color: "var(--color-text-muted)", marginBottom: "4px" }}>
                  Resolves automatically to Ansatz Source Page:
                </div>
                <code style={{ color: "var(--color-accent-cyan, #06b6d4)", wordBreak: "break-all" }}>
                  {buildSourcePageUrl(normalizedDirectPreview)}
                </code>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="submit"
                  disabled={!directInput.trim()}
                  data-testid="citation-picker-direct-submit"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 16px",
                    borderRadius: "8px",
                    border: "1px solid rgba(6, 182, 212, 0.5)",
                    background: "var(--color-accent-cyan, #06b6d4)",
                    color: "#020617",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: directInput.trim() ? "pointer" : "not-allowed",
                    opacity: directInput.trim() ? 1 : 0.5,
                  }}
                >
                  <CheckIcon size={14} /> Insert Citation
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer tip */}
        <div
          style={{
            padding: "10px 20px",
            borderTop: "1px solid var(--color-border-default, rgba(148, 163, 184, 0.14))",
            background: "rgba(2, 6, 23, 0.45)",
            fontSize: "11.5px",
            color: "var(--color-text-muted, #94a3b8)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <span>
            Tip: You can also type{" "}
            <code style={{ color: "var(--color-accent-cyan)" }}>[@urn:openalex:W2108598243]</code>,{" "}
            <code style={{ color: "var(--color-accent-cyan)" }}>[@doi:10.1137/0909014]</code>, or{" "}
            <code style={{ color: "var(--color-accent-cyan)" }}>\cite&#123;urn:arxiv:1706.03762&#125;</code> directly in
            any post.
          </span>
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(content, document.body);
  }
  return content;
};

export default ComposeCitationPickerModal;
