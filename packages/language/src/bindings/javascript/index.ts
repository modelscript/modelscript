import { bindingsTemplateDtsCode, bindingsTemplateJsCode } from "../../../build/src-gen/runtime-templates.js";
import { NormalizedGrammar } from "../../grammar.js";

/**
 * Generates the standalone JavaScript wrapper string and its TypeScript definitions
 * for a compiled ModelScript parser.
 *
 * This function injects the dynamically generated syntax names, field names,
 * and diagnostic lint dictionaries into the statically compiled `bindingsTemplateJsCode`
 * via string replacement, producing a zero-dependency CommonJS/ESM module that can
 * be instantiated in the browser or Node.js.
 *
 * @param grammarDef - The raw grammar definition object containing metadata and lints.
 * @param normalized - The normalized grammar object containing resolved symbol/field maps and productions.
 * @returns An object containing the final JS source, DTS source, and exported syntax/field arrays.
 */
export function generateJavaScriptWrapper(
  grammarDef: any,
  normalized: NormalizedGrammar,
): {
  js: string;
  dts: string;
  syntaxNames: string[];
  fieldNames: string[];
  semanticLegend: { tokenTypes: string[]; tokenModifiers: string[] };
} {
  const langName = grammarDef.name;

  // Create an array mapping from symbol ID to symbol Name (like the C enum)
  const syntaxNames: string[] = [];
  syntaxNames[0] = "ERROR";
  for (const [sym, id] of normalized.symToInt.entries()) {
    if (id === 0) continue;
    if (
      !syntaxNames[id] ||
      syntaxNames[id] === "UNKNOWN" ||
      syntaxNames[id] === "ERROR" ||
      syntaxNames[id].startsWith("_") ||
      syntaxNames[id].startsWith("node_")
    ) {
      syntaxNames[id] = sym;
    }
  }

  // Fill in gaps if symToInt skipped any
  for (let i = 0; i < syntaxNames.length; i++) {
    if (!syntaxNames[i]) syntaxNames[i] = "UNKNOWN";
  }

  const syntaxNamesStr = JSON.stringify(syntaxNames);

  const fieldNamesArr: string[] = [];
  for (const [name, id] of normalized.fieldToInt.entries()) {
    fieldNamesArr[id] = name;
  }

  const fieldNamesStr = JSON.stringify(Object.fromEntries(normalized.fieldToInt));

  let lintMessagesStr = "{";
  let lintSeveritiesStr = "{";
  let lintCodesStr = "{";

  if (grammarDef.lints) {
    let nextLintId = 2000;
    let first = true;
    for (const [lintName, lint] of Object.entries(grammarDef.lints)) {
      const lintId =
        typeof lint === "object" && lint !== null && (lint as any).code ? (lint as any).code : nextLintId++;
      if (!first) {
        lintMessagesStr += ",";
        lintSeveritiesStr += ",";
        lintCodesStr += ",";
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

      const customCode = (lint as any).code;
      if (customCode !== undefined) {
        lintCodesStr += `"${lintId}": ${JSON.stringify(customCode)}`;
      } else {
        lintCodesStr += `"${lintId}": undefined`;
      }
    }
  }
  lintMessagesStr += "}";
  lintSeveritiesStr += "}";
  lintCodesStr += "}";

  const extrasPatterns: string[] = [];
  if (normalized.extras && normalized.extras.length > 0) {
    for (const rule of normalized.extras) {
      if (rule.type === "PATTERN") {
        const pattern = rule.value instanceof RegExp ? rule.value.source : String(rule.value);
        extrasPatterns.push(pattern);
      } else if (rule.type === "STRING") {
        const escaped = String(rule.value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        extrasPatterns.push(escaped);
      }
    }
  }
  const extrasPatternStr = extrasPatterns.length > 0 ? extrasPatterns.join("|") : "\\s";

  // Replace the placeholders in the bundled JavaScript
  const js = bindingsTemplateJsCode
    .replace(/__LANG_NAME__/g, langName)
    .replace(/"__SYNTAX_NAMES_LITERAL__"/g, syntaxNamesStr)
    .replace(/__SYNTAX_NAMES_LITERAL__/g, syntaxNamesStr)
    .replace(/"__LINT_MESSAGES_LITERAL__"/g, lintMessagesStr)
    .replace(/__LINT_MESSAGES_LITERAL__/g, lintMessagesStr)
    .replace(/"__LINT_SEVERITIES_LITERAL__"/g, lintSeveritiesStr)
    .replace(/__LINT_SEVERITIES_LITERAL__/g, lintSeveritiesStr)
    .replace(/"__LINT_CODES_LITERAL__"/g, lintCodesStr)
    .replace(/__LINT_CODES_LITERAL__/g, lintCodesStr)
    .replace(/"__FIELD_NAMES_LITERAL__"/g, fieldNamesStr)
    .replace(/__FIELD_NAMES_LITERAL__/g, fieldNamesStr)
    .replace(/"__EXTRAS_PATTERN_LITERAL__"/g, JSON.stringify(extrasPatternStr));

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
    .replace(/__FIELD_NAMES_LITERAL__/g, fieldNamesStr)
    .replace(/"__EXTRAS_PATTERN_LITERAL__"/g, JSON.stringify(extrasPatternStr));

  const tokenTypesMap = new Map<string, number>();
  const tokenModifiersMap = new Map<string, number>();

  const sortedProds = [...normalized.productions].sort((a, b) => a.id - b.id);
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

  const legend = {
    tokenTypes: Array.from(tokenTypesMap.keys()),
    tokenModifiers: Array.from(tokenModifiersMap.keys()),
  };
  const legendStr = JSON.stringify(legend);

  // Add the legend exports manually to the generated wrapper code
  const jsWithLegend = js + `\nexport const semanticLegend = ${legendStr};\n`;
  const dtsWithLegend = dts + `\nexport const semanticLegend: { tokenTypes: string[], tokenModifiers: string[] };\n`;

  return { js: jsWithLegend, dts: dtsWithLegend, syntaxNames, fieldNames: fieldNamesArr, semanticLegend: legend };
}

export * from "./bindings.js";
