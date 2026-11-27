// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeClosedIcon,
  EyeIcon,
  IterationsIcon,
  PackageIcon,
  StarFillIcon,
  StarIcon,
} from "@primer/octicons-react";
import React, { useState } from "react";
import type { CadComponent } from "../util/lsp-bridge";
import type { CadPartOverride } from "./CadInspectorDrawer";
import {
  formatCadPartDisplayName,
  hasActiveScadOverrides,
  type CadFeatureKind,
  type CadFeatureNode,
  type ScadFeatureOverrides,
} from "./scad-feature-tree";

export interface CadComponentTreeProps {
  /** Procedural CSG operation tree (populated for OpenSCAD / procedural CAD). */
  featureNodes?: readonly CadFeatureNode[] | undefined;
  /** Non-destructive suppress / isolate / ghost state for procedural CSG operations. */
  featureOverrides?: ScadFeatureOverrides | undefined;
  onToggleFeatureSuppress?: ((id: string) => void) | undefined;
  onToggleFeatureIsolate?: ((id: string) => void) | undefined;
  onToggleFeatureGhost?: ((id: string) => void) | undefined;
  onResetFeatureOverrides?: (() => void) | undefined;
  onSelectFeature?: ((node: CadFeatureNode) => void) | undefined;
  selectedFeatureId?: string | null | undefined;
  /** CAD assembly parts / bodies (populated for STEP, URDF, GLB, STL, SCAD, etc.). */
  cadComponents?: readonly CadComponent[] | undefined;
  partOverrides?: Record<string, CadPartOverride> | undefined;
  onUpdatePartOverride?: ((name: string, patch: Partial<CadPartOverride>) => void) | undefined;
  onIsolatePart?: ((name: string) => void) | undefined;
  onResetPartOverrides?: (() => void) | undefined;
  selectedPartName?: string | null | undefined;
  onSelectPart?: ((name: string) => void) | undefined;
  colorMode?: "dark" | "light" | undefined;
}

function featureKindGlyph(kind: CadFeatureKind, op: string): { symbol: string; color: string } {
  const low = op.toLowerCase();
  if (kind === "boolean") {
    if (low === "difference") return { symbol: "⊖", color: "#ef4444" };
    if (low === "intersection") return { symbol: "∩", color: "#a855f7" };
    return { symbol: "⊕", color: "#0891b2" };
  }
  if (kind === "transform") return { symbol: "↗", color: "#d97706" };
  if (kind === "loop") return { symbol: "↻", color: "#6366f1" };
  if (kind === "primitive") return { symbol: "●", color: "#10b981" };
  return { symbol: "◆", color: "#0284c7" };
}

/**
 * Unified left-sidebar `COMPONENTS` tree for CAD models:
 * - Procedural CAD (OpenSCAD): interactive CSG operation tree with Hide/Suppress,
 *   Isolate (Show Only), Debug/Ghost cutter preview, and click-to-source.
 * - CAD Assemblies (STEP / URDF / GLB / multi-part): sub-component & part list
 *   with synced 3D selection, Hide/Show, Ghost, and Isolate.
 */
export const CadComponentTree: React.FC<CadComponentTreeProps> = ({
  featureNodes = [],
  featureOverrides,
  onToggleFeatureSuppress,
  onToggleFeatureIsolate,
  onToggleFeatureGhost,
  onResetFeatureOverrides,
  onSelectFeature,
  selectedFeatureId = null,
  cadComponents = [],
  partOverrides = {},
  onUpdatePartOverride,
  onIsolatePart,
  onResetPartOverrides,
  selectedPartName = null,
  onSelectPart,
  colorMode = "light",
}) => {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const dark = colorMode === "dark";

  const textFg = dark ? "#e2e8f0" : "#0f172a";
  const mutedFg = dark ? "#94a3b8" : "#64748b";
  const borderCol = dark ? "rgba(148, 163, 184, 0.16)" : "rgba(15, 23, 42, 0.08)";
  const selBg = dark ? "rgba(8, 145, 178, 0.22)" : "rgba(8, 145, 178, 0.12)";
  const activeAccent = dark ? "#22d3ee" : "#0e7490";

  const hasFeatures = featureNodes.length > 0;
  const hasFeatureOverrides = Boolean(featureOverrides && hasActiveScadOverrides(featureOverrides));
  const hasPartOverrides = Object.keys(partOverrides).length > 0;
  const visibleAssemblyParts = cadComponents.filter(
    (c) => !c.name.startsWith("Debug_Cutter_") && !c.name.startsWith("Background_"),
  );

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const actionBtnStyle = (active: boolean, activeColor = activeAccent): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    padding: 0,
    borderRadius: 5,
    border: "none",
    background: active ? (dark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.08)") : "transparent",
    color: active ? activeColor : mutedFg,
    cursor: "pointer",
    flexShrink: 0,
    fontSize: 10.5,
    fontWeight: 700,
  });

  const renderFeatureNode = (node: CadFeatureNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsedIds.has(node.id);
    const isSelected = selectedFeatureId === node.id;
    const isSuppressed = Boolean(featureOverrides?.suppressedIds.has(node.id) || node.modifier === "*");
    const isIsolated = Boolean(featureOverrides?.isolatedId === node.id || node.modifier === "!");
    const isGhosted = Boolean(
      featureOverrides?.ghostIds.has(node.id) || node.modifier === "#" || node.modifier === "%",
    );
    const glyph = featureKindGlyph(node.kind, node.op);

    return (
      <div key={node.id}>
        <div
          data-testid={`cad-feature-row-${node.id}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
            paddingLeft: 8 + depth * 14,
            borderRadius: 6,
            background: isSelected ? selBg : "transparent",
            color: textFg,
            opacity: isSuppressed ? 0.45 : 1,
            minHeight: 28,
          }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleCollapse(node.id)}
              aria-label={isCollapsed ? `Expand ${node.op}` : `Collapse ${node.op}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 16,
                height: 16,
                padding: 0,
                border: "none",
                background: "transparent",
                color: mutedFg,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              {isCollapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
            </button>
          ) : (
            <span style={{ width: 16, flexShrink: 0 }} />
          )}

          <button
            type="button"
            data-testid="cad-feature-select-btn"
            onClick={() => onSelectFeature?.(node)}
            title={`${node.label} (Line ${node.line})`}
            style={{
              flex: 1,
              minWidth: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: 0,
              border: "none",
              background: "transparent",
              color: "inherit",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                color: glyph.color,
                fontSize: 12,
                fontWeight: 700,
                width: 14,
                textAlign: "center",
                flexShrink: 0,
              }}
            >
              {node.kind === "loop" ? <IterationsIcon size={12} /> : glyph.symbol}
            </span>
            <span
              style={{
                fontFamily: "var(--ms-font-mono, monospace)",
                fontSize: 11.5,
                fontWeight: isSelected || node.kind === "boolean" ? 600 : 500,
                textDecoration: isSuppressed ? "line-through" : "none",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {node.label}
            </span>
          </button>

          <span style={{ fontSize: 10, color: mutedFg, fontFamily: "var(--ms-font-mono, monospace)", flexShrink: 0 }}>
            L{node.line}
          </span>

          {onToggleFeatureSuppress && (
            <button
              type="button"
              data-testid="cad-feature-suppress-btn"
              aria-pressed={isSuppressed}
              title={isSuppressed ? "Show / unsuppress operation" : "Hide / suppress operation (*)"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFeatureSuppress(node.id);
              }}
              style={actionBtnStyle(isSuppressed, "#ef4444")}
            >
              {isSuppressed ? <EyeClosedIcon size={12} /> : <EyeIcon size={12} />}
            </button>
          )}

          {onToggleFeatureIsolate && (
            <button
              type="button"
              data-testid="cad-feature-isolate-btn"
              aria-pressed={isIsolated}
              title={isIsolated ? "Clear isolate" : "Show only this operation (!)"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFeatureIsolate(node.id);
              }}
              style={actionBtnStyle(isIsolated, "#f59e0b")}
            >
              {isIsolated ? <StarFillIcon size={11} /> : <StarIcon size={11} />}
            </button>
          )}

          {onToggleFeatureGhost && (
            <button
              type="button"
              data-testid="cad-feature-ghost-btn"
              aria-pressed={isGhosted}
              title={isGhosted ? "Hide debug cutter overlay" : "Highlight / ghost operation (#)"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFeatureGhost(node.id);
              }}
              style={actionBtnStyle(isGhosted, "#f43f5e")}
            >
              #
            </button>
          )}
        </div>

        {hasChildren && !isCollapsed && <div>{node.children.map((child) => renderFeatureNode(child, depth + 1))}</div>}
      </div>
    );
  };

  return (
    <div
      data-testid="cad-component-tree"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "6px 6px 10px",
      }}
    >
      {/* Procedural CAD Feature / Operation Tree */}
      {hasFeatures && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "2px 8px 4px",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: mutedFg,
            }}
          >
            <span>Operations Tree</span>
            {hasFeatureOverrides && onResetFeatureOverrides && (
              <button
                type="button"
                data-testid="cad-feature-reset-btn"
                onClick={onResetFeatureOverrides}
                style={{
                  background: "transparent",
                  border: "none",
                  color: activeAccent,
                  fontSize: 10.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: 0,
                  textTransform: "none",
                  letterSpacing: 0,
                }}
              >
                Reset
              </button>
            )}
          </div>
          {featureNodes.map((n) => renderFeatureNode(n, 0))}
        </div>
      )}

      {/* CAD Assembly / Bodies Section (always shown for STEP/URDF/GLB, or when >1 body exists) */}
      {visibleAssemblyParts.length > 0 && (!hasFeatures || visibleAssemblyParts.length > 1) && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            borderTop: hasFeatures ? `1px solid ${borderCol}` : undefined,
            paddingTop: hasFeatures ? 6 : 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "2px 8px 4px",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: mutedFg,
            }}
          >
            <span>Parts ({visibleAssemblyParts.length})</span>
            {hasPartOverrides && onResetPartOverrides && (
              <button
                type="button"
                onClick={onResetPartOverrides}
                style={{
                  background: "transparent",
                  border: "none",
                  color: activeAccent,
                  fontSize: 10.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: 0,
                  textTransform: "none",
                  letterSpacing: 0,
                }}
              >
                Show All
              </button>
            )}
          </div>

          {visibleAssemblyParts.map((comp, idx) => {
            const ov = partOverrides[comp.name] ?? {};
            const isHidden = ov.visible === false;
            const isGhost = Boolean(ov.ghost);
            const isSel = selectedPartName === comp.name;
            const displayLabel = formatCadPartDisplayName(comp.name);
            return (
              <div
                key={`${comp.name}::${idx}`}
                data-testid={`cad-assembly-part-${comp.name}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: isSel ? selBg : "transparent",
                  color: textFg,
                  opacity: isHidden ? 0.48 : 1,
                  minHeight: 28,
                }}
              >
                <button
                  type="button"
                  data-testid="cad-assembly-part-select-btn"
                  onClick={() => onSelectPart?.(comp.name)}
                  title={comp.name}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    color: "inherit",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <PackageIcon size={13} style={{ color: isSel ? activeAccent : mutedFg, flexShrink: 0 }} />
                  <span
                    style={{
                      fontFamily: "var(--ms-font-mono, monospace)",
                      fontSize: 11.5,
                      fontWeight: isSel ? 600 : 500,
                      textDecoration: isHidden ? "line-through" : "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {displayLabel}
                  </span>
                </button>

                {onUpdatePartOverride && (
                  <>
                    <button
                      type="button"
                      data-testid="cad-assembly-part-hide-btn"
                      aria-pressed={isHidden}
                      title={isHidden ? "Show part" : "Hide part"}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdatePartOverride(comp.name, { visible: isHidden });
                      }}
                      style={actionBtnStyle(isHidden, "#ef4444")}
                    >
                      {isHidden ? <EyeClosedIcon size={12} /> : <EyeIcon size={12} />}
                    </button>
                    <button
                      type="button"
                      data-testid="cad-assembly-part-ghost-btn"
                      aria-pressed={isGhost}
                      title={isGhost ? "Solid shading" : "Ghost / X-ray"}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdatePartOverride(comp.name, { ghost: !isGhost });
                      }}
                      style={actionBtnStyle(isGhost)}
                    >
                      α
                    </button>
                  </>
                )}

                {onIsolatePart && visibleAssemblyParts.length > 1 && (
                  <button
                    type="button"
                    data-testid="cad-assembly-part-isolate-btn"
                    title="Isolate part"
                    onClick={(e) => {
                      e.stopPropagation();
                      onIsolatePart(comp.name);
                    }}
                    style={actionBtnStyle(false, "#f59e0b")}
                  >
                    <StarIcon size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
