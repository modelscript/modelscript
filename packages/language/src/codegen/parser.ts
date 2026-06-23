/* eslint-disable */
import { GLRTable, LRAutomaton } from "../automata.js";
import { LanguageOptions } from "../dsl.js";
import { NormalizedGrammar } from "../grammar.js";

import {
  arenaCode,
  arrayCode,
  cursorCode,
  engineCode,
  gssCode,
  lspCode,
  recoveryCode,
} from "../../build/src-gen/runtime-templates.js";
import { generateCodeGraphBridge } from "./graph.js";
import { generateLexer } from "./lexer.js";
import { generateTypes } from "./types.js";

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
  let code = `import { ChunkedUint32Array, ChunkedInt32Array } from "./array";\nimport { allocNode, getInputBuffer } from "./arena";\nexport { getInputBuffer };\n\n@external("parser", "logInt")\ndeclare function logInt(val: i32): void;\n\n`;

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
      for (const act of acts) {
        actionData.push(act.type);
        actionData.push(act.target || 0);
      }
    }
  }

  const generateStaticArray = (arr: number[], name: string) => {
    if (arr.length === 0) return `export const ${name}: usize = memory.data<i32>([0, 0]) + 4;\n`;
    const chunks = [arr.length.toString()];
    for (let i = 0; i < arr.length; i++) {
      const val = arr[i] === undefined ? 1 : arr[i];
      chunks.push(val.toString());
    }
    return `export const ${name}: usize = memory.data<i32>([${chunks.join(", ")}]) + 4;\n`;
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

  const tokenInsertCosts: number[] = new Array(symToInt.size + 1).fill(1);
  for (const [sym, id] of symToInt.entries()) {
    if (sym.startsWith('"') && sym.match(/^"[A-Za-z0-9_]+"$/)) {
      tokenInsertCosts[id] = 3;
    } else if (sym.startsWith("/")) {
      tokenInsertCosts[id] = 2;
    } else {
      tokenInsertCosts[id] = 1;
    }
  }
  code += generateStaticArray(tokenInsertCosts, "token_insert_costs");

  const syncIds: number[] = [];
  for (const t of syncTokens) {
    const id = symToInt.get(`"${t}"`) || symToInt.get(t);
    if (id !== undefined) syncIds.push(id);
  }
  code += generateStaticArray(syncIds, "sync_tokens");

  const prodLengths: number[] = [];
  const prodLhs: number[] = [];
  const prodIsInvisible: number[] = [];
  const prodIsList: number[] = [];
  const prodDynamicPrec: number[] = [];
  const prodAliases: number[] = [];
  const aliasData: number[] = [];

  const sortedProds = [...grammar.productions].sort((a, b) => a.id - b.id);
  for (const p of sortedProds) {
    prodLengths.push(p.right.length);
    prodLhs.push(symToInt.get(p.left) || 0);
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
  code += generateStaticArray(prodLhs, "prod_lhs");
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

  code += `\nexport const MAX_TERMINAL_ID = ${grammar.terminals.size - 1};\n`;
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

  code += `\nexport * from "./engine";\nexport * from "./lsp";\nexport * from "./graph";\nexport * from "./arena";\n`;

  let engineCodeTemplate = engineCode;
  let lspCodeTemplate = lspCode;

  let lspImports = `import { inputLength, SyntaxType, type_semantics, type_semantic_data, type_is_folding, type_is_outline, MAX_TERMINAL_ID, executeLints } from "./parser";\n`;
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

  return [
    { filename: "parser.ts", content: code },
    { filename: "array.ts", content: arrayCode },
    { filename: "arena.ts", content: arenaCode },
    { filename: "cursor.ts", content: cursorCode },
    { filename: "engine.ts", content: engineCodeTemplate },
    { filename: "lsp.ts", content: lspCodeTemplate },
    { filename: "graph.ts", content: generateCodeGraphBridge(originalGrammar) },
    { filename: "gss.ts", content: gssCode },
    { filename: "recovery.ts", content: recoveryCode },
  ];
}
