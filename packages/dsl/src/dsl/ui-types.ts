// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Declarative Language UI Panel, Stencil, Simulation Card, and Tree View Types.
 *
 * IMPORTANT: These definitions are strictly runtime-pure metadata (string paths
 * and serializable options). Language `language.ts` files MUST NOT import React,
 * DOM libraries, or `vscode` directly — host bundlers (`extension-generator.ts`
 * for VS Code and the Vite virtual-module plugin for Morsel/Ansatz) resolve
 * these entry paths at build time.
 */

export type LanguageUiTarget = "vscode" | "morsel" | "artifact";

export type LanguagePanelMode = "workbench" | "inspector" | "artifact";

export interface LanguagePanelOpenCommand {
  /** Command ID registered in VS Code (e.g. "modelscript.openOlgaWorkbench"). */
  id: string;
  /** Human-readable command palette title. */
  title: string;
  /** Optional VS Code codicon identifier (e.g. "$(graph)"). */
  icon?: string | undefined;
}

export interface LanguagePanelDeclaration {
  /** Unique panel identifier within the language (e.g. "olgaEditor"). */
  id: string;
  /** VS Code Custom Editor / Webview viewType (defaults to `modelscript.${langId}.${id}`). */
  viewType?: string | undefined;
  /** Human-readable title shown in VS Code Open With, Morsel tabs, and Artifact headers. */
  title: string;
  /** Optional concise tab label for Morsel / Artifact view switchers. */
  shortTitle?: string | undefined;
  /** Glob filename selectors (e.g. ["*.opi", "*.key", "*.tpl"]); defaults to language fileExtensions. */
  selector?: string[] | undefined;
  /** VS Code custom editor priority (default: "option"). */
  priority?: "default" | "option" | undefined;
  /** Host surfaces where this panel should be registered (default: ["vscode", "morsel", "artifact"]). */
  targets?: LanguageUiTarget[] | undefined;
  /** Default density/interactivity mode (hosts override based on context). */
  defaultMode?: LanguagePanelMode | undefined;
  /** Retain VS Code webview state when hidden (default: true). */
  retainContextWhenHidden?: boolean | undefined;
  /** Support multiple VS Code editors per document (default: true). */
  supportsMultipleEditorsPerDocument?: boolean | undefined;
  /**
   * Relative path from the language package root to the React component module
   * (e.g. "./src/ui/OlgaPanel.tsx") or a package subpath export (e.g. "./ui").
   */
  entry: string;
  /** Export name to mount from `entry` (default: "default"). */
  exportName?: string | undefined;
  /**
   * Optional Ansatz artifact viewType aliases for backward compatibility with
   * existing database records (e.g. ["olga", "olga-flow"]).
   */
  artifactViewTypes?: string[] | undefined;
  /** Optional command to open this panel directly from the command palette or editor title bar. */
  openCommand?: LanguagePanelOpenCommand | undefined;
}

export interface LanguageStencilDeclaration {
  /** Display label in the diagram stencil palette. */
  label: string;
  /** Code snippet inserted when dragging/clicking the stencil. */
  snippet: string;
  /** Optional qualified class/component name for diagram placement. */
  className?: string | undefined;
  /** Optional grouping category in the stencil palette. */
  category?: string | undefined;
  /** Optional icon identifier. */
  icon?: string | undefined;
}

export interface LanguageSimulationCardDeclaration {
  /** Unique card identifier within the language. */
  id: string;
  /** Human-readable card title. */
  title: string;
  /** Relative path from language package root to React component entry. */
  entry: string;
  /** Named export in `entry` (default: "default"). */
  exportName?: string | undefined;
  /** Optional standards tags (e.g. ["IEEE 2800", "AWIA"]). */
  standards?: string[] | undefined;
}

export interface LanguageTreeViewDeclaration {
  /** VS Code view ID (e.g. "modelscript.owl2ClassHierarchy"). */
  id: string;
  /** Human-readable sidebar view name. */
  name: string;
  /** View container ID (defaults to "modelscript-sidebar"). */
  container?: string | undefined;
  /** VS Code `when` clause controlling view visibility. */
  when?: string | undefined;
  /**
   * Relative path to VS Code-only TreeDataProvider factory module
   * (escape hatch for VS Code-specific APIs).
   */
  vscodeEntry: string;
  /** Export name to invoke from `vscodeEntry` (default: "default"). */
  exportName?: string | undefined;
}

export type LanguageToolbarView = "diagram" | "icon" | "3d" | "simulation" | "inspector" | "code" | "*";

export type LanguageToolbarButtonPlacement = "primary" | "overflow";

export type LanguageToolbarButtonKind = "action" | "toggle";

export interface LanguageToolbarButtonDeclaration {
  /** Unique button identifier within the language (e.g. "autoLayout", "solvePowerFlow"). */
  id: string;
  /** Human-readable label shown in tooltips, overflow menus, and command palette. */
  label: string;
  /** Optional concise inline label when rendered as a compact topbar pill. */
  shortLabel?: string | undefined;
  /** Optional tooltip/description override (defaults to `label`). */
  tooltip?: string | undefined;
  /**
   * Canonical icon token mapped to Octicons in Morsel/Ansatz and Codicons in VS Code
   * (e.g. "flowchart", "pulse", "stack", "shield-check", "play", or "$(pulse)").
   */
  icon?: string | undefined;
  /** Optional inline 16x16 SVG inner markup for custom toolbar glyphs in Morsel/Ansatz. */
  iconSvg?: string | undefined;
  /** Which workbench views display this button (default: ["*"]). */
  views?: LanguageToolbarView[] | undefined;
  /** Host surfaces where this button should appear (default: ["morsel", "vscode"]). */
  targets?: LanguageUiTarget[] | undefined;
  /**
   * "primary" renders inline in the topbar (hosts cap inline buttons, e.g. max 2,
   * folding excess into the overflow menu); "overflow" always lives in the compact menu.
   * Default: "primary".
   */
  placement?: LanguageToolbarButtonPlacement | undefined;
  /** Ascending sort order within its placement bucket (default: 100). */
  order?: number | undefined;
  /** Button interaction kind (default: "action"). */
  kind?: LanguageToolbarButtonKind | undefined;
  /** Optional declared `LanguageAction.id` to execute when clicked. */
  actionId?: string | undefined;
  /** Optional typed workbench/panel command string (e.g. "morsel:autoLayout", "morsel:flatten"). */
  command?: string | undefined;
  /** Optional display keyboard shortcut hint (e.g. "Shift+L"). */
  shortcut?: string | undefined;
  /** Optional feature flag key gating visibility in Morsel/Ansatz. */
  featureFlag?: string | undefined;
}

export interface LanguageUiConfig {
  /** Cross-host visual editors, inspector panes, and artifact viewers. */
  panels?: LanguagePanelDeclaration[] | undefined;
  /** Diagram stencil snippets contributed to Morsel and the 2D diagram editor. */
  stencils?: LanguageStencilDeclaration[] | undefined;
  /** Domain-specific simulation result compliance/summary cards. */
  simulationCards?: LanguageSimulationCardDeclaration[] | undefined;
  /** Optional VS Code sidebar tree views. */
  treeViews?: LanguageTreeViewDeclaration[] | undefined;
  /** Declarative per-language / per-view editor topbar buttons. */
  toolbarButtons?: LanguageToolbarButtonDeclaration[] | undefined;
}
