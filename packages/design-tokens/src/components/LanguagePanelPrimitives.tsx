// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useRef, useState } from "react";
import type { LanguagePanelMode } from "../panel-contract.js";

export interface PanelShellProps {
  mode: LanguagePanelMode;
  colorMode: "dark" | "light";
  isFullScreen?: boolean | undefined;
  children: React.ReactNode;
}

/**
 * Root container for decentralized language panels.
 * Uses --ms-* design tokens so it renders natively in VS Code webviews, Morsel, and Ansatz.
 */
export const PanelShell: React.FC<PanelShellProps> = ({ mode, colorMode, isFullScreen = false, children }) => {
  const isArtifactCard = mode === "artifact" && !isFullScreen;
  return (
    <div
      data-theme={colorMode}
      data-ms-panel-mode={mode}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: isArtifactCard ? "480px" : "100%",
        minHeight: isArtifactCard ? "360px" : "100%",
        background: "var(--ms-bg, #0f172a)",
        color: "var(--ms-text-1, #e2e8f0)",
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
    fg: "var(--ms-text-2, #94a3b8)",
    border: "var(--ms-border, rgba(148,163,184,0.25))",
  },
  success: {
    bg: "var(--ms-status-pass-bg, rgba(16,185,129,0.14))",
    fg: "var(--ms-status-pass-fg, #10b981)",
    border: "var(--ms-status-pass-border, rgba(16,185,129,0.35))",
  },
  warning: {
    bg: "var(--ms-status-warn-bg, rgba(245,158,11,0.14))",
    fg: "var(--ms-status-warn-fg, #f59e0b)",
    border: "var(--ms-status-warn-border, rgba(245,158,11,0.35))",
  },
  danger: {
    bg: "var(--ms-status-fail-bg, rgba(244,63,94,0.14))",
    fg: "var(--ms-status-fail-fg, #f43f5e)",
    border: "var(--ms-status-fail-border, rgba(244,63,94,0.35))",
  },
  info: {
    bg: "var(--ms-status-info-bg, rgba(6,182,212,0.14))",
    fg: "var(--ms-status-info-fg, #06b6d4)",
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
        padding: "8px 12px",
        background: "var(--ms-bg-alt, rgba(15,23,42,0.6))",
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
            color: "var(--ms-text-heading, var(--ms-text-1))",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </span>
        {subtitle && (
          <span style={{ fontSize: "11px", color: "var(--ms-text-2, #94a3b8)", whiteSpace: "nowrap" }}>{subtitle}</span>
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
}

export function PanelTabBar<T extends string = string>({
  tabs,
  activeTab,
  onSelect,
}: PanelTabBarProps<T>): React.ReactElement {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "2px",
        padding: "0 10px",
        background: "var(--ms-bg-alt, rgba(15,23,42,0.5))",
        borderBottom: "1px solid var(--ms-border, rgba(148,163,184,0.2))",
        overflowX: "auto",
        flexShrink: 0,
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
              color: active ? "var(--ms-text-heading, var(--ms-text-1))" : "var(--ms-text-2, #94a3b8)",
              fontWeight: active ? 600 : 500,
              fontSize: "12px",
              padding: "7px 10px",
              cursor: "pointer",
              whiteSpace: "nowrap",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                style={{
                  fontSize: "10px",
                  padding: "0 5px",
                  borderRadius: "999px",
                  background: "var(--ms-bg-soft, rgba(148,163,184,0.16))",
                  color: "var(--ms-text-2, #94a3b8)",
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface PanelKpiItem {
  label: string;
  value: string | number;
  unit?: string | undefined;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | undefined;
}

export const PanelKpiStrip: React.FC<{ items: PanelKpiItem[] }> = ({ items }) => {
  if (items.length === 0) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(110px, 1fr))`,
        gap: "8px",
        padding: "8px 12px",
        borderBottom: "1px solid var(--ms-border, rgba(148,163,184,0.2))",
        background: "var(--ms-bg, transparent)",
        flexShrink: 0,
      }}
    >
      {items.map((item) => {
        const toneColor =
          item.tone === "success"
            ? "var(--ms-success, #10b981)"
            : item.tone === "warning"
              ? "var(--ms-warning, #f59e0b)"
              : item.tone === "danger"
                ? "var(--ms-danger, #f43f5e)"
                : item.tone === "info"
                  ? "var(--ms-info, #06b6d4)"
                  : "var(--ms-text-heading, var(--ms-text-1))";
        return (
          <div
            key={item.label}
            style={{
              padding: "6px 8px",
              borderRadius: "6px",
              background: "var(--ms-bg-alt, rgba(148,163,184,0.08))",
              border: "1px solid var(--ms-border, rgba(148,163,184,0.16))",
            }}
          >
            <div style={{ fontSize: "10px", color: "var(--ms-text-2, #94a3b8)", textTransform: "uppercase" }}>
              {item.label}
            </div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: toneColor, marginTop: "2px" }}>
              {item.value}
              {item.unit && (
                <span style={{ fontSize: "10px", fontWeight: 500, marginLeft: "3px", color: "var(--ms-text-2)" }}>
                  {item.unit}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export interface PanelButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | undefined;
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
      borderRadius: "5px",
      cursor: props.disabled ? "not-allowed" : "pointer",
      opacity: props.disabled ? 0.5 : 1,
      background: variant === "primary" ? "var(--ms-brand, #0e7490)" : "var(--ms-bg-soft, rgba(148,163,184,0.12))",
      color: variant === "primary" ? "var(--ms-brand-contrast, #ffffff)" : "var(--ms-text-1, #e2e8f0)",
      border:
        variant === "primary"
          ? "1px solid var(--ms-brand, #0e7490)"
          : "1px solid var(--ms-border, rgba(148,163,184,0.22))",
      ...style,
    }}
  />
);

export interface PanelSvgStageProps {
  svg: string;
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
  emptyMessage?: string | undefined;
}

/**
 * Interactive pan/zoom SVG viewport for language diagram/plot panels.
 * Works identically inside VS Code webviews (CSP-safe) and Vite web apps.
 */
export const PanelSvgStage: React.FC<PanelSvgStageProps> = ({
  svg,
  onRevealLine,
  emptyMessage = "No visual output available.",
}) => {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    setScale((s) => Math.max(0.25, Math.min(6, s * factor)));
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      dragRef.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
    },
    [offset.x, offset.y],
  );

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onRevealLine) return;
      const target = (e.target as HTMLElement | null)?.closest?.(
        "[data-line], [data-line-index]",
      ) as HTMLElement | null;
      if (!target) return;
      const rawLine = target.getAttribute("data-line") ?? target.getAttribute("data-line-index");
      const lineNum = rawLine ? Number.parseInt(rawLine, 10) : NaN;
      if (Number.isFinite(lineNum) && lineNum > 0) {
        onRevealLine(lineNum, target.getAttribute("data-id") ?? target.getAttribute("data-node") ?? undefined);
      }
    },
    [onRevealLine],
  );

  if (!svg) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ms-text-2, #94a3b8)",
          padding: "24px",
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleClick}
      style={{
        position: "relative",
        flex: 1,
        overflow: "hidden",
        cursor: "grab",
        background: "var(--ms-bg, #0f172a)",
        userSelect: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "8px",
          right: "8px",
          zIndex: 2,
          display: "flex",
          gap: "4px",
        }}
      >
        <PanelButton onClick={() => setScale((s) => Math.min(6, s * 1.2))} title="Zoom in">
          +
        </PanelButton>
        <PanelButton onClick={() => setScale((s) => Math.max(0.25, s / 1.2))} title="Zoom out">
          -
        </PanelButton>
        <PanelButton
          onClick={() => {
            setScale(1);
            setOffset({ x: 0, y: 0 });
          }}
          title="Reset view"
        >
          {Math.round(scale * 100)}%
        </PanelButton>
      </div>
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "center center",
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
};
