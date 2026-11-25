// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type ArenaBltResult,
  arenaFingerprint,
  DaeBltReachabilityEngine,
  type DAEBuilder,
  type DaeReachabilitySummary,
  type DaeSingularityIssue,
  HybridModeConsistencyVerifier,
  type HybridVerificationIssue,
  type HybridVerificationResult,
  initBltWasm,
  type NumericalInterval,
  performBltTransformationArena,
  type SysmlRequirement,
  Variability,
  type VerificationVerdict,
} from "@modelscript/runtime";
import {
  ModelicaAlgorithmAnalyzer,
  type ModelicaFormalProofResult,
  type ModelicaVariableDecl,
} from "./formal/modelica-analyzer.js";
import { ModelicaCFGLowerer, type ModelicaStatement } from "./formal/modelica-cfg-lowerer.js";

export interface FormalValidatorCstNode {
  type?: string | undefined;
  text?: string | undefined;
  startIndex?: number | undefined;
  endIndex?: number | undefined;
  children?: readonly FormalValidatorCstNode[] | undefined;
}

export interface FormalValidatorParser {
  parse?: ((text: string) => { rootNode?: FormalValidatorCstNode | null | undefined } | null | undefined) | undefined;
}

export type ModelicaDaeVerificationIssue = (DaeSingularityIssue | HybridVerificationIssue) & {
  eqIdx?: number | undefined;
  interval?: unknown;
  standardClause?: string | undefined;
  margin?: number | undefined;
  suggestedValue?: unknown;
  requiredLimit?: unknown;
};

export interface ModelicaDaeVerificationRecord {
  isFullyCertified: boolean;
  verdict: VerificationVerdict;
  reachSummary: DaeReachabilitySummary;
  hybridResult: HybridVerificationResult;
  issues: ModelicaDaeVerificationIssue[];
  variableBounds: Map<string, NumericalInterval>;
  unboundedVariables: number;
  fingerprint: string;
}

function findCstNodesByType(
  root: FormalValidatorCstNode | null | undefined,
  targetType: string,
): FormalValidatorCstNode[] {
  const out: FormalValidatorCstNode[] = [];
  const visit = (n: FormalValidatorCstNode | null | undefined) => {
    if (!n) return;
    if (n.type === targetType) out.push(n);
    if (Array.isArray(n.children)) {
      for (const c of n.children) visit(c);
    }
  };
  visit(root);
  return out;
}

export interface ModelicaLspDiagnostic {
  severity: number;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  message: string;
  source: string;
  code: string;
  data?: Record<string, unknown>;
}

const SEVERITY_ERROR = 1;
const SEVERITY_WARNING = 2;

const MODELICA_PRIMITIVE_TYPES = new Set(["Real", "Integer", "Boolean", "String"]);
const MODELICA_VAR_QUALIFIERS = new Set(["parameter", "discrete", "constant"]);
const MODELICA_CLASS_BLOCK_KW = new Set(["function", "block", "model", "class"]);

function isWsChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isAsciiLetter(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isIdentStartChar(ch: string): boolean {
  return isAsciiLetter(ch) || ch === "_";
}

function isWordTokenChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return isIdentStartChar(ch) || (c >= 48 && c <= 57);
}

function isSimpleAsciiIdent(s: string): boolean {
  if (!s || !isIdentStartChar(s[0]!)) return false;
  for (let i = 1; i < s.length; i++) {
    if (!isWordTokenChar(s[i]!)) return false;
  }
  return true;
}

function isDigitsOnly(s: string): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

function parseFiniteDecimalLiteral(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  let i = 0;
  if (t[i] === "+" || t[i] === "-") i++;
  let digits = 0;
  while (i < t.length && t.charCodeAt(i) >= 48 && t.charCodeAt(i) <= 57) {
    digits++;
    i++;
  }
  if (t[i] === ".") {
    i++;
    while (i < t.length && t.charCodeAt(i) >= 48 && t.charCodeAt(i) <= 57) {
      digits++;
      i++;
    }
  }
  if (digits === 0) return null;
  if (t[i] === "e" || t[i] === "E") {
    i++;
    if (t[i] === "+" || t[i] === "-") i++;
    let expDigits = 0;
    while (i < t.length && t.charCodeAt(i) >= 48 && t.charCodeAt(i) <= 57) {
      expDigits++;
      i++;
    }
    if (expDigits === 0) return null;
  }
  if (i !== t.length) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function findNextWordMatchIndex(text: string, word: string, fromIndex = 0): number {
  if (!word) return -1;
  let pos = fromIndex;
  while (pos <= text.length - word.length) {
    const idx = text.indexOf(word, pos);
    if (idx === -1) return -1;
    const beforeOk = idx === 0 || !isWordTokenChar(text[idx - 1]!);
    const afterIdx = idx + word.length;
    const afterOk = afterIdx >= text.length || !isWordTokenChar(text[afterIdx]!);
    if (beforeOk && afterOk) return idx;
    pos = idx + 1;
  }
  return -1;
}

function hasWordMatch(text: string, word: string): boolean {
  return findNextWordMatchIndex(text, word, 0) !== -1;
}

function unwrapDerName(name: string): string {
  return name.startsWith("der(") && name.endsWith(")") ? name.slice(4, -1).trim() : name;
}

function measureTokenLengthAt(text: string, startOffset: number): number {
  if (startOffset < 0 || startOffset >= text.length) return 1;
  const ch = text[startOffset]!;
  if (isWordTokenChar(ch)) {
    let i = startOffset + 1;
    while (i < text.length && isWordTokenChar(text[i]!)) i++;
    return i - startOffset;
  }
  return 1;
}

function tokenizeWordsAndPunct(text: string): Array<{ text: string; start: number; end: number }> {
  const tokens: Array<{ text: string; start: number; end: number }> = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (isWsChar(ch)) {
      i++;
      continue;
    }
    if (isWordTokenChar(ch)) {
      const start = i;
      i++;
      while (i < text.length && isWordTokenChar(text[i]!)) i++;
      tokens.push({ text: text.slice(start, i), start, end: i });
    } else {
      tokens.push({ text: ch, start: i, end: i + 1 });
      i++;
    }
  }
  return tokens;
}

function extractModelicaAlgorithmBlocksFromSource(
  text: string,
): Array<{ name: string; body: string; algText: string; algOffset: number }> {
  const blocks: Array<{ name: string; body: string; algText: string; algOffset: number }> = [];
  const tokens = tokenizeWordsAndPunct(text);
  let tIdx = 0;
  while (tIdx + 1 < tokens.length) {
    const kwTok = tokens[tIdx]!;
    const prevTok = tIdx > 0 ? tokens[tIdx - 1]!.text : "";
    if (!MODELICA_CLASS_BLOCK_KW.has(kwTok.text) || prevTok === "end") {
      tIdx++;
      continue;
    }
    const nameTok = tokens[tIdx + 1]!;
    if (!isSimpleAsciiIdent(nameTok.text)) {
      tIdx++;
      continue;
    }
    let endIdx = -1;
    for (let j = tIdx + 2; j + 2 < tokens.length; j++) {
      if (tokens[j]!.text === "end" && tokens[j + 1]!.text === nameTok.text && tokens[j + 2]!.text === ";") {
        endIdx = j;
        break;
      }
    }
    if (endIdx === -1) {
      tIdx++;
      continue;
    }
    const bodyStart = nameTok.end;
    const bodyEnd = tokens[endIdx]!.start;
    const body = text.slice(bodyStart, bodyEnd);
    let algTokIdx = -1;
    for (let j = tIdx + 2; j < endIdx; j++) {
      if (tokens[j]!.text === "algorithm") {
        algTokIdx = j;
        break;
      }
    }
    if (algTokIdx !== -1) {
      const hasInitial = algTokIdx > tIdx + 2 && tokens[algTokIdx - 1]!.text === "initial";
      const algOffset = hasInitial ? tokens[algTokIdx - 1]!.start : tokens[algTokIdx]!.start;
      blocks.push({ name: nameTok.text, body, algText: text.slice(algOffset, bodyEnd), algOffset });
    }
    tIdx = endIdx + 3;
  }
  return blocks;
}

function parseVarDeclaratorItem(rawItem: string): {
  name: string;
  dimStr?: string | undefined;
  initExpr?: string | undefined;
} | null {
  let s = rawItem.trim();
  if (!s) return null;
  let leadingDim: string | undefined;
  if (s.startsWith("[")) {
    const close = s.indexOf("]");
    if (close === -1) return null;
    leadingDim = s.slice(1, close);
    s = s.slice(close + 1).trimStart();
  }
  let p = 0;
  if (!s || !isIdentStartChar(s[0]!)) return null;
  p++;
  while (p < s.length && isWordTokenChar(s[p]!)) p++;
  const name = s.slice(0, p);
  s = s.slice(p).trimStart();
  let trailingDim: string | undefined;
  if (s.startsWith("[")) {
    const close = s.indexOf("]");
    if (close === -1) return null;
    trailingDim = s.slice(1, close);
    s = s.slice(close + 1).trimStart();
  }
  let initExpr: string | undefined;
  if (s.startsWith("=")) {
    initExpr = s.slice(1).trim();
  } else if (s.length > 0) {
    return null;
  }
  return { name, dimStr: leadingDim ?? trailingDim, initExpr };
}

function extractModelicaVarDeclsFromBody(body: string): ModelicaVariableDecl[] {
  const variables: ModelicaVariableDecl[] = [];
  for (const stmt of body.split(";")) {
    const tokens = tokenizeWordsAndPunct(stmt);
    if (tokens.length < 2) continue;
    let idx = 0;
    let io: "input" | "output" | undefined;
    if (tokens[idx]!.text === "input" || tokens[idx]!.text === "output") {
      io = tokens[idx]!.text as "input" | "output";
      idx++;
    }
    while (idx < tokens.length && MODELICA_VAR_QUALIFIERS.has(tokens[idx]!.text)) idx++;
    if (idx + 1 >= tokens.length || !MODELICA_PRIMITIVE_TYPES.has(tokens[idx]!.text)) continue;
    const type = tokens[idx]!.text as ModelicaVariableDecl["type"];
    const declList = stmt.slice(tokens[idx]!.end);
    for (const rawItem of declList.split(",")) {
      const parsed = parseVarDeclaratorItem(rawItem);
      if (!parsed) continue;
      const isArray = Boolean(parsed.dimStr);
      const dimTrimmed = parsed.dimStr?.trim();
      const arrayDimension = dimTrimmed && isDigitsOnly(dimTrimmed) ? Number(dimTrimmed) : undefined;
      const numBound = parsed.initExpr ? parseFiniteDecimalLiteral(parsed.initExpr) : null;
      variables.push({
        name: parsed.name,
        type,
        isInput: io === "input",
        isOutput: io === "output",
        isArray,
        arrayDimension,
        initialBound: numBound !== null ? ([numBound, numBound] as [number, number]) : undefined,
      });
    }
  }
  return variables;
}

export interface ModelicaAbstractInterpParams {
  text: string;
  positionAt: (offset: number) => { line: number; character: number };
  cstRoot?: FormalValidatorCstNode | null | undefined;
  moParser?: FormalValidatorParser | null | undefined;
  onError?: (msg: string) => void;
}

export function validateModelicaAbstractInterpretation(
  params: ModelicaAbstractInterpParams,
): { proofMap: Map<string, ModelicaFormalProofResult>; diagnostics: ModelicaLspDiagnostic[] } | null {
  const { text, positionAt, moParser, onError } = params;
  if (!hasWordMatch(text, "algorithm")) return null;

  const proofMap = new Map<string, ModelicaFormalProofResult>();
  const diagnostics: ModelicaLspDiagnostic[] = [];

  try {
    let cstRoot = params.cstRoot;
    if (!cstRoot && moParser?.parse) {
      const parsed = moParser.parse(text);
      if (parsed?.rootNode) cstRoot = parsed.rootNode;
    }

    if (cstRoot && findCstNodesByType) {
      const classNodes = findCstNodesByType(cstRoot, "class_definition");
      for (const classNode of classNodes) {
        const idNodes = findCstNodesByType(classNode, "identifier");
        const name = idNodes[0]?.text?.trim() || "";
        const algSections = findCstNodesByType(classNode, "algorithm_section");
        if (algSections.length === 0) continue;

        const algOffset = algSections[0]?.startIndex ?? 0;
        const variables = ModelicaAlgorithmAnalyzer.extractVariablesFromClassCst(classNode);
        const statements: ReturnType<typeof ModelicaCFGLowerer.extractStatementsFromCst> = [];
        for (const algSec of algSections) {
          const secOffset = algSec.startIndex ?? algOffset;
          statements.push(...ModelicaCFGLowerer.extractStatementsFromCst(algSec, secOffset));
        }
        if (statements.length === 0) continue;

        const result = ModelicaAlgorithmAnalyzer.analyze(statements, variables, { functionName: name });
        proofMap.set(name, result);

        for (const bug of result.definiteBugs) {
          const bugStart = bug.startOffset ?? algOffset;
          const bugEnd = bug.endOffset ?? bugStart + 10;
          diagnostics.push({
            severity: SEVERITY_ERROR,
            range: { start: positionAt(bugStart), end: positionAt(bugEnd) },
            message: `[Formal Proof Defect] ${bug.description}`,
            source: "modelscript-prover",
            code: bug.category,
            data: { category: bug.category, kind: bug.category, rule: "M5101" },
          });
        }

        for (const warn of result.potentialBugs) {
          let warnStart = warn.startOffset ?? algOffset;
          let warnEnd = warn.endOffset;
          if (warnEnd === undefined) {
            while (warnStart < text.length && (text[warnStart] === " " || text[warnStart] === "\t")) {
              warnStart++;
            }
            warnEnd = warnStart + measureTokenLengthAt(text, warnStart);
          }
          diagnostics.push({
            severity: SEVERITY_WARNING,
            range: { start: positionAt(warnStart), end: positionAt(warnEnd) },
            message: `[Formal Proof Unproven] ${warn.description}. Consider adding an invariant assertion.`,
            source: "modelscript-prover",
            code: warn.category,
            data: { category: warn.category, kind: warn.category, rule: "M5101" },
          });
        }
      }
      return { proofMap, diagnostics };
    }

    for (const blk of extractModelicaAlgorithmBlocksFromSource(text)) {
      const { name, body, algText, algOffset } = blk;
      const variables: ModelicaVariableDecl[] = extractModelicaVarDeclsFromBody(body);
      const statements: ModelicaStatement[] = ModelicaCFGLowerer.parseStatements(algText, algOffset);
      if (statements.length === 0) continue;

      const result = ModelicaAlgorithmAnalyzer.analyze(statements, variables, { functionName: name });
      proofMap.set(name, result);

      for (const bug of result.definiteBugs) {
        const bugStart = bug.startOffset ?? algOffset;
        const bugEnd = bug.endOffset ?? bugStart + 10;
        diagnostics.push({
          severity: SEVERITY_ERROR,
          range: { start: positionAt(bugStart), end: positionAt(bugEnd) },
          message: `[Formal Proof Defect] ${bug.description}`,
          source: "modelscript-prover",
          code: bug.category,
          data: { category: bug.category, kind: bug.category, rule: "M5101" },
        });
      }

      for (const warn of result.potentialBugs) {
        const warnStart = warn.startOffset ?? algOffset;
        const warnEnd = warn.endOffset ?? warnStart + 10;
        diagnostics.push({
          severity: SEVERITY_WARNING,
          range: { start: positionAt(warnStart), end: positionAt(warnEnd) },
          message: `[Formal Proof Unproven] ${warn.description}. Consider adding an invariant assertion.`,
          source: "modelscript-prover",
          code: warn.category,
          data: { category: warn.category, kind: warn.category, rule: "M5101" },
        });
      }
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    onError?.(`[modelica-prover] Error in abstract interpretation: ${errMsg}`);
  }

  return { proofMap, diagnostics };
}

export interface ModelicaDaeReachabilityParams {
  effectiveUri: string;
  text: string;
  positionAt: (offset: number) => { line: number; character: number };
  classes: Array<{ name: string; symbolId: number | undefined; startOffset: number; endOffset: number }>;
  flattenClass: (name: string, symbolId: number | undefined, effectiveUri: string) => DAEBuilder | null | undefined;
  extractArenaStringParams: (arena: DAEBuilder) => Map<string, string>;
  rootCst?: FormalValidatorCstNode | null | undefined;
  sysmlReqs: SysmlRequirement[];
  reqFingerprint: string;
  twinMap: Map<string, string>;
  daeVerificationCache: Map<string, { fingerprint: string; record: ModelicaDaeVerificationRecord }>;
  budgetMs: number;
  formalVerificationOnSave: boolean;
  onWarn?: (msg: string) => void;
  onError?: (msg: string) => void;
}

export async function validateModelicaDaeReachability(
  params: ModelicaDaeReachabilityParams,
): Promise<{ daeMap: Map<string, ModelicaDaeVerificationRecord>; diagnostics: ModelicaLspDiagnostic[] }> {
  const {
    effectiveUri,
    text,
    positionAt,
    classes,
    flattenClass,
    extractArenaStringParams,
    rootCst,
    sysmlReqs,
    reqFingerprint,
    twinMap,
    daeVerificationCache,
    budgetMs,
    formalVerificationOnSave,
    onWarn,
    onError,
  } = params;

  const daeMap = new Map<string, ModelicaDaeVerificationRecord>();
  const diagnostics: ModelicaLspDiagnostic[] = [];

  try {
    if (classes.length === 0) return { daeMap, diagnostics };

    try {
      await initBltWasm();
    } catch (err) {
      onWarn?.(`[ValidationService] Failed to initialize BLT WASM kernel: ${err}`);
    }

    const started = Date.now();
    let completed = true;
    const liveKeys = new Set<string>();

    for (const cls of classes) {
      if (Date.now() - started > budgetMs) {
        completed = false;
        break;
      }
      const arena = flattenClass(cls.name, cls.symbolId, effectiveUri);
      if (!arena) continue;
      let record: ModelicaDaeVerificationRecord | undefined;
      try {
        if (arena.eqCount === 0) continue;

        const key = `${effectiveUri}#${cls.name}`;
        liveKeys.add(key);
        const fingerprint = `${arenaFingerprint(arena)}#${reqFingerprint}`;
        record = daeVerificationCache.get(key)?.record;
        if (!record || daeVerificationCache.get(key)!.fingerprint !== fingerprint) {
          const stateVars = new Set<number>();
          const scanDer = (exprId: number): void => {
            if (exprId < 0) return;
            const kind = arena.getExprKind(exprId);
            if (kind === 12 /* ExprKind.Der */) {
              const inner = arena.getExprData1(exprId);
              if (inner >= 0 && arena.getExprKind(inner) === 0 /* ExprKind.Name */) {
                const nameId = arena.getExprData1(inner);
                let vIdx = arena.lookupVariable(nameId);
                if (vIdx < 0) {
                  const resolved = arena.interner?.resolve(nameId);
                  if (resolved) vIdx = arena.getVarIdxByName(resolved);
                }
                if (vIdx >= 0) stateVars.add(vIdx);
              }
              return;
            }
            switch (kind) {
              case 5 /* ExprKind.Binary */:
                scanDer(arena.getExprLeft(exprId));
                scanDer(arena.getExprRight(exprId));
                break;
              case 6 /* ExprKind.Unary */:
              case 14 /* ExprKind.Negate */:
                scanDer(arena.getExprLeft(exprId));
                break;
              case 11 /* ExprKind.IfElse */:
              case 10 /* ExprKind.Range */:
                scanDer(arena.getExprData1(exprId));
                scanDer(arena.getExprLeft(exprId));
                scanDer(arena.getExprRight(exprId));
                break;
              case 7 /* ExprKind.Call */: {
                const n = arena.getExprRight(exprId);
                const first = arena.getExprLeft(exprId);
                for (let k = 0; k < n; k++) {
                  const argExpr = k === 0 ? first : arena.getExprLeft(exprId + k);
                  if (argExpr >= 0) scanDer(argExpr);
                }
                break;
              }
            }
          };

          for (let i = 0; i < arena.eqCount; i++) {
            scanDer(arena.getEqLhs(i));
            scanDer(arena.getEqRhs(i));
          }

          for (const sIdx of stateVars) {
            const sName = arena.getVarName(sIdx);
            const derName = `der(${sName})`;
            if (arena.getVarIdxByName(derName) === -1) {
              arena.addVariable(
                derName,
                arena.getVarType(sIdx),
                arena.getVarVariability(sIdx),
                arena.getVarCausality(sIdx),
                0.0,
              );
            }
          }

          let bltResult: ArenaBltResult;
          try {
            bltResult = performBltTransformationArena(arena, stateVars.size > 0 ? stateVars : undefined);
          } catch {
            continue;
          }

          const stringParams = extractArenaStringParams(arena);
          const reachEngine = new DaeBltReachabilityEngine(arena, {
            budgetMs,
            sysmlRequirements: sysmlReqs,
            twinMap,
            stringParams,
            stateVars: stateVars.size > 0 ? stateVars : undefined,
          });
          const reachSummary = reachEngine.verify(bltResult);
          const hybridVerifier = new HybridModeConsistencyVerifier(arena);
          const hybridResult = hybridVerifier.verify();

          const matchedVars = new Set<number>();
          for (const blk of bltResult.blocks) {
            for (const v of blk.vars) matchedVars.add(v);
          }
          let isUnderdetermined = false;
          for (let i = 0; i < arena.varCount; i++) {
            if (stateVars.has(i) || matchedVars.has(i)) continue;
            const variability = arena.getVarVariability(i);
            if (variability === Variability.Continuous || variability === Variability.Discrete) {
              isUnderdetermined = true;
              break;
            }
          }
          const reachIssues = isUnderdetermined
            ? reachSummary.issues.filter((iss) => iss.kind !== "singular_algebraic_loop")
            : reachSummary.issues;
          const allIssues: ModelicaDaeVerificationIssue[] = [...reachIssues, ...hybridResult.issues];

          const namedBounds = new Map<string, NumericalInterval>();
          let unboundedVariables = 0;
          for (let i = 0; i < arena.varCount; i++) {
            const vName = arena.getVarName(i);
            const bound = reachSummary.variableBounds.get(i) ?? reachEngine.evaluator.getVarBound(i);
            const bounded = !!bound && !bound.isTop?.() && !bound.isBottom?.();
            if (vName && bounded) namedBounds.set(vName, bound);
            const variability = arena.getVarVariability(i);
            if (!bounded && (variability === Variability.Continuous || variability === Variability.Discrete)) {
              unboundedVariables++;
            }
          }

          const hasDefinite = allIssues.some((i) => i.severity === "definite");
          let verdict: VerificationVerdict;
          if (reachSummary.verdict?.kind === "violated") {
            verdict = reachSummary.verdict;
          } else if (hasDefinite) {
            verdict = {
              kind: "violated",
              witness: { time: 0, state: {} },
              detail: "Equation is defective for every admissible state (definite singularity).",
            };
          } else if (reachSummary.verdict?.kind === "unknown") {
            verdict = reachSummary.verdict;
          } else if (allIssues.length === 0 && unboundedVariables === 0 && reachSummary.verdict?.kind === "proven") {
            verdict = reachSummary.verdict;
          } else {
            verdict = {
              kind: "unknown",
              reason: "inconclusive-enclosure",
              detail: `${allIssues.length} possible issue(s); ${unboundedVariables} unbounded variable(s).`,
            };
          }

          record = {
            isFullyCertified: verdict.kind === "proven",
            verdict,
            reachSummary,
            hybridResult,
            issues: allIssues,
            variableBounds: namedBounds,
            unboundedVariables,
            fingerprint,
          };
          daeVerificationCache.set(key, { fingerprint, record });
        }
      } finally {
        arena?.free?.();
      }

      daeMap.set(cls.name, record);

      const classStart = cls.startOffset;
      const rawClassEnd = cls.endOffset;
      const classEnd = rawClassEnd > classStart ? rawClassEnd : text.length;
      const body = text.slice(classStart, classEnd);
      let classCst: FormalValidatorCstNode | null = null;
      if (rootCst && findCstNodesByType) {
        const classNodes = findCstNodesByType(rootCst, "class_definition");
        for (const cNode of classNodes) {
          const idNode = findCstNodesByType(cNode, "identifier")[0];
          if (
            idNode?.text === cls.name ||
            (cNode.startIndex !== undefined &&
              cNode.endIndex !== undefined &&
              cNode.startIndex <= classStart &&
              cNode.endIndex >= classEnd)
          ) {
            classCst = cNode;
            break;
          }
        }
      }

      for (const issue of record.issues) {
        let issueOffset = classStart;
        let issueLength = issue.varName?.length ?? 10;
        let foundLoc = false;

        if (classCst && findCstNodesByType) {
          if (issue.varName) {
            const cleanVar = unwrapDerName(issue.varName);
            const targetName = cleanVar.includes(".") ? cleanVar.split(".")[0]! : cleanVar;
            const compDecls = findCstNodesByType(classCst, "component_declaration");
            for (const cd of compDecls) {
              const idNode = findCstNodesByType(cd, "identifier")[0];
              if (idNode?.text === targetName && idNode.startIndex !== undefined && idNode.endIndex !== undefined) {
                issueOffset = idNode.startIndex;
                issueLength = idNode.endIndex - idNode.startIndex;
                foundLoc = true;
                break;
              }
            }
          }

          if (!foundLoc && typeof issue.eqIdx === "number" && issue.eqIdx >= 0) {
            const eqSec = findCstNodesByType(classCst, "equation_section")[0];
            if (eqSec) {
              const eqNodes = (eqSec.children || []).filter(
                (c) =>
                  c.type &&
                  c.type !== "equation_section" &&
                  c.type !== "annotation_clause" &&
                  c.type !== ";" &&
                  c.type !== "equation",
              );
              if (issue.eqIdx < eqNodes.length) {
                const targetEq = eqNodes[issue.eqIdx]!;
                issueOffset = targetEq.startIndex ?? classStart;
                issueLength = Math.max(1, (targetEq.endIndex ?? issueOffset + 1) - issueOffset);
                foundLoc = true;
              } else {
                const eqKeyword = (eqSec.children || []).find((c) => c.type === "equation" || c.text === "equation");
                issueOffset = eqKeyword?.startIndex ?? eqSec.startIndex ?? classStart;
                issueLength =
                  eqKeyword && eqKeyword.startIndex !== undefined && eqKeyword.endIndex !== undefined
                    ? eqKeyword.endIndex - eqKeyword.startIndex
                    : 8;
                foundLoc = true;
              }
            }
          }
        }

        if (!foundLoc) {
          if (issue.varName) {
            const cleanVar = unwrapDerName(issue.varName);
            const varIdx = findNextWordMatchIndex(body, cleanVar);
            if (varIdx !== -1) {
              issueOffset = classStart + varIdx;
              issueLength = cleanVar.length;
              foundLoc = true;
            } else if (cleanVar.includes(".")) {
              const compName = cleanVar.split(".")[0]!;
              const compIdx = findNextWordMatchIndex(body, compName);
              if (compIdx !== -1) {
                issueOffset = classStart + compIdx;
                issueLength = compName.length;
                foundLoc = true;
              }
            }
          }

          if (!foundLoc && typeof issue.eqIdx === "number" && issue.eqIdx >= 0) {
            const eqKeywordIdx = body.indexOf("equation");
            if (eqKeywordIdx >= 0) {
              issueOffset = classStart + eqKeywordIdx;
              issueLength = 8;
              foundLoc = true;
            }
          }
        }

        if (!foundLoc) {
          const eqIdx = body.indexOf("equation");
          if (eqIdx >= 0) {
            issueOffset = classStart + eqIdx;
            issueLength = 8;
          } else {
            issueOffset = classStart;
            issueLength = Math.min(cls.name.length, body.length);
          }
        }

        const definite = issue.severity === "definite";
        const standardClause = issue.standardClause;
        if (!definite && !standardClause && !formalVerificationOnSave) {
          continue;
        }
        const issueKind: string = issue.kind;
        const isUnreachable =
          issueKind === "unreachable_mode" || issueKind === "dead_branch" || issueKind === "unreachable_branch";
        diagnostics.push({
          severity: definite ? SEVERITY_ERROR : SEVERITY_WARNING,
          range: { start: positionAt(issueOffset), end: positionAt(issueOffset + issueLength) },
          message: `${standardClause ? "[Standard Compliance]" : definite ? "[DAE Formal Defect]" : "[DAE Invariant Warning]"} ${issue.message}`,
          source: "modelscript-dae-verifier",
          code: issue.kind,
          ...(isUnreachable ? { tags: [1] } : {}),
          data: {
            kind: issue.kind,
            severity: issue.severity,
            interval: issue.interval,
            varName: issue.varName,
            rule: standardClause ? (definite ? "S5020" : "S5021") : issue.kind === "div_by_zero" ? "M5101" : "M5103",
            standardClause,
            margin: issue.margin,
            suggestedValue: issue.suggestedValue,
            requiredLimit: issue.requiredLimit,
          },
        });
      }
    }

    if (completed) {
      const prefix = `${effectiveUri}#`;
      for (const k of [...daeVerificationCache.keys()]) {
        if (k.startsWith(prefix) && !liveKeys.has(k)) daeVerificationCache.delete(k);
      }
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    onError?.(`[modelica-dae-verifier] Error in DAE verification: ${errMsg}`);
  }

  return { daeMap, diagnostics };
}

export function stripModelicaTrivia(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "/" && text[i + 1] === "/") {
      out += " ";
      i += 2;
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      out += " ";
      i += 2;
      while (i + 1 < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else if (ch === '"') {
      out += " ";
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < text.length) i += 2;
        else i++;
      }
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

export function countModelicaInputPrimitives(text: string): number {
  const clean = stripModelicaTrivia(text);
  const tokens = tokenizeWordsAndPunct(clean);
  let count = 0;
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (tokens[i]!.text === "input" && MODELICA_PRIMITIVE_TYPES.has(tokens[i + 1]!.text)) {
      count++;
    }
  }
  return count;
}

export function parseModelicaEquationsForVariablesCounts(msg: string): { eqCount: number; varCount: number } | null {
  const tokens = tokenizeWordsAndPunct(msg);
  for (let i = 0; i + 4 < tokens.length; i++) {
    const tEq = tokens[i]!;
    if (
      isDigitsOnly(tEq.text) &&
      tokens[i + 1]!.text === "equations" &&
      tokens[i + 2]!.text === "for" &&
      isDigitsOnly(tokens[i + 3]!.text) &&
      tokens[i + 4]!.text === "variables"
    ) {
      return { eqCount: Number(tEq.text), varCount: Number(tokens[i + 3]!.text) };
    }
  }
  return null;
}
