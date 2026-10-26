// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica External "C" Binder Generator.
 *
 * Generates strongly typed Modelica function definitions and records from
 * scraped C function prototypes and struct layouts.
 */

import {
  scrapeCHeader,
  type CFunctionPrototype,
  type CStructDefinition,
  type ScrapedCHeader,
} from "./header-scraper.js";

export function mapCTypeToModelica(cType: string, isPointer: boolean = false): string {
  const normalized = cType.toLowerCase().replace(/\s+/g, " ").trim();

  if (isPointer && normalized === "char") return "String";
  if (normalized === "double" || normalized === "float" || normalized === "real_t") return "Real";
  if (
    normalized === "int" ||
    normalized === "short" ||
    normalized === "long" ||
    normalized === "size_t" ||
    normalized.startsWith("int") ||
    normalized.startsWith("uint")
  ) {
    return "Integer";
  }
  if (normalized === "bool" || normalized === "_bool") return "Boolean";
  if (normalized === "char*") return "String";

  // Pointer to struct or opaque handle
  if (isPointer) return "Modelica.Blocks.Interfaces.ExternalObject";

  return "Real";
}

export function generateModelicaFunction(fn: CFunctionPrototype, headerInclude?: string): string {
  const lines: string[] = [];
  lines.push(`function ${fn.name}`);

  const hasReturn = fn.returnType !== "void";
  const moReturnType = hasReturn ? mapCTypeToModelica(fn.returnType, fn.returnType.includes("*")) : "";

  // Inputs
  const callArgs: string[] = [];
  for (const p of fn.params) {
    const moType = mapCTypeToModelica(p.type, p.isPointer);
    lines.push(`  input ${moType} ${p.name};`);
    callArgs.push(p.name);
  }

  // Output
  if (hasReturn) {
    lines.push(`  output ${moReturnType} y;`);
  }

  // External clause
  const argStr = callArgs.join(", ");
  const callExpr = hasReturn ? `y = ${fn.name}(${argStr})` : `${fn.name}(${argStr})`;
  const incAnnotation = headerInclude ? `\n    annotation(Include = "#include \\"${headerInclude}\\"");` : ";";
  lines.push(`  external "C" ${callExpr}${incAnnotation}`);
  lines.push(`end ${fn.name};`);

  return lines.join("\n");
}

export function generateModelicaRecord(st: CStructDefinition): string {
  const lines: string[] = [];
  lines.push(`record ${st.name}`);
  for (const f of st.fields) {
    const moType = mapCTypeToModelica(f.type, f.isPointer);
    lines.push(`  ${moType} ${f.name};`);
  }
  lines.push(`end ${st.name};`);
  return lines.join("\n");
}

export function bindCHeaderToModelica(headerText: string, headerInclude?: string): string {
  const scraped: ScrapedCHeader = scrapeCHeader(headerText);
  const blocks: string[] = [];

  for (const st of scraped.structs) {
    blocks.push(generateModelicaRecord(st));
  }

  for (const fn of scraped.functions) {
    blocks.push(generateModelicaFunction(fn, headerInclude));
  }

  return blocks.join("\n\n");
}
