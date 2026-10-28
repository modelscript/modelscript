// SPDX-License-Identifier: AGPL-3.0-or-later

import styled, { keyframes } from "styled-components";
import type { DomainType } from "./types";

export const threadFlow = keyframes`
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`;

export const ExplorerContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
`;

export const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
`;

export const MetricCard = styled.div`
  background: var(--color-canvas-subtle, rgba(22, 27, 34, 0.7));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 12px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--color-accent-emphasis, #0969da);
    transform: translateY(-1px);
  }
`;

export const MetricValue = styled.div`
  font-size: 26px;
  font-weight: 700;
  color: var(--color-fg-default, #c9d1d9);
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const MetricLabel = styled.div`
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-fg-muted, #8b949e);
`;

export const ControlsBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

export const FilterPillGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

export const FilterPill = styled.button<{ $active: boolean; $color?: string | undefined }>`
  border: 1px solid
    ${(props) =>
      props.$active ? props.$color || "var(--color-accent-emphasis, #0969da)" : "var(--color-border-default, #30363d)"};
  background: ${(props) =>
    props.$active
      ? props.$color
        ? `${props.$color}25`
        : "var(--color-accent-subtle, rgba(56, 139, 253, 0.15))"
      : "var(--color-canvas-subtle, #161b22)"};
  color: ${(props) => (props.$active ? "var(--color-fg-default, #f0f6fc)" : "var(--color-fg-muted, #8b949e)")};
  border-radius: 20px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: ${(props) => (props.$active ? 600 : 400)};
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;

  &:hover {
    border-color: ${(props) => props.$color || "var(--color-accent-emphasis, #0969da)"};
    color: var(--color-fg-default, #f0f6fc);
  }
`;

export const TwinCard = styled.div`
  background: var(--color-canvas-subtle, rgba(22, 27, 34, 0.8));
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 14px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    border-color: rgba(6, 182, 212, 0.5);
    box-shadow:
      0 8px 24px -4px rgba(0, 0, 0, 0.4),
      0 0 16px rgba(6, 182, 212, 0.15);
  }
`;

export const TwinHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

export const ThreadVisualizer = styled.div`
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--color-canvas-default, #0d1117);
  border-radius: 10px;
  border: 1px solid var(--color-border-subtle, #21262d);

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 12px;
  }
`;

export const NodeBox = styled.div<{ $domain: DomainType }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
`;

export const DomainTag = styled.div<{ $domain: DomainType }>`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: ${(props) => {
    switch (props.$domain) {
      case "modelica":
        return "#38bdf8";
      case "sysml2":
        return "#a855f7";
      case "cad":
      case "scad":
        return "#fbbf24";
      case "fea":
        return "#f97316";
      case "cfd":
        return "#06b6d4";
      case "dataset":
        return "#34d399";
      default:
        return "var(--color-fg-muted, #8b949e)";
    }
  }};
`;

export const NodeTitle = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: var(--color-fg-default, #c9d1d9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, monospace);
`;

export const NodeSub = styled.div`
  font-size: 12px;
  color: var(--color-fg-muted, #8b949e);
  display: flex;
  align-items: center;
  gap: 6px;
`;

export const ConnectorLine = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  position: relative;
  padding: 0 8px;

  &::before {
    content: "";
    height: 2px;
    width: 60px;
    background: linear-gradient(90deg, #38bdf8, #a855f7, #fbbf24);
    background-size: 200% 200%;
    animation: ${threadFlow} 3s ease infinite;
    border-radius: 2px;
  }

  @media (max-width: 768px) {
    &::before {
      width: 2px;
      height: 24px;
    }
  }
`;

export const ParityChip = styled.div<{ $status: "compatible" | "warning" | "incompatible" }>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid
    ${(props) => {
      switch (props.$status) {
        case "compatible":
          return "rgba(46, 160, 67, 0.4)";
        case "warning":
          return "rgba(217, 119, 6, 0.4)";
        case "incompatible":
          return "rgba(248, 81, 73, 0.4)";
      }
    }};
  background: ${(props) => {
    switch (props.$status) {
      case "compatible":
        return "rgba(46, 160, 67, 0.12)";
      case "warning":
        return "rgba(217, 119, 6, 0.12)";
      case "incompatible":
        return "rgba(248, 81, 73, 0.12)";
    }
  }};
  color: ${(props) => {
    switch (props.$status) {
      case "compatible":
        return "var(--ms-success)";
      case "warning":
        return "#d29922";
      case "incompatible":
        return "var(--ms-danger)";
    }
  }};
`;

export const ActionsRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 1px solid var(--color-border-subtle, #21262d);
`;
