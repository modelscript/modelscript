// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LanguagePanelMode } from "../panel-contract.js";

export interface PanelShellProps {
  mode: LanguagePanelMode;
  colorMode: "dark" | "light";
  isFullScreen?: boolean | undefined;
  children: React.ReactNode;
}

/**
 * Root container for decentralized language panels.
 * Uses --ms-* design tokens so it renders natively in Ansatz Studio (VS Code), Ansatz Editor, and Ansatz Network.
 */
export const PanelShell: React.FC<PanelShellProps> = ({ mode, colorMode, isFullScreen = false, children }) => {
  const isArtifactCard = mode === "artifact" && !isFullScreen;
  const fallbackBg = colorMode === "dark" ? "#18181b" : "#ffffff";
  const fallbackFg = colorMode === "dark" ? "#f4f4f5" : "#0f172a";
  return (
    <div
      data-theme={colorMode}
      data-ms-panel-mode={mode}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: isArtifactCard ? "480px" : "100%",
        minHeight: isArtifactCard ? "360px" : 0,
        background: `var(--ms-bg, ${fallbackBg})`,
        color: `var(--ms-text-1, ${fallbackFg})`,
        fontFamily: "var(--ms-font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)",
        fontSize: "12px",
        border: isArtifactCard ? "1px solid var(--ms-border, rgba(148,163,184,0.2))" : "none",
        borderRadius: isArtifactCard ? "8px" : "0",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
};

export interface PanelToolbarProps {
  title: string;
  subtitle?: string | undefined;
  badge?: { label: string; tone?: "neutral" | "success" | "warning" | "danger" | "info" } | undefined;
  actions?: React.ReactNode;
}

const BADGE_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  neutral: {
    bg: "var(--ms-bg-soft, rgba(148,163,184,0.14))",
    fg: "var(--ms-text-2, #64748b)",
    border: "var(--ms-border, rgba(148,163,184,0.25))",
  },
  success: {
    bg: "var(--ms-status-pass-bg, rgba(16,185,129,0.14))",
    fg: "var(--ms-status-pass-fg, #059669)",
    border: "var(--ms-status-pass-border, rgba(16,185,129,0.35))",
  },
  warning: {
    bg: "var(--ms-status-warn-bg, rgba(245,158,11,0.14))",
    fg: "var(--ms-status-warn-fg, #d97706)",
    border: "var(--ms-status-warn-border, rgba(245,158,11,0.35))",
  },
  danger: {
    bg: "var(--ms-status-fail-bg, rgba(244,63,94,0.14))",
    fg: "var(--ms-status-fail-fg, #e11d48)",
    border: "var(--ms-status-fail-border, rgba(244,63,94,0.35))",
  },
  info: {
    bg: "var(--ms-status-info-bg, rgba(6,182,212,0.14))",
    fg: "var(--ms-status-info-fg, #0891b2)",
    border: "var(--ms-status-info-border, rgba(6,182,212,0.35))",
  },
};

export const PanelToolbar: React.FC<PanelToolbarProps> = ({ title, subtitle, badge, actions }) => {
  const badgeStyle = badge ? (BADGE_COLORS[badge.tone ?? "neutral"] ?? BADGE_COLORS["neutral"]!) : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "7px 12px",
        background: "var(--ms-bg-alt, #f6f8fa)",
        borderBottom: "1px solid var(--ms-border, rgba(148,163,184,0.2))",
        flexShrink: 0,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
        <span
          style={{
            fontWeight: 600,
            fontSize: "13px",
            letterSpacing: "-0.01em",
            color: "var(--ms-text-heading, var(--ms-text-1))",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </span>
        {subtitle && (
          <span
            style={{
              fontSize: "11px",
              color: "var(--ms-text-2, #64748b)",
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {subtitle}
          </span>
        )}
        {badge && badgeStyle && (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              padding: "2px 7px",
              borderRadius: "999px",
              background: badgeStyle.bg,
              color: badgeStyle.fg,
              border: `1px solid ${badgeStyle.border}`,
              whiteSpace: "nowrap",
            }}
          >
            {badge.label}
          </span>
        )}
      </div>
      {actions && <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
};

export interface PanelTabItem<T extends string = string> {
  id: T;
  label: string;
  count?: number | undefined;
}

export interface PanelTabBarProps<T extends string = string> {
  tabs: PanelTabItem<T>[];
  activeTab: T;
  onSelect: (id: T) => void;
  trailing?: React.ReactNode;
}

export function PanelTabBar<T extends string = string>({
  tabs,
  activeTab,
  onSelect,
  trailing,
}: PanelTabBarProps<T>): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "0 10px",
        background: "var(--ms-bg-alt, #f6f8fa)",
        borderBottom: "1px solid var(--ms-border, rgba(148,163,184,0.2))",
        flexShrink: 0,
        minWidth: 0,
      }}
    >
      <div
        role="tablist"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "2px",
          overflowX: "auto",
          minWidth: 0,
          scrollbarWidth: "none",
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(tab.id)}
              style={{
                appearance: "none",
                background: "transparent",
                border: "none",
                borderBottom: active ? "2px solid var(--ms-brand, #0891b2)" : "2px solid transparent",
                color: active ? "var(--ms-text-heading, var(--ms-text-1))" : "var(--ms-text-2, #64748b)",
                fontWeight: active ? 600 : 500,
                fontSize: "12px",
                padding: "7px 10px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                transition: "color 120ms ease",
              }}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span
                  style={{
                    fontSize: "10px",
                    padding: "0 5px",
                    borderRadius: "999px",
                    fontVariantNumeric: "tabular-nums",
                    background: active
                      ? "var(--ms-brand-soft, rgba(8,145,178,0.12))"
                      : "var(--ms-bg-soft, rgba(148,163,184,0.16))",
                    color: active ? "var(--ms-brand, #0891b2)" : "var(--ms-text-2, #64748b)",
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {trailing && <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>{trailing}</div>}
    </div>
  );
}

export interface PanelKpiItem {
  label: string;
  value: string | number;
  unit?: string | undefined;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | undefined;
}

/**
 * Compact, tabular-nums metric ribbon designed to maximize canvas/table workspace height.
 */
export const PanelKpiStrip: React.FC<{ items: PanelKpiItem[] }> = ({ items }) => {
  if (items.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0px",
        padding: "5px 12px",
        borderBottom: "1px solid var(--ms-border, rgba(148,163,184,0.2))",
        background: "var(--ms-bg, transparent)",
        overflowX: "auto",
        scrollbarWidth: "none",
        flexShrink: 0,
      }}
    >
      {items.map((item, idx) => {
        const toneColor =
          item.tone === "success"
            ? "var(--ms-success, #059669)"
            : item.tone === "warning"
              ? "var(--ms-warning, #d97706)"
              : item.tone === "danger"
                ? "var(--ms-danger, #e11d48)"
                : item.tone === "info"
                  ? "var(--ms-info, #0891b2)"
                  : "var(--ms-text-heading, var(--ms-text-1))";
        return (
          <div
            key={item.label}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "6px",
              padding: idx === 0 ? "2px 14px 2px 0" : "2px 14px",
              borderLeft: idx === 0 ? "none" : "1px solid var(--ms-divider, rgba(148,163,184,0.16))",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.04em",
                color: "var(--ms-text-3, var(--ms-text-2, #64748b))",
                textTransform: "uppercase",
              }}
            >
              {item.label}
            </span>
            <span
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: toneColor,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {item.value}
              {item.unit && (
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 500,
                    marginLeft: "2px",
                    color: "var(--ms-text-2, #64748b)",
                  }}
                >
                  {item.unit}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export interface PanelButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost" | undefined;
}

export const PanelButton: React.FC<PanelButtonProps> = ({ variant = "default", style, ...props }) => (
  <button
    type="button"
    {...props}
    style={{
      appearance: "none",
      fontSize: "11px",
      fontWeight: 500,
      padding: "4px 9px",
      borderRadius: "6px",
      cursor: props.disabled ? "not-allowed" : "pointer",
      opacity: props.disabled ? 0.45 : 1,
      background:
        variant === "primary"
          ? "var(--ms-brand, #0e7490)"
          : variant === "ghost"
            ? "transparent"
            : "var(--ms-bg-soft, rgba(148,163,184,0.12))",
      color: variant === "primary" ? "var(--ms-brand-contrast, #ffffff)" : "var(--ms-text-1, #0f172a)",
      border:
        variant === "primary"
          ? "1px solid var(--ms-brand, #0e7490)"
          : variant === "ghost"
            ? "1px solid transparent"
            : "1px solid var(--ms-border, rgba(148,163,184,0.22))",
      transition: "background 120ms ease, border-color 120ms ease",
      ...style,
    }}
  />
);

export interface PanelSvgEntitySelection {
  id: string;
  kind?: string | undefined;
  line?: number | undefined;
}

export interface PanelSvgStageProps {
  svg: string;
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
  onSelectEntity?: ((entity: PanelSvgEntitySelection) => void) | undefined;
  emptyMessage?: string | undefined;
  canvasTheme?: "light" | "dark" | undefined;
  onToggleCanvasTheme?: (() => void) | undefined;
  hudExtra?: React.ReactNode;
}

/**
 * Interactive pan/zoom SVG viewport (v2) for language diagram/plot panels.
 * Features cursor-anchored wheel zoom, drag pan with click-vs-drag threshold,
 * floating glass HUD with Fit/Reset/Minimap/Theme toggle, and keyboard shortcuts.
 */
export const PanelSvgStage: React.FC<PanelSvgStageProps> = ({
  svg,
  onRevealLine,
  onSelectEntity,
  emptyMessage = "No visual output available.",
  canvasTheme,
  onToggleCanvasTheme,
  hudExtra,
}) => {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  const resetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomAtPoint = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const el = stageRef.current;
    setScale((prevScale) => {
      const nextScale = Math.max(0.15, Math.min(10, prevScale * factor));
      if (nextScale === prevScale) return prevScale;
      if (el && clientX !== undefined && clientY !== undefined) {
        const rect = el.getBoundingClientRect();
        const cx = clientX - (rect.left + rect.width / 2);
        const cy = clientY - (rect.top + rect.height / 2);
        const ratio = nextScale / prevScale;
        setOffset((prev) => ({
          x: cx - (cx - prev.x) * ratio,
          y: cy - (cy - prev.y) * ratio,
        }));
      }
      return nextScale;
    });
  }, []);

  // Attach non-passive wheel listener so cursor-anchored zoom prevents page scroll cleanly
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const intensity = e.ctrlKey || e.metaKey ? 0.008 : 0.0018;
      const clampedDelta = Math.max(-240, Math.min(240, e.deltaY));
      const factor = Math.exp(-clampedDelta * intensity);
      zoomAtPoint(factor, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svg, zoomAtPoint]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.button !== 1) return;
      if (e.button === 1) e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: offset.x,
        origY: offset.y,
        moved: false,
      };
      setIsDragging(true);
    },
    [offset.x, offset.y],
  );

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      dragRef.current.moved = true;
    }
    setOffset({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    // Keep dragRef.current.moved readable for the subsequent click event, clear on microtask
    queueMicrotask(() => {
      dragRef.current = null;
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomAtPoint(1.2);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomAtPoint(1 / 1.2);
      } else if (e.key === "0" || e.key === "f" || e.key === "F") {
        e.preventDefault();
        resetView();
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setShowMinimap((v) => !v);
      }
    },
    [zoomAtPoint, resetView],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (dragRef.current?.moved) return;
      const rawTarget = e.target as HTMLElement | null;
      const target = rawTarget?.closest?.(
        "[data-line], [data-line-index], [data-entity-id], [data-bus], [data-edge]",
      ) as HTMLElement | null;
      if (!target) return;
      const rawLine = target.getAttribute("data-line") ?? target.getAttribute("data-line-index");
      const lineNum = rawLine ? Number.parseInt(rawLine, 10) : NaN;
      const validLine = Number.isFinite(lineNum) && lineNum > 0 ? lineNum : undefined;
      const entityId =
        target.getAttribute("data-entity-id") ??
        target.getAttribute("data-id") ??
        target.getAttribute("data-node") ??
        (target.getAttribute("data-bus") ? `bus_${target.getAttribute("data-bus")}` : null) ??
        target.getAttribute("data-edge") ??
        target.getAttribute("id") ??
        undefined;
      const entityKind =
        target.getAttribute("data-entity-kind") ??
        (target.getAttribute("data-bus") ? "bus" : target.getAttribute("data-edge") ? "branch" : undefined);

      if (entityId && onSelectEntity) {
        onSelectEntity({ id: entityId, kind: entityKind, line: validLine });
      }
      if (validLine !== undefined && onRevealLine) {
        onRevealLine(validLine, entityId);
      }
    },
    [onRevealLine, onSelectEntity],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = (e.target as HTMLElement | null)?.closest?.("[data-entity-id], [data-bus], [data-edge]");
      if (!target) {
        resetView();
      }
    },
    [resetView],
  );

  if (!svg) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ms-text-2, #64748b)",
          padding: "24px",
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  const stageBg =
    canvasTheme === "dark"
      ? "#0b0f19"
      : canvasTheme === "light"
        ? "#f8fafc"
        : "var(--ms-bg-inset, var(--ms-bg, #f8fafc))";

  return (
    <div
      ref={stageRef}
      tabIndex={0}
      role="region"
      aria-label="Interactive diagram canvas"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        cursor: isDragging ? "grabbing" : "grab",
        background: stageBg,
        userSelect: "none",
        outline: "none",
      }}
    >
      {/* Interactive SVG transform container */}
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "center center",
          willChange: "transform",
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      {/* Optional top-left HUD extras (e.g. layout mode / filters) */}
      {hudExtra && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: "10px",
            left: "10px",
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "4px 6px",
            borderRadius: "8px",
            background: "var(--ms-surface-glass, rgba(255,255,255,0.88))",
            backdropFilter: "blur(8px)",
            border: "1px solid var(--ms-border, rgba(15,23,42,0.12))",
            boxShadow: "var(--ms-shadow-card, 0 2px 8px rgba(0,0,0,0.08))",
          }}
        >
          {hudExtra}
        </div>
      )}

      {/* Optional Minimap */}
      {showMinimap && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            resetView();
          }}
          title="Click minimap to fit view"
          style={{
            position: "absolute",
            bottom: "52px",
            right: "10px",
            width: "168px",
            height: "110px",
            zIndex: 3,
            borderRadius: "8px",
            overflow: "hidden",
            background: stageBg,
            border: "1px solid var(--ms-border-strong, rgba(148,163,184,0.35))",
            boxShadow: "var(--ms-shadow-card, 0 4px 16px rgba(0,0,0,0.18))",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              opacity: 0.9,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <div
            style={{
              position: "absolute",
              inset: `${Math.max(4, 50 - 50 / scale)}%`,
              border: "1.5px solid var(--ms-brand, #0891b2)",
              background: "var(--ms-brand-soft, rgba(8,145,178,0.14))",
              borderRadius: "2px",
              pointerEvents: "none",
            }}
          />
        </div>
      )}

      {/* Floating Glass Viewport HUD (bottom-right) */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          bottom: "10px",
          right: "10px",
          zIndex: 3,
          display: "flex",
          alignItems: "center",
          gap: "2px",
          padding: "3px",
          borderRadius: "8px",
          background: "var(--ms-surface-glass, rgba(255,255,255,0.9))",
          backdropFilter: "blur(8px)",
          border: "1px solid var(--ms-border, rgba(15,23,42,0.14))",
          boxShadow: "var(--ms-shadow-card, 0 2px 10px rgba(0,0,0,0.12))",
        }}
      >
        <PanelButton
          variant="ghost"
          onClick={() => zoomAtPoint(1 / 1.25)}
          title="Zoom out (-)"
          aria-label="Zoom out"
          style={{ padding: "3px 7px", fontFamily: "var(--ms-font-mono)" }}
        >
          −
        </PanelButton>
        <PanelButton
          variant="ghost"
          onClick={resetView}
          title="Reset zoom to 100% (0)"
          style={{
            padding: "3px 7px",
            minWidth: "46px",
            textAlign: "center",
            fontVariantNumeric: "tabular-nums",
            fontFamily: "var(--ms-font-mono)",
          }}
        >
          {Math.round(scale * 100)}%
        </PanelButton>
        <PanelButton
          variant="ghost"
          onClick={() => zoomAtPoint(1.25)}
          title="Zoom in (+)"
          aria-label="Zoom in"
          style={{ padding: "3px 7px", fontFamily: "var(--ms-font-mono)" }}
        >
          +
        </PanelButton>
        <div style={{ width: "1px", height: "14px", background: "var(--ms-border)", margin: "0 2px" }} />
        <PanelButton
          variant="ghost"
          onClick={resetView}
          title="Fit diagram to viewport (F)"
          style={{ padding: "3px 7px" }}
        >
          Fit
        </PanelButton>
        <PanelButton
          variant={showMinimap ? "primary" : "ghost"}
          onClick={() => setShowMinimap((v) => !v)}
          title="Toggle minimap (M)"
          style={{ padding: "3px 7px" }}
        >
          Map
        </PanelButton>
        {onToggleCanvasTheme && (
          <PanelButton
            variant="ghost"
            onClick={onToggleCanvasTheme}
            title="Toggle schematic canvas theme"
            style={{ padding: "3px 7px" }}
          >
            {canvasTheme === "dark" ? "☀" : "☾"}
          </PanelButton>
        )}
      </div>

      {/* Subtle interaction hint when untouched */}
      <div
        style={{
          position: "absolute",
          bottom: "12px",
          left: "12px",
          zIndex: 2,
          fontSize: "10px",
          color: "var(--ms-text-3, #64748b)",
          background: "var(--ms-surface-glass, rgba(255,255,255,0.75))",
          backdropFilter: "blur(6px)",
          padding: "2px 7px",
          borderRadius: "999px",
          border: "1px solid var(--ms-divider, rgba(15,23,42,0.08))",
          pointerEvents: "none",
        }}
      >
        Scroll to zoom · Drag to pan · Click element to inspect
      </div>
    </div>
  );
};

// ── Shared Data Grid Primitive ──

export interface PanelDataGridColumn<T> {
  key: string;
  label: string;
  align?: "left" | "right" | "center" | undefined;
  mono?: boolean | undefined;
  sortable?: boolean | undefined;
  sortValue?: ((row: T) => string | number) | undefined;
  render: (row: T) => React.ReactNode;
}

export interface PanelDataGridProps<T> {
  rows: T[];
  columns: PanelDataGridColumn<T>[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: ((row: T) => void) | undefined;
  searchable?: boolean | undefined;
  searchPlaceholder?: string | undefined;
  searchFilter?: ((row: T, query: string) => boolean) | undefined;
  pageSize?: number | undefined;
  emptyMessage?: string | undefined;
  toolbarExtra?: React.ReactNode;
}

/**
 * Production-grade data grid primitive for domain panels:
 * sticky headers, interactive column sorting, instant search, pagination (zero silent truncation),
 * tabular-nums alignment, and row click-to-source.
 */
export function PanelDataGrid<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  searchable = true,
  searchPlaceholder = "Filter rows…",
  searchFilter,
  pageSize = 100,
  emptyMessage = "No records found.",
  toolbarExtra,
}: PanelDataGridProps<T>): React.ReactElement {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    if (searchFilter) return rows.filter((r) => searchFilter(r, q));
    return rows.filter((r) => {
      for (const col of columns) {
        const val = col.sortValue ? col.sortValue(r) : (r as Record<string, unknown>)[col.key];
        if (val !== undefined && val !== null && String(val).toLowerCase().includes(q)) {
          return true;
        }
      }
      return false;
    });
  }, [rows, query, searchFilter, columns]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const va = col.sortValue ? col.sortValue(a) : ((a as Record<string, unknown>)[col.key] as string | number);
      const vb = col.sortValue ? col.sortValue(b) : ((b as Record<string, unknown>)[col.key] as string | number);
      let cmp = 0;
      if (typeof va === "number" && typeof vb === "number") {
        cmp = (Number.isFinite(va) ? va : -Infinity) - (Number.isFinite(vb) ? vb : -Infinity);
      } else {
        cmp = String(va ?? "").localeCompare(String(vb ?? ""), undefined, { numeric: true });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const startIdx = safePage * pageSize;
  const pageRows = sorted.slice(startIdx, startIdx + pageSize);

  const handleSort = (col: PanelDataGridColumn<T>) => {
    if (col.sortable === false) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir("asc");
    }
    setPage(0);
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {(searchable || toolbarExtra || sorted.length > pageSize) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            padding: "8px 12px",
            borderBottom: "1px solid var(--ms-divider, rgba(15,23,42,0.08))",
            background: "var(--ms-bg, transparent)",
            flexShrink: 0,
            flexWrap: "wrap",
          }}
        >
          {searchable && (
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              style={{
                flex: "1 1 180px",
                maxWidth: "340px",
                padding: "5px 9px",
                borderRadius: "6px",
                border: "1px solid var(--ms-border)",
                background: "var(--ms-bg-soft)",
                color: "var(--ms-text-1)",
                fontSize: "12px",
                outline: "none",
              }}
            />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
            {toolbarExtra}
            <span style={{ fontSize: "11px", color: "var(--ms-text-2)", fontVariantNumeric: "tabular-nums" }}>
              {sorted.length === 0
                ? "0 rows"
                : `${startIdx + 1}–${Math.min(startIdx + pageSize, sorted.length)} of ${sorted.length}`}
            </span>
            {totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <PanelButton disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  Prev
                </PanelButton>
                <PanelButton
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                >
                  Next
                </PanelButton>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {pageRows.length === 0 ? (
          <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--ms-text-2)" }}>{emptyMessage}</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11.5px" }}>
            <thead>
              <tr
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  background: "var(--ms-bg-alt, #f6f8fa)",
                  borderBottom: "1px solid var(--ms-border)",
                  color: "var(--ms-text-2)",
                }}
              >
                {columns.map((col) => {
                  const isSorted = sortKey === col.key;
                  const canSort = col.sortable !== false;
                  return (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col)}
                      style={{
                        padding: "6px 10px",
                        textAlign: col.align ?? "left",
                        fontWeight: 600,
                        fontSize: "10.5px",
                        textTransform: "uppercase",
                        letterSpacing: "0.03em",
                        whiteSpace: "nowrap",
                        cursor: canSort ? "pointer" : "default",
                        userSelect: "none",
                      }}
                    >
                      {col.label}
                      {isSorted && <span style={{ marginLeft: "4px" }}>{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, idx) => (
                <tr
                  key={rowKey(row, startIdx + idx)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{
                    borderBottom: "1px solid var(--ms-divider)",
                    cursor: onRowClick ? "pointer" : "default",
                  }}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      style={{
                        padding: "5px 10px",
                        textAlign: col.align ?? "left",
                        fontFamily: col.mono ? "var(--ms-font-mono)" : "var(--ms-font-sans)",
                        fontVariantNumeric: col.mono ? "tabular-nums" : undefined,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
