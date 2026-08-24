import { LanguageOptions } from "../dsl.js";
import { NormalizedGrammar } from "../grammar.js";

/**
 * Generates AssemblyScript / TypeScript enum definitions (`SyntaxType`, `NodeFlag`, `FieldId`)
 * corresponding to the grammar's symbols, fields, and flag attributes.
 *
 * @param grammar The user-defined language DSL options object.
 * @param normalized The normalized grammar containing symbol-to-int mapping tables.
 * @returns The generated TypeScript/AssemblyScript source code string for enum definitions.
 */
export function generateTypes(grammar: LanguageOptions<any>, normalized: NormalizedGrammar): string {
  let typeCode = `// Token and Node Types for ${grammar.name}\n`;

  typeCode += `export enum SyntaxType {\n`;
  typeCode += `  ERROR = 0,\n`;

  // Create reverse mapping from integer ID to symbol string (preferring human-readable names)
  const intToSym = new Map<number, string>();
  for (const [sym, i] of normalized.symToInt.entries()) {
    const existing = intToSym.get(i);
    if (!existing) {
      intToSym.set(i, sym);
    } else {
      const existingIsLiteral = existing.startsWith('"') || existing.startsWith("/");
      const symIsLiteral = sym.startsWith('"') || sym.startsWith("/");
      if (existingIsLiteral && !symIsLiteral) {
        intToSym.set(i, sym);
      }
    }
  }

  // Output symbols in strict sequential ID order
  const emittedNames = new Set<string>();
  for (let i = 1; i <= intToSym.size; i++) {
    const sym = intToSym.get(i);
    if (!sym) continue;

    // Convert symbol strings (e.g. literals or regex) to safe C-style identifiers
    let safeName = sym.replace(/[^a-zA-Z0-9]/g, "_");
    if (sym.startsWith('"') || sym.startsWith("/")) {
      safeName = "T_" + i; // Guarantee identifier uniqueness for terminal literals
    } else {
      safeName = safeName.toUpperCase();
    }

    // Prepend underscore if identifier starts with a digit
    if (/^[0-9]/.test(safeName)) safeName = "_" + safeName;

    // Deduplicate enum field names using numerical suffixing
    let finalName = safeName;
    let suffix = 1;
    while (emittedNames.has(finalName)) {
      finalName = `${safeName}_${suffix}`;
      suffix++;
    }

    typeCode += `  ${finalName} = ${i},\n`;
    emittedNames.add(finalName);
  }

  // Automatically generate shadow SyntaxTypes for any types defined in `model` or `lints` but not in `rules`
  let shadowIdx = 10000;
  if (grammar.model) {
    // Start shadow types at a high offset to avoid collision with standard rules
    for (const modelName of Object.keys(grammar.model)) {
      let safeName = modelName.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
      if (/^[0-9]/.test(safeName)) safeName = "_" + safeName;
      if (!emittedNames.has(safeName)) {
        typeCode += `  ${safeName} = ${shadowIdx},\n`;
        emittedNames.add(safeName);
        shadowIdx++;
      }
    }
  }

  if (grammar.lints) {
    for (const lint of Object.values(grammar.lints) as any[]) {
      if (lint && Array.isArray(lint.nodes)) {
        for (const nodeName of lint.nodes) {
          if (typeof nodeName === "string") {
            let safeName = nodeName.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
            if (/^[0-9]/.test(safeName)) safeName = "_" + safeName;
            if (!emittedNames.has(safeName)) {
              typeCode += `  ${safeName} = ${shadowIdx},\n`;
              emittedNames.add(safeName);
              shadowIdx++;
            }
          }
        }
      }
    }
  }

  // Fallback shadow types commonly referenced in codegen/typesys
  const commonFallbacks = [
    "IDENTIFIER",
    "NUMBER",
    "REAL",
    "STRING",
    "STRING_LITERAL",
    "BOOLEAN",
    "UNSIGNED_INTEGER",
    "UNSIGNED_REAL",
    "ARRAY_CONSTRUCTOR",
    "ARRAY_COMPREHENSION",
    "EXTERNAL_CLAUSE",
    "PUBLIC_ELEMENT_LIST",
    "PROTECTED_ELEMENT_LIST",
    "TUPLE_EXPRESSION",
    "RANGE_EXPRESSION",
    "DIV_EXPRESSION",
    "ASSIGNMENT_STATEMENT",
    "ADD_EXPRESSION",
    "SUB_EXPRESSION",
    "MUL_EXPRESSION",
  ];
  for (const fallback of commonFallbacks) {
    if (!emittedNames.has(fallback)) {
      typeCode += `  ${fallback} = ${shadowIdx},\n`;
      emittedNames.add(fallback);
      shadowIdx++;
    }
  }

  typeCode += `  LIST = 99999,\n`;
  typeCode += `}\n\n`;

  // Synthesize NodeFlag bitmask from `type: "flag"` or `type: "bool"` attributes in the model
  let flagBits = 0;
  const flagMap = new Map<string, number>();
  typeCode += `export enum NodeFlag {\n`;
  typeCode += `  NONE = 0,\n`;
  if (grammar.model) {
    for (const modelKey of Object.keys(grammar.model)) {
      const attrs = (grammar.model as any)[modelKey];
      for (const attrKey of Object.keys(attrs)) {
        const attr = attrs[attrKey];
        if (typeof attr === "object" && (attr?.type === "flag" || attr?.type === "bool")) {
          let safeName = attrKey.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
          safeName = safeName.replace(/[^A-Z0-9_]/g, "_");
          if (/^[0-9]/.test(safeName)) safeName = "_" + safeName;

          if (!flagMap.has(safeName) && flagBits < 30) {
            flagMap.set(safeName, 1 << flagBits);
            typeCode += `  ${safeName} = 1 << ${flagBits},\n`;
            flagBits++;
          }
        }
      }
    }
  }
  const commonFlags = [
    "IS_PROTECTED",
    "IS_FINAL",
    "IS_PARTIAL",
    "IS_CONNECTOR",
    "HAS_INNER_MATCH",
    "IS_REPLACEABLE",
    "IS_STREAM",
    "IS_FLOW",
    "IS_INPUT",
    "IS_OUTPUT",
    "IS_PARAMETER",
    "IS_CONSTANT",
    "IS_DISCRETE",
    "IS_CLOCKED",
    "IS_IMPURE",
    "IS_PURE",
    "IS_EXPANDABLE",
    "IS_ENCAPSULATED",
    "IS_OPERATOR",
    "IS_FUNCTION",
    "IS_BLOCK",
    "IS_MODEL",
    "IS_RECORD",
    "IS_TYPE",
    "IS_PACKAGE",
    "IS_CLASS",
    "IS_ARRAY",
    "IS_VARIABLE",
    "IS_PRIMITIVE",
    "IS_ENUM",
    "IS_STRUCT",
    "IS_ROOT",
  ];
  for (const flag of commonFlags) {
    if (!flagMap.has(flag) && flagBits < 30) {
      flagMap.set(flag, 1 << flagBits);
      typeCode += `  ${flag} = 1 << ${flagBits},\n`;
      flagBits++;
    }
  }
  typeCode += `}\n\n`;

  // Synthesize Property enum for key-value model property lookups
  let propIdx = 1;
  const propMap = new Map<string, number>();
  typeCode += `export enum Property {\n`;
  typeCode += `  NONE = 0,\n`;
  if (grammar.model) {
    for (const modelKey of Object.keys(grammar.model)) {
      const attrs = (grammar.model as any)[modelKey];
      for (const attrKey of Object.keys(attrs)) {
        const attr = attrs[attrKey];
        if (typeof attr === "object" && typeof attr?.type === "string") {
          let safeName = attrKey.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
          safeName = safeName.replace(/[^A-Z0-9_]/g, "_");
          if (/^[0-9]/.test(safeName)) safeName = "_" + safeName;

          if (!propMap.has(safeName)) {
            propMap.set(safeName, propIdx);
            typeCode += `  ${safeName} = ${propIdx},\n`;
            propIdx++;
          }
        }
      }
    }
  }
  const commonProps = [
    "BASE_TYPE",
    "FLOW_COUNT",
    "VALUE",
    "KIND",
    "VARIABILITY",
    "CAUSALITY",
    "CLOCK_ID",
    "DIMENSIONS",
    "SHAPE",
    "START_VALUE",
    "BINDING_EXPR",
    "SOURCE_NODE",
    "TARGET_NODE",
  ];
  for (const prop of commonProps) {
    if (!propMap.has(prop)) {
      propMap.set(prop, propIdx);
      typeCode += `  ${prop} = ${propIdx},\n`;
      propIdx++;
    }
  }
  typeCode += `}\n\n`;

  typeCode += `export enum FieldId {\n`;
  typeCode += `  NONE = 0,\n`;
  const fieldNamesMap = new Map<string, number>();
  let nextFieldId = 1;

  for (const [fieldName, id] of normalized.fieldToInt.entries()) {
    if (typeof fieldName !== "string") continue;
    let safeName = fieldName.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
    safeName = safeName.replace(/[^A-Z0-9_]/g, "_");
    if (!fieldNamesMap.has(safeName)) {
      fieldNamesMap.set(safeName, id);
      if (id >= nextFieldId) nextFieldId = id + 1;
    }
  }

  // Pre-seed common AST field names so query AST traversals never crash AssemblyScript compilation
  const commonFields = [
    "NAME",
    "END_NAME",
    "LEFT",
    "RIGHT",
    "LHS",
    "RHS",
    "OPERAND",
    "ARGUMENT",
    "ARGUMENTS",
    "BINDING",
    "MODIFICATION",
    "BODY",
    "CONDITION",
    "VALUE",
    "TYPE",
    "TYPE_SPECIFIER",
    "FROM",
    "TO",
    "SOURCE",
    "TARGET",
    "STATEMENT",
    "EXPRESSION",
    "REDECLARE",
    "STEP",
    "START",
    "FACTOR",
    "CONNECT_EQUATION",
    "DECLARATION",
    "DECLARATIONS",
    "ELEMENT",
    "ELEMENTS",
    "EQUATION",
    "EQUATIONS",
  ];
  for (const f of commonFields) {
    if (!fieldNamesMap.has(f)) {
      fieldNamesMap.set(f, nextFieldId++);
    }
  }

  for (const [safeName, id] of fieldNamesMap.entries()) {
    typeCode += `  ${safeName} = ${id},\n`;
  }
  typeCode += `}\n\n`;

  return typeCode;
}
