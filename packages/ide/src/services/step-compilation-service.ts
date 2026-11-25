// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  extractModelicaTelemetryParams,
  extractStepGdtOverlay,
  parseQifSourceDirectives,
  parseScadSourceDirectives,
  parseScadSpoolDirectives,
  parseStepProvenanceMeta,
  type GdtOverlayPayload,
  type ModelicaTelemetryParams,
  type QifSourceDirectives,
  type ScadSourceDirectives,
  type SpoolKinematicsSpec,
  type StepFeatureAnchor,
  type StepProvenanceMeta,
} from "@modelscript/cad";
import * as vscode from "vscode";

export {
  extractModelicaTelemetryParams,
  parseQifSourceDirectives,
  parseScadSourceDirectives,
  parseScadSpoolDirectives,
  parseStepProvenanceMeta,
  type ModelicaTelemetryParams,
  type QifSourceDirectives,
  type ScadSourceDirectives,
  type SpoolKinematicsSpec,
  type StepProvenanceMeta,
};

/**
 * Structural subset of a LanguageClient needed to invoke `modelscript/compileStepFromSources`.
 * Works with both browser (`vscode-languageclient/browser.js`) and Node desktop clients.
 */
export interface StepCompilerClient {
  sendRequest<R = unknown>(method: string, params?: unknown): Promise<R>;
}

export interface CompileStepFromSourcesResponse {
  readonly stepText: string;
  readonly featureAnchors: readonly StepFeatureAnchor[];
  readonly spools: readonly SpoolKinematicsSpec[];
  readonly gdtOverlay: GdtOverlayPayload;
  readonly partNames: readonly string[];
  readonly error?: string | undefined;
}

export interface PairedStepSources {
  readonly scadUri?: vscode.Uri | undefined;
  readonly qifUri?: vscode.Uri | undefined;
  readonly modelicaUri?: vscode.Uri | undefined;
  readonly stepUri?: vscode.Uri | undefined;
  readonly assemblyName?: string | undefined;
}

export interface CompiledStepMeta {
  readonly compiledFromOptionA: boolean;
  readonly scadUri?: string | undefined;
  readonly qifUri?: string | undefined;
  readonly modelicaUri?: string | undefined;
  readonly stepUri: string;
  readonly stepText: string;
  readonly spools: readonly SpoolKinematicsSpec[];
  readonly gdtOverlay: GdtOverlayPayload;
  readonly modelicaTelemetry?: ModelicaTelemetryParams | undefined;
  readonly partNames: readonly string[];
  readonly compiledAt: number;
}

export interface StepOverlayPayload {
  readonly compiledFromOptionA: boolean;
  readonly scadUri?: string | undefined;
  readonly qifUri?: string | undefined;
  readonly modelicaUri?: string | undefined;
  readonly stepUri: string;
  readonly gdtOverlay: GdtOverlayPayload;
  readonly spools: readonly SpoolKinematicsSpec[];
  readonly modelicaTelemetry?: ModelicaTelemetryParams | undefined;
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function isScadPath(path: string): boolean {
  return /\.scad$/i.test(path);
}

export function isQifPath(path: string): boolean {
  return /\.qif$/i.test(path);
}

export function isModelicaPath(path: string): boolean {
  return /\.mo$/i.test(path);
}

export function isStepPath(path: string): boolean {
  return /\.(step|stp|p21)$/i.test(path);
}

export function dirPathOf(uri: vscode.Uri): string {
  const idx = uri.path.lastIndexOf("/");
  return idx >= 0 ? uri.path.slice(0, idx) : "";
}

export function baseNameOf(uri: vscode.Uri): string {
  const idx = uri.path.lastIndexOf("/");
  return idx >= 0 ? uri.path.slice(idx + 1) : uri.path;
}

export function stemOf(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

export function normalizePosixPath(path: string): string {
  const isAbs = path.startsWith("/");
  const segments = path.split("/");
  const out: string[] = [];
  for (const seg of segments) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
      } else if (!isAbs) {
        out.push("..");
      }
      continue;
    }
    out.push(seg);
  }
  const joined = out.join("/");
  return isAbs ? `/${joined}` : joined;
}

export function resolveSiblingUri(baseUri: vscode.Uri, relativeRef: string): vscode.Uri {
  const trimmed = relativeRef.trim().replace(/^["']|["']$/g, "");
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return vscode.Uri.parse(trimmed);
  }
  const normalizedRef = trimmed.replace(/\\/g, "/");
  if (normalizedRef.startsWith("/")) {
    return baseUri.with({ path: normalizePosixPath(normalizedRef) });
  }
  const baseDir = dirPathOf(baseUri);
  const combined = baseDir ? `${baseDir}/${normalizedRef}` : normalizedRef;
  return baseUri.with({ path: normalizePosixPath(combined) });
}

/**
 * Check if a workspace URI matches a relative directive target from `fromUri`
 * (supports relative paths like `../pmi/Turbine.qif`, suffix matches across mounted roots,
 * or unique basename matches).
 */
function uriMatchesDirective(
  fromUri: vscode.Uri,
  directiveSpec: string | undefined,
  targetUri: vscode.Uri,
  allCandidates?: readonly vscode.Uri[],
): boolean {
  if (!directiveSpec) return false;
  const resolved = resolveSiblingUri(fromUri, directiveSpec);
  if (resolved.path === targetUri.path) return true;

  const normSpec = normalizePosixPath(directiveSpec.replace(/\\/g, "/"));
  const stripped = normSpec.replace(/^(\.\.\/)+/, "");
  if (stripped && (targetUri.path === stripped || targetUri.path.endsWith(`/${stripped}`))) {
    return true;
  }

  const targetBase = baseNameOf(targetUri).toLowerCase();
  const specBase = stemOf(normSpec) === normSpec ? normSpec.toLowerCase() : baseNameOf(resolved).toLowerCase();
  if (specBase && targetBase === specBase && allCandidates) {
    const matches = allCandidates.filter((c) => baseNameOf(c).toLowerCase() === targetBase);
    return matches.length === 1;
  }
  return false;
}

function matchDirectiveCandidateUri(
  fromUri: vscode.Uri,
  directiveSpec: string | undefined,
  candidates: readonly vscode.Uri[],
): vscode.Uri | undefined {
  if (!directiveSpec) return undefined;
  const resolved = resolveSiblingUri(fromUri, directiveSpec);
  const exact = candidates.find((c) => c.path === resolved.path);
  if (exact) return exact;

  const normSpec = normalizePosixPath(directiveSpec.replace(/\\/g, "/"));
  const stripped = normSpec.replace(/^(\.\.\/)+/, "");
  if (stripped) {
    const suffixHits = candidates.filter((c) => c.path === stripped || c.path.endsWith(`/${stripped}`));
    if (suffixHits.length > 0) return suffixHits[0];
  }

  const specBase = baseNameOf(resolved).toLowerCase();
  if (specBase) {
    const baseHits = candidates.filter((c) => baseNameOf(c).toLowerCase() === specBase);
    if (baseHits.length === 1) return baseHits[0];
  }
  return resolved;
}

/**
 * Heuristic check identifying AP242 STEP artifacts generated by ModelScript's compiler pipeline.
 */
export function stepLooksCompiledAp242(stepText: string): boolean {
  return (
    /ISO-10303-21/i.test(stepText) &&
    (/@modelscript-meta/i.test(stepText) ||
      /ModelScript/i.test(stepText) ||
      /AP242/i.test(stepText) ||
      /AUTOMOTIVE_DESIGN/i.test(stepText))
  );
}

/**
 * Read file text preferring active in-memory `vscode.workspace.textDocuments` buffers
 * so unsaved editor changes are immediately picked up by compilation.
 */
export async function readWorkspaceText(uri: vscode.Uri): Promise<string | undefined> {
  const targetKey = uri.toString();
  const openDoc = vscode.workspace.textDocuments.find(
    (doc) => doc.uri.toString() === targetKey || doc.uri.path === uri.path,
  );
  if (openDoc) {
    return openDoc.getText();
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return textDecoder.decode(bytes);
  } catch {
    return undefined;
  }
}

async function listWorkspaceCadUris(): Promise<vscode.Uri[]> {
  const byKey = new Map<string, vscode.Uri>();
  const addUri = (uri: vscode.Uri): void => {
    const p = uri.path;
    if (!isScadPath(p) && !isQifPath(p) && !isStepPath(p) && !isModelicaPath(p)) return;
    byKey.set(uri.toString(), uri);
  };

  for (const doc of vscode.workspace.textDocuments) {
    addUri(doc.uri);
  }

  if (typeof vscode.workspace.findFiles === "function") {
    try {
      const found = await vscode.workspace.findFiles("**/*.{scad,qif,step,stp,p21,mo}", "**/node_modules/**", 300);
      for (const uri of found) {
        addUri(uri);
      }
    } catch {
      // Ignore workspaces or mocks where findFiles does not support brace globs
    }
  }

  return Array.from(byKey.values());
}

/**
 * Shared workspace service managing the Option-A `.scad` + `.qif` -> `.step` compilation pipeline
 * across both desktop VS Code and Ansatz Editor.
 */
export class StepCompilationService implements vscode.Disposable {
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _compiledByStepUri = new Map<string, CompiledStepMeta>();
  private readonly _scadToStepUri = new Map<string, string>();
  private readonly _qifToStepUri = new Map<string, string>();
  private readonly _moToStepUri = new Map<string, string>();
  private readonly _activeStepUris = new Set<string>();
  private readonly _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly _moOverlayTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly _compilingStepUris = new Set<string>();
  private readonly _pendingRecompileScadUris = new Map<string, vscode.Uri>();
  private readonly _suppressFsStepKeys = new Set<string>();
  private readonly _onDidCompileStep = new vscode.EventEmitter<CompiledStepMeta>();
  private readonly _onDidRefreshOverlay = new vscode.EventEmitter<StepOverlayPayload>();
  private readonly _debounceMs: number;

  public readonly onDidCompileStep: vscode.Event<CompiledStepMeta> = this._onDidCompileStep.event;
  public readonly onDidRefreshOverlay: vscode.Event<StepOverlayPayload> = this._onDidRefreshOverlay.event;

  constructor(
    private readonly getClient: () => StepCompilerClient | undefined,
    options?: { readonly debounceMs?: number | undefined; readonly registerWatchers?: boolean | undefined },
  ) {
    this._debounceMs = options?.debounceMs ?? 350;
    if (options?.registerWatchers !== false) {
      this._registerWorkspaceWatchers();
    }
  }

  public dispose(): void {
    for (const timer of this._debounceTimers.values()) {
      clearTimeout(timer);
    }
    this._debounceTimers.clear();
    for (const timer of this._moOverlayTimers.values()) {
      clearTimeout(timer);
    }
    this._moOverlayTimers.clear();
    this._onDidCompileStep.dispose();
    this._onDidRefreshOverlay.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }

  /**
   * Mark a `.step` URI as actively viewed in a 3D STEP panel so live `.scad`/`.qif`/`.mo` edits keep it fresh.
   */
  public registerOpenStepViewer(stepUri: vscode.Uri): vscode.Disposable {
    const key = stepUri.toString();
    this._activeStepUris.add(key);
    return new vscode.Disposable(() => {
      this._activeStepUris.delete(key);
    });
  }

  public getCompiledMeta(stepUri: vscode.Uri | string): CompiledStepMeta | undefined {
    const key = typeof stepUri === "string" ? stepUri : stepUri.toString();
    return this._compiledByStepUri.get(key);
  }

  public isWritingStepUri(stepUri: vscode.Uri | string): boolean {
    const key = typeof stepUri === "string" ? stepUri : stepUri.toString();
    return this._suppressFsStepKeys.has(key);
  }

  /**
   * Discover paired `.scad`, `.qif`, `.mo`, and `.step` URIs for a given anchor file using:
   * 1. Explicit bidirectional header directives (`@qif_source:`, `@scad_source:`, `@step_output:`, `@modelica_source:`, `@assembly_name:`).
   * 2. Embedded STEP `/* @modelscript-meta {...} *\/` provenance.
   * 3. Session compilation links recorded by earlier Option-A builds.
   * 4. Exact stem match across same folder or workspace folders.
   * 5. Unique same-directory sibling fallback (never cross-folder fallback without explicit link or exact stem match).
   */
  public async resolvePairedStepSources(
    anchorUri: vscode.Uri,
    overrides?: {
      readonly scadText?: string | undefined;
      readonly stepText?: string | undefined;
      readonly defaultStepExt?: string | undefined;
    },
  ): Promise<PairedStepSources> {
    const allUris = await listWorkspaceCadUris();
    const anchorDir = dirPathOf(anchorUri);
    const allScad = allUris.filter((u) => isScadPath(u.path));
    const allQif = allUris.filter((u) => isQifPath(u.path));
    const allMo = allUris.filter((u) => isModelicaPath(u.path));
    const allStep = allUris.filter((u) => isStepPath(u.path));

    const sameDirScad = allScad.filter((u) => dirPathOf(u) === anchorDir);
    const sameDirQif = allQif.filter((u) => dirPathOf(u) === anchorDir);
    const sameDirMo = allMo.filter((u) => dirPathOf(u) === anchorDir);
    const sameDirStep = allStep.filter((u) => dirPathOf(u) === anchorDir);

    if (isScadPath(anchorUri.path)) {
      return this._resolveFromScad(anchorUri, { allScad, allQif, allMo, allStep }, overrides);
    }

    if (isQifPath(anchorUri.path)) {
      const qifKey = anchorUri.toString();
      const qifName = baseNameOf(anchorUri);
      const qifStem = stemOf(qifName);
      const qifText = await readWorkspaceText(anchorUri);
      const qifDirectives = qifText ? parseQifSourceDirectives(qifText) : {};

      // 1. Prefer previously linked `.scad`
      const linkedStepKey = this._qifToStepUri.get(qifKey);
      const linkedMeta = linkedStepKey ? this._compiledByStepUri.get(linkedStepKey) : undefined;
      if (linkedMeta?.scadUri) {
        const linkedScad = vscode.Uri.parse(linkedMeta.scadUri);
        const resolved = await this._resolveFromScad(linkedScad, { allScad, allQif, allMo, allStep }, overrides);
        return { ...resolved, qifUri: anchorUri };
      }

      // 2. Explicit `@scad_source:` inside this `.qif` (supports cross-folder relative paths)
      if (qifDirectives.scadSource) {
        const targetScad = matchDirectiveCandidateUri(anchorUri, qifDirectives.scadSource, allScad);
        if (targetScad) {
          const resolved = await this._resolveFromScad(targetScad, { allScad, allQif, allMo, allStep }, overrides);
          return {
            ...resolved,
            qifUri: anchorUri,
            modelicaUri:
              resolved.modelicaUri ??
              (qifDirectives.modelicaSource
                ? matchDirectiveCandidateUri(anchorUri, qifDirectives.modelicaSource, allMo)
                : undefined),
            stepUri:
              resolved.stepUri ??
              (qifDirectives.stepOutput
                ? matchDirectiveCandidateUri(anchorUri, qifDirectives.stepOutput, allStep)
                : undefined),
          };
        }
      }

      // 3. Check if any workspace SCAD explicitly references this QIF via `@qif_source:`
      for (const scadUri of allScad) {
        const txt = await readWorkspaceText(scadUri);
        if (!txt) continue;
        const directives = parseScadSourceDirectives(txt);
        if (uriMatchesDirective(scadUri, directives.qifSource, anchorUri, allQif)) {
          const resolved = await this._resolveFromScad(scadUri, { allScad, allQif, allMo, allStep }, { scadText: txt });
          return { ...resolved, qifUri: anchorUri };
        }
      }

      // 4. Check embedded STEP `@modelscript-meta` referencing this QIF
      for (const sUri of allStep) {
        const sTxt = await readWorkspaceText(sUri);
        const meta = sTxt ? parseStepProvenanceMeta(sTxt) : null;
        if (!meta?.qifSource) continue;
        if (uriMatchesDirective(sUri, meta.qifSource, anchorUri, allQif) && meta.scadSource) {
          const targetScad = matchDirectiveCandidateUri(sUri, meta.scadSource, allScad);
          if (targetScad) {
            const resolved = await this._resolveFromScad(targetScad, { allScad, allQif, allMo, allStep });
            return { ...resolved, qifUri: anchorUri, stepUri: sUri };
          }
        }
      }

      // 5. Same-directory stem / unique SCAD sibling, or cross-folder exact stem match
      const matchedScad =
        sameDirScad.find((u) => stemOf(baseNameOf(u)) === qifStem) ??
        (sameDirScad.length === 1 ? sameDirScad[0] : undefined) ??
        allScad.find((u) => stemOf(baseNameOf(u)) === qifStem);

      if (matchedScad) {
        const resolved = await this._resolveFromScad(matchedScad, { allScad, allQif, allMo, allStep });
        return { ...resolved, qifUri: resolved.qifUri ?? anchorUri };
      }

      return {
        qifUri: anchorUri,
        modelicaUri: qifDirectives.modelicaSource
          ? matchDirectiveCandidateUri(anchorUri, qifDirectives.modelicaSource, allMo)
          : (sameDirMo.find((u) => stemOf(baseNameOf(u)) === qifStem) ??
            (sameDirMo.length === 1 ? sameDirMo[0] : undefined)),
        stepUri: qifDirectives.stepOutput
          ? matchDirectiveCandidateUri(anchorUri, qifDirectives.stepOutput, allStep)
          : (sameDirStep.find((u) => stemOf(baseNameOf(u)) === qifStem) ??
            (sameDirStep.length === 1 ? sameDirStep[0] : undefined)),
        assemblyName: qifDirectives.assemblyName ?? qifStem,
      };
    }

    if (isStepPath(anchorUri.path)) {
      const stepKey = anchorUri.toString();
      const stepName = baseNameOf(anchorUri);
      const stepStem = stemOf(stepName);
      const cached = this._compiledByStepUri.get(stepKey);
      const stepText = overrides?.stepText ?? (await readWorkspaceText(anchorUri));
      const stepMeta = stepText ? parseStepProvenanceMeta(stepText) : null;

      let scadUri: vscode.Uri | undefined = cached?.scadUri ? vscode.Uri.parse(cached.scadUri) : undefined;
      let qifUri: vscode.Uri | undefined = cached?.qifUri ? vscode.Uri.parse(cached.qifUri) : undefined;
      let modelicaUri: vscode.Uri | undefined = cached?.modelicaUri ? vscode.Uri.parse(cached.modelicaUri) : undefined;
      let scadDirectives: ScadSourceDirectives | undefined;
      let qifDirectives: QifSourceDirectives | undefined;

      // 1. Honor embedded STEP `@modelscript-meta` provenance first (works across folders & restarts)
      if (!scadUri && stepMeta?.scadSource) {
        const candidate = matchDirectiveCandidateUri(anchorUri, stepMeta.scadSource, allScad);
        if (
          candidate &&
          (allScad.some((u) => u.path === candidate.path) || (await readWorkspaceText(candidate)) !== undefined)
        ) {
          scadUri = candidate;
        }
      }
      if (!qifUri && stepMeta?.qifSource) {
        const candidate = matchDirectiveCandidateUri(anchorUri, stepMeta.qifSource, allQif);
        if (
          candidate &&
          (allQif.some((u) => u.path === candidate.path) || (await readWorkspaceText(candidate)) !== undefined)
        ) {
          qifUri = candidate;
        }
      }
      if (!modelicaUri && stepMeta?.modelicaSource) {
        const candidate = matchDirectiveCandidateUri(anchorUri, stepMeta.modelicaSource, allMo);
        if (
          candidate &&
          (allMo.some((u) => u.path === candidate.path) || (await readWorkspaceText(candidate)) !== undefined)
        ) {
          modelicaUri = candidate;
        }
      }

      // 2. Scan workspace `.scad` files with explicit `@step_output:` targeting this STEP
      if (!scadUri) {
        for (const candidate of allScad) {
          const txt = await readWorkspaceText(candidate);
          if (!txt) continue;
          const dirs = parseScadSourceDirectives(txt);
          if (uriMatchesDirective(candidate, dirs.stepOutput, anchorUri, allStep)) {
            scadUri = candidate;
            scadDirectives = dirs;
            break;
          }
        }
      }

      // 3. Scan workspace `.qif` files with explicit `@step_output:` targeting this STEP
      if (!qifUri) {
        for (const candidate of allQif) {
          const txt = await readWorkspaceText(candidate);
          if (!txt) continue;
          const dirs = parseQifSourceDirectives(txt);
          if (uriMatchesDirective(candidate, dirs.stepOutput, anchorUri, allStep)) {
            qifUri = candidate;
            qifDirectives = dirs;
            if (!scadUri && dirs.scadSource) {
              scadUri = matchDirectiveCandidateUri(candidate, dirs.scadSource, allScad);
            }
            if (!modelicaUri && dirs.modelicaSource) {
              modelicaUri = matchDirectiveCandidateUri(candidate, dirs.modelicaSource, allMo);
            }
            break;
          }
        }
      }

      // 4. Same-directory stem/unique fallback or cross-folder exact stem match
      if (!scadUri) {
        scadUri =
          sameDirScad.find((u) => stemOf(baseNameOf(u)) === stepStem) ??
          (sameDirScad.length === 1 ? sameDirScad[0] : undefined) ??
          allScad.find((u) => stemOf(baseNameOf(u)) === stepStem);
      }

      if (scadUri && !scadDirectives) {
        const scadTxt = await readWorkspaceText(scadUri);
        if (scadTxt) {
          scadDirectives = parseScadSourceDirectives(scadTxt);
        }
      }

      if (!qifUri && scadUri && scadDirectives?.qifSource) {
        qifUri = matchDirectiveCandidateUri(scadUri, scadDirectives.qifSource, allQif);
      }
      if (!qifUri && scadUri) {
        for (const candidate of allQif) {
          const txt = await readWorkspaceText(candidate);
          if (!txt) continue;
          const dirs = parseQifSourceDirectives(txt);
          if (uriMatchesDirective(candidate, dirs.scadSource, scadUri, allScad)) {
            qifUri = candidate;
            qifDirectives = dirs;
            break;
          }
        }
      }
      if (!qifUri) {
        const scadStem = scadUri ? stemOf(baseNameOf(scadUri)) : undefined;
        qifUri =
          sameDirQif.find((u) => stemOf(baseNameOf(u)) === stepStem) ??
          (scadStem ? sameDirQif.find((u) => stemOf(baseNameOf(u)) === scadStem) : undefined) ??
          (sameDirQif.length === 1 ? sameDirQif[0] : undefined) ??
          allQif.find((u) => stemOf(baseNameOf(u)) === stepStem) ??
          (scadStem ? allQif.find((u) => stemOf(baseNameOf(u)) === scadStem) : undefined);
      }

      if (qifUri && !qifDirectives) {
        const qTxt = await readWorkspaceText(qifUri);
        if (qTxt) {
          qifDirectives = parseQifSourceDirectives(qTxt);
        }
      }

      if (!modelicaUri && scadUri && scadDirectives?.modelicaSource) {
        modelicaUri = matchDirectiveCandidateUri(scadUri, scadDirectives.modelicaSource, allMo);
      }
      if (!modelicaUri && qifUri && qifDirectives?.modelicaSource) {
        modelicaUri = matchDirectiveCandidateUri(qifUri, qifDirectives.modelicaSource, allMo);
      }
      if (!modelicaUri) {
        const scadStem = scadUri ? stemOf(baseNameOf(scadUri)) : undefined;
        modelicaUri =
          sameDirMo.find((u) => stemOf(baseNameOf(u)) === stepStem) ??
          (scadStem ? sameDirMo.find((u) => stemOf(baseNameOf(u)) === scadStem) : undefined) ??
          (sameDirMo.length === 1 ? sameDirMo[0] : undefined) ??
          allMo.find((u) => stemOf(baseNameOf(u)) === stepStem) ??
          (scadStem ? allMo.find((u) => stemOf(baseNameOf(u)) === scadStem) : undefined);
      }

      return {
        scadUri,
        qifUri,
        modelicaUri,
        stepUri: anchorUri,
        assemblyName: stepMeta?.assemblyName ?? scadDirectives?.assemblyName ?? qifDirectives?.assemblyName ?? stepStem,
      };
    }

    if (isModelicaPath(anchorUri.path)) {
      const moKey = anchorUri.toString();
      const moStem = stemOf(baseNameOf(anchorUri));

      const linkedStepKey = this._moToStepUri.get(moKey);
      const linkedMeta = linkedStepKey ? this._compiledByStepUri.get(linkedStepKey) : undefined;
      if (linkedMeta?.scadUri) {
        const resolved = await this._resolveFromScad(vscode.Uri.parse(linkedMeta.scadUri), {
          allScad,
          allQif,
          allMo,
          allStep,
        });
        return { ...resolved, modelicaUri: anchorUri };
      }

      // Check `.scad` files explicitly referencing this `.mo`
      for (const scadUri of allScad) {
        const txt = await readWorkspaceText(scadUri);
        if (!txt) continue;
        const dirs = parseScadSourceDirectives(txt);
        if (uriMatchesDirective(scadUri, dirs.modelicaSource, anchorUri, allMo)) {
          const resolved = await this._resolveFromScad(scadUri, { allScad, allQif, allMo, allStep }, { scadText: txt });
          return { ...resolved, modelicaUri: anchorUri };
        }
      }

      // Check `.qif` files explicitly referencing this `.mo`
      for (const qifUri of allQif) {
        const txt = await readWorkspaceText(qifUri);
        if (!txt) continue;
        const dirs = parseQifSourceDirectives(txt);
        if (uriMatchesDirective(qifUri, dirs.modelicaSource, anchorUri, allMo)) {
          if (dirs.scadSource) {
            const targetScad = matchDirectiveCandidateUri(qifUri, dirs.scadSource, allScad);
            if (targetScad) {
              const resolved = await this._resolveFromScad(targetScad, { allScad, allQif, allMo, allStep });
              return { ...resolved, qifUri: resolved.qifUri ?? qifUri, modelicaUri: anchorUri };
            }
          }
          const resolved = await this.resolvePairedStepSources(qifUri);
          return { ...resolved, modelicaUri: anchorUri };
        }
      }

      // Check active compiled STEP or STEP `@modelscript-meta` referencing this `.mo`
      for (const stepUri of allStep) {
        const sTxt = await readWorkspaceText(stepUri);
        const meta = sTxt ? parseStepProvenanceMeta(sTxt) : null;
        if (meta && uriMatchesDirective(stepUri, meta.modelicaSource, anchorUri, allMo)) {
          const resolved = await this.resolvePairedStepSources(stepUri, { stepText: sTxt });
          return { ...resolved, modelicaUri: anchorUri };
        }
      }

      // Same-directory stem / unique SCAD sibling, or exact stem match across folders
      const matchedScad =
        sameDirScad.find((u) => stemOf(baseNameOf(u)) === moStem) ??
        (sameDirScad.length === 1 ? sameDirScad[0] : undefined) ??
        allScad.find((u) => stemOf(baseNameOf(u)) === moStem);
      if (matchedScad) {
        const resolved = await this._resolveFromScad(matchedScad, { allScad, allQif, allMo, allStep });
        return { ...resolved, modelicaUri: anchorUri };
      }

      return {
        modelicaUri: anchorUri,
        stepUri:
          sameDirStep.find((u) => stemOf(baseNameOf(u)) === moStem) ??
          allStep.find((u) => stemOf(baseNameOf(u)) === moStem),
      };
    }

    return {};
  }

  private async _resolveFromScad(
    scadUri: vscode.Uri,
    workspaceUris: {
      readonly allScad: readonly vscode.Uri[];
      readonly allQif: readonly vscode.Uri[];
      readonly allMo: readonly vscode.Uri[];
      readonly allStep: readonly vscode.Uri[];
    },
    overrides?: { readonly scadText?: string | undefined; readonly defaultStepExt?: string | undefined },
  ): Promise<PairedStepSources> {
    const scadText = overrides?.scadText ?? (await readWorkspaceText(scadUri)) ?? "";
    const directives = parseScadSourceDirectives(scadText);
    const scadDir = dirPathOf(scadUri);
    const scadStem = stemOf(baseNameOf(scadUri));

    const sameDirQif = workspaceUris.allQif.filter((u) => dirPathOf(u) === scadDir);
    const sameDirMo = workspaceUris.allMo.filter((u) => dirPathOf(u) === scadDir);
    const sameDirStep = workspaceUris.allStep.filter((u) => dirPathOf(u) === scadDir);

    let qifUri: vscode.Uri | undefined;
    let qifDirectives: QifSourceDirectives | undefined;
    if (directives.qifSource) {
      qifUri = matchDirectiveCandidateUri(scadUri, directives.qifSource, workspaceUris.allQif);
    } else {
      // Check if any QIF across folders explicitly declares `@scad_source:` pointing here
      for (const candidateQif of workspaceUris.allQif) {
        const qTxt = await readWorkspaceText(candidateQif);
        if (!qTxt) continue;
        const qDirs = parseQifSourceDirectives(qTxt);
        if (uriMatchesDirective(candidateQif, qDirs.scadSource, scadUri, workspaceUris.allScad)) {
          qifUri = candidateQif;
          qifDirectives = qDirs;
          break;
        }
      }

      if (!qifUri) {
        qifUri =
          sameDirQif.find((u) => stemOf(baseNameOf(u)) === scadStem) ??
          (sameDirQif.length === 1 ? sameDirQif[0] : undefined) ??
          workspaceUris.allQif.find((u) => stemOf(baseNameOf(u)) === scadStem);
      }

      if (!qifUri) {
        // Direct probe for `<stem>.qif` even if `findFiles` did not return it
        const probePath = scadDir ? `${scadDir}/${scadStem}.qif` : `${scadStem}.qif`;
        const probe = scadUri.with({ path: probePath });
        const probeText = await readWorkspaceText(probe);
        if (probeText !== undefined) {
          qifUri = probe;
        }
      }
    }

    if (qifUri && !qifDirectives) {
      const qTxt = await readWorkspaceText(qifUri);
      if (qTxt) {
        qifDirectives = parseQifSourceDirectives(qTxt);
      }
    }

    let modelicaUri: vscode.Uri | undefined;
    if (directives.modelicaSource) {
      modelicaUri = matchDirectiveCandidateUri(scadUri, directives.modelicaSource, workspaceUris.allMo);
    } else if (qifUri && qifDirectives?.modelicaSource) {
      modelicaUri = matchDirectiveCandidateUri(qifUri, qifDirectives.modelicaSource, workspaceUris.allMo);
    } else {
      modelicaUri =
        sameDirMo.find((u) => stemOf(baseNameOf(u)) === scadStem) ??
        (sameDirMo.length === 1 ? sameDirMo[0] : undefined) ??
        workspaceUris.allMo.find((u) => stemOf(baseNameOf(u)) === scadStem);
    }

    let stepUri: vscode.Uri | undefined;
    if (directives.stepOutput) {
      stepUri = matchDirectiveCandidateUri(scadUri, directives.stepOutput, workspaceUris.allStep);
    } else if (qifUri && qifDirectives?.stepOutput) {
      stepUri = matchDirectiveCandidateUri(qifUri, qifDirectives.stepOutput, workspaceUris.allStep);
    } else {
      const mapped = this._scadToStepUri.get(scadUri.toString());
      if (mapped) {
        stepUri = vscode.Uri.parse(mapped);
      } else {
        // Check STEP files with embedded provenance pointing to this SCAD
        for (const sUri of workspaceUris.allStep) {
          const sTxt = await readWorkspaceText(sUri);
          const meta = sTxt ? parseStepProvenanceMeta(sTxt) : null;
          if (meta?.scadSource && uriMatchesDirective(sUri, meta.scadSource, scadUri, workspaceUris.allScad)) {
            stepUri = sUri;
            break;
          }
        }
        if (!stepUri) {
          stepUri =
            sameDirStep.find((u) => stemOf(baseNameOf(u)) === scadStem) ??
            (sameDirStep.length === 1 ? sameDirStep[0] : undefined) ??
            workspaceUris.allStep.find((u) => stemOf(baseNameOf(u)) === scadStem);
        }
      }
    }

    if (!stepUri) {
      const ext = overrides?.defaultStepExt ?? ".step";
      const targetPath = scadDir ? `${scadDir}/${scadStem}${ext}` : `${scadStem}${ext}`;
      stepUri = scadUri.with({ path: targetPath });
    }

    return {
      scadUri,
      qifUri,
      modelicaUri,
      stepUri,
      assemblyName: directives.assemblyName ?? qifDirectives?.assemblyName ?? scadStem,
    };
  }

  /**
   * Compile `.scad` (+ optional paired `.qif` & `.mo`) into ISO-10303-21 AP242 `.step` via LSP
   * `modelscript/compileStepFromSources`, write the target `.step` artifact, update cache,
   * and notify active listeners (e.g., open `StepEditorProvider` panels).
   */
  public async compileStepFromUri(
    triggerUri: vscode.Uri,
    options?: {
      readonly scadText?: string | undefined;
      readonly targetStepUri?: vscode.Uri | undefined;
      readonly assemblyName?: string | undefined;
    },
  ): Promise<CompiledStepMeta | undefined> {
    const client = this.getClient();
    if (!client) return undefined;

    const pair = await this.resolvePairedStepSources(triggerUri, { scadText: options?.scadText });
    const scadUri = pair.scadUri;
    if (!scadUri) return undefined;

    const targetStepUri = options?.targetStepUri ?? pair.stepUri;
    if (!targetStepUri) return undefined;

    const targetKey = targetStepUri.toString();
    if (this._compilingStepUris.has(targetKey)) {
      this._pendingRecompileScadUris.set(targetKey, scadUri);
      return undefined;
    }

    this._compilingStepUris.add(targetKey);
    try {
      const scadText = options?.scadText ?? (await readWorkspaceText(scadUri));
      if (scadText === undefined) return undefined;

      const qifText = pair.qifUri ? await readWorkspaceText(pair.qifUri) : undefined;
      const moText = pair.modelicaUri ? await readWorkspaceText(pair.modelicaUri) : undefined;
      const modelicaTelemetry = moText ? extractModelicaTelemetryParams(moText) : undefined;
      const response = await client.sendRequest<CompileStepFromSourcesResponse>("modelscript/compileStepFromSources", {
        scadText,
        qifText,
        scadUri: scadUri.toString(),
        qifUri: pair.qifUri?.toString(),
        stepUri: targetStepUri.toString(),
        modelicaUri: pair.modelicaUri?.toString(),
        assemblyName: options?.assemblyName ?? pair.assemblyName,
      });

      if (!response || response.error || !response.stepText) {
        return undefined;
      }

      this._suppressFsStepKeys.add(targetKey);
      try {
        await vscode.workspace.fs.writeFile(targetStepUri, textEncoder.encode(response.stepText));
      } finally {
        this._suppressFsStepKeys.delete(targetKey);
      }

      const meta: CompiledStepMeta = {
        compiledFromOptionA: true,
        scadUri: scadUri.toString(),
        qifUri: pair.qifUri?.toString(),
        modelicaUri: pair.modelicaUri?.toString(),
        stepUri: targetKey,
        stepText: response.stepText,
        spools: response.spools ?? [],
        gdtOverlay: response.gdtOverlay ?? extractStepGdtOverlay(response.stepText, qifText),
        modelicaTelemetry,
        partNames: response.partNames ?? [],
        compiledAt: Date.now(),
      };

      this._compiledByStepUri.set(targetKey, meta);
      this._scadToStepUri.set(scadUri.toString(), targetKey);
      if (pair.qifUri) {
        this._qifToStepUri.set(pair.qifUri.toString(), targetKey);
      }
      if (pair.modelicaUri) {
        this._moToStepUri.set(pair.modelicaUri.toString(), targetKey);
      }
      this._onDidCompileStep.fire(meta);
      return meta;
    } finally {
      this._compilingStepUris.delete(targetKey);
      const queuedScad = this._pendingRecompileScadUris.get(targetKey);
      if (queuedScad) {
        this._pendingRecompileScadUris.delete(targetKey);
        void this.compileStepFromUri(queuedScad, { targetStepUri });
      }
    }
  }

  /**
   * Build the live GD&T overlay + `@spool` kinematics + Modelica telemetry + source provenance payload
   * for any opened `.step` document. Works for both Option-A compiled assemblies and standalone AP242 files
   * carrying embedded `/* @modelscript-meta {...} *\/` provenance.
   */
  public async resolveStepOverlay(stepUri: vscode.Uri, stepText: string): Promise<StepOverlayPayload> {
    const stepKey = stepUri.toString();
    const cached = this._compiledByStepUri.get(stepKey);
    const stepMeta = parseStepProvenanceMeta(stepText);
    const pair = await this.resolvePairedStepSources(stepUri, { stepText });

    const scadUriStr = pair.scadUri?.toString() ?? cached?.scadUri;
    const qifUriStr = pair.qifUri?.toString() ?? cached?.qifUri;
    const modelicaUriStr = pair.modelicaUri?.toString() ?? cached?.modelicaUri;

    const scadText = pair.scadUri ? await readWorkspaceText(pair.scadUri) : undefined;
    const qifText = pair.qifUri ? await readWorkspaceText(pair.qifUri) : undefined;
    const moText = pair.modelicaUri ? await readWorkspaceText(pair.modelicaUri) : undefined;

    const gdtOverlay = extractStepGdtOverlay(stepText, qifText);
    const spools = scadText
      ? parseScadSpoolDirectives(scadText)
      : cached?.spools && cached.spools.length > 0
        ? cached.spools
        : (stepMeta?.spools ?? []);
    const modelicaTelemetry = moText ? extractModelicaTelemetryParams(moText) : cached?.modelicaTelemetry;
    const compiledFromOptionA = Boolean(
      cached?.compiledFromOptionA ||
      (stepMeta !== null && stepLooksCompiledAp242(stepText)) ||
      (scadUriStr && stepLooksCompiledAp242(stepText)),
    );

    if (scadUriStr) {
      this._scadToStepUri.set(scadUriStr, stepKey);
    }
    if (qifUriStr) {
      this._qifToStepUri.set(qifUriStr, stepKey);
    }
    if (modelicaUriStr) {
      this._moToStepUri.set(modelicaUriStr, stepKey);
    }

    return {
      compiledFromOptionA,
      scadUri: scadUriStr,
      qifUri: qifUriStr,
      modelicaUri: modelicaUriStr,
      stepUri: stepKey,
      gdtOverlay,
      spools,
      ...(modelicaTelemetry ? { modelicaTelemetry } : {}),
    };
  }

  /**
   * Handle edits or saves to `.scad` / `.qif` / `.mo` documents, scheduling debounced STEP recompilation
   * (for `.scad`/`.qif`) or overlay refresh (for `.mo` RPM telemetry) when an active viewer or compiled `.step` exists.
   */
  public async handleSourceDocumentEvent(uri: vscode.Uri, immediate: boolean): Promise<void> {
    const isMo = isModelicaPath(uri.path);
    if (!isScadPath(uri.path) && !isQifPath(uri.path) && !isMo) return;

    const pair = await this.resolvePairedStepSources(uri);
    if (!pair.stepUri) return;

    const stepKey = pair.stepUri.toString();
    const isActiveTarget = this._activeStepUris.has(stepKey) || this._compiledByStepUri.has(stepKey);
    let existingStepText: string | undefined = this._compiledByStepUri.get(stepKey)?.stepText;
    let hasExistingCompiledStep = isActiveTarget;
    if (!hasExistingCompiledStep) {
      existingStepText = await readWorkspaceText(pair.stepUri);
      hasExistingCompiledStep = Boolean(existingStepText && stepLooksCompiledAp242(existingStepText));
    }
    if (!hasExistingCompiledStep) return;

    if (isMo) {
      const refreshOverlay = async (): Promise<void> => {
        const text = existingStepText ?? (await readWorkspaceText(pair.stepUri!)) ?? "";
        if (!text) return;
        const overlay = await this.resolveStepOverlay(pair.stepUri!, text);
        const existingMeta = this._compiledByStepUri.get(stepKey);
        if (existingMeta) {
          this._compiledByStepUri.set(stepKey, {
            ...existingMeta,
            modelicaUri: overlay.modelicaUri,
            modelicaTelemetry: overlay.modelicaTelemetry,
          });
        }
        this._onDidRefreshOverlay.fire(overlay);
      };

      const existingTimer = this._moOverlayTimers.get(stepKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this._moOverlayTimers.delete(stepKey);
      }
      if (immediate) {
        await refreshOverlay();
        return;
      }
      this._moOverlayTimers.set(
        stepKey,
        setTimeout(() => {
          this._moOverlayTimers.delete(stepKey);
          void refreshOverlay();
        }, this._debounceMs),
      );
      return;
    }

    if (!pair.scadUri) return;

    const existingTimer = this._debounceTimers.get(stepKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this._debounceTimers.delete(stepKey);
    }

    if (immediate) {
      await this.compileStepFromUri(pair.scadUri, { targetStepUri: pair.stepUri });
      return;
    }

    const scadUri = pair.scadUri;
    const targetStepUri = pair.stepUri;
    this._debounceTimers.set(
      stepKey,
      setTimeout(() => {
        this._debounceTimers.delete(stepKey);
        void this.compileStepFromUri(scadUri, { targetStepUri });
      }, this._debounceMs),
    );
  }

  private _registerWorkspaceWatchers(): void {
    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        void this.handleSourceDocumentEvent(event.document.uri, false);
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        void this.handleSourceDocumentEvent(document.uri, true);
      }),
    );
  }
}
