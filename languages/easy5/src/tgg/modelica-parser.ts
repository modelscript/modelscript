// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/easy5 — Zero-Regex Modelica Block Diagram Parser.
 */

export interface ModelicaComponentDecl {
  name: string;
  typeSpecifier: string;
  modifications: Record<string, number | number[] | string>;
  variability?: string | undefined;
}

export interface ModelicaConnection {
  source: string;
  target: string;
}

export interface ParsedModelicaModel {
  name: string;
  components: Map<string, ModelicaComponentDecl>;
  connections: ModelicaConnection[];
}

export function parseModelicaBlocks(sourceText: string): ParsedModelicaModel {
  const lines = sourceText.split(/\r?\n/);
  const components = new Map<string, ModelicaComponentDecl>();
  const connections: ModelicaConnection[] = [];
  let modelName = "Easy5Model";
  let inEquationSection = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const commentIdx = rawLine.indexOf("//");
    const line = (commentIdx !== -1 ? rawLine.slice(0, commentIdx) : rawLine).trim();

    if (!line) continue;

    if (line.startsWith("model ") || line.startsWith("block ") || line.startsWith("partial model ")) {
      const parts = line.split(/\s+/);
      const idx = parts.findIndex((p) => p === "model" || p === "block");
      if (idx !== -1 && parts[idx + 1]) {
        modelName = parts[idx + 1]!.replace(/;$/, "");
      }
      continue;
    }

    if (line.startsWith("equation")) {
      inEquationSection = true;
      continue;
    }

    if (line.startsWith("end ")) {
      inEquationSection = false;
      continue;
    }

    if (inEquationSection) {
      if (line.startsWith("connect(") && line.endsWith(");")) {
        const inner = line.slice("connect(".length, -2);
        const commaIdx = inner.indexOf(",");
        if (commaIdx !== -1) {
          const source = inner.slice(0, commaIdx).trim();
          const target = inner.slice(commaIdx + 1).trim();
          connections.push({ source, target });
        }
      }
      continue;
    }

    if (line.endsWith(";")) {
      const declStr = line.slice(0, -1).trim();
      const openParen = declStr.indexOf("(");
      let typeAndName = "";
      let modStr = "";

      if (openParen !== -1 && declStr.endsWith(")")) {
        typeAndName = declStr.slice(0, openParen).trim();
        modStr = declStr.slice(openParen + 1, -1).trim();
      } else {
        typeAndName = declStr;
      }

      const tokens = typeAndName.split(/\s+/);
      if (tokens.length >= 2) {
        let variability: string | undefined;
        let typeSpecifier = "";
        let compName = "";

        if (tokens[0] === "parameter" || tokens[0] === "constant" || tokens[0] === "discrete") {
          variability = tokens[0];
          typeSpecifier = tokens[1]!;
          compName = tokens[2] ?? "";
        } else {
          typeSpecifier = tokens[0]!;
          compName = tokens[1]!;
        }

        if (compName) {
          const modifications = parseModifications(modStr);
          components.set(compName, {
            name: compName,
            typeSpecifier,
            modifications,
            variability,
          });
        }
      }
    }
  }

  return {
    name: modelName,
    components,
    connections,
  };
}

function parseModifications(str: string): Record<string, number | number[] | string> {
  const result: Record<string, number | number[] | string> = {};
  if (!str) return result;

  const parts: string[] = [];
  let current = "";
  let depth = 0;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!;
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;

    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const valRaw = part.slice(eqIdx + 1).trim();

    if ((valRaw.startsWith("{") && valRaw.endsWith("}")) || (valRaw.startsWith("[") && valRaw.endsWith("]"))) {
      const inner = valRaw.slice(1, -1);
      const elems = inner
        .split(",")
        .map((s) => parseFloat(s.trim()))
        .filter((n) => !isNaN(n));
      result[key] = elems;
    } else if (valRaw.startsWith('"') && valRaw.endsWith('"')) {
      result[key] = valRaw.slice(1, -1);
    } else {
      const num = parseFloat(valRaw);
      result[key] = !isNaN(num) ? num : valRaw;
    }
  }

  return result;
}
