// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BeakerIcon,
  ChecklistIcon,
  CodeIcon,
  DownloadIcon,
  EyeIcon,
  FileCodeIcon,
  FlowchartIcon,
  GearIcon,
  GraphIcon,
  ImageIcon,
  KebabHorizontalIcon,
  PlayIcon,
  PulseIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersIcon,
  StackIcon,
  SyncIcon,
  TableIcon,
  TerminalIcon,
  ToolsIcon,
  TriangleDownIcon,
  WorkflowIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, IconButton } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dispatchEditorToolbarAction,
  matchesToolbarShortcut,
  setActiveToolbarContext,
  useLanguageToolbarButtons,
  type EditorLanguageToolbarButton,
  type EditorToolbarView,
} from "../../host.js";

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  play: PlayIcon,
  pulse: PulseIcon,
  flowchart: FlowchartIcon,
  workflow: WorkflowIcon,
  "circuit-board": WorkflowIcon,
  "open-preview": EyeIcon,
  eye: EyeIcon,
  code: CodeIcon,
  "file-code": FileCodeIcon,
  sync: SyncIcon,
  download: DownloadIcon,
  export: DownloadIcon,
  "shield-check": ShieldCheckIcon,
  verify: ShieldCheckIcon,
  checklist: ChecklistIcon,
  table: TableIcon,
  stack: StackIcon,
  layers: StackIcon,
  graph: GraphIcon,
  image: ImageIcon,
  tools: ToolsIcon,
  sliders: SlidersIcon,
  gear: GearIcon,
  search: SearchIcon,
  terminal: TerminalIcon,
  beaker: BeakerIcon,
  zap: ZapIcon,
};

/**
 * Resolves a canonical icon token or VS Code codicon string (e.g. `"pulse"` or `"$(pulse)"`)
 * to a Primer Octicon component, falling back to `ZapIcon`.
 */
export function resolveToolbarIcon(iconToken?: string): React.ComponentType<any> {
  if (!iconToken) return ZapIcon;
  const normalized = iconToken
    .trim()
    .replace(/^\$\((.+)\)$/, "$1")
    .toLowerCase();
  return ICON_MAP[normalized] ?? ZapIcon;
}

export interface LanguageToolbarButtonsProps {
  languageId: string;
  activeView: Exclude<EditorToolbarView, "*">;
  /** Maximum inline primary buttons before folding into the overflow menu (default: 2). */
  maxPrimary?: number;
  /**
   * When true, observes the container's available width with ResizeObserver and
   * maximizes the number of visible inline tools, folding excess into `Tools ▾`.
   */
  autoFit?: boolean;
  /** Wrap inline tools in a subtle grouped tray matching the topbar segmented control. */
  grouped?: boolean;
  /** Human-readable language name shown in the overflow menu header (e.g. "Modelica"). */
  languageLabel?: string;
  /** Optional custom handler; defaults to `dispatchEditorToolbarAction`. */
  onInvoke?: (button: EditorLanguageToolbarButton, active?: boolean) => void;
  /** Optional className for responsive hiding/styling in host navbars. */
  className?: string;
}

const OVERFLOW_TRIGGER_WIDTH = 76;
const BUTTON_GAP = 2;

function estimateButtonWidth(btn: EditorLanguageToolbarButton): number {
  if (btn.shortLabel) {
    // Icon (14) + gap (5) + text (~7px/char) + horizontal padding (18)
    return Math.max(54, Math.ceil(btn.shortLabel.length * 7.2) + 37);
  }
  return 28;
}

export const LanguageToolbarButtons: React.FC<LanguageToolbarButtonsProps> = ({
  languageId,
  activeView,
  maxPrimary = 2,
  autoFit = false,
  grouped = false,
  languageLabel,
  onInvoke,
  className,
}) => {
  const {
    primary: allPrimary,
    overflow: baseOverflow,
    all,
  } = useLanguageToolbarButtons(languageId, activeView, {
    target: "morsel",
    maxPrimary: autoFit ? 99 : maxPrimary,
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);
  const [toggleStates, setToggleStates] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!autoFit || typeof ResizeObserver === "undefined") return;
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const next = Math.floor(el.getBoundingClientRect().width);
      setAvailableWidth((prev) => (prev === next ? prev : next));
    };
    updateWidth();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const next = Math.floor(entry.contentRect.width);
      setAvailableWidth((prev) => (prev === next ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoFit, allPrimary.length, baseOverflow.length]);

  const { primary, overflow } = useMemo(() => {
    if (!autoFit) {
      return { primary: allPrimary, overflow: baseOverflow };
    }
    if (allPrimary.length === 0) {
      return { primary: allPrimary, overflow: baseOverflow };
    }
    if (availableWidth === null) {
      // Initial render before ResizeObserver measures: fall back to maxPrimary
      const visible = allPrimary.slice(0, maxPrimary);
      const folded = allPrimary.slice(maxPrimary);
      return { primary: visible, overflow: [...folded, ...baseOverflow] };
    }

    const trayPadding = grouped ? 8 : 0;
    const budget = Math.max(0, availableWidth - trayPadding);
    const widths = allPrimary.map(estimateButtonWidth);

    // Check if every primary button fits alongside baseOverflow (if any)
    const totalAllPrimary = widths.reduce((sum, w) => sum + w, 0) + Math.max(0, widths.length - 1) * BUTTON_GAP;
    const needsOverflowEvenIfAllFit = baseOverflow.length > 0;
    const fullBudgetNeeded = totalAllPrimary + (needsOverflowEvenIfAllFit ? BUTTON_GAP + OVERFLOW_TRIGGER_WIDTH : 0);

    if (fullBudgetNeeded <= budget) {
      return { primary: allPrimary, overflow: baseOverflow };
    }

    // Reserve space for the Tools overflow trigger and fit as many primary buttons as possible
    const budgetWithOverflow = Math.max(0, budget - OVERFLOW_TRIGGER_WIDTH - BUTTON_GAP);
    let used = 0;
    let count = 0;
    for (let i = 0; i < widths.length; i++) {
      const add = (i > 0 ? BUTTON_GAP : 0) + widths[i];
      if (used + add <= budgetWithOverflow) {
        used += add;
        count++;
      } else {
        break;
      }
    }

    return {
      primary: allPrimary.slice(0, count),
      overflow: [...allPrimary.slice(count), ...baseOverflow],
    };
  }, [autoFit, allPrimary, baseOverflow, availableWidth, maxPrimary, grouped]);

  useEffect(() => {
    setActiveToolbarContext({ languageId, view: activeView });
    return () => {
      setActiveToolbarContext(null);
    };
  }, [languageId, activeView]);

  const handleTrigger = useCallback(
    (button: EditorLanguageToolbarButton) => {
      let nextActive: boolean | undefined;
      if (button.kind === "toggle") {
        const key = `${languageId}:${button.id}`;
        nextActive = !toggleStates[key];
        setToggleStates((prev) => ({ ...prev, [key]: Boolean(nextActive) }));
      }
      if (onInvoke) {
        onInvoke(button, nextActive);
      } else {
        dispatchEditorToolbarAction(button, { languageId, view: activeView, active: nextActive });
      }
    },
    [languageId, activeView, onInvoke, toggleStates],
  );

  useEffect(() => {
    const shortcutButtons = all.filter((b) => Boolean(b.shortcut));
    if (shortcutButtons.length === 0 || typeof window === "undefined") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const isInputFocused =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.classList.contains("inputarea") ||
          Boolean(target.closest(".monaco-editor")));
      const hasPrimaryModifier = e.ctrlKey || e.metaKey || e.altKey;

      for (const btn of shortcutButtons) {
        if (!matchesToolbarShortcut(btn.shortcut, e)) continue;
        if (isInputFocused && !hasPrimaryModifier) continue;
        e.preventDefault();
        handleTrigger(btn);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [all, handleTrigger]);

  if (allPrimary.length === 0 && baseOverflow.length === 0) {
    return null;
  }

  const innerContent = (
    <>
      {primary.map((btn) => {
        const IconComp = resolveToolbarIcon(btn.icon);
        const toggleKey = `${languageId}:${btn.id}`;
        const isActive = btn.kind === "toggle" ? Boolean(toggleStates[toggleKey]) : false;
        const tooltip = btn.shortcut ? `${btn.tooltip || btn.label} (${btn.shortcut})` : btn.tooltip || btn.label;

        if (btn.shortLabel) {
          return (
            <button
              key={btn.id}
              type="button"
              data-testid={`lang-toolbar-btn-${btn.id}`}
              aria-label={btn.label}
              aria-pressed={btn.kind === "toggle" ? isActive : undefined}
              title={tooltip}
              onClick={() => handleTrigger(btn)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                height: grouped ? 26 : 28,
                padding: "0 8px",
                borderRadius: grouped ? 6 : 7,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
                border: isActive
                  ? "1px solid color-mix(in srgb, var(--ms-brand, #0891b2) 45%, transparent)"
                  : grouped
                    ? "1px solid transparent"
                    : "1px solid var(--borderColor-muted, var(--ms-divider, rgba(128,128,128,0.22)))",
                backgroundColor: isActive ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.14))" : "transparent",
                color: isActive ? "var(--ms-brand, #0891b2)" : "var(--fgColor-default, var(--ms-text-1))",
                transition: "background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease",
              }}
            >
              {btn.iconSvg ? (
                <svg
                  width={14}
                  height={14}
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                  style={{ display: "block", flexShrink: 0, color: "var(--ms-brand, #0891b2)" }}
                  dangerouslySetInnerHTML={{ __html: btn.iconSvg }}
                />
              ) : (
                <IconComp size={14} />
              )}
              <span>{btn.shortLabel}</span>
            </button>
          );
        }

        return (
          <IconButton
            key={btn.id}
            data-testid={`lang-toolbar-btn-${btn.id}`}
            icon={IconComp}
            size="small"
            variant="invisible"
            aria-label={btn.label}
            aria-pressed={btn.kind === "toggle" ? isActive : undefined}
            title={tooltip}
            onClick={() => handleTrigger(btn)}
            style={{
              height: grouped ? 26 : 28,
              width: grouped ? 26 : 28,
              borderRadius: 6,
              flexShrink: 0,
              backgroundColor: isActive ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.14))" : undefined,
              color: isActive ? "var(--ms-brand, #0891b2)" : undefined,
            }}
          />
        );
      })}

      {overflow.length > 0 && (
        <ActionMenu>
          <ActionMenu.Anchor>
            {grouped || primary.length === 0 ? (
              <button
                type="button"
                data-testid="lang-toolbar-overflow-btn"
                aria-label={languageLabel ? `More ${languageLabel} tools` : "More language tools"}
                title={languageLabel ? `${languageLabel} tools` : "More language & view actions"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  height: grouped ? 26 : 28,
                  padding: "0 8px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  border: grouped
                    ? "1px solid transparent"
                    : "1px solid var(--borderColor-muted, var(--ms-divider, rgba(128,128,128,0.22)))",
                  backgroundColor: "transparent",
                  color: "var(--fgColor-muted, var(--ms-text-2))",
                  transition: "background-color 0.15s ease, color 0.15s ease",
                }}
              >
                <SlidersIcon size={13} />
                <span>Tools</span>
                <TriangleDownIcon size={12} />
              </button>
            ) : (
              <IconButton
                data-testid="lang-toolbar-overflow-btn"
                icon={KebabHorizontalIcon}
                size="small"
                variant="invisible"
                aria-label="More language actions"
                title="More language & view actions"
                style={{ height: 28, width: 28, borderRadius: 6 }}
              />
            )}
          </ActionMenu.Anchor>
          <ActionMenu.Overlay width="medium">
            <ActionList>
              {languageLabel && (
                <ActionList.Group>
                  <ActionList.GroupHeading>{languageLabel} Tools</ActionList.GroupHeading>
                  {overflow.map((btn) => {
                    const IconComp = resolveToolbarIcon(btn.icon);
                    const toggleKey = `${languageId}:${btn.id}`;
                    const isActive = btn.kind === "toggle" ? Boolean(toggleStates[toggleKey]) : false;
                    return (
                      <ActionList.Item
                        key={btn.id}
                        selected={btn.kind === "toggle" ? isActive : undefined}
                        onSelect={() => handleTrigger(btn)}
                      >
                        <ActionList.LeadingVisual>
                          <IconComp size={14} />
                        </ActionList.LeadingVisual>
                        {btn.label}
                        {btn.shortcut && <ActionList.TrailingVisual>{btn.shortcut}</ActionList.TrailingVisual>}
                      </ActionList.Item>
                    );
                  })}
                </ActionList.Group>
              )}
              {!languageLabel &&
                overflow.map((btn) => {
                  const IconComp = resolveToolbarIcon(btn.icon);
                  const toggleKey = `${languageId}:${btn.id}`;
                  const isActive = btn.kind === "toggle" ? Boolean(toggleStates[toggleKey]) : false;
                  return (
                    <ActionList.Item
                      key={btn.id}
                      selected={btn.kind === "toggle" ? isActive : undefined}
                      onSelect={() => handleTrigger(btn)}
                    >
                      <ActionList.LeadingVisual>
                        <IconComp size={14} />
                      </ActionList.LeadingVisual>
                      {btn.label}
                      {btn.shortcut && <ActionList.TrailingVisual>{btn.shortcut}</ActionList.TrailingVisual>}
                    </ActionList.Item>
                  );
                })}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      )}
    </>
  );

  return (
    <div
      ref={containerRef}
      className={className}
      data-testid="language-toolbar-buttons"
      style={{
        display: "flex",
        alignItems: "center",
        flex: autoFit ? "1 1 auto" : "0 0 auto",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={
          grouped
            ? {
                display: "inline-flex",
                alignItems: "center",
                gap: BUTTON_GAP,
                height: 30,
                padding: "0 2px",
                borderRadius: 8,
                background: "var(--bgColor-inset, var(--ms-bg-inset, rgba(0, 0, 0, 0.03)))",
                border: "1px solid var(--borderColor-muted, var(--ms-divider, rgba(0, 0, 0, 0.08)))",
                boxSizing: "border-box",
                maxWidth: "100%",
                overflow: "hidden",
              }
            : {
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                flexShrink: 0,
              }
        }
      >
        {innerContent}
      </div>
    </div>
  );
};
