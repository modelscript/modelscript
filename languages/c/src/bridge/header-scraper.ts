// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * C Header Scraper & Type Introspection Engine.
 *
 * Scrapes C header (.h) files for function prototypes, struct definitions,
 * and typedefs to support automated Modelica external "C" bindings.
 */

export interface CFunctionParam {
  name: string;
  type: string;
  isPointer: boolean;
  isConst: boolean;
}

export interface CFunctionPrototype {
  returnType: string;
  name: string;
  params: CFunctionParam[];
  rawSignature: string;
}

export interface CStructField {
  name: string;
  type: string;
  isPointer: boolean;
}

export interface CStructDefinition {
  name: string;
  fields: CStructField[];
}

export interface ScrapedCHeader {
  functions: CFunctionPrototype[];
  structs: CStructDefinition[];
  typedefs: Map<string, string>;
}

export function scrapeCHeader(headerText: string): ScrapedCHeader {
  const functions: CFunctionPrototype[] = [];
  const structs: CStructDefinition[] = [];
  const typedefs = new Map<string, string>();

  // Strip block comments /* ... */ and line comments //
  let clean = "";
  let cursor = 0;
  while (cursor < headerText.length) {
    const startComment = headerText.indexOf("/*", cursor);
    if (startComment === -1) {
      clean += headerText.slice(cursor);
      break;
    }
    clean += headerText.slice(cursor, startComment);
    const endComment = headerText.indexOf("*/", startComment + 2);
    if (endComment === -1) {
      break;
    }
    cursor = endComment + 2;
  }
  clean = clean.replace(/\/\/[^\n]*/g, "");

  // 1. Extract typedefs: typedef OldType NewType;
  const typedefMatches = clean.matchAll(/typedef\s+([A-Za-z0-9_ *]+?)\s+([A-Za-z0-9_]+)\s*;/g);
  for (const m of typedefMatches) {
    typedefs.set(m[2]!, m[1]!.trim());
  }

  // 2. Extract struct definitions: struct Name { ... };
  const structMatches = clean.matchAll(/struct\s+([A-Za-z0-9_]+)\s*\{([^}]*)\}\s*;/g);
  for (const m of structMatches) {
    const structName = m[1]!;
    const body = m[2]!;
    const fields: CStructField[] = [];

    const fieldLines = body.split(";");
    for (const f of fieldLines) {
      const trimmed = f.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const fieldName = parts[parts.length - 1]!.replace(/^\*+/, "");
        const isPointer = parts[parts.length - 1]!.startsWith("*") || parts.slice(0, -1).some((p) => p.includes("*"));
        const typeName = parts.slice(0, -1).join(" ").replace(/\*/g, "").trim();
        fields.push({ name: fieldName, type: typeName, isPointer });
      }
    }
    structs.push({ name: structName, fields });
  }

  // 3. Extract function prototypes: ReturnType FuncName(ParamType p1, ...);
  // Match standard function prototypes outside of control structures
  const fnRegex = /(?:extern\s+)?([A-Za-z_][A-Za-z0-9_ *]*?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*;/g;
  for (const m of clean.matchAll(fnRegex)) {
    const returnTypeRaw = m[1]!.trim();
    const fnName = m[2]!.trim();
    const rawParams = m[3]!.trim();

    // Skip control statements
    if (["if", "while", "for", "switch", "return", "typedef"].includes(fnName)) continue;

    const params: CFunctionParam[] = [];
    if (rawParams && rawParams !== "void") {
      const paramList = rawParams.split(",");
      for (let idx = 0; idx < paramList.length; idx++) {
        const p = paramList[idx]!.trim();
        const isConst = p.startsWith("const ");
        const cleanedP = isConst ? p.slice(6).trim() : p;
        const tokens = cleanedP.split(/\s+/);

        let paramName = `u${idx + 1}`;
        let paramType = "double";
        let isPointer = false;

        if (tokens.length >= 2) {
          const lastToken = tokens[tokens.length - 1]!;
          if (lastToken.startsWith("*")) {
            isPointer = true;
            paramName = lastToken.slice(1);
          } else {
            paramName = lastToken;
          }
          const typeTokens = tokens.slice(0, -1);
          if (typeTokens[typeTokens.length - 1]!.endsWith("*")) {
            isPointer = true;
            typeTokens[typeTokens.length - 1] = typeTokens[typeTokens.length - 1]!.slice(0, -1);
          }
          paramType = typeTokens.join(" ");
        } else if (tokens.length === 1) {
          paramType = tokens[0]!;
        }

        params.push({
          name: paramName,
          type: paramType,
          isPointer,
          isConst,
        });
      }
    }

    functions.push({
      returnType: returnTypeRaw,
      name: fnName,
      params,
      rawSignature: m[0].trim(),
    });
  }

  return {
    functions,
    structs,
    typedefs,
  };
}
