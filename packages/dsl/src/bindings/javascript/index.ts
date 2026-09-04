import { NormalizedGrammar } from "../../dsl/grammar.js";
import { bindingsTemplateDtsCode, bindingsTemplateJsCode } from "../../src-gen/runtime-templates.js";

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
  const jsWithLegend =
    js +
    `\nexport const semanticLegend = { tokenTypes: ${JSON.stringify(legend.tokenTypes)}, tokenModifiers: ${JSON.stringify(legend.tokenModifiers)} };\n`;
  const dtsWithLegend = dts + `\nexport const semanticLegend: { tokenTypes: string[]; tokenModifiers: string[] };\n`;

  const facade = generateCstFacade(grammarDef, normalized, fieldNamesArr);
  const finalJs = jsWithLegend + "\n" + facade.js;
  const finalDts = dtsWithLegend + "\n" + facade.dts;

  return { js: finalJs, dts: finalDts, syntaxNames, fieldNames: fieldNamesArr, semanticLegend: legend };
}

function toPascal(str: string): string {
  return str
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

function toCamel(str: string): string {
  const p = toPascal(str);
  return p.length > 0 ? p.charAt(0).toLowerCase() + p.slice(1) : "";
}

const RESERVED_TYPE_NAMES = new Set([
  "Function",
  "Object",
  "String",
  "Number",
  "Boolean",
  "Symbol",
  "Error",
  "Date",
  "RegExp",
  "Map",
  "Set",
]);

function sanitizeTypeName(name: string): string {
  return RESERVED_TYPE_NAMES.has(name) ? name + "Node" : name;
}

/**
 * Generates a zero-overhead typed CST facade:
 * - SyntaxKind enum (numeric rule/token IDs)
 * - FieldId enum (numeric field IDs)
 * - Token normalization helpers
 * - Typed node interfaces and type guards (is<Rule>)
 * - Cst namespace with zero-allocation static field accessors
 */
export function generateCstFacade(
  _grammarDef: any,
  normalized: NormalizedGrammar,
  fieldNamesArr: string[],
): { js: string; dts: string } {
  // 1. SyntaxKind enum
  const syntaxKindEntries: { name: string; id: number }[] = [];
  const addedNames = new Set<string>();

  syntaxKindEntries.push({ name: "ERROR", id: 0 });
  addedNames.add("ERROR");

  for (const [sym, id] of normalized.symToInt.entries()) {
    if (id === 0) continue;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(sym)) {
      const pascal = sanitizeTypeName(toPascal(sym));
      if (!addedNames.has(pascal)) {
        syntaxKindEntries.push({ name: pascal, id });
        addedNames.add(pascal);
      }
      if (!addedNames.has(sym)) {
        syntaxKindEntries.push({ name: sym, id });
        addedNames.add(sym);
      }
    }
  }

  let syntaxKindDts = "export enum SyntaxKind {\n";
  let syntaxKindJs = "export const SyntaxKind = {\n";
  for (const entry of syntaxKindEntries) {
    const key = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(entry.name) ? entry.name : JSON.stringify(entry.name);
    syntaxKindDts += `  ${key} = ${entry.id},\n`;
    syntaxKindJs += `  ${key}: ${entry.id},\n`;
  }
  syntaxKindDts += "}\n\n";
  syntaxKindJs += "};\n\n";

  // 2. FieldId enum
  const fieldIdEntries: { name: string; id: number }[] = [];
  const addedFieldNames = new Set<string>();

  for (const [fName, id] of normalized.fieldToInt.entries()) {
    const pascal = sanitizeTypeName(toPascal(fName));
    if (!addedFieldNames.has(pascal)) {
      fieldIdEntries.push({ name: pascal, id });
      addedFieldNames.add(pascal);
    }
    if (!addedFieldNames.has(fName)) {
      fieldIdEntries.push({ name: fName, id });
      addedFieldNames.add(fName);
    }
  }

  let fieldIdDts = "export enum FieldId {\n";
  let fieldIdJs = "export const FieldId = {\n";
  for (const entry of fieldIdEntries) {
    const key = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(entry.name) ? entry.name : JSON.stringify(entry.name);
    fieldIdDts += `  ${key} = ${entry.id},\n`;
    fieldIdJs += `  ${key}: ${entry.id},\n`;
  }
  fieldIdDts += "}\n\n";
  fieldIdJs += "};\n\n";

  // 3. Token Normalization Helpers
  const helpersJs = `/** Strips quotes from parser token strings (e.g. '"der"' -> 'der', '":' -> ':') */
export function normalizeToken(token) {
  if (!token) return "";
  return token.charCodeAt(0) === 34 && token.charCodeAt(token.length - 1) === 34
    ? token.slice(1, -1)
    : token;
}

/** Returns the normalized type of a CST node (stripped of quotes). */
export function cstKind(node) {
  return node ? normalizeToken(node.type) : "";
}
`;

  const helpersDts = `/** Strips quotes from parser token strings (e.g. '"der"' -> 'der', '":' -> ':') */
export declare function normalizeToken(token: string | null | undefined): string;

/** Returns the normalized type of a CST node (stripped of quotes). */
export declare function cstKind(node: SyntaxNode | null | undefined): string;
`;

  // 4. Per-rule typed accessors & guards
  const visibleRules = new Set<string>();
  for (const sym of normalized.nonTerminals) {
    if (!sym.startsWith("_") && !sym.startsWith('"') && !sym.startsWith("/")) {
      visibleRules.add(sym);
    }
  }

  const allRuleFields = new Map<string, Map<string, number>>();
  for (const p of normalized.productions) {
    if (p.fields) {
      let fieldsMap = allRuleFields.get(p.left);
      if (!fieldsMap) {
        fieldsMap = new Map<string, number>();
        allRuleFields.set(p.left, fieldsMap);
      }
      for (const f of p.fields) {
        const name = fieldNamesArr[f.fieldId];
        if (name) {
          fieldsMap.set(name, f.fieldId);
        }
      }
    }
  }

  // Propagate fields from synthetic helper rules (starting with '_') to parent rules
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of normalized.productions) {
      for (const rSym of p.right) {
        if (rSym.startsWith("_")) {
          const synthFields = allRuleFields.get(rSym);
          if (synthFields && synthFields.size > 0) {
            let leftFields = allRuleFields.get(p.left);
            if (!leftFields) {
              leftFields = new Map<string, number>();
              allRuleFields.set(p.left, leftFields);
            }
            for (const [fName, fId] of synthFields.entries()) {
              if (!leftFields.has(fName)) {
                leftFields.set(fName, fId);
                changed = true;
              }
            }
          }
        }
      }
    }
  }

  const ruleToFields = new Map<string, Map<string, number>>();
  for (const rule of visibleRules) {
    const fields = allRuleFields.get(rule);
    if (fields) {
      ruleToFields.set(rule, fields);
    }
  }

  let guardsJs = "";
  let guardsDts = "";
  let cstNamespacesJs = "export const Cst = {\n  kind: cstKind,\n  normalize: normalizeToken,\n";
  let cstNamespacesDts =
    "export namespace Cst {\n  export function kind(node: SyntaxNode | null | undefined): string;\n  export function normalize(token: string | null | undefined): string;\n";

  for (const rule of visibleRules) {
    const pascal = sanitizeTypeName(toPascal(rule));
    const ruleId = normalized.symToInt.get(rule);
    if (ruleId === undefined) continue;

    // Top-level Type Guard & Interface
    guardsJs += `export function is${pascal}(node) {\n  return node != null && node.typeId === ${ruleId};\n}\n`;
    guardsDts += `export interface ${pascal}Node extends SyntaxNode {\n  readonly typeId: SyntaxKind.${pascal};\n}\n`;
    guardsDts += `export declare function is${pascal}(node: SyntaxNode | null | undefined): node is ${pascal}Node;\n`;

    // Cst Namespace for this rule
    const fieldsMap = ruleToFields.get(rule);

    cstNamespacesJs += `  ${pascal}: {\n`;
    cstNamespacesJs += `    typeId: ${ruleId},\n`;
    cstNamespacesJs += `    type: ${JSON.stringify(rule)},\n`;
    cstNamespacesJs += `    is(node) { return node != null && node.typeId === ${ruleId}; },\n`;

    cstNamespacesDts += `  export const ${pascal}: {\n`;
    cstNamespacesDts += `    readonly typeId: number;\n`;
    cstNamespacesDts += `    readonly type: string;\n`;
    cstNamespacesDts += `    is(node: SyntaxNode | null | undefined): node is ${pascal}Node;\n`;

    if (fieldsMap) {
      for (const [fieldName, fieldId] of fieldsMap.entries()) {
        const camelField = toCamel(fieldName);
        if (!camelField) continue;
        cstNamespacesJs += `    ${camelField}(node) {\n`;
        cstNamespacesJs += `      return node ? (node.childForFieldId(${fieldId}) || node.childForFieldName(${JSON.stringify(fieldName)})) : null;\n`;
        cstNamespacesJs += `    },\n`;
        cstNamespacesJs += `    ${camelField}List(node) {\n`;
        cstNamespacesJs += `      return node ? node.childrenForFieldName(${JSON.stringify(fieldName)}) : [];\n`;
        cstNamespacesJs += `    },\n`;

        cstNamespacesDts += `    ${camelField}(node: SyntaxNode | null | undefined): SyntaxNode | null;\n`;
        cstNamespacesDts += `    ${camelField}List(node: SyntaxNode | null | undefined): SyntaxNode[];\n`;
      }
    }

    cstNamespacesJs += `  },\n`;
    cstNamespacesDts += `  };\n`;
  }

  cstNamespacesJs += "};\n";
  cstNamespacesDts += "}\n";

  const generatedJs = syntaxKindJs + fieldIdJs + helpersJs + guardsJs + cstNamespacesJs;
  const generatedDts = syntaxKindDts + fieldIdDts + helpersDts + guardsDts + cstNamespacesDts;

  return { js: generatedJs, dts: generatedDts };
}

export * from "./bindings.js";
