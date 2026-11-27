// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";

export type ComplianceTone = "success" | "danger" | "warning" | "brand";

const TONE_BG: Record<ComplianceTone, string> = {
  success: "var(--ms-success-emphasis, var(--color-success-emphasis, #238636))",
  danger: "var(--ms-danger-emphasis, var(--color-danger-emphasis, #da3633))",
  warning: "var(--ms-warning-emphasis, var(--color-attention-emphasis, #9a6700))",
  brand: "var(--ms-brand, #0969da)",
};

export interface CardContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  isDark: boolean;
}

export const CardContainer: React.FC<CardContainerProps> = ({ isDark, style, children, ...rest }) => (
  <div
    {...rest}
    style={{
      border: `1px solid var(--ms-border, var(--color-border-default, ${isDark ? "#30363d" : "#d0d7de"}))`,
      borderRadius: 10,
      background: `var(--ms-bg-inset, var(--bgColor-inset, ${isDark ? "#121214" : "#f6f8fa"}))`,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      padding: 16,
      fontFamily: "inherit",
      marginTop: 8,
      ...style,
    }}
  >
    {children}
  </div>
);

export const HeaderRow: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ style, children, ...rest }) => (
  <div
    {...rest}
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 12,
      ...style,
    }}
  >
    {children}
  </div>
);

export const TitleGroup: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ style, children, ...rest }) => (
  <div
    {...rest}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      ...style,
    }}
  >
    {children}
  </div>
);

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: ComplianceTone;
}

export const StatusPill: React.FC<StatusPillProps> = ({ tone, style, children, ...rest }) => (
  <span
    {...rest}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "3px 10px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: "0.5px",
      textTransform: "uppercase",
      color: "#ffffff",
      background: TONE_BG[tone],
      ...style,
    }}
  >
    {children}
  </span>
);

export const ActionButtons: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ style, children, ...rest }) => (
  <div
    {...rest}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      ...style,
    }}
  >
    {children}
  </div>
);

export interface ActionBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isDark?: boolean | undefined;
  compact?: boolean | undefined;
}

export const ActionBtn: React.FC<ActionBtnProps> = ({
  isDark = true,
  compact = false,
  style,
  onMouseEnter,
  onMouseLeave,
  children,
  ...rest
}) => {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      {...rest}
      onMouseEnter={(e) => {
        setHovered(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setHovered(false);
        onMouseLeave?.(e);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: compact ? "4px 10px" : "5px 12px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: compact ? 500 : 600,
        border: `1px solid var(--ms-border, var(--color-border-default, ${isDark ? "#30363d" : "#d0d7de"}))`,
        background: hovered
          ? `var(--ms-bg-hover, var(--color-canvas-subtle, ${isDark ? "#21262d" : "#f6f8fa"}))`
          : `var(--ms-bg-elv, var(--bgColor-muted, ${isDark ? "#1e1e22" : "#ffffff"}))`,
        color: `var(--ms-text, var(--color-fg-default, ${isDark ? "#c9d1d9" : "#24292f"}))`,
        cursor: "pointer",
        transition: "background 0.15s ease",
        ...style,
      }}
    >
      {children}
    </button>
  );
};

export const MetricGrid: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ style, children, ...rest }) => (
  <div
    {...rest}
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
      gap: 10,
      ...style,
    }}
  >
    {children}
  </div>
);

export interface MetricTileProps extends React.HTMLAttributes<HTMLDivElement> {
  isDark: boolean;
  alert?: boolean | undefined;
}

export const MetricTile: React.FC<MetricTileProps> = ({ isDark, alert = false, style, children, ...rest }) => (
  <div
    {...rest}
    style={{
      background: `var(--ms-bg-elv, var(--bgColor-muted, ${isDark ? "#1e1e22" : "#ffffff"}))`,
      border: `1px solid ${
        alert
          ? "var(--ms-danger-emphasis, var(--color-danger-emphasis, #da3633))"
          : `var(--ms-border-subtle, var(--color-border-subtle, ${isDark ? "#30363d" : "#eaecef"}))`
      }`,
      borderRadius: 8,
      padding: "10px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      ...style,
    }}
  >
    {children}
  </div>
);

export const MetricLabel: React.FC<React.HTMLAttributes<HTMLSpanElement>> = ({ style, children, ...rest }) => (
  <span
    {...rest}
    style={{
      fontSize: 11,
      color: "var(--ms-text-2, var(--color-fg-muted, #57606a))",
      textTransform: "uppercase",
      fontWeight: 600,
      letterSpacing: "0.5px",
      ...style,
    }}
  >
    {children}
  </span>
);

export interface MetricValueProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: string | undefined;
}

export const MetricValue: React.FC<MetricValueProps> = ({ color, style, children, ...rest }) => (
  <span
    {...rest}
    style={{
      fontSize: 18,
      fontWeight: 700,
      color: color || "var(--ms-text, var(--color-fg-default, #24292f))",
      display: "flex",
      alignItems: "baseline",
      gap: 4,
      ...style,
    }}
  >
    {children}
  </span>
);

export const MetricSub: React.FC<React.HTMLAttributes<HTMLSpanElement>> = ({ style, children, ...rest }) => (
  <span
    {...rest}
    style={{
      fontSize: 11,
      color: "var(--ms-text-2, var(--color-fg-muted, #57606a))",
      ...style,
    }}
  >
    {children}
  </span>
);

export interface ExpandableRowProps extends React.HTMLAttributes<HTMLDivElement> {
  status: "PASS" | "FAIL" | "WARN";
}

export const ExpandableRow: React.FC<ExpandableRowProps> = ({ status, style, children, ...rest }) => (
  <div
    {...rest}
    style={{
      display: "flex",
      flexDirection: "column",
      border: `1px solid ${
        status === "FAIL"
          ? "rgba(218, 54, 51, 0.4)"
          : "var(--ms-border-subtle, var(--color-border-subtle, rgba(255, 255, 255, 0.08)))"
      }`,
      borderRadius: 6,
      background: "var(--ms-bg-elv, var(--bgColor-muted, #1e1e22))",
      overflow: "hidden",
      transition: "border-color 0.15s ease",
      ...style,
    }}
  >
    {children}
  </div>
);

export interface ExpandableHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverBackground?: string | undefined;
}

export const ExpandableHeader: React.FC<ExpandableHeaderProps> = ({
  hoverBackground = "var(--ms-bg-hover, var(--color-canvas-subtle, rgba(255, 255, 255, 0.03)))",
  style,
  onMouseEnter,
  onMouseLeave,
  children,
  ...rest
}) => {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      {...rest}
      onMouseEnter={(e) => {
        setHovered(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setHovered(false);
        onMouseLeave?.(e);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        cursor: "pointer",
        userSelect: "none",
        background: hovered ? hoverBackground : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export interface StackedBarSegmentProps extends React.HTMLAttributes<HTMLDivElement> {
  pct: number;
  color: string;
}

export const StackedBarSegment: React.FC<StackedBarSegmentProps> = ({ pct, color, style, ...rest }) => (
  <div
    {...rest}
    style={{
      width: `${Math.max(0, Math.min(100, pct))}%`,
      background: color,
      transition: "width 0.3s ease",
      ...style,
    }}
  />
);
