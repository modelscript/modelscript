// SPDX-License-Identifier: AGPL-3.0-or-later

import styledImport from "styled-components";

const styled: typeof styledImport = (styledImport as any).default ?? styledImport;

export const AdminContainer = styled.div`
  display: flex;
  width: 100%;
  height: 100%;
  min-height: calc(100vh - var(--dev-header-height, 0px));

  @media (max-width: 900px) {
    flex-direction: column;
  }
`;

export const MenuColumn = styled.div<{ $hideOnMobile?: boolean | undefined }>`
  flex: 0 0 260px;
  border-right: 1px solid var(--color-border-default);
  display: flex;
  flex-direction: column;

  @media (max-width: 900px) {
    flex: 0 0 auto;
    display: ${(props) => (props.$hideOnMobile ? "none" : "flex")};
    border-right: none;
    border-bottom: 1px solid var(--color-border-default);
  }
`;

export const DetailColumn = styled.div<{ $hideOnMobile?: boolean | undefined }>`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;

  @media (max-width: 900px) {
    display: ${(props) => (props.$hideOnMobile ? "none" : "flex")};
  }
`;

export const StatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
`;

export const StatCard = styled.div`
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export const Header = styled.div`
  padding: 0 16px;
  min-height: 53px;
  font-size: var(--text-xl, 20px);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-text-heading);
  display: flex;
  align-items: center;
  gap: 12px;
  position: sticky;
  top: var(--dev-header-height, 0px);
  background: var(--surface-sticky);
  backdrop-filter: var(--backdrop-sticky);
  -webkit-backdrop-filter: var(--backdrop-sticky);
  transition: background-color 0.25s ease;
  border-bottom: 1px solid var(--color-border);
  z-index: 50;
`;

export const TabButton = styled.button<{ $active?: boolean | undefined }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  background-color: ${(props) => (props.$active ? "rgba(139, 92, 246, 0.12)" : "transparent")};
  border: none;
  border-right: ${(props) => (props.$active ? "3px solid var(--color-accent-purple)" : "3px solid transparent")};
  cursor: pointer;
  text-align: left;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  color: ${(props) => (props.$active ? "var(--color-text-primary)" : "var(--color-text-secondary)")};

  &:hover {
    background-color: rgba(255, 255, 255, 0.04);
    color: var(--color-text-primary);
  }

  span {
    font-size: 14px;
    font-weight: ${(props) => (props.$active ? "600" : "500")};
  }

  @media (max-width: 900px) {
    padding: 10px 14px;
    border-right: none;
    border-bottom: ${(props) => (props.$active ? "3px solid var(--color-accent-purple)" : "3px solid transparent")};
    white-space: nowrap;
  }
`;

export const Card = styled.div`
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  padding: 16px 20px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const Badge = styled.span<{
  $variant?: "success" | "warning" | "danger" | "neutral" | "approved" | "rejected" | "pending" | undefined;
}>`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: ${(props) => {
    switch (props.$variant) {
      case "success":
      case "approved":
        return "rgba(35, 134, 54, 0.2)";
      case "warning":
      case "pending":
        return "rgba(210, 153, 34, 0.2)";
      case "danger":
      case "rejected":
        return "rgba(218, 54, 51, 0.2)";
      default:
        return "rgba(255, 255, 255, 0.08)";
    }
  }};
  color: ${(props) => {
    switch (props.$variant) {
      case "success":
      case "approved":
        return "var(--ms-success)";
      case "warning":
      case "pending":
        return "#d29922";
      case "danger":
      case "rejected":
        return "var(--ms-danger)";
      default:
        return "var(--color-text-muted)";
    }
  }};
`;

export const ActionButton = styled.button<{ $variant?: "primary" | "danger" | "secondary" | undefined }>`
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid
    ${(props) =>
      props.$variant === "danger"
        ? "rgba(218, 54, 51, 0.5)"
        : props.$variant === "primary"
          ? "rgba(139, 92, 246, 0.5)"
          : "var(--color-border-default)"};
  background: ${(props) =>
    props.$variant === "danger"
      ? "rgba(218, 54, 51, 0.15)"
      : props.$variant === "primary"
        ? "var(--gradient-cta)"
        : "rgba(255, 255, 255, 0.05)"};
  color: ${(props) => (props.$variant === "danger" ? "var(--ms-danger)" : "var(--color-text-primary)")};
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    opacity: 0.95;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const FilterPill = styled.button<{ $active?: boolean | undefined }>`
  background: ${(props) => (props.$active ? "var(--color-accent-purple)" : "rgba(255, 255, 255, 0.05)")};
  color: ${(props) => (props.$active ? "#ffffff" : "var(--color-text-muted)")};
  border: 1px solid ${(props) => (props.$active ? "transparent" : "var(--color-border-default)")};
  border-radius: 16px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-text-primary);
  }
`;

export const Input = styled.input`
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;

  &:focus {
    border-color: var(--color-accent-purple);
  }
`;

export const Select = styled.select`
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;

  &:focus {
    border-color: var(--color-accent-purple);
  }
`;

export const Textarea = styled.textarea`
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
  min-height: 70px;
  resize: vertical;

  &:focus {
    border-color: var(--color-accent-purple);
  }
`;

export const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 20px;
  overflow-y: auto;
`;

export const ModalBox = styled.div`
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  width: 100%;
  max-width: 520px;
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
`;

export const TableWrapper = styled.div`
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
`;

export const ActionMenuDropdown = styled.div`
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  background: var(--color-bg-primary, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 8px;
  padding: 4px;
  min-width: 190px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

export const ActionMenuItem = styled.button<{ $danger?: boolean | undefined }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: ${(props) => (props.$danger ? "var(--ms-danger, #f85149)" : "var(--color-text-primary, #c9d1d9)")};
  transition: background-color 0.12s ease;

  &:hover:not(:disabled) {
    background-color: ${(props) => (props.$danger ? "rgba(218, 54, 51, 0.15)" : "rgba(255, 255, 255, 0.08)")};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const Table = styled.table`
  width: 100%;
  max-width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  display: block;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;

  thead,
  tbody {
    width: 100%;
  }

  th {
    text-align: left;
    padding: 10px 12px;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border-default);
    font-weight: 600;
  }

  td {
    padding: 12px;
    border-bottom: 1px solid var(--color-border-subtle);
    color: var(--color-text-primary);
    vertical-align: top;
  }

  tr:hover td {
    background-color: var(--color-canvas-subtle);
  }
`;
