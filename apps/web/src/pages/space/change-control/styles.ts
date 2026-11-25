// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

// ── Primer-Style Layout Styled Components ─────────────────────────────────────

export const SpaceCockpitGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  box-sizing: border-box;
`;

export const MasterDetailGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
`;

export const SpaceInspectorPanel = styled.aside`
  display: flex;
  flex-direction: column;
  gap: 20px;
  position: sticky;
  top: 24px;
`;

export const SpaceCardPanel = styled.div`
  border-radius: 6px;
  border: 1px solid var(--color-border-default, var(--color-border));
  background: var(--color-canvas-default, var(--color-bg-primary));
  display: flex;
  flex-direction: column;
`;

export const PrSplitLayout = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 290px;
  gap: 28px;
  align-items: start;
  width: 100%;
  box-sizing: border-box;

  @media (max-width: 1120px) {
    grid-template-columns: 1fr;
  }
`;

export const PrTableRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-default);
  background: var(--color-canvas-default);
  cursor: pointer;
  transition: background 0.12s ease;
  gap: 20px;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: var(--ms-surface-hover, var(--color-canvas-subtle));
  }
`;

export const PrSectionCard = styled.section`
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-canvas-default);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
`;

export const PrSectionHeader = styled.div`
  padding: 14px 20px;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

export const MergeBox = styled.div<{ $state: "can_merge" | "blocked" | "merged" }>`
  padding: 22px 24px;
  border-radius: 6px;
  border: 1px solid
    ${(props) =>
      props.$state === "merged"
        ? "color-mix(in srgb, #8250df 35%, transparent)"
        : props.$state === "can_merge"
          ? "var(--color-success-emphasis, #238636)"
          : "var(--color-border-default)"};
  border-left: 6px solid
    ${(props) =>
      props.$state === "merged"
        ? "#8250df"
        : props.$state === "can_merge"
          ? "var(--color-success-emphasis, #238636)"
          : "var(--color-border-default)"};
  background: ${(props) =>
    props.$state === "merged"
      ? "color-mix(in srgb, #8250df 5%, transparent)"
      : props.$state === "can_merge"
        ? "var(--ms-surface-selected, rgba(35, 134, 54, 0.04))"
        : "var(--color-canvas-subtle)"};
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

export const TimelineConnector = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding-left: 36px;

  &::before {
    content: "";
    position: absolute;
    left: 15px;
    top: 10px;
    bottom: 10px;
    width: 2px;
    background: var(--color-border-muted, var(--color-border-default));
  }
`;

export const TimelineNode = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const TimelineNodeIcon = styled.div<{ $color?: string; $bg?: string }>`
  position: absolute;
  left: -36px;
  top: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: ${(props) => props.$bg || "var(--color-canvas-default)"};
  border: 2px solid ${(props) => props.$color || "var(--color-border-default)"};
  color: ${(props) => props.$color || "var(--color-fg-muted)"};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  z-index: 2;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
`;
