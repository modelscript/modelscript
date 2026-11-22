// SPDX-License-Identifier: AGPL-3.0-or-later

import { createModelicaQueryEngine, createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import modelicaLangFallback from "@modelscript/modelica/language";
import { createWasmParser } from "@modelscript/modelica/parser";
import {
  extractCrossLanguageLinks,
  isTypeLikeSymbol,
  PolyglotDriftChecker,
  PolyglotTransformer,
  symbolEntryToPolyglotNode,
  UnifiedWorkspace,
  type CorrespondenceDiagnostic,
  type PolyglotModelSource,
  type SymbolEntry,
  type SymbolIndex,
  type WorkspaceIndex,
} from "@modelscript/runtime";
import { createSysML2QueryEngine } from "@modelscript/sysml2/factory";
import sysml2LangFallback from "@modelscript/sysml2/language";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Argv, CommandModule } from "yargs";

import { LanguageResolver } from "../util/language-registry.js";
import { buildSarifLog } from "../util/sarif.js";

const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

/** CLI arguments for the `msx lint` polyglot linting command. */
interface LintArgs {
  /** Primary file or directory path to lint. */
  path: string;
  /** Additional file or directory paths to load into the workspace. */
  paths: string[] | undefined;
  /** Optional language ID filter (`"modelica"`, `"sysml2"`, `"owl2"`, `"scad"`, `"ssp"`, `"cfd"`, `"fea"`, `"pscad"`, `"fortran"`, `"easy5"`, `"rocets"`, `"lps"`, `"sima"`, `"gtsuite"`). */
  language?: string | undefined;
  /** Diagnostic output format (`"terminal"`, `"json"`, or `"sarif"`). */
  format?: "terminal" | "json" | "sarif" | undefined;
  /** Base directory to relativize artifact URIs against in SARIF output. */
  sarifBase?: string | undefined;
  "sarif-base"?: string | undefined;
  /** File path to write diagnostic report to instead of stdout. */
  out?: string | undefined;
  /** OWL 2 ontology profile to validate against (`"DL"` or `"EL"`). */
  profile?: "DL" | "EL" | undefined;
  /** Whether to treat warnings as fatal errors with non-zero exit code. */
  strict?: boolean | undefined;
  /** Whether to run on-demand M7xxx formal verification checks for Modelica models. */
  formal?: boolean | undefined;
}

interface LintDiagnosticItem {
  severity: "error" | "warning" | "info" | "hint" | "notification";
  lintName: string;
  code?: string | number | undefined;
  domain?: string | undefined;
  message: string;
  symbolId: number | null;
  resourceId?: string | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

interface CstRootLike {
  id?: number | undefined;
  ptr?: number | undefined;
  text?: string | undefined;
  hasError?: boolean | (() => boolean) | undefined;
  descendantForIndex?: ((startIndex: number, endIndex: number) => unknown) | undefined;
}

function nodeHasError(node: { hasError?: boolean | (() => boolean) | undefined } | null | undefined): boolean {
  if (!node || !node.hasError) return false;
  return typeof node.hasError === "function" ? (node.hasError as () => boolean)() : Boolean(node.hasError);
}

/**
 * Converts a 0-based UTF-16 character/byte offset into a 1-based `{ line, col }` coordinate.
 */
function byteToLineCol(text: string, byteOffset: number): { line: number; col: number } {
  const slice = text.slice(0, Math.max(0, byteOffset));
  const lines = slice.split("\n");
  const line = lines.length;
  const col = (lines[lines.length - 1]?.length ?? 0) + 1;
  return { line, col };
}

/**
 * Converts a 1-based `(line1, col1)` position into a 0-based byte/character offset.
 */
function lineColToByte(text: string, line1: number, col1: number): number {
  const lines = text.split("\n");
  let offset = 0;
  const targetLine = Math.max(1, line1);
  for (let i = 0; i < targetLine - 1 && i < lines.length; i++) {
    offset += (lines[i]?.length ?? 0) + 1;
  }
  return offset + Math.max(0, col1 - 1);
}

/** Recognized CalculiX- and Abaqus-compatible `.inp` FEA keyword card names for syntax validation. */
const VALID_FEA_CARDS = new Set([
  "HEADING",
  "NODE",
  "ELEMENT",
  "MATERIAL",
  "ELASTIC",
  "DENSITY",
  "EXPANSION",
  "SOLID SECTION",
  "SHELL SECTION",
  "BEAM SECTION",
  "BOUNDARY",
  "STEP",
  "STATIC",
  "DYNAMIC",
  "FREQUENCY",
  "BUCKLE",
  "MODAL DYNAMIC",
  "STEADY STATE DYNAMICS",
  "CLOAD",
  "DLOAD",
  "DSLOAD",
  "OUTPUT",
  "NODE FILE",
  "EL FILE",
  "NODE PRINT",
  "EL PRINT",
  "END STEP",
  "INCLUDE",
  "TRANSFORM",
  "SURFACE",
  "CONTACT PAIR",
  "TIE",
  "AMPLITUDE",
  "INITIAL CONDITIONS",
  "NSET",
  "ELSET",
  "SPRING",
  "DASHPOT",
  "RIGID BODY",
  "MASS",
  "ORIENTATION",
  "PLASTIC",
  "DEFORMATION PLASTICITY",
  "HYPERELASTIC",
  "CONDUCTIVITY",
  "SPECIFIC HEAT",
  "FILM",
  "RADIATE",
  "TEMPERATURE",
  "RESTART",
  "MONITOR",
  "PRINT",
  "SURFACE INTERACTION",
  "FRICTION",
  "COUPLING",
]);

/**
 * Performs lexical and structural linting on an SU2-compatible CFD configuration file (`KEY = VALUE` directives,
 * balanced parentheses, and embedded `{{...}}` parameter expressions).
 */
function lintCfdText(text: string, resourceId: string): LintDiagnosticItem[] {
  const diags: LintDiagnosticItem[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("%") || trimmed.startsWith("//") || trimmed.startsWith("#")) {
      continue;
    }

    const commentMatch = rawLine.match(/(%|\/\/|#)/);
    const codeLine = commentMatch ? rawLine.slice(0, commentMatch.index) : rawLine;
    const cleanCode = codeLine.trim();
    if (!cleanCode) continue;

    if (!cleanCode.includes("=")) {
      const col = Math.max(0, rawLine.indexOf(cleanCode));
      const startOffset = lineColToByte(text, i + 1, col + 1);
      diags.push({
        severity: "error",
        lintName: "cfd-missing-equals",
        code: "CFD-001",
        message: "Syntax Error: Expected '=' in directive assignment (e.g. KEY = VALUE)",
        symbolId: null,
        resourceId,
        startOffset,
        endOffset: startOffset + cleanCode.length,
      });
      continue;
    }

    const eqIdx = codeLine.indexOf("=");
    const key = codeLine.slice(0, eqIdx).trim();
    const val = codeLine.slice(eqIdx + 1).trim();

    if (!key) {
      const startOffset = lineColToByte(text, i + 1, 1);
      diags.push({
        severity: "error",
        lintName: "cfd-missing-key",
        code: "CFD-002",
        message: "Syntax Error: Missing directive keyword before '='",
        symbolId: null,
        resourceId,
        startOffset,
        endOffset: startOffset + eqIdx,
      });
    } else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      const keyCol = Math.max(0, rawLine.indexOf(key));
      const startOffset = lineColToByte(text, i + 1, keyCol + 1);
      diags.push({
        severity: "error",
        lintName: "cfd-invalid-key",
        code: "CFD-003",
        message: `Syntax Error: Invalid directive keyword '${key}'`,
        symbolId: null,
        resourceId,
        startOffset,
        endOffset: startOffset + key.length,
      });
    }

    if (!val) {
      const startOffset = lineColToByte(text, i + 1, eqIdx + 1);
      diags.push({
        severity: "error",
        lintName: "cfd-missing-value",
        code: "CFD-004",
        message: `Syntax Error: Expected value expression after '=' for directive '${key}'`,
        symbolId: null,
        resourceId,
        startOffset,
        endOffset: startOffset + Math.max(1, rawLine.length - eqIdx),
      });
    } else {
      const openParens = (val.match(/\(/g) || []).length;
      const closeParens = (val.match(/\)/g) || []).length;
      if (openParens !== closeParens) {
        const valCol = Math.max(0, rawLine.indexOf(val));
        const startOffset = lineColToByte(text, i + 1, valCol + 1);
        diags.push({
          severity: "error",
          lintName: "cfd-unbalanced-parens",
          code: "CFD-005",
          message: `Syntax Error: Mismatched parentheses in directive value (${openParens} '(' vs ${closeParens} ')')`,
          symbolId: null,
          resourceId,
          startOffset,
          endOffset: startOffset + val.length,
        });
      }

      const openBraces = (val.match(/\{\{/g) || []).length;
      const closeBraces = (val.match(/\}\}/g) || []).length;
      if (openBraces !== closeBraces) {
        const valCol = Math.max(0, rawLine.indexOf(val));
        const startOffset = lineColToByte(text, i + 1, valCol + 1);
        diags.push({
          severity: "error",
          lintName: "cfd-unclosed-expression",
          code: "CFD-006",
          message: "Syntax Error: Unclosed embedded parameter expression '{{'",
          symbolId: null,
          resourceId,
          startOffset,
          endOffset: startOffset + val.length,
        });
      }
    }
  }
  return diags;
}

/**
 * Performs lexical and card-schema linting on a CalculiX- and Abaqus-compatible `.inp` FEA deck.
 */
function lintFeaText(text: string, resourceId: string): LintDiagnosticItem[] {
  const diags: LintDiagnosticItem[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("**") || trimmed.startsWith("$") || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed.startsWith("*")) {
      const cardContent = trimmed.slice(1).trim();
      if (!cardContent) {
        const col = Math.max(0, rawLine.indexOf("*"));
        const startOffset = lineColToByte(text, i + 1, col + 1);
        diags.push({
          severity: "error",
          lintName: "fea-empty-card",
          code: "FEA-001",
          message: "Syntax Error: Missing keyword card name after '*'",
          symbolId: null,
          resourceId,
          startOffset,
          endOffset: startOffset + 1,
        });
        continue;
      }

      const cardTokens = cardContent.split(",").map((s) => s.trim());
      const cardName = (cardTokens[0] ?? "").toUpperCase();

      if (!VALID_FEA_CARDS.has(cardName)) {
        const cardCol = Math.max(0, rawLine.indexOf(cardTokens[0] ?? ""));
        const startOffset = lineColToByte(text, i + 1, cardCol + 1);
        diags.push({
          severity: "error",
          lintName: "fea-unknown-card",
          code: "FEA-002",
          message: `Syntax Error: Unknown keyword card '*${cardName}'`,
          symbolId: null,
          resourceId,
          startOffset,
          endOffset: startOffset + (cardTokens[0]?.length ?? 1),
        });
      }

      for (let pIdx = 1; pIdx < cardTokens.length; pIdx++) {
        const param = cardTokens[pIdx];
        if (!param) {
          const startOffset = lineColToByte(text, i + 1, 1);
          diags.push({
            severity: "error",
            lintName: "fea-empty-param",
            code: "FEA-003",
            message: `Syntax Error: Empty parameter definition in card '*${cardName}'`,
            symbolId: null,
            resourceId,
            startOffset,
            endOffset: startOffset + rawLine.length,
          });
          continue;
        }
        if (param.includes("=")) {
          const eq = param.indexOf("=");
          const pKey = param.slice(0, eq).trim();
          const pVal = param.slice(eq + 1).trim();
          if (!pKey || !pVal) {
            const startOffset = lineColToByte(text, i + 1, 1);
            diags.push({
              severity: "error",
              lintName: "fea-malformed-param",
              code: "FEA-004",
              message: `Syntax Error: Malformed parameter '${param}' in card '*${cardName}'`,
              symbolId: null,
              resourceId,
              startOffset,
              endOffset: startOffset + rawLine.length,
            });
          }
        }
      }
      continue;
    }

    const openBraces = (trimmed.match(/\{\{/g) || []).length;
    const closeBraces = (trimmed.match(/\}\}/g) || []).length;
    if (openBraces !== closeBraces) {
      const col = Math.max(0, rawLine.indexOf(trimmed));
      const startOffset = lineColToByte(text, i + 1, col + 1);
      diags.push({
        severity: "error",
        lintName: "fea-unclosed-expression",
        code: "FEA-005",
        message: "Syntax Error: Unclosed embedded parameter expression '{{'",
        symbolId: null,
        resourceId,
        startOffset,
        endOffset: startOffset + trimmed.length,
      });
    }
  }
  return diags;
}

/**
 * Validates STEP (ISO 10303-21) entity reference integrity (`#id`) and arity against `STEP_SCHEMA`.
 */
async function lintStepText(text: string, resourceId: string): Promise<LintDiagnosticItem[]> {
  const diags: LintDiagnosticItem[] = [];
  const { parseStepReferences, STEP_SCHEMA } = await import("@modelscript/step");
  const { definitions, references } = parseStepReferences(text);

  for (const ref of references) {
    if (!definitions.has(ref.id)) {
      diags.push({
        severity: "error",
        lintName: "step-undefined-reference",
        code: "STEP-001",
        message: `Reference to undefined entity '${ref.id}'`,
        symbolId: null,
        resourceId,
        startOffset: ref.startOffset,
        endOffset: ref.endOffset,
      });
    }
  }

  for (const [, def] of definitions.entries()) {
    const schema = STEP_SCHEMA[def.type];
    if (schema) {
      let i = def.endOffset;
      while (i < text.length && /\s/.test(text[i] ?? "")) i++;
      if (text[i] === "(") {
        const argsStart = i;
        let depth = 0;
        let inStr = false;
        let argCount = 0;
        let hasContent = false;

        for (i = argsStart; i < text.length; i++) {
          const ch = text[i];
          if (ch === "'") {
            if (inStr && text[i + 1] === "'") {
              i++;
            } else {
              inStr = !inStr;
            }
            hasContent = true;
          } else if (!inStr && ch === "(") {
            if (depth > 0) hasContent = true;
            depth++;
          } else if (!inStr && ch === ")") {
            depth--;
            if (depth === 0) {
              if (hasContent || argCount > 0) argCount++;
              break;
            }
            hasContent = true;
          } else if (!inStr && depth === 1 && ch === ",") {
            argCount++;
            hasContent = false;
          } else if (depth > 0 && !/\s/.test(ch ?? "")) {
            hasContent = true;
          }
        }

        if (argCount !== schema.parameters.length) {
          const typeMatchIndex = def.text.indexOf(def.type);
          const typeStartOffset = typeMatchIndex !== -1 ? def.startOffset + typeMatchIndex : def.startOffset;
          diags.push({
            severity: "error",
            lintName: "step-schema-violation",
            code: "STEP-002",
            message: `Schema violation for ${def.type}: expected ${schema.parameters.length} arguments, got ${argCount}.`,
            symbolId: null,
            resourceId,
            startOffset: typeStartOffset,
            endOffset: typeStartOffset + def.type.length,
          });
        }
      }
    } else if (def.type !== "COMPLEX_ENTITY") {
      const typeMatchIndex = def.text.indexOf(def.type);
      const typeStartOffset = typeMatchIndex !== -1 ? def.startOffset + typeMatchIndex : def.startOffset;
      diags.push({
        severity: "error",
        lintName: "step-undefined-entity-type",
        code: "STEP-003",
        message: `Undefined STEP entity type '${def.type}'`,
        symbolId: null,
        resourceId,
        startOffset: typeStartOffset,
        endOffset: typeStartOffset + def.type.length,
      });
    }
  }

  return diags;
}

/**
 * Recursively walks a directory or file path and collects all files matching `recognizedExts`.
 */
function findPolyglotFiles(dir: string, fileList: string[] = [], recognizedExts: Set<string>) {
  if (!fs.existsSync(dir)) return fileList;
  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    const ext = path.extname(dir).toLowerCase();
    if (recognizedExts.has(ext)) {
      fileList.push(dir);
    }
  } else if (stat.isDirectory()) {
    for (const file of fs.readdirSync(dir)) {
      if (["node_modules", "dist", ".git", "build"].includes(file)) continue;
      findPolyglotFiles(path.join(dir, file), fileList, recognizedExts);
    }
  }
  return fileList;
}

function mapCorrespondenceCodeAndRule(
  diagCode: CorrespondenceDiagnostic["code"],
  langId: "modelica" | "sysml2",
): { code: number; rule: string } {
  if (langId === "modelica") {
    switch (diagCode) {
      case "CONFORMANCE_MISSING_PORT":
        return { code: 4140, rule: "tgg-conformance-missing-port" };
      case "CONFORMANCE_PARAM_MISMATCH":
        return { code: 4141, rule: "tgg-conformance-param-mismatch" };
      case "CONFORMANCE_MISSING_COMPONENT":
        return { code: 4142, rule: "tgg-conformance-missing-component" };
      case "CONFORMANCE_UNRESOLVED_TARGET":
        return { code: 4143, rule: "tgg-conformance-unresolved-target" };
    }
  }
  switch (diagCode) {
    case "CONFORMANCE_MISSING_PORT":
      return { code: 4080, rule: "tgg-conformance-missing-port" };
    case "CONFORMANCE_PARAM_MISMATCH":
      return { code: 4081, rule: "tgg-conformance-param-mismatch" };
    case "CONFORMANCE_MISSING_COMPONENT":
      return { code: 4082, rule: "tgg-conformance-missing-component" };
    case "CONFORMANCE_UNRESOLVED_TARGET":
      return { code: 4083, rule: "tgg-conformance-unresolved-target" };
  }
}

function enrichSysmlTwinMetadata(db: SymbolIndex, sysmlItems: readonly { uri: string; text: string }[]): void {
  const textByUri = new Map<string, string>();
  for (const item of sysmlItems) {
    textByUri.set(item.uri, item.text);
  }

  for (const sym of db.symbols.values()) {
    const uri = sym.resourceId ?? sym.documentUri ?? "";
    const docText = textByUri.get(uri);
    if (!docText) continue;

    const existing = sym.metadata as Record<string, unknown> | undefined;
    if (existing?.["twin"] || existing?.["implements"] || existing?.["counterpart"]) continue;

    // 1. Check direct MetadataUsage / PrefixMetadataUsage children (`@twin { target = "..."; }`, `metadata twin { ... }`)
    const childIds = db.childrenOf.get(sym.id) ?? [];
    let discoveredTarget: string | undefined;
    let relationField: "twin" | "implements" = "twin";

    for (const cid of childIds) {
      const child = db.symbols.get(cid);
      if (!child || (child.ruleName !== "MetadataUsage" && child.ruleName !== "PrefixMetadataUsage")) continue;
      const slice = docText.slice(child.startOffset, child.endOffset);
      const typingGrandchild = (db.childrenOf.get(child.id) ?? [])
        .map((gid) => db.symbols.get(gid))
        .find((g) => g?.ruleName === "MetadataTyping");
      const metaName = (typingGrandchild?.name || child.name || "").trim().toLowerCase();
      const isTwinMeta =
        metaName === "twin" ||
        metaName === "counterpart" ||
        metaName === "implements" ||
        /^\s*(?:@|#|metadata\s+)(?:twin|counterpart|implements)\b/i.test(slice);
      if (!isTwinMeta) continue;
      if (metaName === "implements" || /^\s*(?:@|#|metadata\s+)implements\b/i.test(slice)) {
        relationField = "implements";
      }
      const quoted = /"([^"]+)"/.exec(slice)?.[1]?.trim();
      if (quoted) {
        discoveredTarget = quoted;
        break;
      }
    }

    // 2. Fallback: header-only `@twin("...")` or `SysML(implements = "...")` before `{`
    if (!discoveredTarget && (sym.kind === "Definition" || sym.kind === "Usage")) {
      const fullSlice = docText.slice(sym.startOffset, sym.endOffset);
      const braceIdx = fullSlice.indexOf("{");
      const header = braceIdx === -1 ? fullSlice : fullSlice.slice(0, braceIdx);
      const sysmlImpl = /\bSysML\s*\(\s*implements\s*=\s*"([^"]+)"\s*\)/.exec(header)?.[1]?.trim();
      if (sysmlImpl) {
        discoveredTarget = sysmlImpl;
        relationField = "implements";
      } else {
        const inlineTwin = /@(?:twin|counterpart)\s*\(\s*"([^"]+)"\s*\)/i.exec(header)?.[1]?.trim();
        if (inlineTwin) {
          discoveredTarget = inlineTwin;
        }
      }
    }

    if (discoveredTarget) {
      sym.metadata = { ...(existing ?? {}), [relationField]: discoveredTarget };
    }
  }
}

function collectCliTggAndDriftDiagnostics(params: {
  u: UnifiedWorkspace;
  db: SymbolIndex;
  modelicaItems: readonly { uri: string; text: string }[];
  sysmlItems: readonly { uri: string; text: string }[];
  astMap: ReadonlyMap<string, CstRootLike | undefined>;
  diagnostics: LintDiagnosticItem[];
}): void {
  const { u, db, modelicaItems, sysmlItems, astMap, diagnostics } = params;

  if (sysmlItems.length > 0) {
    enrichSysmlTwinMetadata(db, sysmlItems);
  }

  const dbView = {
    symbol: (id: number) => db.symbols.get(id),
    childrenOf: (id: number | null) =>
      (db.childrenOf.get(id) ?? [])
        .map((cid: number) => db.symbols.get(cid))
        .filter((s): s is SymbolEntry => Boolean(s)),
    byName: (name: string) =>
      (db.byName.get(name) ?? []).map((id: number) => db.symbols.get(id)).filter((s): s is SymbolEntry => Boolean(s)),
  };

  const transformerCache = new Map<string, PolyglotTransformer>();
  const getTransformer = (langId: string): PolyglotTransformer => {
    const norm = langId.toLowerCase();
    const cached = transformerCache.get(norm);
    if (cached) return cached;
    const uwWithFactory = u as UnifiedWorkspace & {
      createPolyglotTransformer?: (lang: string) => PolyglotTransformer | null;
    };
    let tr: PolyglotTransformer | null = null;
    if (typeof uwWithFactory.createPolyglotTransformer === "function") {
      try {
        tr = uwWithFactory.createPolyglotTransformer(norm) ?? null;
      } catch {
        tr = null;
      }
    }
    if (!tr) {
      const polyDef =
        norm === "modelica"
          ? (modelicaLangFallback as { polyglot?: unknown }).polyglot
          : norm === "sysml2"
            ? (sysml2LangFallback as { polyglot?: unknown }).polyglot
            : undefined;
      tr = polyDef
        ? new PolyglotTransformer(polyDef as ConstructorParameters<typeof PolyglotTransformer>[0])
        : new PolyglotTransformer();
    }
    transformerCache.set(norm, tr);
    return tr;
  };

  const inferTargetLang = (targetPath: string, fallbackLang: "modelica" | "sysml2"): string => {
    const lower = targetPath.toLowerCase();
    if (lower.startsWith("sysml2::") || lower.startsWith("sysml::")) return "sysml2";
    if (lower.startsWith("modelica::")) return "modelica";
    if (targetPath.includes("::") && fallbackLang === "modelica") return "sysml2";
    return fallbackLang === "modelica" ? "sysml2" : "modelica";
  };

  const allDocs: Array<{ uri: string; text: string; langId: "modelica" | "sysml2" }> = [
    ...modelicaItems.map((i) => ({ ...i, langId: "modelica" as const })),
    ...sysmlItems.map((i) => ({ ...i, langId: "sysml2" as const })),
  ];

  if (modelicaItems.length > 0 && sysmlItems.length > 0) {
    u.syncTggCorrespondences?.(db);
  }

  for (const item of allDocs) {
    const normLang = item.langId;
    const rootNode = astMap.get(item.uri);
    let links: ReturnType<typeof extractCrossLanguageLinks> = [];
    try {
      links = extractCrossLanguageLinks({
        uri: item.uri,
        language: normLang,
        index: db,
        text: item.text,
        tree: rootNode
          ? {
              rootNode: rootNode as unknown as NonNullable<
                NonNullable<Parameters<typeof extractCrossLanguageLinks>[0]["tree"]>["rootNode"]
              >,
            }
          : undefined,
      });
    } catch {
      continue;
    }

    const explicitLinks = links.filter((l) => l.relationKind === "twin" || l.relationKind === "implements");
    const srcTransformer = getTransformer(normLang);
    const validatedPairs = new Set<string>();

    const validatePair = (
      srcEntry: SymbolEntry,
      tgtEntry: SymbolEntry | null,
      targetNameHint: string,
      fallbackLine: number,
      fallbackCol: number,
    ) => {
      const pairKey = `${srcEntry.id}:${tgtEntry?.id ?? targetNameHint}`;
      if (validatedPairs.has(pairKey)) return;
      validatedPairs.add(pairKey);

      const startOffset =
        srcEntry.startOffset >= 0 ? srcEntry.startOffset : lineColToByte(item.text, fallbackLine, fallbackCol);
      const endOffset = Math.min(item.text.length, startOffset + Math.max(1, srcEntry.name.length));

      const srcNode = symbolEntryToPolyglotNode(dbView, srcEntry);
      if (!tgtEntry) {
        const expectedLang = inferTargetLang(targetNameHint, normLang);
        const corrDiags = srcTransformer.validateCorrespondence(srcNode, null, normLang, expectedLang);
        for (const cd of corrDiags) {
          const mapped = mapCorrespondenceCodeAndRule(cd.code, normLang);
          diagnostics.push({
            severity: cd.severity === "error" ? "error" : "warning",
            lintName: mapped.rule,
            code: mapped.code,
            domain: normLang,
            message: cd.message,
            symbolId: srcEntry.id,
            resourceId: item.uri,
            startOffset,
            endOffset,
          });
        }
        return;
      }

      const tgtLang = (tgtEntry.language ?? inferTargetLang(targetNameHint, normLang)).toLowerCase();
      if (tgtLang === normLang) return;
      if (!isTypeLikeSymbol(srcEntry)) return;

      const tgtNode = symbolEntryToPolyglotNode(dbView, tgtEntry);
      const seenCorr = new Set<string>();
      const emitCorr = (cd: CorrespondenceDiagnostic) => {
        const key = `${cd.code}:${cd.expectedName ?? cd.elementName}`;
        if (seenCorr.has(key)) return;
        seenCorr.add(key);
        const mapped = mapCorrespondenceCodeAndRule(cd.code, normLang);
        diagnostics.push({
          severity: cd.severity === "error" ? "error" : "warning",
          lintName: mapped.rule,
          code: mapped.code,
          domain: normLang,
          message: cd.message,
          symbolId: srcEntry.id,
          resourceId: item.uri,
          startOffset,
          endOffset,
        });
      };

      for (const cd of srcTransformer.validateCorrespondence(srcNode, tgtNode, normLang, tgtLang)) {
        emitCorr(cd);
      }

      const tgtTransformer = getTransformer(tgtLang);
      for (const cd of tgtTransformer.validateCorrespondence(tgtNode, srcNode, tgtLang, normLang)) {
        emitCorr(cd);
      }
    };

    for (const link of explicitLinks) {
      const srcEntry = db.symbols.get(link.sourceSymbolId);
      if (!srcEntry) continue;
      validatePair(srcEntry, link.targetEntry ?? null, link.targetName, link.sourceLine, link.sourceColumn);
    }

    const tggIndexer = u.tggCorrespondenceIndexer;
    if (tggIndexer && modelicaItems.length > 0 && sysmlItems.length > 0) {
      for (const sym of db.symbols.values()) {
        if ((sym.resourceId || sym.documentUri || "") !== item.uri) continue;
        for (const slot of tggIndexer.getSlotsForSymbol(sym.id)) {
          const rec = tggIndexer.hypergraph.getRecord(slot);
          if (!rec || rec.isRemoved) continue;
          for (const memberId of Object.values(rec.domainNodes)) {
            if (typeof memberId === "number" && memberId !== sym.id) {
              const peer = db.symbols.get(memberId);
              if (peer) validatePair(sym, peer, peer.name, 1, 1);
            }
          }
        }
      }
    }
  }

  // Cross-language parameter value / unit drift check (`PolyglotDriftChecker`) when both domains are loaded
  if (modelicaItems.length > 0 && sysmlItems.length > 0) {
    const userUris = new Set(allDocs.map((d) => d.uri));
    const driftSources: PolyglotModelSource[] = [];
    for (const sym of db.symbols.values()) {
      const fUri = sym.resourceId ?? sym.documentUri ?? "";
      if (!userUris.has(fUri)) continue;
      const meta = (sym.metadata ?? {}) as Record<string, unknown>;
      const rawVal =
        meta["value"] ??
        meta["nominal"] ??
        meta["defaultValue"] ??
        (meta["variability"] === "parameter" && typeof meta["binding"] === "number" ? meta["binding"] : undefined);
      if (typeof rawVal === "number" && Number.isFinite(rawVal)) {
        const parent = sym.parentId !== null ? db.symbols.get(sym.parentId) : undefined;
        const fileBase = path.basename(fUri.replace(/^file:\/\//, ""), path.extname(fUri));
        const langId = fUri.toLowerCase().endsWith(".mo") ? "modelica" : "sysml2";
        driftSources.push({
          lang: langId,
          uri: fUri,
          component: parent?.name || fileBase || sym.name,
          param: sym.name,
          value: rawVal,
          startOffset: sym.startOffset,
          endOffset: sym.endOffset,
        });
      }
    }

    if (driftSources.length >= 2) {
      const violations = PolyglotDriftChecker.checkDrift(driftSources, { tolerance: 0.001 });
      for (const v of violations) {
        for (const side of [
          { mine: v.sourceA, other: v.sourceB },
          { mine: v.sourceB, other: v.sourceA },
        ]) {
          const otherFile = path.basename(side.other.uri.replace(/^file:\/\//, ""));
          const pct = (v.relativeDiscrepancy * 100).toFixed(1);
          const domain = side.mine.lang === "sysml2" ? "sysml2" : "modelica";
          diagnostics.push({
            severity: v.relativeDiscrepancy > 0.2 ? "error" : "warning",
            lintName: "cross-language-parameter-drift",
            code: "M5104",
            domain,
            message: `Cross-language parameter drift: '${side.mine.param}' in ${side.mine.lang.toUpperCase()} (${side.mine.value}) diverges from ${side.other.lang.toUpperCase()} (${side.other.value}) in '${otherFile}' by ${pct}%.`,
            symbolId: null,
            resourceId: side.mine.uri,
            startOffset: side.mine.startOffset ?? 0,
            endOffset: side.mine.endOffset ?? (side.mine.startOffset ?? 0) + Math.max(1, side.mine.param.length),
          });
        }
      }
    }
  }
}

/**
 * `msx lint <path> [paths...]` CLI command module that runs CST, Salsa semantic, abstract-interpretation,
 * and ontology/schema linters across all recognized ModelScript polyglot languages.
 */
export const Lint: CommandModule<{}, LintArgs> = {
  command: ["lint <path> [paths...]", "check <path> [paths...]", "validate <path> [paths...]"],
  describe: "Lint polyglot libraries using QueryEngine and DSL parsers",
  builder: (yargs) => {
    return yargs
      .positional("path", {
        demandOption: true,
        description: "path of library or module to lint",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: false,
        description: "additional paths of libraries and modules to load",
        type: "string",
      })
      .option("language", {
        alias: ["l", "lang"],
        description:
          "Filter to specific language (e.g. modelica, sysml2, owl2, scad, ssp, cfd, fea, pscad, fortran, easy5, rocets, lps, sima, gtsuite)",
        type: "string",
      })
      .option("format", {
        alias: "f",
        description: "Output format: terminal, json, or sarif",
        type: "string",
        choices: ["terminal", "json", "sarif"],
        default: "terminal",
      })
      .option("sarif-base", {
        description: "Base directory to relativize artifact URIs against in SARIF output",
        type: "string",
      })
      .option("out", {
        alias: "o",
        description: "File path to write diagnostic report to instead of stdout",
        type: "string",
      })
      .option("profile", {
        description: "OWL 2 ontology profile to validate against (DL or EL)",
        type: "string",
        choices: ["DL", "EL"],
        default: "DL",
      })
      .option("strict", {
        description: "Treat warnings as errors",
        type: "boolean",
        default: false,
      })
      .option("formal", {
        description: "Run on-demand deep formal verification checks (Modelica M7xxx & SysML v2 S7xxx)",
        type: "boolean",
        default: false,
      }) as unknown as Argv<LintArgs>;
  },
  handler: async (args) => {
    const u = new UnifiedWorkspace();
    const modelicaItems: { uri: string; text: string }[] = [];
    const sysmlItems: { uri: string; text: string }[] = [];
    const genericItems: { uri: string; text: string; langId: string; langName: string }[] = [];

    const allPaths = [args.path, ...(args.paths ?? [])];
    const files = new Set<string>();

    let recognizedExts: Set<string>;
    if (args.language) {
      const resolved = await LanguageResolver.resolve(undefined, args.language);
      recognizedExts = new Set(resolved.manifest.extensions.map((e) => e.toLowerCase()));
    } else {
      recognizedExts = new Set(LanguageResolver.getAllExtensions().map((e) => e.toLowerCase()));
    }

    for (const p of allPaths) {
      const found = findPolyglotFiles(path.resolve(p), [], recognizedExts);
      for (const f of found) files.add(f);
    }

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const lowerFile = file.toLowerCase();
      if (lowerFile.endsWith(".mo") || lowerFile.endsWith(".mos") || lowerFile.endsWith(".msim")) {
        modelicaItems.push({ uri: `file://${file}`, text: content });
      } else if (
        lowerFile.endsWith(".sysml") ||
        lowerFile.endsWith(".kerml") ||
        lowerFile.endsWith(".sysml2") ||
        lowerFile.endsWith(".sysmlx") ||
        lowerFile.endsWith(".sys2")
      ) {
        sysmlItems.push({ uri: `file://${file}`, text: content });
      } else {
        try {
          const lang = await LanguageResolver.resolve(file, args.language);
          genericItems.push({
            uri: `file://${file}`,
            text: content,
            langId: lang.manifest.id,
            langName: lang.manifest.name,
          });
        } catch {}
      }
    }

    const hasModelica = modelicaItems.length > 0;
    const hasSysML = sysmlItems.length > 0;

    let mIdx: WorkspaceIndex | null = null;
    let sIdx: WorkspaceIndex | null = null;

    const astMap = new Map<string, CstRootLike | undefined>();
    const cstDiagnostics: LintDiagnosticItem[] = [];
    const sysmlCstDiagnostics: LintDiagnosticItem[] = [];

    if (hasModelica) {
      mIdx = createModelicaWorkspaceIndex();
      const { parser, facade } = await createWasmParser(modelicaWasmPath);
      const { getModelicaErrorCodeDef } = await import("@modelscript/modelica");
      for (const item of modelicaItems) {
        const ast = parser.parse(item.text)?.rootNode as unknown as CstRootLike | undefined;
        astMap.set(item.uri, ast);
        mIdx.register(item.uri, () => ast, item.text);
        if (ast && facade && typeof facade.getDiagnostics === "function") {
          const rootPtr = ast.id ?? ast.ptr ?? 0;
          if (rootPtr) {
            if (typeof facade.loadSource === "function") facade.loadSource(item.text);
            for (const cd of facade.getDiagnostics(rootPtr, 0, 0, item.text)) {
              const codeNum = typeof cd.code === "number" ? cd.code : 1001;
              const def = getModelicaErrorCodeDef(codeNum);
              const defMsg = (def?.message as ((arg: string) => string) | undefined)?.("Syntax error");
              cstDiagnostics.push({
                severity: cd.severity === 1 ? "error" : cd.severity === 2 ? "warning" : (def?.severity ?? "info"),
                lintName: def ? def.rule : `M${codeNum}`,
                code: codeNum,
                domain: "modelica",
                message: cd.message || defMsg || "Syntax error",
                symbolId: null,
                resourceId: item.uri,
                startOffset: cd.startOffset ?? 0,
                endOffset: cd.endOffset ?? 0,
              });
            }
          }
        }
      }
      u.registerWorkspace("modelica", mIdx, modelicaLangFallback);
    }

    if (hasSysML) {
      const { createSysML2WorkspaceIndex, getSysML2ErrorCodeDef, loadEmbeddedKerMLStdlib } =
        await import("@modelscript/sysml2");
      sIdx = createSysML2WorkspaceIndex();
      const { createWasmParser: createDslWasmParser } = await import("@modelscript/dsl");
      let wasmPath: string;
      try {
        wasmPath = require.resolve("@modelscript/sysml2/parser.wasm");
      } catch {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        wasmPath = path.resolve(__dirname, "../../../../languages/sysml2/dist/parser.wasm");
      }
      const sysmlResult = await createDslWasmParser(wasmPath);
      const sysmlParser = sysmlResult.parser;
      const sysmlFacade = sysmlResult.facade;

      // Load embedded KerML standard library snapshot so standard types (Real, Boolean, ISQ, etc.) resolve
      loadEmbeddedKerMLStdlib(sIdx, sysmlParser as unknown as Parameters<typeof loadEmbeddedKerMLStdlib>[1]);

      for (const item of sysmlItems) {
        const tree = sysmlParser.parse(item.text);
        if (tree) {
          const ast = tree.rootNode as unknown as CstRootLike | undefined;
          astMap.set(item.uri, ast);
          sIdx.register(item.uri, () => ast, item.text);
          if (ast && sysmlFacade && typeof sysmlFacade.getDiagnostics === "function") {
            const rootPtr = ast.id ?? ast.ptr ?? 0;
            if (rootPtr) {
              if (typeof sysmlFacade.loadSource === "function") sysmlFacade.loadSource(item.text);
              for (const cd of sysmlFacade.getDiagnostics(rootPtr, 0, 0, item.text)) {
                const codeNum = typeof cd.code === "number" ? cd.code : 1001;
                const def = getSysML2ErrorCodeDef(codeNum);
                const defMsg = !cd.message
                  ? (def?.message as ((...a: string[]) => string) | undefined)?.("Syntax error", "", "", "")
                  : undefined;
                sysmlCstDiagnostics.push({
                  severity: cd.severity === 1 ? "error" : cd.severity === 2 ? "warning" : (def?.severity ?? "error"),
                  lintName: def ? def.rule : `S${codeNum}`,
                  code: codeNum,
                  domain: "sysml2",
                  message: cd.message || defMsg || "Syntax error",
                  symbolId: null,
                  resourceId: item.uri,
                  startOffset: cd.startOffset ?? 0,
                  endOffset: cd.endOffset ?? 0,
                });
              }
            }
          } else if (nodeHasError(ast)) {
            sysmlCstDiagnostics.push({
              severity: "error",
              lintName: "parse-error",
              code: 1001,
              domain: "sysml2",
              message: "Syntax error detected by native WASM GLR parser.",
              symbolId: null,
              resourceId: item.uri,
              startOffset: 0,
              endOffset: Math.min(item.text.length, 10),
            });
          }
        }
      }
      u.registerWorkspace(
        "sysml2",
        sIdx,
        sysml2LangFallback as unknown as Parameters<UnifiedWorkspace["registerWorkspace"]>[2],
      );
    }

    if (hasSysML && sIdx) {
      await sIdx.getIndexAsync();
    }

    const db = await u.getIndexAsync();

    // Implement WorkspaceCSTProvider to enable AST-dependent Salsa queries and formal verifiers
    const cstProvider: NonNullable<Parameters<typeof createModelicaQueryEngine>[1]> = {
      getText: (startOffset: number, endOffset: number, entry?: SymbolEntry) => {
        if (!entry || !entry.resourceId) return null;
        const uri = entry.resourceId;
        const modelicaItem = modelicaItems.find((i) => i.uri === uri);
        if (modelicaItem) return modelicaItem.text.slice(startOffset, endOffset);
        const sysmlItem = sysmlItems.find((i) => i.uri === uri);
        if (sysmlItem) return sysmlItem.text.slice(startOffset, endOffset);
        return null;
      },
      getNode: (startOffset: number, endOffset: number, entry?: SymbolEntry) => {
        if (!entry || !entry.resourceId) return null;
        const ast = astMap.get(entry.resourceId);
        if (!ast || typeof ast.descendantForIndex !== "function") return null;
        return ast.descendantForIndex(startOffset, Math.max(startOffset, endOffset - 1));
      },
    };

    const diagnostics: LintDiagnosticItem[] = [];
    let engineM: ReturnType<typeof createModelicaQueryEngine> | null = null;
    let engineS: ReturnType<typeof createSysML2QueryEngine> | null = null;

    if (hasModelica) {
      engineM = createModelicaQueryEngine(db, cstProvider);
      const diagsM = await engineM.runAllLintsAsync();
      for (const d of diagsM) {
        diagnostics.push({ ...d, domain: "modelica" });
      }
      for (const cd of cstDiagnostics) {
        const isDup = diagsM.some((sd) => {
          const entry = sd.symbolId ? engineM!.toQueryDB().symbol(sd.symbolId) : null;
          const res = (sd as { resourceId?: string | undefined }).resourceId ?? entry?.resourceId;
          return (
            res === cd.resourceId &&
            (sd.message === cd.message || (sd.startOffset === cd.startOffset && sd.code === cd.code))
          );
        });
        if (!isDup) {
          diagnostics.push(cd);
        }
      }

      // Run Modelica abstract interpretation on algorithm sections when present
      for (const item of modelicaItems) {
        if (!/\balgorithm\b/.test(item.text)) continue;
        try {
          const { ModelicaAlgorithmAnalyzer, ModelicaCFGLowerer, findCstNodesByType } =
            await import("@modelscript/modelica");
          const rootNode = astMap.get(item.uri);
          if (rootNode && findCstNodesByType) {
            const classNodes = findCstNodesByType(rootNode, "class_definition");
            for (const classNode of classNodes) {
              const idNode = findCstNodesByType(classNode, "identifier")[0];
              const name = idNode?.text?.trim() || "";
              const algSections = findCstNodesByType(classNode, "algorithm_section");
              if (algSections.length === 0) continue;

              const algOffset = algSections[0].startIndex ?? 0;
              const variables = ModelicaAlgorithmAnalyzer.extractVariablesFromClassCst(classNode);
              const statements = ModelicaCFGLowerer.extractStatementsFromCst(algSections[0], algOffset);
              if (statements.length === 0) continue;

              const result = ModelicaAlgorithmAnalyzer.analyze(statements, variables, { functionName: name });
              for (const bug of result.definiteBugs) {
                diagnostics.push({
                  severity: "error",
                  lintName: bug.category || "formal-proof-defect",
                  code: bug.category,
                  domain: "modelica",
                  message: `[Formal Proof Defect] ${bug.description}`,
                  symbolId: null,
                  resourceId: item.uri,
                  startOffset: bug.startOffset ?? algOffset,
                  endOffset: bug.endOffset ?? algOffset + 10,
                });
              }
              for (const warn of result.potentialBugs) {
                diagnostics.push({
                  severity: "warning",
                  lintName: warn.category || "formal-proof-unproven",
                  code: warn.category,
                  domain: "modelica",
                  message: `[Formal Proof Unproven] ${warn.description}`,
                  symbolId: null,
                  resourceId: item.uri,
                  startOffset: warn.startOffset ?? algOffset,
                  endOffset: warn.endOffset ?? algOffset + 10,
                });
              }
            }
            continue;
          }

          // Fallback: match class / function definitions via text regex when CST unavailable
          const funcRegex = /\b(function|block|model|class)\s+([a-zA-Z_][a-zA-Z0-9_]*)([\s\S]*?)\bend\s+\2\s*;/g;
          let match: RegExpExecArray | null;
          while ((match = funcRegex.exec(item.text)) !== null) {
            const name = match[2]!;
            const body = match[3]!;
            const algMatch = /\b(?:initial\s+)?algorithm\b([\s\S]*)$/.exec(body);
            if (!algMatch) continue;
            const algText = algMatch[0];
            const algOffset = match.index + match[0].indexOf(algText);

            let variables: ReturnType<typeof ModelicaAlgorithmAnalyzer.extractVariablesFromClassCst> = [];
            let statements: ReturnType<typeof ModelicaCFGLowerer.parseStatements> = [];
            statements = ModelicaCFGLowerer.parseStatements(algText, algOffset);
            if (statements.length === 0) continue;

            const result = ModelicaAlgorithmAnalyzer.analyze(statements, variables, { functionName: name });
            for (const bug of result.definiteBugs) {
              diagnostics.push({
                severity: "error",
                lintName: bug.category || "formal-proof-defect",
                code: bug.category,
                domain: "modelica",
                message: `[Formal Proof Defect] ${bug.description}`,
                symbolId: null,
                resourceId: item.uri,
                startOffset: bug.startOffset ?? algOffset,
                endOffset: bug.endOffset ?? algOffset + 10,
              });
            }
            for (const warn of result.potentialBugs) {
              diagnostics.push({
                severity: "warning",
                lintName: warn.category || "formal-proof-unproven",
                code: warn.category,
                domain: "modelica",
                message: `[Formal Proof Unproven] ${warn.description}`,
                symbolId: null,
                resourceId: item.uri,
                startOffset: warn.startOffset ?? algOffset,
                endOffset: warn.endOffset ?? algOffset + 10,
              });
            }
          }
        } catch {}
      }

      // Tier 1 (< 10 ms) fast static checks (M7801-M7804)
      try {
        const { runModelicaFastStaticLints, runModelicaFormalLints } = await import("@modelscript/modelica");
        for (const item of modelicaItems) {
          for (const d of runModelicaFastStaticLints(item.text)) {
            diagnostics.push({
              severity: d.severity,
              lintName: d.rule,
              code: `M${d.code}`,
              domain: "modelica",
              message: `[M${d.code}] ${d.message}`,
              symbolId: null,
              resourceId: item.uri,
              startOffset: 0,
              endOffset: 1,
            });
          }
          if (args.formal) {
            for (const d of runModelicaFormalLints(item.text)) {
              diagnostics.push({
                severity: d.severity,
                lintName: d.rule,
                code: `M${d.code}`,
                domain: "modelica",
                message: `[M${d.code}] ${d.message}`,
                symbolId: null,
                resourceId: item.uri,
                startOffset: 0,
                endOffset: 1,
              });
            }
          }
        }
      } catch {}

      if (args.formal) {
        try {
          const { Context } = await import("@modelscript/modelica/context");
          const { NodeFileSystem } = await import("../util/filesystem.js");
          const { parser: formalParser } = await createWasmParser(modelicaWasmPath);
          Context.registerParser(".mo", formalParser as unknown as Parameters<typeof Context.registerParser>[1]);
          const formalCtx = Context.createBatch(new NodeFileSystem());
          for (const item of modelicaItems) {
            formalCtx.load(item.text, item.uri);
          }
          const formalRes = await formalCtx.verifyFormal();
          const formalDb = formalCtx.queryEngine.toQueryDB();
          for (const fd of formalRes.diagnostics) {
            const simpleName = fd.className.split(".").pop() ?? fd.className;
            const sym = formalDb.byName(simpleName)?.[0];
            const resUri = sym?.resourceId ?? modelicaItems[0]?.uri;
            const resText = modelicaItems.find((m) => m.uri === resUri)?.text ?? modelicaItems[0]?.text ?? "";
            diagnostics.push({
              severity: fd.severity,
              lintName: fd.rule,
              code: fd.code,
              domain: "modelica",
              message: `[M${fd.code}] ${fd.message}`,
              symbolId: sym?.id ?? null,
              resourceId: resUri,
              startOffset: fd.range
                ? lineColToByte(resText, fd.range.startPosition.row + 1, fd.range.startPosition.column + 1)
                : 0,
              endOffset: fd.range
                ? lineColToByte(resText, fd.range.endPosition.row + 1, fd.range.endPosition.column + 1)
                : 1,
            });
          }
        } catch {}
      }
    }

    if (hasSysML) {
      engineS = createSysML2QueryEngine(db, cstProvider);
      const diagsS: LintDiagnosticItem[] = [];
      for (const item of sysmlItems) {
        const fileDiags = await engineS.runAllLintsAsync(item.uri);
        for (const d of fileDiags) {
          diagsS.push({
            ...d,
            domain: "sysml2",
            resourceId: (d as { resourceId?: string | undefined }).resourceId ?? item.uri,
          });
        }
      }
      diagnostics.push(...diagsS);
      for (const cd of sysmlCstDiagnostics) {
        const isDup = diagsS.some((sd) => {
          const entry = sd.symbolId ? engineS!.toQueryDB().symbol(sd.symbolId) : null;
          const res = sd.resourceId ?? entry?.resourceId;
          return (
            res === cd.resourceId &&
            (sd.message === cd.message || (sd.startOffset === cd.startOffset && sd.code === cd.code))
          );
        });
        if (!isDup) {
          diagnostics.push(cd);
        }
      }

      // Tier 1 (< 10 ms) fast static checks (S7007-S7009) & Tier 2 extended formal checks (S7010-S7013)
      try {
        const { runSysML2FastStaticLints, runSysML2FormalExtendedLints } = await import("@modelscript/sysml2");
        for (const item of sysmlItems) {
          for (const d of runSysML2FastStaticLints(item.text)) {
            diagnostics.push({
              severity: d.severity,
              lintName: d.rule,
              code: `S${d.code}`,
              domain: "sysml2",
              message: `[S${d.code}] ${d.message}`,
              symbolId: null,
              resourceId: item.uri,
              startOffset: d.startOffset ?? 0,
              endOffset: d.endOffset ?? 1,
            });
          }
          if (args.formal) {
            for (const d of runSysML2FormalExtendedLints(item.text)) {
              diagnostics.push({
                severity: d.severity,
                lintName: d.rule,
                code: `S${d.code}`,
                domain: "sysml2",
                message: `[S${d.code}] ${d.message}`,
                symbolId: null,
                resourceId: item.uri,
                startOffset: d.startOffset ?? 0,
                endOffset: d.endOffset ?? 1,
              });
            }
          }
        }
      } catch {}

      if (args.formal) {
        try {
          const { verifySysML2Formal } = await import("@modelscript/sysml2");
          const sysmlDb = engineS.toQueryDB();
          for (const item of sysmlItems) {
            const formalDiags = await verifySysML2Formal(sysmlDb, { resourceUri: item.uri });
            for (const fd of formalDiags) {
              diagnostics.push({
                severity: fd.severity,
                lintName: fd.rule,
                code: fd.code,
                domain: "sysml2",
                message: fd.message,
                symbolId: fd.symbolId,
                resourceId: fd.resourceId ?? item.uri,
                startOffset: fd.startOffset,
                endOffset: fd.endOffset,
              });
            }
          }
        } catch {}
      }
    }

    if (hasModelica || hasSysML) {
      collectCliTggAndDriftDiagnostics({
        u,
        db,
        modelicaItems,
        sysmlItems,
        astMap,
        diagnostics,
      });

      if (modelicaItems.length > 0 && sysmlItems.length > 0) {
        try {
          const { lintSysmlModelicaBridge } = await import("@modelscript/sysml2");
          for (const sItem of sysmlItems) {
            for (const mItem of modelicaItems) {
              const bridgeReport = lintSysmlModelicaBridge(sItem.text, mItem.text);
              for (const bd of bridgeReport.diagnostics) {
                if (bd.code === "SM1004" && !args.formal) continue;
                diagnostics.push({
                  severity: bd.severity,
                  lintName: bd.rule,
                  code: bd.code,
                  domain: "sysml2-modelica-bridge",
                  message: `[${bd.code}] ${bd.message}`,
                  symbolId: null,
                  resourceId: sItem.uri,
                  startOffset: 0,
                  endOffset: 1,
                });
              }
            }
          }
        } catch {}
      }
    }

    const parsedPsseCases: Array<{ filePath: string; parsed: import("@modelscript/psse").PsseCase }> = [];
    const parsedPscadSnapshots: Array<{ filePath: string; frequencyHz: number; poiBaseKv?: number | undefined }> = [];

    for (const item of genericItems) {
      const filePath = item.uri.replace("file://", "");
      try {
        const langId = item.langId.toLowerCase();

        if (langId === "owl2") {
          const lang = await LanguageResolver.resolve(item.uri);
          const { parser } = await lang.loadParser();
          const tree = parser.parse(item.text);
          if (tree?.rootNode) {
            const { lintOwl2Document, lowerCstToAxioms } = await import("@modelscript/owl2");
            const owlDiags = lintOwl2Document(
              tree.rootNode as unknown as Parameters<typeof lintOwl2Document>[0],
              item.text,
              {
                profile: args.profile ?? "DL",
                checkConsistency: true,
              },
            );
            for (const od of owlDiags) {
              diagnostics.push({
                severity: od.severity,
                lintName: od.rule,
                code: od.code,
                domain: "owl2",
                message: od.message,
                symbolId: null,
                resourceId: filePath,
                startOffset: od.startOffset,
                endOffset: od.endOffset,
              });
            }
            const axioms = lowerCstToAxioms(
              tree.rootNode as unknown as Parameters<typeof lowerCstToAxioms>[0],
              item.text,
            );
            if (u.owl2Store && typeof u.owl2Store.setAxioms === "function") {
              u.owl2Store.setAxioms(item.uri, axioms);
            }
          }
          continue;
        }

        if (langId === "scad") {
          const lang = await LanguageResolver.resolve(item.uri);
          const { parser } = await lang.loadParser();
          const tree = parser.parse(item.text);
          if (tree?.rootNode) {
            if (nodeHasError(tree.rootNode)) {
              diagnostics.push({
                severity: "error",
                lintName: "syntax-error",
                code: "SCAD-SYNTAX",
                domain: "scad",
                message: "Syntax error in OpenSCAD document",
                symbolId: null,
                resourceId: filePath,
                startOffset: 0,
                endOffset: Math.min(item.text.length, 10),
              });
            }
            const { lintScadCst } = await import("@modelscript/scad");
            const scadDiags = lintScadCst(tree.rootNode as unknown as Parameters<typeof lintScadCst>[0], item.text);
            for (const sd of scadDiags) {
              diagnostics.push({
                severity: sd.severity,
                lintName: sd.code.toLowerCase(),
                code: sd.code,
                domain: "scad",
                message: sd.message,
                symbolId: null,
                resourceId: filePath,
                startOffset: sd.startOffset ?? 0,
                endOffset: sd.endOffset ?? 0,
              });
            }
          }
          continue;
        }

        if (langId === "pscad") {
          const { parsePscx, lintPscx } = await import("@modelscript/pscad");
          const project = parsePscx(item.text);
          parsedPscadSnapshots.push({
            filePath,
            frequencyHz: project.settings.frequencyHz,
            poiBaseKv: project.rootModule.buses[0]?.voltageBaseKv,
          });
          const pscadDiags = lintPscx(project, { tier: args.formal ? "formal" : "deep" });
          for (const pd of pscadDiags) {
            const startOffset = lineColToByte(item.text, pd.line ?? 1, pd.column ?? 1);
            const endOffset = lineColToByte(
              item.text,
              pd.endLine ?? pd.line ?? 1,
              pd.endColumn ?? (pd.column ?? 1) + 5,
            );
            diagnostics.push({
              severity: pd.severity,
              lintName: pd.code.toLowerCase(),
              code: pd.code,
              domain: "pscad",
              message: pd.message,
              symbolId: null,
              resourceId: filePath,
              startOffset,
              endOffset,
            });
          }
          continue;
        }

        if (langId === "psse") {
          const { parseRaw, lintPsse } = await import("@modelscript/psse");
          const parsed = parseRaw(item.text);
          parsedPsseCases.push({ filePath, parsed });
          const psseDiags = lintPsse(parsed, { tier: args.formal ? "formal" : "deep" });
          for (const pd of psseDiags) {
            diagnostics.push({
              severity: pd.severity,
              lintName: pd.code.toLowerCase(),
              code: pd.code,
              domain: "psse",
              message: pd.message,
              symbolId: null,
              resourceId: filePath,
              startOffset: pd.startOffset ?? 0,
              endOffset: pd.endOffset ?? 0,
            });
          }
          continue;
        }

        if (langId === "fortran") {
          const { lintFortran } = await import("@modelscript/fortran");
          const fortranDiags = lintFortran(item.text);
          for (const fd of fortranDiags) {
            diagnostics.push({
              severity: fd.severity,
              lintName: (fd.id ?? String(fd.code)).toLowerCase(),
              code: fd.id ?? String(fd.code),
              domain: "fortran",
              message: fd.message,
              symbolId: null,
              resourceId: filePath,
              startOffset: fd.startOffset ?? 0,
              endOffset: fd.endOffset ?? 0,
            });
          }
          continue;
        }

        if (langId === "c") {
          const { lintC } = await import("@modelscript/c");
          const cDiags = lintC(item.text);
          for (const cd of cDiags) {
            const startOffset = lineColToByte(item.text, cd.line ?? 1, cd.col ?? 1);
            const endOffset = startOffset + 5;
            diagnostics.push({
              severity: cd.severity,
              lintName: cd.rule,
              code: `M${cd.code}`,
              domain: "c",
              message: cd.message,
              symbolId: null,
              resourceId: filePath,
              startOffset,
              endOffset,
            });
          }
          continue;
        }

        if (langId === "ampl") {
          const { parseAmplModel, lintAmpl } = await import("@modelscript/ampl");
          const model = parseAmplModel(item.text);
          const amplDiags = lintAmpl(model);
          for (const ad of amplDiags) {
            const startLine = ad.range?.start.line ?? 1;
            const startCol = ad.range?.start.column ?? 1;
            const endLine = ad.range?.end.line ?? startLine;
            const endCol = ad.range?.end.column ?? startCol + 5;
            const startOffset = lineColToByte(item.text, startLine, startCol);
            const endOffset = lineColToByte(item.text, endLine, endCol);
            diagnostics.push({
              severity: ad.severity,
              lintName: `M${ad.code}`,
              code: ad.code,
              domain: "ampl",
              message: ad.message,
              symbolId: null,
              resourceId: filePath,
              startOffset,
              endOffset,
            });
          }
          continue;
        }

        if (langId === "easy5") {
          const { parseEasy5, lintEasy5 } = await import("@modelscript/easy5");
          const model = parseEasy5(item.text);
          const easy5Diags = lintEasy5(model);
          for (const ed of easy5Diags) {
            const startOffset = lineColToByte(item.text, ed.line ?? 1, ed.column ?? 1);
            const endOffset = lineColToByte(
              item.text,
              ed.endLine ?? ed.line ?? 1,
              ed.endColumn ?? (ed.column ?? 1) + 5,
            );
            const codeStr = typeof ed.code === "number" ? `M${ed.code}` : String(ed.code);
            diagnostics.push({
              severity: ed.severity,
              lintName: codeStr.toLowerCase(),
              code: codeStr,
              domain: "easy5",
              message: ed.message,
              symbolId: null,
              resourceId: filePath,
              startOffset,
              endOffset,
            });
          }
          continue;
        }

        if (langId === "rocets") {
          const { parseRocetsDeck, lintRocets } = await import("@modelscript/rocets");
          const model = parseRocetsDeck(item.text);
          const rocetsDiags = lintRocets(model);
          for (const rd of rocetsDiags) {
            const startOffset = lineColToByte(item.text, rd.line ?? 1, rd.column ?? 1);
            const endOffset = lineColToByte(
              item.text,
              rd.endLine ?? rd.line ?? 1,
              rd.endColumn ?? (rd.column ?? 1) + 5,
            );
            const codeStr = typeof rd.code === "number" ? `M${rd.code}` : String(rd.code);
            diagnostics.push({
              severity: rd.severity,
              lintName: codeStr.toLowerCase(),
              code: codeStr,
              domain: "rocets",
              message: rd.message,
              symbolId: null,
              resourceId: filePath,
              startOffset,
              endOffset,
            });
          }
          continue;
        }

        if (langId === "ssp") {
          const { lintSsd, lintSsv } = await import("@modelscript/ssp");
          const isSsv = filePath.toLowerCase().endsWith(".ssv") || item.text.includes("<ssv:ParameterSet");
          const sspDiags = isSsv ? lintSsv(item.text) : lintSsd(item.text);
          for (const sd of sspDiags) {
            diagnostics.push({
              severity: sd.severity,
              lintName: sd.code.toLowerCase(),
              code: sd.code,
              domain: "ssp",
              message: sd.message,
              symbolId: null,
              resourceId: filePath,
              startOffset: sd.startOffset ?? 0,
              endOffset: sd.endOffset ?? 0,
            });
          }
          continue;
        }

        if (langId === "csv") {
          const { lintCsv } = await import("@modelscript/csv/csv-parser");
          const csvDiags = lintCsv(item.text);
          for (const cd of csvDiags) {
            diagnostics.push({
              severity: cd.severity,
              lintName: cd.code.toLowerCase(),
              code: cd.code,
              domain: "csv",
              message: cd.message,
              symbolId: null,
              resourceId: filePath,
              startOffset: cd.startOffset ?? 0,
              endOffset: cd.endOffset ?? 0,
            });
          }
          continue;
        }

        if (langId === "las") {
          const { lintLas } = await import("@modelscript/las/las-parser");
          const lasDiags = lintLas(item.text);
          for (const ld of lasDiags) {
            diagnostics.push({
              severity: ld.severity,
              lintName: ld.rule || ld.code.toLowerCase(),
              code: ld.code,
              domain: "las",
              message: ld.message,
              symbolId: null,
              resourceId: filePath,
              startOffset: ld.startOffset ?? 0,
              endOffset: ld.endOffset ?? 0,
            });
          }
          continue;
        }

        if (langId === "cfd") {
          diagnostics.push(...lintCfdText(item.text, filePath));
          try {
            const { parseCfdConfig, lintCfdModel } = await import("@modelscript/cfd");
            const ext = path.extname(filePath).slice(1) || "cfg";
            const model = parseCfdConfig(item.text, ext);
            for (const cd of lintCfdModel(model)) {
              const startOffset = lineColToByte(item.text, cd.line ?? 1, 1);
              const codeStr = typeof cd.code === "number" ? `M${cd.code}` : String(cd.code);
              diagnostics.push({
                severity: cd.severity,
                lintName: cd.rule ?? codeStr.toLowerCase(),
                code: codeStr,
                domain: "cfd",
                message: cd.message,
                symbolId: null,
                resourceId: filePath,
                startOffset,
                endOffset: startOffset + 10,
              });
            }
          } catch {}
          continue;
        }

        if (langId === "fea") {
          diagnostics.push(...lintFeaText(item.text, filePath));
          try {
            const { parseFeaDeck, lintFeaModel } = await import("@modelscript/fea");
            const ext = path.extname(filePath).slice(1) || "inp";
            const model = parseFeaDeck(item.text, ext);
            for (const fd of lintFeaModel(model)) {
              const startOffset = lineColToByte(item.text, fd.line ?? 1, 1);
              const codeStr = typeof fd.code === "number" ? `M${fd.code}` : String(fd.code);
              diagnostics.push({
                severity: fd.severity,
                lintName: fd.rule ?? codeStr.toLowerCase(),
                code: codeStr,
                domain: "fea",
                message: fd.message,
                symbolId: null,
                resourceId: filePath,
                startOffset,
                endOffset: startOffset + 10,
              });
            }
          } catch {}
          continue;
        }

        if (langId === "step") {
          try {
            const lang = await LanguageResolver.resolve(item.uri);
            const { parser } = await lang.loadParser();
            const tree = parser.parse(item.text);
            if (nodeHasError(tree?.rootNode)) {
              diagnostics.push({
                severity: "error",
                lintName: "syntax-error",
                code: "STEP-SYNTAX",
                domain: "step",
                message: "Syntax errors detected in STEP document",
                symbolId: null,
                resourceId: filePath,
                startOffset: 0,
                endOffset: Math.min(item.text.length, 10),
              });
            }
          } catch {}
          const stepDiags = await lintStepText(item.text, filePath);
          diagnostics.push(...stepDiags);
          continue;
        }

        if (langId === "lps") {
          try {
            const { parseLps, lintLpsModel } = await import("@modelscript/lps");
            const model = parseLps(item.text, filePath);
            const lpsDiags = lintLpsModel(model);
            for (const ld of lpsDiags) {
              diagnostics.push({
                severity: ld.severity,
                lintName: ld.rule,
                code: ld.code,
                domain: "lps",
                message: ld.message,
                symbolId: null,
                resourceId: filePath,
                startOffset: 0,
                endOffset: Math.min(item.text.length, 50),
              });
            }
          } catch (e: unknown) {
            diagnostics.push({
              severity: "error",
              lintName: "lps-parse-error",
              code: "M8000",
              domain: "lps",
              message: e instanceof Error ? e.message : "Failed to parse PipelineStudio study",
              symbolId: null,
              resourceId: filePath,
              startOffset: 0,
              endOffset: 10,
            });
          }
          continue;
        }

        if (langId === "sima") {
          try {
            const { parseSimaFile, lintSimaProject } = await import("@modelscript/sima");
            const model = parseSimaFile(item.text, filePath);
            const simaDiags = lintSimaProject(model);
            for (const sd of simaDiags) {
              const startOffset = lineColToByte(item.text, sd.line ?? 1, sd.column ?? 1);
              const endOffset = lineColToByte(
                item.text,
                sd.endLine ?? sd.line ?? 1,
                sd.endColumn ?? (sd.column ?? 1) + 5,
              );
              const sdWithId = sd as { id?: string | number | undefined };
              const codeStr = typeof sd.code === "number" ? `M${sd.code}` : String(sd.code || sdWithId.id || "M7000");
              const lintName = sd.rule || codeStr.toLowerCase();
              diagnostics.push({
                severity: sd.severity,
                lintName,
                code: codeStr,
                domain: "sima",
                message: sd.message,
                symbolId: null,
                resourceId: filePath,
                startOffset,
                endOffset,
              });
            }
          } catch (e: unknown) {
            diagnostics.push({
              severity: "error",
              lintName: "sima-parse-error",
              code: "M7000",
              domain: "sima",
              message: e instanceof Error ? e.message : "Failed to parse SIMO/RIFLEX deck",
              symbolId: null,
              resourceId: filePath,
              startOffset: 0,
              endOffset: 10,
            });
          }
          continue;
        }

        if (langId === "gtsuite") {
          try {
            const { parseGtmModel, lintGtModel } = await import("@modelscript/gtsuite");
            const model = parseGtmModel(item.text, filePath);
            const gtDiags = lintGtModel(model);
            for (const gd of gtDiags) {
              const startOffset = lineColToByte(item.text, gd.line ?? 1, gd.column ?? 1);
              const endOffset = lineColToByte(
                item.text,
                gd.endLine ?? gd.line ?? 1,
                gd.endColumn ?? (gd.column ?? 1) + 5,
              );
              const gdWithId = gd as { id?: string | number | undefined };
              const codeStr = typeof gd.code === "number" ? `M${gd.code}` : String(gd.code || gdWithId.id || "M9000");
              const lintName = gd.rule || codeStr.toLowerCase();
              diagnostics.push({
                severity: gd.severity,
                lintName,
                code: codeStr,
                domain: "gtsuite",
                message: gd.message,
                symbolId: null,
                resourceId: filePath,
                startOffset,
                endOffset,
              });
            }
          } catch (e: unknown) {
            diagnostics.push({
              severity: "error",
              lintName: "gtsuite-parse-error",
              code: "M9000",
              domain: "gtsuite",
              message: e instanceof Error ? e.message : "Failed to parse GT-SUITE model",
              symbolId: null,
              resourceId: filePath,
              startOffset: 0,
              endOffset: 10,
            });
          }
          continue;
        }

        if (item.langId === "spice") {
          const { parseSpice, lintSpiceCircuit } = await import("@modelscript/spice");
          const circuit = parseSpice(item.text);
          for (const sd of lintSpiceCircuit(circuit)) {
            const startOffset = lineColToByte(item.text, sd.span?.startLine ?? 1, sd.span?.startCol ?? 1);
            const endOffset = lineColToByte(item.text, sd.span?.endLine ?? 1, sd.span?.endCol ?? 5);
            const codeStr = typeof sd.code === "number" ? `M${sd.code}` : String(sd.code || "M9000");
            diagnostics.push({
              severity: sd.severity,
              lintName: sd.rule || codeStr.toLowerCase(),
              code: codeStr,
              domain: "spice",
              message: sd.message,
              symbolId: null,
              resourceId: filePath,
              startOffset,
              endOffset,
            });
          }
          continue;
        }

        if (item.langId === "urdf") {
          const { parseUrdf, lintUrdfRobot } = await import("@modelscript/urdf");
          const robot = parseUrdf(item.text);
          for (const ud of lintUrdfRobot(robot)) {
            const startOffset = lineColToByte(item.text, ud.range.startLine ?? 1, ud.range.startColumn ?? 1);
            const codeStr = typeof ud.code === "number" ? `M${ud.code}` : String(ud.code || "M9000");
            diagnostics.push({
              severity: ud.severity,
              lintName: codeStr.toLowerCase(),
              code: codeStr,
              domain: "urdf",
              message: ud.message,
              symbolId: null,
              resourceId: filePath,
              startOffset,
              endOffset: startOffset + 5,
            });
          }
          continue;
        }

        if (item.langId === "hec-ras" || item.langId === "hecras" || item.langId === "ras") {
          const { parseHecRas, lintHecRas } = await import("@modelscript/hec-ras");
          const { geometry, flow } = parseHecRas(item.text);
          if (geometry) {
            for (const d of lintHecRas(geometry, flow)) {
              const startOffset = lineColToByte(item.text, d.line ?? 1, 1);
              diagnostics.push({
                severity: d.severity,
                lintName: d.rule,
                code: `M${d.code}`,
                domain: "hec-ras",
                message: d.message,
                symbolId: null,
                resourceId: filePath,
                startOffset,
                endOffset: startOffset + 10,
              });
            }
          }
          continue;
        }

        if (item.langId === "ocpp") {
          const { parseOcpp, lintOcpp } = await import("@modelscript/ocpp");
          const net = parseOcpp(item.text);
          for (const d of lintOcpp(net)) {
            const startOffset = lineColToByte(item.text, d.line ?? 1, 1);
            diagnostics.push({
              severity: d.severity,
              lintName: d.rule,
              code: `M${d.code}`,
              domain: "ocpp",
              message: d.message,
              symbolId: null,
              resourceId: filePath,
              startOffset,
              endOffset: startOffset + 10,
            });
          }
          continue;
        }

        if (item.langId === "openadr") {
          const { parseOpenAdr, lintOpenAdr } = await import("@modelscript/openadr");
          const deck = parseOpenAdr(item.text);
          for (const d of lintOpenAdr(deck)) {
            const startOffset = lineColToByte(item.text, d.line ?? 1, 1);
            diagnostics.push({
              severity: d.severity,
              lintName: d.rule,
              code: `M${d.code}`,
              domain: "openadr",
              message: d.message,
              symbolId: null,
              resourceId: filePath,
              startOffset,
              endOffset: startOffset + 10,
            });
          }
          continue;
        }

        if (item.langId === "tough") {
          const { parseTough, lintTough } = await import("@modelscript/tough");
          const deck = parseTough(item.text);
          for (const d of lintTough(deck)) {
            const startOffset = lineColToByte(item.text, d.line ?? 1, 1);
            diagnostics.push({
              severity: d.severity,
              lintName: d.rule,
              code: `M${d.code}`,
              domain: "tough",
              message: d.message,
              symbolId: null,
              resourceId: filePath,
              startOffset,
              endOffset: startOffset + 10,
            });
          }
          continue;
        }

        if (item.langId === "modflow") {
          const { parseModflow, lintModflow } = await import("@modelscript/modflow");
          const model = parseModflow(item.text);
          for (const d of lintModflow(model)) {
            const startOffset = lineColToByte(item.text, d.line ?? 1, 1);
            diagnostics.push({
              severity: d.severity,
              lintName: d.rule,
              code: `M${d.code}`,
              domain: "modflow",
              message: d.message,
              symbolId: null,
              resourceId: filePath,
              startOffset,
              endOffset: startOffset + 10,
            });
          }
          continue;
        }

        if (item.langId === "landgem") {
          const { parseLandgem, lintLandgem } = await import("@modelscript/landgem");
          const model = parseLandgem(item.text);
          for (const d of lintLandgem(model)) {
            const startOffset = lineColToByte(item.text, d.line ?? 1, 1);
            diagnostics.push({
              severity: d.severity,
              lintName: d.rule,
              code: `M${d.code}`,
              domain: "landgem",
              message: d.message,
              symbolId: null,
              resourceId: filePath,
              startOffset,
              endOffset: startOffset + 10,
            });
          }
          continue;
        }

        if (item.langId === "gtfs") {
          const { parseGtfs, lintGtfs } = await import("@modelscript/gtfs");
          const feed = parseGtfs(item.text);
          for (const d of lintGtfs(feed)) {
            const startOffset = lineColToByte(item.text, d.line ?? 1, 1);
            diagnostics.push({
              severity: d.severity,
              lintName: d.rule,
              code: `M${d.code}`,
              domain: "gtfs",
              message: d.message,
              symbolId: null,
              resourceId: filePath,
              startOffset,
              endOffset: startOffset + 10,
            });
          }
          continue;
        }

        // Generic / user-registered DSL fallback
        const lang = await LanguageResolver.resolve(item.uri, args.language);
        const { parser } = await lang.loadParser();
        const tree = parser.parse(item.text);
        if (nodeHasError(tree?.rootNode)) {
          diagnostics.push({
            severity: "error",
            lintName: "syntax-error",
            message: `Syntax errors detected in ${lang.manifest.name} document`,
            symbolId: null,
            resourceId: filePath,
            startOffset: 0,
            endOffset: item.text.length,
          });
        }
      } catch (e: unknown) {
        diagnostics.push({
          severity: "error",
          lintName: "parser-failure",
          message: e instanceof Error ? e.message : String(e),
          symbolId: null,
          resourceId: filePath,
          startOffset: 0,
          endOffset: 0,
        });
      }
    }

    if (parsedPsseCases.length > 0 && parsedPscadSnapshots.length > 0) {
      try {
        const { verifyPssePscadEquivalence } = await import("@modelscript/psse");
        for (const psseEntry of parsedPsseCases) {
          for (const pscadEntry of parsedPscadSnapshots) {
            const eqDiags = verifyPssePscadEquivalence(psseEntry.parsed, {
              frequencyHz: pscadEntry.frequencyHz,
              poiBaseKv: pscadEntry.poiBaseKv,
            });
            for (const ed of eqDiags) {
              diagnostics.push({
                severity: ed.severity,
                lintName: ed.code.toLowerCase(),
                code: ed.code,
                domain: "psse",
                message: `${ed.message} (compared with ${path.basename(pscadEntry.filePath)})`,
                symbolId: null,
                resourceId: psseEntry.filePath,
                startOffset: ed.startOffset ?? 0,
                endOffset: ed.endOffset ?? 0,
              });
            }
          }
        }
      } catch {
        // Cross-domain equivalence is best-effort
      }
    }

    if (genericItems.length > 0) {
      const { hasWorkspaceLinter, lintWorkspaceByLanguage } = await import("@modelscript/lsp");
      const cliWorkspaceDocs: Record<string, string> = {};
      const langRoots = new Map<string, string>();
      for (const item of genericItems) {
        cliWorkspaceDocs[item.uri] = item.text;
        const langId = item.langId.toLowerCase();
        if (hasWorkspaceLinter(langId) && !langRoots.has(langId)) {
          langRoots.set(langId, item.uri);
        }
      }

      for (const [langId, rootUri] of langRoots.entries()) {
        try {
          const wsDiags = await lintWorkspaceByLanguage(langId, cliWorkspaceDocs, rootUri);
          for (const d of wsDiags) {
            const targetUri = d.uri || rootUri;
            const resPath = targetUri.replace(/^file:\/\//, "");
            const alreadyPresent = diagnostics.some(
              (ex) => ex.resourceId === resPath && String(ex.code ?? "") === String(d.code) && ex.message === d.message,
            );
            if (alreadyPresent) continue;

            const docText = cliWorkspaceDocs[targetUri] ?? "";
            const startOffset = d.line ? lineColToByte(docText, d.line, d.column ?? 1) : 0;
            diagnostics.push({
              severity: d.severity,
              lintName: d.rule,
              code: d.code,
              domain: langId,
              message: d.message,
              symbolId: null,
              resourceId: resPath,
              startOffset,
              endOffset: startOffset + 1,
            });
          }
        } catch {
          // Non-fatal workspace linter error
        }
      }
    }

    const writeOutput = (content: string) => {
      if (args.out) {
        const outPath = path.resolve(process.cwd(), args.out);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, content, "utf-8");
      } else {
        console.log(content);
      }
    };

    if (diagnostics.length === 0) {
      if (args.format === "sarif") {
        const sarifBase = path.resolve(process.cwd(), args.sarifBase || args["sarif-base"] || ".");
        writeOutput(JSON.stringify(buildSarifLog([], sarifBase), null, 2));
      } else if (args.format === "json") {
        writeOutput("[]");
      } else {
        writeOutput("No diagnostics found.");
      }
      return;
    }

    const textMap = new Map<string, string>();
    for (const item of [...modelicaItems, ...sysmlItems, ...genericItems]) {
      textMap.set(item.uri.replace("file://", ""), item.text);
    }

    const rawFormattedDiags = diagnostics.map((d) => {
      let entry = null;
      if (engineM && d.symbolId) entry = engineM.toQueryDB().symbol(d.symbolId);
      if (!entry && engineS && d.symbolId) entry = engineS.toQueryDB().symbol(d.symbolId);

      const rawRes = d.resourceId ?? entry?.resourceId;
      const resource = rawRes ? rawRes.replace(/^file:\/\//, "") : "unknown";
      const docText = textMap.get(resource) ?? "";
      const pos = byteToLineCol(docText, d.startOffset ?? 0);

      let formattedCode: string | undefined;
      if (typeof d.code === "number") {
        const prefix = d.domain === "sysml2" ? "S" : d.domain === "owl2" ? "O" : "M";
        formattedCode = `${prefix}${d.code}`;
      } else if (typeof d.code === "string" && d.code.length > 0) {
        formattedCode = d.code;
      }

      return {
        resource,
        line: pos.line,
        col: pos.col,
        startOffset: d.startOffset ?? 0,
        endOffset: d.endOffset ?? 0,
        severity: d.severity,
        code: formattedCode,
        lintName: d.lintName,
        message: d.message,
      };
    });

    // Run ALM workspace policy lints (ALM001–ALM004) if modelscript.yaml declares remote dependencies
    try {
      const {
        isRemoteDependency,
        lintAlmWorkspace,
        MANIFEST_FILENAME,
        normalizeRemoteDependency,
        PACKAGES_DIR,
        parseMaterializedExternalItems,
        parseModelScriptYaml,
      } = await import("@modelscript/runtime");
      const cwd = process.cwd();
      const manifestPath = path.join(cwd, MANIFEST_FILENAME);
      if (fs.existsSync(manifestPath)) {
        const manifest = parseModelScriptYaml(fs.readFileSync(manifestPath, "utf-8"), manifestPath);
        const hasRemotes = Object.values(manifest.dependencies ?? {}).some((d) => isRemoteDependency(d));
        if (hasRemotes) {
          let gitBranch: string | undefined;
          try {
            const { execFileSync } = await import("node:child_process");
            gitBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
              cwd,
              encoding: "utf-8",
              stdio: ["ignore", "pipe", "ignore"],
            }).trim();
          } catch {
            gitBranch = undefined;
          }

          const artifactsByPackage: Record<string, import("@modelscript/runtime").AlmArtifact[]> = {};
          for (const [pkgName, depSpec] of Object.entries(manifest.dependencies ?? {})) {
            if (!isRemoteDependency(depSpec)) continue;
            const norm = normalizeRemoteDependency(depSpec);
            if (!norm) continue;
            const dir = norm.materialize
              ? path.resolve(cwd, norm.materialize)
              : path.join(cwd, PACKAGES_DIR, ...pkgName.split("/"));
            const items: import("@modelscript/runtime").AlmArtifact[] = [];
            if (fs.existsSync(dir)) {
              for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (!entry.isFile() || (!entry.name.endsWith(".sysml") && !entry.name.endsWith(".ms"))) continue;
                const parsed = await parseMaterializedExternalItems(
                  fs.readFileSync(path.join(dir, entry.name), "utf-8"),
                );
                for (const p of parsed) {
                  items.push({
                    externalId: p.externalId,
                    kind: norm.connector === "jira" ? "change_request" : "requirement",
                    uri: p.uri ?? "",
                    webUrl: p.webUrl,
                    title: p.title ?? p.externalId,
                    text: p.text ?? "",
                    status: p.status ?? "Unknown",
                    priority: p.priority,
                    revision: p.revision,
                    attributes: {},
                  });
                }
              }
            }
            artifactsByPackage[pkgName] = items;
          }

          const almDiags = lintAlmWorkspace({ manifest, gitBranch, artifactsByPackage });
          for (const d of almDiags) {
            rawFormattedDiags.push({
              resource: manifestPath,
              line: 1,
              col: 1,
              startOffset: 0,
              endOffset: 0,
              severity: d.severity,
              code: d.code,
              lintName: d.code,
              message: d.message,
            });
          }
        }
      }
    } catch {
      // Non-fatal: do not block normal language linting if ALM manifest check fails
    }

    // Deduplicate diagnostics by resource + line + col + code/lintName + message
    const seenKeys = new Set<string>();
    const formattedDiags = rawFormattedDiags.filter((d) => {
      const key = `${d.resource}:${d.line}:${d.col}:${d.code ?? d.lintName}:${d.message}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    if (args.format === "sarif") {
      const sarifBase = path.resolve(process.cwd(), args.sarifBase || args["sarif-base"] || ".");
      const sarifDoc = buildSarifLog(formattedDiags, sarifBase);
      writeOutput(JSON.stringify(sarifDoc, null, 2));
    } else if (args.format === "json") {
      writeOutput(JSON.stringify(formattedDiags, null, 2));
    } else {
      const outputLines: string[] = [];
      for (const d of formattedDiags) {
        const badge = d.code && d.code !== d.lintName ? `${d.code}/${d.lintName}` : d.lintName;
        outputLines.push(`[${d.resource}:${d.line}:${d.col}] ${d.severity}: [${badge}] ${d.message}`);
      }

      const errors = formattedDiags.filter((d) => d.severity === "error").length;
      const warnings = formattedDiags.filter((d) => d.severity === "warning").length;
      const infos = formattedDiags.filter((d) => d.severity !== "error" && d.severity !== "warning").length;

      if (errors > 0 || warnings > 0 || infos > 0) {
        const infoSuffix = infos > 0 ? `, ${infos} info(s)` : "";
        outputLines.push(`\n${errors} error(s), ${warnings} warning(s)${infoSuffix} found.`);
      }
      writeOutput(outputLines.join("\n"));
    }

    const errorCount = formattedDiags.filter((d) => d.severity === "error").length;
    const warningCount = formattedDiags.filter((d) => d.severity === "warning").length;
    if (errorCount > 0 || (args.strict && warningCount > 0)) {
      process.exitCode = 1;
    }
  },
};
