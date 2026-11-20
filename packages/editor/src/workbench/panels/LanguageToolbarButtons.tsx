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
  WorkflowIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, IconButton } from "@primer/react";
import React, { useCallback, useEffect, useState } from "react";
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
  /** Optional custom handler; defaults to `dispatchEditorToolbarAction`. */
  onInvoke?: (button: EditorLanguageToolbarButton, active?: boolean) => void;
  /** Optional className for responsive hiding/styling in host navbars. */
  className?: string;
}

export const LanguageToolbarButtons: React.FC<LanguageToolbarButtonsProps> = ({
  languageId,
  activeView,
  maxPrimary = 2,
  onInvoke,
  className,
}) => {
  const { primary, overflow, all } = useLanguageToolbarButtons(languageId, activeView, {
    target: "morsel",
    maxPrimary,
  });

  const [toggleStates, setToggleStates] = useState<Record<string, boolean>>({});

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

  if (primary.length === 0 && overflow.length === 0) {
    return null;
  }

  return (
    <div
      className={className}
      data-testid="language-toolbar-buttons"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
      }}
    >
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
                height: 28,
                padding: "0 9px",
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                border: isActive
                  ? "1px solid var(--ms-brand, #0891b2)"
                  : "1px solid var(--borderColor-muted, var(--ms-divider, rgba(128,128,128,0.22)))",
                backgroundColor: isActive
                  ? "color-mix(in srgb, var(--ms-brand, #0891b2) 14%, transparent)"
                  : "transparent",
                color: isActive ? "var(--ms-brand, #0891b2)" : "var(--fgColor-default, var(--ms-text-1))",
                transition: "background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease",
              }}
            >
              <IconComp size={14} />
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
              height: 28,
              width: 28,
              borderRadius: 6,
              backgroundColor: isActive ? "color-mix(in srgb, var(--ms-brand, #0891b2) 14%, transparent)" : undefined,
              color: isActive ? "var(--ms-brand, #0891b2)" : undefined,
            }}
          />
        );
      })}

      {overflow.length > 0 && (
        <ActionMenu>
          <ActionMenu.Anchor>
            <IconButton
              data-testid="lang-toolbar-overflow-btn"
              icon={KebabHorizontalIcon}
              size="small"
              variant="invisible"
              aria-label="More language actions"
              title="More language & view actions"
              style={{ height: 28, width: 28, borderRadius: 6 }}
            />
          </ActionMenu.Anchor>
          <ActionMenu.Overlay width="medium">
            <ActionList>
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
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      )}
    </div>
  );
};
