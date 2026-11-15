// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync } from "@modelscript/easy5/wasm-parser";
import { cstLineText, groupAllCstTokensByLine } from "@modelscript/runtime";
import { createRequire } from "node:module";
import type { Easy5Table } from "../types.js";

const require = createRequire(import.meta.url);
let cachedParser: ReturnType<typeof createWasmParserSync>["parser"] | undefined;
function getEasy5WasmParser() {
  if (!cachedParser) {
    const wasmPath = require.resolve("@modelscript/easy5/parser.wasm");
    cachedParser = createWasmParserSync(wasmPath).parser;
  }
  return cachedParser;
}

/**
 * Parses EASY5 1D/2D lookup table data (.tab or embedded table text).
 */
export function parseEasy5Table(tableText: string): Easy5Table {
  const cstTree = getEasy5WasmParser().parse(tableText);
  const cstLines = groupAllCstTokensByLine(cstTree?.rootNode);
  let name = "LookupTable";
  let dimension: 1 | 2 | 3 = 1;
  let xValues: number[] = [];
  let yValues: number[] = [];
  const dataRows: number[][] = [];

  let inData = false;

  for (const { tokens } of cstLines) {
    const line = cstLineText(tableText, tokens);
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("!") || trimmed.startsWith("#")) continue;

    const nameMatch = /^TABLE\s*:\s*([A-Za-z0-9_]+)/i.exec(trimmed);
    if (nameMatch) {
      name = nameMatch[1]!;
      continue;
    }

    const dimMatch = /^DIMENSION\s*:\s*([123])/i.exec(trimmed);
    if (dimMatch) {
      dimension = parseInt(dimMatch[1]!, 10) as 1 | 2 | 3;
      continue;
    }

    const xMatch = /^X\s*:\s*(\S.*)$/i.exec(trimmed);
    if (xMatch) {
      xValues = xMatch[1]!
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => !isNaN(n));
      continue;
    }

    const yMatch = /^Y\s*:\s*(\S.*)$/i.exec(trimmed);
    if (yMatch) {
      yValues = yMatch[1]!
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => !isNaN(n));
      continue;
    }

    if (/^DATA\s*:/i.test(trimmed)) {
      inData = true;
      const inlineData = trimmed.replace(/^DATA\s*:\s*/i, "").trim();
      if (inlineData) {
        const nums = inlineData
          .split(/[\s,]+/)
          .map(Number)
          .filter((n) => !isNaN(n));
        if (nums.length > 0) dataRows.push(nums);
      }
      continue;
    }

    if (inData) {
      const nums = trimmed
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => !isNaN(n));
      if (nums.length > 0) {
        dataRows.push(nums);
      }
    }
  }

  const flattenedData: number[] | number[][] = dimension === 1 ? dataRows.flat() : dataRows;

  return {
    name,
    dimension,
    xValues,
    yValues: dimension > 1 ? yValues : undefined,
    data: flattenedData,
  };
}
