// SPDX-License-Identifier: AGPL-3.0-or-later

import styled, { css } from "styled-components";

// Re-use the exact header / search / select / pill primitives from the Packages page
// so References looks and behaves identically.
export {
  FilterPill,
  FilterPillBar,
  HeaderActionsGroup,
  HeaderControlsRow,
  HeaderTitle,
  HeaderTitleGroup,
  HeaderTopRow,
  PackagesHeader as ReferencesHeader,
  ResultCount,
  ScopeSegmentButton,
  ScopeSegmentedControl,
  SearchClearButton,
  SearchFieldWrapper,
  SearchKbdHint,
  ToolbarSelectWrapper,
} from "../libraries/styles";

type Tone = "brand" | "success" | "warning" | "purple" | "neutral";

const toneColor = (tone: Tone | undefined): string => {
  switch (tone) {
    case "success":
      return "var(--ms-success)";
    case "warning":
      return "var(--ms-warning)";
    case "purple":
      return "var(--hue-violet, #9333ea)";
    case "neutral":
      return "var(--color-text-muted)";
    default:
      return "var(--ms-brand)";
  }
};

export const ResolveForm = styled.form`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

export const MonoSearchWrapper = styled.div`
  flex: 1 1 280px;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--color-bg-primary) 75%, var(--color-search-bg));
  border: 1px dashed var(--color-search-border);
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;

  > svg {
    flex-shrink: 0;
    color: var(--color-text-muted);
  }

  &:focus-within {
    border-style: solid;
    border-color: var(--ms-brand);
    box-shadow: var(--ms-focus-ring);
    > svg {
      color: var(--ms-brand);
    }
  }

  input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    outline: none;
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--color-text-primary);
    &::placeholder {
      color: var(--color-text-muted);
      opacity: 0.72;
      font-family: inherit;
    }
  }
`;

export const FacetStrip = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--color-text-muted);
`;

export const StripLabel = styled.span`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
  display: inline-flex;
  align-items: center;
  gap: 4px;
`;

export const TextButton = styled.button`
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--ms-brand);
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
`;

export const Chip = styled.button<{ $tone?: Tone | undefined; $active?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 10px;
  border-radius: 9999px;
  font: inherit;
  font-size: 12px;
  font-weight: ${(p) => (p.$active ? 700 : 500)};
  cursor: pointer;
  color: ${(p) => (p.$active ? toneColor(p.$tone) : "var(--color-text-muted)")};
  background: ${(p) => (p.$active ? `color-mix(in srgb, ${toneColor(p.$tone)} 14%, transparent)` : "transparent")};
  border: 1px solid
    ${(p) => (p.$active ? `color-mix(in srgb, ${toneColor(p.$tone)} 45%, transparent)` : "var(--color-border)")};
  transition: all 0.15s ease;
  &:hover {
    color: var(--color-text-primary);
    border-color: ${(p) => toneColor(p.$tone)};
  }
`;

/** Flat, bordered result row, matching the Packages list rows. */
export const ResultRow = styled.article`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
  transition: background 0.15s ease;
  &:hover {
    background: var(--surface-row-hover);
  }
`;

export const RowTop = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
`;

export const RowMain = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export const BadgeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

export const Badge = styled.span<{ $tone?: Tone | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: capitalize;
  text-decoration: none;
  color: ${(p) => toneColor(p.$tone)};
  background: color-mix(in srgb, ${(p) => toneColor(p.$tone)} 12%, transparent);
`;

export const UrnCode = styled.code`
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
  background: var(--ms-surface-hover);
  border: 1px solid var(--color-border);
  padding: 1px 8px;
  border-radius: 9999px;
  line-height: 18px;
`;

export const RowTitle = styled.a`
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--color-text-heading);
  text-decoration: none;
  &:hover {
    color: var(--ms-brand);
  }
`;

export const MetaLine = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12.5px;
  color: var(--color-text-muted);
`;

export const MetaButton = styled.button`
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  &:hover {
    color: var(--ms-brand);
    text-decoration: underline;
  }
`;

export const Abstract = styled.p`
  margin: 0;
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--color-text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

export const FooterMeta = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--color-text-muted);
`;

export const FooterGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
`;

export const InlineStat = styled.span<{ $tone?: Tone | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: ${(p) => (p.$tone ? toneColor(p.$tone) : "var(--color-text-muted)")};
  font-weight: ${(p) => (p.$tone ? 600 : 400)};
  a {
    color: inherit;
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }
`;

export const RowActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
`;

const actionBase = css<{ $primary?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  box-sizing: border-box;
  transition: all 0.15s ease;
  color: ${(p) => (p.$primary ? "var(--ms-brand)" : "var(--color-text-primary)")};
  background: ${(p) => (p.$primary ? "var(--ms-brand-soft)" : "transparent")};
  border: 1px solid
    ${(p) => (p.$primary ? "color-mix(in srgb, var(--ms-brand) 40%, transparent)" : "var(--color-border)")};
  &:hover:not(:disabled) {
    border-color: var(--ms-brand);
    background: ${(p) => (p.$primary ? "var(--ms-brand-soft)" : "var(--ms-surface-hover)")};
  }
  &:focus-visible {
    outline: none;
    box-shadow: var(--ms-focus-ring);
  }
  &:disabled {
    opacity: 0.7;
    cursor: default;
  }
`;

export const ActionButton = styled.button<{ $primary?: boolean | undefined }>`
  ${actionBase}
`;

export const ActionLink = styled.a<{ $primary?: boolean | undefined }>`
  ${actionBase}
`;

export const IconButton = styled.button<{ $danger?: boolean | undefined; $active?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: ${(p) => (p.$active ? "var(--ms-warning)" : "var(--color-text-muted)")};
  transition: all 0.15s ease;
  &:hover {
    background: var(--ms-surface-hover);
    color: ${(p) => (p.$danger ? "var(--ms-danger)" : p.$active ? "var(--ms-warning)" : "var(--color-text-heading)")};
  }
  &:focus-visible {
    outline: none;
    box-shadow: var(--ms-focus-ring);
  }
`;

export const CopyTag = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 1px 8px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid var(--color-border);
  cursor: pointer;
  &:hover {
    color: var(--color-text-heading);
    border-color: var(--color-border-strong);
    background: var(--ms-surface-hover);
  }
`;

export const SkeletonRow = styled.div`
  height: 112px;
  margin: 0 20px;
  border-bottom: 1px solid var(--color-border);
  background: linear-gradient(90deg, transparent, var(--ms-surface-hover), transparent);
  background-size: 200% 100%;
  animation: refs-shimmer 1.4s ease-in-out infinite;
  @keyframes refs-shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }
`;

export const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 60px 20px;
  text-align: center;
  color: var(--color-text-muted);

  h2 {
    margin: 0;
    font-size: 20px;
    color: var(--color-text-heading);
  }
  p {
    margin: 0;
    max-width: 480px;
    font-size: 14px;
    line-height: 1.5;
  }
  p a {
    color: var(--color-link);
  }
`;

export const EmptyActions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
`;

export const Section = styled.section`
  padding: 20px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

export const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;

  h2 {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 700;
    color: var(--color-text-heading);
  }
  span {
    font-size: 12px;
    color: var(--color-text-muted);
  }
`;

export const FacetGrid = styled.div<{ $cols?: number | undefined }>`
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fill, minmax(${(p) => (p.$cols === 2 ? "320px" : "240px")}, 1fr));
`;

export const FacetCard = styled.button<{ $tone?: Tone | undefined }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  text-align: left;
  font: inherit;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
  background: transparent;
  border: 1px solid var(--color-border);
  transition: all 0.15s ease;
  &:hover {
    background: var(--surface-row-hover);
    border-color: ${(p) => toneColor(p.$tone)};
  }
  &:focus-visible {
    outline: none;
    box-shadow: var(--ms-focus-ring);
  }
`;

export const FacetText = styled.div`
  min-width: 0;
  .name {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-heading);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 11.5px;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const LibraryLayout = styled.div`
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

export const LibrarySidebar = styled.aside`
  padding: 16px 12px;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
  @media (max-width: 860px) {
    border-right: none;
    border-bottom: 1px solid var(--color-border);
  }
`;

export const SidebarLabel = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 8px 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

export const SidebarItem = styled.div<{ $active?: boolean | undefined; $tone?: Tone | undefined }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: ${(p) => (p.$active ? 700 : 500)};
  color: ${(p) => (p.$active ? toneColor(p.$tone) : "var(--color-text-primary)")};
  background: ${(p) => (p.$active ? `color-mix(in srgb, ${toneColor(p.$tone)} 12%, transparent)` : "transparent")};
  transition: background 0.15s ease;
  &:hover {
    background: ${(p) => (p.$active ? undefined : "var(--ms-surface-hover)")};
  }

  > button.main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 10px;
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-size: 11px;
    font-family: var(--font-mono);
    opacity: 0.75;
  }
`;

export const LibraryMain = styled.div`
  min-width: 0;
`;

export const NewCollectionForm = styled.form`
  display: flex;
  gap: 6px;
  padding: 4px;

  input {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border-radius: 8px;
    font-size: 12.5px;
    color: var(--color-text-primary);
    background: color-mix(in srgb, var(--color-bg-primary) 75%, var(--color-search-bg));
    border: 1px solid var(--color-search-border);
    outline: none;
    &:focus {
      border-color: var(--ms-brand);
      box-shadow: var(--ms-focus-ring);
    }
  }
`;

export const InlineSelect = styled.select`
  height: 24px;
  padding: 0 6px;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  color: var(--color-text-primary);
  background: transparent;
  border: 1px solid var(--color-border);
  cursor: pointer;
  &:focus-visible {
    outline: none;
    box-shadow: var(--ms-focus-ring);
  }
  option {
    background: var(--color-bg-primary);
    color: var(--color-text-primary);
  }
`;

const fieldBase = css`
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  border-radius: 8px;
  font: inherit;
  font-size: 13.5px;
  color: var(--color-text-primary);
  background: color-mix(in srgb, var(--color-bg-primary) 75%, var(--color-search-bg));
  border: 1px solid var(--color-search-border);
  outline: none;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
  &:hover:not(:focus) {
    border-color: var(--color-border-strong);
  }
  &:focus {
    border-color: var(--ms-brand);
    box-shadow: var(--ms-focus-ring);
  }
  &::placeholder {
    color: var(--color-text-muted);
    opacity: 0.72;
  }
`;

export const Field = styled.input`
  ${fieldBase}
`;

export const TextArea = styled.textarea<{ $mono?: boolean | undefined }>`
  ${fieldBase}
  resize: vertical;
  ${(p) => p.$mono && "font-family: var(--font-mono); font-size: 12.5px;"}
`;

export const FieldLabel = styled.label<{ $tone?: Tone | undefined }>`
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  color: ${(p) => (p.$tone ? toneColor(p.$tone) : "var(--color-text-muted)")};
`;

export const FormGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

export const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(2, 6, 23, 0.6);
  backdrop-filter: blur(4px);
`;

export const ModalCard = styled.div`
  width: 100%;
  max-width: 560px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border-radius: 14px;
  color: var(--color-text-primary);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-default);
  box-shadow: 0 20px 50px rgba(2, 6, 23, 0.35);
`;

export const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: var(--color-text-heading);
  }
`;

export const ModalFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

export const NotesBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
`;
