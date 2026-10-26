// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowRightIcon, ClockIcon, TerminalIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import Box from "../../../components/Box";
import { safeJsonParse } from "../../../util/json";
import type { ScriptTemplate, ScriptTemplateConfig } from "../types";
import { categoryIcon } from "../utils";

export interface TemplatesTabProps {
  groupedTemplates: Record<string, ScriptTemplate[]>;
  onSelectTemplate: (templateId: number) => void;
}

export const TemplatesTab: React.FC<TemplatesTabProps> = ({ groupedTemplates, onSelectTemplate }) => {
  if (Object.keys(groupedTemplates).length === 0) {
    return (
      <Box py={6} textAlign="center" color="var(--color-text-muted)">
        <TerminalIcon size={32} />
        <Text display="block" mt={2}>
          No simulation templates available
        </Text>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={4}>
      {Object.entries(groupedTemplates).map(([category, items]) => (
        <Box key={category}>
          <Box display="flex" alignItems="center" gap={2} mb={3}>
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "2px",
                backgroundColor: "var(--color-accent-purple, #a855f7)",
              }}
            />
            <Text fontSize="16px" fontWeight="700" color="var(--color-text-primary, #ffffff)">
              {category}
            </Text>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
              ({items.length} {items.length === 1 ? "pipeline" : "pipelines"})
            </span>
          </Box>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: "14px",
            }}
          >
            {items.map((t) => {
              const cfg = safeJsonParse<ScriptTemplateConfig>(t.config, {});

              return (
                <div
                  key={t.id}
                  onClick={() => onSelectTemplate(t.id)}
                  style={{
                    background: "var(--color-bg-card, rgba(255, 255, 255, 0.03))",
                    border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08))",
                    borderRadius: "12px",
                    padding: "18px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: "12px",
                    transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-accent-purple, #a855f7)";
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 8px 24px rgba(111, 66, 193, 0.2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-border-glass, rgba(255, 255, 255, 0.08))";
                    e.currentTarget.style.transform = "none";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <div>
                    <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={2} mb={2}>
                      <div
                        style={{
                          width: "36px",
                          height: "36px",
                          borderRadius: "8px",
                          backgroundColor: "rgba(168, 85, 247, 0.12)",
                          border: "1px solid rgba(168, 85, 247, 0.3)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--color-accent-purple, #a855f7)",
                          flexShrink: 0,
                        }}
                      >
                        {categoryIcon(t.icon)}
                      </div>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: "9999px",
                          background: "rgba(255, 255, 255, 0.06)",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        {t.category}
                      </span>
                    </Box>

                    <Text fontSize="15px" fontWeight="700" color="var(--color-text-primary, #ffffff)" display="block">
                      {t.name}
                    </Text>

                    <Text
                      fontSize="13px"
                      color="var(--color-text-muted)"
                      display="block"
                      style={{ marginTop: "6px", lineHeight: 1.45 }}
                    >
                      {t.description.length > 150 ? t.description.slice(0, 150) + "…" : t.description}
                    </Text>
                  </div>

                  <Box
                    pt={2}
                    borderTop="1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.06))"
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    fontSize="12px"
                  >
                    <Box display="flex" alignItems="center" gap={3} color="var(--color-text-muted)">
                      {cfg.solver && <span style={{ color: "var(--color-accent-cyan)" }}>{cfg.solver}</span>}
                      {cfg.estimatedDuration && (
                        <Box display="flex" alignItems="center" gap={1}>
                          <ClockIcon size={12} />
                          <span>{cfg.estimatedDuration}</span>
                        </Box>
                      )}
                    </Box>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTemplate(t.id);
                      }}
                      style={{
                        background: "rgba(168, 85, 247, 0.15)",
                        border: "1px solid rgba(168, 85, 247, 0.35)",
                        color: "#d8b4fe",
                        borderRadius: "6px",
                        padding: "4px 10px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <span>Configure &amp; Run</span>
                      <ArrowRightIcon size={12} />
                    </button>
                  </Box>
                </div>
              );
            })}
          </div>
        </Box>
      ))}
    </Box>
  );
};
