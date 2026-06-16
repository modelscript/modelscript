import { bindingsTemplateDtsCode, bindingsTemplateJsCode } from "../../../build/src-gen/runtime-templates.js";
import { NormalizedGrammar } from "../../grammar.js";

export function generateJavaScriptWrapper(
  grammarDef: any,
  normalized: NormalizedGrammar,
): { js: string; dts: string; syntaxNames: string[] } {
  const langName = grammarDef.name;

  // Create an array mapping from symbol ID to symbol Name (like the C enum)
  const syntaxNames: string[] = ["ERROR"];
  for (const [sym, id] of normalized.symToInt.entries()) {
    syntaxNames[id] = sym;
  }

  // Fill in gaps if symToInt skipped any
  for (let i = 0; i < syntaxNames.length; i++) {
    if (!syntaxNames[i]) syntaxNames[i] = "UNKNOWN";
  }

  const syntaxNamesStr = JSON.stringify(syntaxNames);

  // Replace the placeholders in the bundled JavaScript
  const js = bindingsTemplateJsCode
    .replace(/__LANG_NAME__/g, langName)
    .replace(/"__SYNTAX_NAMES_LITERAL__"/g, syntaxNamesStr)
    .replace(/__SYNTAX_NAMES_LITERAL__/g, syntaxNamesStr); // Just in case it wasn't quoted

  // Replace the placeholders in the bundled TypeScript Declarations
  const dts = bindingsTemplateDtsCode
    .replace(/__LANG_NAME__/g, langName)
    .replace(/"__SYNTAX_NAMES_LITERAL__"/g, syntaxNamesStr)
    .replace(/__SYNTAX_NAMES_LITERAL__/g, syntaxNamesStr);

  return { js, dts, syntaxNames };
}
