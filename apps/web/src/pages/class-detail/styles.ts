// SPDX-License-Identifier: AGPL-3.0-or-later

import { Heading } from "@primer/react";
import { Link } from "react-router-dom";
import styled, { css, keyframes } from "styled-components";

export const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

export const PageWrap = styled.div`
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  min-height: 100%;
  display: flex;
  flex-direction: row;
  transition:
    background-color 0.3s ease,
    color 0.3s ease;
  flex: 1;

  @media (max-width: 960px) {
    flex-direction: column;
  }
`;

export const MobileTreeToggle = styled.button`
  display: none;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 12px 20px;
  background: var(--surface-overlay);
  border: none;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--surface-row-hover);
  }

  @media (max-width: 960px) {
    display: flex;
  }
`;

export const TreeSidebar = styled.div<{ $mobileOpen?: boolean | undefined }>`
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  height: calc(100vh - var(--dev-header-height, 0px));
  position: sticky;
  top: var(--dev-header-height, 0px);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;

  @media (max-width: 960px) {
    width: 100%;
    position: relative;
    top: 0;
    height: auto;
    max-height: ${(props) => (props.$mobileOpen ? "420px" : "0px")};
    overflow: hidden;
    border-right: none;
    border-bottom: ${(props) => (props.$mobileOpen ? "1px solid var(--color-border)" : "none")};
    transition: max-height 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }
`;

export const TreeScrollArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 8px;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 3px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: var(--color-border-strong);
  }
`;

export const MainContentWrap = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
`;

export const Divider = styled.hr`
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 24px 0;
`;

export const ContentGrid = styled.div`
  max-width: none;
  margin: 0 auto;
  padding: 28px 40px 60px;
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 40px;
  width: 100%;
  box-sizing: border-box;
  animation: ${fadeIn} 0.4s ease;

  @media (max-width: 960px) {
    grid-template-columns: 1fr;
  }

  @media (max-width: 768px) {
    padding: 20px 20px 40px;
    gap: 24px;
  }
`;

export const HeaderBar = styled.div`
  max-width: none;
  width: 100%;
  margin: 0 auto;
  padding: 28px 40px 0;
  box-sizing: border-box;
  border-bottom: 1px solid var(--color-border);

  @media (max-width: 768px) {
    padding: 20px 20px 0;
  }
`;

export const TabBar = styled.div`
  display: flex;
  gap: 4px;
  margin-top: 20px;
  overflow-x: auto;
`;

export const TabButton = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid ${(p) => (p.$active ? "var(--color-accent-cyan, #06b6d4)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  font-size: 13px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;

  &:hover {
    color: var(--color-text-heading);
    background: rgba(255, 255, 255, 0.03);
  }
`;

export const TabCountBadge = styled.span<{ $active?: boolean | undefined }>`
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 10px;
  background: ${(p) => (p.$active ? "rgba(6, 182, 212, 0.18)" : "var(--color-border, rgba(255, 255, 255, 0.08))")};
  color: ${(p) => (p.$active ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-text-muted)")};
`;

export const DomainPillBar = styled.div`
  display: flex;
  gap: 4px;
  padding: 0 12px 8px;
  flex-wrap: wrap;
`;

export const DomainFilterPill = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$active ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-border)")};
  background: ${(p) => (p.$active ? "rgba(6, 182, 212, 0.12)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-text-primary);
    border-color: var(--color-accent-cyan, #06b6d4);
  }
`;

export const glassCard = css`
  background: var(--color-bg-card, rgba(15, 23, 42, 0.65));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.1));
  border-radius: 14px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    border-color: rgba(139, 92, 246, 0.35);
    box-shadow:
      0 8px 24px -6px rgba(0, 0, 0, 0.5),
      0 0 16px rgba(139, 92, 246, 0.12);
  }
`;

export const GlassCard = styled.div`
  ${glassCard}
  padding: 20px;
  margin-bottom: 16px;
`;

export const JavadocSection = styled.section`
  margin-bottom: 32px;
`;

export const JavadocTableWrap = styled.div`
  ${glassCard}
  overflow-x: auto;
  margin-bottom: 24px;
`;

export const JavadocTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th {
    text-align: left;
    padding: 10px 14px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--color-text-muted);
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid var(--color-border);
  }

  td {
    padding: 10px 14px;
    border-bottom: 1px solid var(--color-border);
    vertical-align: top;
    color: var(--color-text-primary);
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr:hover td {
    background: rgba(255, 255, 255, 0.02);
  }
`;

export const TypeLink = styled(Link)`
  color: var(--color-accent-cyan, #06b6d4);
  font-family: var(--font-mono, monospace);
  font-size: 12.5px;
  text-decoration: none;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 4px;

  &:hover {
    text-decoration: underline;
    color: #38bdf8;
  }
`;

export const TypeMono = styled.span`
  font-family: var(--font-mono, monospace);
  font-size: 12.5px;
  color: var(--color-text-muted);
`;

export const CodeBlockWrap = styled.div`
  ${glassCard}
  overflow: hidden;
  margin-bottom: 24px;
`;

export const CodeBlockHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.02);
`;

export const CodeBlockPre = styled.pre`
  margin: 0;
  padding: 16px 20px;
  overflow-x: auto;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--color-text-primary);
  background: transparent;
`;

export const DocCard = styled.div`
  padding: 0;
  margin-bottom: 28px;

  h1,
  h2,
  h3,
  h4 {
    color: var(--color-text-heading);
    margin-top: 24px;
    margin-bottom: 12px;
  }
  p {
    line-height: 1.7;
    color: var(--color-text-primary);
    margin-bottom: 16px;
  }
  a {
    color: var(--color-link);
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
  code {
    background: var(--color-code-bg);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.9em;
  }
  pre {
    background: var(--color-pre-bg);
    padding: 16px;
    border-radius: 6px;
    overflow-x: auto;
  }
  pre code {
    background: transparent;
    padding: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
  }
  th,
  td {
    border: 1px solid var(--color-table-border);
    padding: 8px 12px;
    text-align: left;
  }
  th {
    background: var(--color-table-header-bg);
    color: var(--color-text-heading);
  }
  img {
    max-width: 100%;
  }
`;

export const DetailRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
  &:last-child {
    border-bottom: none;
  }
`;

export const DetailLabel = styled.span`
  font-size: 13px;
  color: var(--color-text-muted);
  text-transform: capitalize;
`;

export const DetailValue = styled.span`
  font-size: 13px;
  color: var(--color-text-heading);
  font-weight: 500;
  text-align: right;
  max-width: 65%;
  word-break: break-word;
`;

export const DiagramWrap = styled.div`
  ${glassCard}
  padding: 24px;
  margin-bottom: 24px;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 120px;
  overflow: auto;

  > div > svg {
    width: 100%;
    height: auto;
    max-height: 400px;
    max-width: 100%;
  }
`;

export const SectionTitle = styled(Heading)`
  font-size: 12px !important;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--color-text-muted) !important;
  margin-bottom: 12px !important;
  font-weight: 600 !important;
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const ClassIconBox = styled.div`
  width: 100%;
  padding: 40px;
  border-radius: 12px;
  background: var(--gradient-icon-box);
  border: 1px solid var(--color-border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
  overflow: hidden;
  box-sizing: border-box;

  > div[role="img"],
  > div[role="img"] > svg,
  > svg {
    width: 100% !important;
    height: auto !important;
  }
`;

export const ComponentIconWrap = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;

  > div[role="img"],
  > div[role="img"] > svg,
  > svg {
    width: 24px !important;
    height: 24px !important;
  }
`;
