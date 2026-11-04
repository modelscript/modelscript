// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";

/**
 * Lets a tabbed viewer render its tab strip *inside the card footer* (replacing the file name) instead of in its own
 * header bar. The footer registers a DOM slot; viewers portal their tabs into it. When no slot is available (full
 * screen, standalone pages, posts) viewers fall back to rendering their tabs inline.
 */
interface CardFooterSlotValue {
  /** The footer's slot element, or null when no card footer is hosting this viewer. */
  el: HTMLElement | null;
  /** Ref callback used by `CardFooter` to register its slot element. */
  register: ((el: HTMLElement | null) => void) | null;
}

const NO_SLOT: CardFooterSlotValue = { el: null, register: null };

export const CardFooterSlotContext = createContext<CardFooterSlotValue>(NO_SLOT);

/** Hosts a footer slot for the viewer rendered inside the card. */
export const CardFooterSlotProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const register = useCallback((node: HTMLElement | null) => setEl(node), []);
  const value = useMemo(() => ({ el, register }), [el, register]);
  return <CardFooterSlotContext.Provider value={value}>{children}</CardFooterSlotContext.Provider>;
};

/** Explicitly disables footer hosting for a subtree (e.g. the full-screen overlay). */
export const CardFooterSlotDisabled: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CardFooterSlotContext.Provider value={NO_SLOT}>{children}</CardFooterSlotContext.Provider>
);

export const useCardFooterSlot = (): HTMLElement | null => useContext(CardFooterSlotContext).el;

export const useCardFooterSlotRegister = (): ((el: HTMLElement | null) => void) | null =>
  useContext(CardFooterSlotContext).register;

/**
 * Renders `children` (the tab strip) into the card footer when one is hosting this viewer, otherwise renders
 * `fallback` (the viewer's legacy inline header) so other surfaces keep working.
 */
export const FooterTabs: React.FC<{ children: React.ReactNode; fallback?: React.ReactNode }> = ({
  children,
  fallback = null,
}) => {
  const slot = useCardFooterSlot();
  if (slot) return createPortal(children, slot);
  return <>{fallback}</>;
};

/** True when tabs are hosted by the card footer (so the viewer should drop its own header chrome). */
export const useHasFooterSlot = (): boolean => useCardFooterSlot() !== null;

/* ----------------------------------------------------------------------------------------------------------------
 * Shared compact tab strip: the active tab shows icon + label (+ count); inactive tabs collapse to an icon.
 * -------------------------------------------------------------------------------------------------------------- */

const StripRoot = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
`;

const StripTab = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 ${(p) => (p.$active ? "10px" : "8px")};
  border: 1px solid transparent;
  border-radius: 6px;
  background: ${(p) => (p.$active ? "var(--ms-brand-soft, rgba(14, 116, 144, 0.12))" : "transparent")};
  color: ${(p) => (p.$active ? "var(--ms-brand, #0e7490)" : "var(--color-fg-muted)")};
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
  cursor: pointer;
  flex-shrink: ${(p) => (p.$active ? 1 : 0)};
  min-width: 0;
  transition:
    background 0.12s ease,
    color 0.12s ease;

  &:hover {
    color: ${(p) => (p.$active ? "var(--ms-brand, #0e7490)" : "var(--color-fg-default)")};
    background: ${(p) => (p.$active ? "var(--ms-brand-soft, rgba(14, 116, 144, 0.12))" : "var(--color-neutral-muted)")};
  }
  &:focus-visible {
    outline: 2px solid var(--ms-brand, #0e7490);
    outline-offset: 1px;
  }
  .strip-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .strip-count {
    font-size: 10.5px;
    font-weight: 700;
    padding: 0 5px;
    border-radius: 9999px;
    background: var(--color-canvas-default);
    border: 1px solid var(--color-border-default);
    color: var(--color-fg-muted);
  }
`;

export interface FooterTabItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  /** Optional count badge shown next to the label of the active tab. */
  count?: number | undefined;
  /** Optional tooltip override (defaults to the label). */
  title?: string | undefined;
}

export const CompactTabStrip: React.FC<{
  tabs: FooterTabItem[];
  active: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}> = ({ tabs, active, onChange, ariaLabel = "Views" }) => (
  <StripRoot role="tablist" aria-label={ariaLabel} onClick={(e) => e.stopPropagation()}>
    {tabs.map((t) => {
      const isActive = t.id === active;
      const tip = t.count !== undefined ? `${t.title ?? t.label} (${t.count})` : (t.title ?? t.label);
      return (
        <StripTab
          key={t.id}
          type="button"
          role="tab"
          aria-selected={isActive}
          aria-label={tip}
          title={tip}
          $active={isActive}
          onClick={() => onChange(t.id)}
        >
          {t.icon}
          {isActive && <span className="strip-label">{t.label}</span>}
          {isActive && t.count !== undefined && <span className="strip-count">{t.count}</span>}
        </StripTab>
      );
    })}
  </StripRoot>
);

/* Floating glass tool cluster (view-local tools like SVG/Copy/sub-view switch) shared by tabbed viewers. */
export const FloatingTools = styled.div`
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  opacity: 0.6;
  transition: opacity 0.15s ease;

  &:hover,
  &:focus-within {
    opacity: 1;
  }
`;

export const FloatingToolBtn = styled.button<{ $active?: boolean; $success?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: ${(p) =>
    p.$active ? "var(--ms-brand, #0e7490)" : "color-mix(in srgb, var(--color-canvas-default) 82%, transparent)"};
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  color: ${(p) => (p.$active ? "#ffffff" : p.$success ? "var(--color-success-fg, #059669)" : "var(--color-fg-muted)")};
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    color: ${(p) => (p.$active ? "#ffffff" : "var(--color-fg-default)")};
  }
  &:focus-visible {
    outline: 2px solid var(--ms-brand, #0e7490);
    outline-offset: 1px;
  }
`;
