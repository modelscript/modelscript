import { GLRTable, LRAutomaton } from "../automata.js";
import { LanguageOptions, SOURCE_PATH_SYMBOL, SOURCE_TEXT_SYMBOL } from "../dsl.js";
import { NormalizedGrammar } from "../grammar.js";
import { extractLanguageAST } from "./ast-loader.js";

import {
  arenaCode,
  arrayCode,
  bdfCode,
  bltCode,
  builtins_mathCode,
  casCode,
  coloringCode,
  correspondenceCode,
  cseCode,
  cursorCode,
  daeCode,
  delayCode,
  engineCode,
  evalCode,
  eventsCode,
  flattenerCode,
  fmi3_wasmCode,
  foldCode,
  gssCode,
  hashmapCode,
  homotopyCode,
  integratorsCode,
  isolationCode,
  lspCode,
  matrixCode,
  ontologyCode,
  ontology_projectionCode,
  pantelidesCode,
  parserLoopCode,
  polyglot_arenaCode,
  recoveryCode,
  recoveryConfigCode,
  scalarizeCode,
  scope_stackCode,
  sparse_choleskyCode,
  sparse_luCode,
  string_poolCode,
  stubCode,
  tapeCode,
  tearingCode,
  trigramCode,
  vmapCode,
} from "../../build/src-gen/runtime-templates.js";
import { generateAliasAnalysis } from "./alias.js";
import { generateCFG } from "./cfg.js";
import { compileTGGRules } from "./compile_tgg.js";
import { generateDataflow } from "./dataflow.js";
import { generateEGraphEngine } from "./egraph.js";
import { generateCodeGraphBridge } from "./graph.js";
import { generateBlockLayoutConstants } from "./ir_layout.js";
import { generateIsolationDomain } from "./isolation.js";
import { generateLexer } from "./lexer.js";
import { generateOctagonDomain } from "./octagon.js";
import { generatePantelidesDomain } from "./pantelides.js";
import { generateReasoner } from "./reasoner.js";
import { generateSAT } from "./sat.js";
import { generateSimplex } from "./simplex.js";
import { generateSSA } from "./ssa.js";
import { transpileClass, transpileHelperFunction } from "./transpiler.js";
import { generateTypes } from "./types.js";
import { generateTypeSystem } from "./typesys.js";

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
  let code = `import { ChunkedUint32Array, ChunkedInt32Array, UnmanagedUint32Array } from "./array";\nimport { allocNode, getInputBuffer, atomicChunkAlloc, getArenaOffset, getNodeType, getNodeFirstChild, getNodeNextSibling } from "./arena";\nimport { DaeBuilder } from "./dae";\nimport { allocDiagnostic } from "./graph";\nimport { CorrespondenceIndex } from "./correspondence";\nimport { PolyglotArena } from "./polyglot_arena";\nexport { getInputBuffer } from "./arena";\n\n@external("parser", "logInt")\nexport declare function logInt(val: i32): void;\n\nexport function decodeHexIntArray(hex: string, numElements: i32): usize {
  let raw = atomicChunkAlloc((numElements + 1) * 4);
  let ptr = (raw + 3) & ~3;
  store<i32>(ptr, numElements);
  let dataPtr = ptr + 4;
  let arr = changetype<UnmanagedUint32Array>(dataPtr);
  for (let i = 0; i < numElements; i++) {
     let val: u32 = 0;
     for (let j = 0; j < 8; j++) {
        let c = hex.charCodeAt(i * 8 + j);
        let nibble = c >= 97 ? c - 97 + 10 : (c >= 65 ? c - 65 + 10 : c - 48);
        val = (val << 4) | (nibble as u32);
     }
     arr[i] = val;
  }
  return dataPtr;
}\n\nexport let expected_tokens: usize = 0;\n\n`;

  // Types & SyntaxType enum
  code += generateTypes(originalGrammar, grammar);

  code += `\n// GLR Parser Tables\n`;
  code += `// Generated for ${grammar.productions.length} productions and ${table.actionTable.size} states\n\n`;

  const symToInt = grammar.symToInt;
  const startSymName = Object.keys(originalGrammar.rules)[0] || "Program";
  const startSymId = symToInt.get(startSymName) || 1;
  code += `export const SYMBOL_COUNT = ${symToInt.size};\n`;
  code += `export const STATE_COUNT = ${table.actionTable.size};\n`;
  code += `export const START_SYMBOL_ID = ${startSymId};\n\n`;

  const actionOffsets: number[] = [];
  const actionData: number[] = [];

  for (let stateId = 0; stateId < table.actionTable.size; stateId++) {
    actionOffsets.push(actionData.length);
    const actions = table.actionTable.get(stateId)!;
    actionData.push(actions.size);
    for (const [sym, acts] of actions.entries()) {
      actionData.push(symToInt.get(sym)!);
      actionData.push(acts.length);

      const sortedActs = [...acts].sort((a, b) => {
        if (a.type !== 1 || b.type !== 1) return 0; // 1 is ActionType.REDUCE
        const prodA = grammar.productions.find((p) => p.id === a.target);
        const prodB = grammar.productions.find((p) => p.id === b.target);
        const precDiff = (prodB?.dynamicPrec || 0) - (prodA?.dynamicPrec || 0);
        if (precDiff !== 0) return precDiff;
        return (b.target || 0) - (a.target || 0);
      });

      for (const act of sortedActs) {
        actionData.push(act.type);
        actionData.push(act.target || 0);
      }
    }
  }

  const generateStaticArray = (arr: number[], name: string) => {
    if (arr.length === 0) return `export const ${name}: usize = memory.data<i32>([0, 0]) + 4;\n`;
    let hex = "";
    for (const item of arr) {
      const val = item === undefined ? 1 : item;
      hex += (val >>> 0).toString(16).padStart(8, "0");
    }
    return `export const ${name}: usize = decodeHexIntArray("${hex}", ${arr.length});\n`;
  };

  code += generateStaticArray(actionOffsets, "action_offsets");
  code += generateStaticArray(actionData, "action_data");

  const gotoOffsets: number[] = [];
  const gotoData: number[] = [];

  for (let stateId = 0; stateId < table.gotoTable.size; stateId++) {
    gotoOffsets.push(gotoData.length);
    const gotos = table.gotoTable.get(stateId)!;
    gotoData.push(gotos.size);
    for (const [sym, target] of gotos.entries()) {
      gotoData.push(symToInt.get(sym)!);
      gotoData.push(target);
    }
  }

  code += generateStaticArray(gotoOffsets, "goto_offsets");
  code += generateStaticArray(gotoData, "goto_data");

  const mrd = table.automaton.computeMRD();
  code += generateStaticArray(mrd, "mrd_data");

  const terminalFreq = new Map<string, number>();
  for (const p of grammar.productions) {
    for (const sym of p.right) {
      terminalFreq.set(sym, (terminalFreq.get(sym) || 0) + 1);
    }
  }

  const termList = Array.from(grammar.terminals);
  const tokenInsertCosts: number[] = new Array(termList.length + 5).fill(1);

  // 1. Analyze grammar productions for structural roles (Tree-sitter style)
  const structuralOpeners = new Set<string>();
  const structuralClosers = new Set<string>();
  const structuralSeparators = new Set<string>();

  for (const p of grammar.productions) {
    const rhs = p.right;
    if (rhs.length === 0) continue;

    const firstSym = rhs[0];
    const lastSym = rhs[rhs.length - 1];

    if (grammar.terminals.has(firstSym)) {
      structuralOpeners.add(firstSym);
    }
    if (grammar.terminals.has(lastSym)) {
      structuralClosers.add(lastSym);
    }

    // Infix separators: terminals flanked by non-terminals in sequences/repetitions
    for (let i = 1; i < rhs.length - 1; i++) {
      const sym = rhs[i];
      if (grammar.terminals.has(sym) && grammar.nonTerminals.has(rhs[i - 1]) && grammar.nonTerminals.has(rhs[i + 1])) {
        if (p.prec === undefined && !p.assoc) {
          structuralSeparators.add(sym);
        }
      }
    }
  }

  const grammarOperators = new Set<string>();
  for (const p of grammar.productions) {
    const rhs = p.right;
    if (p.prec !== undefined || p.assoc !== undefined) {
      for (const sym of rhs) {
        if (grammar.terminals.has(sym)) {
          grammarOperators.add(sym);
        }
      }
    } else if (rhs.length === 3) {
      const [left, op, right] = rhs;
      if (grammar.nonTerminals.has(left) && grammar.terminals.has(op) && grammar.nonTerminals.has(right)) {
        grammarOperators.add(op);
      }
    }
  }

  const customDelims = originalGrammar.recovery?.delimiters || [];
  const customOps = originalGrammar.recovery?.operators || [];
  for (const op of customOps) {
    grammarOperators.add(op);
  }

  for (let i = 0; i < termList.length; i++) {
    const sym = termList[i];
    const symId = symToInt.get(sym) ?? i;
    const cleanSym = sym.replace(/^"|"$/g, "");

    const isCustomDelim = customDelims.includes(sym) || customDelims.includes(cleanSym);
    const isOperator = grammarOperators.has(sym) || grammarOperators.has(cleanSym);
    const isWord = /^[a-zA-Z_]/.test(cleanSym);

    const isStructuralDelimiter =
      isCustomDelim ||
      ((structuralClosers.has(sym) || structuralOpeners.has(sym)) &&
        !isWord &&
        cleanSym !== ";" &&
        cleanSym !== "," &&
        cleanSym !== ":");

    if (cleanSym === ";" || cleanSym === "," || cleanSym === ":") {
      tokenInsertCosts[symId] = 1; // Low cost strictly for structural punctuation and list separators ; , :
    } else {
      tokenInsertCosts[symId] = 50; // Restricted insertion cost (50) for operators (=, +, -, etc.), keywords, types, block delimiters, and data terminals
    }
  }
  code += generateStaticArray(tokenInsertCosts, "token_insert_costs");

  const tokenIsWord = new Array(symToInt.size + 1).fill(0);
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
  code += generateStaticArray(tokenIsWord, "token_is_word");

  const tokenIsOperator = new Array(symToInt.size + 1).fill(0);
  for (const [sym, symId] of symToInt.entries()) {
    const cleanSym = sym.replace(/^"|"$/g, "");
    if (grammarOperators.has(sym) || grammarOperators.has(cleanSym)) {
      tokenIsOperator[symId] = 1;
    }
  }
  code += generateStaticArray(tokenIsOperator, "token_is_operator");

  let maxTerminalId = 0;
  for (const term of grammar.terminals) {
    if (term !== "EOF" && term !== "ERROR") {
      maxTerminalId++;
    }
  }
  const sortedSymbols = Array.from({ length: symToInt.size }, (_, i) => i + 1).filter((id) => id <= maxTerminalId);
  sortedSymbols.sort((a, b) => tokenInsertCosts[a] - tokenInsertCosts[b]);
  code += generateStaticArray(sortedSymbols, "sorted_insertion_symbols");

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

  // Precompute GOTO targets for each non-terminal
  const gotoTargets = new Map<number, number[]>();
  for (let stateId = 0; stateId < table.actionTable.size; stateId++) {
    const gotos = table.gotoTable.get(stateId);
    if (gotos) {
      for (const [sym, nextState] of gotos.entries()) {
        const symId = symToInt.get(sym);
        if (symId !== undefined) {
          if (!gotoTargets.has(symId)) gotoTargets.set(symId, []);
          gotoTargets.get(symId)!.push(nextState);
        }
      }
    }
  }

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
          for (const act of acts) {
            if (act.type === 0 && act.target !== undefined) {
              const nextState = act.target;
              for (let t = 1; t <= maxTerminalId; t++) {
                const altCost = 1 + reachabilityMatrix[nextState * (maxTerminalId + 1) + t];
                if (altCost < newMatrix[stateId * (maxTerminalId + 1) + t]) {
                  newMatrix[stateId * (maxTerminalId + 1) + t] = altCost;
                  matrixChanged = true;
                }
              }
            } else if (act.type === 1 && act.target !== undefined) {
              // REDUCE action: cost is 0 GSS transitions (reductions are "free" lookahead steps)
              const prod = table.grammar.productions[act.target];
              const ruleSymId = symToInt.get(prod.left);
              if (ruleSymId !== undefined && gotoTargets.has(ruleSymId)) {
                for (const nextState of gotoTargets.get(ruleSymId)!) {
                  for (let t = 1; t <= maxTerminalId; t++) {
                    const altCost = reachabilityMatrix[nextState * (maxTerminalId + 1) + t];
                    if (altCost < newMatrix[stateId * (maxTerminalId + 1) + t]) {
                      newMatrix[stateId * (maxTerminalId + 1) + t] = altCost;
                      matrixChanged = true;
                    }
                  }
                }
              }
            }
          }
        }
      }
      if (gotos) {
        for (const [sym, nextState] of gotos.entries()) {
          const cost = 1; // GOTO counts as 1 GSS transition (shifting a non-terminal)
          for (let t = 1; t <= maxTerminalId; t++) {
            const altCost = cost + reachabilityMatrix[nextState * (maxTerminalId + 1) + t];
            if (altCost < newMatrix[stateId * (maxTerminalId + 1) + t]) {
              newMatrix[stateId * (maxTerminalId + 1) + t] = altCost;
              matrixChanged = true;
            }
          }
        }
      }
    }
    reachabilityMatrix.set(newMatrix);
  }
  code += generateStaticArray(Array.from(reachabilityMatrix), "reachability_matrix");

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
        const cost = reachabilityMatrix[targetState * (maxTerminalId + 1) + unexpectedTok];
        if (cost < minCost) {
          minCost = cost;
          bestRepairTok = symId;
        }
      }

      precomputedRepairs[stateId * (maxTerminalId + 1) + unexpectedTok] = bestRepairTok;
    }
  }
  code += generateStaticArray(Array.from(precomputedRepairs), "precomputed_repairs");

  // Literal terminal strings for keyword/symbol similarity matching
  const tokenStringOffsets: number[] = new Array(symToInt.size + 1).fill(-1);
  const tokenStringBytes: number[] = [];
  for (const [sym, symId] of symToInt.entries()) {
    if (sym.startsWith('"') && sym.endsWith('"') && sym.length > 2) {
      const literal = sym.slice(1, -1);
      tokenStringOffsets[symId] = tokenStringBytes.length;
      tokenStringBytes.push(literal.length);
      for (let i = 0; i < literal.length; i++) {
        tokenStringBytes.push(literal.charCodeAt(i));
      }
    }
  }
  code += generateStaticArray(tokenStringOffsets, "token_string_offsets");
  code += generateStaticArray(tokenStringBytes, "token_string_bytes");

  const syncIds: number[] = [];
  for (const t of syncTokens) {
    const id = symToInt.get(`"${t}"`) || symToInt.get(t);
    if (id !== undefined) syncIds.push(id);
  }
  code += generateStaticArray(syncIds, "sync_tokens");

  // 1. Identify list separators
  const listSeparators = new Set<string>();
  for (const p of grammar.productions) {
    if (p.isList && p.right.length >= 2 && p.right[0] === p.left) {
      const potentialSeparator = p.right[1];
      if (grammar.terminals.has(potentialSeparator)) {
        listSeparators.add(potentialSeparator);
      }
    }
  }

  // 2. Generate tokenDeleteCosts
  const tokenDeleteCosts: number[] = new Array(symToInt.size + 1).fill(10);
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

  code += generateStaticArray(tokenDeleteCosts, "token_delete_costs");

  // 3. Compute Minimal Yield Terminal Sequences (Phase 3)
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
      let sequence: number[] = [];

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

  const minYieldOffsets: number[] = new Array(symToInt.size + 1).fill(0);
  const minYieldData: number[] = [];

  for (let symId = 1; symId <= symToInt.size; symId++) {
    minYieldOffsets[symId] = minYieldData.length;
    let symName = "";
    for (const [s, id] of symToInt.entries()) {
      if (id === symId) {
        symName = s;
        break;
      }
    }
    const seq = symName ? minYieldMap.get(symName) : undefined;
    if (seq) {
      minYieldData.push(seq.length);
      for (const tId of seq) {
        minYieldData.push(tId);
      }
    } else {
      minYieldData.push(0);
    }
  }

  code += generateStaticArray(minYieldOffsets, "min_yield_offsets");
  code += generateStaticArray(minYieldData, "min_yield_data");

  // 4. Compute Scope Dominator & Boundary Bitmaps (Phase 4)
  const stateScopeBounds = new Uint8Array(table.actionTable.size * (maxTerminalId + 1));
  for (let stateId = 0; stateId < table.actionTable.size; stateId++) {
    const lrState = table.automaton.states[stateId];
    if (!lrState) continue;

    for (const item of lrState.items) {
      for (let pos = item.dot; pos < item.production.right.length; pos++) {
        const sym = item.production.right[pos];
        if (grammar.terminals.has(sym)) {
          const symId = symToInt.get(sym);
          const cleanSym = sym.replace(/^"|"$/g, "");
          const isBoundary =
            cleanSym === "}" ||
            cleanSym === "]" ||
            cleanSym === ")" ||
            cleanSym === ";" ||
            cleanSym === "end" ||
            cleanSym === "else" ||
            cleanSym === "elseif";

          if (isBoundary && symId !== undefined && symId <= maxTerminalId) {
            stateScopeBounds[stateId * (maxTerminalId + 1) + symId] = 1;
          }
        }
      }

      if (item.dot === item.production.right.length) {
        for (const la of item.lookahead) {
          const cleanLa = la.replace(/^"|"$/g, "");
          const isBoundary =
            cleanLa === "}" || cleanLa === "]" || cleanLa === ")" || cleanLa === ";" || cleanLa === "end";
          const symId = symToInt.get(la);
          if (isBoundary && symId !== undefined && symId <= maxTerminalId) {
            stateScopeBounds[stateId * (maxTerminalId + 1) + symId] = 1;
          }
        }
      }
    }
  }
  code += generateStaticArray(Array.from(stateScopeBounds), "state_scope_bounds");

  const prodLengths: number[] = [];
  const prodRightOffsets: number[] = [];
  const prodRightSymbols: number[] = [];
  const prodLhs: number[] = [];
  const prodIsStructural: number[] = [];
  const prodIsInvisible: number[] = [];
  const prodIsList: number[] = [];
  const prodDynamicPrec: number[] = [];
  const prodAliases: number[] = [];
  const aliasData: number[] = [];

  const customStructural = originalGrammar.recovery?.structuralRules || [];

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

    let isStructural = 0;
    if (customStructural.length > 0) {
      isStructural = customStructural.includes(p.left as any) ? 1 : 0;
    } else {
      if (
        p.left.endsWith("_list") ||
        p.left.endsWith("_clause") ||
        p.left.endsWith("_section") ||
        p.left.endsWith("_prefixes") ||
        p.left.includes("declaration") ||
        p.left.includes("definition") ||
        p.left.includes("statement") ||
        p.left.includes("specifier") ||
        p.left.includes("block") ||
        p.left.includes("suite")
      ) {
        isStructural = 1;
      }
      if (
        p.left.includes("expression") ||
        p.left.includes("term") ||
        p.left.includes("factor") ||
        p.left.includes("literal")
      ) {
        isStructural = 0;
      }
    }
    prodIsStructural.push(isStructural);

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

  const maxSymId = Math.max(0, ...Array.from(symToInt.values()));
  const typeFields: number[] = new Array(maxSymId + 1).fill(-1);
  const typeFieldData: number[] = [];

  let maxSyntheticDepth = 0;

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
        if (p.fields) {
          for (const f of p.fields) {
            if (!map.has(f.fieldId)) map.set(f.fieldId, []);
            const childSym = p.right[f.index];
            const expectedType = symToInt.get(childSym) || 0;
            const list = map.get(f.fieldId)!;
            if (!list.some((e) => e.index === f.index && e.expectedType === expectedType)) {
              list.push({ index: f.index, expectedType });
            }
          }
        }
        for (let i = 0; i < p.right.length; i++) {
          const childSym = p.right[i];
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

  const typeSemantics: number[] = new Array(symToInt.size + 1).fill(-1);
  const typeSemanticData: number[] = [];

  for (let symId = 1; symId <= symToInt.size; symId++) {
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

  code += generateStaticArray(prodLengths, "prod_lengths");
  code += generateStaticArray(prodRightOffsets, "prod_right_offsets");
  code += generateStaticArray(prodRightSymbols, "prod_right_symbols");
  code += generateStaticArray(prodLhs, "prod_lhs");
  code += generateStaticArray(prodIsStructural, "prod_is_structural");
  code += generateStaticArray(prodIsInvisible, "prod_is_invisible");
  code += generateStaticArray(prodIsList, "prod_is_list");
  code += generateStaticArray(prodDynamicPrec, "prod_dynamic_prec");
  code += generateStaticArray(prodAliases, "prod_aliases");
  code += generateStaticArray(aliasData.length > 0 ? aliasData : [0], "alias_data");
  code += generateStaticArray(typeFields, "type_fields");
  code += generateStaticArray(typeFieldData.length > 0 ? typeFieldData : [0], "type_field_data");
  code += generateStaticArray(typeSemantics, "type_semantics");
  code += generateStaticArray(typeSemanticData.length > 0 ? typeSemanticData : [0], "type_semantic_data");

  const typeIsList: number[] = new Array(symToInt.size + 1).fill(0);
  for (let p = 0; p < prodLhs.length; p++) {
    if (prodIsList[p] === 1) typeIsList[prodLhs[p]] = 1;
  }
  code += generateStaticArray(typeIsList, "type_is_list");

  const typeIsFolding: number[] = new Array(symToInt.size + 1).fill(0);
  if (originalGrammar.lsp && originalGrammar.lsp.folding) {
    for (const f of originalGrammar.lsp.folding) {
      const id = symToInt.get(f) || symToInt.get(`"${f}"`);
      if (id !== undefined) typeIsFolding[id] = 1;
    }
  }
  code += generateStaticArray(typeIsFolding, "type_is_folding");

  const typeIsOutline: number[] = new Array(symToInt.size + 1).fill(0);
  if (originalGrammar.lsp && originalGrammar.lsp.outline) {
    for (const f of originalGrammar.lsp.outline) {
      const id = symToInt.get(f) || symToInt.get(`"${f}"`);
      if (id !== undefined) typeIsOutline[id] = 1;
    }
  }
  code += generateStaticArray(typeIsOutline, "type_is_outline");

  const typeIsSymbol: number[] = new Array(symToInt.size + 1).fill(0);
  const symbolNameField: number[] = new Array(symToInt.size + 1).fill(0);
  const symbolIsScope: number[] = new Array(symToInt.size + 1).fill(0);

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

  code += generateLexer(originalGrammar, grammar);

  code += `\nexport const MAX_TERMINAL_ID = ${maxTerminalId};\nexport const MAX_SYMBOL_ID = ${symToInt.size};\nexport const MAX_FIELD_CURSOR_DEPTH: i32 = ${maxFieldCursorDepth};\n`;
  code += `\nexport function invokeLexer(pos: u32): i32 { return ${LEX_FN}(pos); }\n`;

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
    lintSwitchStr += `\nexport function executeLints(type: u16, node: u32, nodeStart: u32, nodeEnd: u32): void {}\n`;
  }
  code += lintSwitchStr;

  const extractExports = (codeStr: string, moduleName: string) => {
    const exports: string[] = [];
    const regex =
      /^export\s+(?:@(?:unmanaged|inline)\s+)?(?:abstract\s+)?(function|const|let|var|class|enum|type|interface)\s+([a-zA-Z0-9_]+)/gm;
    let match;
    const ignoreList = new Set([
      "action_offsets",
      "action_data",
      "goto_offsets",
      "goto_data",
      "mrd_data",
      "token_insert_costs",
      "token_delete_costs",
      "token_is_word",
      "token_is_operator",
      "reachability_matrix",
      "precomputed_repairs",
      "token_string_offsets",
      "token_string_bytes",
      "sorted_insertion_symbols",
      "prod_lengths",
      "prod_right_offsets",
      "prod_right_symbols",
      "prod_lhs",
      "prod_is_structural",
      "prod_is_invisible",
      "prod_is_list",
      "prod_dynamic_prec",
      "prod_aliases",
      "alias_data",
      "type_fields",
      "type_field_data",
      "type_is_list",
      "expected_tokens",
    ]);
    while ((match = regex.exec(codeStr)) !== null) {
      if (!ignoreList.has(match[2])) {
        exports.push(match[2]);
      }
    }
    if (exports.length > 0) {
      return `export { ${exports.join(", ")} } from "${moduleName}";\n`;
    }
    return "";
  };

  code += "\n";
  code += extractExports(engineCode, "./engine");
  code += extractExports(lspCode, "./lsp");
  code += extractExports(generateCodeGraphBridge(originalGrammar), "./graph");
  code += extractExports(arenaCode, "./arena");
  code += extractExports(parserLoopCode, "./parser-loop");
  code += extractExports(gssCode, "./gss");
  code += extractExports(recoveryCode, "./recovery");
  code += extractExports(bltCode, "./blt");
  code += extractExports(correspondenceCode, "./correspondence");
  code += extractExports(polyglot_arenaCode, "./polyglot_arena");
  code += extractExports(flattenerCode, "./flattener");

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

  if (originalGrammar.simplification?.rules && originalGrammar.simplification.rules.length > 0) {
    code += `\n` + generateEGraphEngine(originalGrammar, originalGrammar.simplification.rules);
  } else {
    code += `\nexport function saturateEGraph(): void {}\nexport function initDPExtractor(): void {}\nexport function extractAst(rootClass: u32, dae: DaeBuilder): u32 { return 0; }\nexport function simplifyAst(exprId: u32, dae: DaeBuilder): u32 { return exprId; }\nexport function proveInductive(rootNode: u32, dae: DaeBuilder): boolean { return false; }\n`;
  }

  let engineCodeTemplate = engineCode;
  let daeCodeTemplate = daeCode;
  let bltCodeTemplate = bltCode;

  const hasToken = (str: string) => Array.from(symToInt.keys()).includes(`"${str}"`);
  engineCodeTemplate = engineCodeTemplate
    .replace("export const CHAR_LBRACE: u8 = 123;", `export const CHAR_LBRACE: u8 = ${hasToken("{") ? 123 : 0};`)
    .replace("export const CHAR_RBRACE: u8 = 125;", `export const CHAR_RBRACE: u8 = ${hasToken("}") ? 125 : 0};`)
    .replace("export const CHAR_LBRACKET: u8 = 91;", `export const CHAR_LBRACKET: u8 = ${hasToken("[") ? 91 : 0};`)
    .replace("export const CHAR_RBRACKET: u8 = 93;", `export const CHAR_RBRACKET: u8 = ${hasToken("]") ? 93 : 0};`)
    .replace("export const CHAR_LPAREN: u8 = 40;", `export const CHAR_LPAREN: u8 = ${hasToken("(") ? 40 : 0};`)
    .replace("export const CHAR_RPAREN: u8 = 41;", `export const CHAR_RPAREN: u8 = ${hasToken(")") ? 41 : 0};`);
  let lspCodeTemplate = lspCode;

  let lspImports = `import { inputLength, inputEncoding, logInt, SyntaxType, peekChar, type_semantics, type_semantic_data, type_is_folding, type_is_outline, MAX_TERMINAL_ID, MAX_SYMBOL_ID, executeLints } from "./parser";\n`;
  let importedLints = new Set<string>();
  if (originalGrammar.lints) {
    for (const lintName of Object.keys(originalGrammar.lints)) {
      importedLints.add(`lint_${lintName}`);
    }
  }
  if (importedLints.size > 0) {
    lspImports += `import { ${Array.from(importedLints).join(", ")}, lsp_invokeDefinition } from "./graph";\n`;
  } else {
    lspImports += `import { lsp_invokeDefinition } from "./graph";\n`;
  }

  lspCodeTemplate = lspCodeTemplate.replace(/import\s*\{[^}]*\}\s*from\s*"[^"]*parser";/, lspImports);

  const outFiles: GeneratedFile[] = [
    { filename: "parser.ts", content: code },
    { filename: "array.ts", content: arrayCode },
    { filename: "arena.ts", content: arenaCode },
    { filename: "cursor.ts", content: cursorCode },
    { filename: "engine.ts", content: engineCodeTemplate },
    { filename: "lsp.ts", content: lspCodeTemplate },
    { filename: "graph.ts", content: generateCodeGraphBridge(originalGrammar) },
    { filename: "parser-loop.ts", content: parserLoopCode },
    { filename: "gss.ts", content: gssCode },
    { filename: "recovery-config.ts", content: recoveryConfigCode },
    { filename: "recovery.ts", content: recoveryCode },
    { filename: "dae.ts", content: daeCode },
    { filename: "blt.ts", content: bltCode },
    { filename: "eval.ts", content: evalCode },
    { filename: "events.ts", content: eventsCode },
    { filename: "integrators.ts", content: integratorsCode },
    { filename: "matrix.ts", content: matrixCode },
    { filename: "hashmap.ts", content: hashmapCode },
    { filename: "isolation.ts", content: isolationCode },
    { filename: "pantelides.ts", content: pantelidesCode },
    { filename: "stub.ts", content: stubCode },
    { filename: "trigram.ts", content: trigramCode },
    { filename: "correspondence.ts", content: correspondenceCode },
    { filename: "polyglot_arena.ts", content: polyglot_arenaCode },
    { filename: "ontology.ts", content: ontologyCode },
    { filename: "ontology_projection.ts", content: ontology_projectionCode },
    { filename: "builtins_math.ts", content: builtins_mathCode },
    { filename: "scope_stack.ts", content: scope_stackCode },
    { filename: "string_pool.ts", content: string_poolCode },
    { filename: "cas.ts", content: casCode },
    { filename: "tape.ts", content: tapeCode },
    { filename: "flattener.ts", content: flattenerCode },
    { filename: "fold.ts", content: foldCode },
    { filename: "tearing.ts", content: tearingCode },
    { filename: "scalarize.ts", content: scalarizeCode },
    { filename: "cse.ts", content: cseCode },
    { filename: "coloring.ts", content: coloringCode },
    { filename: "sparse_lu.ts", content: sparse_luCode },
    { filename: "sparse_cholesky.ts", content: sparse_choleskyCode },
    { filename: "bdf.ts", content: bdfCode },
    { filename: "homotopy.ts", content: homotopyCode },
    { filename: "delay.ts", content: delayCode },
    { filename: "fmi3_wasm.ts", content: fmi3_wasmCode },
    { filename: "vmap.ts", content: vmapCode },
  ];

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

  code += extractExports(arenaCode, "./arena");
  code += extractExports(daeCode, "./dae");
  code += extractExports(bltCode, "./blt");
  code += extractExports(evalCode, "./eval");
  code += extractExports(eventsCode, "./events");
  code += extractExports(integratorsCode, "./integrators");
  code += extractExports(matrixCode, "./matrix");
  code += extractExports(stubCode, "./stub");
  code += extractExports(trigramCode, "./trigram");
  code += extractExports(ontologyCode, "./ontology");
  code += extractExports(ontology_projectionCode, "./ontology_projection");
  code += extractExports(builtins_mathCode, "./builtins_math");
  code += extractExports(scope_stackCode, "./scope_stack");
  code += extractExports(string_poolCode, "./string_pool");
  code += extractExports(hashmapCode, "./hashmap");
  code += extractExports(casCode, "./cas");
  code += extractExports(tapeCode, "./tape");
  code += extractExports(foldCode, "./fold");
  code += extractExports(tearingCode, "./tearing");
  code += extractExports(pantelidesCode, "./pantelides");
  code += extractExports(isolationCode, "./isolation");
  code += extractExports(scalarizeCode, "./scalarize");
  code += extractExports(cseCode, "./cse");
  code += extractExports(coloringCode, "./coloring");
  code += extractExports(sparse_luCode, "./sparse_lu");
  code += extractExports(sparse_choleskyCode, "./sparse_cholesky");
  code += extractExports(bdfCode, "./bdf");
  code += extractExports(homotopyCode, "./homotopy");
  code += extractExports(delayCode, "./delay");
  code += extractExports(fmi3_wasmCode, "./fmi3_wasm");
  code += extractExports(vmapCode, "./vmap");

  if (originalGrammar.cfgNodes || originalGrammar.analysis) {
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
    code += extractExports(aliasContent, "./alias");
    code += extractExports(octagonContent, "./octagon");
    code += extractExports(isolationContent, "./isolation-domain");
    code += extractExports(pantelidesContent, "./pantelides-domain");
    outFiles.push({ filename: "ir_layout.ts", content: layoutContent });
    outFiles.push({ filename: "cfg.ts", content: cfgContent });
    outFiles.push({ filename: "ssa.ts", content: ssaContent });
    outFiles.push({ filename: "alias.ts", content: aliasContent });
    outFiles.push({ filename: "octagon.ts", content: octagonContent });
    outFiles.push({ filename: "isolation-domain.ts", content: isolationContent });
    outFiles.push({ filename: "pantelides-domain.ts", content: pantelidesContent });
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

    const sourcePath = (originalGrammar as any).sourcePath || (originalGrammar as any)[SOURCE_PATH_SYMBOL];
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
