/* eslint-disable */
import { GLRTable, LRAutomaton } from "../automata.js";
import { CompilerOptions, GrammarOptions } from "../dsl.js";
import { NormalizedGrammar } from "../grammar.js";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateLexer } from "./lexer.js";
import { generateTypes } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ParserGenerationResult {
  grammar: NormalizedGrammar;
  automaton: LRAutomaton;
  table: GLRTable;
}

/**
 * Generates a parser (grammar, automaton, and GLR table) from a DSL definition.
 *
 * @param options The compiler options / DSL definition
 * @returns The generated grammar, LR automaton, and GLR action/goto tables
 */
export function generateParser<RuleName extends string>(options: CompilerOptions<RuleName>): ParserGenerationResult {
  const grammar = new NormalizedGrammar(options as unknown as GrammarOptions);
  const automaton = new LRAutomaton(grammar);
  const table = new GLRTable(grammar, automaton);

  return { grammar, automaton, table };
}

export interface GeneratedFile {
  filename: string;
  content: string;
}
export function generateParserTables(
  originalGrammar: GrammarOptions,
  grammar: NormalizedGrammar,
  table: GLRTable,
  syncTokens: string[] = [],
  preprocessorHook = "",
): GeneratedFile[] {
  const LEX_FN = preprocessorHook ? preprocessorHook : "lex";
  let code = `import { ChunkedUint32Array, ChunkedInt32Array } from "./array";\nimport { allocNode, arenaBuffer, getInputBuffer } from "./arena";\nexport { getInputBuffer };\n\n@external("parser", "logInt")\ndeclare function logInt(val: i32): void;\n\n`;

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

  code += generateStaticArray(prodLengths, "prod_lengths");
  code += generateStaticArray(prodLhs, "prod_lhs");
  code += generateStaticArray(prodIsInvisible, "prod_is_invisible");
  code += generateStaticArray(prodIsList, "prod_is_list");
  code += generateStaticArray(prodDynamicPrec, "prod_dynamic_prec");
  code += generateStaticArray(prodAliases, "prod_aliases");
  code += generateStaticArray(aliasData.length > 0 ? aliasData : [0], "alias_data");

  code += `\nexport * from "./engine";\n`;

  const arrayCode = fs
    .readFileSync(path.resolve(__dirname, "../../src/codegen/runtime/array.ts"), "utf8")
    .replace("// @ts-nocheck\n", "");
  const arenaCode = fs
    .readFileSync(path.resolve(__dirname, "../../src/codegen/runtime/arena.ts"), "utf8")
    .replace("// @ts-nocheck\n", "");
  const cursorCode = fs
    .readFileSync(path.resolve(__dirname, "../../src/codegen/runtime/cursor.ts"), "utf8")
    .replace("// @ts-nocheck\n", "");
  let engineCode = fs
    .readFileSync(path.resolve(__dirname, "../../src/codegen/runtime/engine.ts"), "utf8")
    .replace("// @ts-nocheck\n", "");

  engineCode = engineCode.replace(/__LEX_FN__/g, LEX_FN);
  engineCode = engineCode.replace(/__PREPROCESSOR_HOOK__/g, preprocessorHook);

  return [
    { filename: "parser.ts", content: code },
    { filename: "array.ts", content: arrayCode },
    { filename: "arena.ts", content: arenaCode },
    { filename: "cursor.ts", content: cursorCode },
    { filename: "engine.ts", content: engineCode },
  ];
}
