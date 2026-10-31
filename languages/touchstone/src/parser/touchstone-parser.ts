// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  Complex,
  FrequencyUnit,
  ParameterFormat,
  ParameterType,
  TouchstoneDeck,
  TouchstoneOptions,
  TouchstonePoint,
  TouchstoneVersion,
} from "../types.js";

/**
 * Character classification utilities for zero-regex parsing.
 */
function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

/**
 * Frequency multiplier to normalize frequencies to Hertz.
 */
export function getFrequencyMultiplier(unit: FrequencyUnit): number {
  switch (unit) {
    case "HZ":
      return 1;
    case "KHZ":
      return 1e3;
    case "MHZ":
      return 1e6;
    case "GHZ":
      return 1e9;
    default:
      return 1e9;
  }
}

/**
 * Convert raw format values into a standard Complex { re, im } number.
 */
export function toComplex(v1: number, v2: number, format: ParameterFormat): Complex {
  if (format === "RI") {
    return { re: v1, im: v2 };
  }
  if (format === "MA") {
    const rad = (v2 * Math.PI) / 180;
    return {
      re: v1 * Math.cos(rad),
      im: v1 * Math.sin(rad),
    };
  }
  if (format === "DB") {
    const mag = Math.pow(10, v1 / 20);
    const rad = (v2 * Math.PI) / 180;
    return {
      re: mag * Math.cos(rad),
      im: mag * Math.sin(rad),
    };
  }
  return { re: v1, im: v2 };
}

/**
 * Parse Touchstone string content into a TouchstoneDeck AST.
 */
export function parseTouchstone(content: string, filename?: string): TouchstoneDeck {
  const comments: string[] = [];
  let version: TouchstoneVersion = "1.0";
  let numPorts = 0;

  // Infer port count from filename if available (e.g. file.s2p -> 2)
  if (filename) {
    const matchExt = filename.toLowerCase();
    const dotIdx = matchExt.lastIndexOf(".");
    if (dotIdx !== -1) {
      const ext = matchExt.slice(dotIdx);
      if (ext.startsWith(".s") && ext.endsWith("p")) {
        const pNum = parseInt(ext.slice(2, -1), 10);
        if (!isNaN(pNum) && pNum > 0) {
          numPorts = pNum;
        }
      }
    }
  }

  const options: TouchstoneOptions = {
    frequencyUnit: "GHZ",
    parameterType: "S",
    format: "MA",
    referenceResistance: 50,
  };

  let hasOptionLine = false;
  const invalidTokens: { token: string; line: number }[] = [];
  const incompleteRows: { expected: number; received: number; line: number }[] = [];

  const len = content.length;
  let idx = 0;
  let line = 1;

  interface Token {
    text: string;
    line: number;
  }

  const dataTokens: Token[] = [];

  while (idx < len) {
    const ch = content[idx]!;

    // Newlines
    if (ch === "\n") {
      line++;
      idx++;
      continue;
    }
    if (ch === "\r") {
      if (idx + 1 < len && content[idx + 1] === "\n") {
        idx++;
      }
      line++;
      idx++;
      continue;
    }

    // Whitespace
    if (isWhitespace(ch)) {
      idx++;
      continue;
    }

    // Comment line: starts with '!'
    if (ch === "!") {
      let commentText = "";
      idx++; // skip '!'
      while (idx < len && content[idx] !== "\n" && content[idx] !== "\r") {
        commentText += content[idx];
        idx++;
      }
      comments.push(commentText.trim());
      continue;
    }

    // Option line: starts with '#'
    if (ch === "#") {
      hasOptionLine = true;
      options.line = line;
      let optLine = "";
      idx++; // skip '#'
      while (idx < len && content[idx] !== "\n" && content[idx] !== "\r") {
        optLine += content[idx];
        idx++;
      }

      // Parse tokens from option line manually
      let oIdx = 0;
      const oLen = optLine.length;
      const optTokens: string[] = [];
      while (oIdx < oLen) {
        while (oIdx < oLen && isWhitespace(optLine[oIdx]!)) oIdx++;
        if (oIdx >= oLen) break;
        let tok = "";
        while (oIdx < oLen && !isWhitespace(optLine[oIdx]!)) {
          tok += optLine[oIdx]!;
          oIdx++;
        }
        if (tok.length > 0) optTokens.push(tok.toUpperCase());
      }

      for (let t = 0; t < optTokens.length; t++) {
        const tok = optTokens[t]!;
        if (tok === "HZ" || tok === "KHZ" || tok === "MHZ" || tok === "GHZ") {
          options.frequencyUnit = tok as FrequencyUnit;
        } else if (tok === "S" || tok === "Y" || tok === "Z" || tok === "H" || tok === "G") {
          options.parameterType = tok as ParameterType;
        } else if (tok === "MA" || tok === "DB" || tok === "RI") {
          options.format = tok as ParameterFormat;
        } else if (tok === "R") {
          if (t + 1 < optTokens.length) {
            const rVal = parseFloat(optTokens[t + 1]!);
            if (!isNaN(rVal)) {
              options.referenceResistance = rVal;
              t++;
            } else {
              invalidTokens.push({ token: optTokens[t + 1]!, line });
              t++;
            }
          }
        } else {
          invalidTokens.push({ token: tok, line });
        }
      }
      continue;
    }

    // Keyword line (Touchstone 2.0 tags like [Version], [Number of Ports], etc.)
    if (ch === "[") {
      let keyword = "";
      idx++; // skip '['
      while (idx < len && content[idx] !== "]" && content[idx] !== "\n" && content[idx] !== "\r") {
        keyword += content[idx];
        idx++;
      }
      if (idx < len && content[idx] === "]") idx++; // skip ']'
      const kw = keyword.trim().toUpperCase();

      // Read remainder of line for keyword argument
      let argLine = "";
      while (idx < len && content[idx] !== "\n" && content[idx] !== "\r") {
        argLine += content[idx];
        idx++;
      }
      const arg = argLine.trim();

      if (kw === "VERSION") {
        if (arg.startsWith("2")) version = "2.0";
      } else if (kw === "NUMBER OF PORTS") {
        const p = parseInt(arg, 10);
        if (!isNaN(p) && p > 0) numPorts = p;
      }
      continue;
    }

    // Numeric or word token
    const tokenStartLine = line;
    let tok = "";
    while (
      idx < len &&
      !isWhitespace(content[idx]!) &&
      content[idx] !== "!" &&
      content[idx] !== "#" &&
      content[idx] !== "["
    ) {
      tok += content[idx]!;
      idx++;
    }
    if (tok.length > 0) {
      dataTokens.push({ text: tok, line: tokenStartLine });
    }
  }

  // If port count still undetermined, infer from token count
  // Each frequency point has: 1 frequency + 2 * (N^2) numbers
  if (numPorts === 0) {
    if (dataTokens.length >= 9) {
      // Check 2-port first (1 + 8 = 9)
      numPorts = 2;
    } else if (dataTokens.length >= 3) {
      numPorts = 1;
    } else {
      numPorts = 2;
    }
  }

  // Parse frequency data points
  const points: TouchstonePoint[] = [];
  const mult = getFrequencyMultiplier(options.frequencyUnit);
  const valuesPerPoint = 1 + 2 * numPorts * numPorts;

  let tIdx = 0;
  while (tIdx < dataTokens.length) {
    const fToken = dataTokens[tIdx]!;
    const freq = parseFloat(fToken.text);
    if (isNaN(freq)) {
      invalidTokens.push({ token: fToken.text, line: fToken.line });
      tIdx++;
      continue;
    }

    if (tIdx + valuesPerPoint > dataTokens.length) {
      incompleteRows.push({
        expected: valuesPerPoint - 1,
        received: Math.max(0, dataTokens.length - tIdx - 1),
        line: fToken.line,
      });
      break;
    }

    for (let k = 1; k < valuesPerPoint; k++) {
      const dTok = dataTokens[tIdx + k]!;
      if (isNaN(parseFloat(dTok.text))) {
        invalidTokens.push({ token: dTok.text, line: dTok.line });
      }
    }

    const freqHz = freq * mult;
    const matrix: Complex[][] = [];
    for (let r = 0; r < numPorts; r++) {
      matrix.push([]);
    }

    if (numPorts === 1) {
      const v1 = parseFloat(dataTokens[tIdx + 1]!.text);
      const v2 = parseFloat(dataTokens[tIdx + 2]!.text);
      matrix[0]![0] = toComplex(v1, v2, options.format);
    } else if (numPorts === 2) {
      // Touchstone 1.1 order: S11, S21, S12, S22
      const s11_1 = parseFloat(dataTokens[tIdx + 1]!.text);
      const s11_2 = parseFloat(dataTokens[tIdx + 2]!.text);
      const s21_1 = parseFloat(dataTokens[tIdx + 3]!.text);
      const s21_2 = parseFloat(dataTokens[tIdx + 4]!.text);
      const s12_1 = parseFloat(dataTokens[tIdx + 5]!.text);
      const s12_2 = parseFloat(dataTokens[tIdx + 6]!.text);
      const s22_1 = parseFloat(dataTokens[tIdx + 7]!.text);
      const s22_2 = parseFloat(dataTokens[tIdx + 8]!.text);

      matrix[0]![0] = toComplex(s11_1, s11_2, options.format);
      matrix[1]![0] = toComplex(s21_1, s21_2, options.format);
      matrix[0]![1] = toComplex(s12_1, s12_2, options.format);
      matrix[1]![1] = toComplex(s22_1, s22_2, options.format);
    } else {
      // N-Port (N >= 3): row by row
      let pairOffset = tIdx + 1;
      for (let r = 0; r < numPorts; r++) {
        for (let c = 0; c < numPorts; c++) {
          const v1 = parseFloat(dataTokens[pairOffset]!.text);
          const v2 = parseFloat(dataTokens[pairOffset + 1]!.text);
          matrix[r]![c] = toComplex(v1, v2, options.format);
          pairOffset += 2;
        }
      }
    }

    points.push({
      frequency: freq,
      frequencyHz: freqHz,
      matrix,
      line: fToken.line,
    });

    tIdx += valuesPerPoint;
  }

  return {
    version,
    numPorts,
    options,
    points,
    comments,
    sourceFile: filename,
    hasOptionLine,
    invalidTokens,
    incompleteRows,
  };
}

/**
 * Format a complex number into the chosen Touchstone format (RI, MA, or DB).
 */
function formatComplex(c: Complex, fmt: ParameterFormat): [string, string] {
  if (fmt === "RI") {
    return [c.re.toFixed(6), c.im.toFixed(6)];
  }
  const mag = Math.sqrt(c.re * c.re + c.im * c.im);
  const angDeg = (Math.atan2(c.im, c.re) * 180) / Math.PI;

  if (fmt === "MA") {
    return [mag.toFixed(6), angDeg.toFixed(3)];
  }
  // DB
  const db = mag > 1e-12 ? 20 * Math.log10(mag) : -200;
  return [db.toFixed(3), angDeg.toFixed(3)];
}

/**
 * Serialize a Touchstone AST deck back to standard Touchstone file text.
 */
export function serializeTouchstone(deck: TouchstoneDeck): string {
  const lines: string[] = [];

  // Comments header
  lines.push("! ModelScript Touchstone N-Port Model Serializer");
  for (const c of deck.comments) {
    lines.push(`! ${c}`);
  }

  // Version 2.0 tags if applicable
  if (deck.version === "2.0") {
    lines.push("[Version] 2.0");
    lines.push(`[Number of Ports] ${deck.numPorts}`);
    lines.push(`[Number of Frequencies] ${deck.points.length}`);
  }

  // Option line
  lines.push(
    `# ${deck.options.frequencyUnit} ${deck.options.parameterType} ${deck.options.format} R ${deck.options.referenceResistance}`,
  );

  if (deck.version === "2.0") {
    lines.push("[Network Data]");
  }

  for (const pt of deck.points) {
    if (deck.numPorts === 1) {
      const [v1, v2] = formatComplex(pt.matrix[0]![0]!, deck.options.format);
      lines.push(`${pt.frequency.toFixed(4)} ${v1} ${v2}`);
    } else if (deck.numPorts === 2) {
      // Touchstone 2-port ordering: S11, S21, S12, S22
      const [s11_1, s11_2] = formatComplex(pt.matrix[0]![0]!, deck.options.format);
      const [s21_1, s21_2] = formatComplex(pt.matrix[1]![0]!, deck.options.format);
      const [s12_1, s12_2] = formatComplex(pt.matrix[0]![1]!, deck.options.format);
      const [s22_1, s22_2] = formatComplex(pt.matrix[1]![1]!, deck.options.format);
      lines.push(`${pt.frequency.toFixed(4)} ${s11_1} ${s11_2} ${s21_1} ${s21_2} ${s12_1} ${s12_2} ${s22_1} ${s22_2}`);
    } else {
      // N-Port: row by row
      lines.push(`${pt.frequency.toFixed(4)}`);
      for (let r = 0; r < deck.numPorts; r++) {
        const rowParts: string[] = [];
        for (let c = 0; c < deck.numPorts; c++) {
          const [v1, v2] = formatComplex(pt.matrix[r]![c]!, deck.options.format);
          rowParts.push(`${v1} ${v2}`);
        }
        lines.push(`  ${rowParts.join(" ")}`);
      }
    }
  }

  if (deck.version === "2.0") {
    lines.push("[End]");
  }

  return lines.join("\n") + "\n";
}
