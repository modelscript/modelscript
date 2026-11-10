// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — AMPL .sol Solution File Parser.
 */

export interface SolFileResult {
  message: string;
  options: Record<string, string>;
  primalValues: number[];
  dualValues: number[];
  suffixes?: Record<string, Record<number, number>> | undefined;
}

export function readSolResult(
  solText: string,
  nVars?: number | undefined,
  nConstraints?: number | undefined,
): SolFileResult {
  const lines = solText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { message: "Empty solution file", options: {}, primalValues: [], dualValues: [] };
  }

  const message = lines[0] ?? "";
  const options: Record<string, string> = {};
  const suffixes: Record<string, Record<number, number>> = {};
  const numbers: number[] = [];

  let idx = 1;
  while (idx < lines.length) {
    const line = lines[idx]!;
    if (line.startsWith("Options")) {
      options["Options"] = line;
      idx++;
      break;
    }
    const maybeNum = Number.parseFloat(line);
    if (!Number.isNaN(maybeNum) && /^-?\d/.test(line)) {
      break;
    }
    idx++;
  }

  while (idx < lines.length) {
    const line = lines[idx]!;
    if (/^S[0-3]\s+/.test(line)) {
      const parts = line.split(/\s+/);
      const count = Number(parts[1] ?? 0);
      const sufName = parts[2] ?? "";
      if (!suffixes[sufName]) suffixes[sufName] = {};
      idx++;
      for (let k = 0; k < count && idx < lines.length; k++, idx++) {
        const [idStr, valStr] = lines[idx]!.split(/\s+/);
        const id = Number(idStr);
        const val = Number(valStr);
        if (!Number.isNaN(id) && !Number.isNaN(val)) {
          suffixes[sufName][id] = val;
        }
      }
      continue;
    }

    if (line.startsWith("objno") || line.startsWith("suffix")) {
      options[line] = line;
      idx++;
      continue;
    }
    const val = Number.parseFloat(line);
    if (!Number.isNaN(val)) {
      numbers.push(val);
    }
    idx++;
  }

  if (
    nVars !== undefined &&
    nConstraints !== undefined &&
    nConstraints > 0 &&
    numbers.length >= nConstraints + nVars
  ) {
    // In ASL .sol files, dual multipliers (m) precede primal variables (n)
    const offset = numbers.length - (nConstraints + nVars);
    const dualValues = numbers.slice(offset, offset + nConstraints);
    const primalValues = numbers.slice(offset + nConstraints, offset + nConstraints + nVars);
    return { message, options, primalValues, dualValues, suffixes };
  }

  return { message, options, primalValues: numbers, dualValues: [], suffixes };
}
