// SPDX-License-Identifier: AGPL-3.0-or-later

import type { StlFacet, StlMeshDocument, StlParseError, StlSolid, Vec3 } from "../types.js";

function parseFloatStrict(token: string): number {
  const lower = token.toLowerCase();
  if (lower === "nan" || lower === "+nan" || lower === "-nan") return Number.NaN;
  if (lower === "inf" || lower === "+inf" || lower === "infinity" || lower === "+infinity") {
    return Number.POSITIVE_INFINITY;
  }
  if (lower === "-inf" || lower === "-infinity") return Number.NEGATIVE_INFINITY;
  const val = Number(token);
  return val;
}

function parseVec3Tokens(
  tokens: string[],
  startIndex: number,
  lineNum: number,
  errors: StlParseError[],
  context: string,
): Vec3 {
  if (tokens.length < startIndex + 3) {
    errors.push({
      message: `Expected 3 numeric components for ${context}, found ${Math.max(0, tokens.length - startIndex)}`,
      line: lineNum,
      column: 1,
      code: "STL1001",
    });
    return [Number.NaN, Number.NaN, Number.NaN];
  }
  const x = parseFloatStrict(tokens[startIndex] ?? "");
  const y = parseFloatStrict(tokens[startIndex + 1] ?? "");
  const z = parseFloatStrict(tokens[startIndex + 2] ?? "");
  return [x, y, z];
}

/**
 * Parses an ASCII STL document (supports multiple `solid ... endsolid` blocks).
 */
export function parseAsciiStl(text: string): StlMeshDocument {
  const solids: StlSolid[] = [];
  const allFacets: StlFacet[] = [];
  const errors: StlParseError[] = [];

  const rawLines = text.split(/\r?\n/);
  let offset = 0;

  let currentSolid: StlSolid | null = null;
  let currentNormal: Vec3 | null = null;
  let currentFacetLine = 0;
  let currentFacetStart = 0;
  let inLoop = false;
  let loopVertices: Vec3[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i] ?? "";
    const lineNum = i + 1;
    const lineStart = offset;
    const lineEnd = offset + rawLine.length;
    // Advance offset past line + newline
    offset = lineEnd + (text[lineEnd] === "\r" && text[lineEnd + 1] === "\n" ? 2 : 1);

    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    const parts = trimmed.split(/\s+/);
    const kw = (parts[0] ?? "").toLowerCase();

    if (kw === "solid") {
      if (currentSolid && !currentSolid.closed) {
        errors.push({
          message: `Nested or unclosed 'solid ${currentSolid.name}' before new 'solid'`,
          line: lineNum,
          column: 1,
          code: "STL5003",
          offset: lineStart,
        });
      }
      const name = trimmed.slice(5).trim();
      currentSolid = {
        name,
        closed: false,
        facets: [],
        line: lineNum,
        startOffset: lineStart,
        endOffset: lineEnd,
      };
      solids.push(currentSolid);
      continue;
    }

    if (kw === "endsolid") {
      const endName = trimmed.slice(8).trim();
      if (!currentSolid) {
        errors.push({
          message: `Unexpected 'endsolid' without matching 'solid'`,
          line: lineNum,
          column: 1,
          code: "STL1001",
          offset: lineStart,
        });
      } else {
        currentSolid.endName = endName;
        currentSolid.closed = true;
        currentSolid.endLine = lineNum;
        currentSolid.endOffset = lineEnd;
        currentSolid = null;
      }
      continue;
    }

    if (kw === "facet") {
      if (!currentSolid) {
        errors.push({
          message: `'facet' encountered outside of a 'solid' block`,
          line: lineNum,
          column: 1,
          code: "STL1001",
          offset: lineStart,
        });
        currentSolid = {
          name: "",
          closed: false,
          facets: [],
          line: lineNum,
          startOffset: lineStart,
        };
        solids.push(currentSolid);
      }
      const subKw = (parts[1] ?? "").toLowerCase();
      if (subKw !== "normal") {
        errors.push({
          message: `Expected 'normal' after 'facet', found '${parts[1] ?? ""}'`,
          line: lineNum,
          column: 1,
          code: "STL1001",
          offset: lineStart,
        });
      }
      currentNormal = parseVec3Tokens(parts, 2, lineNum, errors, "facet normal");
      currentFacetLine = lineNum;
      currentFacetStart = lineStart;
      loopVertices = [];
      inLoop = false;
      continue;
    }

    if (kw === "outer") {
      const subKw = (parts[1] ?? "").toLowerCase();
      if (subKw !== "loop") {
        errors.push({
          message: `Expected 'loop' after 'outer', found '${parts[1] ?? ""}'`,
          line: lineNum,
          column: 1,
          code: "STL1001",
          offset: lineStart,
        });
      }
      inLoop = true;
      loopVertices = [];
      continue;
    }

    if (kw === "vertex") {
      if (!inLoop) {
        errors.push({
          message: `'vertex' encountered outside of 'outer loop'`,
          line: lineNum,
          column: 1,
          code: "STL1001",
          offset: lineStart,
        });
      }
      const v = parseVec3Tokens(parts, 1, lineNum, errors, "vertex");
      loopVertices.push(v);
      continue;
    }

    if (kw === "endloop") {
      if (!inLoop) {
        errors.push({
          message: `Unexpected 'endloop' without matching 'outer loop'`,
          line: lineNum,
          column: 1,
          code: "STL1001",
          offset: lineStart,
        });
      }
      inLoop = false;
      continue;
    }

    if (kw === "endfacet") {
      if (!currentNormal || !currentSolid) {
        errors.push({
          message: `Unexpected 'endfacet' without matching 'facet'`,
          line: lineNum,
          column: 1,
          code: "STL1001",
          offset: lineStart,
        });
      } else {
        if (loopVertices.length !== 3) {
          errors.push({
            message: `Facet expected 3 vertices, found ${loopVertices.length}`,
            line: currentFacetLine,
            column: 1,
            code: "STL1001",
            offset: currentFacetStart,
          });
        }
        const v0: Vec3 = loopVertices[0] ?? [Number.NaN, Number.NaN, Number.NaN];
        const v1: Vec3 = loopVertices[1] ?? [Number.NaN, Number.NaN, Number.NaN];
        const v2: Vec3 = loopVertices[2] ?? [Number.NaN, Number.NaN, Number.NaN];
        const facet: StlFacet = {
          normal: currentNormal,
          vertices: [v0, v1, v2],
          line: currentFacetLine,
          startOffset: currentFacetStart,
          endOffset: lineEnd,
        };
        currentSolid.facets.push(facet);
        allFacets.push(facet);
      }
      currentNormal = null;
      loopVertices = [];
      inLoop = false;
      continue;
    }

    errors.push({
      message: `Unrecognized STL statement '${parts[0] ?? trimmed}'`,
      line: lineNum,
      column: 1,
      code: "STL1001",
      offset: lineStart,
    });
  }

  if (currentNormal !== null) {
    errors.push({
      message: `Unexpected end of file inside unclosed 'facet' block`,
      line: currentFacetLine || rawLines.length,
      column: 1,
      code: "STL1001",
    });
  }

  return {
    format: "ascii",
    header: solids[0]?.name ?? "",
    solids,
    facets: allFacets,
    errors,
  };
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Object.is(n, -0)) return "0";
  return Number(n.toPrecision(9)).toString();
}

/**
 * Formats an `StlMeshDocument` as canonical ASCII STL text.
 */
export function formatAsciiStl(doc: StlMeshDocument): string {
  const solids: StlSolid[] =
    doc.solids.length > 0
      ? doc.solids
      : [
          {
            name: doc.header?.trim() || "model",
            closed: true,
            facets: doc.facets,
          },
        ];

  const lines: string[] = [];
  for (const solid of solids) {
    const sName = solid.name || "model";
    lines.push(`solid ${sName}`);
    for (const f of solid.facets) {
      const [nx, ny, nz] = f.normal;
      lines.push(`  facet normal ${fmtNum(nx)} ${fmtNum(ny)} ${fmtNum(nz)}`);
      lines.push(`    outer loop`);
      for (const [vx, vy, vz] of f.vertices) {
        lines.push(`      vertex ${fmtNum(vx)} ${fmtNum(vy)} ${fmtNum(vz)}`);
      }
      lines.push(`    endloop`);
      lines.push(`  endfacet`);
    }
    lines.push(`endsolid ${sName}`);
  }
  return lines.join("\n") + "\n";
}
