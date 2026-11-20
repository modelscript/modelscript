// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as FsTypes from "node:fs";
import type * as PathTypes from "node:path";
import type { LanguageOptions } from "../../dsl/language.js";
import type {
  LanguagePanelDeclaration,
  LanguageSimulationCardDeclaration,
  LanguageStencilDeclaration,
  LanguageToolbarButtonDeclaration,
  LanguageToolbarButtonKind,
  LanguageToolbarButtonPlacement,
  LanguageToolbarView,
  LanguageTreeViewDeclaration,
  LanguageUiTarget,
} from "../../dsl/ui-types.js";
import type { NormalizedLanguage } from "./extension-generator.js";
import { normalizeLanguages } from "./extension-generator.js";

export interface DiscoveredLanguageAsset {
  src: string;
  dest: string;
}

export interface DiscoveredUiPanel {
  languageId: string;
  packageName: string;
  packageDir: string;
  id: string;
  viewType: string;
  title: string;
  shortTitle?: string | undefined;
  selector: string[];
  priority: "default" | "option";
  targets: LanguageUiTarget[];
  defaultMode?: "workbench" | "inspector" | "artifact" | undefined;
  retainContextWhenHidden: boolean;
  supportsMultipleEditorsPerDocument: boolean;
  /** Original entry specifier declared in language.ts */
  entry: string;
  /** Resolved absolute filesystem path to the entry file */
  resolvedEntryPath: string;
  exportName: string;
  artifactViewTypes: string[];
  openCommand?: { id: string; title: string; icon?: string | undefined } | undefined;
  /** Generated VS Code webview bundle filename (relative to extension dist/) */
  webviewScriptName: string;
}

export interface DiscoveredUiSimulationCard {
  languageId: string;
  packageName: string;
  id: string;
  title: string;
  entry: string;
  resolvedEntryPath: string;
  exportName: string;
  standards?: string[] | undefined;
}

export interface DiscoveredUiTreeView {
  languageId: string;
  packageName: string;
  id: string;
  name: string;
  container: string;
  when?: string | undefined;
  vscodeEntry: string;
  resolvedEntryPath: string;
  exportName: string;
}

export interface DiscoveredUiToolbarButton {
  languageId: string;
  id: string;
  label: string;
  shortLabel?: string | undefined;
  tooltip?: string | undefined;
  icon?: string | undefined;
  views: LanguageToolbarView[];
  targets: LanguageUiTarget[];
  placement: LanguageToolbarButtonPlacement;
  order: number;
  kind: LanguageToolbarButtonKind;
  actionId?: string | undefined;
  command?: string | undefined;
  shortcut?: string | undefined;
  featureFlag?: string | undefined;
}

export interface DiscoveredLanguageManifestEntry {
  id: string;
  name: string;
  displayName: string;
  maturity: "stable" | "beta" | "experimental";
  fileExtensions: string[];
  primaryExtension: string;
  wasm?: string | undefined;
  syntaxNames?: string[] | undefined;
  fieldNames?: Record<string, number> | undefined;
  lineComment?: string | undefined;
  blockComment?: { open: string; close: string } | undefined;
}

export interface DiscoveredSingleLanguageResult {
  language: NormalizedLanguage;
  manifest: DiscoveredLanguageManifestEntry;
  packageName: string;
  packageDir: string;
  wasmAssets: DiscoveredLanguageAsset[];
  wasmPath?: string | undefined;
  bindingsPath?: string | undefined;
  ui: {
    panels: DiscoveredUiPanel[];
    stencils: LanguageStencilDeclaration[];
    simulationCards: DiscoveredUiSimulationCard[];
    treeViews: DiscoveredUiTreeView[];
    toolbarButtons: DiscoveredUiToolbarButton[];
  };
}

export interface DiscoveredLanguagesResult {
  languages: NormalizedLanguage[];
  wasmAssets: DiscoveredLanguageAsset[];
  manifest: DiscoveredLanguageManifestEntry[];
  ui: {
    panels: DiscoveredUiPanel[];
    stencilsByLanguage: Record<string, LanguageStencilDeclaration[]>;
    simulationCards: DiscoveredUiSimulationCard[];
    treeViews: DiscoveredUiTreeView[];
    toolbarButtonsByLanguage: Record<string, DiscoveredUiToolbarButton[]>;
  };
}

/**
 * Discovers a single language package directory (e.g. `languages/olga`).
 * Inspects package.json, language.ts, dist/parser.wasm, bindings.js, and declarative `ui` config.
 */
export async function discoverSingleLanguage(langDir: string): Promise<DiscoveredSingleLanguageResult | null> {
  const fsId = "node:fs";
  const pathId = "node:path";
  const fs = (await import(fsId)) as typeof FsTypes;
  const path = (await import(pathId)) as typeof PathTypes;
  const dynamicImport = (m: string): Promise<Record<string, unknown>> => import(m);

  const absLangDir = path.resolve(langDir);
  const pkgPath = path.join(absLangDir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  const dirName = path.basename(absLangDir);
  let pkg: { name?: string; version?: string; [key: string]: unknown } = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      name?: string;
      version?: string;
      [key: string]: unknown;
    };
  } catch {
    return null;
  }

  const pkgName = pkg.name || `@modelscript/${dirName}`;
  let langDef: LanguageOptions | null = null;
  const isLangObj = (v: unknown): v is LanguageOptions => Boolean(v && typeof v === "object" && "name" in v);

  // 1. Try importing directly from workspace source files first (preserves recent edits under tsx)
  const fileCandidates = [
    path.join(absLangDir, "src", "language.ts"),
    path.join(absLangDir, "language.ts"),
    path.join(absLangDir, "dist", "src", "language.js"),
    path.join(absLangDir, "dist", "language.js"),
  ];
  for (const candidate of fileCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        const mod = await dynamicImport(candidate);
        const candidateDef = mod["default"] || mod[`${dirName}Language`] || Object.values(mod).find(isLangObj);
        if (isLangObj(candidateDef)) {
          langDef = candidateDef;
          break;
        }
      } catch {
        // continue
      }
    }
  }

  // 2. Fallback to package import
  if (!langDef) {
    try {
      const mod = await dynamicImport(`${pkgName}/language`);
      const candidateDef = mod["default"] || mod[`${dirName}Language`] || Object.values(mod).find(isLangObj);
      if (isLangObj(candidateDef)) {
        langDef = candidateDef;
      }
    } catch {
      // continue
    }
  }

  if (!langDef) {
    const msMeta = pkg["modelscript"] as { extensions?: string[] } | undefined;
    langDef = {
      name: dirName,
      fileExtensions: msMeta?.extensions || [`.${dirName}`],
    };
  }

  const [normalized] = normalizeLanguages([langDef as Parameters<typeof normalizeLanguages>[0][number]]);
  const lang = normalized!;
  const wasmAssets: DiscoveredLanguageAsset[] = [];

  // 3. Discover native GLR parser.wasm
  const wasmCandidates = [
    path.join(absLangDir, "dist", "parser.wasm"),
    path.join(absLangDir, "parser.wasm"),
    path.join(absLangDir, ".cache", "parser.wasm"),
    path.join(absLangDir, "build", "parser.wasm"),
  ];

  let wasmFileName: string | undefined;
  const foundWasm = wasmCandidates.find(fs.existsSync);
  if (foundWasm) {
    wasmFileName = `${lang.id}.wasm`;
    wasmAssets.push({
      src: foundWasm,
      dest: `server/dist/${wasmFileName}`,
    });
    const distWasm = path.join(absLangDir, "dist", "parser.wasm");
    if (!fs.existsSync(distWasm) && foundWasm !== distWasm) {
      try {
        fs.mkdirSync(path.dirname(distWasm), { recursive: true });
        fs.copyFileSync(foundWasm, distWasm);
      } catch {}
    }
  }

  // 4. Discover native parser bindings.js & syntax names
  const bindingsCandidates = [
    path.join(absLangDir, "src-gen", "bindings.js"),
    path.join(absLangDir, "dist", "src-gen", "bindings.js"),
    path.join(absLangDir, "dist", "bindings.js"),
    path.join(absLangDir, "bindings.js"),
    path.join(absLangDir, ".cache", "bindings.js"),
  ];

  let syntaxNames: string[] | undefined;
  let fieldNames: Record<string, number> | undefined;
  const foundBindings = bindingsCandidates.find(fs.existsSync);
  if (foundBindings) {
    wasmAssets.push({
      src: foundBindings,
      dest: `server/dist/${lang.id}.bindings.js`,
    });
    try {
      const fileUrl = path.isAbsolute(foundBindings) ? `file://${foundBindings}` : foundBindings;
      const mod = await dynamicImport(fileUrl);
      if (mod && Array.isArray(mod["SYNTAX_NAMES"]) && mod["SYNTAX_NAMES"].length > 0) {
        syntaxNames = mod["SYNTAX_NAMES"] as string[];
      }
      const rawFieldNames = mod?.["FIELD_NAMES"];
      if (rawFieldNames && typeof rawFieldNames === "object" && Object.keys(rawFieldNames).length > 0) {
        fieldNames = rawFieldNames as Record<string, number>;
      }
    } catch {
      // Fallback to regex extraction
    }
    if (!syntaxNames || !fieldNames) {
      try {
        const content = fs.readFileSync(foundBindings, "utf-8");
        if (!syntaxNames) {
          const m = content.match(/SYNTAX_NAMES\s*=\s*(?:typeof\s*)?(\[[^\]]+\])/);
          if (m) {
            syntaxNames = JSON.parse(m[1]!);
          }
        }
        if (!fieldNames) {
          const mf = content.match(/FIELD_NAMES\s*=\s*(?:typeof\s*)?(\{[\s\S]*?\})\s*!==/);
          if (mf) {
            fieldNames = JSON.parse(mf[1]!);
          }
        }
      } catch {}
    }
  }

  // 5. Discover declarative UI panels, stencils, simulation cards, tree views, and toolbar buttons
  const uiPanels: DiscoveredUiPanel[] = [];
  let stencils: LanguageStencilDeclaration[] = [];
  const uiSimulationCards: DiscoveredUiSimulationCard[] = [];
  const uiTreeViews: DiscoveredUiTreeView[] = [];
  const uiToolbarButtons: DiscoveredUiToolbarButton[] = [];

  const uiConfig = langDef.ui;
  if (uiConfig) {
    const resolveEntry = (entryPath: string): string => {
      const cleaned = entryPath.startsWith("./") ? entryPath.slice(2) : entryPath;
      const direct = path.resolve(absLangDir, cleaned);
      if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
      for (const ext of [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.js"]) {
        const candidate = path.resolve(absLangDir, `${cleaned}${ext}`);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      }
      return direct;
    };

    if (Array.isArray(uiConfig.panels)) {
      for (const panel of uiConfig.panels as LanguagePanelDeclaration[]) {
        const resolvedEntryPath = resolveEntry(panel.entry);
        if (!fs.existsSync(resolvedEntryPath)) continue;
        const langId = lang.id;
        const viewType = panel.viewType ?? `modelscript.${langId}.${panel.id}`;
        const selector =
          panel.selector && panel.selector.length > 0 ? panel.selector : lang.fileExtensions.map((ext) => `*${ext}`);
        const safeId = `${langId}-${panel.id}`.replace(/[^a-zA-Z0-9_-]/g, "-");
        uiPanels.push({
          languageId: langId,
          packageName: pkgName,
          packageDir: absLangDir,
          id: panel.id,
          viewType,
          title: panel.title,
          shortTitle: panel.shortTitle,
          selector,
          priority: panel.priority ?? "option",
          targets: panel.targets ?? ["vscode", "morsel", "artifact"],
          defaultMode: panel.defaultMode,
          retainContextWhenHidden: panel.retainContextWhenHidden ?? true,
          supportsMultipleEditorsPerDocument: panel.supportsMultipleEditorsPerDocument ?? true,
          entry: panel.entry,
          resolvedEntryPath,
          exportName: panel.exportName ?? "default",
          artifactViewTypes: panel.artifactViewTypes ?? [],
          openCommand: panel.openCommand,
          webviewScriptName: `webviews/${safeId}.js`,
        });
      }
    }

    if (Array.isArray(uiConfig.stencils) && uiConfig.stencils.length > 0) {
      stencils = uiConfig.stencils;
    }

    if (Array.isArray(uiConfig.simulationCards)) {
      for (const card of uiConfig.simulationCards as LanguageSimulationCardDeclaration[]) {
        const resolvedEntryPath = resolveEntry(card.entry);
        if (!fs.existsSync(resolvedEntryPath)) continue;
        uiSimulationCards.push({
          languageId: lang.id,
          packageName: pkgName,
          id: card.id,
          title: card.title,
          entry: card.entry,
          resolvedEntryPath,
          exportName: card.exportName ?? "default",
          standards: card.standards,
        });
      }
    }

    if (Array.isArray(uiConfig.treeViews)) {
      for (const tv of uiConfig.treeViews as LanguageTreeViewDeclaration[]) {
        const resolvedEntryPath = resolveEntry(tv.vscodeEntry);
        if (!fs.existsSync(resolvedEntryPath)) continue;
        uiTreeViews.push({
          languageId: lang.id,
          packageName: pkgName,
          id: tv.id,
          name: tv.name,
          container: tv.container ?? "modelscript-sidebar",
          when: tv.when,
          vscodeEntry: tv.vscodeEntry,
          resolvedEntryPath,
          exportName: tv.exportName ?? "default",
        });
      }
    }

    if (Array.isArray(uiConfig.toolbarButtons)) {
      const seenIds = new Set<string>();
      for (const btn of uiConfig.toolbarButtons as LanguageToolbarButtonDeclaration[]) {
        if (!btn?.id || !btn?.label || seenIds.has(btn.id)) continue;
        seenIds.add(btn.id);
        uiToolbarButtons.push({
          languageId: lang.id,
          id: btn.id,
          label: btn.label,
          shortLabel: btn.shortLabel,
          tooltip: btn.tooltip,
          icon: btn.icon,
          views: btn.views && btn.views.length > 0 ? btn.views : ["*"],
          targets: btn.targets && btn.targets.length > 0 ? btn.targets : ["morsel", "vscode"],
          placement: btn.placement ?? "primary",
          order: typeof btn.order === "number" ? btn.order : 100,
          kind: btn.kind ?? "action",
          actionId: btn.actionId,
          command: btn.command,
          shortcut: btn.shortcut,
          featureFlag: btn.featureFlag,
        });
      }
      uiToolbarButtons.sort((a, b) => a.order - b.order);
    }
  }

  const manifestEntry: DiscoveredLanguageManifestEntry = {
    id: lang.id,
    name: lang.name,
    displayName: lang.displayName,
    maturity: lang.maturity,
    fileExtensions: lang.fileExtensions,
    primaryExtension: lang.primaryExtension,
    wasm: wasmFileName,
    syntaxNames,
    fieldNames,
    lineComment: lang.lineComment,
    blockComment: lang.blockComment,
  };

  return {
    language: lang,
    manifest: manifestEntry,
    packageName: pkgName,
    packageDir: absLangDir,
    wasmAssets,
    wasmPath: foundWasm,
    bindingsPath: foundBindings,
    ui: {
      panels: uiPanels,
      stencils,
      simulationCards: uiSimulationCards,
      treeViews: uiTreeViews,
      toolbarButtons: uiToolbarButtons,
    },
  };
}

/**
 * Automatically discovers all language packages from a target directory (e.g. languages/).
 * Inspects package.json, language.ts, and dist/parser.wasm for each subdirectory.
 */
export async function discoverWorkspaceLanguages(languagesDir: string): Promise<DiscoveredLanguagesResult> {
  const fsId = "node:fs";
  const pathId = "node:path";
  const fs = (await import(fsId)) as typeof FsTypes;
  const path = (await import(pathId)) as typeof PathTypes;
  const normalizedLangs: NormalizedLanguage[] = [];
  const wasmAssets: DiscoveredLanguageAsset[] = [];
  const manifest: DiscoveredLanguageManifestEntry[] = [];
  const uiPanels: DiscoveredUiPanel[] = [];
  const stencilsByLanguage: Record<string, LanguageStencilDeclaration[]> = {};
  const uiSimulationCards: DiscoveredUiSimulationCard[] = [];
  const uiTreeViews: DiscoveredUiTreeView[] = [];
  const toolbarButtonsByLanguage: Record<string, DiscoveredUiToolbarButton[]> = {};

  if (!fs.existsSync(languagesDir)) {
    return {
      languages: [],
      wasmAssets: [],
      manifest: [],
      ui: {
        panels: [],
        stencilsByLanguage: {},
        simulationCards: [],
        treeViews: [],
        toolbarButtonsByLanguage: {},
      },
    };
  }

  const entries = fs.readdirSync(languagesDir, { withFileTypes: true });

  for (const dirent of entries) {
    if (!dirent.isDirectory()) continue;
    const single = await discoverSingleLanguage(path.join(languagesDir, dirent.name));
    if (!single) continue;
    normalizedLangs.push(single.language);
    wasmAssets.push(...single.wasmAssets);
    manifest.push(single.manifest);
    uiPanels.push(...single.ui.panels);
    if (single.ui.stencils.length > 0) {
      stencilsByLanguage[single.language.id] = single.ui.stencils;
    }
    if (single.ui.toolbarButtons.length > 0) {
      toolbarButtonsByLanguage[single.language.id] = single.ui.toolbarButtons;
    }
    uiSimulationCards.push(...single.ui.simulationCards);
    uiTreeViews.push(...single.ui.treeViews);
  }

  return {
    languages: normalizedLangs,
    wasmAssets,
    manifest,
    ui: {
      panels: uiPanels,
      stencilsByLanguage,
      simulationCards: uiSimulationCards,
      treeViews: uiTreeViews,
      toolbarButtonsByLanguage,
    },
  };
}
