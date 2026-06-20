import { LanguageOptions } from "../dsl.js";
import { NormalizedGrammar } from "../grammar.js";

export function generateTypes(grammar: LanguageOptions<any>, normalized: NormalizedGrammar): string {
  let typeCode = `// Token and Node Types for ${grammar.name}\n`;

  typeCode += `export enum SyntaxType {\n`;
  typeCode += `  ERROR = 0,\n`;

  // Create reverse mapping
  const intToSym = new Map<number, string>();
  for (const [sym, i] of normalized.symToInt.entries()) {
    intToSym.set(i, sym);
  }

  // Output in order
  const emittedNames = new Set<string>();
  for (let i = 1; i <= intToSym.size; i++) {
    const sym = intToSym.get(i);
    if (!sym) continue;

    // Create a safe identifier for enum.
    // If it's a string literal like "{", map it to a literal name or just "T_" + i
    // since we only need the value in the lexer.
    let safeName = sym.replace(/[^a-zA-Z0-9]/g, "_");
    if (sym.startsWith('"') || sym.startsWith("/")) {
      safeName = "T_" + i; // guarantee uniqueness for tokens
    } else {
      safeName = safeName.toUpperCase();
    }

    // Prepend if safeName starts with number
    if (/^[0-9]/.test(safeName)) safeName = "_" + safeName;

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
  if (grammar.model) {
    // Start shadow types at a high offset to avoid collision with standard rules
    let shadowIdx = 10000;
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

  typeCode += `}\n\n`;

  // Synthesize NodeFlag bitmask from `type: "flag"` attributes in the model
  let flagBits = 0;
  let flagMap = new Map<string, number>();
  typeCode += `export enum NodeFlag {\n`;
  if (grammar.model) {
    for (const modelKey of Object.keys(grammar.model)) {
      const attrs = (grammar.model as any)[modelKey];
      for (const attrKey of Object.keys(attrs)) {
        if (attrs[attrKey]?.type === "flag") {
          let safeName = attrKey.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
          safeName = safeName.replace(/[^A-Z0-9_]/g, "_");
          if (/^[0-9]/.test(safeName)) safeName = "_" + safeName;

          if (!flagMap.has(safeName)) {
            flagMap.set(safeName, 1 << flagBits);
            typeCode += `  ${safeName} = 1 << ${flagBits},\n`;
            flagBits++;
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
