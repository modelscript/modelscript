// SPDX-License-Identifier: AGPL-3.0-or-later

import { createModelicaQueryEngine, createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import modelicaLangFallback from "@modelscript/modelica/language";
import { createWasmParser } from "@modelscript/modelica/parser";
import { UnifiedWorkspace, type SymbolEntry, type WorkspaceIndex } from "@modelscript/runtime";
import { createSysML2QueryEngine } from "@modelscript/sysml2/factory";
import sysml2LangFallback from "@modelscript/sysml2/language";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Argv, CommandModule } from "yargs";

import { LanguageResolver } from "../util/language-registry.js";

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
  /** Diagnostic output format (`"terminal"` or `"json"`). */
  format?: "terminal" | "json" | undefined;
  /** OWL 2 ontology profile to validate against (`"DL"` or `"EL"`). */
  profile?: "DL" | "EL" | undefined;
  /** Whether to treat warnings as fatal errors with non-zero exit code. */
  strict?: boolean | undefined;
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
  hasError?: (() => boolean) | undefined;
  descendantForIndex?: ((startIndex: number, endIndex: number) => unknown) | undefined;
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

/** Recognized Abaqus/CalculiX `.inp` FEA keyword card names for syntax validation. */
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
 * Performs lexical and structural linting on an SU2/CFD configuration file (`KEY = VALUE` directives,
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
 * Performs lexical and card-schema linting on a CalculiX/Abaqus `.inp` FEA deck.
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
        description: "Output format: terminal or json",
        type: "string",
        choices: ["terminal", "json"],
        default: "terminal",
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
                const defMsg = (def?.message as ((arg: string) => string) | undefined)?.("Syntax error");
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
          } else if (ast?.hasError && ast.hasError()) {
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
      await sIdx.toUnifiedAsync();
    }

    const db = u.toUnifiedAsync ? await u.toUnifiedAsync() : u.toUnified();

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
            if (rootNode && findCstNodesByType) {
              const classNodes = findCstNodesByType(rootNode, "class_definition");
              const classNode = classNodes.find((cn: CstRootLike) => {
                const idNode = findCstNodesByType(cn, "identifier")[0];
                return idNode?.text?.trim() === name;
              });
              if (classNode) {
                variables = ModelicaAlgorithmAnalyzer.extractVariablesFromClassCst(classNode);
                const algSections = findCstNodesByType(classNode, "algorithm_section");
                if (algSections.length > 0) {
                  statements = ModelicaCFGLowerer.extractStatementsFromCst(algSections[0], algOffset);
                }
              }
            }
            if (statements.length === 0) {
              statements = ModelicaCFGLowerer.parseStatements(algText, algOffset);
            }
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
    }

    if (hasSysML) {
      engineS = createSysML2QueryEngine(db, cstProvider);
      const diagsS: LintDiagnosticItem[] = [];
      for (const item of sysmlItems) {
        const fileDiags = engineS.runAllLints(item.uri);
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
    }

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
            if (tree.rootNode.hasError && tree.rootNode.hasError()) {
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
          const pscadDiags = lintPscx(project);
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
            if (tree?.rootNode?.hasError && tree.rootNode.hasError()) {
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

        // Generic / user-registered DSL fallback
        const lang = await LanguageResolver.resolve(item.uri, args.language);
        const { parser } = await lang.loadParser();
        const tree = parser.parse(item.text);
        if (tree?.rootNode?.hasError && tree.rootNode.hasError()) {
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

    if (diagnostics.length === 0) {
      if (args.format === "json") {
        console.log("[]");
      } else {
        console.log("No diagnostics found.");
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

    // Deduplicate diagnostics by resource + line + col + code/lintName + message
    const seenKeys = new Set<string>();
    const formattedDiags = rawFormattedDiags.filter((d) => {
      const key = `${d.resource}:${d.line}:${d.col}:${d.code ?? d.lintName}:${d.message}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    if (args.format === "json") {
      console.log(JSON.stringify(formattedDiags, null, 2));
    } else {
      for (const d of formattedDiags) {
        const badge = d.code && d.code !== d.lintName ? `${d.code}/${d.lintName}` : d.lintName;
        console.log(`[${d.resource}:${d.line}:${d.col}] ${d.severity}: [${badge}] ${d.message}`);
      }

      const errors = formattedDiags.filter((d) => d.severity === "error").length;
      const warnings = formattedDiags.filter((d) => d.severity !== "error").length;

      if (errors > 0 || warnings > 0) {
        console.log(`\n${errors} error(s), ${warnings} warning(s) found.`);
      }
    }

    const errorCount = formattedDiags.filter((d) => d.severity === "error").length;
    const warningCount = formattedDiags.filter((d) => d.severity === "warning").length;
    if (errorCount > 0 || (args.strict && warningCount > 0)) {
      process.exitCode = 1;
    }
  },
};
