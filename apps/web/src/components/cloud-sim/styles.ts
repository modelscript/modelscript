// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
`;

export const ModalCard = styled.div`
  background: var(--surface-overlay, rgba(14, 20, 36, 0.95));
  backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-glass);
  border-radius: 16px;
  width: 100%;
  max-width: 760px;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  overflow: hidden;
`;

export const ModalHeader = styled.div`
  padding: 18px 24px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface-hud, rgba(14, 20, 36, 0.85));
`;

export const ModalBody = styled.div`
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

export const ProfileGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

export const ProfileCard = styled.div<{ $selected: boolean }>`
  border: 1px solid ${(props) => (props.$selected ? "var(--color-accent-purple)" : "var(--color-border)")};
  background: ${(props) => (props.$selected ? "rgba(139, 92, 246, 0.12)" : "rgba(255, 255, 255, 0.02)")};
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  transition: all 0.15s ease-in-out;
  display: flex;
  flex-direction: column;
  gap: 6px;

  &:hover {
    border-color: var(--color-accent-purple);
  }
`;

export const StepItem = styled.div<{ $state: "waiting" | "active" | "done" | "error" }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  background: ${(props) =>
    props.$state === "active"
      ? "rgba(6, 182, 212, 0.12)"
      : props.$state === "done"
        ? "rgba(16, 185, 129, 0.12)"
        : props.$state === "error"
          ? "rgba(244, 63, 94, 0.12)"
          : "rgba(255, 255, 255, 0.02)"};
  border: 1px solid
    ${(props) =>
      props.$state === "active"
        ? "var(--color-accent-cyan)"
        : props.$state === "done"
          ? "var(--color-status-verified)"
          : props.$state === "error"
            ? "var(--color-error)"
            : "var(--color-border)"};
  font-size: 13px;
`;

export const StatCard = styled.div`
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
  flex: 1;
  text-align: center;
`;

export const TableWrap = styled.div`
  max-height: 220px;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 12px;

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th {
    background: rgba(255, 255, 255, 0.05);
    position: sticky;
    top: 0;
    padding: 6px 10px;
    text-align: left;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text-primary);
  }

  td {
    padding: 4px 10px;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text-muted);
    white-space: nowrap;
  }
`;
