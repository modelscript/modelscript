// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CodeIcon, SearchIcon } from "@primer/octicons-react";
import { Button, Dialog, TextInput } from "@primer/react";
import React, { useMemo, useState } from "react";
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
    <Dialog
      title="Starter Engineering Templates"
      subtitle="Curated multi-physics, controls, CAD, and system models ready to simulate and modify"
      width="xlarge"
      onClose={onClose}
    >
      <div style={{ display: "flex", flexDirection: "column", maxHeight: "76vh", overflow: "hidden" }}>
        {/* Search & Domain Filter Bar */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--ms-divider, var(--color-border-default))",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            backgroundColor: "var(--color-canvas-subtle, var(--ms-bg-elv))",
          }}
        >
          <TextInput
            block
            leadingVisual={SearchIcon}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates by discipline, keyword, or engineering language..."
            autoFocus
          />

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
                    background: isSelected ? "var(--ms-accent, var(--color-accent-fg))" : "transparent",
                    border: `1px solid ${isSelected ? "var(--ms-accent, var(--color-accent-fg))" : "var(--ms-border-default, var(--color-border-default))"}`,
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
                    backgroundColor: "var(--ms-bg-surface, var(--color-canvas-subtle))",
                    border: `1px solid ${isCurrent ? "var(--ms-accent, var(--color-accent-fg))" : "var(--ms-border-subtle, var(--color-border-subtle))"}`,
                    boxShadow: isCurrent ? "0 0 0 1px var(--ms-accent, var(--color-accent-fg))" : "none",
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
                          color: "var(--ms-accent, var(--color-accent-fg))",
                          backgroundColor: "var(--ms-accent-subtle, rgba(6, 182, 212, 0.12))",
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
                          backgroundColor: "var(--color-canvas-default, var(--ms-bg))",
                          border: "1px solid var(--color-border-muted, var(--ms-border))",
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: "11px",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                          color: "var(--color-fg-muted)",
                        }}
                      >
                        {template.code.slice(0, 400)}
                        {template.code.length > 400 ? "\n..." : ""}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px" }}>
                    <Button
                      type="button"
                      size="small"
                      variant="default"
                      onClick={() => setPreviewingId(isPreviewOpen ? null : template.id)}
                      title={isPreviewOpen ? "Hide code" : "Preview code snippet"}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <CodeIcon size={12} />
                        {isPreviewOpen ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
                      </span>
                    </Button>

                    <Button
                      type="button"
                      size="small"
                      variant={isCurrent ? "default" : "primary"}
                      style={{ flex: 1 }}
                      onClick={() => {
                        onSelectTemplate(template);
                        onClose();
                      }}
                    >
                      {isCurrent ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                          <CheckIcon size={13} /> Active in Canvas
                        </span>
                      ) : (
                        "Load Template"
                      )}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
};
