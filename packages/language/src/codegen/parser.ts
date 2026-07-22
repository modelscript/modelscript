/* eslint-disable */
import { GLRTable, LRAutomaton } from "../automata.js";
import { LanguageOptions } from "../dsl.js";
import { NormalizedGrammar } from "../grammar.js";

import {
  arenaCode,
  arrayCode,
  bltCode,
  cursorCode,
  daeCode,
  engineCode,
  gssCode,
  hashmapCode,
  lspCode,
  parserLoopCode,
  recoveryCode,
} from "../../build/src-gen/runtime-templates.js";
import { generateEGraphEngine } from "./egraph.js";
import { generateCodeGraphBridge } from "./graph.js";
import { generateLexer } from "./lexer.js";
import { generateReasoner } from "./reasoner.js";
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
  const LEX_FN = preprocessorHook ? preprocessorHook : "lex";
  let code = `import { ChunkedUint32Array, ChunkedInt32Array, UnmanagedUint32Array } from "./array";\nimport { allocNode, getInputBuffer, atomicChunkAlloc } from "./arena";\nimport { DaeBuilder } from "./dae";\nexport { getInputBuffer };\n\n@external("parser", "logInt")\nexport declare function logInt(val: i32): void;\n\nexport function decodeHexIntArray(hex: string, numElements: i32): usize {\n  let ptr = atomicChunkAlloc(numElements * 4);\n  let arr = changetype<UnmanagedUint32Array>(ptr);\n  for (let i = 0; i < numElements; i++) {\n     let val: u32 = 0;\n     for (let j = 0; j < 8; j++) {\n        let c = hex.charCodeAt(i * 8 + j);\n        let nibble = c >= 97 ? c - 97 + 10 : (c >= 65 ? c - 65 + 10 : c - 48);\n        val = (val << 4) | (nibble as u32);\n     }\n     arr[i] = val;\n  }\n  return ptr;\n}\n\n`;

  // Lexer, Types, etc.
  code += generateTypes(originalGrammar, grammar);
  code += generateLexer(originalGrammar, grammar);

  code += `\n// GLR Parser Tables\n`;
  code += `// Generated for ${grammar.productions.length} productions and ${table.actionTable.size} states\n\n`;

  const symToInt = grammar.symToInt;
  code += `export const SYMBOL_COUNT = ${symToInt.size};\n`;
  code += `export const STATE_COUNT = ${table.actionTable.size};\n\n`;

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
    for (let i = 0; i < arr.length; i++) {
      const val = arr[i] === undefined ? 1 : arr[i];
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
  for (let i = 0; i < termList.length; i++) {
    const sym = termList[i];
    const symId = symToInt.get(sym) ?? i;
    if (
      sym.includes("}") ||
      sym.includes("]") ||
      sym.includes(")") ||
      sym.includes("RBRACE") ||
      sym.includes("RPAREN") ||
      sym.includes("RBRACKET")
    ) {
      tokenInsertCosts[symId] = 20; // Structural closing delimiters are expensive to insert to prevent premature block escape
    } else if (sym.startsWith('"') && sym.match(/^"[^a-zA-Z0-9_]+"$/)) {
      tokenInsertCosts[symId] = 1;
    } else if (sym.startsWith('"') || sym.startsWith("/")) {
      const freq = terminalFreq.get(sym) || 0;
      if (freq >= 5) {
        tokenInsertCosts[symId] = 1;
      } else if (freq >= 2) {
        tokenInsertCosts[symId] = 2;
      } else {
        tokenInsertCosts[symId] = 4;
      }
    } else {
      tokenInsertCosts[symId] = 4;
    }
  }
  code += generateStaticArray(tokenInsertCosts, "token_insert_costs");

  let maxTerminalId = 0;
  for (const term of grammar.terminals) {
    if (term !== "EOF" && term !== "ERROR") {
      maxTerminalId++;
    }
  }
  const sortedSymbols = Array.from({ length: symToInt.size }, (_, i) => i + 1).filter((id) => id <= maxTerminalId);
  sortedSymbols.sort((a, b) => tokenInsertCosts[a] - tokenInsertCosts[b]);
  code += generateStaticArray(sortedSymbols, "sorted_insertion_symbols");

  const MAX_REACHABILITY_DEPTH = 5;
  const reachabilityMatrix = new Uint8Array(table.actionTable.size * (maxTerminalId + 1));
  reachabilityMatrix.fill(255);

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

  console.log("Building Reachability Matrix for", table.actionTable.size, "states and", maxTerminalId, "terminals");

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

  console.log("StoredDefinition ID:", symToInt.get("StoredDefinition"));
  console.log("_START ID:", symToInt.get("_START"));
  console.log("MAX symId:", symToInt.size);
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
    if (
      p.left.endsWith("_list") ||
      p.left.endsWith("_clause") ||
      p.left.endsWith("_section") ||
      p.left.endsWith("_prefixes") ||
      p.left.includes("declaration") ||
      p.left.includes("definition") ||
      p.left.includes("statement") ||
      p.left.includes("specifier")
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

  const typeFields: number[] = new Array(symToInt.size + 1).fill(-1);
  const typeFieldData: number[] = [];

  for (let symId = 1; symId <= symToInt.size; symId++) {
    const fieldsMap = new Map<number, Set<number>>();
    for (const p of grammar.productions) {
      if ((symToInt.get(p.left) || 0) === symId && p.fields) {
        for (const f of p.fields) {
          if (!fieldsMap.has(f.fieldId)) {
            fieldsMap.set(f.fieldId, new Set<number>());
          }
          fieldsMap.get(f.fieldId)!.add(f.index);
        }
      }
    }

    if (fieldsMap.size > 0) {
      typeFields[symId] = typeFieldData.length;
      typeFieldData.push(fieldsMap.size);
      for (const [fieldId, indices] of fieldsMap.entries()) {
        typeFieldData.push(fieldId);
        typeFieldData.push(indices.size);
        for (const index of indices) {
          typeFieldData.push(index);
        }
      }
    }
  }

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

  code += `\nexport const MAX_TERMINAL_ID = ${maxTerminalId};\n`;
  code += `\nexport function invokeLexer(pos: u32): i32 { return ${LEX_FN}(pos); }\n`;

  let lintSwitchStr = `\nexport function executeLints(type: u16, node: u32, nodeStart: u32, nodeEnd: u32): void {\n  switch (type) {\n`;
  if (originalGrammar.lints) {
    let nextLintId = 2000;
    const nodeLints = new Map<string, string[]>();
    for (const [lintName, lint] of Object.entries(originalGrammar.lints)) {
      const lintId = nextLintId++;
      const fnName = `lint_${lintName}`;
      for (const nodeName of lint.nodes || []) {
        if (!nodeLints.has(nodeName)) nodeLints.set(nodeName, []);
        nodeLints.get(nodeName)!.push(`${fnName}(node, ${lintId}, nodeStart, nodeEnd);`);
      }
    }
    for (const [nodeName, fnCalls] of nodeLints.entries()) {
      lintSwitchStr += `    case <u16>SyntaxType.${nodeName.toUpperCase()}:\n`;
      for (const call of fnCalls) {
        lintSwitchStr += `      ${call}\n`;
      }
      lintSwitchStr += `      break;\n`;
    }
  }
  lintSwitchStr += "  }\n}\n";
  code += lintSwitchStr;

  const extractExports = (codeStr: string, moduleName: string) => {
    const exports: string[] = [];
    const regex = /^export\s+(function|const|let|var)\s+([a-zA-Z0-9_]+)/gm;
    let match;
    const ignoreList = new Set([
      "action_offsets",
      "action_data",
      "goto_offsets",
      "goto_data",
      "mrd_data",
      "token_insert_costs",
      "token_delete_costs",
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

  if (originalGrammar.typeSystem) {
    const tsCode = generateTypeSystem(originalGrammar, originalGrammar.typeSystem.customCode || "");
    code += "\n" + extractExports(tsCode, "./typesys");
  }
  if (originalGrammar.semantics) {
    const rsCode = generateReasoner(originalGrammar, grammar);
    code += "\n" + extractExports(rsCode, "./reasoner");
  }

  if (originalGrammar.simplification?.rules && originalGrammar.simplification.rules.length > 0) {
    code += `\n` + generateEGraphEngine(originalGrammar, originalGrammar.simplification.rules);
  } else {
    code += `\nexport function saturateEGraph(): void {}\nexport function initDPExtractor(): void {}\nexport function extractAst(rootClass: u32, dae: DaeBuilder): u32 { return 0; }\nexport function simplifyAst(exprId: u32, dae: DaeBuilder): u32 { return exprId; }\n`;
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

  let lspImports = `import { inputLength, inputEncoding, logInt, SyntaxType, peekChar, type_semantics, type_semantic_data, type_is_folding, type_is_outline, MAX_TERMINAL_ID, executeLints } from "./parser";\n`;
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

  lspCodeTemplate = lspCodeTemplate.replace('import { inputLength } from "./parser";', lspImports);

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
    { filename: "recovery.ts", content: recoveryCode },
    { filename: "dae.ts", content: daeCode },
    { filename: "blt.ts", content: bltCode },
    { filename: "hashmap.ts", content: hashmapCode },
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

  return outFiles;
}
