// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  compileAssemblyScript,
  compileTypeScript,
  discoverImplementationForDefinition,
  inferKernelScheme,
  parseImplementationUri,
  runTsKernel,
  runWasmKernel,
  type KernelResult,
  type VisualArtifact,
} from "@modelscript/sdk";
import {
  coerceSysmlAttributes,
  collectCstLeaves,
  evaluateSysmlDefinition,
  findMatchingBraceLeaf,
  isSysmlIdentLeaf,
  offsetToLineColumn,
  parseSysmlDefinitions,
  parseSysmlSource,
  type CstLeaf,
  type SysmlDefinitionBlock,
  type SysmlDefinitionKind,
} from "@modelscript/sysml2";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { getNonce } from "../utils/nonce.js";

interface LspRangeLike {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface LspDocumentSymbolLike {
  name: string;
  detail?: string | undefined;
  range?: LspRangeLike | undefined;
  selectionRange?: LspRangeLike | undefined;
  location?: { range: LspRangeLike } | undefined;
  children?: LspDocumentSymbolLike[] | undefined;
}

interface SysmlDefinitionLocation {
  kind: SysmlDefinitionKind;
  name: string;
  startOffset: number;
  nameEndOffset: number;
  bodyStartOffset: number;
  bodyEndOffset: number;
}

const RUNNABLE_DEF_FIRST_KEYWORDS = new Set(["action", "analysis", "requirement", "verification"]);
const RUNNABLE_DEF_KINDS: readonly SysmlDefinitionKind[] = [
  "verification def",
  "requirement def",
  "action def",
  "analysis def",
];

function findSysmlDefinitionLocations(source: string): SysmlDefinitionLocation[] {
  const leaves = collectCstLeaves(parseSysmlSource(source));
  const locations: SysmlDefinitionLocation[] = [];
  for (let i = 0; i + 3 < leaves.length; i++) {
    const firstKw = leaves[i]!.text;
    if (!RUNNABLE_DEF_FIRST_KEYWORDS.has(firstKw) || leaves[i + 1]!.text !== "def") continue;
    const nameLeaf = leaves[i + 2]!;
    if (!isSysmlIdentLeaf(nameLeaf.text)) continue;

    let openIdx = i + 3;
    if (leaves[openIdx]?.text === ":>") {
      openIdx++;
      while (openIdx < leaves.length && leaves[openIdx]!.text !== "{" && leaves[openIdx]!.text !== ";") {
        openIdx++;
      }
    }
    if (openIdx >= leaves.length || leaves[openIdx]!.text !== "{") continue;
    const closeIdx = findMatchingBraceLeaf(leaves, openIdx);
    if (closeIdx < 0) continue;

    locations.push({
      kind: `${firstKw} def` as SysmlDefinitionKind,
      name: nameLeaf.text,
      startOffset: leaves[i]!.start,
      nameEndOffset: nameLeaf.end,
      bodyStartOffset: leaves[openIdx]!.start,
      bodyEndOffset: leaves[closeIdx]!.end,
    });
    i = closeIdx;
  }
  return locations;
}

function getSymbolRange(sym: LspDocumentSymbolLike): LspRangeLike | undefined {
  return sym.selectionRange ?? sym.range ?? sym.location?.range;
}

function findSymbolInTree(
  symbols: readonly LspDocumentSymbolLike[] | undefined,
  targetName: string,
): LspDocumentSymbolLike | undefined {
  if (!symbols) return undefined;
  for (const sym of symbols) {
    if (sym.name === targetName) return sym;
    const nested = findSymbolInTree(sym.children, targetName);
    if (nested) return nested;
  }
  return undefined;
}

function collectLspRunnableDefinitions(
  symbols: readonly LspDocumentSymbolLike[] | undefined,
  document: vscode.TextDocument,
  out: Array<{ kind: string; name: string; range: vscode.Range }>,
): void {
  if (!symbols) return;
  for (const sym of symbols) {
    const symRange = getSymbolRange(sym);
    if (symRange) {
      const detailLower = (sym.detail ?? "").toLowerCase();
      let matchedKind: string | undefined = RUNNABLE_DEF_KINDS.find((k) => detailLower.includes(k));
      if (!matchedKind && symRange.start.line >= 0 && symRange.start.line < document.lineCount) {
        const lineText = document.lineAt(symRange.start.line).text.trimStart();
        const tokens = lineText.split(/\s+/);
        const kwIdx = tokens[0] === "abstract" ? 1 : 0;
        const firstKw = tokens[kwIdx];
        if (firstKw && RUNNABLE_DEF_FIRST_KEYWORDS.has(firstKw) && tokens[kwIdx + 1] === "def") {
          matchedKind = `${firstKw} def`;
        }
      }
      if (matchedKind) {
        out.push({
          kind: matchedKind,
          name: sym.name,
          range: new vscode.Range(
            symRange.start.line,
            symRange.start.character,
            symRange.end.line,
            symRange.end.character,
          ),
        });
      }
    }
    if (sym.children && sym.children.length > 0) {
      collectLspRunnableDefinitions(sym.children, document, out);
    }
  }
}

async function fetchDocumentSymbols(
  client: LanguageClient | undefined,
  uri: string,
): Promise<LspDocumentSymbolLike[] | undefined> {
  if (!client) return undefined;
  try {
    const res = await client.sendRequest<LspDocumentSymbolLike[]>("textDocument/documentSymbol", {
      textDocument: { uri },
    });
    return Array.isArray(res) ? res : undefined;
  } catch {
    return undefined;
  }
}

function findAttributeValueSpanInLeaves(
  leaves: readonly CstLeaf[],
  attrName: string,
  minOffset = 0,
  maxOffset = Number.POSITIVE_INFINITY,
): { start: number; end: number } | undefined {
  for (let i = 0; i + 1 < leaves.length; i++) {
    const leaf = leaves[i]!;
    if (leaf.start < minOffset) continue;
    if (leaf.start > maxOffset) break;
    if (leaf.text !== "attribute" || leaves[i + 1]!.text !== attrName) continue;

    let scan = i + 2;
    if (leaves[scan]?.text === ":") {
      scan++;
      while (
        scan < leaves.length &&
        leaves[scan]!.start <= maxOffset &&
        leaves[scan]!.text !== "=" &&
        leaves[scan]!.text !== ":=" &&
        leaves[scan]!.text !== ";" &&
        leaves[scan]!.text !== "{"
      ) {
        scan++;
      }
    }
    if (scan < leaves.length && (leaves[scan]!.text === "=" || leaves[scan]!.text === ":=")) {
      let semi = scan + 1;
      while (semi < leaves.length && leaves[semi]!.start <= maxOffset && leaves[semi]!.text !== ";") {
        semi++;
      }
      if (semi < leaves.length && semi > scan + 1) {
        return { start: leaves[scan + 1]!.start, end: leaves[semi - 1]!.end };
      }
    }
  }
  return undefined;
}

function findAttributeValueSpanInSlice(
  text: string,
  rangeStart: number,
  rangeEnd: number,
): { start: number; end: number } | undefined {
  const slice = text.slice(rangeStart, rangeEnd);
  let eqIdx = slice.indexOf(":=");
  let opLen = 2;
  if (eqIdx < 0) {
    eqIdx = slice.indexOf("=");
    opLen = 1;
  }
  if (eqIdx < 0) return undefined;
  let valStart = eqIdx + opLen;
  while (valStart < slice.length && (slice[valStart] === " " || slice[valStart] === "\t")) {
    valStart++;
  }
  const semiIdx = slice.indexOf(";", valStart);
  let valEnd = semiIdx >= 0 ? semiIdx : slice.length;
  while (valEnd > valStart && (slice[valEnd - 1] === " " || slice[valEnd - 1] === "\t" || slice[valEnd - 1] === "\r")) {
    valEnd--;
  }
  if (valEnd <= valStart) return undefined;
  return { start: rangeStart + valStart, end: rangeStart + valEnd };
}

class SysmlDefinitionCodeLensProvider implements vscode.CodeLensProvider {
  constructor(private readonly _client?: LanguageClient) {}

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const source = document.getText();
    const pkg = parseSysmlDefinitions(source);
    const locations = findSysmlDefinitionLocations(source);
    const locByName = new Map<string, SysmlDefinitionLocation>();
    for (const loc of locations) {
      if (!locByName.has(loc.name)) {
        locByName.set(loc.name, loc);
      }
    }

    const lenses: vscode.CodeLens[] = [];
    if (pkg.definitions.length > 0) {
      let lspSymbols: LspDocumentSymbolLike[] | undefined;
      for (const def of pkg.definitions) {
        const loc = locByName.get(def.name);
        let range: vscode.Range | undefined;
        if (loc) {
          const startPos = document.positionAt(loc.startOffset);
          const line = document.lineAt(startPos.line);
          range = new vscode.Range(startPos.line, 0, startPos.line, line.text.length);
        } else {
          lspSymbols ??= await fetchDocumentSymbols(this._client, document.uri.toString());
          const sym = findSymbolInTree(lspSymbols, def.name);
          const symRange = sym ? getSymbolRange(sym) : undefined;
          if (symRange) {
            range = new vscode.Range(
              symRange.start.line,
              symRange.start.character,
              symRange.end.line,
              symRange.end.character,
            );
          }
        }
        if (!range) continue;
        lenses.push(
          new vscode.CodeLens(range, {
            title: `$(play) Run & Visualize (${def.name})`,
            tooltip: `Compile/evaluate SysML v2 ${def.kind} '${def.name}' in-browser`,
            command: "modelscript.runSysmlDefinition",
            arguments: [document.uri.toString(), def.name],
          }),
        );
      }
      return lenses;
    }

    const lspSymbols = await fetchDocumentSymbols(this._client, document.uri.toString());
    const lspDefs: Array<{ kind: string; name: string; range: vscode.Range }> = [];
    collectLspRunnableDefinitions(lspSymbols, document, lspDefs);
    for (const def of lspDefs) {
      lenses.push(
        new vscode.CodeLens(def.range, {
          title: `$(play) Run & Visualize (${def.name})`,
          tooltip: `Compile/evaluate SysML v2 ${def.kind} '${def.name}' in-browser`,
          command: "modelscript.runSysmlDefinition",
          arguments: [document.uri.toString(), def.name],
        }),
      );
    }
    return lenses;
  }
}

class SysmlWasmDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location | undefined> {
    const lineText = document.lineAt(position.line).text;
    const uriMatch = /"((?:(?:wasm|ts|sysml):\/\/)?[^"\s]+?\.(?:wasm|ts|tsx|js|mjs|mts)(?:#[^"]+)?)"/i.exec(lineText);
    if (!uriMatch?.[1]) return undefined;

    const ref = parseImplementationUri(uriMatch[1]);
    if (!ref || ref.scheme === "sysml") return undefined;

    const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const targetUri = wsFolder
      ? vscode.Uri.joinPath(wsFolder.uri, ref.modulePath.replace(/^\.\//, ""))
      : vscode.Uri.joinPath(document.uri, "..", ref.modulePath);

    try {
      const bytes = await vscode.workspace.fs.readFile(targetUri);
      const source = new TextDecoder().decode(bytes);
      const fnRe = new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?function\\s+${ref.exportName}\\b`);
      const lines = source.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const col = lines[i]?.search(fnRe) ?? -1;
        if (col >= 0) {
          return new vscode.Location(targetUri, new vscode.Position(i, col));
        }
      }
      return new vscode.Location(targetUri, new vscode.Position(0, 0));
    } catch {
      return undefined;
    }
  }
}

function publishAscDiagnostics(
  diagnostics: string[],
  asUris: vscode.Uri[],
  collection: vscode.DiagnosticCollection,
): void {
  collection.clear();
  if (diagnostics.length === 0) return;

  const byUri = new Map<string, vscode.Diagnostic[]>();
  const locRe = /([A-Za-z0-9_./\\-]+\.ts)\((\d+),(\d+)\)/;

  for (const raw of diagnostics) {
    const m = locRe.exec(raw);
    const matchedFile = m?.[1]?.replace(/\\/g, "/");
    const lineNum = Math.max(0, Number.parseInt(m?.[2] ?? "1", 10) - 1);
    const colNum = Math.max(0, Number.parseInt(m?.[3] ?? "1", 10) - 1);

    const targetUri =
      (matchedFile
        ? asUris.find((u) => vscode.workspace.asRelativePath(u, false).replace(/\\/g, "/") === matchedFile)
        : undefined) ?? asUris[0];

    if (!targetUri) continue;
    const key = targetUri.toString();
    const list = byUri.get(key) ?? [];
    list.push(
      new vscode.Diagnostic(
        new vscode.Range(lineNum, colNum, lineNum, colNum + 1),
        raw,
        raw.includes("WARNING") ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error,
      ),
    );
    byUri.set(key, list);
  }

  for (const [uriStr, list] of byUri) {
    collection.set(vscode.Uri.parse(uriStr), list);
  }
}

async function executeSysmlDefinition(
  targetUri: vscode.Uri,
  targetDef: SysmlDefinitionBlock,
  packageName: string,
  diagnosticCollection: vscode.DiagnosticCollection,
  overrideParameters: Record<string, number | boolean | string> = {},
  client?: LanguageClient,
): Promise<KernelResult> {
  const inputParameters = {
    ...coerceSysmlAttributes(targetDef.attributes),
    ...overrideParameters,
  };
  const decoder = new TextDecoder();
  const wsFolder = vscode.workspace.getWorkspaceFolder(targetUri);

  // Resolve any workspace model/telemetry files referenced by attributes
  const referencedFiles: Array<{ fileName: string; content: string }> = [];
  const waveforms: Record<string, { x: Float64Array; y: Float64Array }> = {};
  const filePathPattern = /(?:^src\/|^\.\/|\.(?:mo|raw|dyr|seq|pscx|cfg|dat|csv|json|sysml|dss|olr)$)/i;
  for (const [key, val] of Object.entries(targetDef.attributes)) {
    if (key === "implementation" || !filePathPattern.test(val)) continue;
    try {
      const fileUri = wsFolder
        ? vscode.Uri.joinPath(wsFolder.uri, val.replace(/^\.\//, ""))
        : vscode.Uri.joinPath(targetUri, "..", val);
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      referencedFiles.push({ fileName: val, content: decoder.decode(bytes) });

      if (client && val.toLowerCase().endsWith(".mo")) {
        try {
          const simRes = (await client.sendRequest("modelscript/simulate", {
            uri: fileUri.toString(),
          })) as { time?: number[]; series?: Record<string, number[]> } | undefined;
          if (simRes?.time && simRes.series) {
            const firstKey = Object.keys(simRes.series).find((k) => k !== "time");
            const yArr = firstKey ? simRes.series[firstKey] : undefined;
            if (yArr && yArr.length > 0) {
              waveforms[firstKey!] = {
                x: Float64Array.from(simRes.time),
                y: Float64Array.from(yArr),
              };
            }
          }
        } catch {
          // LSP simulation optional; continue with file contents
        }
      }
    } catch {
      // Optional or unresolved path; skip silently
    }
  }

  let result: KernelResult;
  const kernelInput = {
    definitionName: targetDef.name,
    packageName,
    parameters: inputParameters,
    ...(referencedFiles.length > 0 ? { files: referencedFiles } : {}),
    ...(Object.keys(waveforms).length > 0 ? { waveforms } : {}),
  };

  let tsFilesCache: Record<string, string> | undefined;
  const loadWorkspaceTsFiles = async () => {
    if (tsFilesCache) return tsFilesCache;
    const tsUris = await vscode.workspace.findFiles("**/*.ts", "{**/node_modules/**,**/dist/**}");
    const map: Record<string, string> = {};
    for (const u of tsUris) {
      const rel = vscode.workspace.asRelativePath(u, false);
      map[rel] = decoder.decode(await vscode.workspace.fs.readFile(u));
    }
    tsFilesCache = map;
    return map;
  };

  let impl = targetDef.implementation;
  if (!impl) {
    impl = discoverImplementationForDefinition(targetDef.name, await loadWorkspaceTsFiles());
  } else if (impl.scheme !== "sysml") {
    impl = {
      ...impl,
      scheme: inferKernelScheme(impl.modulePath, await loadWorkspaceTsFiles()),
    };
  }

  if (impl && impl.scheme === "wasm") {
    let wasmBytes: Uint8Array;
    if (impl.modulePath.endsWith(".ts")) {
      const asUris = await vscode.workspace.findFiles("assembly/**/*.ts");
      const files: Record<string, string> = {};
      for (const u of asUris) {
        const rel = vscode.workspace.asRelativePath(u, false);
        files[rel] = decoder.decode(await vscode.workspace.fs.readFile(u));
      }
      const compiled = await compileAssemblyScript(impl.modulePath, files, { optimize: true });
      publishAscDiagnostics(compiled.diagnostics, asUris, diagnosticCollection);
      if (!compiled.ok || !compiled.wasmBytes) {
        throw new Error(`AssemblyScript compile failed for ${impl.modulePath}:\n${compiled.diagnostics.join("\n")}`);
      }
      wasmBytes = compiled.wasmBytes;
    } else {
      const wasmUri = wsFolder
        ? vscode.Uri.joinPath(wsFolder.uri, impl.modulePath.replace(/^\.\//, ""))
        : vscode.Uri.joinPath(targetUri, "..", impl.modulePath);
      wasmBytes = await vscode.workspace.fs.readFile(wasmUri);
    }

    result = await runWasmKernel(wasmBytes, impl.exportName, kernelInput, { timeoutMs: 10_000 });
  } else if (impl && impl.scheme === "ts") {
    const tsUris = await vscode.workspace.findFiles("**/*.ts", "{**/node_modules/**,**/dist/**}");
    const tsFiles = await loadWorkspaceTsFiles();
    const compiledTs = compileTypeScript(impl.modulePath, tsFiles);
    publishAscDiagnostics(compiledTs.diagnostics, tsUris, diagnosticCollection);
    if (!compiledTs.ok) {
      throw new Error(`TypeScript compile failed for ${impl.modulePath}:\n${compiledTs.diagnostics.join("\n")}`);
    }
    result = await runTsKernel(impl.modulePath, tsFiles, impl.exportName, kernelInput, {
      timeoutMs: 10_000,
      preemptible: true,
      host: {
        readFile: async (relPath: string) => {
          const fileUri = wsFolder
            ? vscode.Uri.joinPath(wsFolder.uri, relPath.replace(/^\.\//, ""))
            : vscode.Uri.joinPath(targetUri, "..", relPath);
          return decoder.decode(await vscode.workspace.fs.readFile(fileUri));
        },
        simulate: async (modelPath: string, opts) => {
          if (!client) {
            throw new Error("LanguageClient simulation is not available in this session.");
          }
          const modelUri = wsFolder
            ? vscode.Uri.joinPath(wsFolder.uri, modelPath.replace(/^\.\//, ""))
            : vscode.Uri.joinPath(targetUri, "..", modelPath);
          const simResp = (await client.sendRequest("modelscript/simulate", {
            uri: modelUri.toString(),
            stopTime: opts?.stopTime ?? 1.0,
            stepSize: opts?.stepSize ?? 0.01,
            parameters: opts?.parameters ?? {},
          })) as { time?: number[]; variables?: Record<string, number[]> } | null;
          const wfOut: Record<string, { x: number[]; y: number[] }> = {};
          if (simResp && Array.isArray(simResp.time) && simResp.variables) {
            for (const [varName, vals] of Object.entries(simResp.variables)) {
              if (Array.isArray(vals)) {
                wfOut[varName] = { x: simResp.time, y: vals };
              }
            }
          }
          return wfOut;
        },
      },
    });
  } else {
    result = {
      ok: true,
      kernelId: targetDef.name,
      parameters: inputParameters,
      summary: `Evaluated SysML v2 ${targetDef.kind} '${targetDef.name}' (${packageName})`,
      artifacts: [],
    };
  }

  // Closed-loop: evaluate SysML v2 assume/require/assert constraints against merged kernel outputs
  if (targetDef.constraintSpecs.length > 0) {
    const evalRes = evaluateSysmlDefinition(targetDef, {
      ...inputParameters,
      ...(result.parameters ?? {}),
    });
    result.ok = result.ok && evalRes.passed;
    result.artifacts = [
      ...(result.artifacts ?? []),
      {
        kind: "compliance-matrix",
        id: `${targetDef.name}-constraints`,
        title: `${targetDef.name} Verification (minMargin=${evalRes.minMargin.toFixed(4)})`,
        columns: ["Check ID", "Constraint", "Status", "Margin", "Details"],
        rows: evalRes.checks.map((c) => [
          c.id,
          c.expression,
          c.vacuous ? "VACUOUS" : c.passed ? "PASS" : "FAIL",
          c.margin.toFixed(4),
          c.details,
        ]),
      },
    ];
  }

  return result;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function lttbDownsample(x: number[], y: number[], threshold = 1200): { x: number[]; y: number[] } {
  const n = Math.min(x.length, y.length);
  if (n <= threshold || threshold < 3) {
    return { x: x.slice(0, n), y: y.slice(0, n) };
  }
  const outX: number[] = [x[0] ?? 0];
  const outY: number[] = [y[0] ?? 0];
  const every = (n - 2) / (threshold - 2);
  let a = 0;

  for (let i = 0; i < threshold - 2; i++) {
    const avgStart = Math.floor((i + 1) * every) + 1;
    const avgEnd = Math.min(Math.floor((i + 2) * every) + 1, n);
    let avgX = 0;
    let avgY = 0;
    const avgCount = Math.max(1, avgEnd - avgStart);
    for (let j = avgStart; j < avgEnd; j++) {
      avgX += x[j] ?? 0;
      avgY += y[j] ?? 0;
    }
    avgX /= avgCount;
    avgY /= avgCount;

    const rangeStart = Math.floor(i * every) + 1;
    const rangeEnd = Math.min(Math.floor((i + 1) * every) + 1, n);
    const ax = x[a] ?? 0;
    const ay = y[a] ?? 0;
    let maxArea = -1;
    let nextA = rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs((ax - avgX) * ((y[j] ?? 0) - ay) - (ax - (x[j] ?? 0)) * (avgY - ay));
      if (area > maxArea) {
        maxArea = area;
        nextA = j;
      }
    }
    outX.push(x[nextA] ?? 0);
    outY.push(y[nextA] ?? 0);
    a = nextA;
  }

  outX.push(x[n - 1] ?? 0);
  outY.push(y[n - 1] ?? 0);
  return { x: outX, y: outY };
}

function renderSvgPlot(artifact: Extract<VisualArtifact, { kind: "timeseries" | "bode" }>): string {
  const width = 620;
  const height = 220;
  const pad = 38;
  const sampled = artifact.series.map((s) => ({
    name: s.name,
    ...lttbDownsample(s.x, s.y, 1200),
  }));
  const allX = sampled.flatMap((s) => s.x);
  const allY = sampled.flatMap((s) => s.y);
  const minX = allX.length ? Math.min(...allX) : 0;
  const maxX = allX.length ? Math.max(...allX) : 1;
  const minY = allY.length ? Math.min(...allY) : 0;
  const maxY = allY.length ? Math.max(...allY) : 1;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const palette = ["#38bdf8", "#f472b6", "#34d399", "#fbbf24"];

  const polylines = sampled
    .map((s, idx) => {
      const pts = s.x
        .map((x, i) => {
          const px = pad + ((x - minX) / spanX) * (width - 2 * pad);
          const py = height - pad - (((s.y[i] ?? 0) - minY) / spanY) * (height - 2 * pad);
          return `${px.toFixed(1)},${py.toFixed(1)}`;
        })
        .join(" ");
      const color = palette[idx % palette.length];
      return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}" />`;
    })
    .join("\n");

  const legend = sampled
    .map(
      (s, idx) =>
        `<span style="margin-right:12px;color:${palette[idx % palette.length]}">● ${escapeHtml(s.name)}</span>`,
    )
    .join("");

  return `
    <div class="card plot-card" data-minx="${minX}" data-maxx="${maxX}" data-miny="${minY}" data-maxy="${maxY}" data-pad="${pad}" data-w="${width}" data-h="${height}">
      <div class="card-head">
        <h3>${escapeHtml(artifact.title)}</h3>
        <span class="readout">Hover plot for (x, y)</span>
      </div>
      <div class="legend">${legend}</div>
      <svg class="interactive-plot" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
        <rect x="${pad}" y="${pad}" width="${width - 2 * pad}" height="${height - 2 * pad}" fill="var(--vscode-editor-background)" stroke="var(--vscode-panel-border)" />
        ${polylines}
        <line class="crosshair-x" x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="var(--vscode-editorCursor-foreground, #94a3b8)" stroke-dasharray="3,3" opacity="0" />
        <line class="crosshair-y" x1="${pad}" y1="${pad}" x2="${width - pad}" y2="${pad}" stroke="var(--vscode-editorCursor-foreground, #94a3b8)" stroke-dasharray="3,3" opacity="0" />
        <text x="${width / 2}" y="${height - 8}" fill="var(--vscode-descriptionForeground, #94a3b8)" font-size="11" text-anchor="middle">${escapeHtml(artifact.xLabel)}</text>
        <text x="12" y="${height / 2}" fill="var(--vscode-descriptionForeground, #94a3b8)" font-size="11" transform="rotate(-90 12 ${height / 2})" text-anchor="middle">${escapeHtml(artifact.yLabel)}</text>
      </svg>
    </div>`;
}

function renderArtifactHtml(artifact: VisualArtifact): string {
  if (artifact.kind === "timeseries" || artifact.kind === "bode") {
    return renderSvgPlot(artifact);
  }
  if (artifact.kind === "table" || artifact.kind === "compliance-matrix") {
    const headers = artifact.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
    const rows = artifact.rows
      .map((r) => `<tr>${r.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`)
      .join("");
    return `
      <div class="card">
        <h3>${escapeHtml(artifact.title)}</h3>
        <table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>
      </div>`;
  }
  if (artifact.kind === "diagram-overlay") {
    const badges = artifact.badges
      .map((b) => `<span class="badge ${b.severity}">${escapeHtml(b.nodeId)}: ${escapeHtml(b.text)}</span>`)
      .join(" ");
    return `<div class="card"><h3>${escapeHtml(artifact.title)}</h3><div>${badges}</div></div>`;
  }
  if (artifact.kind === "kpi-cards") {
    const cardsHtml = artifact.cards
      .map((c) => {
        const cls = c.status && c.status !== "neutral" ? `kpi-card ${c.status}` : "kpi-card";
        const unit = c.unit ? ` <span class="kpi-unit">${escapeHtml(c.unit)}</span>` : "";
        const sub = c.subtitle ? `<div class="kpi-sub">${escapeHtml(c.subtitle)}</div>` : "";
        return `
          <div class="${cls}">
            <div class="kpi-label">${escapeHtml(c.label)}</div>
            <div class="kpi-val">${escapeHtml(String(c.value))}${unit}</div>
            ${sub}
          </div>`;
      })
      .join("");
    return `<div class="card"><h3>${escapeHtml(artifact.title)}</h3><div class="kpi-grid">${cardsHtml}</div></div>`;
  }
  if (artifact.kind === "markdown") {
    return `<div class="card"><h3>${escapeHtml(artifact.title)}</h3><pre class="md-note">${escapeHtml(artifact.content)}</pre></div>`;
  }
  if (artifact.kind === "histogram") {
    const width = 620;
    const height = 200;
    const pad = 34;
    const n = Math.min(artifact.binCenters.length, artifact.counts.length);
    const maxCount = Math.max(1, ...artifact.counts.slice(0, n));
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;
    const barW = n > 0 ? Math.max(2, innerW / n - 2) : innerW;
    const bars = Array.from({ length: n }, (_, i) => {
      const c = artifact.counts[i] ?? 0;
      const h = (c / maxCount) * innerH;
      const x = pad + (i * innerW) / n + 1;
      const y = height - pad - h;
      const center = artifact.binCenters[i] ?? 0;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="#38bdf8" opacity="0.85"><title>${center.toFixed(3)}: ${c}</title></rect>`;
    }).join("");
    return `
      <div class="card">
        <h3>${escapeHtml(artifact.title)}</h3>
        <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
          <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#475569" stroke-width="1" />
          <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#475569" stroke-width="1" />
          ${bars}
        </svg>
        <div class="readout">${escapeHtml(artifact.xLabel)} vs ${escapeHtml(artifact.yLabel)} (max=${maxCount})</div>
      </div>`;
  }
  return "";
}

function renderInteractiveBody(defName: string, result: KernelResult, numericInputs: Record<string, number>): string {
  const statusClass = result.ok ? "pass" : "fail";
  const statusText = result.ok ? "PASS" : "FAIL";
  const paramRows = Object.entries(result.parameters ?? {})
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td></tr>`)
    .join("");
  const sliderHtml = Object.entries(numericInputs)
    .map(([k, val]) => {
      const span = Math.abs(val) > 1e-6 ? Math.abs(val) * 2 : 10;
      const min = val >= 0 ? 0 : val - span;
      const max = val + span;
      const step = (max - min) / 100 || 0.01;
      return `
        <div class="slider-row">
          <label>${escapeHtml(k)}: <strong data-val-for="${escapeHtml(k)}">${val}</strong></label>
          <input type="range" class="param-slider" data-param="${escapeHtml(k)}" min="${min}" max="${max}" step="${step}" value="${val}" />
        </div>`;
    })
    .join("");
  const hasCalibrated = Object.keys(result.parameters ?? {}).length > 0;
  const artifactsHtml = (result.artifacts ?? []).map(renderArtifactHtml).join("");

  return `
    <div class="header">
      <h2>${escapeHtml(defName)}</h2>
      <span class="badge ${statusClass}">${statusText}</span>
      ${hasCalibrated ? `<button id="apply-params-btn" class="btn">Apply Parameters to .sysml</button>` : ""}
    </div>
    <p>${escapeHtml(result.summary ?? `Kernel: ${result.kernelId}`)}</p>
    ${sliderHtml ? `<div class="card"><h3>Live Parameter Sweep</h3>${sliderHtml}</div>` : ""}
    ${paramRows ? `<div class="card"><h3>Outputs</h3><table><tbody>${paramRows}</tbody></table></div>` : ""}
    ${artifactsHtml}`;
}

function buildVisualizerHtml(defName: string, result: KernelResult, numericInputs: Record<string, number>): string {
  const nonce = getNonce();
  const bodyHtml = renderInteractiveBody(defName, result, numericInputs);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  body { font-family: var(--vscode-font-family, sans-serif); background: var(--vscode-editor-background, #020617); color: var(--vscode-editor-foreground, #e2e8f0); padding: 16px; }
  .header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .card-head { display: flex; justify-content: space-between; align-items: center; }
  .readout { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; color: var(--vscode-descriptionForeground, #94a3b8); }
  .badge { padding: 4px 10px; border-radius: 6px; font-weight: 600; font-size: 12px; display: inline-block; margin: 2px; }
  .pass { background: var(--vscode-testing-iconPassed, #064e3b); color: #ffffff; }
  .warn { background: #78350f; color: #fcd34d; }
  .fail { background: var(--vscode-testing-iconFailed, #7f1d1d); color: #ffffff; }
  .btn { background: var(--vscode-button-background, #2563eb); color: var(--vscode-button-foreground, #ffffff); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .btn:hover { background: var(--vscode-button-hoverBackground, #1d4ed8); }
  .card { background: var(--vscode-sideBar-background, #0f172a); border: 1px solid var(--vscode-panel-border, #1e293b); border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; }
  .slider-row { display: grid; grid-template-columns: 180px 1fr; align-items: center; gap: 12px; margin: 6px 0; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border, #1e293b); }
  .legend { font-size: 12px; margin-bottom: 6px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
  .kpi-card { border: 1px solid var(--vscode-panel-border, #1e293b); border-radius: 6px; padding: 10px; background: rgba(255,255,255,0.02); }
  .kpi-label { font-size: 11px; opacity: 0.8; margin-bottom: 4px; }
  .kpi-val { font-size: 18px; font-weight: 700; }
  .kpi-unit { font-size: 12px; font-weight: 400; opacity: 0.8; }
  .kpi-sub { font-size: 11px; opacity: 0.75; margin-top: 4px; }
  .md-note { white-space: pre-wrap; font-family: var(--vscode-font-family, sans-serif); font-size: 13px; margin: 0; }
</style>
</head>
<body>
  <div id="root">${bodyHtml}</div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let currentOutputs = ${JSON.stringify(result.parameters ?? {})};
    let currentInputs = ${JSON.stringify(numericInputs)};

    function bindInteractions() {
      const applyBtn = document.getElementById('apply-params-btn');
      if (applyBtn) {
        applyBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'applyParameters', parameters: currentOutputs });
        });
      }
      document.querySelectorAll('.param-slider').forEach((el) => {
        el.addEventListener('input', (ev) => {
          const input = ev.target;
          const name = input.getAttribute('data-param');
          const val = Number(input.value);
          currentInputs[name] = val;
          const label = document.querySelector('[data-val-for="' + name + '"]');
          if (label) label.textContent = val.toFixed(4);
          vscode.postMessage({ type: 'reRunWithParameters', parameters: currentInputs });
        });
      });
      document.querySelectorAll('.plot-card').forEach((card) => {
        const svg = card.querySelector('.interactive-plot');
        const cx = card.querySelector('.crosshair-x');
        const cy = card.querySelector('.crosshair-y');
        const readout = card.querySelector('.readout');
        if (!svg || !cx || !cy || !readout) return;
        const minX = Number(card.getAttribute('data-minx'));
        const maxX = Number(card.getAttribute('data-maxx'));
        const minY = Number(card.getAttribute('data-miny'));
        const maxY = Number(card.getAttribute('data-maxy'));
        const pad = Number(card.getAttribute('data-pad'));
        const w = Number(card.getAttribute('data-w'));
        const h = Number(card.getAttribute('data-h'));
        svg.addEventListener('mousemove', (e) => {
          const rect = svg.getBoundingClientRect();
          const sx = ((e.clientX - rect.left) / rect.width) * w;
          const sy = ((e.clientY - rect.top) / rect.height) * h;
          const clampedX = Math.max(pad, Math.min(w - pad, sx));
          const clampedY = Math.max(pad, Math.min(h - pad, sy));
          cx.setAttribute('x1', clampedX); cx.setAttribute('x2', clampedX); cx.setAttribute('opacity', '0.8');
          cy.setAttribute('y1', clampedY); cy.setAttribute('y2', clampedY); cy.setAttribute('opacity', '0.8');
          const vx = minX + ((clampedX - pad) / (w - 2 * pad)) * (maxX - minX);
          const vy = minY + ((h - pad - clampedY) / (h - 2 * pad)) * (maxY - minY);
          readout.textContent = 'x=' + vx.toFixed(4) + ', y=' + vy.toFixed(4);
        });
        svg.addEventListener('mouseleave', () => {
          cx.setAttribute('opacity', '0');
          cy.setAttribute('opacity', '0');
        });
      });
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'updateBody') {
        currentOutputs = msg.outputs || {};
        document.getElementById('root').innerHTML = msg.html;
        bindInteractions();
      }
    });

    bindInteractions();
  </script>
</body>
</html>`;
}

function findDefinitionLine(
  source: string,
  defName: string,
  locations?: readonly SysmlDefinitionLocation[],
  lspSymbols?: readonly LspDocumentSymbolLike[],
): number {
  const locs = locations ?? findSysmlDefinitionLocations(source);
  const match = locs.find((loc) => loc.name === defName);
  if (match) {
    return offsetToLineColumn(source, match.startOffset).line;
  }
  const sym = findSymbolInTree(lspSymbols, defName);
  const symRange = sym ? getSymbolRange(sym) : undefined;
  if (symRange) {
    return symRange.start.line;
  }
  return 0;
}

export function registerSysmlRunnerCommands(
  context: vscode.ExtensionContext,
  client?: LanguageClient,
): vscode.Disposable[] {
  const ascDiagnostics = vscode.languages.createDiagnosticCollection("modelscript-assemblyscript");
  const sysmlSelector: vscode.DocumentSelector = [{ language: "sysml2" }, { pattern: "**/*.sysml" }];

  const lensDisp = vscode.languages.registerCodeLensProvider(
    sysmlSelector,
    new SysmlDefinitionCodeLensProvider(client),
  );
  const defDisp = vscode.languages.registerDefinitionProvider(sysmlSelector, new SysmlWasmDefinitionProvider());

  // Native VS Code TestController for SysML v2 verification/requirement/action definitions
  const testController = vscode.tests.createTestController("modelscript.sysmlVerification", "SysML v2 Verification");

  const syncSysmlFileTests = async (uri: vscode.Uri): Promise<void> => {
    try {
      const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      const pkg = parseSysmlDefinitions(source);
      const fileId = uri.toString();
      if (pkg.definitions.length === 0) {
        testController.items.delete(fileId);
        return;
      }
      const locations = findSysmlDefinitionLocations(source);
      const lspSymbols = locations.length === 0 ? await fetchDocumentSymbols(client, fileId) : undefined;
      const fileItem = testController.createTestItem(fileId, vscode.workspace.asRelativePath(uri, false), uri);
      for (const def of pkg.definitions) {
        const line = findDefinitionLine(source, def.name, locations, lspSymbols);
        const child = testController.createTestItem(`${fileId}#${def.name}`, def.name, uri);
        child.range = new vscode.Range(line, 0, line, 80);
        fileItem.children.add(child);
      }
      testController.items.add(fileItem);
    } catch {
      /* ignore unreadable files */
    }
  };

  testController.resolveHandler = async (item) => {
    if (!item) {
      const uris = await vscode.workspace.findFiles("**/*.sysml");
      await Promise.all(uris.map(syncSysmlFileTests));
    } else if (item.uri) {
      await syncSysmlFileTests(item.uri);
    }
  };

  const docChangeDisp = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.uri.path.endsWith(".sysml")) {
      void syncSysmlFileTests(doc.uri);
    }
  });

  testController.createRunProfile(
    "Run SysML v2 Verification",
    vscode.TestRunProfileKind.Run,
    async (request, token) => {
      const run = testController.createTestRun(request);
      const queue: vscode.TestItem[] = [];
      if (request.include) {
        for (const item of request.include) {
          if (item.children.size > 0) item.children.forEach((c) => queue.push(c));
          else queue.push(item);
        }
      } else {
        const uris = await vscode.workspace.findFiles("**/*.sysml");
        await Promise.all(uris.map(syncSysmlFileTests));
        testController.items.forEach((fileItem) => fileItem.children.forEach((c) => queue.push(c)));
      }

      for (const item of queue) {
        if (token.isCancellationRequested) break;
        if (!item.uri) continue;
        run.started(item);
        const t0 = Date.now();
        try {
          const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(item.uri));
          const pkg = parseSysmlDefinitions(source);
          const def = pkg.definitions.find((d) => d.name === item.label);
          if (!def) {
            run.errored(item, new vscode.TestMessage(`Definition '${item.label}' not found.`));
            continue;
          }
          const result = await executeSysmlDefinition(item.uri, def, pkg.packageName, ascDiagnostics, {}, client);
          const duration = Date.now() - t0;
          if (result.ok) {
            run.passed(item, duration);
          } else {
            run.failed(item, new vscode.TestMessage(result.summary ?? `Verification '${def.name}' failed.`), duration);
          }
        } catch (err) {
          run.errored(item, new vscode.TestMessage(err instanceof Error ? err.message : String(err)));
        }
      }
      run.end();
    },
    true,
  );

  const cmdDisp = vscode.commands.registerCommand(
    "modelscript.runSysmlDefinition",
    async (uriString?: string, defNameArg?: string) => {
      const editor = vscode.window.activeTextEditor;
      const targetUri = uriString ? vscode.Uri.parse(uriString) : editor?.document.uri;
      if (!targetUri) {
        vscode.window.showWarningMessage("Open a .sysml file to run a SysML v2 definition.");
        return;
      }

      const sysmlSource = new TextDecoder().decode(await vscode.workspace.fs.readFile(targetUri));
      const pkg = parseSysmlDefinitions(sysmlSource);
      const targetDef = defNameArg ? pkg.definitions.find((d) => d.name === defNameArg) : pkg.definitions[0];

      if (!targetDef) {
        vscode.window.showWarningMessage("No SysML v2 definitions found in this file.");
        return;
      }

      let result: KernelResult;
      try {
        result = await executeSysmlDefinition(targetUri, targetDef, pkg.packageName, ascDiagnostics, {}, client);
      } catch (err) {
        vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
        return;
      }

      const coerced = coerceSysmlAttributes(targetDef.attributes);
      const numericInputs: Record<string, number> = {};
      for (const [k, v] of Object.entries(coerced)) {
        if (typeof v === "number") numericInputs[k] = v;
      }

      const panel = vscode.window.createWebviewPanel(
        "modelscript.sysmlVisualizer",
        `SysML v2: ${targetDef.name}`,
        vscode.ViewColumn.Beside,
        { enableScripts: true },
      );
      panel.webview.html = buildVisualizerHtml(targetDef.name, result, numericInputs);

      panel.webview.onDidReceiveMessage(async (msg: { type?: string; parameters?: Record<string, unknown> }) => {
        if (msg.type === "reRunWithParameters" && msg.parameters) {
          try {
            const overrides: Record<string, number> = {};
            for (const [k, v] of Object.entries(msg.parameters)) {
              if (typeof v === "number" && Number.isFinite(v)) {
                overrides[k] = v;
                numericInputs[k] = v;
              }
            }
            const nextRes = await executeSysmlDefinition(
              targetUri,
              targetDef,
              pkg.packageName,
              ascDiagnostics,
              overrides,
              client,
            );
            await panel.webview.postMessage({
              type: "updateBody",
              outputs: nextRes.parameters ?? {},
              html: renderInteractiveBody(targetDef.name, nextRes, numericInputs),
            });
          } catch (err) {
            vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
          }
        } else if (msg.type === "applyParameters" && msg.parameters) {
          const doc = await vscode.workspace.openTextDocument(targetUri);
          const text = doc.getText();
          const edit = new vscode.WorkspaceEdit();
          let updatedCount = 0;

          const leaves = collectCstLeaves(parseSysmlSource(text));
          const defLoc =
            leaves.length > 0
              ? findSysmlDefinitionLocations(text).find((loc) => loc.name === targetDef.name)
              : undefined;
          const lspSymbols = leaves.length === 0 ? await fetchDocumentSymbols(client, targetUri.toString()) : undefined;
          const defSym = findSymbolInTree(lspSymbols, targetDef.name);

          for (const [k, v] of Object.entries(msg.parameters)) {
            let span: { start: number; end: number } | undefined;
            if (leaves.length > 0) {
              span =
                (defLoc
                  ? findAttributeValueSpanInLeaves(leaves, k, defLoc.bodyStartOffset, defLoc.bodyEndOffset)
                  : undefined) ?? findAttributeValueSpanInLeaves(leaves, k);
            } else if (lspSymbols) {
              const attrSym = findSymbolInTree(defSym?.children, k) ?? findSymbolInTree(lspSymbols, k);
              const symRange = attrSym?.range ?? attrSym?.location?.range;
              if (symRange) {
                const startOff = doc.offsetAt(new vscode.Position(symRange.start.line, symRange.start.character));
                const endOff = doc.offsetAt(new vscode.Position(symRange.end.line, symRange.end.character));
                span = findAttributeValueSpanInSlice(text, startOff, endOff);
              }
            }

            if (!span) continue;
            const formatted = typeof v === "string" ? `"${v}"` : String(v);
            edit.replace(targetUri, new vscode.Range(doc.positionAt(span.start), doc.positionAt(span.end)), formatted, {
              label: `Update ${k} = ${formatted}`,
              needsConfirmation: true,
            });
            updatedCount++;
          }

          if (updatedCount > 0) {
            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage(
              `Updated ${updatedCount} attribute(s) in ${vscode.workspace.asRelativePath(targetUri)}.`,
            );
          } else {
            vscode.window.showInformationMessage("No matching attributes found in .sysml to update.");
          }
        }
      });
    },
  );

  context.subscriptions.push(ascDiagnostics, lensDisp, defDisp, testController, docChangeDisp, cmdDisp);
  return [ascDiagnostics, lensDisp, defDisp, testController, docChangeDisp, cmdDisp];
}
