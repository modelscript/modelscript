// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — On-Demand Deep Formal Verification Linter (`S7001`–`S7006`).
 *
 * Orchestrates `@modelscript/runtime`'s deep formal verification engines for `--formal` CLI
 * runs and Morsel interactive verification:
 *   - S6031 (`high-index-parametric-constraint`): `SysML2DaeLowerer` + `computePryceSignatureMatrix` +
 *            `pantelidesIndexReductionArena` (Pantelides / Pryce Structural DAE Index Analysis)
 *   - S7001 (`hierarchical-pdr-unsafe-state`): `WasmRtcStateMachine` + `PdrEngine` (`IC3Engine`)
 *   - S7002 (`asil-single-point-of-failure`): `SafetyTheoryOracle` (MOCUS Minimal Cut Sets & ISO 26262 PMHF/SPFM)
 *   - S7003 (`probabilistic-requirement-violated`): `UqTheoryOracle` (Analytical Normal/Uniform CDF Chance Constraints)
 *   - S7004 (`mechanical-tolerance-stack-interference`): `ToleranceStackOracle` (Worst-Case, RSS & Six-Sigma GD&T)
 *   - S7005 (`relational-hyperproperty-violation`): `RelationalVerifier` (2-Safety Non-Interference & Lipschitz Gain)
 *   - S7006 (`continuous-flowpipe-or-barrier-violation`): `SysML2DaeLowerer` + `DaeIntervalEvaluator` +
 *            `SosBarrierSynthesizer` + `HybridFlowpipeSolver` (Taylor Model Continuous Reachability)
 */

import type { CSTNode } from "@modelscript/dsl";
import {
  computePryceSignatureMatrix,
  containsDerivative,
  DaeIntervalEvaluator,
  evalArenaExpr,
  ExprKind,
  HybridFlowpipeSolver,
  initBltWasm,
  Interval,
  pantelidesIndexReductionArena,
  PdrEngine,
  RelationalVerifier,
  SafetyTheoryOracle,
  SosBarrierSynthesizer,
  StateKind,
  TaylorDomain,
  TaylorModel,
  ToleranceStackOracle,
  UqTheoryOracle,
  Variability,
  WasmRtcStateMachine,
  type ArenaEvalEnv,
  type AsilLevel,
  type ExprNode,
  type FlowpipeRequirement,
  type HybridMode,
  type NonlinearConstraint,
  type QueryDB,
  type StateId,
  type SymbolEntry,
  type ToleranceChainSpec,
} from "@modelscript/runtime";
import {
  collapseWhitespace,
  collectCstLeaves,
  findCstDescendants,
  findFirstDescendant,
  getCstChildren,
  isSysmlIdentLeaf,
  parseSignedNumberFromLeaves,
  parseSysmlSource,
  readDottedChainFromLeaves,
  sliceBetweenLeaves,
  stripSurroundingQuotes,
  type CstLeaf,
  type SysmlCstNode,
} from "./cst-utils.js";
import { SysML2ErrorCode, type DiagnosticSeverity, type ErrorCodeDef, type SysML2Diagnostic } from "./errors.js";
import { isGuardTautologicallyFalse } from "./lints.js";
import {
  collectEffectiveSubjectAttributes,
  evaluateExpressionNode,
  getConstraintKind,
  getFeatureValue,
  getRelationshipTargetName,
  metaStr,
  resolveTypeOf,
  type EvalResult,
} from "./queries.js";
import { parseLinearExpression } from "./real-simplex.js";
import { checkSpatialEnvelopes, narrowDiagnosticRange } from "./sota-lints.js";
import { SysML2DaeLowerer } from "./sysml2-dae-lowerer.js";
import { normalizeTypeName } from "./type-checker.js";

export type FormalEngineKind =
  | "Pantelides/Pryce"
  | "Spatial/RCC8"
  | "IC3/PDR"
  | "SafetyTheoryOracle"
  | "UqTheoryOracle"
  | "ToleranceStackOracle"
  | "RelationalVerifier"
  | "Flowpipe/SOS";

/**
 * Structured diagnostic produced by the deep formal verification engine (`S7001`–`S7006`).
 */
export interface SysML2FormalDiagnostic extends SysML2Diagnostic {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  symbolId: number;
  symbolName: string;
  resourceId?: string | undefined;
  startOffset: number;
  endOffset: number;
  engine: FormalEngineKind;
  witness?: Record<string, unknown> | undefined;
}

/**
 * Filtering options for `verifySysML2Formal` / `verifySysML2FormalSync`.
 */
export interface SysML2FormalVerifyOptions {
  resourceUri?: string | undefined;
  scopeName?: string | undefined;
}

// ---------------------------------------------------------------------------
// Shared CST & Metadata Extraction Utilities (Zero-Reparse First)
// ---------------------------------------------------------------------------

function getCstFast(db: QueryDB, entry: SymbolEntry): { node: SysmlCstNode | null; baseOffset: number } {
  const direct = db.cstNode(entry.id) as SysmlCstNode | null | undefined;
  if (direct) return { node: direct, baseOffset: 0 };
  const text = db.cstText(entry.startOffset, entry.endOffset, entry);
  if (text) {
    const parsed = parseSysmlSource(text);
    if (parsed) return { node: parsed, baseOffset: entry.startOffset };
  }
  return { node: null, baseOffset: 0 };
}

function getLeavesFast(db: QueryDB, entry: SymbolEntry): CstLeaf[] {
  const { node } = getCstFast(db, entry);
  return node ? collectCstLeaves(node) : [];
}

function isInRequestedScope(db: QueryDB, entry: SymbolEntry, options?: SysML2FormalVerifyOptions): boolean {
  if (!options) return true;
  if (options.resourceUri) {
    const uri = entry.resourceId ?? entry.documentUri;
    if (uri && uri !== options.resourceUri) return false;
  }
  if (options.scopeName) {
    let cur: SymbolEntry | undefined = entry;
    const visited = new Set<number>();
    let matched = false;
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      if (cur.name === options.scopeName) {
        matched = true;
        break;
      }
      cur = cur.parentId !== null ? db.symbol(cur.parentId) : undefined;
    }
    if (!matched) return false;
  }
  return true;
}

function makeFormalDiag<TArgs extends readonly unknown[]>(
  db: QueryDB,
  owner: SymbolEntry,
  def: ErrorCodeDef<TArgs>,
  args: TArgs,
  engine: FormalEngineKind,
  target?: SymbolEntry | null,
  witness?: Record<string, unknown>,
): SysML2FormalDiagnostic {
  const range = narrowDiagnosticRange(db, owner, target ?? null);
  const startOffset = range.startOffset ?? owner.startOffset;
  const endOffset = range.endOffset ?? Math.min(owner.endOffset, startOffset + Math.max(1, owner.name.length || 8));
  return {
    code: def.code,
    rule: def.rule,
    severity: def.severity,
    message: (def.message as (...a: readonly unknown[]) => string)(...args),
    symbolId: (target ?? owner).id,
    symbolName: (target ?? owner).name || owner.name || owner.ruleName,
    resourceId: (target ?? owner).resourceId ?? (target ?? owner).documentUri ?? owner.resourceId ?? owner.documentUri,
    startOffset,
    endOffset,
    engine,
    ...(witness ? { witness } : {}),
  };
}

interface ParsedMetadataAnnotation {
  name: string;
  shortName: string;
  fields: Map<string, number | string | boolean>;
}

/**
 * Extracts prefix `#Meta` and owned `@Meta { key = val; ... }` annotations directly attached to `entry`
 * (excluding nested child Usages/Definitions other than `MetadataUsage`).
 */
function extractSymbolMetadataAnnotations(db: QueryDB, entry: SymbolEntry): ParsedMetadataAnnotation[] {
  const results: ParsedMetadataAnnotation[] = [];
  const { node: cst } = getCstFast(db, entry);

  const parseMetaFieldsFromLeaves = (leaves: readonly CstLeaf[]): Map<string, number | string | boolean> => {
    const fields = new Map<string, number | string | boolean>();
    for (let i = 0; i < leaves.length; i++) {
      const tok = leaves[i]!.text;
      if ((tok === "=" || tok === ":=") && i > 0) {
        const key = leaves[i - 1]!.text;
        if (!isSysmlIdentLeaf(key)) continue;
        const num = parseSignedNumberFromLeaves(leaves, i + 1);
        if (num) {
          fields.set(key, num.value);
          continue;
        }
        const rhsTok = leaves[i + 1]?.text ?? "";
        if (rhsTok === "true") fields.set(key, true);
        else if (rhsTok === "false") fields.set(key, false);
        else if ((rhsTok.startsWith('"') && rhsTok.endsWith('"')) || (rhsTok.startsWith("'") && rhsTok.endsWith("'"))) {
          fields.set(key, stripSurroundingQuotes(rhsTok));
        } else if (isSysmlIdentLeaf(rhsTok)) {
          fields.set(key, rhsTok);
        }
      }
    }
    return fields;
  };

  // 1. Prefix `#Meta` in entry header before `{`
  if (cst) {
    const headerLeaves = collectCstLeaves(cst);
    for (let i = 0; i < headerLeaves.length; i++) {
      const tok = headerLeaves[i]!.text;
      if (tok === "{" || tok === ";") break;
      if (tok === "#") {
        const chain = readDottedChainFromLeaves(headerLeaves, i + 1);
        if (chain) {
          const shortName = normalizeTypeName(chain.text);
          results.push({ name: chain.text, shortName, fields: new Map() });
        }
      }
    }
  }

  // 2. Direct `MetadataUsage` (`@Meta { ... }` or `metadata Meta { ... }`) children
  for (const child of db.childrenOf(entry.id)) {
    if (child.ruleName !== "MetadataUsage" && child.ruleName !== "PrefixMetadataUsage") continue;
    const typingRef = db.childrenOf(child.id).find((c) => c.ruleName === "MetadataTyping");
    const mLeaves = getLeavesFast(db, child);
    let rawName = typingRef?.name?.trim() ?? "";
    if (!rawName) {
      const atIdx = mLeaves.findIndex((l) => l.text === "@" || l.text === "metadata" || l.text === "#");
      if (atIdx !== -1) {
        const ch = readDottedChainFromLeaves(mLeaves, atIdx + 1);
        if (ch) rawName = ch.text;
      }
    }
    if (!rawName) continue;
    const shortName = normalizeTypeName(rawName);
    const fields = parseMetaFieldsFromLeaves(mLeaves);
    results.push({ name: rawName, shortName, fields });
  }

  return results;
}

function getNumericField(
  fields: ReadonlyMap<string, number | string | boolean>,
  keys: readonly string[],
): number | undefined {
  for (const k of keys) {
    for (const [fk, fv] of fields) {
      if (fk.toLowerCase() === k.toLowerCase() && typeof fv === "number" && Number.isFinite(fv)) {
        return fv;
      }
    }
  }
  return undefined;
}

function getStringField(
  fields: ReadonlyMap<string, number | string | boolean>,
  keys: readonly string[],
): string | undefined {
  for (const k of keys) {
    for (const [fk, fv] of fields) {
      if (fk.toLowerCase() === k.toLowerCase() && typeof fv === "string") {
        return fv;
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// S7001: Hierarchical State Machine PDR / IC3 Verification
// ---------------------------------------------------------------------------

function isUnsafeStateSymbol(db: QueryDB, stateSym: SymbolEntry): boolean {
  const name = stateSym.name || "";
  if (/^(hazard|unsafe)/i.test(name)) return true;
  const metas = extractSymbolMetadataAnnotations(db, stateSym);
  for (const m of metas) {
    const low = m.shortName.toLowerCase();
    if (low === "hazard" || low === "unsafe" || low === "forbidden") return true;
  }
  return false;
}

function findInitialChildStateName(db: QueryDB, compositeSym: SymbolEntry, childStates: SymbolEntry[]): string | null {
  if (childStates.length === 0) return null;
  const validNames = new Set(childStates.map((s) => s.name).filter(Boolean));
  const { node: cst } = getCstFast(db, compositeSym);
  if (cst) {
    // Check direct body leaves (not nested child state bodies) for `entry ... then <stateName>`
    const childSpans = childStates.map((c) => ({ start: c.startOffset, end: c.endOffset }));
    const allLeaves = collectCstLeaves(cst);
    const { baseOffset } = getCstFast(db, compositeSym);
    const directLeaves = allLeaves.filter(
      (lf) => !childSpans.some((sp) => baseOffset + lf.start >= sp.start && baseOffset + lf.end <= sp.end),
    );
    for (let i = 0; i < directLeaves.length; i++) {
      if (directLeaves[i]!.text !== "entry") continue;
      for (let k = i + 1; k < Math.min(directLeaves.length, i + 8); k++) {
        if (directLeaves[k]!.text === "then") {
          const cand = directLeaves[k + 1]?.text;
          if (cand && validNames.has(cand)) return cand;
        }
      }
    }
  }
  return childStates[0]?.name || null;
}

/**
 * S7001: Builds a `WasmRtcStateMachine` for each hierarchical state machine and runs `PdrEngine` / `IC3Engine`.
 */
export function verifyHierarchicalPdrUnsafeState(
  db: QueryDB,
  options?: SysML2FormalVerifyOptions,
): SysML2FormalDiagnostic[] {
  const diagnostics: SysML2FormalDiagnostic[] = [];
  const allEntries = db.allEntries();

  for (const rootSm of allEntries) {
    if (
      rootSm.ruleName !== "StateDefinition" &&
      rootSm.ruleName !== "StateUsage" &&
      rootSm.ruleName !== "ExhibitStateUsage"
    ) {
      continue;
    }
    if (!isInRequestedScope(db, rootSm, options)) continue;

    // Only build from top-level state machine containers (skip nested substates)
    let hasStateAncestor = false;
    let pId = rootSm.parentId;
    while (pId !== null) {
      const pSym = db.symbol(pId);
      if (!pSym) break;
      if (
        pSym.ruleName === "StateDefinition" ||
        pSym.ruleName === "StateUsage" ||
        pSym.ruleName === "ExhibitStateUsage"
      ) {
        hasStateAncestor = true;
        break;
      }
      pId = pSym.parentId;
    }
    if (hasStateAncestor) continue;

    const directStates = db
      .childrenOf(rootSm.id)
      .filter((c) => c.ruleName === "StateUsage" || c.ruleName === "ExhibitStateUsage");
    if (directStates.length === 0) continue;

    const sm = new WasmRtcStateMachine();
    const symToStateId = new Map<number, StateId>();
    const pathToSym = new Map<string, SymbolEntry>();
    const leafDescendantsOf = new Map<number, StateId[]>();
    const unsafeSyms = new Map<string, SymbolEntry>();

    const rootInitName = findInitialChildStateName(db, rootSm, directStates);

    const registerHierarchy = (
      containerSym: SymbolEntry,
      parentStateId: StateId | undefined,
      prefix: string,
      isRootLevel: boolean,
    ): StateId[] => {
      const subStates = db
        .childrenOf(containerSym.id)
        .filter((c) => c.ruleName === "StateUsage" || c.ruleName === "ExhibitStateUsage");
      const initName = isRootLevel ? rootInitName : findInitialChildStateName(db, containerSym, subStates);
      const collectedLeafIds: StateId[] = [];

      for (const st of subStates) {
        const stName = st.name || `state_${st.id}`;
        const fullName = prefix ? `${prefix}.${stName}` : stName;
        const nestedChildren = db
          .childrenOf(st.id)
          .filter((c) => c.ruleName === "StateUsage" || c.ruleName === "ExhibitStateUsage");

        const isRootInit = isRootLevel && stName === initName && nestedChildren.length === 0;
        const kind = isRootInit
          ? StateKind.Initial
          : nestedChildren.length > 0
            ? StateKind.Composite
            : StateKind.Simple;

        const sId = sm.addState(fullName, kind, { parentId: parentStateId });
        symToStateId.set(st.id, sId);
        pathToSym.set(fullName, st);
        if (!pathToSym.has(stName)) pathToSym.set(stName, st);

        if (isUnsafeStateSymbol(db, st)) {
          unsafeSyms.set(fullName, st);
        }

        if (nestedChildren.length > 0) {
          const subLeafs = registerHierarchy(st, sId, fullName, false);
          leafDescendantsOf.set(st.id, subLeafs);
          collectedLeafIds.push(...subLeafs);

          const nestedInitName = findInitialChildStateName(db, st, nestedChildren);
          const nestedInitSym = nestedChildren.find((c) => c.name === nestedInitName) ?? nestedChildren[0]!;
          const nestedInitId = symToStateId.get(nestedInitSym.id);
          if (nestedInitId !== undefined) {
            if (isRootLevel && stName === initName) {
              // Add synthetic initial pseudostate entering composite's initial child
              const pseudoInit = sm.addState(`__init_${fullName}`, StateKind.Initial);
              sm.addTransition(pseudoInit, sId);
            }
            sm.addTransition(sId, nestedInitId);
          }
          // If composite itself is unsafe, entering any of its substates also enters it
          if (isUnsafeStateSymbol(db, st)) {
            for (const subC of nestedChildren) {
              const subFull = `${fullName}.${subC.name || `state_${subC.id}`}`;
              unsafeSyms.set(subFull, st);
            }
          }
        } else {
          leafDescendantsOf.set(st.id, [sId]);
          collectedLeafIds.push(sId);
        }
      }
      return collectedLeafIds;
    };

    registerHierarchy(rootSm, undefined, "", true);
    if (unsafeSyms.size === 0) continue;

    // Collect transitions at all levels inside `rootSm`
    const wireTransitionsInScope = (containerSym: SymbolEntry, prefix: string) => {
      const localStates = db
        .childrenOf(containerSym.id)
        .filter((c) => c.ruleName === "StateUsage" || c.ruleName === "ExhibitStateUsage");
      const localMap = new Map<string, SymbolEntry>();
      for (const ls of localStates) {
        if (ls.name) localMap.set(ls.name, ls);
      }

      const resolveStateSym = (rawPath: string): SymbolEntry | undefined => {
        const clean = rawPath.trim();
        if (!clean) return undefined;
        if (localMap.has(clean)) return localMap.get(clean);
        const prefixed = prefix ? `${prefix}.${clean}` : clean;
        if (pathToSym.has(prefixed)) return pathToSym.get(prefixed);
        return pathToSym.get(clean);
      };

      for (const tr of db.childrenOf(containerSym.id)) {
        if (tr.ruleName !== "TransitionUsage") continue;
        const leaves = getLeavesFast(db, tr);
        const rawText = db.cstText(tr.startOffset, tr.endOffset, tr) || "";
        const { node: trCst } = getCstFast(db, tr);

        let srcPath = "";
        let tgtPath = "";
        let guardText = "";
        let braceDepth = 0;

        for (let i = 0; i < leaves.length; i++) {
          const tok = leaves[i]!.text;
          if (tok === "{") braceDepth++;
          else if (tok === "}") braceDepth = Math.max(0, braceDepth - 1);
          if (braceDepth > 0) continue;

          if (tok === "first" && !srcPath) {
            srcPath = readDottedChainFromLeaves(leaves, i + 1)?.text ?? "";
          } else if (tok === "transition" && !srcPath) {
            const nxt = leaves[i + 1]?.text;
            if (nxt && nxt !== "first" && isSysmlIdentLeaf(nxt) && leaves[i + 2]?.text !== "first") {
              srcPath = readDottedChainFromLeaves(leaves, i + 1)?.text ?? "";
            }
          } else if (tok === "if" && !guardText) {
            const gNode = trCst?.childForFieldName?.("guard");
            if (gNode) {
              guardText = gNode.text.trim();
            } else {
              for (let j = i + 1; j < leaves.length; j++) {
                const et = leaves[j]!.text;
                if (et === "do" || et === "then" || et === "{" || et === ";") {
                  guardText = sliceBetweenLeaves(rawText, leaves[i]!, leaves[j]!);
                  break;
                }
              }
            }
          } else if (tok === "then" && !tgtPath) {
            tgtPath = readDottedChainFromLeaves(leaves, i + 1)?.text ?? "";
          }
        }

        if (!srcPath || !tgtPath) continue;
        if (guardText && isGuardTautologicallyFalse(db, tr, guardText)) continue;
        if (trCst) {
          const gNode = trCst.childForFieldName?.("guard");
          if (gNode && evaluateExpressionNode(db, gNode as unknown as CSTNode, containerSym.id) === false) {
            continue;
          }
        }

        const srcSym = resolveStateSym(srcPath);
        const tgtSym = resolveStateSym(tgtPath);
        if (!srcSym || !tgtSym) continue;
        const srcId = symToStateId.get(srcSym.id);
        const tgtId = symToStateId.get(tgtSym.id);
        if (srcId === undefined || tgtId === undefined) continue;

        sm.addTransition(srcId, tgtId, { name: tr.name || undefined });

        // Hierarchical exit transitions from composite state also fire from active nested substates
        const nestedLeafs = leafDescendantsOf.get(srcSym.id) ?? [];
        for (const subId of nestedLeafs) {
          if (subId !== srcId) {
            sm.addTransition(subId, tgtId, { name: tr.name || undefined });
          }
        }
      }

      for (const ls of localStates) {
        const nextPrefix = prefix ? `${prefix}.${ls.name || `state_${ls.id}`}` : ls.name || `state_${ls.id}`;
        wireTransitionsInScope(ls, nextPrefix);
      }
    };

    wireTransitionsInScope(rootSm, "");

    const pdr = new PdrEngine(sm);
    // Run both explicit PDR frame exploration and Symbolic IC3 CDCL verification
    const forbiddenNames = Array.from(unsafeSyms.keys());
    let pdrRes = pdr.checkAuto({ name: rootSm.name || "StateMachine", forbiddenStates: forbiddenNames }, 64);
    if (pdrRes.isProvenUniversal && sm.getAllStates().length <= 64) {
      // Cross-verify with symbolic IC3 engine
      const symRes = pdr.checkSymbolic({ name: rootSm.name || "StateMachine", forbiddenStates: forbiddenNames }, 64);
      if (!symRes.isProvenUniversal && symRes.counterexample) {
        pdrRes = symRes;
      }
    }

    if (!pdrRes.isProvenUniversal && pdrRes.counterexample && pdrRes.counterexample.length > 0) {
      const visibleSteps = pdrRes.counterexample.map((c) => c.stateName).filter((n) => !n.startsWith("__init_"));
      const reachedName = visibleSteps[visibleSteps.length - 1]!;
      const targetSym = unsafeSyms.get(reachedName) ?? pathToSym.get(reachedName) ?? rootSm;
      const traceStr = visibleSteps.join(" -> ");
      diagnostics.push(
        makeFormalDiag(
          db,
          rootSm,
          SysML2ErrorCode.HIERARCHICAL_PDR_UNSAFE_STATE,
          [rootSm.name || "StateMachine", targetSym.name || reachedName, `trace: ${traceStr}`],
          "IC3/PDR",
          targetSym,
          { counterexample: visibleSteps, framesCount: pdrRes.framesCount },
        ),
      );
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// S7002: ASIL / Safety-Critical Fault Tree Minimal Cut Set (SPOF) Analysis
// ---------------------------------------------------------------------------

function normalizeAsilLevel(raw: string | undefined): AsilLevel | undefined {
  if (!raw) return undefined;
  const up = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (up === "ASIL_D" || up === "D") return "ASIL_D";
  if (up === "ASIL_C" || up === "C") return "ASIL_C";
  if (up === "ASIL_B" || up === "B") return "ASIL_B";
  if (up === "ASIL_A" || up === "A") return "ASIL_A";
  if (up === "QM") return "QM";
  return undefined;
}

/**
 * S7002: Extracts `#Hazard` / `@ASIL` / `#FailureMode` fault propagation graphs and verifies
 * Minimal Cut Sets & PMHF/SPFM budgets via `SafetyTheoryOracle`.
 */
export function verifyAsilSinglePointOfFailure(
  db: QueryDB,
  options?: SysML2FormalVerifyOptions,
): SysML2FormalDiagnostic[] {
  const diagnostics: SysML2FormalDiagnostic[] = [];
  const allEntries = db.allEntries();

  interface DiscoveredFailureMode {
    id: string;
    sym: SymbolEntry;
    componentName: string;
    failureRatePerHour: number;
    diagnosticCoverage: number;
    safetyMechanism?: string | undefined;
  }

  const failureModes = new Map<string, DiscoveredFailureMode>();

  // 1. Discover #FailureMode / @FailureMode / #Fault elements across workspace
  for (const entry of allEntries) {
    if (entry.kind !== "Usage" && entry.kind !== "Definition") continue;
    const metas = extractSymbolMetadataAnnotations(db, entry);
    const fmMeta = metas.find((m) => {
      const low = m.shortName.toLowerCase();
      return low === "failuremode" || low === "fault" || low === "basicfault" || low === "primaryevent";
    });
    if (!fmMeta) continue;

    const attrs = collectEffectiveSubjectAttributes(db, entry);
    const fitVal =
      getNumericField(fmMeta.fields, ["fit", "fitRate", "baseFitRate"]) ??
      (typeof attrs.get("fit") === "number" ? (attrs.get("fit") as number) : undefined) ??
      (typeof attrs.get("fitRate") === "number" ? (attrs.get("fitRate") as number) : undefined);
    const lambdaVal =
      getNumericField(fmMeta.fields, ["failureRate", "failureRatePerHour", "lambda", "rate"]) ??
      (typeof attrs.get("failureRate") === "number" ? (attrs.get("failureRate") as number) : undefined) ??
      (typeof attrs.get("lambda") === "number" ? (attrs.get("lambda") as number) : undefined);

    const failureRatePerHour = lambdaVal !== undefined ? lambdaVal : fitVal !== undefined ? fitVal * 1e-9 : 100e-9;

    let dc =
      getNumericField(fmMeta.fields, ["diagnosticCoverage", "dc", "coverage"]) ??
      (typeof attrs.get("diagnosticCoverage") === "number" ? (attrs.get("diagnosticCoverage") as number) : 0);
    if (dc > 1.0 && dc <= 100.0) dc = dc / 100.0;

    const safetyMechanism =
      getStringField(fmMeta.fields, ["safetyMechanism", "mechanism"]) ??
      (typeof attrs.get("safetyMechanism") === "string" ? (attrs.get("safetyMechanism") as string) : undefined);

    const parentSym = entry.parentId !== null ? db.symbol(entry.parentId) : undefined;
    const compName = parentSym?.name || entry.name || `comp_${entry.id}`;
    const fmKey = entry.name || `fm_${entry.id}`;

    const record: DiscoveredFailureMode = {
      id: fmKey,
      sym: entry,
      componentName: compName,
      failureRatePerHour,
      diagnosticCoverage: dc,
      safetyMechanism,
    };
    failureModes.set(fmKey, record);
    if (parentSym?.name && entry.name) {
      failureModes.set(`${parentSym.name}.${entry.name}`, record);
    }
  }

  // 2. Discover #Hazard / @Hazard / @ASIL / @SafetyCritical elements
  for (const entry of allEntries) {
    if (entry.kind !== "Usage" && entry.kind !== "Definition") continue;
    if (!isInRequestedScope(db, entry, options)) continue;

    const metas = extractSymbolMetadataAnnotations(db, entry);
    const hazardMeta = metas.find((m) => {
      const low = m.shortName.toLowerCase();
      return low === "hazard" || low === "topevent" || low === "safetygoal";
    });
    const asilMeta = metas.find((m) => {
      const low = m.shortName.toLowerCase();
      return (
        low === "asil" ||
        low === "asil_d" ||
        low === "asil_c" ||
        low === "asil_b" ||
        low === "asil_a" ||
        low === "safetycritical"
      );
    });

    if (!hazardMeta && !(asilMeta && /^hazard/i.test(entry.name || ""))) continue;

    const attrs = collectEffectiveSubjectAttributes(db, entry);
    let asilLevel: AsilLevel | undefined =
      normalizeAsilLevel(
        getStringField(asilMeta?.fields ?? new Map(), ["level", "asil", "asilLevel"]) ??
          getStringField(hazardMeta?.fields ?? new Map(), ["asil", "asilLevel", "level"]) ??
          (typeof attrs.get("asil") === "string" ? (attrs.get("asil") as string) : undefined) ??
          (typeof attrs.get("asilLevel") === "string" ? (attrs.get("asilLevel") as string) : undefined),
      ) ?? normalizeAsilLevel(asilMeta?.shortName);

    const isSafetyCritical =
      metas.some((m) => m.shortName.toLowerCase() === "safetycritical" || m.shortName.toLowerCase() === "critical") ||
      (getNumericField(hazardMeta?.fields ?? new Map(), ["severity"]) ?? 0) >= 8;

    if (!asilLevel && (isSafetyCritical || hazardMeta)) {
      asilLevel = "ASIL_D";
    }

    const targetPmhfFit =
      getNumericField(hazardMeta?.fields ?? new Map(), ["targetPmhf", "targetPmhfFit", "maxPmhf", "pmhfBudget"]) ??
      getNumericField(asilMeta?.fields ?? new Map(), ["targetPmhf", "targetPmhfFit", "maxPmhf"]) ??
      (typeof attrs.get("targetPmhf") === "number" ? (attrs.get("targetPmhf") as number) : undefined) ??
      (asilLevel === "ASIL_D" ? 10 : asilLevel === "ASIL_C" ? 100 : undefined);

    const oracle = new SafetyTheoryOracle();
    for (const [, fm] of failureModes) {
      oracle.registerFailureMode({
        id: fm.id,
        componentName: fm.componentName,
        modeName: fm.id,
        failureRatePerHour: fm.failureRatePerHour,
        diagnosticCoverage: fm.diagnosticCoverage,
        safetyMechanism: fm.safetyMechanism,
      });
      oracle.registerFtaNode({
        id: fm.id,
        name: fm.id,
        gateType: "PRIMARY_EVENT",
        children: [],
        failureModeId: fm.id,
      });
    }

    // Build Fault Tree Gate structure for this hazard from boolean constraints, flows, or connections
    const rootGateId = `__hazard_root_${entry.id}`;
    let builtFromExpr = false;
    let synthCounter = 0;

    const buildGateFromBooleanCst = (exprNode: SysmlCstNode): string | null => {
      if (exprNode.type === "OrExpression") {
        const ops = exprNode.childrenForFieldName?.("operand") ?? [];
        const childIds = ops.map(buildGateFromBooleanCst).filter((x): x is string => Boolean(x));
        if (childIds.length === 0) return null;
        if (childIds.length === 1) return childIds[0]!;
        const gId = `__or_${entry.id}_${++synthCounter}`;
        oracle.registerFtaNode({ id: gId, name: gId, gateType: "OR", children: childIds });
        return gId;
      }
      if (exprNode.type === "AndExpression") {
        const ops = exprNode.childrenForFieldName?.("operand") ?? [];
        const childIds = ops.map(buildGateFromBooleanCst).filter((x): x is string => Boolean(x));
        if (childIds.length === 0) return null;
        if (childIds.length === 1) return childIds[0]!;
        const gId = `__and_${entry.id}_${++synthCounter}`;
        oracle.registerFtaNode({ id: gId, name: gId, gateType: "AND", children: childIds });
        return gId;
      }
      if (exprNode.type === "FeatureReferenceExpression" || exprNode.type === "PrimaryExpression") {
        const refText = exprNode.text.trim();
        const fm = failureModes.get(refText) ?? failureModes.get(refText.split(".").pop() || "");
        if (fm) return fm.id;
        // Also support non-annotated boolean fault variables inside hazard definition
        if (isSysmlIdentLeaf(refText)) {
          if (!failureModes.has(refText)) {
            oracle.registerFailureMode({
              id: refText,
              componentName: entry.name || "System",
              modeName: refText,
              failureRatePerHour: 100e-9,
              diagnosticCoverage: 0,
            });
            oracle.registerFtaNode({
              id: refText,
              name: refText,
              gateType: "PRIMARY_EVENT",
              children: [],
              failureModeId: refText,
            });
          }
          return refText;
        }
      }
      const chs = getCstChildren(exprNode);
      if (chs.length === 1) return buildGateFromBooleanCst(chs[0]!);
      for (const ch of chs) {
        if (ch.type === "(" || ch.text === "(" || ch.type === ")" || ch.text === ")") continue;
        if (ch.type.includes("Expression") || ch.type.includes("Member")) {
          const inner = buildGateFromBooleanCst(ch);
          if (inner) return inner;
        }
      }
      return null;
    };

    // Check owned value expression or constraint expressions on hazard
    const { node: hCst } = getCstFast(db, entry);
    if (hCst) {
      const exprCandidates: SysmlCstNode[] = [
        ...findCstDescendants(hCst, "OrExpression"),
        ...findCstDescendants(hCst, "AndExpression"),
      ];
      if (exprCandidates.length > 0) {
        const topGate = buildGateFromBooleanCst(exprCandidates[0]!);
        if (topGate) {
          const isAnd = metas.some((m) => m.shortName.toLowerCase() === "andgate");
          oracle.registerFtaNode({
            id: rootGateId,
            name: entry.name || "Hazard",
            gateType: isAnd ? "AND" : "OR",
            children: [topGate],
          });
          builtFromExpr = true;
        }
      }
    }

    if (!builtFromExpr) {
      // Collect failure modes linked via `causes`, `flows`, `connections`, `allocations`, or owned children
      const linkedFmIds = new Set<string>();
      const entryName = entry.name || "";

      for (const child of db.childrenOf(entry.id)) {
        const fm = failureModes.get(child.name);
        if (fm) linkedFmIds.add(fm.id);
      }

      const parentScopeEntries = entry.parentId !== null ? db.childrenOf(entry.parentId) : allEntries;
      for (const sib of parentScopeEntries) {
        if (sib.ruleName === "FlowUsage" || sib.ruleName === "ConnectionUsage" || sib.ruleName === "AllocationUsage") {
          const leaves = getLeavesFast(db, sib);
          const chains: string[] = [];
          for (let i = 0; i < leaves.length; i++) {
            const ch = readDottedChainFromLeaves(leaves, i);
            if (ch) {
              chains.push(ch.text);
              i = ch.nextIdx - 1;
            }
          }
          const mentionsHazard = chains.some((c) => c === entryName || c.endsWith(`.${entryName}`));
          if (mentionsHazard) {
            for (const c of chains) {
              const fm = failureModes.get(c) ?? failureModes.get(c.split(".").pop() || "");
              if (fm) linkedFmIds.add(fm.id);
            }
          }
        }
      }

      // Also check `causes` / `faults` / `sources` field on @Hazard annotations (`@Hazard { causes = "singleSensor"; }`)
      for (const hm of metas) {
        const causesList = getStringField(hm.fields, ["causes", "faults", "sources", "failureModes"]);
        if (causesList) {
          for (const rawItem of causesList.split(",")) {
            const trimmed = rawItem.trim();
            if (!trimmed) continue;
            const fm = failureModes.get(trimmed) ?? failureModes.get(trimmed.split(".").pop() || "");
            if (fm) linkedFmIds.add(fm.id);
          }
        }
      }

      // Also check `causes` field on #FailureMode annotations (`@FailureMode { causes = "BrakeLoss"; }`)
      for (const [, fm] of failureModes) {
        const fmMetas = extractSymbolMetadataAnnotations(db, fm.sym);
        for (const m of fmMetas) {
          const causesVal = getStringField(m.fields, ["causes", "hazard", "propagatesTo"]);
          if (causesVal && causesVal === entryName) {
            linkedFmIds.add(fm.id);
          }
        }
      }

      if (linkedFmIds.size > 0) {
        const isRedundantAnd = metas.some((m) => {
          const low = m.shortName.toLowerCase();
          return low === "andgate" || low === "redundant" || low === "dualredundancy";
        });
        oracle.registerFtaNode({
          id: rootGateId,
          name: entryName || "Hazard",
          gateType: isRedundantAnd ? "AND" : "OR",
          children: Array.from(linkedFmIds),
        });
        builtFromExpr = true;
      }
    }

    if (!builtFromExpr) continue;

    oracle.registerHazard({
      id: `haz_${entry.id}`,
      name: entry.name || "Hazard",
      asilLevel,
      targetPmhfFit,
      targetSpfm: asilLevel === "ASIL_D" ? 0.99 : asilLevel === "ASIL_C" ? 0.97 : undefined,
      rootNodeId: rootGateId,
    });

    const mcs = oracle.computeMinimalCutSets(rootGateId);
    const spofs = mcs
      .filter((cs) => cs.length === 1)
      .map((cs) => cs[0]!)
      .filter((fmId) => {
        const fm = failureModes.get(fmId);
        return !fm || fm.diagnosticCoverage < 0.99;
      });
    const satRes = oracle.checkSat();

    const isHighAsil = asilLevel === "ASIL_D" || asilLevel === "ASIL_C" || isSafetyCritical;
    if ((isHighAsil && spofs.length > 0) || !satRes.isSat) {
      const spofStr =
        spofs.length > 0
          ? `order-1 Minimal Cut Set (Single Point of Failure): {${spofs.join(", ")}}`
          : (satRes.conflict?.explanation ?? "safety metric violation");
      diagnostics.push(
        makeFormalDiag(
          db,
          entry,
          SysML2ErrorCode.ASIL_SINGLE_POINT_OF_FAILURE,
          [entry.name || "Hazard", spofStr],
          "SafetyTheoryOracle",
          null,
          { minimalCutSets: mcs, singlePointsOfFailure: spofs, asilLevel },
        ),
      );
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// S7003: Probabilistic / Uncertainty Quantification (UQ) Chance Constraints
// ---------------------------------------------------------------------------

/**
 * S7003: Evaluates `@Normal` / `@Uniform` stochastic distributions and `prob(...)` /
 * `@MaxFailureProbability` chance constraints analytically via `UqTheoryOracle`.
 */
export function verifyProbabilisticRequirements(
  db: QueryDB,
  options?: SysML2FormalVerifyOptions,
): SysML2FormalDiagnostic[] {
  const diagnostics: SysML2FormalDiagnostic[] = [];
  const allEntries = db.allEntries();

  type DistSpec = { kind: "normal"; mean: number; stdDev: number } | { kind: "uniform"; min: number; max: number };

  const distMap = new Map<string, DistSpec>();

  // 1. Collect @Normal / @Uniform distributions on attributes/features
  for (const entry of allEntries) {
    if (entry.kind !== "Usage" || !entry.name) continue;
    const metas = extractSymbolMetadataAnnotations(db, entry);
    const normMeta = metas.find((m) => {
      const low = m.shortName.toLowerCase();
      return low === "normal" || low === "gaussian" || low === "normaldistribution";
    });
    const unifMeta = metas.find((m) => {
      const low = m.shortName.toLowerCase();
      return low === "uniform" || low === "uniformdistribution";
    });

    const parentSym = entry.parentId !== null ? db.symbol(entry.parentId) : undefined;
    const registerDist = (spec: DistSpec) => {
      distMap.set(entry.name, spec);
      if (parentSym?.name) {
        distMap.set(`${parentSym.name}.${entry.name}`, spec);
      }
    };

    if (normMeta) {
      const defaultMean = getFeatureValue(db, entry, entry.parentId);
      const mean =
        getNumericField(normMeta.fields, ["mean", "mu", "nominal"]) ??
        (typeof defaultMean === "number" ? defaultMean : undefined);
      const stdDev = getNumericField(normMeta.fields, ["std", "stdDev", "stddev", "sigma"]);
      if (mean !== undefined && stdDev !== undefined) {
        registerDist({ kind: "normal", mean, stdDev });
      }
    } else if (unifMeta) {
      const min = getNumericField(unifMeta.fields, ["min", "low", "lower", "a"]);
      const max = getNumericField(unifMeta.fields, ["max", "high", "upper", "b"]);
      if (min !== undefined && max !== undefined) {
        registerDist({ kind: "uniform", min, max });
      }
    }
  }

  if (distMap.size === 0) return diagnostics;

  // Propagate linear combinations of independent Normal random variables (`total = x1 + x2`)
  for (const entry of allEntries) {
    if (entry.kind !== "Usage" || !entry.name || distMap.has(entry.name)) continue;
    const { node: cst } = getCstFast(db, entry);
    if (!cst) continue;
    const fv = findFirstDescendant(cst, "FeatureValue");
    const expr = fv ? findFirstDescendant(fv, "OwnedExpression") : null;
    if (!expr) continue;
    const lin = parseLinearExpression(expr.text);
    if (lin.terms.length === 0) continue;
    let meanSum = lin.constant;
    let varSum = 0;
    let allNormal = true;
    for (const term of lin.terms) {
      const d = distMap.get(term.varName) ?? distMap.get(term.varName.split(".").pop() || "");
      if (!d || d.kind !== "normal") {
        allNormal = false;
        break;
      }
      meanSum += term.coeff * d.mean;
      varSum += term.coeff * term.coeff * d.stdDev * d.stdDev;
    }
    if (allNormal) {
      const spec: DistSpec = { kind: "normal", mean: meanSum, stdDev: Math.sqrt(varSum) };
      distMap.set(entry.name, spec);
      const parentSym = entry.parentId !== null ? db.symbol(entry.parentId) : undefined;
      if (parentSym?.name) distMap.set(`${parentSym.name}.${entry.name}`, spec);
    }
  }

  const resolveDistKey = (rawVar: string): string | null => {
    if (distMap.has(rawVar)) return rawVar;
    const tail = rawVar.split(".").pop() || rawVar;
    if (distMap.has(tail)) return tail;
    return null;
  };

  // 2. Scan requirements and constraints for `prob(var op limit) <= alpha` or `@MaxFailureProbability`
  for (const entry of allEntries) {
    if (
      entry.ruleName !== "RequirementDefinition" &&
      entry.ruleName !== "RequirementUsage" &&
      entry.ruleName !== "ConstraintDefinition" &&
      entry.ruleName !== "ConstraintUsage" &&
      entry.ruleName !== "AssertConstraintUsage"
    ) {
      continue;
    }
    if (!isInRequestedScope(db, entry, options)) continue;

    const probBounds: Array<{
      varKey: string;
      op: ">" | ">=" | "<" | "<=";
      threshold: number;
      maxProb: number;
      targetSym: SymbolEntry;
    }> = [];

    // Pattern A: `prob(var op limit) <= alpha` or `p(var op limit) <= alpha` in CST leaves
    const constraintTargets =
      entry.ruleName === "RequirementDefinition" || entry.ruleName === "RequirementUsage"
        ? db
            .childrenOf(entry.id)
            .filter(
              (c) =>
                c.ruleName === "RequirementConstraintUsage" ||
                c.ruleName === "AssertConstraintUsage" ||
                c.ruleName === "ConstraintUsage",
            )
        : [entry];

    for (const cSym of constraintTargets) {
      const leaves = getLeavesFast(db, cSym);
      for (let i = 0; i < leaves.length; i++) {
        const fnLow = leaves[i]!.text.toLowerCase();
        if (
          (fnLow !== "prob" && fnLow !== "p" && fnLow !== "pr" && fnLow !== "probability") ||
          leaves[i + 1]?.text !== "("
        ) {
          continue;
        }
        const varChain = readDottedChainFromLeaves(leaves, i + 2);
        if (!varChain) continue;
        const innerOp = leaves[varChain.nextIdx]?.text;
        if (innerOp !== ">" && innerOp !== ">=" && innerOp !== "<" && innerOp !== "<=") continue;
        const limitNum = parseSignedNumberFromLeaves(leaves, varChain.nextIdx + 1);
        if (!limitNum || leaves[limitNum.nextIdx]?.text !== ")") continue;

        const outerOp = leaves[limitNum.nextIdx + 1]?.text;
        const alphaNum = parseSignedNumberFromLeaves(leaves, limitNum.nextIdx + 2);
        if (!outerOp || !alphaNum) continue;

        const dKey = resolveDistKey(varChain.text);
        if (!dKey) continue;

        if (outerOp === "<=" || outerOp === "<") {
          probBounds.push({
            varKey: dKey,
            op: innerOp,
            threshold: limitNum.value,
            maxProb: alphaNum.value,
            targetSym: cSym,
          });
        } else if (outerOp === ">=" || outerOp === ">") {
          // Reliability form `prob(var <= L) >= 0.999` <=> `prob(var > L) <= 0.001`
          const invertedOp: ">" | ">=" | "<" | "<=" =
            innerOp === "<=" ? ">" : innerOp === "<" ? ">=" : innerOp === ">=" ? "<" : "<=";
          probBounds.push({
            varKey: dKey,
            op: invertedOp,
            threshold: limitNum.value,
            maxProb: Math.max(0, 1.0 - alphaNum.value),
            targetSym: cSym,
          });
        }
      }
    }

    // Pattern B: `@MaxFailureProbability { alpha = 0.001; }` paired with `require constraint { var <= limit }`
    const metas = extractSymbolMetadataAnnotations(db, entry);
    const maxFailMeta = metas.find((m) => {
      const low = m.shortName.toLowerCase();
      return (
        low === "maxfailureprobability" ||
        low === "probabilistic" ||
        low === "chanceconstraint" ||
        low === "stochasticrequirement"
      );
    });
    if (maxFailMeta && probBounds.length === 0) {
      const alpha =
        getNumericField(maxFailMeta.fields, ["alpha", "maxProb", "maxProbability", "maxFailureProbability", "limit"]) ??
        (getNumericField(maxFailMeta.fields, ["confidence", "reliability"]) !== undefined
          ? 1.0 - getNumericField(maxFailMeta.fields, ["confidence", "reliability"])!
          : undefined);
      if (alpha !== undefined) {
        for (const cSym of constraintTargets) {
          if (cSym.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, cSym) === "assume") continue;
          const leaves = getLeavesFast(db, cSym);
          for (let i = 0; i < leaves.length; i++) {
            const ch = readDottedChainFromLeaves(leaves, i);
            if (!ch) continue;
            const op = leaves[ch.nextIdx]?.text;
            if (op !== "<=" && op !== "<" && op !== ">=" && op !== ">") continue;
            const num = parseSignedNumberFromLeaves(leaves, ch.nextIdx + 1);
            if (!num) continue;
            const dKey = resolveDistKey(ch.text);
            if (dKey) {
              // Violating `var <= limit` means `var > limit`
              const failOp: ">" | ">=" | "<" | "<=" = op === "<=" ? ">" : op === "<" ? ">=" : op === ">=" ? "<" : "<=";
              probBounds.push({
                varKey: dKey,
                op: failOp,
                threshold: num.value,
                maxProb: alpha,
                targetSym: cSym,
              });
              break;
            }
          }
        }
      }
    }

    for (const pb of probBounds) {
      const oracle = new UqTheoryOracle();
      const dist = distMap.get(pb.varKey)!;
      oracle.setDistribution(pb.varKey, dist);
      oracle.assertLiteral({
        id: 1,
        predicate: "probBound",
        args: [pb.varKey, pb.op, pb.threshold, pb.maxProb],
        isNegated: false,
      });
      const sat = oracle.checkSat();
      if (!sat.isSat) {
        const detail =
          sat.conflict?.explanation?.replace(/^Uncertainty Quantification \(UQ\) Conflict:\s*/i, "") ??
          `exceeds max failure probability ${pb.maxProb}`;
        diagnostics.push(
          makeFormalDiag(
            db,
            entry,
            SysML2ErrorCode.PROBABILISTIC_REQUIREMENT_VIOLATED,
            [entry.name || "requirement", detail],
            "UqTheoryOracle",
            pb.targetSym,
            { varName: pb.varKey, distribution: dist, threshold: pb.threshold, maxProbability: pb.maxProb },
          ),
        );
        break;
      }
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// S7004: Mechanical GD&T Tolerance Stack-Up Interference Verification
// ---------------------------------------------------------------------------

interface ExtractedTolContributor {
  key: string;
  partId: string;
  featureName: string;
  effectiveNominal: number;
  halfTolerance: number;
  explicitDirection?: 1 | -1 | undefined;
  cpk?: number | undefined;
  method?: "worst_case" | "rss" | "six_sigma" | undefined;
}

function extractToleranceFromEntry(db: QueryDB, entry: SymbolEntry, partId: string): ExtractedTolContributor | null {
  const metas = extractSymbolMetadataAnnotations(db, entry);
  const tolMeta = metas.find((m) => {
    const low = m.shortName.toLowerCase();
    return low === "tolerance" || low === "gdt" || low === "dimensiontolerance";
  });
  if (!tolMeta) return null;

  const baseVal = getFeatureValue(db, entry, entry.parentId);
  const nominal =
    getNumericField(tolMeta.fields, ["nominal", "value", "dim"]) ?? (typeof baseVal === "number" ? baseVal : undefined);
  if (nominal === undefined) return null;

  const symTol = getNumericField(tolMeta.fields, ["tolerance", "tol", "bilateral", "halfWidth"]);
  const plus = getNumericField(tolMeta.fields, ["plus", "upper", "upperTol"]);
  const minusRaw = getNumericField(tolMeta.fields, ["minus", "lower", "lowerTol"]);

  let effectiveNominal = nominal;
  let halfTolerance = 0;

  if (plus !== undefined || minusRaw !== undefined) {
    const p = plus ?? 0;
    // Support both `minus = -0.1` and `minus = 0.1` meaning `-0.1`
    const absMinus = minusRaw !== undefined ? Math.abs(minusRaw) : p;
    effectiveNominal = nominal + (p - absMinus) / 2;
    halfTolerance = (p + absMinus) / 2;
  } else if (symTol !== undefined) {
    halfTolerance = Math.abs(symTol);
  } else {
    return null;
  }

  const dirNum = getNumericField(tolMeta.fields, ["direction", "sign", "sensitivity"]);
  const explicitDirection: 1 | -1 | undefined = dirNum !== undefined ? (dirNum < 0 ? -1 : 1) : undefined;
  const cpk = getNumericField(tolMeta.fields, ["cpk"]);
  const methodRaw = getStringField(tolMeta.fields, ["method"])?.toLowerCase();
  const method =
    methodRaw === "rss" ? "rss" : methodRaw === "six_sigma" || methodRaw === "sixsigma" ? "six_sigma" : undefined;

  return {
    key: `${partId}.${entry.name}`,
    partId,
    featureName: entry.name || "dim",
    effectiveNominal,
    halfTolerance,
    explicitDirection,
    cpk,
    method,
  };
}

/**
 * S7004: Evaluates `@Tolerance` / `@GDT` chains and assembly clearance constraints via `ToleranceStackOracle`.
 */
export function verifyMechanicalToleranceStacks(
  db: QueryDB,
  options?: SysML2FormalVerifyOptions,
): SysML2FormalDiagnostic[] {
  const diagnostics: SysML2FormalDiagnostic[] = [];
  const allEntries = db.allEntries();

  for (const assembly of allEntries) {
    if (assembly.ruleName !== "PartDefinition" && assembly.ruleName !== "PartUsage") continue;
    if (!isInRequestedScope(db, assembly, options)) continue;

    const contributors = new Map<string, ExtractedTolContributor>();
    const children = db.childrenOf(assembly.id);

    // Direct tolerance-annotated attributes on assembly
    for (const ch of children) {
      if (ch.kind !== "Usage") continue;
      const direct = extractToleranceFromEntry(db, ch, assembly.name || "Assembly");
      if (direct && ch.ruleName !== "PartUsage") {
        contributors.set(ch.name, direct);
        contributors.set(direct.key, direct);
      }
      if (ch.ruleName === "PartUsage") {
        const pName = ch.name || `part_${ch.id}`;
        const partLevel = extractToleranceFromEntry(db, ch, pName);
        if (partLevel) {
          contributors.set(pName, partLevel);
        }
        for (const sub of db.childrenOf(ch.id)) {
          const subTol = extractToleranceFromEntry(db, sub, pName);
          if (subTol) {
            contributors.set(`${pName}.${sub.name}`, subTol);
            if (!contributors.has(sub.name)) contributors.set(sub.name, subTol);
          }
        }
        const pType = resolveTypeOf(db, ch);
        if (pType) {
          for (const sub of db.childrenOf(pType.id)) {
            const key = `${pName}.${sub.name}`;
            if (!contributors.has(key)) {
              const subTol = extractToleranceFromEntry(db, sub, pName);
              if (subTol) {
                contributors.set(key, subTol);
                if (!contributors.has(sub.name)) contributors.set(sub.name, subTol);
              }
            }
          }
        }
      }
    }

    if (contributors.size === 0) continue;

    // Discover clearance expressions (`attribute clearance = housing.dia - shaft.dia`) and clearance bounds (`clearance >= minClearance`)
    const exprAliases = new Map<string, string>();
    for (const ch of children) {
      if (ch.ruleName !== "AttributeUsage" || !ch.name) continue;
      const { node: chCst } = getCstFast(db, ch);
      const fv = chCst ? findFirstDescendant(chCst, "FeatureValue") : null;
      const expr = fv
        ? findFirstDescendant(fv, "OwnedExpression")
        : chCst
          ? findFirstDescendant(chCst, "OwnedExpression")
          : null;
      if (expr) {
        exprAliases.set(ch.name, expr.text.trim());
      }
    }

    // Collect constraint symbols (owned constraints + satisfied requirements)
    const constraintSyms: SymbolEntry[] = children.filter(
      (c) =>
        c.ruleName === "AssertConstraintUsage" ||
        c.ruleName === "ConstraintUsage" ||
        c.ruleName === "RequirementConstraintUsage",
    );
    for (const ch of children) {
      if (ch.ruleName === "SatisfyRequirementUsage") {
        const reqName = getRelationshipTargetName(db, ch);
        const rSym = reqName
          ? db.byName(reqName).find((s) => s.ruleName === "RequirementDefinition" || s.ruleName === "RequirementUsage")
          : null;
        if (rSym) {
          for (const rc of db.childrenOf(rSym.id)) {
            if (rc.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, rc) === "require") {
              constraintSyms.push(rc);
            }
          }
        }
      }
    }

    let minClearance: number | undefined;
    let maxClearance = Infinity;
    let linearClearanceExpr: string | undefined;
    let triggerSym: SymbolEntry | null = null;

    // Also check @Clearance metadata on assembly
    const asmMetas = extractSymbolMetadataAnnotations(db, assembly);
    const clearMeta = asmMetas.find((m) => m.shortName.toLowerCase() === "clearance");
    if (clearMeta) {
      minClearance = getNumericField(clearMeta.fields, ["min", "minClearance"]);
      const maxMeta = getNumericField(clearMeta.fields, ["max", "maxClearance"]);
      if (maxMeta !== undefined) maxClearance = maxMeta;
    }

    for (const cSym of constraintSyms) {
      const { node: cCst } = getCstFast(db, cSym);
      if (!cCst) continue;
      const relNodes = findCstDescendants(cCst, "RelationalExpression");
      for (const rel of relNodes) {
        const ops = rel.childrenForFieldName?.("operand") ?? [];
        const opStr = rel.childrenForFieldName?.("operator")?.[0]?.text?.trim() ?? "";
        if (ops.length < 2 || !opStr) continue;
        const lhsText = ops[0]!.text.trim();
        const rhsVal = evaluateExpressionNode(db, ops[1]! as unknown as CSTNode, assembly.id);
        if (typeof rhsVal !== "number" || !Number.isFinite(rhsVal)) continue;

        const expandedLhs = exprAliases.get(lhsText) ?? lhsText;
        const mentionsClearanceOrContributors =
          /clearance|gap|play|margin/i.test(lhsText) ||
          parseLinearExpression(expandedLhs).terms.some((t) => contributors.has(t.varName));
        if (!mentionsClearanceOrContributors) continue;

        if (opStr === ">=" || opStr === ">") {
          minClearance = minClearance !== undefined ? Math.max(minClearance, rhsVal) : rhsVal;
          if (expandedLhs !== lhsText || expandedLhs.includes("-") || expandedLhs.includes("+")) {
            linearClearanceExpr = expandedLhs;
          }
          triggerSym = cSym;
        } else if (opStr === "<=" || opStr === "<") {
          maxClearance = Math.min(maxClearance, rhsVal);
          if (expandedLhs !== lhsText || expandedLhs.includes("-") || expandedLhs.includes("+")) {
            linearClearanceExpr = expandedLhs;
          }
          triggerSym = cSym;
        }
      }
    }

    if (minClearance === undefined && maxClearance === Infinity) continue;

    // Build ToleranceChainSpec contributors
    const uniqueContribs: Array<{
      partId: string;
      featureName: string;
      nominal: number;
      tolerance: number;
      direction: 1 | -1;
      cpk?: number | undefined;
    }> = [];
    let chainMethod: "worst_case" | "rss" | "six_sigma" = "worst_case";

    if (linearClearanceExpr) {
      const parsed = parseLinearExpression(linearClearanceExpr);
      for (const term of parsed.terms) {
        const c = contributors.get(term.varName) ?? contributors.get(term.varName.split(".").pop() || "");
        if (!c) continue;
        if (c.method) chainMethod = c.method;
        uniqueContribs.push({
          partId: c.partId,
          featureName: c.featureName,
          nominal: c.effectiveNominal * Math.abs(term.coeff),
          tolerance: c.halfTolerance * Math.abs(term.coeff),
          direction: term.coeff < 0 ? -1 : 1,
          cpk: c.cpk,
        });
      }
    }

    if (uniqueContribs.length === 0) {
      const seenKeys = new Set<string>();
      const rawList: ExtractedTolContributor[] = [];
      for (const c of contributors.values()) {
        if (seenKeys.has(c.key)) continue;
        seenKeys.add(c.key);
        rawList.push(c);
        if (c.method) chainMethod = c.method;
      }

      if (rawList.every((c) => c.explicitDirection !== undefined)) {
        for (const c of rawList) {
          uniqueContribs.push({
            partId: c.partId,
            featureName: c.featureName,
            nominal: c.effectiveNominal,
            tolerance: c.halfTolerance,
            direction: c.explicitDirection!,
            cpk: c.cpk,
          });
        }
      } else if (rawList.length === 2) {
        // Pair of mated parts (e.g., hole/housing - shaft/pin): larger nominal is +1, smaller is -1
        const sorted = [...rawList].sort((a, b) => b.effectiveNominal - a.effectiveNominal);
        uniqueContribs.push({
          partId: sorted[0]!.partId,
          featureName: sorted[0]!.featureName,
          nominal: sorted[0]!.effectiveNominal,
          tolerance: sorted[0]!.halfTolerance,
          direction: 1,
          cpk: sorted[0]!.cpk,
        });
        uniqueContribs.push({
          partId: sorted[1]!.partId,
          featureName: sorted[1]!.featureName,
          nominal: sorted[1]!.effectiveNominal,
          tolerance: sorted[1]!.halfTolerance,
          direction: -1,
          cpk: sorted[1]!.cpk,
        });
      }
    }

    if (uniqueContribs.length === 0) continue;

    const chainId = assembly.name || `chain_${assembly.id}`;
    const chainSpec: ToleranceChainSpec = {
      chainId,
      name: chainId,
      targetClearance: {
        min: minClearance ?? -Infinity,
        max: maxClearance,
      },
      contributors: uniqueContribs,
      method: chainMethod,
    };

    const oracle = new ToleranceStackOracle();
    oracle.assertLiteral({
      id: 1,
      predicate: "toleranceChain",
      args: [chainSpec],
      isNegated: false,
    });

    const calcRes = oracle.calculateChain(chainSpec);
    const rssRes = oracle.calculateChain({ ...chainSpec, method: "rss" });
    const sat = oracle.checkSat();

    if (!sat.isSat || !calcRes.isSatisfied) {
      const detail = `worst-case min clearance ${calcRes.minClearance.toFixed(4)} < ${(minClearance ?? 0).toFixed(
        4,
      )} (RSS min: ${rssRes.minClearance.toFixed(4)}, nominal: ${calcRes.nominalClearance.toFixed(4)} ± ${calcRes.variation.toFixed(4)})`;
      diagnostics.push(
        makeFormalDiag(
          db,
          assembly,
          SysML2ErrorCode.MECHANICAL_TOLERANCE_STACK_INTERFERENCE,
          [chainId, detail],
          "ToleranceStackOracle",
          triggerSym && triggerSym.parentId === assembly.id ? triggerSym : null,
          { worstCase: calcRes, rss: rssRes },
        ),
      );
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// S7005: Relational 2-Safety Hyperproperties (Non-Interference & Lipschitz)
// ---------------------------------------------------------------------------

function cstExprToNonlinearAst(node: SysmlCstNode | null | undefined): ExprNode | null {
  if (!node) return null;
  switch (node.type) {
    case "LiteralInteger":
    case "DECIMAL_VALUE":
    case "LiteralReal":
    case "RealValue": {
      const v = Number.parseFloat(node.text.trim());
      return Number.isFinite(v) ? { kind: "const", value: v } : null;
    }
    case "MeasurementExpression": {
      const vNode = node.childForFieldName?.("value") ?? getCstChildren(node)[0];
      return cstExprToNonlinearAst(vNode);
    }
    case "UnaryExpression": {
      const op = node.childForFieldName?.("operator")?.text?.trim();
      const inner = cstExprToNonlinearAst(node.childForFieldName?.("operand") ?? getCstChildren(node)[1]);
      if (!inner) return null;
      if (op === "-")
        return inner.kind === "const" ? { kind: "const", value: -inner.value } : { kind: "neg", child: inner };
      if (op === "+") return inner;
      return null;
    }
    case "AdditiveExpression":
    case "MultiplicativeExpression": {
      const operands = node.childrenForFieldName?.("operand") ?? [];
      const ops = (node.childrenForFieldName?.("operator") ?? []).map((o) => o.text.trim());
      if (operands.length < 2 || ops.length < operands.length - 1) {
        return operands[0] ? cstExprToNonlinearAst(operands[0]) : null;
      }
      let acc = cstExprToNonlinearAst(operands[0]!);
      if (!acc) return null;
      for (let i = 0; i < ops.length; i++) {
        const rhs = cstExprToNonlinearAst(operands[i + 1]!);
        if (!rhs) return null;
        const op = ops[i]!;
        if (op === "+") acc = { kind: "add", left: acc, right: rhs };
        else if (op === "-") acc = { kind: "sub", left: acc, right: rhs };
        else if (op === "*") acc = { kind: "mul", left: acc, right: rhs };
        else if (op === "/") acc = { kind: "div", left: acc, right: rhs };
        else return null;
      }
      return acc;
    }
    case "ExponentiationExpression": {
      const base = cstExprToNonlinearAst(node.childForFieldName?.("base") ?? getCstChildren(node)[0]);
      const exp = cstExprToNonlinearAst(node.childForFieldName?.("exponent") ?? getCstChildren(node)[2]);
      if (base && exp?.kind === "const" && exp.value === 2) {
        return { kind: "sqr", child: base };
      }
      return null;
    }
    case "InvocationExpression": {
      const fnName = normalizeTypeName(
        (node.childForFieldName?.("type") ?? getCstChildren(node)[0])?.text ?? "",
      ).toLowerCase();
      const argMember = findFirstDescendant(node, "ArgumentMember");
      const argOwned = argMember ? findFirstDescendant(argMember, "OwnedExpression") : null;
      const argAst = cstExprToNonlinearAst(argOwned);
      if (!argAst) return null;
      if (fnName === "sin") return { kind: "sin", child: argAst };
      if (fnName === "cos") return { kind: "cos", child: argAst };
      if (fnName === "sqrt") return { kind: "sqrt", child: argAst };
      if (fnName === "sqr") return { kind: "sqr", child: argAst };
      return null;
    }
    case "FeatureReferenceExpression":
    case "PrimaryExpression": {
      const parenInner = node.childForFieldName?.("operand");
      if (parenInner) return cstExprToNonlinearAst(parenInner);
      const name = node.text.trim();
      return name && !name.includes("(") ? { kind: "var", name } : null;
    }
    default: {
      const chs = getCstChildren(node);
      if (chs.length === 1) return cstExprToNonlinearAst(chs[0]!);
      for (const ch of chs) {
        if (ch.type === "(" || ch.text === "(" || ch.type === ")" || ch.text === ")") continue;
        if (ch.type.includes("Expression") || ch.type.includes("Literal") || ch.type === "SequenceExpression") {
          return cstExprToNonlinearAst(ch);
        }
      }
      return null;
    }
  }
}

/**
 * S7005: Verifies 2-Safety Non-Interference (`@NonInterference`, `@untrusted` -> `@highIntegrity`)
 * and Lipschitz Continuity (`@Lipschitz { maxGain = K }`) via `RelationalVerifier`.
 */
export function verifyRelationalHyperproperties(
  db: QueryDB,
  options?: SysML2FormalVerifyOptions,
): SysML2FormalDiagnostic[] {
  const diagnostics: SysML2FormalDiagnostic[] = [];
  const verifier = new RelationalVerifier();

  for (const entry of db.allEntries()) {
    if (
      entry.ruleName !== "CalculationDefinition" &&
      entry.ruleName !== "CalculationUsage" &&
      entry.ruleName !== "ActionDefinition" &&
      entry.ruleName !== "ActionUsage"
    ) {
      continue;
    }
    if (!isInRequestedScope(db, entry, options)) continue;

    const { node: cst } = getCstFast(db, entry);
    if (!cst) continue;

    const metas = extractSymbolMetadataAnnotations(db, entry);
    const nonInterfMeta = metas.find((m) => {
      const low = m.shortName.toLowerCase();
      return low === "noninterference" || low === "informationflow" || low === "observationaldeterminism";
    });
    const lipschitzMeta = metas.find((m) => {
      const low = m.shortName.toLowerCase();
      return low === "lipschitz" || low === "maxgain" || low === "gainbound";
    });
    const robustnessMeta = metas.find((m) => m.shortName.toLowerCase() === "robustness");

    const children = db.childrenOf(entry.id);
    const inPins: SymbolEntry[] = [];
    const outPins: SymbolEntry[] = [];
    const untrustedInputs: string[] = [];
    const publicInputs: string[] = [];
    const highIntegrityOutputs: string[] = [];

    for (const ch of children) {
      if (ch.kind !== "Usage") continue;
      const chLeaves = getLeavesFast(db, ch);
      const firstKw = chLeaves[0]?.text;
      const chCst = db.cstNode(ch.id) as SysmlCstNode | null | undefined;
      const lookback =
        ch.startOffset > entry.startOffset
          ? (db.cstText(Math.max(entry.startOffset, ch.startOffset - 20), ch.startOffset, entry) || "").trim()
          : "";
      const lookbackLastTok = lookback.split(/\s+/).pop() ?? "";
      let leafDir: string | undefined;
      for (const lf of chLeaves) {
        if (lf.text === ":" || lf.text === "=" || lf.text === ":=" || lf.text === "{" || lf.text === ";") break;
        if (ch.name && lf.text === ch.name) break;
        if (lf.text === "in" || lf.text === "out" || lf.text === "inout") {
          leafDir = lf.text;
          break;
        }
      }
      const dir =
        metaStr(ch, "direction") ??
        leafDir ??
        (lookbackLastTok === "in" || lookbackLastTok === "out" || lookbackLastTok === "inout"
          ? lookbackLastTok
          : undefined);
      const chMetas = extractSymbolMetadataAnnotations(db, ch);
      const isUntrusted = chMetas.some((m) => {
        const low = m.shortName.toLowerCase();
        return (
          low === "untrusted" || low === "secret" || low === "lowintegrity" || low === "high" || low === "classified"
        );
      });
      const isHighIntegrity = chMetas.some((m) => {
        const low = m.shortName.toLowerCase();
        return low === "highintegrity" || low === "public" || low === "safetycritical" || low === "trusted";
      });

      const isReturn =
        chCst?.parent?.type === "ReturnParameterMember" ||
        ch.name === "return" ||
        firstKw === "return" ||
        lookbackLastTok === "return";
      const isParam = chCst?.parent?.type === "ParameterMember";

      if (dir === "out" || isReturn) {
        outPins.push(ch);
        const outName = ch.name && ch.name !== ch.ruleName ? ch.name : "__result";
        if (isHighIntegrity || nonInterfMeta) {
          highIntegrityOutputs.push(outName);
        }
      } else if (dir === "in" || dir === "inout" || isParam) {
        inPins.push(ch);
        if (ch.name && ch.name !== ch.ruleName) {
          if (isUntrusted) untrustedInputs.push(ch.name);
          else publicInputs.push(ch.name);
        }
      }
    }

    const hasSecurityFlowPins =
      untrustedInputs.length > 0 && (highIntegrityOutputs.length > 0 || nonInterfMeta !== undefined);
    if (!nonInterfMeta && !hasSecurityFlowPins && !lipschitzMeta && !robustnessMeta) {
      continue;
    }

    // Extract transfer equations `outVar - rhsAst == 0` and CST expression nodes for concrete witness fallback
    const transferConstraints: NonlinearConstraint[] = [];
    const outputExprNodes = new Map<string, SysmlCstNode>();

    // Check `ReturnParameterMember` value expression (`return y : Real = expr;` or `return : Real = expr;`)
    for (const op of outPins) {
      const outName = op.name && op.name !== op.ruleName ? op.name : "__result";
      const { node: opCst } = getCstFast(db, op);
      const fv = opCst ? findFirstDescendant(opCst, "FeatureValue") : null;
      const expr = fv
        ? findFirstDescendant(fv, "OwnedExpression")
        : opCst
          ? findFirstDescendant(opCst, "OwnedExpression")
          : null;
      if (expr) {
        outputExprNodes.set(outName, expr);
        const ast = cstExprToNonlinearAst(expr);
        if (ast) {
          transferConstraints.push({
            expr: { kind: "sub", left: { kind: "var", name: outName }, right: ast },
            rel: "==",
            rhs: 0,
          });
        }
      }
    }

    // Fallback: inspect `ReturnParameterMember` directly on `cst` if `ReturnParameterMember` wasn't in `outPins`
    if (outputExprNodes.size === 0) {
      const retMember = findFirstDescendant(cst, "ReturnParameterMember");
      if (retMember) {
        const fv = findFirstDescendant(retMember, "FeatureValue");
        const retExpr = fv
          ? findFirstDescendant(fv, "OwnedExpression")
          : findFirstDescendant(retMember, "OwnedExpression");
        const retNameNode = findFirstDescendant(retMember, "Name");
        const rawPinName = outPins[0]?.name && outPins[0].name !== outPins[0].ruleName ? outPins[0].name : undefined;
        const outName = rawPinName || retNameNode?.text?.trim() || "__result";
        if (retExpr) {
          outputExprNodes.set(outName, retExpr);
          if (highIntegrityOutputs.length === 0 && (nonInterfMeta || untrustedInputs.length > 0)) {
            highIntegrityOutputs.push(outName);
          }
          const ast = cstExprToNonlinearAst(retExpr);
          if (ast) {
            transferConstraints.push({
              expr: { kind: "sub", left: { kind: "var", name: outName }, right: ast },
              rel: "==",
              rhs: 0,
            });
          }
        }
      }
    }

    const pinOutName = (p: SymbolEntry | undefined): string =>
      p?.name && p.name !== p.ruleName && p.name !== "<anonymous>" ? p.name : "__result";

    // Check trailing `ResultExpressionMember` in calc body
    const resMember = findFirstDescendant(cst, "ResultExpressionMember");
    if (resMember) {
      const resExpr =
        resMember.childForFieldName?.("ownedRelatedElement") ?? findFirstDescendant(resMember, "OwnedExpression");
      const outName = pinOutName(outPins[0]);
      if (resExpr && !outputExprNodes.has(outName)) {
        outputExprNodes.set(outName, resExpr);
        if (highIntegrityOutputs.length === 0 && (nonInterfMeta || untrustedInputs.length > 0)) {
          highIntegrityOutputs.push(outName);
        }
        const ast = cstExprToNonlinearAst(resExpr);
        if (ast) {
          transferConstraints.push({
            expr: { kind: "sub", left: { kind: "var", name: outName }, right: ast },
            rel: "==",
            rhs: 0,
          });
        }
      }
    }

    // Check `AssignActionNode` statements (`assign outPin := expr;`)
    for (const ch of children) {
      if (ch.ruleName !== "AssignActionNode") continue;
      const { node: aCst } = getCstFast(db, ch);
      const tgt = aCst?.childForFieldName?.("targetFeature")?.text?.trim();
      const valNode = aCst?.childForFieldName?.("assignedValue");
      if (tgt && valNode) {
        outputExprNodes.set(tgt, valNode);
        const ast = cstExprToNonlinearAst(valNode);
        if (ast) {
          transferConstraints.push({
            expr: { kind: "sub", left: { kind: "var", name: tgt }, right: ast },
            rel: "==",
            rhs: 0,
          });
        }
      }
    }

    // 1. Non-Interference Check
    if ((nonInterfMeta || hasSecurityFlowPins) && untrustedInputs.length > 0 && highIntegrityOutputs.length > 0) {
      let violatedOut: string | null = null;
      let witnessDetail = "";

      if (transferConstraints.length > 0) {
        const niRes = verifier.verifyObservationalDeterminism(publicInputs, highIntegrityOutputs, transferConstraints);
        if (niRes.status === "VIOLATED") {
          violatedOut = highIntegrityOutputs[0]!;
        }
      }

      // Concrete 2-trace witness evaluation (handles conditional branching `if secret ? ...` as well as affine flows)
      for (const outName of highIntegrityOutputs) {
        const exprNode = outputExprNodes.get(outName);
        if (!exprNode) continue;
        const trace1 = new Map<string, EvalResult>();
        const trace2 = new Map<string, EvalResult>();
        for (const pub of publicInputs) {
          trace1.set(pub, 2);
          trace2.set(pub, 2);
        }
        for (const unt of untrustedInputs) {
          trace1.set(unt, 1);
          trace2.set(unt, 11);
        }
        const y1 = evaluateExpressionNode(db, exprNode as unknown as CSTNode, entry.id, trace1);
        const y2 = evaluateExpressionNode(db, exprNode as unknown as CSTNode, entry.id, trace2);
        if (y1 !== undefined && y2 !== undefined && y1 !== y2) {
          violatedOut = outName;
          witnessDetail = `untrusted input '${untrustedInputs[0]}' leaks into '${outName}' (trace1: ${untrustedInputs[0]}=1 -> ${outName}=${String(y1)}; trace2: ${untrustedInputs[0]}=11 -> ${outName}=${String(y2)})`;
          break;
        }
      }

      if (violatedOut) {
        if (!witnessDetail) {
          witnessDetail = `untrusted input '${untrustedInputs.join(", ")}' interferes with high-integrity output '${violatedOut}'`;
        }
        diagnostics.push(
          makeFormalDiag(
            db,
            entry,
            SysML2ErrorCode.RELATIONAL_HYPERPROPERTY_VIOLATION,
            [entry.name || entry.ruleName, witnessDetail],
            "RelationalVerifier",
            null,
            { property: "NON_INTERFERENCE", untrustedInputs, highIntegrityOutputs },
          ),
        );
      }
    }

    // 2. Lipschitz Gain / Noise Robustness Check
    const defaultOutVar = Array.from(outputExprNodes.keys())[0] ?? pinOutName(outPins[0]);
    if (lipschitzMeta && inPins.length > 0 && (transferConstraints.length > 0 || outputExprNodes.size > 0)) {
      const maxGain = getNumericField(lipschitzMeta.fields, ["maxGain", "L", "gain", "constant", "bound"]);
      const minIn = getNumericField(lipschitzMeta.fields, ["min", "inputMin"]) ?? -50;
      const maxIn = getNumericField(lipschitzMeta.fields, ["max", "inputMax"]) ?? 50;
      const inVar = getStringField(lipschitzMeta.fields, ["input", "inVar"]) ?? inPins[0]!.name;
      const outVar = getStringField(lipschitzMeta.fields, ["output", "outVar"]) ?? defaultOutVar;

      if (maxGain !== undefined && inVar) {
        let violatedTrace: { x1: number; y1: number; x2: number; y2: number; obsGain: number } | null = null;

        if (transferConstraints.length > 0) {
          const lipRes = verifier.verifyLipschitz(inVar, outVar, transferConstraints, maxGain, {
            min: minIn,
            max: maxIn,
          });
          if (lipRes.status === "VIOLATED") {
            const cex = lipRes.counterexample;
            const x1 = cex?.trace1.get(inVar) ?? 0;
            const y1 = cex?.trace1.get(outVar) ?? 0;
            const x2 = cex?.trace2.get(inVar) ?? 1;
            const y2 = cex?.trace2.get(outVar) ?? 0;
            const obsGain = Math.abs(y1 - y2) / Math.max(1e-6, Math.abs(x1 - x2));
            violatedTrace = { x1, y1, x2, y2, obsGain };
          }
        }

        if (!violatedTrace) {
          const exprNode = outputExprNodes.get(outVar);
          if (exprNode && maxIn > minIn) {
            const mid = 0.5 * (minIn + maxIn);
            const q1 = minIn + 0.25 * (maxIn - minIn);
            const q3 = minIn + 0.75 * (maxIn - minIn);
            const samplePts = [minIn, q1, mid, q3, maxIn];
            const evalAt = (xVal: number): number | null => {
              const b = new Map<string, EvalResult>();
              for (const p of inPins) {
                if (p.name && p.name !== p.ruleName) b.set(p.name, 0);
              }
              b.set(inVar, xVal);
              const r = evaluateExpressionNode(db, exprNode as unknown as CSTNode, entry.id, b);
              return typeof r === "number" && Number.isFinite(r) ? r : null;
            };
            const vals = samplePts
              .map((x) => ({ x, y: evalAt(x) }))
              .filter((pt): pt is { x: number; y: number } => pt.y !== null);
            for (let i = 0; i < vals.length && !violatedTrace; i++) {
              for (let j = i + 1; j < vals.length; j++) {
                const dx = Math.abs(vals[j]!.x - vals[i]!.x);
                if (dx < 1e-6) continue;
                const dy = Math.abs(vals[j]!.y - vals[i]!.y);
                const gain = dy / dx;
                if (gain > maxGain + 1e-6) {
                  violatedTrace = {
                    x1: vals[i]!.x,
                    y1: vals[i]!.y,
                    x2: vals[j]!.x,
                    y2: vals[j]!.y,
                    obsGain: gain,
                  };
                  break;
                }
              }
            }
          }
        }

        if (violatedTrace) {
          const { x1, y1, x2, y2, obsGain } = violatedTrace;
          const detail = `Lipschitz gain ${obsGain.toFixed(3)} > maxGain ${maxGain} (trace1: ${inVar}=${x1.toFixed(2)}, ${outVar}=${y1.toFixed(2)}; trace2: ${inVar}=${x2.toFixed(2)}, ${outVar}=${y2.toFixed(2)})`;
          diagnostics.push(
            makeFormalDiag(
              db,
              entry,
              SysML2ErrorCode.RELATIONAL_HYPERPROPERTY_VIOLATION,
              [entry.name || entry.ruleName, detail],
              "RelationalVerifier",
              null,
              { property: "LIPSCHITZ_CONTINUITY", maxGain, observedGain: obsGain },
            ),
          );
        }
      }
    } else if (robustnessMeta && inPins.length > 0 && (transferConstraints.length > 0 || outputExprNodes.size > 0)) {
      const delta = getNumericField(robustnessMeta.fields, ["delta", "inputNoise"]);
      const epsilon = getNumericField(robustnessMeta.fields, ["epsilon", "maxDeviation", "outputBound"]);
      const inVar = inPins[0]!.name;
      const outVar = defaultOutVar;
      if (delta !== undefined && epsilon !== undefined && inVar) {
        let robSummary: string | null = null;
        if (transferConstraints.length > 0) {
          const robRes = verifier.verifyNoiseRobustness(inVar, outVar, transferConstraints, delta, epsilon);
          if (robRes.status === "VIOLATED") {
            robSummary = robRes.summary;
          }
        }
        if (!robSummary) {
          const exprNode = outputExprNodes.get(outVar);
          if (exprNode && delta > 0) {
            const b1 = new Map<string, EvalResult>([[inVar, 0]]);
            const b2 = new Map<string, EvalResult>([[inVar, delta]]);
            const y1 = evaluateExpressionNode(db, exprNode as unknown as CSTNode, entry.id, b1);
            const y2 = evaluateExpressionNode(db, exprNode as unknown as CSTNode, entry.id, b2);
            if (typeof y1 === "number" && typeof y2 === "number" && Math.abs(y2 - y1) > epsilon + 1e-6) {
              robSummary = `output deviation |${y2.toFixed(3)} - ${y1.toFixed(3)}| = ${Math.abs(y2 - y1).toFixed(3)} > epsilon ${epsilon} for |d_${inVar}| = ${delta}`;
            }
          }
        }
        if (robSummary) {
          diagnostics.push(
            makeFormalDiag(
              db,
              entry,
              SysML2ErrorCode.RELATIONAL_HYPERPROPERTY_VIOLATION,
              [entry.name || entry.ruleName, robSummary],
              "RelationalVerifier",
              null,
              { property: "NOISE_ROBUSTNESS", delta, epsilon },
            ),
          );
        }
      }
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// S7006: Continuous DAE Flowpipe & SOS Barrier Safety Verification
// ---------------------------------------------------------------------------

/**
 * S7006: Lowers continuous `der(...)` dynamics via `SysML2DaeLowerer`, checks DAE singularities
 * via `DaeIntervalEvaluator`, screens quadratic Lyapunov/barrier certificates via `SosBarrierSynthesizer`,
 * and verifies bounded continuous reachability via `HybridFlowpipeSolver` (Taylor Models).
 */
export function verifyContinuousFlowpipeAndBarrier(
  db: QueryDB,
  options?: SysML2FormalVerifyOptions,
): SysML2FormalDiagnostic[] {
  const diagnostics: SysML2FormalDiagnostic[] = [];

  for (const modelSym of db.allEntries()) {
    if (modelSym.ruleName !== "PartDefinition" && modelSym.ruleName !== "StateDefinition") continue;
    if (!isInRequestedScope(db, modelSym, options)) continue;

    const leaves = getLeavesFast(db, modelSym);
    const hasDerCall = leaves.some((lf, idx) => lf.text === "der" && leaves[idx + 1]?.text === "(");
    if (!hasDerCall) continue;

    const children = db.childrenOf(modelSym.id);
    const modelName = modelSym.name || modelSym.ruleName;

    // 1. Collect initial state bindings and parameter constants on `modelSym`
    const initialValues = new Map<string, number>();
    for (const ch of children) {
      if (ch.ruleName !== "AttributeUsage" || !ch.name) continue;
      const val = getFeatureValue(db, ch, modelSym.id);
      if (typeof val === "number" && Number.isFinite(val)) {
        initialValues.set(ch.name, val);
      }
    }

    // 2. Build clean standalone `part def` source with attributes + `der(...)` equations for `SysML2DaeLowerer`
    const derEquations: string[] = [];
    const safetyBounds: Array<{ varName: string; operator: "<=" | ">="; limit: number; sourceSym: SymbolEntry }> = [];

    const collectBoundsAndDerFromConstraint = (cSym: SymbolEntry, stripAliases: ReadonlySet<string>) => {
      const { node: cCst } = getCstFast(db, cSym);
      if (!cCst) return;

      for (const eqNode of findCstDescendants(cCst, "EqualityExpression")) {
        if (eqNode.text.includes("der(")) {
          derEquations.push(collapseWhitespace(eqNode.text));
        }
      }
      for (const relNode of findCstDescendants(cCst, "RelationalExpression")) {
        if (relNode.text.includes("der(")) continue;
        const ops = relNode.childrenForFieldName?.("operand") ?? [];
        const opTok = relNode.childrenForFieldName?.("operator")?.[0]?.text?.trim() ?? "";
        if (ops.length < 2 || !opTok) continue;
        let varName = ops[0]!.text.trim();
        const dotIdx = varName.indexOf(".");
        if (dotIdx > 0 && stripAliases.has(varName.slice(0, dotIdx))) {
          varName = varName.slice(dotIdx + 1);
        }
        const rhsVal = evaluateExpressionNode(db, ops[1]! as unknown as CSTNode, modelSym.id);
        if (isSysmlIdentLeaf(varName) && typeof rhsVal === "number" && Number.isFinite(rhsVal)) {
          if (opTok === "<=" || opTok === "<") {
            safetyBounds.push({ varName, operator: "<=", limit: rhsVal, sourceSym: cSym });
          } else if (opTok === ">=" || opTok === ">") {
            safetyBounds.push({ varName, operator: ">=", limit: rhsVal, sourceSym: cSym });
          }
        }
      }
    };

    for (const ch of children) {
      if (
        ch.ruleName === "ConstraintUsage" ||
        ch.ruleName === "AssertConstraintUsage" ||
        ch.ruleName === "RequirementConstraintUsage"
      ) {
        collectBoundsAndDerFromConstraint(ch, new Set([modelName]));
      } else if (ch.ruleName === "SatisfyRequirementUsage") {
        const reqName = getRelationshipTargetName(db, ch);
        const rSym = reqName
          ? db.byName(reqName).find((s) => s.ruleName === "RequirementDefinition" || s.ruleName === "RequirementUsage")
          : null;
        if (rSym) {
          const aliases = new Set<string>([modelName]);
          for (const sub of db.childrenOf(rSym.id)) {
            if (sub.ruleName === "SubjectUsage" && sub.name) aliases.add(sub.name);
          }
          for (const rc of db.childrenOf(rSym.id)) {
            if (rc.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, rc) === "require") {
              collectBoundsAndDerFromConstraint(rc, aliases);
            }
          }
        }
      }
    }

    if (derEquations.length === 0) continue;

    // Synthesize minimal SysML v2 DAE block for arena lowering
    const attrLines: string[] = [];
    const emittedAttrs = new Set<string>();
    for (const [k, v] of initialValues) {
      emittedAttrs.add(k);
      attrLines.push(`  attribute ${k} : Real = ${v};`);
    }
    for (const b of safetyBounds) {
      if (!emittedAttrs.has(b.varName)) {
        emittedAttrs.add(b.varName);
        attrLines.push(`  attribute ${b.varName} : Real = 0.0;`);
      }
    }
    const eqLines = derEquations.map((eq, idx) => `  constraint eq_${idx} { ${eq} }`);
    const synthSource = `part def ${modelName} {\n${attrLines.join("\n")}\n${eqLines.join("\n")}\n}`;

    let lowered: ReturnType<typeof SysML2DaeLowerer.lowerCst>;
    try {
      lowered = SysML2DaeLowerer.lowerCst(synthSource);
    } catch {
      continue;
    }

    // Step A: Check continuous DAE domain singularities via DaeIntervalEvaluator
    const daeEval = new DaeIntervalEvaluator(lowered.arena);
    const daeCheck = daeEval.evaluateAllEquations();
    const definiteIssue = daeCheck.issues.find((iss) => iss.severity === "definite");
    if (definiteIssue) {
      diagnostics.push(
        makeFormalDiag(
          db,
          modelSym,
          SysML2ErrorCode.CONTINUOUS_FLOWPIPE_OR_BARRIER_VIOLATION,
          [modelName, definiteIssue.message],
          "Flowpipe/SOS",
        ),
      );
      continue;
    }

    if (safetyBounds.length === 0) continue;

    // Step B: Extract explicit ODE vector field `der(x_i) = rhs_i` from lowered DAE arena
    const diffExprByState = new Map<string, number>();
    for (let eqIdx = 0; eqIdx < lowered.arena.eqCount; eqIdx++) {
      const lhs = lowered.arena.getEqLhs(eqIdx);
      const rhs = lowered.arena.getEqRhs(eqIdx);
      if (lowered.arena.getExprKind(lhs) === ExprKind.Der) {
        const inner = lowered.arena.getExprData1(lhs);
        if (lowered.arena.getExprKind(inner) === ExprKind.Name) {
          const vName = lowered.arena.interner.resolve(lowered.arena.getExprData1(inner)) || "";
          const short = vName.split("::").pop()!.split(".").pop()!;
          diffExprByState.set(short, rhs);
        }
      } else if (lowered.arena.getExprKind(rhs) === ExprKind.Der) {
        const inner = lowered.arena.getExprData1(rhs);
        if (lowered.arena.getExprKind(inner) === ExprKind.Name) {
          const vName = lowered.arena.interner.resolve(lowered.arena.getExprData1(inner)) || "";
          const short = vName.split("::").pop()!.split(".").pop()!;
          diffExprByState.set(short, lhs);
        }
      }
    }

    const stateNames = Array.from(diffExprByState.keys());
    if (stateNames.length === 0) continue;

    const stateIdxMap = new Map<string, number>();
    stateNames.forEach((sn, idx) => stateIdxMap.set(sn, idx));

    const flowpipeReqs: FlowpipeRequirement[] = [];
    for (const sb of safetyBounds) {
      const sIdx = stateIdxMap.get(sb.varName);
      if (sIdx !== undefined) {
        flowpipeReqs.push({
          stateIndex: sIdx,
          stateName: sb.varName,
          operator: sb.operator,
          limitValue: sb.limit,
        });
      }
    }
    if (flowpipeReqs.length === 0) continue;

    // Screen quadratic barrier via SosBarrierSynthesizer
    const evalNumericRhs = (yVec: number[]): number[] => {
      const domain = new TaylorDomain(
        yVec.map((v) => new Interval(v, v)),
        1,
      );
      const env: ArenaEvalEnv<TaylorModel> = {
        variable: (varIdx) => {
          const vName = lowered.arena.getVarName(varIdx);
          const short = vName.split("::").pop()!.split(".").pop()!;
          const idx = stateIdxMap.get(short);
          if (idx !== undefined && idx < yVec.length) return domain.constant(yVec[idx]!);
          const cVal = initialValues.get(short);
          return domain.constant(cVal ?? 0);
        },
        derivative: () => domain.constant(0),
      };
      return stateNames.map((sn) => {
        const exprId = diffExprByState.get(sn)!;
        const r = evalArenaExpr<TaylorModel>(lowered.arena, exprId, env, domain);
        return (r.value.coeffs[0] ?? 0) + 0.5 * (r.value.remainder.lo + r.value.remainder.hi);
      });
    };

    const nominalInitial = stateNames.map((sn) => initialValues.get(sn) ?? 0);
    const initNorm = Math.max(0.1, Math.hypot(...nominalInitial));
    const maxLim = Math.max(initNorm + 1, ...flowpipeReqs.map((r) => Math.abs(r.limitValue)));
    const sosRes = SosBarrierSynthesizer.synthesizeQuadratic(
      { numVars: stateNames.length, f: evalNumericRhs, varNames: stateNames },
      { initialRadius: initNorm, unsafeRadius: maxLim, degree: 2 },
    );

    // Step C: Validated Taylor-Model Flowpipe Reachability via HybridFlowpipeSolver
    const metas = extractSymbolMetadataAnnotations(db, modelSym);
    const horizonMeta = metas.find((m) => {
      const low = m.shortName.toLowerCase();
      return low === "timehorizon" || low === "flowpipe" || low === "simulation";
    });
    const stopTime =
      getNumericField(horizonMeta?.fields ?? new Map(), ["stopTime", "horizon", "duration", "tMax"]) ?? 5.0;
    const dt = Math.min(0.05, Math.max(0.01, stopTime / 100));

    const mode: HybridMode = {
      id: modelName,
      name: modelName,
      dynamics: (_t: TaylorModel, y: TaylorModel[]) => {
        const domBoxes = y[0]!.domain;
        const ord = y[0]!.order ?? 2;
        const tDom = new TaylorDomain(domBoxes, ord);
        const env: ArenaEvalEnv<TaylorModel> = {
          variable: (varIdx) => {
            const vName = lowered.arena.getVarName(varIdx);
            const short = vName.split("::").pop()!.split(".").pop()!;
            const sIdx = stateIdxMap.get(short);
            if (sIdx !== undefined && y[sIdx]) return y[sIdx]!;
            const cVal = initialValues.get(short);
            return tDom.constant(cVal ?? 0);
          },
          derivative: () => tDom.constant(0),
        };
        return stateNames.map((sn) => {
          const exprId = diffExprByState.get(sn)!;
          return evalArenaExpr<TaylorModel>(lowered.arena, exprId, env, tDom).value;
        });
      },
    };

    const initialEnclosure = nominalInitial.map((v) => new Interval(v, v));
    const flowRes = HybridFlowpipeSolver.solve({
      automaton: { modes: [mode], transitions: [] },
      initialModeId: modelName,
      initialEnclosure,
      nominalInitial,
      tSpan: [0, stopTime],
      dt,
      order: 2,
      adaptive: true,
      tol: 1e-4,
      requirements: flowpipeReqs,
    });

    if (flowRes.violations.length > 0) {
      const v = flowRes.violations[0]!;
      const stName = stateNames[v.stateIndex] ?? `state_${v.stateIndex}`;
      const matchedBound = safetyBounds.find((b) => b.varName === stName);
      const barrierNote = sosRes.candidateFound ? "" : "; no stabilizing quadratic barrier exists";
      const detail = `state '${stName}' reaches ${v.worstCaseValue.toFixed(3)} at t=${v.time.toFixed(2)}s, violating '${stName} ${v.operator} ${v.limitValue}'${barrierNote}`;
      diagnostics.push(
        makeFormalDiag(
          db,
          modelSym,
          SysML2ErrorCode.CONTINUOUS_FLOWPIPE_OR_BARRIER_VIOLATION,
          [modelName, detail],
          "Flowpipe/SOS",
          matchedBound && matchedBound.sourceSym.parentId === modelSym.id ? matchedBound.sourceSym : null,
          { violation: v, sosCandidateFound: sosRes.candidateFound },
        ),
      );
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// S6031: High-Index Parametric DAE Structural Analysis (Pantelides / Pryce)
// ---------------------------------------------------------------------------

/**
 * S6031: Lowers coupled differential (`der(...)`) and algebraic constraint equations into
 * `DAEBuilder` via `SysML2DaeLowerer` and computes the structural differential index via
 * `computePryceSignatureMatrix` and `pantelidesIndexReductionArena`.
 */
export function verifyHighIndexParametricDae(
  db: QueryDB,
  options?: SysML2FormalVerifyOptions,
): SysML2FormalDiagnostic[] {
  const diagnostics: SysML2FormalDiagnostic[] = [];

  for (const modelSym of db.allEntries()) {
    const uri = modelSym.resourceId ?? modelSym.documentUri ?? "";
    if (uri === "sysml2://stdlib/KerML.sysml" || uri.startsWith("sysml2://stdlib")) continue;
    if (
      modelSym.ruleName !== "PartDefinition" &&
      modelSym.ruleName !== "PartUsage" &&
      modelSym.ruleName !== "ConstraintDefinition"
    ) {
      continue;
    }
    if (!isInRequestedScope(db, modelSym, options)) continue;

    const leaves = getLeavesFast(db, modelSym);
    const hasDerCall = leaves.some((lf, idx) => lf.text === "der" && leaves[idx + 1]?.text === "(");
    if (!hasDerCall) continue;

    const modelName = modelSym.name || modelSym.ruleName;
    const children = db.childrenOf(modelSym.id);

    interface CollectedDaeEquation {
      text: string;
      hasDer: boolean;
      sourceSym: SymbolEntry;
    }

    const collectedEqs: CollectedDaeEquation[] = [];
    const derStateNames = new Set<string>();
    const eqReferencedIdents = new Set<string>();

    const ingestEqualityExpr = (eqNode: SysmlCstNode, srcSym: SymbolEntry, baseOff: number) => {
      const ops = (eqNode.childrenForFieldName?.("operator") ?? []).map((o) => o.text.trim());
      if (ops.length > 0 && ops[0] !== "==" && ops[0] !== "===") return;
      const eqLeaves = collectCstLeaves(eqNode);
      if (!eqLeaves.some((l) => l.text === "==" || l.text === "===")) return;

      let hasDer = false;
      for (let i = 0; i < eqLeaves.length; i++) {
        const t = eqLeaves[i]!.text;
        if (t === "der" && eqLeaves[i + 1]?.text === "(" && isSysmlIdentLeaf(eqLeaves[i + 2]?.text)) {
          hasDer = true;
          derStateNames.add(eqLeaves[i + 2]!.text);
          eqReferencedIdents.add(eqLeaves[i + 2]!.text);
          i += 2;
        } else if (isSysmlIdentLeaf(t) && t !== "der" && eqLeaves[i + 1]?.text !== "(") {
          eqReferencedIdents.add(t);
        }
      }
      const nStart = eqNode.startIndex ?? eqNode.startOffset;
      const nEnd = eqNode.endIndex ?? eqNode.endOffset;
      const rawSlice =
        typeof nStart === "number" && typeof nEnd === "number" && nEnd > nStart
          ? db.cstText(baseOff + nStart, baseOff + nEnd, srcSym) || eqNode.text
          : eqNode.text;
      const normText = collapseWhitespace(rawSlice).replace(/===/g, "==");
      collectedEqs.push({ text: normText, hasDer, sourceSym: srcSym });
    };

    const childConstraintSpans: Array<{ start: number; end: number }> = [];
    for (const ch of children) {
      if (
        ch.ruleName !== "ConstraintUsage" &&
        ch.ruleName !== "AssertConstraintUsage" &&
        ch.ruleName !== "RequirementConstraintUsage"
      ) {
        continue;
      }
      childConstraintSpans.push({ start: ch.startOffset, end: ch.endOffset });
      const { node: cCst, baseOffset: cBase } = getCstFast(db, ch);
      if (!cCst) continue;
      for (const eqNode of findCstDescendants(cCst, "EqualityExpression")) {
        ingestEqualityExpr(eqNode, ch, cBase);
      }
    }

    if (modelSym.ruleName === "ConstraintDefinition") {
      const { node: mCst, baseOffset } = getCstFast(db, modelSym);
      if (mCst) {
        for (const eqNode of findCstDescendants(mCst, "EqualityExpression")) {
          const rStart = baseOffset + (eqNode.startIndex ?? eqNode.startOffset ?? 0);
          const rEnd = baseOffset + (eqNode.endIndex ?? eqNode.endOffset ?? 0);
          const insideChild = childConstraintSpans.some((sp) => rStart >= sp.start && rEnd <= sp.end);
          if (!insideChild) {
            ingestEqualityExpr(eqNode, modelSym, baseOffset);
          }
        }
      }
    }

    if (derStateNames.size === 0 || collectedEqs.length < 2) continue;
    if (!collectedEqs.some((e) => !e.hasDer)) continue;

    interface DeclVarSpec {
      name: string;
      isConstant: boolean;
      hasImmutableValue: boolean;
      value: number;
    }

    const declVars = new Map<string, DeclVarSpec>();
    for (const ch of children) {
      if (
        (ch.ruleName !== "AttributeUsage" &&
          ch.ruleName !== "ReferenceUsage" &&
          ch.ruleName !== "DefaultReferenceUsage") ||
        !ch.name
      ) {
        continue;
      }
      const cLeaves = getLeavesFast(db, ch);
      let isConst = metaStr(ch, "isConstant") === "true" || metaStr(ch, "direction") === "in";
      let hasEq = false;
      let hasColonEq = false;
      let hasDefault = false;
      for (const lf of cLeaves) {
        if (lf.text === "{" || lf.text === ";") break;
        if (lf.text === "constant" || lf.text === "in") isConst = true;
        if (lf.text === "default") hasDefault = true;
        if (lf.text === ":=") hasColonEq = true;
        if (lf.text === "=") hasEq = true;
      }
      const rawVal = getFeatureValue(db, ch, modelSym.id);
      const numVal = typeof rawVal === "number" && Number.isFinite(rawVal) ? rawVal : 0.0;
      declVars.set(ch.name, {
        name: ch.name,
        isConstant: isConst,
        hasImmutableValue: hasEq && !hasColonEq && !hasDefault,
        value: numVal,
      });
    }

    for (const refIdent of eqReferencedIdents) {
      if (!declVars.has(refIdent)) {
        declVars.set(refIdent, {
          name: refIdent,
          isConstant: false,
          hasImmutableValue: false,
          value: 0.0,
        });
      }
    }

    const unboundAlgVars = new Set<string>();
    const valuedNonConstCandidates: string[] = [];
    for (const [vName, spec] of declVars) {
      if (derStateNames.has(vName)) continue;
      if (!spec.isConstant && !spec.hasImmutableValue) {
        unboundAlgVars.add(vName);
      } else if (!spec.isConstant && spec.hasImmutableValue && eqReferencedIdents.has(vName)) {
        valuedNonConstCandidates.push(vName);
      }
    }

    // If total equations exceed (states + unbound algebraic vars), promote non-constant valued variables to algebraic unknowns
    let deficit = collectedEqs.length - (derStateNames.size + unboundAlgVars.size);
    for (let i = valuedNonConstCandidates.length - 1; i >= 0 && deficit > 0; i--) {
      unboundAlgVars.add(valuedNonConstCandidates[i]!);
      deficit--;
    }

    const attrLines: string[] = [];
    for (const [vName, spec] of declVars) {
      if (derStateNames.has(vName)) {
        attrLines.push(`  attribute ${vName} : Real = ${spec.value};`);
      } else if (unboundAlgVars.has(vName)) {
        attrLines.push(`  attribute ${vName} : Real;`);
      } else {
        attrLines.push(`  attribute ${vName} : Real = ${spec.value};`);
      }
    }

    const safeCompName = isSysmlIdentLeaf(modelName) ? modelName : "HighIndexModel";
    const eqLines = collectedEqs.map((eq, idx) => `  constraint eq_${idx} { ${eq.text} }`);
    const synthSource = `part def ${safeCompName} {\n${attrLines.join("\n")}\n${eqLines.join("\n")}\n}`;

    let lowered: ReturnType<typeof SysML2DaeLowerer.lowerCst>;
    try {
      lowered = SysML2DaeLowerer.lowerCst(synthSource);
    } catch {
      continue;
    }

    const stateVars = new Set<number>();
    const derivativeVars = new Set<number>();
    const parameters = new Set<number>();

    for (let v = 0; v < lowered.arena.varCount; v++) {
      if (lowered.arena.isVarRemoved(v)) continue;
      const full = lowered.arena.getVarName(v);
      const short = full.split("::").pop()!.split(".").pop()!;
      if (derStateNames.has(short)) {
        stateVars.add(v);
      } else if (full.startsWith("der(") && full.endsWith(")")) {
        derivativeVars.add(v);
      } else {
        const variability = lowered.arena.getVarVariability(v);
        if (variability === Variability.Parameter || variability === Variability.Constant) {
          parameters.add(v);
        }
      }
    }

    const pryceSig = computePryceSignatureMatrix(lowered.arena, stateVars, derivativeVars, parameters);
    const pantRes = pantelidesIndexReductionArena(lowered.arena, stateVars, derivativeVars, parameters);

    const hasIndexReduction = pantRes.dummyDerivatives.size > 0 || pantRes.generatedEquations.length > 0;
    const effectiveIndex = Math.max(pryceSig.structuralIndex, pantRes.structuralIndex ?? 1, hasIndexReduction ? 2 : 1);

    if (effectiveIndex > 1) {
      const diffEqIndices: number[] = [];
      for (let i = 0; i < collectedEqs.length && i < lowered.arena.eqCount; i++) {
        const cOffset = pantRes.pryceOffsets?.c.get(i) ?? 0;
        const selectedDummy = pantRes.stateSelectionMap?.has(i) ?? false;
        const isAlg =
          !collectedEqs[i]!.hasDer &&
          !containsDerivative(lowered.arena, lowered.arena.getEqLhs(i)) &&
          !containsDerivative(lowered.arena, lowered.arena.getEqRhs(i));
        if (cOffset > 0 || selectedDummy || isAlg) {
          diffEqIndices.push(i);
        }
      }

      const rawDiffEqs =
        diffEqIndices.length > 0
          ? diffEqIndices.map((idx) => collectedEqs[idx]!)
          : collectedEqs.filter((e) => !e.hasDer);
      const algOnly = rawDiffEqs.filter((e) => !e.hasDer);
      const diffEqs = algOnly.length > 0 ? algOnly : rawDiffEqs;
      const diffTexts = diffEqs.map((e) => {
        const sName = e.sourceSym.name;
        if (sName && sName !== "<anonymous>" && sName !== e.sourceSym.ruleName && e.sourceSym.id !== modelSym.id) {
          return `${sName}: ${e.text}`;
        }
        return e.text;
      });
      const dummyNames = Array.from(pantRes.dummyDerivatives).map((v) => lowered.arena.getVarName(v));
      const targetSym =
        diffEqs[0] && diffEqs[0].sourceSym.id !== modelSym.id && diffEqs[0].sourceSym.parentId === modelSym.id
          ? diffEqs[0].sourceSym
          : null;

      const dummyNote = dummyNames.length > 0 ? `; dummy derivative state(s): ${dummyNames.join(", ")}` : "";
      const detail = `algebraic constraint '${diffTexts.join("; ")}' requires Pantelides index reduction (${pantRes.generatedEquations.length} differentiated equation(s)${dummyNote})`;

      diagnostics.push(
        makeFormalDiag(
          db,
          modelSym,
          SysML2ErrorCode.HIGH_INDEX_PARAMETRIC_CONSTRAINT,
          [modelName, effectiveIndex, detail],
          "Pantelides/Pryce",
          targetSym,
          {
            structuralIndex: effectiveIndex,
            differentiatedConstraints: diffTexts,
            dummyDerivatives: dummyNames,
            generatedEquationCount: pantRes.generatedEquations.length,
          },
        ),
      );
    }
  }

  return diagnostics;
}

/**
 * S6042 (Formal Verification Wrapper): Evaluates 3D RCC-8 spatial envelope clashes,
 * enclosure protrusions, and `@MaxLength` wire span violations across `db`.
 */
export function verifySpatialEnvelopesFormal(
  db: QueryDB,
  options?: SysML2FormalVerifyOptions,
): SysML2FormalDiagnostic[] {
  const diagnostics: SysML2FormalDiagnostic[] = [];
  for (const entry of db.allEntries()) {
    const uri = entry.resourceId ?? entry.documentUri ?? "";
    if (uri === "sysml2://stdlib/KerML.sysml" || uri.startsWith("sysml2://stdlib")) continue;
    if (entry.ruleName !== "PartDefinition" && entry.ruleName !== "PartUsage" && entry.ruleName !== "ConnectionUsage") {
      continue;
    }
    if (!isInRequestedScope(db, entry, options)) continue;
    const raw = checkSpatialEnvelopes(db, entry);
    if (!raw) continue;
    const list = Array.isArray(raw) ? raw : [raw];
    for (const d of list) {
      const startOffset = d.startOffset ?? entry.startOffset;
      const endOffset = d.endOffset ?? Math.min(entry.endOffset, startOffset + Math.max(1, entry.name.length || 8));
      diagnostics.push({
        code: d.code ?? SysML2ErrorCode.SPATIAL_ENVELOPE_CLASH_OR_PROTRUSION.code,
        rule: SysML2ErrorCode.SPATIAL_ENVELOPE_CLASH_OR_PROTRUSION.rule,
        severity: SysML2ErrorCode.SPATIAL_ENVELOPE_CLASH_OR_PROTRUSION.severity,
        message: d.message,
        symbolId: entry.id,
        symbolName: entry.name || entry.ruleName,
        resourceId: entry.resourceId ?? entry.documentUri,
        startOffset,
        endOffset,
        engine: "Spatial/RCC8",
      });
    }
  }
  return diagnostics;
}

// ---------------------------------------------------------------------------
// Unified Deep Formal Verification Entry Points
// ---------------------------------------------------------------------------

/**
 * Synchronously executes all deep formal verification passes (`S6031`, `S7001`–`S7006`) over `db`.
 */
export function verifySysML2FormalSync(db: QueryDB, options?: SysML2FormalVerifyOptions): SysML2FormalDiagnostic[] {
  return [
    ...verifyHighIndexParametricDae(db, options),
    ...verifyHierarchicalPdrUnsafeState(db, options),
    ...verifyAsilSinglePointOfFailure(db, options),
    ...verifyProbabilisticRequirements(db, options),
    ...verifyMechanicalToleranceStacks(db, options),
    ...verifyRelationalHyperproperties(db, options),
    ...verifyContinuousFlowpipeAndBarrier(db, options),
  ];
}

/**
 * Asynchronously initializes WASM kernels (if available) and executes all deep formal
 * verification passes (`S6031`, `S7001`–`S7006`) over `db`.
 */
export async function verifySysML2Formal(
  db: QueryDB,
  options?: SysML2FormalVerifyOptions,
): Promise<SysML2FormalDiagnostic[]> {
  try {
    await initBltWasm();
  } catch {
    // Pure-TS/in-memory fallback remains available
  }
  return verifySysML2FormalSync(db, options);
}
