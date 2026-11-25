// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const AnsatzEditorContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  background-color: var(--color-canvas-default);
  overflow: hidden;
  position: relative;
`;

/*
 * Topbar control metrics. Every interactive control in the bar shares one
 * height and one radius family so the bar reads as a single, calm surface.
 */
const CONTROL_H = "28px";
const RADIUS_OUTER = "8px";
const RADIUS_INNER = "6px";

/**
 * Floating workbench topbar.
 *
 * Three-column grid: [document] [views] [actions]. The outer columns share the
 * remaining width equally so the view switcher sits at the true centre of the
 * bar. The left column may shrink (the title truncates); the right column never
 * compresses below its content, so actions are never clipped.
 */
export const AnsatzEditorNavbar = styled.header`
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  height: 48px;
  min-height: 48px;
  background-color: var(--ms-surface-glass, rgba(255, 255, 255, 0.94));
  backdrop-filter: blur(14px) saturate(1.2);
  -webkit-backdrop-filter: blur(14px) saturate(1.2);
  border: 1px solid var(--ms-border, rgba(15, 23, 42, 0.12));
  border-radius: 12px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.04) inset,
    0 4px 12px -4px rgba(15, 23, 42, 0.18),
    0 1px 2px rgba(15, 23, 42, 0.08);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(max-content, 1fr);
  align-items: center;
  padding: 0 10px;
  column-gap: 12px;
  z-index: 40;
  container-type: inline-size;
  overflow: hidden;

  @media (max-width: 768px) {
    top: 8px;
    left: 8px;
    right: 8px;
    padding: 0 8px;
    column-gap: 6px;
  }

  @container (max-width: 1400px) {
    .nav-hide-xl {
      display: none !important;
    }
    /* Collapse labelled buttons to icon-only. Target only the text node so the
       leading icon (also wrapped in a span by Primer) stays visible. */
    .nav-icon-only-xl [data-component="text"] {
      display: none !important;
    }
  }

  @container (max-width: 1240px) {
    .nav-hide-lg {
      display: none !important;
    }
  }

  @container (max-width: 960px) {
    .nav-hide-md {
      display: none !important;
    }
  }

  @container (max-width: 768px) {
    .nav-hide-sm {
      display: none !important;
    }
  }
`;

export const NavLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  justify-self: start;
  width: 100%;

  @media (max-width: 768px) {
    gap: 4px;
  }
`;

/** Centre column: workbench view switcher + split toggle. */
export const NavCenter = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  gap: 4px;

  ul[data-size="small"] {
    background: var(--ms-bg-inset, var(--bgColor-inset));
    border: 1px solid var(--ms-border, var(--borderColor-muted));
    border-radius: ${RADIUS_OUTER};
    padding: 2px;
    gap: 2px;
    height: ${CONTROL_H};
    box-sizing: border-box;
  }

  li {
    margin: 0 !important;
  }

  li::after {
    display: none !important; /* Remove harsh 1px tick separators */
  }

  ul[data-size="small"] button {
    border: 1px solid transparent !important;
    outline: none;
    border-radius: ${RADIUS_INNER} !important;
    font-size: 12px !important;
    font-weight: 500 !important;
    color: var(--ms-text-2, var(--fgColor-muted)) !important;
    background: transparent !important;
    transition:
      background-color 0.15s ease,
      color 0.15s ease,
      border-color 0.15s ease,
      box-shadow 0.15s ease !important;
    height: 100% !important;
    min-width: 26px !important;
    padding: 0 8px !important;
    box-sizing: border-box !important;
  }

  ul[data-size="small"] button:focus-visible {
    outline: 2px solid var(--ms-brand, #0891b2) !important;
    outline-offset: 1px;
  }

  ul[data-size="small"] button span,
  ul[data-size="small"] button [class*="Content"],
  ul[data-size="small"] button [class*="Content"] * {
    border: none !important;
    outline: none !important;
    box-shadow: none !important;
    background: transparent !important;
  }

  ul[data-size="small"] button [class*="Content"] {
    padding: 0 !important;
    gap: 5px !important;
  }

  /* Prevent Primer's hidden bold-width pseudo-element from causing jitter */
  [class*="Text"]::after,
  .segmentedControl-text::after {
    display: none !important;
  }

  ul[data-size="small"] button:not([aria-pressed="true"]):hover {
    background-color: var(--ms-surface-hover, rgba(125, 125, 125, 0.08)) !important;
    color: var(--ms-text-1, var(--fgColor-default)) !important;
  }

  /*
   * Active segment: a neutral raised "thumb" (Figma / Linear pattern). It is
   * deliberately NOT brand-filled so the Run button stays the single accent.
   * Primer marks the selected segment with aria-pressed.
   */
  ul[data-size="small"] button[aria-pressed="true"] {
    background: var(--ms-bg-elv, #ffffff) !important;
    border-color: var(--ms-border, rgba(15, 23, 42, 0.12)) !important;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.1) !important;
    color: var(--ms-text-1, var(--fgColor-default)) !important;
    font-weight: 600 !important;
  }

  ul[data-size="small"] button[aria-pressed="true"] svg {
    color: var(--ms-brand, #0891b2) !important;
    fill: var(--ms-brand, #0891b2) !important;
  }

  /* Tier 2: inactive tabs collapse to icons; the active tab keeps its label */
  @container (max-width: 1520px) {
    ul[data-size="small"] button:not([aria-pressed="true"]) {
      padding: 0 7px !important;
    }
    ul[data-size="small"] button:not([aria-pressed="true"]) [class*="Text"] {
      display: none !important;
    }
  }

  /* Tier 3: every tab is icon-only (the raised thumb still marks the active one) */
  @container (max-width: 1100px) {
    ul[data-size="small"] button {
      padding: 0 7px !important;
    }
    ul[data-size="small"] button [class*="Text"] {
      display: none !important;
    }
  }

  @container (max-width: 640px) {
    display: none;
  }
`;

export const SplitToggleButton = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: ${CONTROL_H};
  width: ${CONTROL_H};
  padding: 0;
  border-radius: ${RADIUS_OUTER};
  font-family: inherit;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
  box-sizing: border-box;
  user-select: none;
  flex-shrink: 0;
  background: ${(props) => (props.$active ? "var(--ms-bg-elv, #ffffff)" : "transparent")};
  border: 1px solid ${(props) => (props.$active ? "var(--ms-border, rgba(15, 23, 42, 0.12))" : "transparent")};
  box-shadow: ${(props) => (props.$active ? "0 1px 2px rgba(15, 23, 42, 0.1)" : "none")};
  color: ${(props) => (props.$active ? "var(--ms-brand, #0891b2)" : "var(--ms-text-2, var(--fgColor-muted))")};

  svg {
    fill: currentColor;
    flex-shrink: 0;
  }

  &:hover:not(:disabled) {
    background: ${(props) => (props.$active ? "var(--ms-bg-elv, #ffffff)" : "var(--ms-surface-hover)")};
    color: ${(props) => (props.$active ? "var(--ms-brand, #0891b2)" : "var(--ms-text-1, var(--fgColor-default))")};
  }

  &:focus-visible {
    outline: 2px solid var(--ms-brand, #0891b2);
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
`;

export const NavRight = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  justify-self: end;
  gap: 4px;
  white-space: nowrap;

  /* Normalise every Primer button in the action cluster to the shared metrics */
  button[data-size="small"] {
    height: ${CONTROL_H};
    border-radius: ${RADIUS_OUTER};
  }

  @media (max-width: 768px) {
    gap: 2px;
  }
`;

export const BrandLink = styled.a`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  text-decoration: none;
  color: var(--color-fg-default);
  border-radius: ${RADIUS_INNER};
  cursor: pointer;
  transition: opacity 0.15s ease;

  &:hover {
    text-decoration: none;
    opacity: 0.8;
  }

  &:focus-visible {
    outline: 2px solid var(--ms-brand, #0891b2);
    outline-offset: 2px;
  }
`;

/** Neutral tier badge — kept quiet so it doesn't compete with the Run CTA. */
export const BrandTierBadge = styled.span`
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 1px 4px;
  border-radius: 4px;
  background: transparent;
  border: 1px solid var(--ms-border, rgba(15, 23, 42, 0.12));
  color: var(--ms-text-3, var(--fgColor-muted));
  line-height: 12px;
  flex-shrink: 0;
`;

export const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--ms-brand-soft);
  color: var(--ms-link);
  border: 1px solid color-mix(in srgb, var(--ms-brand) 30%, transparent);
  font-weight: 600;

  @media (max-width: 600px) {
    display: none;
  }
`;

export const NavText = styled.span`
  @media (max-width: 640px) {
    display: none;
  }
`;

/** Document identity block: editable title + muted language metadata. */
export const DocIdentity = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
`;

export const DocTitleInput = styled.input`
  min-width: 3ch;
  max-width: 100%;
  flex: 0 1 auto;
  height: ${CONTROL_H};
  padding: 0 6px;
  margin: 0 0 0 -6px;
  border: 1px solid transparent;
  border-radius: ${RADIUS_INNER};
  background: transparent;
  color: var(--ms-text-1, var(--fgColor-default));
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.005em;
  text-overflow: ellipsis;
  field-sizing: content;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;

  &:hover {
    background: var(--ms-surface-hover);
  }

  &:focus {
    outline: none;
    background: var(--ms-bg-elv, #ffffff);
    border-color: var(--ms-brand, #0891b2);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ms-brand, #0891b2) 18%, transparent);
  }
`;

export const DocMeta = styled.span`
  flex-shrink: 0;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  color: var(--ms-text-3, var(--fgColor-muted));
  user-select: none;

  @container (max-width: 1180px) {
    display: none;
  }
`;

export const EditorArea = styled.main`
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
  overflow: hidden;
`;

export const NavDivider = styled.span`
  width: 1px;
  height: 16px;
  background: var(--ms-border, rgba(0, 0, 0, 0.12));
  flex-shrink: 0;
  margin: 0 4px;
  @container (max-width: 900px) {
    display: none;
  }
`;

/** ⌘K command-palette trigger styled as a compact search field. */
export const SearchTrigger = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: ${CONTROL_H};
  min-width: 136px;
  padding: 0 5px 0 8px;
  border-radius: ${RADIUS_OUTER};
  border: 1px solid var(--ms-border, rgba(0, 0, 0, 0.12));
  background: var(--ms-bg-inset, rgba(0, 0, 0, 0.03));
  color: var(--ms-text-3, var(--color-fg-muted));
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background-color 0.15s ease,
    border-color 0.15s ease;
  user-select: none;
  box-sizing: border-box;

  .search-label {
    flex: 1;
    text-align: left;
  }

  &:hover {
    color: var(--ms-text-1, var(--color-fg-default));
    background: var(--ms-bg-elv, transparent);
  }

  &:focus-visible {
    outline: 2px solid var(--ms-brand, #0891b2);
    outline-offset: 1px;
  }

  kbd {
    font-size: 10px;
    font-family: inherit;
    font-weight: 500;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--ms-bg-elv, #ffffff);
    border: 1px solid var(--ms-border, rgba(0, 0, 0, 0.08));
    color: var(--ms-text-3, var(--color-fg-muted));
    letter-spacing: 0;
    line-height: 14px;
  }

  /* Collapse to an icon-only button on narrower bars */
  @container (max-width: 1420px) {
    min-width: 0;
    width: ${CONTROL_H};
    padding: 0;
    justify-content: center;
    border-color: transparent;
    background: transparent;
    .search-label,
    kbd {
      display: none !important;
    }
    &:hover {
      background: var(--ms-surface-hover);
    }
  }
`;
