// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  Plot3dBlockDims,
  Plot3dDataset,
  Plot3dDimension,
  Plot3dFlowConditions,
  Plot3dFunctionBlock,
  Plot3dFunctionFile,
  Plot3dGrid,
  Plot3dGridBlock,
  Plot3dNamMetadata,
  Plot3dSolution,
  Plot3dSolutionBlock,
} from "../types.js";

export interface Plot3dAsciiParseOptions {
  dimension?: Plot3dDimension | undefined;
  multiBlock?: boolean | undefined;
  hasIblank?: boolean | undefined;
}

/**
 * Tokenizes ASCII PLOT3D numeric content, normalizing Fortran D-exponent notation (e.g., 1.0D-3).
 * Strips `#` and `!` comment lines if present.
 */
export function tokenizePlot3dNumbers(text: string): number[] {
  const tokens: number[] = [];
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
      continue;
    }
    // Strip inline comments starting with # or !
    const commentIdx = trimmed.search(/[#!]/);
    const line = commentIdx >= 0 ? trimmed.slice(0, commentIdx).trim() : trimmed;
    if (!line) continue;

    const parts = line.split(/[\s,]+/);
    for (const part of parts) {
      if (!part) continue;
      // Handle Fortran repeat count syntax like 3*0.0
      const repeatMatch = /^(\d+)\*(.+)$/.exec(part);
      if (repeatMatch) {
        const count = Number.parseInt(repeatMatch[1]!, 10);
        const val = parseFortranFloat(repeatMatch[2]!);
        for (let r = 0; r < count; r++) {
          tokens.push(val);
        }
      } else {
        tokens.push(parseFortranFloat(part));
      }
    }
  }
  return tokens;
}

function parseFortranFloat(token: string): number {
  const normalized = token.replace(/[dD]/g, "e");
  const v = Number(normalized);
  if (Number.isNaN(v)) {
    throw new Error(`Invalid numeric token '${token}' in PLOT3D ASCII stream`);
  }
  return v;
}

function isPositiveInt(v: number | undefined): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

interface DetectedHeader {
  dimension: Plot3dDimension;
  multiBlock: boolean;
  hasIblank: boolean;
  dims: Plot3dBlockDims[];
  cursor: number;
}

/**
 * Detects single-block vs multi-block and 2D vs 3D header for an ASCII grid stream.
 */
function detectGridHeader(tokens: number[], options?: Plot3dAsciiParseOptions): DetectedHeader {
  const candidates: Array<{ dimension: Plot3dDimension; multiBlock: boolean; hasIblank: boolean }> = [];
  const dimsToTry: Plot3dDimension[] = options?.dimension ? [options.dimension] : ["3d", "2d"];
  const mbToTry: boolean[] = options?.multiBlock !== undefined ? [options.multiBlock] : [true, false];
  const ibToTry: boolean[] = options?.hasIblank !== undefined ? [options.hasIblank] : [false, true];

  for (const dimension of dimsToTry) {
    for (const multiBlock of mbToTry) {
      for (const hasIblank of ibToTry) {
        candidates.push({ dimension, multiBlock, hasIblank });
      }
    }
  }

  for (const cand of candidates) {
    const dimCount = cand.dimension === "3d" ? 3 : 2;
    const fieldsPerBlock = dimCount + (cand.hasIblank ? 1 : 0);
    let cursor = 0;
    let nBlocks = 1;
    if (cand.multiBlock) {
      const nb = tokens[0];
      if (!isPositiveInt(nb) || nb > 100_000) continue;
      nBlocks = nb;
      cursor = 1;
    }
    if (cursor + nBlocks * dimCount > tokens.length) continue;

    const dims: Plot3dBlockDims[] = [];
    let valid = true;
    let expectedData = 0;
    for (let b = 0; b < nBlocks; b++) {
      const ni = tokens[cursor++]!;
      const nj = tokens[cursor++]!;
      const nk = cand.dimension === "3d" ? tokens[cursor++]! : 1;
      if (!isPositiveInt(ni) || !isPositiveInt(nj) || !isPositiveInt(nk)) {
        valid = false;
        break;
      }
      dims.push({ ni, nj, nk });
      expectedData += ni * nj * nk * fieldsPerBlock;
    }
    if (!valid) continue;
    if (cursor + expectedData === tokens.length) {
      return {
        dimension: cand.dimension,
        multiBlock: cand.multiBlock,
        hasIblank: cand.hasIblank,
        dims,
        cursor,
      };
    }
  }

  // Fallback: parse header with explicit/default options even if coordinate count mismatches
  // so downstream linter can report P3D2001 / P3D2002 cleanly.
  const dimension = options?.dimension ?? "3d";
  const multiBlock = options?.multiBlock ?? false;
  const hasIblank = options?.hasIblank ?? false;
  const dimCount = dimension === "3d" ? 3 : 2;
  let cursor = 0;
  let nBlocks = 1;
  if (multiBlock) {
    if (tokens.length < 1) {
      throw new Error("Unexpected EOF: missing NBLOCKS header");
    }
    nBlocks = Math.trunc(tokens[cursor++]!);
    if (nBlocks < 0) {
      throw new Error(`Invalid NBLOCKS value '${nBlocks}'`);
    }
  }
  const dims: Plot3dBlockDims[] = [];
  for (let b = 0; b < nBlocks; b++) {
    if (cursor + dimCount > tokens.length) {
      throw new Error(`Unexpected EOF while reading dimensions for block ${b}`);
    }
    const ni = Math.trunc(tokens[cursor++]!);
    const nj = Math.trunc(tokens[cursor++]!);
    const nk = dimension === "3d" ? Math.trunc(tokens[cursor++]!) : 1;
    dims.push({ ni, nj, nk });
  }
  return { dimension, multiBlock, hasIblank, dims, cursor };
}

/**
 * Parses an ASCII formatted PLOT3D grid file (`.xyz` or `.g`).
 */
export function parsePlot3dGridAscii(text: string, options?: Plot3dAsciiParseOptions): Plot3dGrid {
  const tokens = tokenizePlot3dNumbers(text);
  if (tokens.length === 0) {
    throw new Error("Empty PLOT3D grid file");
  }

  const header = detectGridHeader(tokens, options);
  const blocks: Plot3dGridBlock[] = [];
  let cursor = header.cursor;

  for (let b = 0; b < header.dims.length; b++) {
    const { ni, nj, nk } = header.dims[b]!;
    const nNodes = Math.max(0, ni * nj * nk);
    const xLen = Math.min(nNodes, Math.max(0, tokens.length - cursor));
    const x = new Float64Array(xLen);
    for (let i = 0; i < xLen; i++) x[i] = tokens[cursor++]!;

    const yLen = Math.min(nNodes, Math.max(0, tokens.length - cursor));
    const y = new Float64Array(yLen);
    for (let i = 0; i < yLen; i++) y[i] = tokens[cursor++]!;

    let z: Float64Array;
    if (header.dimension === "3d") {
      const zLen = Math.min(nNodes, Math.max(0, tokens.length - cursor));
      z = new Float64Array(zLen);
      for (let i = 0; i < zLen; i++) z[i] = tokens[cursor++]!;
    } else {
      z = new Float64Array(nNodes);
    }

    let iblank: Int32Array | undefined;
    if (header.hasIblank) {
      const ibLen = Math.min(nNodes, Math.max(0, tokens.length - cursor));
      iblank = new Int32Array(ibLen);
      for (let i = 0; i < ibLen; i++) iblank[i] = Math.trunc(tokens[cursor++]!);
    }

    blocks.push({ index: b, ni, nj, nk, x, y, z, iblank });
  }

  return {
    format: "ascii",
    dimension: header.dimension,
    multiBlock: header.multiBlock,
    hasIblank: header.hasIblank,
    blocks,
  };
}

function detectSolutionHeader(
  tokens: number[],
  options?: Plot3dAsciiParseOptions,
): {
  dimension: Plot3dDimension;
  multiBlock: boolean;
  dims: Plot3dBlockDims[];
  cursor: number;
} {
  const dimsToTry: Plot3dDimension[] = options?.dimension ? [options.dimension] : ["3d", "2d"];
  const mbToTry: boolean[] = options?.multiBlock !== undefined ? [options.multiBlock] : [true, false];

  for (const dimension of dimsToTry) {
    for (const multiBlock of mbToTry) {
      const dimCount = dimension === "3d" ? 3 : 2;
      const qCount = dimension === "3d" ? 5 : 4;
      let cursor = 0;
      let nBlocks = 1;
      if (multiBlock) {
        const nb = tokens[0];
        if (!isPositiveInt(nb) || nb > 100_000) continue;
        nBlocks = nb;
        cursor = 1;
      }
      if (cursor + nBlocks * dimCount > tokens.length) continue;

      const dims: Plot3dBlockDims[] = [];
      let valid = true;
      let expectedData = 0;
      for (let b = 0; b < nBlocks; b++) {
        const ni = tokens[cursor++]!;
        const nj = tokens[cursor++]!;
        const nk = dimension === "3d" ? tokens[cursor++]! : 1;
        if (!isPositiveInt(ni) || !isPositiveInt(nj) || !isPositiveInt(nk)) {
          valid = false;
          break;
        }
        dims.push({ ni, nj, nk });
        expectedData += 4 + ni * nj * nk * qCount;
      }
      if (!valid) continue;
      if (cursor + expectedData === tokens.length) {
        return { dimension, multiBlock, dims, cursor };
      }
    }
  }

  // Fallback
  const dimension = options?.dimension ?? "3d";
  const multiBlock = options?.multiBlock ?? false;
  const dimCount = dimension === "3d" ? 3 : 2;
  let cursor = 0;
  let nBlocks = 1;
  if (multiBlock) {
    if (tokens.length < 1) throw new Error("Unexpected EOF: missing NBLOCKS header in .q file");
    nBlocks = Math.trunc(tokens[cursor++]!);
  }
  const dims: Plot3dBlockDims[] = [];
  for (let b = 0; b < nBlocks; b++) {
    if (cursor + dimCount > tokens.length) {
      throw new Error(`Unexpected EOF while reading .q dimensions for block ${b}`);
    }
    const ni = Math.trunc(tokens[cursor++]!);
    const nj = Math.trunc(tokens[cursor++]!);
    const nk = dimension === "3d" ? Math.trunc(tokens[cursor++]!) : 1;
    dims.push({ ni, nj, nk });
  }
  return { dimension, multiBlock, dims, cursor };
}

/**
 * Parses an ASCII formatted PLOT3D conservative solution file (`.q`).
 */
export function parsePlot3dSolutionAscii(text: string, options?: Plot3dAsciiParseOptions): Plot3dSolution {
  const tokens = tokenizePlot3dNumbers(text);
  if (tokens.length === 0) {
    throw new Error("Empty PLOT3D solution (.q) file");
  }

  const header = detectSolutionHeader(tokens, options);
  const blocks: Plot3dSolutionBlock[] = [];
  let cursor = header.cursor;

  for (let b = 0; b < header.dims.length; b++) {
    const { ni, nj, nk } = header.dims[b]!;
    if (cursor + 4 > tokens.length) {
      throw new Error(`Unexpected EOF reading flow conditions (FSMACH, ALPHA, RE, TIME) for block ${b}`);
    }
    const conditions: Plot3dFlowConditions = {
      fsmach: tokens[cursor++]!,
      alpha: tokens[cursor++]!,
      re: tokens[cursor++]!,
      time: tokens[cursor++]!,
    };

    const nNodes = Math.max(0, ni * nj * nk);
    const readField = (): Float64Array => {
      const len = Math.min(nNodes, Math.max(0, tokens.length - cursor));
      const arr = new Float64Array(len);
      for (let i = 0; i < len; i++) arr[i] = tokens[cursor++]!;
      return arr;
    };

    const rho = readField();
    const rhou = readField();
    const rhov = readField();
    const rhow = header.dimension === "3d" ? readField() : new Float64Array(nNodes);
    const energy = readField();

    blocks.push({ index: b, ni, nj, nk, conditions, rho, rhou, rhov, rhow, energy });
  }

  return {
    format: "ascii",
    dimension: header.dimension,
    multiBlock: header.multiBlock,
    blocks,
  };
}

/**
 * Parses an ASCII formatted PLOT3D function file (`.f`).
 */
export function parsePlot3dFunctionAscii(text: string, options?: Plot3dAsciiParseOptions): Plot3dFunctionFile {
  const tokens = tokenizePlot3dNumbers(text);
  if (tokens.length === 0) {
    throw new Error("Empty PLOT3D function (.f) file");
  }

  const dimsToTry: Plot3dDimension[] = options?.dimension ? [options.dimension] : ["3d", "2d"];
  const mbToTry: boolean[] = options?.multiBlock !== undefined ? [options.multiBlock] : [true, false];

  let dimension: Plot3dDimension = options?.dimension ?? "3d";
  let multiBlock = options?.multiBlock ?? false;
  let blockMeta: Array<{ ni: number; nj: number; nk: number; nVars: number }> = [];
  let cursor = 0;
  let matched = false;

  for (const dim of dimsToTry) {
    for (const mb of mbToTry) {
      let c = 0;
      let nb = 1;
      if (mb) {
        const v = tokens[0];
        if (!isPositiveInt(v) || v > 100_000) continue;
        nb = v;
        c = 1;
      }
      const metaLen = dim === "3d" ? 4 : 3;
      if (c + nb * metaLen > tokens.length) continue;

      const meta: Array<{ ni: number; nj: number; nk: number; nVars: number }> = [];
      let valid = true;
      let expected = 0;
      for (let b = 0; b < nb; b++) {
        const ni = tokens[c++]!;
        const nj = tokens[c++]!;
        const nk = dim === "3d" ? tokens[c++]! : 1;
        const nVars = tokens[c++]!;
        if (!isPositiveInt(ni) || !isPositiveInt(nj) || !isPositiveInt(nk) || !isPositiveInt(nVars)) {
          valid = false;
          break;
        }
        meta.push({ ni, nj, nk, nVars });
        expected += ni * nj * nk * nVars;
      }
      if (valid && c + expected === tokens.length) {
        dimension = dim;
        multiBlock = mb;
        blockMeta = meta;
        cursor = c;
        matched = true;
        break;
      }
    }
    if (matched) break;
  }

  if (!matched) {
    let c = 0;
    let nb = 1;
    if (multiBlock) {
      nb = Math.trunc(tokens[c++]!);
    }
    const metaLen = dimension === "3d" ? 4 : 3;
    for (let b = 0; b < nb; b++) {
      if (c + metaLen > tokens.length) {
        throw new Error(`Unexpected EOF reading .f dimensions for block ${b}`);
      }
      const ni = Math.trunc(tokens[c++]!);
      const nj = Math.trunc(tokens[c++]!);
      const nk = dimension === "3d" ? Math.trunc(tokens[c++]!) : 1;
      const nVars = Math.trunc(tokens[c++]!);
      blockMeta.push({ ni, nj, nk, nVars });
    }
    cursor = c;
  }

  const blocks: Plot3dFunctionBlock[] = [];
  for (let b = 0; b < blockMeta.length; b++) {
    const { ni, nj, nk, nVars } = blockMeta[b]!;
    const nNodes = Math.max(0, ni * nj * nk);
    const fields: Float64Array[] = [];
    for (let v = 0; v < nVars; v++) {
      const len = Math.min(nNodes, Math.max(0, tokens.length - cursor));
      const arr = new Float64Array(len);
      for (let i = 0; i < len; i++) arr[i] = tokens[cursor++]!;
      fields.push(arr);
    }
    blocks.push({ index: b, ni, nj, nk, nVars, fields });
  }

  return { format: "ascii", dimension, multiBlock, blocks };
}

/**
 * Parses a PLOT3D `.nam` variable-names metadata file.
 */
export function parsePlot3dNam(text: string): Plot3dNamMetadata {
  const variableNames: string[] = [];
  let title: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#") || trimmed.startsWith("!")) {
      if (!title) {
        const commentText = trimmed.slice(1).trim();
        if (commentText) title = commentText;
      }
      continue;
    }
    variableNames.push(trimmed);
  }
  return { variableNames, title };
}

/**
 * Serializes a `Plot3dGrid` to ASCII formatted PLOT3D text.
 */
export function serializePlot3dGridAscii(grid: Plot3dGrid, precision: number = 10): string {
  const lines: string[] = [];
  if (grid.multiBlock) {
    lines.push(`${grid.blocks.length}`);
  }
  for (const b of grid.blocks) {
    lines.push(grid.dimension === "3d" ? `${b.ni} ${b.nj} ${b.nk}` : `${b.ni} ${b.nj}`);
  }

  const pushArray = (arr: Float64Array | Int32Array, isInt: boolean): void => {
    const perLine = 6;
    for (let i = 0; i < arr.length; i += perLine) {
      const chunk: string[] = [];
      for (let j = i; j < Math.min(i + perLine, arr.length); j++) {
        const v = arr[j]!;
        chunk.push(isInt ? `${Math.trunc(v)}` : Number(v).toPrecision(precision));
      }
      lines.push(chunk.join(" "));
    }
  };

  for (const b of grid.blocks) {
    pushArray(b.x, false);
    pushArray(b.y, false);
    if (grid.dimension === "3d") {
      pushArray(b.z, false);
    }
    if (grid.hasIblank && b.iblank) {
      pushArray(b.iblank, true);
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Serializes a `Plot3dSolution` to ASCII formatted PLOT3D `.q` text.
 */
export function serializePlot3dSolutionAscii(solution: Plot3dSolution, precision: number = 10): string {
  const lines: string[] = [];
  if (solution.multiBlock) {
    lines.push(`${solution.blocks.length}`);
  }
  for (const b of solution.blocks) {
    lines.push(solution.dimension === "3d" ? `${b.ni} ${b.nj} ${b.nk}` : `${b.ni} ${b.nj}`);
  }

  const pushArray = (arr: Float64Array): void => {
    const perLine = 6;
    for (let i = 0; i < arr.length; i += perLine) {
      const chunk: string[] = [];
      for (let j = i; j < Math.min(i + perLine, arr.length); j++) {
        chunk.push(Number(arr[j]!).toPrecision(precision));
      }
      lines.push(chunk.join(" "));
    }
  };

  for (const b of solution.blocks) {
    const c = b.conditions;
    lines.push([c.fsmach, c.alpha, c.re, c.time].map((v) => Number(v).toPrecision(precision)).join(" "));
    pushArray(b.rho);
    pushArray(b.rhou);
    pushArray(b.rhov);
    if (solution.dimension === "3d") {
      pushArray(b.rhow);
    }
    pushArray(b.energy);
  }
  return lines.join("\n") + "\n";
}

/**
 * Serializes a `Plot3dFunctionFile` to ASCII formatted PLOT3D `.f` text.
 */
export function serializePlot3dFunctionAscii(func: Plot3dFunctionFile, precision: number = 10): string {
  const lines: string[] = [];
  if (func.multiBlock) {
    lines.push(`${func.blocks.length}`);
  }
  for (const b of func.blocks) {
    lines.push(func.dimension === "3d" ? `${b.ni} ${b.nj} ${b.nk} ${b.nVars}` : `${b.ni} ${b.nj} ${b.nVars}`);
  }
  const perLine = 6;
  for (const b of func.blocks) {
    for (const field of b.fields) {
      for (let i = 0; i < field.length; i += perLine) {
        const chunk: string[] = [];
        for (let j = i; j < Math.min(i + perLine, field.length); j++) {
          chunk.push(Number(field[j]!).toPrecision(precision));
        }
        lines.push(chunk.join(" "));
      }
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Auto-detects and parses a PLOT3D ASCII file based on filename extension or content structure.
 */
export function parsePlot3dAuto(text: string, filename: string = "grid.xyz"): Plot3dDataset {
  const lower = filename.split(/[?#]/)[0]!.toLowerCase();
  if (lower.endsWith(".nam")) {
    return { kind: "nam", nam: parsePlot3dNam(text) };
  }
  if (lower.endsWith(".q")) {
    return { kind: "solution", solution: parsePlot3dSolutionAscii(text) };
  }
  if (lower.endsWith(".f") || lower.endsWith(".fun")) {
    return { kind: "function", func: parsePlot3dFunctionAscii(text) };
  }
  // Check if content is non-numeric variable names (.nam)
  const firstNonComment = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("!"));
  if (firstNonComment && /^[A-Za-z_]/.test(firstNonComment)) {
    return { kind: "nam", nam: parsePlot3dNam(text) };
  }
  return { kind: "grid", grid: parsePlot3dGridAscii(text) };
}
