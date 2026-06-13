/* eslint-disable */
import { generateJavaScriptWrapper } from "./bindings/javascript.js";
import { GeneratedFile, generateParser, generateParserTables } from "./codegen/parser.js";
import { LanguageOptions } from "./dsl.js";

export interface ParserResult {
  name: string;
  startSymbol: string;
  nonTerminals: string[];
  terminals: string[];
  statesCount: number;
}

export interface BuildResult {
  parserInfo: ParserResult;
  assemblyScriptFiles: GeneratedFile[];
  javascriptWrapper: { js: string; dts: string };
}

export function buildParser(languageDef: LanguageOptions): BuildResult {
  const result = generateParser(languageDef);

  const parserInfo = {
    name: languageDef.name,
    startSymbol: result.grammar.startSymbol,
    nonTerminals: Array.from(result.grammar.nonTerminals),
    terminals: Array.from(result.grammar.terminals),
    statesCount: result.table.actionTable.size,
  };

  const assemblyScriptFiles = generateParserTables(
    languageDef,
    result.grammar,
    result.table,
    languageDef.syncTokens || [],
    languageDef.preprocessorHook || "",
  );

  const javascriptWrapper = generateJavaScriptWrapper(languageDef, result.grammar);

  return { parserInfo, assemblyScriptFiles, javascriptWrapper };
}
