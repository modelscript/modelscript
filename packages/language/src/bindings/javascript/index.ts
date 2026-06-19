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
  const fieldNamesStr = JSON.stringify(Object.fromEntries(normalized.fieldToInt));

  let lintMessagesStr = "{";
  let lintSeveritiesStr = "{";
  if (grammarDef.lints) {
    let nextLintId = 2000;
    let first = true;
    for (const [lintName, lint] of Object.entries(grammarDef.lints)) {
      const lintId = nextLintId++;
      if (!first) {
        lintMessagesStr += ",";
        lintSeveritiesStr += ",";
      }
      first = false;

      const msg = (lint as any).message;
      if (typeof msg === "function") {
        lintMessagesStr += `"${lintId}": ${msg.toString()}`;
      } else {
        lintMessagesStr += `"${lintId}": ${JSON.stringify(msg)}`;
      }

      const sev = (lint as any).severity;
      let sevNum = 1; // error
      if (sev === "warning") sevNum = 2;
      else if (sev === "info") sevNum = 3;
      lintSeveritiesStr += `"${lintId}": ${sevNum}`;
    }
  }
  lintMessagesStr += "}";
  lintSeveritiesStr += "}";

  // Replace the placeholders in the bundled JavaScript
  const js = bindingsTemplateJsCode
    .replace(/__LANG_NAME__/g, langName)
    .replace(/"__SYNTAX_NAMES_LITERAL__"/g, syntaxNamesStr)
    .replace(/__SYNTAX_NAMES_LITERAL__/g, syntaxNamesStr)
    .replace(/"__LINT_MESSAGES_LITERAL__"/g, lintMessagesStr)
    .replace(/__LINT_MESSAGES_LITERAL__/g, lintMessagesStr)
    .replace(/"__LINT_SEVERITIES_LITERAL__"/g, lintSeveritiesStr)
    .replace(/__LINT_SEVERITIES_LITERAL__/g, lintSeveritiesStr)
    .replace(/"__FIELD_NAMES_LITERAL__"/g, fieldNamesStr)
    .replace(/__FIELD_NAMES_LITERAL__/g, fieldNamesStr);

  // Replace the placeholders in the bundled TypeScript Declarations
  const dts = bindingsTemplateDtsCode
    .replace(/__LANG_NAME__/g, langName)
    .replace(/"__SYNTAX_NAMES_LITERAL__"/g, syntaxNamesStr)
    .replace(/__SYNTAX_NAMES_LITERAL__/g, syntaxNamesStr)
    .replace(/"__LINT_MESSAGES_LITERAL__"/g, lintMessagesStr)
    .replace(/__LINT_MESSAGES_LITERAL__/g, lintMessagesStr)
    .replace(/"__LINT_SEVERITIES_LITERAL__"/g, lintSeveritiesStr)
    .replace(/__LINT_SEVERITIES_LITERAL__/g, lintSeveritiesStr)
    .replace(/"__FIELD_NAMES_LITERAL__"/g, fieldNamesStr)
    .replace(/__FIELD_NAMES_LITERAL__/g, fieldNamesStr);

  return { js, dts, syntaxNames };
}
