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

  // Fallbacks for CAD rules to prevent compilation errors in hardcoded LSP template CAD functions
  if (!emittedNames.has("CAD_CUBE")) typeCode += `  CAD_CUBE = 9999,\n`;
  if (!emittedNames.has("CAD_SPHERE")) typeCode += `  CAD_SPHERE = 9998,\n`;
  if (!emittedNames.has("CAD_CYLINDER")) typeCode += `  CAD_CYLINDER = 9997,\n`;
  if (!emittedNames.has("CAD_TRANSLATE")) typeCode += `  CAD_TRANSLATE = 9996,\n`;
  if (!emittedNames.has("CAD_DIFFERENCE")) typeCode += `  CAD_DIFFERENCE = 9995,\n`;
  if (!emittedNames.has("CAD_UNION")) typeCode += `  CAD_UNION = 9994,\n`;

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
