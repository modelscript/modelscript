// SPDX-License-Identifier: AGPL-3.0-or-later

import styled, { keyframes } from "styled-components";

const fadeIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

export const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(6, 10, 19, 0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
`;

export const ModalCard = styled.div`
  background: var(--color-canvas-default, #0d1117);
  color: var(--color-fg-default, #e6edf3);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 18px;
  width: 100%;
  max-width: 960px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow:
    0 24px 72px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(139, 92, 246, 0.14);
  overflow: hidden;
  animation: ${fadeIn} 0.18s cubic-bezier(0.16, 1, 0.3, 1);
`;

export const ModalHeader = styled.div`
  padding: 16px 24px;
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--color-canvas-subtle, #161b22);
`;

export const BoundArtifactBar = styled.div`
  padding: 10px 24px;
  border-bottom: 1px solid var(--color-border-default, #30363d);
  background: linear-gradient(
    90deg,
    rgba(6, 182, 212, 0.08) 0%,
    rgba(139, 92, 246, 0.08) 50%,
    rgba(6, 182, 212, 0.04) 100%
  );
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
`;

export const WizardStepperBar = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  background: var(--color-canvas-subtle, #161b22);

  @media (max-width: 680px) {
    grid-template-columns: repeat(2, 1fr);
  }
`;

export const WizardStepTab = styled.button<{ $active: boolean; $completed: boolean }>`
  background: ${(props) =>
    props.$active
      ? "linear-gradient(180deg, rgba(139, 92, 246, 0.12) 0%, rgba(6, 182, 212, 0.06) 100%)"
      : "transparent"};
  border: none;
  border-bottom: 2.5px solid
    ${(props) =>
      props.$active
        ? "var(--color-accent-purple, #8b5cf6)"
        : props.$completed
          ? "rgba(16, 185, 129, 0.45)"
          : "transparent"};
  border-right: 1px solid var(--color-border-muted, rgba(128, 128, 128, 0.15));
  padding: 11px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  text-align: left;
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  transition: all 0.15s ease;

  &:last-child {
    border-right: none;
  }

  &:hover {
    background: var(--color-neutral-muted, rgba(128, 128, 128, 0.08));
    color: var(--color-fg-default);
  }
`;

export const StepCircle = styled.span<{ $active: boolean; $completed: boolean }>`
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  flex-shrink: 0;
  background: ${(props) =>
    props.$active
      ? "linear-gradient(135deg, #06b6d4, #8b5cf6)"
      : props.$completed
        ? "rgba(16, 185, 129, 0.18)"
        : "var(--color-neutral-muted, rgba(128, 128, 128, 0.15))"};
  color: ${(props) => (props.$active ? "#ffffff" : props.$completed ? "#10b981" : "var(--color-fg-muted)")};
  border: 1px solid
    ${(props) =>
      props.$active ? "transparent" : props.$completed ? "rgba(16, 185, 129, 0.4)" : "var(--color-border-default)"};
`;

export const ModalBody = styled.div`
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: var(--color-canvas-default, #0d1117);
`;

export const ModalFooter = styled.div`
  padding: 14px 24px;
  border-top: 1px solid var(--color-border-default, #30363d);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  background: var(--color-canvas-subtle, #161b22);
`;

export const GalleryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 12px;
`;

export const TemplateCard = styled.div<{ $selected: boolean; $accent: string }>`
  position: relative;
  border: 1.5px solid ${(props) => (props.$selected ? props.$accent : "var(--color-border-default, #30363d)")};
  background: ${(props) =>
    props.$selected
      ? `linear-gradient(180deg, ${props.$accent}14 0%, var(--color-canvas-subtle, #161b22) 100%)`
      : "var(--color-canvas-subtle, #161b22)"};
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  overflow: hidden;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: ${(props) => props.$accent};
    opacity: ${(props) => (props.$selected ? 1 : 0.45)};
  }

  &:hover {
    border-color: ${(props) => props.$accent};
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  }
`;

export const CategoryPill = styled.button<{ $active: boolean }>`
  background: ${(props) =>
    props.$active ? "linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)" : "var(--color-canvas-subtle, #161b22)"};
  color: ${(props) => (props.$active ? "#ffffff" : "var(--color-fg-default)")};
  border: 1px solid ${(props) => (props.$active ? "transparent" : "var(--color-border-default, #30363d)")};
  border-radius: 9999px;
  padding: 5px 13px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--color-accent-purple, #8b5cf6);
  }
`;

export const PresetGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

export const PresetCard = styled.div<{ $selected: boolean }>`
  border: 1.5px solid
    ${(props) => (props.$selected ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-border-default, #30363d)")};
  background: ${(props) => (props.$selected ? "rgba(6, 182, 212, 0.1)" : "var(--color-canvas-subtle, #161b22)")};
  border-radius: 10px;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 4px;

  &:hover {
    border-color: var(--color-accent-cyan, #06b6d4);
  }
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
  border: 1.5px solid
    ${(props) => (props.$selected ? "var(--color-accent-purple, #8b5cf6)" : "var(--color-border-default, #30363d)")};
  background: ${(props) => (props.$selected ? "rgba(139, 92, 246, 0.1)" : "var(--color-canvas-subtle, #161b22)")};
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  transition: all 0.15s ease-in-out;
  display: flex;
  flex-direction: column;
  gap: 6px;

  &:hover {
    border-color: var(--color-accent-purple, #8b5cf6);
  }
`;

export const StyledInput = styled.input`
  width: 100%;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default, #30363d);
  background: var(--color-canvas-subtle, #161b22);
  color: var(--color-fg-default, #e6edf3);
  font-size: 13px;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s ease;

  &:focus {
    border-color: var(--color-accent-cyan, #06b6d4);
    box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.18);
  }
`;

export const StyledSelect = styled.select`
  width: 100%;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default, #30363d);
  background: var(--color-canvas-subtle, #161b22);
  color: var(--color-fg-default, #e6edf3);
  font-size: 13px;
  box-sizing: border-box;
  outline: none;
  cursor: pointer;

  &:focus {
    border-color: var(--color-accent-cyan, #06b6d4);
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
          : "var(--color-canvas-subtle, #161b22)"};
  border: 1px solid
    ${(props) =>
      props.$state === "active"
        ? "var(--color-accent-cyan, #06b6d4)"
        : props.$state === "done"
          ? "#10b981"
          : props.$state === "error"
            ? "#ef4444"
            : "var(--color-border-default, #30363d)"};
  color: var(--color-fg-default);
  font-size: 13px;
`;

export const StatCard = styled.div`
  background: var(--color-canvas-subtle, #161b22);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 10px;
  padding: 12px;
  flex: 1;
  text-align: center;
`;

export const TableWrap = styled.div`
  max-height: 220px;
  overflow: auto;
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 8px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  background: var(--color-canvas-subtle, #161b22);

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th {
    background: var(--color-canvas-default, #0d1117);
    position: sticky;
    top: 0;
    padding: 7px 10px;
    text-align: left;
    border-bottom: 1px solid var(--color-border-default, #30363d);
    color: var(--color-fg-default);
    font-weight: 700;
  }

  td {
    padding: 5px 10px;
    border-bottom: 1px solid var(--color-border-muted, rgba(128, 128, 128, 0.15));
    color: var(--color-fg-muted);
    white-space: nowrap;
  }
`;
