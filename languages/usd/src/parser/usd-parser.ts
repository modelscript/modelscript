// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/usd — High-performance ASCII OpenUSD (.usda) Streaming Parser.
 */

import type { UsdPrim, UsdSpecifier, UsdStage, UsdStageMetadata } from "../types.js";

export function parseUsd(content: string): UsdStage {
  const stageMetadata: UsdStageMetadata = {};
  const prims = new Map<string, UsdPrim>();
  const rootPrims: UsdPrim[] = [];

  let idx = 0;
  const len = content.length;
  let line = 1;
  let col = 1;

  function advance(n = 1): void {
    for (let k = 0; k < n; k++) {
      if (idx < len) {
        if (content[idx] === "\n") {
          line++;
          col = 1;
        } else {
          col++;
        }
        idx++;
      }
    }
  }

  function skipWhitespaceAndComments(): void {
    while (idx < len) {
      const ch = content[idx]!;
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        advance();
      } else if (ch === "#") {
        // Comment, except #usda header on line 1
        if (idx === 0 && content.startsWith("#usda", idx)) {
          // skip header line
          while (idx < len && content[idx] !== "\n") advance();
        } else {
          while (idx < len && content[idx] !== "\n") advance();
        }
      } else {
        break;
      }
    }
  }

  function peek(): string {
    skipWhitespaceAndComments();
    return idx < len ? content[idx]! : "";
  }

  function consume(char: string): boolean {
    skipWhitespaceAndComments();
    if (idx < len && content[idx] === char) {
      advance();
      return true;
    }
    return false;
  }

  function readIdentifier(): string {
    skipWhitespaceAndComments();
    let id = "";
    while (idx < len) {
      const ch = content[idx]!;
      if (/[a-zA-Z0-9_.-]/.test(ch) || (ch === ":" && idx + 1 < len && /[a-zA-Z0-9_]/.test(content[idx + 1]!))) {
        id += ch;
        advance();
      } else if (ch === "[" && idx + 1 < len && content[idx + 1] === "]") {
        id += "[]";
        advance(2);
      } else {
        break;
      }
    }
    return id;
  }

  function readString(): string {
    skipWhitespaceAndComments();
    const quote = content[idx]!;
    if (quote !== '"' && quote !== "'") return "";
    advance();
    let str = "";
    while (idx < len && content[idx] !== quote) {
      if (content[idx] === "\\" && idx + 1 < len) {
        advance();
        str += content[idx]!;
        advance();
      } else {
        str += content[idx]!;
        advance();
      }
    }
    if (idx < len && content[idx] === quote) advance();
    return str;
  }

  function readPathRef(): string {
    skipWhitespaceAndComments();
    if (content[idx] !== "<") return "";
    advance();
    let p = "";
    while (idx < len && content[idx] !== ">") {
      p += content[idx]!;
      advance();
    }
    if (idx < len && content[idx] === ">") advance();
    return p;
  }

  function readValue(): any {
    skipWhitespaceAndComments();
    if (idx >= len) return null;

    const ch = content[idx]!;
    if (ch === '"' || ch === "'") {
      return readString();
    }
    if (ch === "<") {
      return `<${readPathRef()}>`;
    }
    if (ch === "(") {
      // Tuple / vector / matrix
      advance();
      const items: any[] = [];
      while (idx < len) {
        skipWhitespaceAndComments();
        if (consume(")")) break;
        const prevIdx = idx;
        items.push(readValue());
        consume(",");
        if (idx === prevIdx) advance();
      }
      return items;
    }
    if (ch === "[") {
      // Array
      advance();
      const items: any[] = [];
      while (idx < len) {
        skipWhitespaceAndComments();
        if (consume("]")) break;
        const prevIdx = idx;
        items.push(readValue());
        consume(",");
        if (idx === prevIdx) advance();
      }
      return items;
    }

    if (ch === "{") {
      // Dictionary / block literal (e.g. customLayerData = { ... })
      advance();
      const dict: Record<string, any> = {};
      while (idx < len) {
        skipWhitespaceAndComments();
        if (consume("}")) break;
        let k1 = readIdentifier();
        if (!k1) {
          advance();
          continue;
        }
        skipWhitespaceAndComments();
        if (idx < len && content[idx] !== "=" && content[idx] !== "}") {
          const k2 = readIdentifier();
          if (k2) k1 = k2;
        }
        consume("=");
        dict[k1] = readValue();
        consume(",");
        consume(";");
      }
      return dict;
    }

    // Number, Boolean, or token
    const token = readIdentifier();
    if (token === "true") return true;
    if (token === "false") return false;
    const num = Number(token);
    if (!Number.isNaN(num) && token !== "") return num;
    if (token === "") {
      if (idx < len) advance();
      return null;
    }
    return token;
  }

  // 1. Stage metadata block before any prims
  skipWhitespaceAndComments();
  if (peek() === "(") {
    consume("(");
    while (idx < len) {
      skipWhitespaceAndComments();
      if (consume(")")) break;
      const key = readIdentifier();
      if (!key) {
        advance();
        continue;
      }
      consume("=");
      const val = readValue();
      if (key === "defaultPrim") stageMetadata.defaultPrim = String(val);
      else if (key === "metersPerUnit") stageMetadata.metersPerUnit = Number(val);
      else if (key === "upAxis") stageMetadata.upAxis = String(val) as "Y" | "Z";
      else if (key === "timeCodesPerSecond") stageMetadata.timeCodesPerSecond = Number(val);
      else if (key === "startTimeCode") stageMetadata.startTimeCode = Number(val);
      else if (key === "endTimeCode") stageMetadata.endTimeCode = Number(val);
      else if (key === "subLayers" && Array.isArray(val)) stageMetadata.subLayers = val;
    }
  }

  // 2. Prim parser
  function parsePrim(parentPath: string | null): UsdPrim | null {
    skipWhitespaceAndComments();
    if (idx >= len) return null;

    const startLine = line;
    const startCol = col;
    const startOffset = idx;

    const specifierToken = readIdentifier();
    if (specifierToken !== "def" && specifierToken !== "over" && specifierToken !== "class") {
      return null;
    }

    const specifier = specifierToken as UsdSpecifier;
    let typeName = "";
    let primName = "";

    skipWhitespaceAndComments();
    if (peek() === '"' || peek() === "'") {
      // Typeless def "Name"
      typeName = "Xform";
      primName = readString();
    } else {
      typeName = readIdentifier();
      primName = readString();
    }

    if (!primName) primName = "unnamed";
    const currentPath = parentPath ? `${parentPath}/${primName}` : `/${primName}`;

    const apiSchemas: string[] = [];
    let kind: string | undefined = undefined;

    // Optional metadata block: ( kind = "component" prepend apiSchemas = ["..."] )
    skipWhitespaceAndComments();
    if (peek() === "(") {
      consume("(");
      while (idx < len) {
        skipWhitespaceAndComments();
        if (consume(")")) break;
        let opOrKey = readIdentifier();
        let key = opOrKey;
        if (opOrKey === "prepend" || opOrKey === "append") {
          key = readIdentifier();
        }
        consume("=");
        const metaVal = readValue();
        if (key === "apiSchemas") {
          if (Array.isArray(metaVal)) {
            for (const s of metaVal) apiSchemas.push(String(s));
          } else if (typeof metaVal === "string") {
            apiSchemas.push(metaVal);
          }
        } else if (key === "kind") {
          kind = String(metaVal);
        }
      }
    }

    const prim: UsdPrim = {
      specifier,
      typeName,
      name: primName,
      path: currentPath,
      apiSchemas,
      kind,
      attributes: new Map(),
      relationships: new Map(),
      children: new Map(),
      parentPath,
      range: {
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
      },
    };

    if (consume("{")) {
      while (idx < len) {
        skipWhitespaceAndComments();
        if (consume("}")) break;

        const p = peek();
        if (
          p === "def" ||
          p === "over" ||
          p === "class" ||
          content.startsWith("def ", idx) ||
          content.startsWith("over ", idx)
        ) {
          const child = parsePrim(currentPath);
          if (child) {
            prim.children.set(child.name, child);
            prims.set(child.path, child);
          }
          continue;
        }

        // Relationship: rel <name> = <path>
        if (content.startsWith("rel ", idx) || content.startsWith("rel\t", idx)) {
          const relLine = line;
          const relCol = col;
          readIdentifier(); // skip "rel"
          const relName = readIdentifier();
          consume("=");
          const val = readValue();
          const targets = Array.isArray(val)
            ? val.map((v) => String(v).replace(/[<>]/g, ""))
            : [String(val).replace(/[<>]/g, "")];
          prim.relationships.set(relName, {
            name: relName,
            targets,
            range: { startLine: relLine, startColumn: relCol, endLine: line, endColumn: col },
          });
          continue;
        }

        // Attribute: [uniform] [custom] <type> <name> = <val>  or  <name>.timeSamples = { ... }
        const attrLine = line;
        const attrCol = col;
        let id1 = readIdentifier();
        while (id1 === "uniform" || id1 === "custom") {
          id1 = readIdentifier();
        }

        let attrType = id1;
        let attrName = readIdentifier();

        // Check for timeSamples: name.timeSamples = { ... }
        if (attrName.includes(".timeSamples") || peek() === ".timeSamples") {
          if (peek() === ".timeSamples") {
            readIdentifier(); // consume .timeSamples
          }
          consume("=");
          const timeSamples = new Map<number, any>();
          if (consume("{")) {
            while (idx < len) {
              skipWhitespaceAndComments();
              if (consume("}")) break;
              const tStr = readIdentifier();
              consume(":");
              const tVal = readValue();
              timeSamples.set(Number(tStr), tVal);
              consume(",");
            }
          }
          prim.attributes.set(attrName.replace(".timeSamples", ""), {
            name: attrName.replace(".timeSamples", ""),
            type: attrType,
            value: null,
            timeSamples,
            range: { startLine: attrLine, startColumn: attrCol, endLine: line, endColumn: col },
          });
          continue;
        }

        if (!attrName) {
          // Attribute without explicit type
          attrName = attrType;
          attrType = "auto";
        }

        let attrVal: any = null;
        if (consume("=")) {
          attrVal = readValue();
        }

        // Optional attribute metadata: ( key = value, ... )
        skipWhitespaceAndComments();
        if (peek() === "(") {
          consume("(");
          while (idx < len) {
            skipWhitespaceAndComments();
            if (consume(")")) break;
            const metaKey = readIdentifier();
            if (!metaKey) {
              advance();
              continue;
            }
            if (consume("=")) {
              readValue();
            }
            consume(",");
            consume(";");
          }
        }

        prim.attributes.set(attrName, {
          name: attrName,
          type: attrType,
          value: attrVal,
          range: { startLine: attrLine, startColumn: attrCol, endLine: line, endColumn: col },
        });
      }
    }

    if (prim.range) {
      prim.range.endLine = line;
      prim.range.endColumn = col;
      prim.range.endOffset = idx;
    }

    return prim;
  }

  // 3. Top-level stage prims
  while (idx < len) {
    skipWhitespaceAndComments();
    if (idx >= len) break;
    const rootPrim = parsePrim(null);
    if (rootPrim) {
      rootPrims.push(rootPrim);
      prims.set(rootPrim.path, rootPrim);
    } else {
      advance();
    }
  }

  return {
    metadata: stageMetadata,
    prims,
    rootPrims,
  };
}
