// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowRightIcon, ClockIcon, SearchIcon, ZapIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useMemo, useState } from "react";
import Box from "../../../components/Box";
import { BUILTIN_HPC_TEMPLATES } from "../../../components/cloud-sim/hpcTemplates";
import { safeJsonParse } from "../../../util/json";
import type { ScriptTemplate, ScriptTemplateConfig } from "../types";
import { categoryIcon } from "../utils";

export interface TemplatesTabProps {
  groupedTemplates: Record<string, ScriptTemplate[]>;
  onSelectTemplate: (templateId: number) => void;
  onLaunchWizard?: (templateSlug: string) => void;
}

interface UnifiedGalleryTemplate {
  id?: number | undefined;
  slug: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  badgeIcon?: string | undefined;
  accentColor: string;
  solver: string;
  estimatedDuration: string;
  recommendedProfile: string;
  steps: string[];
  tags: string[];
}

export const TemplatesTab: React.FC<TemplatesTabProps> = ({ groupedTemplates, onSelectTemplate, onLaunchWizard }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");

  // Merge built-in HPC templates with database-seeded script templates
  const galleryItems = useMemo<UnifiedGalleryTemplate[]>(() => {
    const dbTemplatesFlat = Object.values(groupedTemplates).flat();
    const bySlug = new Map<string, UnifiedGalleryTemplate>();

    for (const bt of BUILTIN_HPC_TEMPLATES) {
      const matchingDb = dbTemplatesFlat.find((d) => d.slug === bt.slug);
      bySlug.set(bt.slug, {
        id: matchingDb?.id ?? bt.dbTemplateId,
        slug: bt.slug,
        name: bt.name,
        category: bt.category,
        description: bt.description,
        icon: matchingDb?.icon || bt.icon || "pulse",
        accentColor: bt.accentColor,
        solver: bt.solver,
        estimatedDuration: bt.estimatedDuration,
        recommendedProfile: bt.recommendedProfile,
        steps: bt.pipelineSteps.map((s) => s.title),
        tags: [bt.badge, bt.domain, ...bt.compatibleDialects],
      });
    }

    for (const dt of dbTemplatesFlat) {
      if (bySlug.has(dt.slug)) continue;
      const cfg = safeJsonParse<ScriptTemplateConfig>(dt.config, {});
      bySlug.set(dt.slug, {
        id: dt.id,
        slug: dt.slug,
        name: dt.name,
        category: dt.category || "General",
        description: dt.description,
        icon: dt.icon,
        accentColor: dt.category === "CFD" ? "#0ea5e9" : dt.category === "FEA" ? "#f97316" : "#a855f7",
        solver: cfg.solver || "HPC Solver",
        estimatedDuration: cfg.estimatedDuration || "5–20 min",
        recommendedProfile: cfg.computeProfile || "hpc-standard",
        steps: Array.isArray(cfg.steps) ? cfg.steps.map(String) : ["Prepare", "Execute Solver", "Post-Process"],
        tags: [dt.category, cfg.solver || "HPC"].filter(Boolean),
      });
    }

    return Array.from(bySlug.values());
  }, [groupedTemplates]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of galleryItems) {
      set.add(item.category);
    }
    return ["ALL", ...Array.from(set)];
  }, [galleryItems]);

  const filteredItems = useMemo(() => {
    return galleryItems.filter((item) => {
      const matchesCat = selectedCategory === "ALL" || item.category === selectedCategory;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.solver.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q));
      return matchesCat && matchesSearch;
    });
  }, [galleryItems, selectedCategory, searchQuery]);

  return (
    <Box display="flex" flexDirection="column" gap={4}>
      {/* SharePoint-Style Gallery Header Banner */}
      <div
        style={{
          padding: "20px 24px",
          borderRadius: "14px",
          background:
            "linear-gradient(135deg, rgba(88, 166, 255, 0.08) 0%, rgba(139, 92, 246, 0.08) 50%, rgba(16, 185, 129, 0.05) 100%)",
          border: "1px solid var(--color-border-default, rgba(255, 255, 255, 0.1))",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                padding: "2px 8px",
                borderRadius: "999px",
                background: "rgba(88, 166, 255, 0.15)",
                color: "var(--color-accent-fg, #58a6ff)",
                border: "1px solid rgba(88, 166, 255, 0.3)",
              }}
            >
              Blueprint Gallery
            </span>
            <span style={{ fontSize: "12px", color: "var(--color-fg-muted, #8b949e)" }}>
              {galleryItems.length} verified HPC simulation pipelines
            </span>
          </div>
          <Text fontSize="18px" fontWeight="700" color="var(--color-fg-default, #f0f6fc)" display="block">
            Pick a Simulation Template &amp; Run Against Any Model Artifact
          </Text>
          <Text fontSize="13px" color="var(--color-fg-muted, #8b949e)" display="block" mt={1}>
            Pre-configured solver tolerances, mesh/DAE lowering stages, and Slurm compute partitions — ready for 1-click
            execution.
          </Text>
        </div>

        {onLaunchWizard && (
          <button
            type="button"
            onClick={() => onLaunchWizard("transient-multiphysics-dae")}
            style={{
              background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
              color: "#ffffff",
              border: "none",
              borderRadius: "10px",
              padding: "10px 18px",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              boxShadow: "0 4px 14px rgba(37, 99, 235, 0.35)",
            }}
          >
            <ZapIcon size={14} /> Open Guided Simulation Wizard
          </button>
        )}
      </div>

      {/* Filter Bar: Search + Category Pills */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          {categories.map((cat) => {
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                style={{
                  padding: "6px 13px",
                  borderRadius: "999px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: active
                    ? "1px solid var(--color-accent-fg, #58a6ff)"
                    : "1px solid var(--color-border-default, rgba(255, 255, 255, 0.12))",
                  background: active
                    ? "rgba(88, 166, 255, 0.15)"
                    : "var(--color-canvas-subtle, rgba(255, 255, 255, 0.03))",
                  color: active ? "var(--color-accent-fg, #58a6ff)" : "var(--color-fg-muted, #8b949e)",
                  transition: "all 0.15s ease",
                }}
              >
                {cat === "ALL" ? `All Templates (${galleryItems.length})` : cat}
              </button>
            );
          })}
        </div>

        <div style={{ position: "relative", minWidth: "260px", flex: "0 1 320px" }}>
          <span
            style={{
              position: "absolute",
              left: "11px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--color-fg-muted, #8b949e)",
              display: "flex",
            }}
          >
            <SearchIcon size={14} />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates, solvers, or tags..."
            aria-label="Search simulation templates"
            style={{
              width: "100%",
              padding: "7px 12px 7px 32px",
              borderRadius: "8px",
              border: "1px solid var(--color-border-default, rgba(255, 255, 255, 0.15))",
              background: "var(--color-canvas-subtle, rgba(255, 255, 255, 0.03))",
              color: "var(--color-fg-default, #f0f6fc)",
              fontSize: "12px",
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>

      {/* Template Cards Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))",
          gap: "16px",
        }}
      >
        {filteredItems.map((t) => (
          <div
            key={t.slug}
            onClick={() => {
              if (onLaunchWizard) {
                onLaunchWizard(t.slug);
              } else if (t.id) {
                onSelectTemplate(t.id);
              }
            }}
            style={{
              background: "var(--color-canvas-subtle, rgba(255, 255, 255, 0.03))",
              border: "1px solid var(--color-border-default, rgba(255, 255, 255, 0.1))",
              borderRadius: "14px",
              padding: "18px",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: "14px",
              transition: "all 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = t.accentColor;
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 10px 26px rgba(0, 0, 0, 0.18)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--color-border-default, rgba(255, 255, 255, 0.1))";
              e.currentTarget.style.transform = "none";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div>
              <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={2} mb={2}>
                <div
                  style={{
                    width: "38px",
                    height: "38px",
                    borderRadius: "10px",
                    backgroundColor: `${t.accentColor}1a`,
                    border: `1px solid ${t.accentColor}45`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: t.accentColor,
                    fontSize: "18px",
                    flexShrink: 0,
                  }}
                >
                  {t.badgeIcon ? <span>{t.badgeIcon}</span> : categoryIcon(t.icon)}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: "9999px",
                      background: `${t.accentColor}1a`,
                      color: t.accentColor,
                      border: `1px solid ${t.accentColor}38`,
                    }}
                  >
                    {t.category}
                  </span>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 600,
                      padding: "2px 7px",
                      borderRadius: "6px",
                      background: "var(--color-canvas-default, rgba(255, 255, 255, 0.05))",
                      color: "var(--color-fg-muted, #8b949e)",
                      fontFamily: "var(--font-mono, monospace)",
                      border: "1px solid var(--color-border-default, rgba(255, 255, 255, 0.08))",
                    }}
                  >
                    {t.recommendedProfile}
                  </span>
                </div>
              </Box>

              <Text fontSize="15px" fontWeight="700" color="var(--color-fg-default, #ffffff)" display="block">
                {t.name}
              </Text>

              <Text
                fontSize="12px"
                color="var(--color-fg-muted, #8b949e)"
                display="block"
                style={{ marginTop: "6px", lineHeight: 1.5 }}
              >
                {t.description.length > 145 ? t.description.slice(0, 145) + "…" : t.description}
              </Text>

              {/* Pipeline Stage Preview Pills */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  flexWrap: "wrap",
                  marginTop: "10px",
                }}
              >
                {t.steps.slice(0, 4).map((step, idx) => (
                  <span
                    key={step}
                    style={{
                      fontSize: "10px",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      background: "var(--color-canvas-default, rgba(255, 255, 255, 0.04))",
                      border: "1px solid var(--color-border-default, rgba(255, 255, 255, 0.08))",
                      color: "var(--color-fg-muted, #8b949e)",
                    }}
                  >
                    {idx + 1}. {step}
                  </span>
                ))}
              </div>
            </div>

            <Box
              pt={2}
              borderTop="1px solid var(--color-border-default, rgba(255, 255, 255, 0.08))"
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              fontSize="12px"
              style={{ gap: "8px", flexWrap: "wrap" }}
            >
              <Box display="flex" alignItems="center" gap={2} color="var(--color-fg-muted, #8b949e)">
                <span
                  style={{
                    color: t.accentColor,
                    fontWeight: 700,
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "11px",
                  }}
                >
                  {t.solver}
                </span>
                <Box display="flex" alignItems="center" gap={1}>
                  <ClockIcon size={11} />
                  <span style={{ fontSize: "11px" }}>{t.estimatedDuration}</span>
                </Box>
              </Box>

              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {t.id !== undefined && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectTemplate(t.id!);
                    }}
                    style={{
                      background: "var(--color-canvas-default, rgba(255, 255, 255, 0.05))",
                      border: "1px solid var(--color-border-default, rgba(255, 255, 255, 0.14))",
                      color: "var(--color-fg-default, #f0f6fc)",
                      borderRadius: "6px",
                      padding: "4px 9px",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                    title="Open full-page script workbench"
                  >
                    Workbench ↗
                  </button>
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onLaunchWizard) {
                      onLaunchWizard(t.slug);
                    } else if (t.id !== undefined) {
                      onSelectTemplate(t.id);
                    }
                  }}
                  style={{
                    background: `${t.accentColor}22`,
                    border: `1px solid ${t.accentColor}55`,
                    color: t.accentColor,
                    borderRadius: "6px",
                    padding: "4px 10px",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span>⚡ Launch Wizard</span>
                  <ArrowRightIcon size={11} />
                </button>
              </div>
            </Box>
          </div>
        ))}
      </div>
    </Box>
  );
};
