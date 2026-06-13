import { GrammarOptions } from "../dsl.js";
import { NormalizedGrammar } from "../grammar.js";

export function generateTypes(grammar: GrammarOptions, normalized: NormalizedGrammar): string {
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

    typeCode += `  ${safeName} = ${i},\n`;
    emittedNames.add(safeName);
  }

  // Fallbacks for CAD rules to prevent compilation errors in hardcoded LSP template CAD functions
  if (!emittedNames.has("CAD_CUBE")) typeCode += `  CAD_CUBE = 9999,\n`;
  if (!emittedNames.has("CAD_SPHERE")) typeCode += `  CAD_SPHERE = 9998,\n`;
  if (!emittedNames.has("CAD_CYLINDER")) typeCode += `  CAD_CYLINDER = 9997,\n`;
  if (!emittedNames.has("CAD_TRANSLATE")) typeCode += `  CAD_TRANSLATE = 9996,\n`;
  if (!emittedNames.has("CAD_DIFFERENCE")) typeCode += `  CAD_DIFFERENCE = 9995,\n`;
  if (!emittedNames.has("CAD_UNION")) typeCode += `  CAD_UNION = 9994,\n`;

  typeCode += `}\n\n`;

  return typeCode;
}
