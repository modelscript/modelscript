// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { HUB_DOMAIN_FILTERS } from "./component-hub-catalog.js";
import {
  buildHubEquationFallbackSvg,
  HUB_CURATED_OPEN_MODELS,
  type HubOpenModelItem,
  inferHubModelDomain,
} from "./open-model-catalog.js";
import { getEffectiveInstalledDependencies, type LspClientLike } from "./registry-tree-provider.js";
import { getNonce } from "./utils/nonce.js";

export type OpenModelViewMode = "split" | "diagram" | "code";

interface DiagramPreviewItemResult {
  svg: string;
  nodeCount: number;
  edgeCount: number;
}

interface WorkspaceModelCard {
  id: string;
  title: string;
  relativePath: string;
  uri: string;
  dialect: string;
  previewSvg?: string | undefined;
  nodeCount?: number | undefined;
  edgeCount?: number | undefined;
}

interface DynamicLibraryModelCard {
  id: string;
  title: string;
  fqn: string;
  kind: string;
  category: string;
  packageName: string;
  summary: string;
  previewSvg?: string | undefined;
  nodeCount?: number | undefined;
  edgeCount?: number | undefined;
}

let activeOpenModelPanel: vscode.WebviewPanel | undefined;

function detectDialectFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".sysml") || lower.endsWith(".sysml2")) return "sysml2";
  if (lower.endsWith(".pscx") || lower.endsWith(".pslx") || lower.endsWith(".pswx")) return "pscad";
  if (lower.endsWith(".sp") || lower.endsWith(".cir") || lower.endsWith(".net")) return "spice";
  if (lower.endsWith(".dss")) return "opendss";
  if (lower.endsWith(".raw")) return "psse";
  if (lower.endsWith(".urdf")) return "urdf";
  if (lower.endsWith(".swmm.inp")) return "swmm";
  if (lower.endsWith(".epanet.inp") || lower.endsWith(".inp")) return "epanet";
  if (lower.endsWith(".step") || lower.endsWith(".stp")) return "step";
  if (lower.endsWith(".scad")) return "scad";
  if (lower.endsWith(".owl") || lower.endsWith(".ttl") || lower.endsWith(".ofn")) return "owl2";
  return "modelica";
}

function isDarkColorTheme(): boolean {
  const kind = vscode.window.activeColorTheme?.kind;
  return kind !== vscode.ColorThemeKind?.Light && kind !== vscode.ColorThemeKind?.HighContrastLight;
}

async function writeMaterializedModelUri(filename: string, content: string): Promise<vscode.Uri> {
  const cleanName = filename.replace(/[^A-Za-z0-9_.-]/g, "_") || "OpenedModel.mo";
  const folders = vscode.workspace.workspaceFolders;
  const firstFolder = folders?.[0];

  const targetUri =
    firstFolder && firstFolder.uri.scheme === "memfs"
      ? vscode.Uri.joinPath(firstFolder.uri, "opened", cleanName)
      : vscode.Uri.parse(`memfs:/opened/${cleanName}`);

  const encoded = new TextEncoder().encode(content);
  try {
    await vscode.workspace.fs.writeFile(targetUri, encoded);
    return targetUri;
  } catch {
    if (firstFolder) {
      const wsTarget = vscode.Uri.joinPath(firstFolder.uri, cleanName);
      await vscode.workspace.fs.writeFile(wsTarget, encoded);
      return wsTarget;
    }
    return targetUri;
  }
}

async function openUriInRequestedView(docUri: vscode.Uri, viewMode: OpenModelViewMode): Promise<void> {
  if (viewMode === "code") {
    const doc = await vscode.workspace.openTextDocument(docUri);
    if (typeof vscode.window.showTextDocument === "function") {
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    }
    return;
  }

  if (viewMode === "diagram") {
    try {
      await vscode.workspace.openTextDocument(docUri);
    } catch {
      // Custom binary/step editors may not be text documents
    }
    await vscode.commands.executeCommand("modelscript.openDiagram", docUri);
    return;
  }

  // "split" — show source on left and schematic diagram beside it
  try {
    const doc = await vscode.workspace.openTextDocument(docUri);
    if (typeof vscode.window.showTextDocument === "function") {
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    }
  } catch {
    // Proceed to diagram editor even if non-text
  }
  await vscode.commands.executeCommand("modelscript.openDiagram", docUri);
}

/**
 * Opens a specific model target (from `LibraryTreeItem`, URI, or class FQN), or launches the visual
 * Open Model Hub when invoked without a target argument.
 */
export async function openModelTarget(
  context: vscode.ExtensionContext,
  arg: unknown,
  lspClient?: LspClientLike,
  viewMode: OpenModelViewMode = "split",
): Promise<boolean> {
  if (arg === undefined || arg === null) {
    openModelHub(context, lspClient, "gallery");
    return true;
  }

  if (arg instanceof vscode.Uri) {
    await openUriInRequestedView(arg, viewMode);
    return true;
  }

  let className: string | undefined;
  let explicitUri: string | undefined;

  if (typeof arg === "string") {
    if (arg.includes("://") || arg.startsWith("/")) {
      await openUriInRequestedView(vscode.Uri.parse(arg), viewMode);
      return true;
    }
    className = arg;
  } else if (typeof arg === "object") {
    const rec = arg as {
      className?: string | undefined;
      uri?: string | vscode.Uri | undefined;
      info?: { compositeName?: string | undefined; name?: string | undefined } | undefined;
    };
    className = rec.className || rec.info?.compositeName || rec.info?.name;
    if (rec.uri instanceof vscode.Uri) {
      explicitUri = rec.uri.toString();
    } else if (typeof rec.uri === "string" && rec.uri.length > 0) {
      explicitUri = rec.uri;
    }
  }

  // If explicit workspace file URI is given without a library className, open directly
  if (explicitUri && !className && (explicitUri.startsWith("file:") || explicitUri.startsWith("memfs:"))) {
    await openUriInRequestedView(vscode.Uri.parse(explicitUri), viewMode);
    return true;
  }

  if (!className) {
    openModelHub(context, lspClient, "gallery");
    return true;
  }

  // Try resolving standalone class source from LSP
  if (lspClient?.sendRequest) {
    try {
      const srcResp = await lspClient.sendRequest<{
        content?: string | null | undefined;
        uri?: string | undefined;
        error?: string | undefined;
      }>("modelscript/getClassSource", { className });

      if (srcResp?.content) {
        // If it already lives in a user workspace file (not a virtual/registry library archive), open in place
        if (
          srcResp.uri &&
          (srcResp.uri.startsWith("file:") || srcResp.uri.startsWith("memfs:")) &&
          !srcResp.uri.includes("/modelscript_registry/") &&
          !srcResp.uri.endsWith("/document.mo")
        ) {
          try {
            const candidate = vscode.Uri.parse(srcResp.uri);
            await vscode.workspace.fs.stat(candidate);
            await openUriInRequestedView(candidate, viewMode);
            return true;
          } catch {
            // Materialize extracted snippet below
          }
        }

        const shortName = className.split(".").pop() || "OpenedModel";
        const ext = srcResp.uri?.endsWith(".sysml") ? "sysml" : "mo";
        const targetUri = await writeMaterializedModelUri(`${shortName}.${ext}`, srcResp.content);
        await openUriInRequestedView(targetUri, viewMode);
        return true;
      }
    } catch {
      // Fall back to curated catalog match if available
    }
  }

  const curatedMatch = HUB_CURATED_OPEN_MODELS.find((m) => m.fqn === className || m.id === className);
  if (curatedMatch) {
    const targetUri = await writeMaterializedModelUri(curatedMatch.suggestedFilename, curatedMatch.fallbackCode);
    await openUriInRequestedView(targetUri, viewMode);
    return true;
  }

  vscode.window.showWarningMessage(`Could not locate model source for '${className}'.`);
  return false;
}

async function discoverWorkspaceModels(lspClient?: LspClientLike): Promise<WorkspaceModelCard[]> {
  const seenUris = new Set<string>();
  const cards: WorkspaceModelCard[] = [];

  if (typeof vscode.workspace.findFiles === "function") {
    try {
      const uris = await vscode.workspace.findFiles(
        "**/*.{mo,ms,sysml,sysml2,pscx,pslx,sp,dss,raw,urdf,inp}",
        "**/{node_modules,dist,.git,testsuite}/**",
        48,
      );
      for (const u of uris) {
        const key = u.toString();
        if (seenUris.has(key)) continue;
        seenUris.add(key);
        const fileName = u.path.split("/").pop() || u.path;
        const rel =
          typeof vscode.workspace.asRelativePath === "function" ? vscode.workspace.asRelativePath(u, false) : u.path;
        cards.push({
          id: `ws:${key}`,
          title: fileName.replace(/\.[^.]+$/, ""),
          relativePath: rel,
          uri: key,
          dialect: detectDialectFromPath(u.path),
        });
      }
    } catch {
      // Ignore if workspace FS does not support findFiles
    }
  }

  for (const doc of vscode.workspace.textDocuments ?? []) {
    const scheme = doc.uri.scheme;
    if (scheme === "output" || scheme === "vscode") continue;
    const key = doc.uri.toString();
    if (seenUris.has(key)) continue;
    const lowerPath = doc.uri.path.toLowerCase();
    if (!/\.(mo|ms|sysml|sysml2|pscx|pslx|sp|dss|raw|urdf|inp)$/.test(lowerPath)) continue;
    seenUris.add(key);
    const fileName = doc.uri.path.split("/").pop() || "Untitled";
    cards.push({
      id: `ws:${key}`,
      title: fileName.replace(/\.[^.]+$/, ""),
      relativePath: doc.uri.path,
      uri: key,
      dialect: detectDialectFromPath(doc.uri.path),
    });
  }

  if (cards.length > 0 && lspClient?.sendRequest) {
    try {
      const isDark = isDarkColorTheme();
      const resp = await lspClient.sendRequest<{ previews?: Record<string, DiagramPreviewItemResult> }>(
        "modelscript/getDiagramPreviewSvgs",
        {
          items: cards.slice(0, 24).map((c) => ({
            id: c.id,
            uri: c.uri,
            languageId: c.dialect,
          })),
          isDark,
        },
      );
      const previews = resp?.previews ?? {};
      for (const card of cards) {
        const hit = previews[card.id];
        if (hit) {
          card.previewSvg = hit.svg;
          card.nodeCount = hit.nodeCount;
          card.edgeCount = hit.edgeCount;
        } else {
          card.previewSvg = buildHubEquationFallbackSvg(card.title, card.relativePath, isDark);
        }
      }
    } catch {
      const isDark = isDarkColorTheme();
      for (const card of cards) {
        card.previewSvg = buildHubEquationFallbackSvg(card.title, card.relativePath, isDark);
      }
    }
  } else {
    const isDark = isDarkColorTheme();
    for (const card of cards) {
      card.previewSvg = buildHubEquationFallbackSvg(card.title, card.relativePath, isDark);
    }
  }

  return cards;
}

async function hydrateCuratedModelPreviews(panel: vscode.WebviewPanel, lspClient?: LspClientLike): Promise<void> {
  if (!lspClient?.sendRequest) return;
  try {
    const installed = await getEffectiveInstalledDependencies(lspClient);
    const installedLower = new Set(Object.keys(installed).map((k) => k.toLowerCase()));
    const items = HUB_CURATED_OPEN_MODELS.filter(
      (m) => m.fqn && (m.bundledByDefault || installedLower.has(m.packageName.toLowerCase())),
    ).map((m) => ({
      id: m.id,
      className: m.fqn,
      languageId: m.dialect,
    }));
    if (items.length === 0) return;

    const resp = await lspClient.sendRequest<{ previews?: Record<string, DiagramPreviewItemResult> }>(
      "modelscript/getDiagramPreviewSvgs",
      { items, isDark: isDarkColorTheme() },
    );
    if (resp?.previews && Object.keys(resp.previews).length > 0) {
      await panel.webview.postMessage({
        command: "setDiagramPreviews",
        previews: resp.previews,
      });
    }
  } catch {
    // Keep curated connected schematic SVGs when LSP is still warming up
  }
}

export function renderOpenModelHubHtml(options: {
  nonce: string;
  cspSource: string;
  initialMode?: "gallery" | "workspace" | "local" | undefined;
}): string {
  const { nonce, cspSource, initialMode = "gallery" } = options;
  const serializedCatalog = JSON.stringify(HUB_CURATED_OPEN_MODELS).replace(/</g, "\\u003c");
  const serializedDomains = JSON.stringify(HUB_DOMAIN_FILTERS).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data: https:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Open Model</title>
  <style>
    :root {
      --hub-bg: var(--vscode-editor-background, #0b1120);
      --hub-panel: var(--vscode-sideBar-background, #0f172a);
      --hub-card: var(--vscode-editorWidget-background, #111827);
      --hub-stage: color-mix(in srgb, var(--vscode-editor-background, #0b1120) 88%, #020617);
      --hub-border: var(--vscode-panel-border, rgba(148, 163, 184, 0.2));
      --hub-fg: var(--vscode-editor-foreground, #f8fafc);
      --hub-muted: var(--vscode-descriptionForeground, #94a3b8);
      --hub-brand: var(--vscode-button-background, #2563eb);
      --hub-brand-fg: var(--vscode-button-foreground, #ffffff);
      --hub-ok-bg: rgba(16, 185, 129, 0.16);
      --hub-ok-fg: #34d399;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background: var(--hub-bg);
      color: var(--hub-fg);
      font-family: var(--vscode-font-family, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .hub-header {
      padding: 16px 24px;
      border-bottom: 1px solid var(--hub-border);
      background: var(--hub-panel);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .hub-title-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .hub-glyph {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: rgba(37, 99, 235, 0.16);
      border: 1px solid rgba(96, 165, 250, 0.32);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #60a5fa;
      flex-shrink: 0;
    }
    .hub-title { font-size: 16px; font-weight: 700; margin: 0; }
    .hub-subtitle { font-size: 12px; color: var(--hub-muted); margin-top: 2px; }
    .segmented {
      display: inline-flex;
      padding: 3px;
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.55);
      border: 1px solid var(--hub-border);
      gap: 2px;
    }
    .seg-btn {
      border: none;
      background: transparent;
      color: var(--hub-muted);
      padding: 6px 13px;
      border-radius: 7px;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
    }
    .seg-btn.active {
      background: var(--hub-card);
      color: var(--hub-fg);
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }
    .toolbar {
      padding: 12px 24px;
      border-bottom: 1px solid var(--hub-border);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .search-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .search-input {
      flex: 1 1 280px;
      height: 36px;
      padding: 0 12px;
      border-radius: 8px;
      border: 1px solid var(--hub-border);
      background: var(--vscode-input-background, #0f172a);
      color: var(--vscode-input-foreground, var(--hub-fg));
      font-size: 13px;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--hub-brand);
    }
    .pkg-select, .ghost-btn {
      height: 36px;
      padding: 0 12px;
      border-radius: 8px;
      border: 1px solid var(--hub-border);
      background: var(--vscode-input-background, transparent);
      color: var(--hub-fg);
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
    }
    .domain-pills {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 2px;
    }
    .domain-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 11px;
      border-radius: 999px;
      border: 1px solid var(--hub-border);
      background: transparent;
      color: var(--hub-muted);
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .domain-pill.active {
      border-color: var(--hub-brand);
      background: rgba(37, 99, 235, 0.16);
      color: var(--hub-fg);
      font-weight: 600;
    }
    .content-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 18px 24px;
    }
    .model-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 14px;
    }
    .model-card {
      border-radius: 12px;
      border: 1.5px solid var(--hub-border);
      background: var(--hub-card);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      cursor: pointer;
      transition: border-color 0.14s ease, transform 0.12s ease;
    }
    .model-card:hover {
      border-color: color-mix(in srgb, var(--hub-brand) 65%, var(--hub-border));
    }
    .model-card.selected {
      border-color: var(--hub-brand);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
    }
    .diagram-stage {
      position: relative;
      height: 148px;
      background-color: var(--hub-stage);
      background-image: radial-gradient(rgba(148, 163, 184, 0.14) 1px, transparent 1px);
      background-size: 14px 14px;
      border-bottom: 1px solid var(--hub-border);
      padding: 8px 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .diagram-stage-inner {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .stage-pill {
      position: absolute;
      padding: 2px 7px;
      border-radius: 6px;
      font-size: 10.5px;
      font-weight: 700;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid var(--hub-border);
      color: #f8fafc;
    }
    .stage-pill.top-left { top: 8px; left: 8px; }
    .stage-pill.bottom-right { bottom: 7px; right: 8px; font-weight: 600; color: #cbd5e1; font-size: 10px; }
    .card-body {
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
    }
    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .card-title {
      font-size: 13.5px;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mount-badge {
      font-size: 10.5px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 999px;
      flex-shrink: 0;
      background: rgba(59, 130, 246, 0.16);
      color: #93c5fd;
    }
    .mount-badge.mounted {
      background: var(--hub-ok-bg);
      color: var(--hub-ok-fg);
    }
    .card-summary {
      font-size: 11.5px;
      color: var(--hub-muted);
      line-height: 1.42;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      min-height: 32px;
    }
    .card-footer {
      margin-top: auto;
      padding-top: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .card-fqn {
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--hub-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .btn-row { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .btn-primary {
      border: none;
      background: var(--hub-brand);
      color: var(--hub-brand-fg);
      border-radius: 7px;
      padding: 5px 11px;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-secondary {
      border: 1px solid var(--hub-border);
      background: transparent;
      color: var(--hub-fg);
      border-radius: 7px;
      padding: 5px 9px;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
    }
    .inspector-bar {
      padding: 12px 24px;
      border-top: 1px solid var(--hub-border);
      background: var(--hub-panel);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .local-layout {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 18px;
    }
    .dropzone {
      min-height: 240px;
      border-radius: 14px;
      border: 2px dashed var(--hub-border);
      background: var(--hub-panel);
      padding: 28px 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 10px;
      cursor: pointer;
    }
    .dropzone.dragging {
      border-color: var(--hub-brand);
      background: rgba(37, 99, 235, 0.1);
    }
    .empty-state {
      padding: 52px 20px;
      text-align: center;
      color: var(--hub-muted);
    }
  </style>
</head>
<body>
  <div class="hub-header">
    <div class="hub-title-row">
      <div class="hub-glyph">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="2" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.4"/>
          <rect x="10" y="2" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.4"/>
          <rect x="5.75" y="9.5" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.4"/>
          <path d="M6 4.25H10M3.75 6.5V11.75H5.75M12.25 6.5V11.75H10.25" stroke="currentColor" stroke-width="1.3"/>
        </svg>
      </div>
      <div>
        <h1 class="hub-title">Open Model</h1>
        <div class="hub-subtitle">Visual schematic model picker — Ansatz libraries, workspace files &amp; local archives</div>
      </div>
    </div>

    <div class="btn-row">
      <div class="segmented" role="tablist" aria-label="Model source">
        <button type="button" class="seg-btn" data-action="set-mode" data-mode="gallery">Examples &amp; Libraries</button>
        <button type="button" class="seg-btn" data-action="set-mode" data-mode="workspace" id="tab-workspace">Workspace Files</button>
        <button type="button" class="seg-btn" data-action="set-mode" data-mode="local">Local File / Archive</button>
      </div>
      <button type="button" class="ghost-btn" data-action="open-library-hub">Components &amp; Libraries…</button>
    </div>
  </div>

  <div id="gallery-toolbar" class="toolbar">
    <div class="search-row">
      <input id="search-input" class="search-input" type="text" placeholder="Search runnable models, circuits, mechanisms, or FQNs (e.g. Chua, PID, Hydronic, IEEE 13)..." />
      <select id="package-select" class="pkg-select" aria-label="Filter by package">
        <option value="all">All Packages</option>
      </select>
    </div>
    <div id="domain-pills" class="domain-pills"></div>
  </div>

  <div id="main-scroll" class="content-scroll"></div>
  <div id="inspector-bar" class="inspector-bar"></div>
  <input id="hidden-file-input" type="file" accept=".mo,.ms,.mos,.sysml,.sysml2,.sp,.cir,.net,.dss,.raw,.pscx,.pslx,.urdf,.inp,.scad,.step,.stp,.fmu,.ssp,.zip,.owl,.ttl" style="display:none" />

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const CATALOG = ${serializedCatalog};
      const DOMAINS = ${serializedDomains};

      const state = {
        mode: ${JSON.stringify(initialMode)},
        domain: "all",
        packageFilter: "all",
        query: "",
        selectedId: CATALOG[0] ? CATALOG[0].id : "",
        installed: {},
        livePreviews: {},
        dynamicModels: [],
        workspaceModels: [],
        busyId: null,
        stagedLocal: null,
      };

      const searchInput = document.getElementById("search-input");
      const packageSelect = document.getElementById("package-select");
      const domainPillsEl = document.getElementById("domain-pills");
      const galleryToolbar = document.getElementById("gallery-toolbar");
      const mainScroll = document.getElementById("main-scroll");
      const inspectorBar = document.getElementById("inspector-bar");
      const hiddenFileInput = document.getElementById("hidden-file-input");
      const workspaceTabBtn = document.getElementById("tab-workspace");

      function escapeHtml(str) {
        return String(str || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function isPackageMounted(pkgName, bundledByDefault) {
        if (bundledByDefault) return true;
        const lower = String(pkgName || "").toLowerCase();
        return Object.keys(state.installed).some((k) => k.toLowerCase() === lower);
      }

      function syncPackageDropdown() {
        const pkgs = new Set();
        CATALOG.forEach((m) => pkgs.add(m.packageName));
        Object.keys(state.installed).forEach((k) => pkgs.add(k));
        const sorted = Array.from(pkgs).sort((a, b) => a.localeCompare(b));
        const current = state.packageFilter;
        packageSelect.innerHTML =
          '<option value="all">All Packages (' + sorted.length + ')</option>' +
          sorted.map((p) => '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>').join("");
        packageSelect.value = sorted.includes(current) ? current : "all";
      }

      function renderDomainPills() {
        domainPillsEl.innerHTML = DOMAINS.map((d) => {
          const active = state.domain === d.id ? " active" : "";
          return (
            '<button type="button" class="domain-pill' + active + '" data-action="set-domain" data-domain="' + escapeHtml(d.id) + '">' +
            '<svg width="13" height="13" viewBox="0 0 16 16" fill="none">' + d.svgInner + '</svg>' +
            escapeHtml(d.label) +
            '</button>'
          );
        }).join("");
      }

      function getFilteredCurated() {
        const q = state.query.trim().toLowerCase();
        return CATALOG.filter((m) => {
          if (state.domain !== "all" && m.category !== state.domain) return false;
          if (state.packageFilter !== "all" && m.packageName.toLowerCase() !== state.packageFilter.toLowerCase()) return false;
          if (!q) return true;
          const hay = (m.title + " " + (m.fqn || "") + " " + m.packageName + " " + m.dialectLabel + " " + m.summary + " " + (m.keywords || []).join(" ")).toLowerCase();
          return hay.indexOf(q) !== -1;
        });
      }

      function render() {
        document.querySelectorAll(".seg-btn").forEach((btn) => {
          btn.classList.toggle("active", btn.getAttribute("data-mode") === state.mode);
        });
        if (workspaceTabBtn) {
          workspaceTabBtn.textContent =
            state.workspaceModels.length > 0
              ? "Workspace Files (" + state.workspaceModels.length + ")"
              : "Workspace Files";
        }
        galleryToolbar.style.display = state.mode === "gallery" ? "flex" : "none";

        if (state.mode === "gallery") {
          renderDomainPills();
          renderGallery();
        } else if (state.mode === "workspace") {
          inspectorBar.style.display = "none";
          renderWorkspace();
        } else {
          inspectorBar.style.display = "none";
          renderLocal();
        }
      }

      function renderGallery() {
        const curated = getFilteredCurated();
        const dyn = state.dynamicModels.filter((d) => {
          if (state.domain !== "all" && d.category !== state.domain) return false;
          if (state.packageFilter !== "all" && d.packageName.toLowerCase() !== state.packageFilter.toLowerCase()) return false;
          return true;
        });

        if (curated.length === 0 && dyn.length === 0) {
          mainScroll.innerHTML =
            '<div class="empty-state">' +
            '<div style="font-size:15px;font-weight:700;color:var(--hub-fg);margin-bottom:6px">No matching models found</div>' +
            '<div>Clear filters or switch to <strong>Workspace Files</strong> or <strong>Local File / Archive</strong>.</div>' +
            '</div>';
          inspectorBar.style.display = "none";
          return;
        }

        const cardsHtml = curated.map((item) => {
          const live = state.livePreviews[item.id];
          const mounted = isPackageMounted(item.packageName, item.bundledByDefault);
          const selected = state.selectedId === item.id ? " selected" : "";
          const busy = state.busyId === item.id;
          const nodes = live ? live.nodeCount : item.nodeCount;
          const edges = live ? live.edgeCount : item.edgeCount;
          const svg = live && live.svg ? live.svg : item.diagramSvg;
          return (
            '<div class="model-card' + selected + '" data-action="select-card" data-id="' + escapeHtml(item.id) + '">' +
              '<div class="diagram-stage">' +
                '<div class="diagram-stage-inner">' + svg + '</div>' +
                '<span class="stage-pill top-left">' + escapeHtml(item.dialectLabel) + '</span>' +
                '<span class="stage-pill bottom-right">' + nodes + ' blocks · ' + edges + ' nets</span>' +
              '</div>' +
              '<div class="card-body">' +
                '<div class="card-top">' +
                  '<div class="card-title">' + escapeHtml(item.title) + '</div>' +
                  '<span class="mount-badge' + (mounted ? " mounted" : "") + '">' +
                    escapeHtml(mounted ? item.packageName + " ✓" : "+ " + item.packageName) +
                  '</span>' +
                '</div>' +
                '<div class="card-summary">' + escapeHtml(item.summary) + '</div>' +
                '<div class="card-footer">' +
                  '<span class="card-fqn" title="' + escapeHtml(item.fqn || item.suggestedFilename) + '">' +
                    escapeHtml(item.fqn || item.suggestedFilename) +
                  '</span>' +
                  '<div class="btn-row">' +
                    '<button type="button" class="btn-secondary" data-action="open-curated" data-id="' + escapeHtml(item.id) + '" data-view="diagram">' +
                      'Diagram' +
                    '</button>' +
                    '<button type="button" class="btn-primary" data-action="open-curated" data-id="' + escapeHtml(item.id) + '" data-view="split">' +
                      (busy ? "Opening…" : "Open") +
                    '</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>'
          );
        }).concat(dyn.map((item) => {
          const live = state.livePreviews[item.id];
          const selected = state.selectedId === item.id ? " selected" : "";
          const svg = (live && live.svg) || item.previewSvg || "";
          const badge = live ? (live.nodeCount + " blocks · " + live.edgeCount + " nets") : "Library model";
          return (
            '<div class="model-card' + selected + '" data-action="select-card" data-id="' + escapeHtml(item.id) + '">' +
              '<div class="diagram-stage">' +
                '<div class="diagram-stage-inner">' + svg + '</div>' +
                '<span class="stage-pill top-left">' + escapeHtml(item.kind) + '</span>' +
                '<span class="stage-pill bottom-right">' + escapeHtml(badge) + '</span>' +
              '</div>' +
              '<div class="card-body">' +
                '<div class="card-top">' +
                  '<div class="card-title">' + escapeHtml(item.title) + '</div>' +
                  '<span class="mount-badge mounted">' + escapeHtml(item.packageName) + ' ✓</span>' +
                '</div>' +
                '<div class="card-summary">' + escapeHtml(item.summary) + '</div>' +
                '<div class="card-footer">' +
                  '<span class="card-fqn" title="' + escapeHtml(item.fqn) + '">' + escapeHtml(item.fqn) + '</span>' +
                  '<button type="button" class="btn-primary" data-action="open-dynamic" data-fqn="' + escapeHtml(item.fqn) + '" data-view="split">Open</button>' +
                '</div>' +
              '</div>' +
            '</div>'
          );
        }));

        mainScroll.innerHTML = '<div class="model-grid">' + cardsHtml.join("") + '</div>';

        const selCurated = CATALOG.find((c) => c.id === state.selectedId) || curated[0];
        if (selCurated) {
          inspectorBar.style.display = "flex";
          const mounted = isPackageMounted(selCurated.packageName, selCurated.bundledByDefault);
          inspectorBar.innerHTML =
            '<div>' +
              '<div style="font-size:13px;font-weight:700">' + escapeHtml(selCurated.title) + '</div>' +
              '<div style="font-size:11.5px;color:var(--hub-muted)">' +
                escapeHtml(
                  mounted
                    ? (selCurated.fqn || selCurated.suggestedFilename) + " · " + selCurated.packageName + "@" + selCurated.packageVersion + " ready"
                    : "Auto-installs Ansatz package " + selCurated.packageName + "@" + selCurated.packageVersion + " before opening"
                ) +
              '</div>' +
            '</div>' +
            '<div class="btn-row">' +
              '<button type="button" class="btn-secondary" data-action="open-curated" data-id="' + escapeHtml(selCurated.id) + '" data-view="code">Open Code Only</button>' +
              '<button type="button" class="btn-secondary" data-action="open-curated" data-id="' + escapeHtml(selCurated.id) + '" data-view="diagram">Open Full Diagram</button>' +
              '<button type="button" class="btn-primary" data-action="open-curated" data-id="' + escapeHtml(selCurated.id) + '" data-view="split">Open in Split View</button>' +
            '</div>';
        } else {
          inspectorBar.style.display = "none";
        }
      }

      function renderWorkspace() {
        if (!state.workspaceModels.length) {
          mainScroll.innerHTML =
            '<div class="empty-state">' +
              '<div style="font-size:15px;font-weight:700;color:var(--hub-fg);margin-bottom:6px">No model files found in current workspace</div>' +
              '<div style="margin-bottom:14px">Open an example from <strong>Examples &amp; Libraries</strong> or pick a local file.</div>' +
              '<button type="button" class="btn-primary" data-action="pick-native-file">Browse Local File…</button>' +
            '</div>';
          return;
        }

        mainScroll.innerHTML =
          '<div class="model-grid">' +
          state.workspaceModels.map((w) => {
            const topo = typeof w.nodeCount === "number" ? (w.nodeCount + " blocks · " + (w.edgeCount || 0) + " nets") : "Workspace file";
            return (
              '<div class="model-card" data-action="open-workspace-uri" data-uri="' + escapeHtml(w.uri) + '" data-view="split">' +
                '<div class="diagram-stage">' +
                  '<div class="diagram-stage-inner">' + (w.previewSvg || "") + '</div>' +
                  '<span class="stage-pill top-left">' + escapeHtml(w.dialect) + '</span>' +
                  '<span class="stage-pill bottom-right">' + escapeHtml(topo) + '</span>' +
                '</div>' +
                '<div class="card-body">' +
                  '<div class="card-title">' + escapeHtml(w.title) + '</div>' +
                  '<div class="card-fqn" title="' + escapeHtml(w.relativePath) + '">' + escapeHtml(w.relativePath) + '</div>' +
                  '<div class="card-footer">' +
                    '<button type="button" class="btn-secondary" data-action="open-workspace-uri" data-uri="' + escapeHtml(w.uri) + '" data-view="code">Code</button>' +
                    '<div class="btn-row">' +
                      '<button type="button" class="btn-secondary" data-action="open-workspace-uri" data-uri="' + escapeHtml(w.uri) + '" data-view="diagram">Diagram</button>' +
                      '<button type="button" class="btn-primary" data-action="open-workspace-uri" data-uri="' + escapeHtml(w.uri) + '" data-view="split">Open</button>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
              '</div>'
            );
          }).join("") +
          '</div>';
      }

      function renderLocal() {
        const staged = state.stagedLocal;
        const stagedHtml = staged
          ? '<div class="model-card selected" style="cursor:default">' +
              '<div class="diagram-stage" style="height:230px">' +
                '<div class="diagram-stage-inner">' + (staged.previewSvg || '<div style="color:var(--hub-muted);font-size:12.5px">Rendering schematic preview…</div>') + '</div>' +
                '<span class="stage-pill top-left">' + escapeHtml(staged.dialect) + '</span>' +
                '<span class="stage-pill bottom-right">' +
                  escapeHtml(typeof staged.nodeCount === "number" && staged.nodeCount > 0 ? (staged.nodeCount + " blocks · " + (staged.edgeCount || 0) + " nets") : "Equation / text model") +
                '</span>' +
              '</div>' +
              '<div class="card-body">' +
                '<div class="card-title">' + escapeHtml(staged.filename) + '</div>' +
                '<div class="card-summary">Live schematic preview generated from selected file. Ready to open into your workspace.</div>' +
                '<div class="card-footer">' +
                  '<button type="button" class="btn-secondary" data-action="clear-staged">Clear</button>' +
                  '<div class="btn-row">' +
                    '<button type="button" class="btn-secondary" data-action="open-staged" data-view="diagram">Open Full Diagram</button>' +
                    '<button type="button" class="btn-primary" data-action="open-staged" data-view="split">Open in Split View</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>'
          : "";

        mainScroll.innerHTML =
          '<div class="local-layout">' +
            '<div style="display:flex;flex-direction:column;gap:14px">' +
              '<div id="local-dropzone" class="dropzone" data-action="trigger-file-input">' +
                '<div style="font-size:15px;font-weight:700">Drop a model file here to preview its diagram</div>' +
                '<div style="font-size:12px;color:var(--hub-muted);max-width:420px;line-height:1.5">' +
                  'Supports <strong>.mo</strong>, <strong>.sysml</strong>, <strong>.sp</strong>, <strong>.dss</strong>, <strong>.raw</strong>, <strong>.pscx</strong>, <strong>.urdf</strong>, <strong>.inp</strong>, <strong>.fmu</strong>, <strong>.ssp</strong>, and Ansatz <strong>.zip</strong> packages' +
                '</div>' +
                '<div class="btn-row" style="margin-top:8px">' +
                  '<button type="button" class="btn-primary" data-action="pick-native-file">Choose File from Disk…</button>' +
                  '<button type="button" class="btn-secondary" data-action="import-zip">Mount Library .zip…</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
            stagedHtml +
          '</div>';
      }

      // Delegated click handler (100% CSP clean — zero inline onclick attributes)
      document.addEventListener("click", (ev) => {
        const target = ev.target && ev.target.closest ? ev.target.closest("[data-action]") : null;
        if (!target) return;
        const action = target.getAttribute("data-action");

        if (action === "set-mode") {
          const nextMode = target.getAttribute("data-mode") || "gallery";
          state.mode = nextMode;
          if (nextMode === "workspace") {
            vscode.postMessage({ command: "refreshWorkspaceModels" });
          }
          render();
          return;
        }
        if (action === "set-domain") {
          state.domain = target.getAttribute("data-domain") || "all";
          render();
          return;
        }
        if (action === "select-card") {
          state.selectedId = target.getAttribute("data-id") || "";
          render();
          return;
        }
        if (action === "open-curated") {
          ev.stopPropagation();
          const id = target.getAttribute("data-id") || "";
          const viewMode = target.getAttribute("data-view") || "split";
          state.busyId = id;
          render();
          vscode.postMessage({ command: "openCuratedModel", id, viewMode });
          return;
        }
        if (action === "open-dynamic") {
          ev.stopPropagation();
          const fqn = target.getAttribute("data-fqn") || "";
          const viewMode = target.getAttribute("data-view") || "split";
          vscode.postMessage({ command: "openDynamicModel", fqn, viewMode });
          return;
        }
        if (action === "open-workspace-uri") {
          ev.stopPropagation();
          const uri = target.getAttribute("data-uri") || "";
          const viewMode = target.getAttribute("data-view") || "split";
          vscode.postMessage({ command: "openWorkspaceUri", uri, viewMode });
          return;
        }
        if (action === "pick-native-file") {
          ev.stopPropagation();
          vscode.postMessage({ command: "pickNativeFile" });
          return;
        }
        if (action === "import-zip") {
          ev.stopPropagation();
          vscode.postMessage({ command: "importZipArchive" });
          return;
        }
        if (action === "trigger-file-input") {
          hiddenFileInput.click();
          return;
        }
        if (action === "clear-staged") {
          state.stagedLocal = null;
          render();
          return;
        }
        if (action === "open-staged") {
          if (!state.stagedLocal) return;
          const viewMode = target.getAttribute("data-view") || "split";
          vscode.postMessage({
            command: "openStagedText",
            filename: state.stagedLocal.filename,
            code: state.stagedLocal.code,
            viewMode,
          });
          return;
        }
        if (action === "open-library-hub") {
          vscode.postMessage({ command: "openLibraryHub" });
        }
      });

      let searchTimer = null;
      searchInput.addEventListener("input", () => {
        state.query = searchInput.value || "";
        render();
        if (searchTimer) clearTimeout(searchTimer);
        const trimmed = state.query.trim();
        if (trimmed.length >= 2) {
          searchTimer = setTimeout(() => {
            vscode.postMessage({ command: "searchLibraryModels", query: trimmed });
          }, 180);
        } else {
          state.dynamicModels = [];
          render();
        }
      });

      packageSelect.addEventListener("change", () => {
        state.packageFilter = packageSelect.value || "all";
        render();
      });

      function stageDroppedOrPickedBrowserFile(file) {
        if (!file) return;
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".zip") || lower.endsWith(".fmu") || lower.endsWith(".ssp")) {
          const reader = new FileReader();
          reader.onload = () => {
            const buf = new Uint8Array(reader.result);
            let bin = "";
            for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
            vscode.postMessage({
              command: "handleBinaryArchive",
              filename: file.name,
              base64: btoa(bin),
            });
          };
          reader.readAsArrayBuffer(file);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const code = String(reader.result || "");
          state.stagedLocal = {
            filename: file.name,
            code,
            dialect: file.name.split(".").pop() || "modelica",
            previewSvg: "",
          };
          render();
          vscode.postMessage({
            command: "previewStagedText",
            filename: file.name,
            code,
          });
        };
        reader.readAsText(file);
      }

      hiddenFileInput.addEventListener("change", () => {
        const f = hiddenFileInput.files && hiddenFileInput.files[0];
        if (f) stageDroppedOrPickedBrowserFile(f);
        hiddenFileInput.value = "";
      });

      document.addEventListener("dragover", (ev) => {
        const dz = document.getElementById("local-dropzone");
        if (dz) {
          ev.preventDefault();
          dz.classList.add("dragging");
        }
      });

      document.addEventListener("dragleave", () => {
        const dz = document.getElementById("local-dropzone");
        if (dz) dz.classList.remove("dragging");
      });

      document.addEventListener("drop", (ev) => {
        const dz = document.getElementById("local-dropzone");
        if (!dz) return;
        ev.preventDefault();
        dz.classList.remove("dragging");
        const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
        if (f) stageDroppedOrPickedBrowserFile(f);
      });

      window.addEventListener("message", (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.command === "setInstalled") {
          state.installed = msg.dependencies || {};
          syncPackageDropdown();
          render();
        } else if (msg.command === "setDiagramPreviews") {
          state.livePreviews = Object.assign({}, state.livePreviews, msg.previews || {});
          render();
        } else if (msg.command === "setDynamicModels") {
          state.dynamicModels = msg.models || [];
          render();
        } else if (msg.command === "setWorkspaceModels") {
          state.workspaceModels = msg.models || [];
          render();
        } else if (msg.command === "setStagedFile") {
          state.mode = "local";
          state.stagedLocal = msg.staged || null;
          render();
        } else if (msg.command === "clearBusy") {
          state.busyId = null;
          render();
        } else if (msg.command === "switchMode") {
          state.mode = msg.mode || "gallery";
          render();
        }
      });

      syncPackageDropdown();
      render();
      vscode.postMessage({ command: "ready" });
    })();
  </script>
</body>
</html>`;
}

export function openModelHub(
  context: vscode.ExtensionContext,
  lspClient?: LspClientLike,
  initialMode: "gallery" | "workspace" | "local" = "gallery",
): vscode.WebviewPanel {
  if (activeOpenModelPanel) {
    activeOpenModelPanel.reveal(vscode.ViewColumn.One);
    void activeOpenModelPanel.webview.postMessage({ command: "switchMode", mode: initialMode });
    return activeOpenModelPanel;
  }

  const panel = vscode.window.createWebviewPanel("modelscript.openModelHub", "Open Model", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  activeOpenModelPanel = panel;

  const nonce = getNonce();
  panel.webview.html = renderOpenModelHubHtml({
    nonce,
    cspSource: panel.webview.cspSource,
    initialMode,
  });

  const syncHubState = async () => {
    const deps = await getEffectiveInstalledDependencies(lspClient);
    await panel.webview.postMessage({ command: "setInstalled", dependencies: deps });
    await hydrateCuratedModelPreviews(panel, lspClient);
    const wsModels = await discoverWorkspaceModels(lspClient);
    await panel.webview.postMessage({ command: "setWorkspaceModels", models: wsModels });
  };

  panel.onDidDispose(
    () => {
      if (activeOpenModelPanel === panel) {
        activeOpenModelPanel = undefined;
      }
    },
    null,
    context.subscriptions,
  );

  panel.webview.onDidReceiveMessage(
    async (msg: {
      command?: string;
      id?: string;
      fqn?: string;
      uri?: string;
      query?: string;
      viewMode?: OpenModelViewMode;
      filename?: string;
      code?: string;
      base64?: string;
    }) => {
      switch (msg.command) {
        case "ready": {
          await syncHubState();
          break;
        }

        case "refreshWorkspaceModels": {
          const wsModels = await discoverWorkspaceModels(lspClient);
          await panel.webview.postMessage({ command: "setWorkspaceModels", models: wsModels });
          break;
        }

        case "openLibraryHub": {
          await vscode.commands.executeCommand("modelscript.libraryView.addPackage");
          break;
        }

        case "importZipArchive": {
          await vscode.commands.executeCommand("modelscript.libraryView.importZip");
          await syncHubState();
          break;
        }

        case "openCuratedModel": {
          const item: HubOpenModelItem | undefined = HUB_CURATED_OPEN_MODELS.find((m) => m.id === msg.id);
          if (!item) {
            await panel.webview.postMessage({ command: "clearBusy" });
            return;
          }
          try {
            const deps = await getEffectiveInstalledDependencies(lspClient);
            const isMounted =
              Boolean(item.bundledByDefault) ||
              Object.keys(deps).some((k) => k.toLowerCase() === item.packageName.toLowerCase());
            if (!isMounted) {
              await vscode.commands.executeCommand(
                "modelscript.registry.install",
                item.packageName,
                item.packageVersion,
              );
            }

            let resolvedCode = item.fallbackCode;
            if (item.fqn && lspClient?.sendRequest) {
              try {
                const src = await lspClient.sendRequest<{ content?: string | null }>("modelscript/getClassSource", {
                  className: item.fqn,
                });
                if (src?.content && src.content.trim().length > 0) {
                  resolvedCode = src.content;
                }
              } catch {
                // fallbackCode is already runnable
              }
            }

            const targetUri = await writeMaterializedModelUri(item.suggestedFilename, resolvedCode);
            await openUriInRequestedView(targetUri, msg.viewMode ?? "split");
            await syncHubState();
          } finally {
            await panel.webview.postMessage({ command: "clearBusy" });
          }
          break;
        }

        case "openDynamicModel": {
          if (msg.fqn) {
            await openModelTarget(context, msg.fqn, lspClient, msg.viewMode ?? "split");
          }
          break;
        }

        case "openWorkspaceUri": {
          if (msg.uri) {
            await openUriInRequestedView(vscode.Uri.parse(msg.uri), msg.viewMode ?? "split");
          }
          break;
        }

        case "searchLibraryModels": {
          if (!msg.query || !lspClient?.sendRequest) break;
          try {
            const resp = await lspClient.sendRequest<{
              results?: Array<{ name: string; compositeName: string; kind: string; description?: string }>;
            }>("modelscript/searchClasses", { query: msg.query, limit: 20 });

            const curatedFqns = new Set(HUB_CURATED_OPEN_MODELS.map((m) => m.fqn).filter(Boolean));
            const dynamicModels: DynamicLibraryModelCard[] = [];
            const isDark = isDarkColorTheme();

            for (const r of resp?.results ?? []) {
              const kindLower = (r.kind || "").toLowerCase();
              if (kindLower !== "model" && kindLower !== "block" && kindLower !== "class") continue;
              if (curatedFqns.has(r.compositeName)) continue;
              dynamicModels.push({
                id: `dyn:${r.compositeName}`,
                title: r.name,
                fqn: r.compositeName,
                kind: kindLower,
                category: inferHubModelDomain(r.compositeName, "modelica"),
                packageName: r.compositeName.split(".")[0] || "Workspace",
                summary: r.description || `${r.kind} in ${r.compositeName}`,
                previewSvg: buildHubEquationFallbackSvg(r.name, r.compositeName, isDark),
              });
              if (dynamicModels.length >= 12) break;
            }

            if (dynamicModels.length > 0) {
              const prevResp = await lspClient.sendRequest<{ previews?: Record<string, DiagramPreviewItemResult> }>(
                "modelscript/getDiagramPreviewSvgs",
                {
                  items: dynamicModels.map((d) => ({ id: d.id, className: d.fqn, languageId: "modelica" })),
                  isDark,
                },
              );
              for (const d of dynamicModels) {
                const hit = prevResp?.previews?.[d.id];
                if (hit) {
                  d.previewSvg = hit.svg;
                  d.nodeCount = hit.nodeCount;
                  d.edgeCount = hit.edgeCount;
                }
              }
            }

            await panel.webview.postMessage({ command: "setDynamicModels", models: dynamicModels });
          } catch {
            // ignore transient search errors
          }
          break;
        }

        case "previewStagedText": {
          const filename = msg.filename || "LocalModel.mo";
          const code = msg.code || "";
          const dialect = detectDialectFromPath(filename);
          const isDark = isDarkColorTheme();
          let previewSvg = buildHubEquationFallbackSvg(filename.replace(/\.[^.]+$/, ""), filename, isDark);
          let nodeCount = 0;
          let edgeCount = 0;

          if (lspClient?.sendRequest && code.trim().length > 0) {
            try {
              const prevResp = await lspClient.sendRequest<{ previews?: Record<string, DiagramPreviewItemResult> }>(
                "modelscript/getDiagramPreviewSvgs",
                {
                  items: [
                    {
                      id: "staged",
                      uri: `file:///__staged_${filename}`,
                      documentText: code,
                      languageId: dialect,
                    },
                  ],
                  isDark,
                },
              );
              const hit = prevResp?.previews?.["staged"];
              if (hit) {
                previewSvg = hit.svg;
                nodeCount = hit.nodeCount;
                edgeCount = hit.edgeCount;
              }
            } catch {
              // keep fallback preview
            }
          }

          await panel.webview.postMessage({
            command: "setStagedFile",
            staged: { filename, code, dialect, previewSvg, nodeCount, edgeCount },
          });
          break;
        }

        case "openStagedText": {
          const filename = msg.filename || "LocalModel.mo";
          const code = msg.code || "";
          const targetUri = await writeMaterializedModelUri(filename, code);
          await openUriInRequestedView(targetUri, msg.viewMode ?? "split");
          break;
        }

        case "handleBinaryArchive": {
          const filename = msg.filename || "Archive.zip";
          const base64 = msg.base64 || "";
          if (filename.toLowerCase().endsWith(".fmu") && lspClient?.sendRequest) {
            const fmuName = filename.replace(/\.fmu$/i, "") || "ImportedFMU";
            await lspClient.sendRequest("modelscript/registerFmu", { name: fmuName, data: base64 });
            vscode.window.showInformationMessage(`Registered FMU '${filename}' in workspace.`);
          } else if (lspClient?.sendRequest) {
            const pkgName = filename.replace(/\.(zip|ssp)$/i, "").split(/[-_ ]/)[0] || "CustomLibrary";
            await lspClient.sendRequest("modelscript/importLibraryZipReq", {
              name: pkgName,
              version: "1.0.0",
              zipBase64: base64,
            });
            await vscode.commands.executeCommand("modelscript.libraryView.refresh");
            await syncHubState();
            await panel.webview.postMessage({ command: "switchMode", mode: "gallery" });
            vscode.window.showInformationMessage(`Mounted library archive '${pkgName}'.`);
          }
          break;
        }

        case "pickNativeFile": {
          if (typeof vscode.window.showOpenDialog !== "function") break;
          const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: "Preview / Open Model",
            filters: {
              "Engineering Models": [
                "mo",
                "ms",
                "sysml",
                "sysml2",
                "sp",
                "dss",
                "raw",
                "pscx",
                "urdf",
                "inp",
                "step",
                "stp",
                "scad",
                "fmu",
                "ssp",
                "zip",
              ],
            },
          });
          const uri = picked?.[0];
          if (!uri) break;
          const fileName = uri.path.split("/").pop() || "Model.mo";
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (/\.(zip|ssp|fmu)$/i.test(fileName)) {
            let bin = "";
            for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!);
            if (fileName.toLowerCase().endsWith(".fmu") && lspClient?.sendRequest) {
              await lspClient.sendRequest("modelscript/registerFmu", {
                name: fileName.replace(/\.fmu$/i, ""),
                data: btoa(bin),
              });
              vscode.window.showInformationMessage(`Registered FMU '${fileName}'.`);
            } else if (lspClient?.sendRequest) {
              const pkgName = fileName.replace(/\.(zip|ssp)$/i, "").split(/[-_ ]/)[0] || "CustomLibrary";
              await lspClient.sendRequest("modelscript/importLibraryZipReq", {
                name: pkgName,
                version: "1.0.0",
                zipBase64: btoa(bin),
              });
              await vscode.commands.executeCommand("modelscript.libraryView.refresh");
              await syncHubState();
              await panel.webview.postMessage({ command: "switchMode", mode: "gallery" });
            }
            break;
          }

          const code = new TextDecoder().decode(bytes);
          const dialect = detectDialectFromPath(fileName);
          const isDark = isDarkColorTheme();
          let previewSvg = buildHubEquationFallbackSvg(fileName.replace(/\.[^.]+$/, ""), fileName, isDark);
          let nodeCount = 0;
          let edgeCount = 0;
          if (lspClient?.sendRequest && code.trim().length > 0) {
            try {
              const prevResp = await lspClient.sendRequest<{ previews?: Record<string, DiagramPreviewItemResult> }>(
                "modelscript/getDiagramPreviewSvgs",
                {
                  items: [{ id: "native", uri: uri.toString(), documentText: code, languageId: dialect }],
                  isDark,
                },
              );
              const hit = prevResp?.previews?.["native"];
              if (hit) {
                previewSvg = hit.svg;
                nodeCount = hit.nodeCount;
                edgeCount = hit.edgeCount;
              }
            } catch {
              // keep equation fallback
            }
          }
          await panel.webview.postMessage({
            command: "setStagedFile",
            staged: { filename: fileName, code, dialect, previewSvg, nodeCount, edgeCount },
          });
          break;
        }
      }
    },
    null,
    context.subscriptions,
  );

  return panel;
}

export function registerOpenModelHub(
  context: vscode.ExtensionContext,
  getClient: () => LspClientLike | undefined,
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  const safeReg = (id: string, fn: (...args: unknown[]) => unknown) => {
    try {
      const d = vscode.commands.registerCommand(id, fn);
      disposables.push(d);
      context.subscriptions.push(d);
    } catch {
      // Ignore if already registered in current extension host
    }
  };

  safeReg("modelscript.openModelGallery", () => {
    openModelHub(context, getClient(), "gallery");
  });

  safeReg("modelscript.libraryView.openModel", () => {
    openModelHub(context, getClient(), "gallery");
  });

  safeReg("modelscript.openModel", async (arg?: unknown) => {
    return await openModelTarget(context, arg, getClient(), "split");
  });

  return disposables;
}
