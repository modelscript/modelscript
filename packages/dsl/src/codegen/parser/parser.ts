// SPDX-License-Identifier: AGPL-3.0-or-later

import * as fs from "node:fs";
import * as path from "node:path";
import { GLRTable, LRAutomaton } from "../../dsl/automata.js";
import { NormalizedGrammar } from "../../dsl/grammar.js";
import { LanguageOptions, SOURCE_PATH_SYMBOL, SOURCE_TEXT_SYMBOL } from "../../dsl/language.js";
import { extractLanguageAST } from "../transpiler/ast-loader.js";

import {
  aliasCode,
  arenaCode,
  bdfCode,
  bltCode,
  branch_and_boundCode,
  builtins_mathCode,
  casCode,
  coloringCode,
  correspondenceCode,
  cseCode,
  daeAccessorsCode,
  daeBuilderCode,
  daeTypesCode,
  delayCode,
  doeCode,
  dualCode,
  engineCode,
  evalCode,
  eventsCode,
  fmi2_wasmCode,
  fmi3_wasmCode,
  foldCode,
  groebnerCode,
  gssCode,
  hashmapCode,
  homotopyCode,
  integrateCode,
  integratorsCode,
  intervalCode,
  isolationCode,
  linalgCode,
  lspCode,
  matrixCode,
  mccormickCode,
  monte_carloCode,
  ontologyCode,
  ontology_projectionCode,
  pantelidesCode,
  parserLoopCode,
  polyglot_arenaCode,
  recoveryCode,
  rootShimFiles,
  runtimeTemplateFiles,
  scalarizeCode,
  scope_stackCode,
  sparse_choleskyCode,
  sparse_luCode,
  statementsCode,
  string_poolCode,
  stubCode,
  tapeCode,
  tearingCode,
  tgg_reconcilerCode,
  trigramCode,
  verifierCode,
  vmapCode,
} from "../../src-gen/runtime-templates.js";
import { generateCFG } from "../analysis/cfg.js";
import { generateDataflow } from "../analysis/dataflow.js";
import { generateIsolationDomain } from "../analysis/isolation.js";
import { generatePantelidesDomain } from "../analysis/pantelides.js";
import { generateSimplex } from "../analysis/simplex.js";
import { generateSSA } from "../analysis/ssa.js";
import { generateBlockLayoutConstants } from "../emitters/ir_layout.js";
import { generateTypes } from "../emitters/types.js";
import { compileMcpConfig } from "../rewriting/compile_mcp.js";
import { compileTGGRules } from "../rewriting/compile_tgg.js";
import { generateEGraphEngine } from "../rewriting/egraph.js";
import { generateAliasAnalysis } from "../shared/alias.js";
import { generateCodeGraphBridge } from "../shared/graph.js";
import { transpileClass, transpileHelperFunction } from "../transpiler/transpiler.js";
import { generateOctagonDomain } from "../typesys/octagon.js";
import { generateReasoner } from "../typesys/reasoner.js";
import { generateSAT } from "../typesys/sat.js";
import { generateTypeSystem } from "../typesys/typesys.js";
import { generateLexer, toCodePoints } from "./lexer.js";

/**
 * The consolidated result of a successful grammar analysis and parsing phase.
 */
export interface ParserGenerationResult {
  /** The normalized grammar AST containing rules, precedence matrices, and aliases. */
  grammar: NormalizedGrammar;
  /** The generated LR State Machine handling states, GOTO, and lookaheads. */
  automaton: LRAutomaton;
  /** The action and goto lookup tables computed for the GLR parser. */
  table: GLRTable;
}

/**
 * Orchestrates the compilation of a raw DSL definition into a normalized grammar,
 * builds the LALR(1) state machine, and generates the GLR lookup tables.
 *
 * @param options The compiler options / DSL definition
 * @returns The generated grammar, LR automaton, and GLR action/goto tables
 */
export function generateParser<RuleName extends string>(options: LanguageOptions<RuleName>): ParserGenerationResult {
  const grammar = new NormalizedGrammar(options as unknown as LanguageOptions<any>);
  const automaton = new LRAutomaton(grammar);
  const table = new GLRTable(grammar, automaton);

  return { grammar, automaton, table };
}

/**
 * A virtual file object representing an AssemblyScript source file.
 */
export interface GeneratedFile {
  /** The desired relative filename (e.g. `parser.ts`, `arena.ts`). */
  filename: string;
  /** The generated source code content. */
  content: string;
}

/**
 * Orchestrates the conversion of the GLR lookup tables and AST logic
 * into executable AssemblyScript source files. Generates static WASM
 * arrays and injects token/preprocessor hooks into the runtime templates.
 *
 * Key algorithmic responsibilities:
 * 1. Encodes `ACTION` and `GOTO` tables into flat hex-decoded linear memory arrays,
 *    sorting `REDUCE` actions by dynamic precedence and production ID.
 * 2. Computes Minimum Repair Distance (`mrd_data`), token insertion/deletion cost tables,
 *    and the bounded 64-step lookahead reachability relaxation (`reachability_matrix` and
 *    1-token `precomputed_repairs`) used by the GLR error recovery engine.
 * 3. Precomputes structural field projection tables (`type_fields` / `type_field_data`),
 *    tagging indirect synthetic (`_`-prefixed) child hops with the `0x8000` bitflag so
 *    `FieldCursor._advance` can transparently traverse hidden grammar rules at runtime.
 * 4. Emits LSP semantic token tables, bracket balance deltas, compiled CST lint dispatchers,
 *    E-graph equality saturation hooks, TGG reconcilers, and abstract interpretation domains.
 *
 * @param originalGrammar The original DSL definition block
 * @param grammar The normalized grammar representation
 * @param table The precomputed GLR tables
 * @param syncTokens Tokens marked explicitly for error recovery anchors
 * @param preprocessorHook The name of the lexer entry function (default: "lex")
 * @returns Array of AssemblyScript file payloads to be compiled by `asc`
 */
export function generateParserTables(
  originalGrammar: LanguageOptions<any>,
  grammar: NormalizedGrammar,
  table: GLRTable,
  syncTokens: string[] = [],
  preprocessorHook = "",
): GeneratedFile[] {
  (originalGrammar as any).fieldToInt = grammar.fieldToInt;
  const LEX_FN = preprocessorHook ? preprocessorHook : "lex";
  let code = `import { ChunkedUint32Array, ChunkedInt32Array, UnmanagedUint32Array } from "./array";\nimport { allocNode, getInputBuffer, atomicChunkAlloc, getArenaOffset, getNodeType, getNodeFirstChild, getNodeNextSibling } from "./arena";\nimport { DaeBuilder } from "./dae";\nimport { allocDiagnostic } from "./graph";\nimport { CorrespondenceIndex } from "./correspondence";\nimport { PolyglotArena } from "./polyglot_arena";\nexport { getInputBuffer } from "./arena";\nimport { decodeHexIntArray, decodeHexU16Array, decodeHexByteArray } from "./encoding";\nexport { decodeHexIntArray, decodeHexU16Array, decodeHexByteArray };\n\n@external("parser", "logInt")\nexport declare function logInt(val: i32): void;\n\nexport let expected_tokens: usize = 0;\n\n`;

  // Types & SyntaxType enum
  const typesContent = generateTypes(originalGrammar, grammar);
  code += `\nexport * from "./types";\n`;

  code += `\n// GLR Parser Tables\n`;
  code += `// Generated for ${grammar.productions.length} productions and ${table.actionTable.size} states\n\n`;

  // Section 1: Symbol & State Count Validation
  // AST node types are packed into a 10-bit field in the 32-bit node header, capping grammar symbols at 1023.
  const symToInt = grammar.symToInt;
  let maxSymbolId = 0;
  for (const [sym, id] of symToInt.entries()) {
    if (sym !== "EOF" && id > maxSymbolId) {
      maxSymbolId = id;
    }
  }
  if (maxSymbolId > 1023) {
    throw new Error(
      `Grammar '${originalGrammar.name}' exceeds maximum supported symbol count of 1023 (has ${maxSymbolId}). AST node type is packed into 10 bits.`,
    );
  }
  const startSymName = Object.keys(originalGrammar.rules ?? {})[0] || "Program";
  const startSymId = symToInt.get(startSymName) || 1;
  code += `export const SYMBOL_COUNT = ${maxSymbolId};\n`;
  code += `export const STATE_COUNT = ${table.actionTable.size};\n`;
  code += `export const START_SYMBOL_ID = ${startSymId};\n\n`;

  // Section 2: Flatten GLR ACTION Table
  // Group actions by state and lookahead symbol, sorting REDUCE actions by descending dynamic precedence
  // (and breaking ties by production ID) so higher-priority reductions are explored first.
  const actionOffsets: number[] = [];
  const actionData: number[] = [];
  const actionEntryOffsets: number[] = [];
  const actionEntryData: number[] = [];

  for (let stateId = 0; stateId < table.actionTable.size; stateId++) {
    actionOffsets.push(actionData.length);
    actionEntryOffsets.push(actionEntryData.length);
    const actions = table.actionTable.get(stateId)!;

    const entries: { symId: number; acts: any[] }[] = [];
    for (const [sym, acts] of actions.entries()) {
      const sortedActs = [...acts].sort((a, b) => {
        if (a.type !== 1 || b.type !== 1) return 0; // 1 is ActionType.REDUCE
        const prodA = grammar.productions.find((p) => p.id === a.target);
        const prodB = grammar.productions.find((p) => p.id === b.target);
        const precDiff = (prodB?.dynamicPrec || 0) - (prodA?.dynamicPrec || 0);
        if (precDiff !== 0) return precDiff;
        return (b.target || 0) - (a.target || 0);
      });
      entries.push({
        symId: symToInt.get(sym) ?? 0,
        acts: sortedActs,
      });
    }

    entries.sort((a, b) => a.symId - b.symId);

    actionData.push(entries.length);
    for (const entry of entries) {
      actionEntryData.push(actionData.length);
      actionData.push(entry.symId);
      actionData.push(entry.acts.length);
      for (const act of entry.acts) {
        actionData.push(act.type);
        actionData.push(act.target || 0);
      }
    }
  }

  // Helpers to serialize numeric tables as compact hex strings decoded into WASM linear memory at startup.
  const generateStaticArray = (arr: number[], name: string) => {
    if (arr.length === 0) return `export const ${name}: usize = memory.data<i32>([0, 0]) + 4;\n`;
    let hex = "";
    for (const item of arr) {
      const val = item === undefined ? 1 : item;
      hex += (val >>> 0).toString(16).padStart(8, "0");
    }
    return `export const ${name}: usize = decodeHexIntArray("${hex}", ${arr.length});\n`;
  };

  const generateStaticU16Array = (arr: ArrayLike<number>, name: string) => {
    if (arr.length === 0) return `export const ${name}: usize = memory.data<i32>([0, 0]) + 4;\n`;
    let hex = "";
    for (let i = 0; i < arr.length; i++) {
      const val = arr[i] === undefined ? 0 : arr[i]! & 0xffff;
      hex += val.toString(16).padStart(4, "0");
    }
    return `export const ${name}: usize = decodeHexU16Array("${hex}", ${arr.length});\n`;
  };

  const generateStaticByteArray = (arr: ArrayLike<number>, name: string) => {
    if (arr.length === 0) return `export const ${name}: usize = memory.data<i32>([0, 0]) + 4;\n`;
    let hex = "";
    for (let i = 0; i < arr.length; i++) {
      const val = arr[i] === undefined ? 0 : arr[i]! & 0xff;
      hex += val.toString(16).padStart(2, "0");
    }
    return `export const ${name}: usize = decodeHexByteArray("${hex}", ${arr.length});\n`;
  };

  code += generateStaticArray(actionOffsets, "action_offsets");
  code += generateStaticArray(actionData, "action_data");
  code += generateStaticArray(actionEntryOffsets, "action_entry_offsets");
  code += generateStaticArray(actionEntryData, "action_entry_data");

  // Section 3: Flatten GLR GOTO Table
  // Entries are sorted by non-terminal symbol ID to allow binary search during `constructReducedParentNode` / GOTO lookup.
  const gotoOffsets: number[] = [];
  const gotoData: number[] = [];

  for (let stateId = 0; stateId < table.gotoTable.size; stateId++) {
    gotoOffsets.push(gotoData.length);
    const gotos = table.gotoTable.get(stateId)!;
    gotoData.push(gotos.size);
    const sortedGotos = Array.from(gotos.entries())
      .map(([sym, target]) => [symToInt.get(sym)!, target] as const)
      .sort((a, b) => a[0] - b[0]);
    for (const [symId, target] of sortedGotos) {
      gotoData.push(symId);
      gotoData.push(target);
    }
  }

  code += generateStaticArray(gotoOffsets, "goto_offsets");
  code += generateStaticArray(gotoData, "goto_data");

  // Section 4: Error Recovery Cost & Reachability Tables
  const mrd = table.automaton.computeMRD().map((v) => Math.min(255, v));
  code += generateStaticByteArray(mrd, "mrd_data");

  const termList = Array.from(grammar.terminals);
  const tokenInsertCosts: number[] = new Array(termList.length + 5).fill(1);

  for (let i = 0; i < termList.length; i++) {
    const sym = termList[i]!;
    const symId = symToInt.get(sym) ?? i;
    const cleanSym = sym.replace(/^"|"$/g, "");

    if (cleanSym === ";" || cleanSym === "," || cleanSym === ":") {
      tokenInsertCosts[symId] = 1; // Low cost strictly for structural punctuation and list separators ; , :
    } else {
      tokenInsertCosts[symId] = 50; // Restricted insertion cost (50) for operators (=, +, -, etc.), keywords, types, block delimiters, and data terminals
    }
  }
  code += generateStaticByteArray(tokenInsertCosts, "token_insert_costs");

  const tokenIsWord = new Array(maxSymbolId + 1).fill(0);
  for (const [sym, symId] of symToInt.entries()) {
    if (sym.startsWith('"')) {
      const cleanOp = sym.slice(1, -1);
      if (/^[a-zA-Z_]/.test(cleanOp)) {
        tokenIsWord[symId] = 1;
      }
    } else if (sym.startsWith("/")) {
      if (sym.includes("a-z") || sym.includes("A-Z") || sym.includes("_")) {
        tokenIsWord[symId] = 1;
      }
    }
  }
  code += generateStaticByteArray(tokenIsWord, "token_is_word");

  let maxTerminalId = 0;
  for (const term of grammar.terminals) {
    if (term !== "EOF" && term !== "ERROR") {
      const id = symToInt.get(term);
      if (id !== undefined && id > maxTerminalId) {
        maxTerminalId = id;
      }
    }
  }

  // Precompute Minimal Yield Terminal Sequences (needed to weight GOTO transitions in reachability_matrix)
  const minYieldMap = new Map<string, number[]>();
  for (const term of grammar.terminals) {
    const id = symToInt.get(term);
    if (id !== undefined) {
      minYieldMap.set(term, [id]);
    }
  }

  let yieldChanged = true;
  while (yieldChanged) {
    yieldChanged = false;
    for (const p of grammar.productions) {
      const lhs = p.left;
      let valid = true;
      const sequence: number[] = [];

      for (const sym of p.right) {
        const symYield = minYieldMap.get(sym);
        if (!symYield) {
          valid = false;
          break;
        }
        sequence.push(...symYield);
      }

      if (valid) {
        const existing = minYieldMap.get(lhs);
        if (!existing || sequence.length < existing.length) {
          minYieldMap.set(lhs, sequence);
          yieldChanged = true;
        }
      }
    }
  }

  // Initialize the `[stateId, terminalId]` reachability distance matrix to `254` (infinity),
  // seeding all direct `SHIFT` transitions in `stateId` with distance `0`.
  const MAX_REACHABILITY_DEPTH = Math.min(64, table.actionTable.size);
  const reachabilityMatrix = new Uint8Array(table.actionTable.size * (maxTerminalId + 1));
  reachabilityMatrix.fill(254);

  for (let stateId = 0; stateId < table.actionTable.size; stateId++) {
    const actions = table.actionTable.get(stateId);
    if (actions) {
      for (const [sym, acts] of actions.entries()) {
        if (acts.some((a) => a.type === 0)) {
          // 0 is SHIFT
          const symId = symToInt.get(sym);
          if (symId !== undefined && symId <= maxTerminalId) {
            reachabilityMatrix[stateId * (maxTerminalId + 1) + symId] = 0;
          }
        }
      }
    }
  }

  console.log(
    "Building Unbounded Reachability Matrix for",
    table.actionTable.size,
    "states and",
    maxTerminalId,
    "terminals",
  );

  // Build reverse transition index (targetState:sym -> predecessor states) to find exact post-reduction GOTO targets
  const reverseTransitions = new Map<string, number[]>();
  for (let s = 0; s < table.actionTable.size; s++) {
    const actions = table.actionTable.get(s);
    if (actions) {
      for (const [sym, acts] of actions.entries()) {
        for (const act of acts) {
          if (act.type === 0 && act.target !== undefined) {
            const key = `${act.target}:${sym}`;
            let list = reverseTransitions.get(key);
            if (!list) {
              list = [];
              reverseTransitions.set(key, list);
            }
            if (!list.includes(s)) list.push(s);
          }
        }
      }
    }
    const gotos = table.gotoTable.get(s);
    if (gotos) {
      for (const [sym, target] of gotos.entries()) {
        const key = `${target}:${sym}`;
        let list = reverseTransitions.get(key);
        if (!list) {
          list = [];
          reverseTransitions.set(key, list);
        }
        if (!list.includes(s)) list.push(s);
      }
    }
  }

  // Helper that walks backward through `reverseTransitions` for each symbol on the RHS of `prodIdx`
  // from `stateId` to find all valid source states, then resolves their post-reduction `GOTO(sourceState, prod.left)` targets.
  const reduceGotoTargets = new Map<string, number[]>();
  const getReduceTargets = (stateId: number, prodIdx: number): number[] => {
    const cacheKey = `${stateId}:${prodIdx}`;
    const cached = reduceGotoTargets.get(cacheKey);
    if (cached) return cached;
    const prod = table.grammar.productions[prodIdx]!;
    let currStates = [stateId];
    // Walk RHS symbols in reverse order to simulate popping `prod.right.length` states off the LR automaton stack.
    for (let i = prod.right.length - 1; i >= 0; i--) {
      const rhsSym = prod.right[i];
      const prevStates: number[] = [];
      for (const st of currStates) {
        const preds = reverseTransitions.get(`${st}:${rhsSym}`);
        if (preds) {
          for (const p of preds) {
            if (!prevStates.includes(p)) prevStates.push(p);
          }
        }
      }
      currStates = prevStates;
      if (currStates.length === 0) break;
    }
    // From each reachable stack bottom state, follow the non-terminal GOTO transition for `prod.left`.
    const targets: number[] = [];
    for (const sourceState of currStates) {
      const nextState = table.gotoTable.get(sourceState)?.get(prod.left);
      if (nextState !== undefined && !targets.includes(nextState)) {
        targets.push(nextState);
      }
    }
    reduceGotoTargets.set(cacheKey, targets);
    return targets;
  };

  // Bounded 64-step Bellman-Ford minimum repair distance reachability relaxation:
  // Iteratively relaxes `reachabilityMatrix[stateId, t]` (up to `MAX_REACHABILITY_DEPTH = min(64, stateCount)` hops)
  // to compute the minimum number of token insertions required to reach a valid shift of terminal `t` from `stateId`:
  // - Across a `SHIFT` transition `stateId -> nextState`: adds `+1` token insertion cost (`1 + baseCost`).
  // - Across a `REDUCE` action to post-reduction GOTO target `nextState`: adds `0` cost if `t` matches the reduction's
  //   valid lookahead symbol (`sym === "$default" || t === symId`), or `Math.max(1, baseCost)` otherwise.
  // - Across a non-terminal `GOTO` transition `stateId -> nextState`: adds `Math.max(1, minYieldLength(sym))`.
  let matrixChanged = true;
  for (let iter = 0; iter < MAX_REACHABILITY_DEPTH; iter++) {
    if (!matrixChanged) break;
    matrixChanged = false;
    const newMatrix = new Uint8Array(reachabilityMatrix);
    for (let stateId = 0; stateId < table.actionTable.size; stateId++) {
      const actions = table.actionTable.get(stateId);
      const gotos = table.gotoTable.get(stateId);
      if (actions) {
        for (const [sym, acts] of actions.entries()) {
          const symId = sym === "$default" ? 0 : (symToInt.get(sym) ?? -1);
          for (const act of acts) {
            if (act.type === 0 && act.target !== undefined) {
              // SHIFT transition: consuming the shifted terminal costs 1 repair step plus remaining distance from `nextState`.
              const nextState = act.target;
              for (let t = 1; t <= maxTerminalId; t++) {
                const baseCost = reachabilityMatrix[nextState * (maxTerminalId + 1) + t]!;
                if (baseCost >= 254) continue;
                const altCost = 1 + baseCost;
                if (altCost < newMatrix[stateId * (maxTerminalId + 1) + t]!) {
                  newMatrix[stateId * (maxTerminalId + 1) + t] = altCost;
                  matrixChanged = true;
                }
              }
            } else if (act.type === 1 && act.target !== undefined) {
              // REDUCE action: 0-cost lookahead step only for the reduction's valid lookahead terminal(s),
              // and only to valid post-reduction GOTO target states.
              const targets = getReduceTargets(stateId, act.target);
              for (const nextState of targets) {
                for (let t = 1; t <= maxTerminalId; t++) {
                  const baseCost = reachabilityMatrix[nextState * (maxTerminalId + 1) + t]!;
                  if (baseCost >= 254) continue;
                  const altCost = sym === "$default" || t === symId ? baseCost : Math.max(1, baseCost);
                  if (altCost < newMatrix[stateId * (maxTerminalId + 1) + t]!) {
                    newMatrix[stateId * (maxTerminalId + 1) + t] = altCost;
                    matrixChanged = true;
                  }
                }
              }
            }
          }
        }
      }
      if (gotos) {
        // Non-terminal GOTO transition: weighted by the minimum terminal yield length of `sym`.
        for (const [sym, nextState] of gotos.entries()) {
          const yieldLen = minYieldMap.get(sym)?.length ?? 1;
          const cost = Math.max(1, yieldLen);
          for (let t = 1; t <= maxTerminalId; t++) {
            const baseCost = reachabilityMatrix[nextState * (maxTerminalId + 1) + t]!;
            if (baseCost >= 254) continue;
            const altCost = Math.min(254, cost + baseCost);
            if (altCost < newMatrix[stateId * (maxTerminalId + 1) + t]!) {
              newMatrix[stateId * (maxTerminalId + 1) + t] = altCost;
              matrixChanged = true;
            }
          }
        }
      }
    }
    reachabilityMatrix.set(newMatrix);
  }
  // Build Precomputed 1-Token Repair Table (Phase 2)
  const precomputedRepairs = new Uint16Array(table.actionTable.size * (maxTerminalId + 1));
  for (let stateId = 0; stateId < table.actionTable.size; stateId++) {
    const actions = table.actionTable.get(stateId);
    if (!actions) continue;

    const validShiftSyms: { symId: number; targetState: number }[] = [];
    for (const [sym, acts] of actions.entries()) {
      const symId = symToInt.get(sym);
      if (symId !== undefined && symId <= maxTerminalId) {
        for (const act of acts) {
          if (act.type === 0 && act.target !== undefined) {
            validShiftSyms.push({ symId, targetState: act.target });
          }
        }
      }
    }

    for (let unexpectedTok = 1; unexpectedTok <= maxTerminalId; unexpectedTok++) {
      let bestRepairTok = 0;
      let minCost = 254;

      for (const { symId, targetState } of validShiftSyms) {
        const cost = reachabilityMatrix[targetState * (maxTerminalId + 1) + unexpectedTok]!;
        if (cost < minCost) {
          minCost = cost;
          bestRepairTok = symId;
        }
      }

      precomputedRepairs[stateId * (maxTerminalId + 1) + unexpectedTok] = bestRepairTok;
    }
  }
  // At runtime in WASM, only distance-0 reachability (`isReachableZeroDist`) is queried.
  // Bit-pack `reachabilityMatrix` (1 bit per `(state, tok)` pair: 1 if distance === 0, 0 otherwise)
  // to shrink the static table by 8x while preserving natural 0-default semantics for out-of-bounds indices.
  const reachabilityBitset = new Uint8Array((reachabilityMatrix.length + 7) >> 3);
  for (let i = 0; i < reachabilityMatrix.length; i++) {
    if (reachabilityMatrix[i] === 0) {
      reachabilityBitset[i >> 3] = reachabilityBitset[i >> 3]! | (1 << (i & 7));
    }
  }
  code += generateStaticByteArray(reachabilityBitset, "reachability_matrix");
  code += generateStaticU16Array(precomputedRepairs, "precomputed_repairs");

  // Literal terminal strings for keyword/symbol similarity matching
  const tokenStringOffsets: number[] = new Array(maxSymbolId + 1).fill(-1);
  const tokenStringBytes: number[] = [];
  for (const [sym, symId] of symToInt.entries()) {
    if (sym.startsWith('"') && sym.endsWith('"') && sym.length > 2) {
      const literal = sym.slice(1, -1);
      const cps = toCodePoints(literal);
      tokenStringOffsets[symId] = tokenStringBytes.length;
      tokenStringBytes.push(cps.length);
      for (const cp of cps) {
        tokenStringBytes.push(cp);
      }
    }
  }
  code += generateStaticArray(tokenStringOffsets, "token_string_offsets");
  code += generateStaticArray(tokenStringBytes, "token_string_bytes");

  // 1. Identify list separators
  const listSeparators = new Set<string>();
  for (const p of grammar.productions) {
    if (p.isList && p.right.length >= 2 && p.right[0] === p.left) {
      const potentialSeparator = p.right[1]!;
      if (grammar.terminals.has(potentialSeparator)) {
        listSeparators.add(potentialSeparator);
      }
    }
  }

  // 2. Generate tokenDeleteCosts
  const tokenDeleteCosts: number[] = new Array(maxSymbolId + 1).fill(10);
  for (const [sym, id] of symToInt.entries()) {
    let cost = 10;
    if (listSeparators.has(sym)) {
      cost = 200;
    }
    if (syncTokens.includes(sym.replace(/^"|"$/g, "")) || syncTokens.includes(sym)) {
      cost = 1000;
    }
    tokenDeleteCosts[id] = cost;
  }

  const eofId = symToInt.get("EOF");
  if (eofId !== undefined) {
    tokenDeleteCosts[eofId] = 5000;
  }

  code += generateStaticU16Array(tokenDeleteCosts, "token_delete_costs");

  // Section 5: Production Metadata & Aliasing Tables
  const prodLengths: number[] = [];
  const prodRightOffsets: number[] = [];
  const prodRightSymbols: number[] = [];
  const prodLhs: number[] = [];
  const prodIsInvisible: number[] = [];
  const prodIsList: number[] = [];
  const prodDynamicPrec: number[] = [];
  const prodAliases: number[] = [];
  const aliasData: number[] = [];

  const sortedProds = [...grammar.productions].sort((a, b) => a.id - b.id);
  for (const p of sortedProds) {
    prodRightOffsets.push(prodRightSymbols.length);
    for (const sym of p.right) {
      prodRightSymbols.push(symToInt.get(sym) || 0);
    }
    prodLengths.push(p.right.length);
    const lhs = symToInt.get(p.left);
    if (lhs === undefined) {
      console.log("prod_lhs is undefined for:", p.left);
    }
    prodLhs.push(lhs || 0);
    prodIsInvisible.push(p.isInvisible ? 1 : 0);
    prodIsList.push(p.isList ? 1 : 0);
    prodDynamicPrec.push(p.dynamicPrec || 0);

    if (p.aliases && p.aliases.length > 0) {
      prodAliases.push(aliasData.length);
      aliasData.push(p.aliases.length);
      for (const a of p.aliases) {
        aliasData.push(a.index);
        aliasData.push(symToInt.get(a.target) || 0);
      }
    } else {
      prodAliases.push(-1);
    }
  }

  // Section 6: Named Field Projection Tables (`type_fields` & `type_field_data`)
  const maxSymId = Math.max(0, ...Array.from(symToInt.values()));
  const typeFields: number[] = new Array(maxSymId + 1).fill(-1);
  const typeFieldData: number[] = [];

  let maxSyntheticDepth = 0;

  /**
   * Computes the mapping from `fieldId` to candidate `(childIndex, expectedType)` pairs for
   * all productions of `symName`.
   *
   * Direct fields on `p` record their physical RHS index `f.index` (`0 <= f.index < 0x8000`).
   * When a production's RHS contains a synthetic/auxiliary rule (`childSym.startsWith("_")`,
   * generated by `.optional()`, `.repeat()`, or `.choice()` combinators), `getFieldsForSymbol`
   * recursively collects fields declared inside `childSym` and records the parent's RHS slot `i`
   * with the `0x8000` indirect-hop bitflag (`idx = i | 0x8000`).
   *
   * At runtime in WASM, `FieldCursor._advance` checks `(entryIndex & 0x8000) !== 0`:
   * - If clear (`0`), the child at `entryIndex` is the target field node itself.
   * - If set (`0x8000`), `FieldCursor._advance` strips the flag (`entryIndex & 0x7FFF`),
   *   pushes the synthetic intermediate child node onto its traversal stack, and continues
   *   searching `type_fields[childType]` for `fieldId` until it reaches the concrete leaf field.
   */
  function getFieldsForSymbol(
    symName: string,
    visited = new Set<string>(),
    depth = 0,
  ): Map<number, { index: number; expectedType: number }[]> {
    if (depth > maxSyntheticDepth) {
      maxSyntheticDepth = depth;
    }
    const map = new Map<number, { index: number; expectedType: number }[]>();
    if (visited.has(symName)) return map;
    visited.add(symName);

    const symId = symToInt.get(symName) || 0;
    for (const p of grammar.productions) {
      if ((symToInt.get(p.left) || 0) === symId) {
        // 1. Direct fields attached to this production rule.
        if (p.fields) {
          for (const f of p.fields) {
            if (!map.has(f.fieldId)) map.set(f.fieldId, []);
            const childSym = p.right[f.index]!;
            const expectedType = symToInt.get(childSym) || 0;
            const list = map.get(f.fieldId)!;
            if (!list.some((e) => e.index === f.index && e.expectedType === expectedType)) {
              list.push({ index: f.index, expectedType });
            }
          }
        }
        // 2. Indirect fields nested inside synthetic (`_`-prefixed) child non-terminals:
        // tag the child index with `0x8000` so `FieldCursor._advance` descends into child `i`.
        for (let i = 0; i < p.right.length; i++) {
          const childSym = p.right[i]!;
          if (childSym.startsWith("_")) {
            const childFields = getFieldsForSymbol(childSym, new Set(visited), depth + 1);
            const expectedType = symToInt.get(childSym) || 0;
            for (const fieldId of childFields.keys()) {
              if (!map.has(fieldId)) map.set(fieldId, []);
              const list = map.get(fieldId)!;
              const idx = i | 0x8000;
              if (!list.some((e) => e.index === idx && e.expectedType === expectedType)) {
                list.push({ index: idx, expectedType });
              }
            }
          }
        }
      }
    }
    return map;
  }

  // Flatten each symbol's field map into `typeFields` (offset table) and `typeFieldData` (packed entries).
  for (const [symName, symId] of symToInt.entries()) {
    const fieldsMap = getFieldsForSymbol(symName);

    if (fieldsMap.size > 0) {
      typeFields[symId] = typeFieldData.length;
      typeFieldData.push(fieldsMap.size);
      for (const [fieldId, entries] of fieldsMap.entries()) {
        typeFieldData.push(fieldId);
        typeFieldData.push(entries.length);
        for (const entry of entries) {
          typeFieldData.push(entry.index);
          typeFieldData.push(entry.expectedType);
        }
      }
    }
  }

  const maxFieldCursorDepth = Math.max(16, maxSyntheticDepth + 8);

  // Section 7: LSP Semantic Highlighting, Folding, Outline & Scope Indexing Tables
  const tokenTypesMap = new Map<string, number>();
  const tokenModifiersMap = new Map<string, number>();

  for (const p of sortedProds) {
    if (p.semantics) {
      for (const s of p.semantics) {
        if (!tokenTypesMap.has(s.type)) tokenTypesMap.set(s.type, tokenTypesMap.size);
        const mods = Array.isArray(s.modifiers) ? s.modifiers : Object.keys(s.modifiers || {});
        for (const m of mods) {
          if (!tokenModifiersMap.has(m)) tokenModifiersMap.set(m, tokenModifiersMap.size);
        }
      }
    }
  }

  const typeSemantics: number[] = new Array(maxSymbolId + 1).fill(-1);
  const typeSemanticData: number[] = [];

  for (let symId = 1; symId <= maxSymbolId; symId++) {
    const semanticsList = new Map<number, { type: number; bitmask: number }>();
    for (const p of sortedProds) {
      if ((symToInt.get(p.left) || 0) === symId && p.semantics) {
        for (const s of p.semantics) {
          let bitmask = 0;
          const mods = Array.isArray(s.modifiers) ? s.modifiers : Object.keys(s.modifiers || {});
          for (const m of mods) {
            bitmask |= 1 << tokenModifiersMap.get(m)!;
          }
          semanticsList.set(s.index, { type: tokenTypesMap.get(s.type)!, bitmask });
        }
      }
    }

    if (semanticsList.size > 0) {
      typeSemantics[symId] = typeSemanticData.length;
      typeSemanticData.push(semanticsList.size);
      for (const [index, sem] of semanticsList.entries()) {
        typeSemanticData.push(index);
        typeSemanticData.push(sem.type);
        typeSemanticData.push(sem.bitmask);
      }
    }
  }

  code += generateStaticByteArray(prodLengths, "prod_lengths");
  code += generateStaticArray(prodRightOffsets, "prod_right_offsets");
  code += generateStaticU16Array(prodRightSymbols, "prod_right_symbols");
  code += generateStaticU16Array(prodLhs, "prod_lhs");
  code += generateStaticByteArray(prodIsInvisible, "prod_is_invisible");
  code += generateStaticByteArray(prodIsList, "prod_is_list");
  code += generateStaticArray(prodDynamicPrec, "prod_dynamic_prec");
  code += generateStaticArray(prodAliases, "prod_aliases");
  code += generateStaticArray(aliasData.length > 0 ? aliasData : [0], "alias_data");
  code += generateStaticArray(typeFields, "type_fields");
  code += generateStaticArray(typeFieldData.length > 0 ? typeFieldData : [0], "type_field_data");
  code += generateStaticArray(typeSemantics, "type_semantics");
  code += generateStaticArray(typeSemanticData.length > 0 ? typeSemanticData : [0], "type_semantic_data");

  const typeIsList: number[] = new Array(maxSymbolId + 1).fill(0);
  for (let p = 0; p < prodLhs.length; p++) {
    if (prodIsList[p] === 1) typeIsList[prodLhs[p]!] = 1;
  }
  code += generateStaticByteArray(typeIsList, "type_is_list");

  const typeIsFolding: number[] = new Array(maxSymbolId + 1).fill(0);
  if (originalGrammar.lsp && originalGrammar.lsp.folding) {
    for (const f of originalGrammar.lsp.folding) {
      const id = symToInt.get(f) || symToInt.get(`"${f}"`);
      if (id !== undefined) typeIsFolding[id] = 1;
    }
  }
  code += generateStaticArray(typeIsFolding, "type_is_folding");

  const typeIsOutline: number[] = new Array(maxSymbolId + 1).fill(0);
  if (originalGrammar.lsp && originalGrammar.lsp.outline) {
    for (const f of originalGrammar.lsp.outline) {
      const id = symToInt.get(f) || symToInt.get(`"${f}"`);
      if (id !== undefined) typeIsOutline[id] = 1;
    }
  }
  code += generateStaticArray(typeIsOutline, "type_is_outline");

  const typeIsSymbol: number[] = new Array(maxSymbolId + 1).fill(0);
  const symbolNameField: number[] = new Array(maxSymbolId + 1).fill(0);
  const symbolIsScope: number[] = new Array(maxSymbolId + 1).fill(0);

  if (originalGrammar.symbols) {
    for (const [ruleName, config] of Object.entries(originalGrammar.symbols)) {
      const id = symToInt.get(ruleName) || symToInt.get(`"${ruleName}"`);
      if (id !== undefined && config) {
        typeIsSymbol[id] = 1;
        if (config.name && grammar.fieldToInt) {
          const fieldId = grammar.fieldToInt.get(config.name) || 0;
          symbolNameField[id] = fieldId;
        }
        symbolIsScope[id] = config.scope !== false ? 1 : 0;
      }
    }
  }
  code += generateStaticArray(typeIsSymbol, "type_is_symbol");
  code += generateStaticArray(symbolNameField, "symbol_name_field");
  code += generateStaticArray(symbolIsScope, "symbol_is_scope");

  // Section 8: Bracket Balancing & Lexer Codegen
  const defaultBrackets: [string, string][] = [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ];
  const declaredBrackets: [string, string][] =
    originalGrammar.brackets && originalGrammar.brackets.length > 0 ? originalGrammar.brackets : defaultBrackets;

  const tokenBracketDeltas: number[] = new Array(maxTerminalId + 1).fill(0);
  const openBracketChars: number[] = [];
  const closeBracketChars: number[] = [];

  for (const [open, close] of declaredBrackets) {
    const openTokenId = symToInt.get(open) ?? symToInt.get(`"${open}"`);
    if (openTokenId !== undefined && openTokenId <= maxTerminalId) {
      tokenBracketDeltas[openTokenId] = 1;
    }
    const closeTokenId = symToInt.get(close) ?? symToInt.get(`"${close}"`);
    if (closeTokenId !== undefined && closeTokenId <= maxTerminalId) {
      tokenBracketDeltas[closeTokenId] = -1;
    }
    if (open.length === 1) {
      const codePoint = open.charCodeAt(0);
      if (!openBracketChars.includes(codePoint)) openBracketChars.push(codePoint);
    }
    if (close.length === 1) {
      const codePoint = close.charCodeAt(0);
      if (!closeBracketChars.includes(codePoint)) closeBracketChars.push(codePoint);
    }
  }

  code += generateStaticArray(tokenBracketDeltas, "token_bracket_deltas");
  code += generateStaticArray(openBracketChars.length > 0 ? openBracketChars : [0], "open_bracket_chars");
  code += generateStaticArray(closeBracketChars.length > 0 ? closeBracketChars : [0], "close_bracket_chars");

  code += generateLexer(originalGrammar, grammar);

  code += `\nexport const MAX_TERMINAL_ID = ${maxTerminalId};\nexport const MAX_SYMBOL_ID = ${maxSymbolId};\nexport const MAX_FIELD_CURSOR_DEPTH: i32 = ${maxFieldCursorDepth};\n`;
  code += `\nexport function invokeLexer(pos: u32): i32 { return ${LEX_FN}(pos); }\n`;

  // Section 9: Compiled CST Linter Dispatch Generation (`executeLints`)
  let lintSwitchStr = "";
  if (originalGrammar.lints) {
    const validLintFns: string[] = [];
    let nextLintId = 2000;
    const nodeLints = new Map<string, string[]>();
    for (const [lintName, lint] of Object.entries(originalGrammar.lints)) {
      const queryFn =
        typeof lint === "object" && lint !== null && (lint as any).query
          ? (lint as any).query
          : typeof lint === "string"
            ? lint
            : null;
      if (!queryFn) continue;
      const lintId =
        typeof lint === "object" && lint !== null && (lint as any).code ? (lint as any).code : nextLintId++;
      const fnName = `lint_${lintName}`;
      validLintFns.push(fnName);
      for (const nodeName of (lint as any).nodes || []) {
        if (!nodeLints.has(nodeName)) nodeLints.set(nodeName, []);
        nodeLints.get(nodeName)!.push(`${fnName}(node, ${lintId}, nodeStart, nodeEnd);`);
      }
    }
    if (validLintFns.length > 0) {
      code += `import { ${validLintFns.join(", ")} } from "./graph";\n`;
      lintSwitchStr += `\nexport const HAS_COMPILED_LINTS: bool = true;\n`;
    } else {
      lintSwitchStr += `\nexport const HAS_COMPILED_LINTS: bool = false;\n`;
    }
    lintSwitchStr += `\nexport function executeLints(type: u16, node: u32, nodeStart: u32, nodeEnd: u32): void {\n  switch (type) {\n`;
    for (const [nodeName, fnCalls] of nodeLints.entries()) {
      const symId = symToInt.get(nodeName);
      if (symId !== undefined) {
        lintSwitchStr += `    case ${symId}: /* ${nodeName} */\n`;
      } else {
        lintSwitchStr += `    case <u16>SyntaxType.${nodeName.toUpperCase()}:\n`;
      }
      for (const call of fnCalls) {
        lintSwitchStr += `      ${call}\n`;
      }
      lintSwitchStr += `      break;\n`;
    }
    lintSwitchStr += "    default:\n      break;\n  }\n}\n";
  } else {
    lintSwitchStr += `\nexport const HAS_COMPILED_LINTS: bool = false;\nexport function executeLints(type: u16, node: u32, nodeStart: u32, nodeEnd: u32): void {}\n`;
  }
  code += lintSwitchStr;

  // Section 10: Runtime Module Re-exports & Subsystem Wiring
  const extractExports = (codeStr: string, moduleName: string) => {
    const exports: string[] = [];
    const regex =
      /^export\s+(?:@(?:unmanaged|inline)\s+)?(?:abstract\s+)?(function|const|let|var|enum)\s+([a-zA-Z0-9_]+)/gm;
    let match;
    const ignoreList = new Set([
      "action_offsets",
      "action_data",
      "action_entry_offsets",
      "action_entry_data",
      "token_bracket_deltas",
      "open_bracket_chars",
      "close_bracket_chars",
      "goto_offsets",
      "goto_data",
      "mrd_data",
      "token_insert_costs",
      "token_delete_costs",
      "token_is_word",
      "reachability_matrix",
      "precomputed_repairs",
      "token_string_offsets",
      "token_string_bytes",
      "prod_lengths",
      "prod_right_offsets",
      "prod_right_symbols",
      "prod_lhs",
      "prod_is_invisible",
      "prod_is_list",
      "prod_dynamic_prec",
      "prod_aliases",
      "alias_data",
      "type_fields",
      "type_field_data",
      "type_is_list",
      "expected_tokens",
      "MAX_TERMINAL_ID",
      "inputLength",
      "setInputLength",
      "inputEncoding",
      "setInputEncoding",
      "getInputBuffer",
      "ParseHead",
      "VarAccessor",
      "ExprAccessor",
      "EqAccessor",
      "StmtAccessor",
    ]);

    for (const t of runtimeTemplateFiles) {
      const classMatches = t.content.matchAll(/\b(?:class|interface)\s+([a-zA-Z0-9_]+)/g);
      for (const m of classMatches) {
        ignoreList.add(m[1]!);
      }
    }
    const localClassMatches = codeStr.matchAll(/\b(?:class|interface)\s+([a-zA-Z0-9_]+)/g);
    for (const m of localClassMatches) {
      ignoreList.add(m[1]!);
    }
    while ((match = regex.exec(codeStr)) !== null) {
      if (!ignoreList.has(match[2]!)) {
        exports.push(match[2]!);
      }
    }
    const reexportRegex = /^export\s+\{([^}]+)\}/gm;
    let reexportMatch;
    while ((reexportMatch = reexportRegex.exec(codeStr)) !== null) {
      const items = reexportMatch[1]!.split(",");
      for (const item of items) {
        const trimmed = item
          .trim()
          .split(/\bas\b/)[0]!
          .trim();
        if (trimmed && !ignoreList.has(trimmed) && !exports.includes(trimmed)) {
          exports.push(trimmed);
        }
      }
    }
    if (exports.length > 0) {
      return `export { ${exports.join(", ")} } from "${moduleName}";\n`;
    }
    return "";
  };

  code += "\n";
  code += extractExports(engineCode, "./parser/engine");
  code += extractExports(lspCode, "./parser/lsp");
  code += extractExports(generateCodeGraphBridge(originalGrammar), "./graph");
  code += extractExports(arenaCode, "./arena");
  code += extractExports(parserLoopCode, "./parser/parser-loop");
  code += extractExports(gssCode, "./parser/gss");
  code += extractExports(recoveryCode, "./parser/recovery");
  code += extractExports(bltCode, "./structural/blt");
  code += extractExports(correspondenceCode, "./indexing/correspondence");
  code += extractExports(polyglot_arenaCode, "./polyglot/polyglot_arena");
  code += extractExports(tgg_reconcilerCode, "./polyglot/tgg_reconciler");
  code += extractExports(groebnerCode, "./solvers/groebner");
  code += extractExports(linalgCode, "./solvers/linalg");

  if (originalGrammar.typeSystem) {
    const tsCode = generateTypeSystem(originalGrammar, originalGrammar.typeSystem.customCode || "");
    code += "\n" + extractExports(tsCode, "./typesys");
  }
  if (originalGrammar.semantics) {
    const rsCode = generateReasoner(originalGrammar, grammar);
    code += "\n" + extractExports(rsCode, "./reasoner");
    if ((originalGrammar.semantics.reasoner as any)?.smt) {
      if ((originalGrammar.semantics.reasoner as any)?.smt?.theories?.includes("LRA")) {
        const simplexCode = generateSimplex(originalGrammar);
        code += "\n" + extractExports(simplexCode, "./simplex");
      }
      const satCode = generateSAT(originalGrammar, grammar);
      code += "\n" + extractExports(satCode, "./sat");
    }
  }

  if (originalGrammar.polyglot) {
    const tggOutput = compileTGGRules(originalGrammar.polyglot);
    code += "\n" + extractExports(tggOutput.sourceCode, "./tgg");
  } else {
    code += `\nexport function tgg_forward_dispatch(sourceNodeTypeHash: u32, sourceNodeId: u32, corr: CorrespondenceIndex, arena: PolyglotArena): u32 { return 0; }\nexport function tgg_backward_dispatch(targetNodeTypeHash: u32, targetNodeId: u32, corr: CorrespondenceIndex, arena: PolyglotArena): u32 { return 0; }\nexport function tgg_propagate_all_stale(corr: CorrespondenceIndex): u32 { return 0; }\n`;
  }

  if (originalGrammar.mcp) {
    const mcpOutput = compileMcpConfig(originalGrammar.mcp, originalGrammar.name);
    code += "\n" + extractExports(mcpOutput.sourceCode, "./mcp");
  } else {
    code += `\nexport function mcp_getToolCount(): u32 { return 0; }\nexport function mcp_getToolNameHash(index: u32): u32 { return 0; }\nexport function mcp_dispatchTool(toolIndex: u32, arg1: u32, arg2: u32, arg3: u32): u32 { return 0; }\nexport function mcp_getOutputBuffer(): usize { return 0; }\nexport function mcp_getOutputLength(): u32 { return 0; }\n`;
  }

  if (originalGrammar.simplification?.rules && originalGrammar.simplification.rules.length > 0) {
    code += `\n` + generateEGraphEngine(originalGrammar, originalGrammar.simplification.rules);
  } else {
    code += `\nexport function saturateEGraph(): void {}\nexport function initDPExtractor(): void {}\nexport function extractAst(rootClass: u32, dae: DaeBuilder): u32 { return 0; }\nexport function simplifyAst(exprId: u32, dae: DaeBuilder): u32 { return exprId; }\nexport function proveInductive(rootNode: u32, dae: DaeBuilder): boolean { return false; }\n`;
  }

  let engineCodeTemplate = engineCode;

  const hasToken = (str: string) => Array.from(symToInt.keys()).includes(`"${str}"`);
  engineCodeTemplate = engineCodeTemplate
    .replace("export const CHAR_LBRACE: u8 = 123;", `export const CHAR_LBRACE: u8 = ${hasToken("{") ? 123 : 0};`)
    .replace("export const CHAR_RBRACE: u8 = 125;", `export const CHAR_RBRACE: u8 = ${hasToken("}") ? 125 : 0};`)
    .replace("export const CHAR_LBRACKET: u8 = 91;", `export const CHAR_LBRACKET: u8 = ${hasToken("[") ? 91 : 0};`)
    .replace("export const CHAR_RBRACKET: u8 = 93;", `export const CHAR_RBRACKET: u8 = ${hasToken("]") ? 93 : 0};`)
    .replace("export const CHAR_LPAREN: u8 = 40;", `export const CHAR_LPAREN: u8 = ${hasToken("(") ? 40 : 0};`)
    .replace("export const CHAR_RPAREN: u8 = 41;", `export const CHAR_RPAREN: u8 = ${hasToken(")") ? 41 : 0};`);
  let lspCodeTemplate = lspCode;

  let lspImports = `import { inputLength, inputEncoding, logInt, SyntaxType, peekChar, peekCharLen, peekPrevChar, peekPrevCharLen, type_semantics, type_semantic_data, type_is_folding, type_is_outline, MAX_TERMINAL_ID, MAX_SYMBOL_ID, executeLints, HAS_COMPILED_LINTS } from "../parser";\n`;
  let importedLints = new Set<string>();
  if (originalGrammar.lints) {
    for (const lintName of Object.keys(originalGrammar.lints)) {
      importedLints.add(`lint_${lintName}`);
    }
  }
  if (importedLints.size > 0) {
    lspImports += `import { ${Array.from(importedLints).join(", ")}, lsp_invokeDefinition } from "../graph";\n`;
  } else {
    lspImports += `import { lsp_invokeDefinition } from "../graph";\n`;
  }

  lspCodeTemplate = lspCodeTemplate.replace(/import\s*\{[^}]*\}\s*from\s*"[^"]*parser";/, lspImports);

  const outFiles: GeneratedFile[] = [
    { filename: "parser.ts", content: code },
    { filename: "types.ts", content: typesContent },
    { filename: "graph.ts", content: generateCodeGraphBridge(originalGrammar) },
  ];

  for (const t of runtimeTemplateFiles) {
    if (outFiles.some((f) => f.filename === t.filename)) continue;
    let content = t.content;
    if (t.filename === "parser/engine.ts") {
      content = engineCodeTemplate;
    } else if (t.filename === "parser/lsp.ts") {
      content = lspCodeTemplate;
    }
    outFiles.push({ filename: t.filename, content });
  }

  for (const s of rootShimFiles) {
    if (outFiles.some((f) => f.filename === s.filename)) continue;
    outFiles.push({ filename: s.filename, content: s.content });
  }

  const sourcePath = (originalGrammar as any).sourcePath || (originalGrammar as any)[SOURCE_PATH_SYMBOL];
  const sourceDir = sourcePath ? path.dirname(sourcePath) : process.cwd();

  const loadRuntimeFile = (rf: any): { filename: string; content: string } | null => {
    if (typeof rf === "string") {
      let resolvedPath = path.isAbsolute(rf) ? rf : path.resolve(sourceDir, rf);
      if (!fs.existsSync(resolvedPath)) {
        const stripped = resolvedPath.replace(/[/\\]dist[/\\]assembly[/\\]/, "/assembly/");
        if (fs.existsSync(stripped)) {
          resolvedPath = stripped;
        } else {
          const relToSource = path.resolve(sourceDir, "..", "assembly", path.basename(rf));
          if (fs.existsSync(relToSource)) {
            resolvedPath = relToSource;
          }
        }
      }
      if (fs.existsSync(resolvedPath)) {
        return {
          filename: path.basename(resolvedPath),
          content: fs.readFileSync(resolvedPath, "utf-8"),
        };
      }
      throw new Error(`Runtime file path not found: ${rf} (resolved to ${resolvedPath})`);
    } else if (rf && typeof rf === "object") {
      let content = rf.content;
      let filename = rf.filename;
      if (!content && rf.path) {
        let resolvedPath = path.isAbsolute(rf.path) ? rf.path : path.resolve(sourceDir, rf.path);
        if (!fs.existsSync(resolvedPath)) {
          const stripped = resolvedPath.replace(/[/\\]dist[/\\]assembly[/\\]/, "/assembly/");
          if (fs.existsSync(stripped)) {
            resolvedPath = stripped;
          } else {
            const relToSource = path.resolve(sourceDir, "..", "assembly", path.basename(rf.path));
            if (fs.existsSync(relToSource)) {
              resolvedPath = relToSource;
            }
          }
        }
        if (fs.existsSync(resolvedPath)) {
          content = fs.readFileSync(resolvedPath, "utf-8");
          if (!filename) filename = path.basename(resolvedPath);
        } else {
          throw new Error(`Runtime file path not found: ${rf.path} (resolved to ${resolvedPath})`);
        }
      }
      if (filename && content !== undefined) {
        return { filename, content };
      }
    }
    return null;
  };

  if (originalGrammar.runtimeFiles) {
    for (const rf of originalGrammar.runtimeFiles) {
      const loaded = loadRuntimeFile(rf);
      if (loaded) {
        outFiles.push(loaded);
        code += "\n" + extractExports(loaded.content, `./${loaded.filename.replace(/\.ts$/, "")}`);
      }
    }
  }

  if (originalGrammar.runtimeDir) {
    const resolvedDir = path.isAbsolute(originalGrammar.runtimeDir)
      ? originalGrammar.runtimeDir
      : path.resolve(sourceDir, originalGrammar.runtimeDir);
    if (fs.existsSync(resolvedDir)) {
      const dirEntries = fs.readdirSync(resolvedDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
      for (const entry of dirEntries) {
        if (!outFiles.some((f) => f.filename === entry)) {
          const content = fs.readFileSync(path.join(resolvedDir, entry), "utf-8");
          outFiles.push({ filename: entry, content });
          code += "\n" + extractExports(content, `./${entry.replace(/\.ts$/, "")}`);
        }
      }
    }
  }

  if (originalGrammar.typeSystem) {
    outFiles.push({
      filename: "typesys.ts",
      content: generateTypeSystem(originalGrammar, originalGrammar.typeSystem.customCode || ""),
    });
  }
  if (originalGrammar.semantics) {
    outFiles.push({ filename: "reasoner.ts", content: generateReasoner(originalGrammar, grammar) });
  }
  if (originalGrammar.polyglot) {
    outFiles.push({ filename: "tgg.ts", content: compileTGGRules(originalGrammar.polyglot).sourceCode });
  }
  if (originalGrammar.mcp) {
    outFiles.push({
      filename: "mcp.ts",
      content: compileMcpConfig(originalGrammar.mcp, originalGrammar.name).sourceCode,
    });
  }

  code += extractExports(daeBuilderCode, "./dae/builder");
  code += extractExports(daeTypesCode, "./dae/types");
  code += extractExports(daeAccessorsCode, "./dae/accessors");
  code += extractExports(aliasCode, "./dae/alias");
  code += extractExports(evalCode, "./dae/eval");
  code += extractExports(eventsCode, "./simulation/events");
  code += extractExports(integratorsCode, "./solvers/integrators");
  code += extractExports(matrixCode, "./solvers/matrix");
  code += extractExports(stubCode, "./indexing/stub");
  code += extractExports(trigramCode, "./indexing/trigram");
  code += extractExports(ontologyCode, "./ontology_module/ontology");
  code += extractExports(ontology_projectionCode, "./ontology_module/ontology_projection");
  code += extractExports(builtins_mathCode, "./dae/builtins_math");
  code += extractExports(scope_stackCode, "./core/scope_stack");
  code += extractExports(string_poolCode, "./core/string_pool");
  code += extractExports(hashmapCode, "./core/hashmap");
  code += extractExports(casCode, "./dae/cas");
  code += extractExports(tapeCode, "./autodiff/tape");
  code += extractExports(foldCode, "./dae/fold");
  code += extractExports(tearingCode, "./structural/tearing");
  code += extractExports(pantelidesCode, "./structural/pantelides");
  code += extractExports(isolationCode, "./optimization/isolation");
  code += extractExports(scalarizeCode, "./dae/scalarize");
  code += extractExports(cseCode, "./cse");
  code += extractExports(coloringCode, "./autodiff/coloring");
  code += extractExports(sparse_luCode, "./solvers/sparse_lu");
  code += extractExports(sparse_choleskyCode, "./solvers/sparse_cholesky");
  code += extractExports(bdfCode, "./solvers/bdf");
  code += extractExports(homotopyCode, "./simulation/homotopy");
  code += extractExports(delayCode, "./simulation/delay");
  code += extractExports(fmi2_wasmCode, "./fmi/fmi2_wasm");
  code += extractExports(fmi3_wasmCode, "./fmi/fmi3_wasm");
  code += extractExports(vmapCode, "./simulation/vmap");
  code += extractExports(integrateCode, "./solvers/integrate");
  code += extractExports(intervalCode, "./autodiff/interval");
  code += extractExports(mccormickCode, "./autodiff/mccormick");
  code += extractExports(branch_and_boundCode, "./optimization/branch_and_bound");
  code += extractExports(dualCode, "./autodiff/dual");
  code += extractExports(monte_carloCode, "./simulation/monte_carlo");
  code += extractExports(doeCode, "./simulation/doe");
  code += extractExports(statementsCode, "./dae/statements");
  code += extractExports(verifierCode, "./simulation/verifier");

  // Section 11: Abstract Interpretation, CFG/SSA, and Custom Runtime Transpilation
  if (originalGrammar.cfgNodes || originalGrammar.analysis || Boolean(originalGrammar.domains?.["bounds"])) {
    let layoutContent = generateBlockLayoutConstants();
    let cfgContent = generateCFG(originalGrammar, grammar);
    let ssaContent = generateSSA();
    let aliasContent = generateAliasAnalysis();
    let octagonContent = generateOctagonDomain();
    let isolationContent = generateIsolationDomain(originalGrammar);
    let pantelidesContent = generatePantelidesDomain(originalGrammar);
    code += "\n" + extractExports(layoutContent, "./ir_layout");
    code += extractExports(cfgContent, "./cfg");
    code += extractExports(ssaContent, "./ssa");
    code += extractExports(aliasContent, "./alias-domain");
    code += extractExports(octagonContent, "./octagon");
    code += extractExports(isolationContent, "./isolation-domain");
    code += extractExports(pantelidesContent, "./pantelides-domain");
    outFiles.push({ filename: "ir_layout.ts", content: layoutContent });
    outFiles.push({ filename: "cfg.ts", content: cfgContent });
  }
  if (originalGrammar.analysis) {
    let dfContent = generateDataflow(originalGrammar);
    code += "\n" + extractExports(dfContent, "./dataflow");
    outFiles.push({ filename: "dataflow.ts", content: dfContent });
  }

  if (originalGrammar.classes || originalGrammar.functions) {
    let customRuntimeCode = `import { ChunkedUint32Array, ChunkedInt32Array, createChunkedUint32Array, createChunkedInt32Array } from "./array";
import { DaeBuilder, VarType, Variability, Causality, EqKind, ExprKind, BinOp, UnaryOp, FLAG_VAR_FLOW, FLAG_VAR_STREAM, FLAG_EQ_STREAM_CONNECT } from "./dae";
import { getNodeFirstChild, getNodeNextSibling, getNodeType, atomicChunkAlloc } from "./arena";
import { CorrespondenceIndex } from "./correspondence";
import { UnmanagedMap64, createMap64, UnmanagedSet64, createSet64 } from "./hashmap";
import { ArenaStringPool } from "./string_pool";
import { GenericScopeStack } from "./scope_stack";
import { BltEngine } from "./blt";
import { AdTape } from "./tape";

`;

    const sourceText = (originalGrammar as any).sourceText || (originalGrammar as any)[SOURCE_TEXT_SYMBOL];
    const ast = sourceText ? extractLanguageAST(sourceText) : sourcePath ? extractLanguageAST(sourcePath) : null;

    if (originalGrammar.classes) {
      const classList = Array.isArray(originalGrammar.classes)
        ? originalGrammar.classes
        : Object.entries(originalGrammar.classes);
      for (const cls of classList) {
        let clsTarget: any = cls;
        if (ast && ast.classes) {
          const clsName =
            typeof cls === "function" ? cls.name : typeof cls === "string" ? cls : Array.isArray(cls) ? cls[0] : "";
          if (clsName && ast.classes.has(clsName)) {
            clsTarget = ast.classes.get(clsName)!;
          }
        }
        if (Array.isArray(cls) && clsTarget === cls) {
          clsTarget = cls[1];
        }
        customRuntimeCode += transpileClass(clsTarget) + "\n\n";
      }
    }

    if (originalGrammar.functions) {
      const fnList = Array.isArray(originalGrammar.functions)
        ? originalGrammar.functions
        : Object.entries(originalGrammar.functions);
      for (const fn of fnList) {
        let fnTarget: any = fn;
        if (ast && ast.functions) {
          const fnName =
            typeof fn === "function" ? fn.name : typeof fn === "string" ? fn : Array.isArray(fn) ? fn[0] : "";
          if (fnName && ast.functions.has(fnName)) {
            fnTarget = ast.functions.get(fnName)!;
          }
        }
        if (Array.isArray(fn) && fnTarget === fn) {
          fnTarget = fn[1];
        }
        customRuntimeCode += transpileHelperFunction(fnTarget) + "\n\n";
      }
    }

    code += "\n" + extractExports(customRuntimeCode, "./custom_runtime");
    outFiles.push({ filename: "custom_runtime.ts", content: customRuntimeCode });
  }

  outFiles.find((f) => f.filename === "parser.ts")!.content = code;

  return outFiles;
}
