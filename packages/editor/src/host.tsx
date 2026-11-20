// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Host context abstraction for `@modelscript/editor`.
 *
 * Decouples visual/code editor workbenches from app-shell contexts (`Theme`,
 * `FeatureFlags`, `Capabilities`, `ModelingPreferences`, `Toast`, `api.ts`,
 * `react-router-dom`, and `virtual:modelscript-language-ui`) so the exact same
 * editor workbench can mount in `apps/web`, the single-language dev playground,
 * docs embeds, and automated tests.
 */

import React, { createContext, useContext, useEffect } from "react";
import { setActiveEditorLspTransport, type EditorLspTransport } from "./transport.js";

export interface EditorCapabilities {
  localSimulation?: boolean;
  cloudSimulation?: boolean;
  aiAssistant?: boolean;
  collaboration?: boolean;
  fmuExport?: boolean;
  cadViewer?: boolean;
  hasCapability?: (name: string) => boolean;
  [key: string]: unknown;
}

export interface EditorModelingPreferences {
  theme?: "dark" | "light";
  fontSize?: number;
  wordWrap?: "on" | "off";
  minimap?: boolean;
  lineNumbers?: "on" | "off";
  autoSimulate?: boolean;
  [key: string]: unknown;
}

export type EditorToolbarView = "diagram" | "icon" | "3d" | "simulation" | "inspector" | "code" | "*";

export interface EditorLanguageToolbarButton {
  languageId?: string | undefined;
  id: string;
  label: string;
  shortLabel?: string | undefined;
  tooltip?: string | undefined;
  icon?: string | undefined;
  iconSvg?: string | undefined;
  views?: EditorToolbarView[] | undefined;
  targets?: Array<"vscode" | "morsel" | "artifact"> | undefined;
  placement?: "primary" | "overflow" | undefined;
  order?: number | undefined;
  kind?: "action" | "toggle" | undefined;
  actionId?: string | undefined;
  command?: string | undefined;
  shortcut?: string | undefined;
  featureFlag?: string | undefined;
}

export interface ResolvedLanguageToolbarButtons {
  primary: EditorLanguageToolbarButton[];
  overflow: EditorLanguageToolbarButton[];
  all: EditorLanguageToolbarButton[];
}

export interface EditorLanguageUiRegistry {
  morselPanels: Record<string, () => Promise<{ default: React.ComponentType<any> }>>;
  artifactPanels: Record<string, () => Promise<{ default: React.ComponentType<any> }>>;
  simulationCards: Array<{
    id: string;
    languageId: string;
    title: string;
    standards?: string[];
    load: () => Promise<{ default: React.ComponentType<any> }>;
  }>;
  stencils: Record<string, Array<{ label: string; className: string; snippet: string; category?: string }>>;
  toolbarButtons: Record<string, EditorLanguageToolbarButton[]>;
}

const LANGUAGE_UI_REGISTRY_SYMBOL = Symbol.for("@modelscript/editor/registeredLanguageUi");

function getGlobalLanguageUi(): EditorLanguageUiRegistry {
  const g = globalThis as Record<symbol, EditorLanguageUiRegistry | undefined>;
  if (!g[LANGUAGE_UI_REGISTRY_SYMBOL]) {
    g[LANGUAGE_UI_REGISTRY_SYMBOL] = {
      morselPanels: {},
      artifactPanels: {},
      simulationCards: [],
      stencils: {},
      toolbarButtons: {},
    };
  }
  return g[LANGUAGE_UI_REGISTRY_SYMBOL]!;
}

/**
 * Registers language UI panels, simulation cards, stencils, and toolbar buttons into `@modelscript/editor`.
 * Called once at boot by `apps/web` (from `virtual:modelscript-language-ui`) or by
 * `scripts/language-playground.ts` (from `virtual:modelscript-playground-lang`).
 */
export function registerEditorLanguageUi(registry: Partial<EditorLanguageUiRegistry>): void {
  const current = getGlobalLanguageUi();
  (globalThis as Record<symbol, EditorLanguageUiRegistry>)[LANGUAGE_UI_REGISTRY_SYMBOL] = {
    morselPanels: registry.morselPanels ?? current.morselPanels,
    artifactPanels: registry.artifactPanels ?? current.artifactPanels,
    simulationCards: registry.simulationCards ?? current.simulationCards,
    stencils: registry.stencils ?? current.stencils,
    toolbarButtons: registry.toolbarButtons ?? current.toolbarButtons,
  };
}

export function getEditorLanguageUi(): EditorLanguageUiRegistry {
  return getGlobalLanguageUi();
}

/**
 * Resolves declarative toolbar buttons for a given `(languageId, activeView)` pair.
 * Enforces an inline cap (`maxPrimary`, default 2) and automatically folds excess
 * primary buttons plus explicit `"overflow"` buttons into the compact overflow menu.
 */
export function resolveLanguageToolbarButtons(
  buttons: readonly EditorLanguageToolbarButton[] | undefined,
  activeView: Exclude<EditorToolbarView, "*">,
  options?: {
    target?: "vscode" | "morsel" | "artifact" | undefined;
    maxPrimary?: number | undefined;
    isFeatureEnabled?: ((flag: string) => boolean) | undefined;
  },
): ResolvedLanguageToolbarButtons {
  if (!buttons || buttons.length === 0) {
    return { primary: [], overflow: [], all: [] };
  }

  const target = options?.target ?? "morsel";
  const maxPrimary = options?.maxPrimary ?? 2;
  const isFeatureEnabled = options?.isFeatureEnabled;

  const matching = buttons
    .filter((btn) => {
      const targets = btn.targets && btn.targets.length > 0 ? btn.targets : ["morsel", "vscode"];
      if (!targets.includes(target)) return false;

      const views = btn.views && btn.views.length > 0 ? btn.views : ["*"];
      if (!views.includes("*") && !views.includes(activeView)) return false;

      if (btn.featureFlag && isFeatureEnabled && !isFeatureEnabled(btn.featureFlag)) {
        return false;
      }

      return true;
    })
    .slice()
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

  const primaryCandidates = matching.filter((b) => (b.placement ?? "primary") === "primary");
  const explicitOverflow = matching.filter((b) => b.placement === "overflow");

  const primary = primaryCandidates.slice(0, Math.max(0, maxPrimary));
  const overflow = [...primaryCandidates.slice(Math.max(0, maxPrimary)), ...explicitOverflow];

  return { primary, overflow, all: matching };
}

/**
 * React hook returning the resolved primary and overflow toolbar buttons for
 * `(languageId, activeView)`, gated by the host's feature flags.
 */
export function useLanguageToolbarButtons(
  languageId: string,
  activeView: Exclude<EditorToolbarView, "*">,
  options?: { target?: "vscode" | "morsel" | "artifact"; maxPrimary?: number },
): ResolvedLanguageToolbarButtons {
  const host = useEditorHost();
  const rawButtons = getGlobalLanguageUi().toolbarButtons[languageId];
  return resolveLanguageToolbarButtons(rawButtons, activeView, {
    target: options?.target ?? "morsel",
    maxPrimary: options?.maxPrimary ?? 2,
    isFeatureEnabled: host.isFeatureEnabled ? (flag) => Boolean(host.isFeatureEnabled!(flag)) : undefined,
  });
}

export interface EditorToolbarActionEventDetail {
  button: EditorLanguageToolbarButton;
  languageId: string;
  view: Exclude<EditorToolbarView, "*">;
  active?: boolean | undefined;
}

export interface ActiveToolbarContext {
  languageId: string;
  view: Exclude<EditorToolbarView, "*">;
}

let currentActiveToolbarContext: ActiveToolbarContext | null = null;

/** Records the currently active workbench `(languageId, view)` so CommandPalette and other surfaces can query active toolbar buttons. */
export function setActiveToolbarContext(ctx: ActiveToolbarContext | null): void {
  currentActiveToolbarContext = ctx;
}

/** Returns the currently active workbench `(languageId, view)`, or `null` if no editor toolbar is mounted. */
export function getActiveToolbarContext(): ActiveToolbarContext | null {
  return currentActiveToolbarContext;
}

/**
 * Pure matcher for declarative toolbar shortcut strings (e.g. `"Shift+L"`, `"Alt+F"`, `"Mod+Shift+P"`).
 */
export function matchesToolbarShortcut(
  shortcut: string | undefined,
  event: {
    key: string;
    ctrlKey?: boolean | undefined;
    metaKey?: boolean | undefined;
    altKey?: boolean | undefined;
    shiftKey?: boolean | undefined;
  },
): boolean {
  if (!shortcut) return false;
  const parts = shortcut
    .split("+")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return false;

  const keyToken = parts[parts.length - 1]!;
  const mods = new Set(parts.slice(0, -1));

  const wantMod = mods.has("mod") || mods.has("cmdorctrl");
  const wantCtrl = mods.has("ctrl") || mods.has("control");
  const wantMeta = mods.has("meta") || mods.has("cmd") || mods.has("command");
  const wantAlt = mods.has("alt") || mods.has("opt") || mods.has("option");
  const wantShift = mods.has("shift");

  const hasCtrl = Boolean(event.ctrlKey);
  const hasMeta = Boolean(event.metaKey);
  const hasAlt = Boolean(event.altKey);
  const hasShift = Boolean(event.shiftKey);

  if (wantMod) {
    if (!hasCtrl && !hasMeta) return false;
  } else {
    if (hasCtrl !== wantCtrl) return false;
    if (hasMeta !== wantMeta) return false;
  }
  if (hasAlt !== wantAlt) return false;
  if (hasShift !== wantShift) return false;

  return event.key.toLowerCase() === keyToken;
}

export interface EditorToolbarActionMatcher {
  languageId?: string | undefined;
  id?: string | undefined;
  command?: string | undefined;
  actionId?: string | undefined;
  view?: Exclude<EditorToolbarView, "*"> | undefined;
}

/**
 * Ergonomic React hook for views (`Diagram`, `CadViewer`, `Code`) and custom
 * `ui.panels` to subscribe to declarative toolbar button clicks and toggle updates.
 */
export function useEditorToolbarAction(
  matcher: EditorToolbarActionMatcher | ((detail: EditorToolbarActionEventDetail) => boolean),
  handler: (detail: EditorToolbarActionEventDetail) => void,
): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const listener = (ev: Event) => {
      const detail = (ev as CustomEvent<EditorToolbarActionEventDetail | undefined>).detail;
      if (!detail?.button) return;
      const matched =
        typeof matcher === "function"
          ? matcher(detail)
          : (!matcher.languageId || detail.languageId === matcher.languageId) &&
            (!matcher.id || detail.button.id === matcher.id) &&
            (!matcher.command || detail.button.command === matcher.command) &&
            (!matcher.actionId || detail.button.actionId === matcher.actionId) &&
            (!matcher.view || detail.view === matcher.view);
      if (matched) {
        handler(detail);
      }
    };
    window.addEventListener("morsel:toolbar-action", listener);
    return () => window.removeEventListener("morsel:toolbar-action", listener);
  }, [matcher, handler]);
}

/**
 * Dispatches a declarative toolbar button click to Morsel and active language panels.
 * Fires `morsel:toolbar-action` for general handlers and, when `command` uses the
 * `morsel:<action>` convention, also dispatches `modelscript:morsel-command`.
 */
export function dispatchEditorToolbarAction(
  button: EditorLanguageToolbarButton,
  context: { languageId: string; view: Exclude<EditorToolbarView, "*">; active?: boolean | undefined },
): void {
  if (typeof window === "undefined") return;
  const detail: EditorToolbarActionEventDetail = {
    button,
    languageId: context.languageId,
    view: context.view,
    active: context.active,
  };
  window.dispatchEvent(new CustomEvent<EditorToolbarActionEventDetail>("morsel:toolbar-action", { detail }));

  if (button.command?.startsWith("morsel:")) {
    const action = button.command.slice("morsel:".length);
    window.dispatchEvent(new CustomEvent("modelscript:morsel-command", { detail: { action, button } }));
  }
}

export interface EditorHostAdapter {
  /** Active color theme. */
  theme: "dark" | "light";
  /** Optional theme toggle callback. */
  toggleTheme?: (() => void) | undefined;
  /** Feature flag check (defaults to `true` in standalone mode). */
  isFeatureEnabled?: ((flag: string | readonly string[]) => boolean) | undefined;
  /** Raw feature flags map. */
  featureFlags?: Record<string, boolean> | undefined;
  /** Host capabilities map (simulation, cloud, AI, etc.). */
  capabilities?: EditorCapabilities | undefined;
  /** User modeling/editor preferences. */
  modelingPreferences?: EditorModelingPreferences | undefined;
  /** Update user modeling/editor preferences. */
  updateModelingPreferences?: ((patch: Partial<EditorModelingPreferences>) => void) | undefined;
  /** Toast/notification callback. */
  notify?: ((message: string, level?: "info" | "success" | "warning" | "error") => void) | undefined;
  /** Optional injected LSP transport (overrides default WebWorker when provided). */
  lspTransport?: EditorLspTransport | undefined;
  /** Optional single-language lock ID (restricts UI/templates to one language). */
  singleLanguageId?: string | undefined;
  /** Optional shortlink creator for Share modal. */
  createShortLink?: ((payload: any) => Promise<{ id?: string; shortCode?: string; url?: string } | null>) | undefined;
  /** Optional cloud simulation job result fetcher. */
  getSimulationJobResult?: ((jobId: string) => Promise<any>) | undefined;
  /** Optional curated example models for welcome/empty states. */
  heroExamples?: Array<Record<string, any>> | undefined;
  /** Optional router navigation callback (replaces react-router-dom useNavigate). */
  navigate?: ((path: string) => void) | undefined;
  /** Optional cloud simulation modal renderer provided by host web app. */
  renderCloudSimulationModal?: ((props: Record<string, any>) => React.ReactNode) | undefined;
  /** Optional ReqIF viewer renderer provided by host web app. */
  renderReqifViewer?: ((props: Record<string, any>) => React.ReactNode) | undefined;
}

const DEFAULT_CAPABILITIES: EditorCapabilities = {
  localSimulation: true,
  cloudSimulation: false,
  aiAssistant: false,
  collaboration: false,
  fmuExport: true,
  cadViewer: true,
};

const DEFAULT_PREFERENCES: EditorModelingPreferences = {
  fontSize: 14,
  wordWrap: "off",
  minimap: false,
  lineNumbers: "on",
  autoSimulate: false,
};

const DEFAULT_HOST: EditorHostAdapter = {
  theme: "dark",
  isFeatureEnabled: () => true,
  featureFlags: {},
  capabilities: DEFAULT_CAPABILITIES,
  modelingPreferences: DEFAULT_PREFERENCES,
  notify: () => {},
  heroExamples: [],
};

const EDITOR_HOST_CONTEXT_SYMBOL = Symbol.for("@modelscript/editor/EditorHostContext");

function getEditorHostContext(): React.Context<EditorHostAdapter> {
  const g = globalThis as Record<symbol, React.Context<EditorHostAdapter> | undefined>;
  if (!g[EDITOR_HOST_CONTEXT_SYMBOL]) {
    g[EDITOR_HOST_CONTEXT_SYMBOL] = createContext<EditorHostAdapter>(DEFAULT_HOST);
  }
  return g[EDITOR_HOST_CONTEXT_SYMBOL]!;
}

const EditorHostContext = getEditorHostContext();

export const EditorHostProvider: React.FC<{
  host: EditorHostAdapter;
  children: React.ReactNode;
}> = ({ host, children }) => {
  useEffect(() => {
    if (!host.lspTransport) return;
    setActiveEditorLspTransport(host.lspTransport);
    return () => {
      setActiveEditorLspTransport(null);
    };
  }, [host.lspTransport]);

  return <EditorHostContext.Provider value={host}>{children}</EditorHostContext.Provider>;
};

export function useEditorHost(): EditorHostAdapter {
  return useContext(EditorHostContext);
}

/** Convenience hook for reading feature flags via `EditorHostContext`. */
export function useEditorFeatureFlag(flag: string | readonly string[]): boolean {
  const host = useEditorHost();
  if (host.isFeatureEnabled) return host.isFeatureEnabled(flag);
  return true;
}

/** Convenience hook for reading capabilities via `EditorHostContext`. */
export function useEditorCapabilities(): EditorCapabilities & { hasCapability: (name: string) => boolean } {
  const host = useEditorHost();
  const caps = host.capabilities ?? DEFAULT_CAPABILITIES;
  const existingHasCapability =
    typeof caps.hasCapability === "function" ? (caps.hasCapability as (name: string) => boolean) : null;
  return {
    ...caps,
    hasCapability: existingHasCapability ?? ((name: string) => Boolean(caps[name])),
  };
}

/** Convenience hook for reading/updating modeling preferences via `EditorHostContext`. */
export function useEditorModelingPreferences(): {
  preferences: EditorModelingPreferences;
  updatePreferences: (patch: Partial<EditorModelingPreferences>) => void;
  resetPreferences: () => void;
} {
  const host = useEditorHost();
  return {
    preferences: host.modelingPreferences ?? DEFAULT_PREFERENCES,
    updatePreferences: (patch) => host.updateModelingPreferences?.(patch),
    resetPreferences: () => {},
  };
}

/** Convenience hook for reading/toggling theme via `EditorHostContext`. */
export function useEditorTheme(): { theme: "dark" | "light"; toggleTheme: () => void } {
  const host = useEditorHost();
  return {
    theme: host.theme,
    toggleTheme: () => host.toggleTheme?.(),
  };
}

/** Convenience hook for toast notifications via `EditorHostContext`. */
export function useEditorToast(): {
  info: (msg: string) => void;
  success: (msg: string) => void;
  warning: (msg: string) => void;
  error: (msg: string) => void;
  showToast: (msg: string, level?: "info" | "success" | "warning" | "error") => void;
} {
  const host = useEditorHost();
  return {
    info: (msg) => host.notify?.(msg, "info"),
    success: (msg) => host.notify?.(msg, "success"),
    warning: (msg) => host.notify?.(msg, "warning"),
    error: (msg) => host.notify?.(msg, "error"),
    showToast: (msg, level = "info") => host.notify?.(msg, level),
  };
}

export function getLanguageFlagKey(langId: string): string {
  const normalized = langId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  return `lang_${normalized}`;
}

export function isLanguageEnabledInFlags(langId: string, isEnabledFn?: (key: string) => boolean): boolean {
  const key = getLanguageFlagKey(langId);
  const check = isEnabledFn ?? ((k: string) => k !== "lang_modelscript");
  if (langId === "modelscript" || key === "lang_modelscript") {
    return check("lang_modelscript") || check("lang_modelscript_msx");
  }
  return check(key);
}

/** Convenience hook for reading all feature flags via `EditorHostContext`. */
export function useEditorFeatureFlags(): {
  flags: Record<string, boolean>;
  isEnabled: (key: string) => boolean;
} {
  const host = useEditorHost();
  return {
    flags: host.featureFlags ?? {},
    isEnabled: (key: string) => (host.isFeatureEnabled ? host.isFeatureEnabled(key) : true),
  };
}
