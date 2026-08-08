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

  // Automatically generate shadow SyntaxTypes for any types defined in `model` but not in `rules`
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

  // Fallback shadow types commonly referenced in codegen/typesys
  const commonFallbacks = ["IDENTIFIER", "NUMBER", "REAL", "STRING", "BOOLEAN"];
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
  if (grammar.model) {
    for (const modelKey of Object.keys(grammar.model)) {
      const attrs = (grammar.model as any)[modelKey];
      for (const attrKey of Object.keys(attrs)) {
        const attr = attrs[attrKey];
        if (typeof attr === "object" && (attr?.type === "flag" || attr?.type === "bool")) {
          let safeName = attrKey.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
          safeName = safeName.replace(/[^A-Z0-9_]/g, "_");
          if (/^[0-9]/.test(safeName)) safeName = "_" + safeName;

          if (!flagMap.has(safeName) && flagBits < 12) {
            flagMap.set(safeName, 1 << flagBits);
            typeCode += `  ${safeName} = 1 << ${flagBits},\n`;
            flagBits++;
          }
        }
      }
    }
  }
  typeCode += `}\n\n`;

  // Synthesize Property enum for key-value model property lookups
  let propIdx = 1;
  const propMap = new Map<string, number>();
  typeCode += `export enum Property {\n`;
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
  typeCode += `}\n\n`;

  typeCode += `export enum FieldId {\n`;
  for (const [fieldName, id] of normalized.fieldToInt.entries()) {
    if (typeof fieldName !== "string") continue;
    // Convert camelCase or snake_case to CONSTANT_CASE
    let safeName = fieldName.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
    safeName = safeName.replace(/[^A-Z0-9_]/g, "_");
    typeCode += `  ${safeName} = ${id},\n`;
  }
  typeCode += `}\n\n`;

  return typeCode;
}
