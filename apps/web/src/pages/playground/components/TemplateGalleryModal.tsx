// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CodeIcon,
  CrossReferenceIcon,
  SearchIcon,
  XIcon,
} from "@primer/octicons-react";
import React, { useMemo, useState } from "react";
import { useFocusTrap } from "../../../hooks/useFocusTrap";
import { HERO_EXAMPLES, type HeroExample, TEMPLATE_CATEGORIES, type TemplateCategory } from "../constants";

export interface TemplateGalleryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (template: HeroExample) => void;
  currentTemplateId?: string | undefined;
}

export const TemplateGalleryModal: React.FC<TemplateGalleryModalProps> = ({
  isOpen,
  onClose,
  onSelectTemplate,
  currentTemplateId,
}) => {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory>("All");
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const containerRef = useFocusTrap(isOpen, onClose);

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return HERO_EXAMPLES.filter((item) => {
      // Category filter
      if (selectedCategory !== "All") {
        const itemDomain = item.domain || item.category;
        if (
          !itemDomain.toLowerCase().includes(selectedCategory.toLowerCase().split(" ")[0]!) &&
          !item.category.toLowerCase().includes(selectedCategory.toLowerCase().split(" ")[0]!)
        ) {
          return false;
        }
      }

      // Keyword search
      if (!q) return true;
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchCategory = item.category.toLowerCase().includes(q);
      const matchLang = item.lang.toLowerCase().includes(q);
      const matchDesc = item.description?.toLowerCase().includes(q);
      const matchTags = item.tags?.some((t) => t.toLowerCase().includes(q));

      return matchTitle || matchCategory || matchLang || matchDesc || matchTags;
    });
  }, [search, selectedCategory]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-gallery-title"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.72)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        ref={containerRef}
        style={{
          width: "100%",
          maxWidth: "960px",
          maxHeight: "88vh",
          backgroundColor: "var(--color-canvas-default, #0d1117)",
          border: "1px solid var(--color-border-default, #30363d)",
          borderRadius: "14px",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.56)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          color: "var(--color-fg-default, #e6edf3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid var(--color-border-default, #30363d)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(180deg, var(--color-canvas-subtle, #161b22) 0%, transparent 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                backgroundColor: "rgba(9, 105, 218, 0.15)",
                border: "1px solid rgba(9, 105, 218, 0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#58a6ff",
              }}
            >
              <CrossReferenceIcon size={18} />
            </div>
            <div>
              <div id="template-gallery-title" style={{ fontSize: "17px", fontWeight: 700, letterSpacing: "-0.01em" }}>
                Starter Engineering Templates
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-fg-muted, #8b949e)", marginTop: "2px" }}>
                Curated multi-physics, controls, CAD, and system models ready to simulate and modify
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-fg-muted, #8b949e)",
              cursor: "pointer",
              padding: "6px",
              display: "flex",
              alignItems: "center",
              borderRadius: "6px",
            }}
            aria-label="Close templates modal"
          >
            <XIcon size={18} />
          </button>
        </div>

        {/* Search & Domain Filter Bar */}
        <div
          style={{
            padding: "14px 24px",
            borderBottom: "1px solid var(--color-border-default, #30363d)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            backgroundColor: "var(--color-canvas-subtle, #161b22)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "var(--color-canvas-default, #0d1117)",
              border: "1px solid var(--color-border-default, #30363d)",
              borderRadius: "8px",
              padding: "7px 12px",
            }}
          >
            <SearchIcon size={15} style={{ color: "var(--color-fg-muted, #8b949e)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates by discipline, keyword, or engineering language..."
              autoFocus
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "inherit",
                fontSize: "13px",
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-fg-muted, #8b949e)",
                  cursor: "pointer",
                  padding: "2px",
                }}
              >
                <XIcon size={13} />
              </button>
            )}
          </div>

          {/* Category Tabs */}
          <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "2px" }}>
            {TEMPLATE_CATEGORIES.map((cat) => {
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    background: isSelected ? "var(--color-accent-fg, #0969da)" : "transparent",
                    border: `1px solid ${isSelected ? "var(--color-accent-fg, #0969da)" : "var(--color-border-default, #30363d)"}`,
                    color: isSelected ? "#ffffff" : "var(--color-fg-muted, #8b949e)",
                    borderRadius: "6px",
                    padding: "4px 11px",
                    fontSize: "12px",
                    fontWeight: isSelected ? 600 : 500,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "all 0.15s ease",
                  }}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {/* Template Grid */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 24px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "16px",
            alignContent: "start",
          }}
        >
          {filteredTemplates.length === 0 ? (
            <div
              style={{
                gridColumn: "1 / -1",
                textAlign: "center",
                padding: "60px 20px",
                color: "var(--color-fg-muted, #8b949e)",
              }}
            >
              No engineering templates found matching "{search}"
            </div>
          ) : (
            filteredTemplates.map((template) => {
              const isCurrent = currentTemplateId === template.id;
              const isPreviewOpen = previewingId === template.id;

              return (
                <div
                  key={template.id}
                  onDoubleClick={() => {
                    onSelectTemplate(template);
                    onClose();
                  }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    padding: "16px",
                    borderRadius: "10px",
                    backgroundColor: "var(--color-canvas-subtle, #161b22)",
                    border: `1px solid ${isCurrent ? "var(--color-accent-fg, #0969da)" : "var(--color-border-subtle, #21262d)"}`,
                    boxShadow: isCurrent ? "0 0 0 1px var(--color-accent-fg, #0969da)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div>
                    {/* Badges */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "6px",
                        marginBottom: "8px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          color: "var(--color-accent-fg, #58a6ff)",
                          backgroundColor: "rgba(56, 139, 253, 0.1)",
                          padding: "2px 7px",
                          borderRadius: "4px",
                          textTransform: "uppercase",
                          letterSpacing: "0.03em",
                        }}
                      >
                        {template.category}
                      </span>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          fontFamily: "var(--font-mono, monospace)",
                          color: "var(--color-fg-muted, #8b949e)",
                          backgroundColor: "rgba(255, 255, 255, 0.05)",
                          padding: "2px 6px",
                          borderRadius: "4px",
                        }}
                      >
                        {template.lang.toUpperCase()}
                      </span>
                    </div>

                    {/* Title */}
                    <div
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "var(--color-fg-default, #e6edf3)",
                        marginBottom: "6px",
                        lineHeight: 1.3,
                      }}
                    >
                      {template.title}
                    </div>

                    {/* Description */}
                    {template.description && (
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--color-fg-muted, #8b949e)",
                          lineHeight: 1.4,
                          marginBottom: "10px",
                        }}
                      >
                        {template.description}
                      </div>
                    )}

                    {/* Tags */}
                    {template.tags && template.tags.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "12px" }}>
                        {template.tags.map((tag) => (
                          <span
                            key={tag}
                            style={{
                              fontSize: "10px",
                              color: "var(--color-fg-subtle, #6e7681)",
                              backgroundColor: "rgba(110, 118, 129, 0.1)",
                              padding: "1px 5px",
                              borderRadius: "3px",
                            }}
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Code Snippet Preview Accordion */}
                    {isPreviewOpen && (
                      <div
                        style={{
                          marginTop: "8px",
                          marginBottom: "12px",
                          maxHeight: "140px",
                          overflowY: "auto",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          backgroundColor: "var(--color-canvas-default, #0d1117)",
                          border: "1px solid var(--color-border-muted, #21262d)",
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: "11px",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                          color: "var(--color-fg-muted, #8b949e)",
                        }}
                      >
                        {template.code.slice(0, 400)}
                        {template.code.length > 400 ? "\n..." : ""}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px" }}>
                    <button
                      type="button"
                      onClick={() => setPreviewingId(isPreviewOpen ? null : template.id)}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--color-border-default, #30363d)",
                        color: "var(--color-fg-muted, #8b949e)",
                        borderRadius: "6px",
                        padding: "5px 8px",
                        fontSize: "11px",
                        fontWeight: 500,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                      title={isPreviewOpen ? "Hide code" : "Preview code snippet"}
                    >
                      <CodeIcon size={12} />
                      {isPreviewOpen ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onSelectTemplate(template);
                        onClose();
                      }}
                      style={{
                        flex: 1,
                        background: isCurrent ? "rgba(35, 134, 54, 0.2)" : "var(--color-btn-primary-bg, #238636)",
                        border: isCurrent
                          ? "1px solid rgba(46, 160, 67, 0.4)"
                          : "1px solid var(--color-btn-primary-border, rgba(240, 246, 252, 0.1))",
                        color: isCurrent ? "var(--color-success-fg, #3fb950)" : "#ffffff",
                        borderRadius: "6px",
                        padding: "6px 12px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {isCurrent ? (
                        <>
                          <CheckIcon size={13} /> Active in Canvas
                        </>
                      ) : (
                        "Load Template"
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
