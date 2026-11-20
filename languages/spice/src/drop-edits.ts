// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseSpice } from "./parser/spice-parser.js";

export interface SpiceDropTextEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}

export interface SpiceForeignDropInfo {
  cleanName: string;
  shortName: string;
  sourceLanguage: string;
  explicitLanguage: string | null;
  symbol: unknown | null;
  ports: Array<{ name: string; direction?: string }>;
  params: Array<{ name: string; defaultValue: string }>;
}

export interface SpiceDropBuildOptions<TBatch extends { emittedDefs: Set<string> } = { emittedDefs: Set<string> }> {
  docText: string;
  info: SpiceForeignDropInfo;
  instanceName?: string | undefined;
  batchState?: TBatch | undefined;
  sanitizeIdentifier: (raw: string, fallback?: string) => string;
  allocateUniqueIdentifier: (docText: string, baseName: string, batchState?: TBatch) => string;
}

const SPICE_NATIVE_CATEGORY_MAP: Record<string, { prefix: string; defaultVal: string; pins: number }> = {
  R: { prefix: "R", defaultVal: "1k", pins: 2 },
  RESISTOR: { prefix: "R", defaultVal: "1k", pins: 2 },
  C: { prefix: "C", defaultVal: "1u", pins: 2 },
  CAPACITOR: { prefix: "C", defaultVal: "1u", pins: 2 },
  L: { prefix: "L", defaultVal: "1m", pins: 2 },
  INDUCTOR: { prefix: "L", defaultVal: "1m", pins: 2 },
  V: { prefix: "V", defaultVal: "DC 5", pins: 2 },
  VOLTAGESOURCE: { prefix: "V", defaultVal: "DC 5", pins: 2 },
  I: { prefix: "I", defaultVal: "DC 1m", pins: 2 },
  CURRENTSOURCE: { prefix: "I", defaultVal: "DC 1m", pins: 2 },
};

function isAsciiLetter(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function findSpiceInsertPoint(
  docText: string,
  directives?: ReadonlyArray<{ kind: string; span?: { startLine: number } | undefined }>,
): { line: number; character: number; prefixNewline: string } {
  if (directives) {
    for (let i = directives.length - 1; i >= 0; i--) {
      const d = directives[i];
      if (d && d.kind === ".END" && d.span && d.span.startLine > 0) {
        return { line: d.span.startLine - 1, character: 0, prefixNewline: "" };
      }
    }
  }
  const lines = docText.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if ((lines[i] ?? "").trim().toUpperCase() === ".END") {
      return { line: i, character: 0, prefixNewline: "" };
    }
  }
  const lastLine = Math.max(0, lines.length - 1);
  const lastCol = lines[lastLine]?.length ?? 0;
  const prefixNewline = docText.length > 0 && !docText.endsWith("\n") ? "\n" : "";
  return { line: lastLine, character: lastCol, prefixNewline };
}

/**
 * Generates SPICE `.SUBCKT` stub + `X<inst>` call (or native passive/source line)
 * inserted cleanly prior to `.END`, ensuring pin counts and passives pass SPICE linting.
 */
export function buildSpiceComponentDropEdits<
  TBatch extends { emittedDefs: Set<string> } = { emittedDefs: Set<string> },
>(opts: SpiceDropBuildOptions<TBatch>): SpiceDropTextEdit[] {
  const { docText, info, instanceName, batchState, sanitizeIdentifier, allocateUniqueIdentifier } = opts;
  const spiceCircuit = parseSpice(docText);
  const pt = findSpiceInsertPoint(docText, spiceCircuit.directives);

  const upperShort = info.shortName.toUpperCase();
  const nativeSpec = SPICE_NATIVE_CATEGORY_MAP[upperShort];
  const isForeign =
    info.sourceLanguage !== "spice" &&
    (info.symbol !== null ||
      info.explicitLanguage !== null ||
      (info.sourceLanguage !== "unknown" && !nativeSpec) ||
      (!nativeSpec && info.cleanName.includes(".")));

  if (!isForeign && nativeSpec) {
    let devName: string;
    if (instanceName) {
      const sanitized = sanitizeIdentifier(instanceName, "1");
      const firstCh = sanitized[0];
      const suffix = firstCh !== undefined && isAsciiLetter(firstCh) ? sanitized.slice(1) : sanitized;
      devName = `${nativeSpec.prefix}${suffix}`;
    } else {
      devName = allocateUniqueIdentifier(docText, `${nativeSpec.prefix}`, batchState);
    }
    const nodes = Array.from({ length: nativeSpec.pins }, () => "0").join(" ");
    const pos = { line: pt.line, character: pt.character };
    return [
      { range: { start: pos, end: pos }, newText: `${pt.prefixNewline}${devName} ${nodes} ${nativeSpec.defaultVal}\n` },
    ];
  }

  const existingSubckts = new Map<string, { name: string; portCount: number }>();
  for (const sub of spiceCircuit.subcircuits.values()) {
    existingSubckts.set(sub.name.toUpperCase(), { name: sub.name, portCount: sub.ports.length });
  }

  const candidateSubName = sanitizeIdentifier(info.shortName, "STUB").toUpperCase();
  const existingMatch = existingSubckts.get(candidateSubName);
  const subName = existingMatch?.name ?? candidateSubName;
  const subKey = `spice:${subName.toUpperCase()}`;

  const rawPorts = info.ports.map((p) => sanitizeIdentifier(p.name, "pin").toUpperCase());
  const effectivePorts = rawPorts.length > 0 ? rawPorts : ["IN", "OUT"];
  const pinCount = existingMatch ? existingMatch.portCount : effectivePorts.length;

  const numericParams = info.params
    .map((p) => {
      const n = Number(p.defaultValue);
      return Number.isFinite(n) ? { name: sanitizeIdentifier(p.name, "P").toUpperCase(), val: String(n) } : null;
    })
    .filter((p): p is { name: string; val: string } => p !== null);

  const paramSuffix =
    numericParams.length > 0 ? ` PARAMS: ${numericParams.map((p) => `${p.name}=${p.val}`).join(" ")}` : "";

  const chunks: string[] = [];
  if (!existingMatch && !batchState?.emittedDefs.has(subKey)) {
    batchState?.emittedDefs.add(subKey);
    const bodyLines = effectivePorts.map((pin, idx) => `R_stub${idx + 1} ${pin} 0 1k`);
    chunks.push(
      `* @twin ${info.cleanName} (${info.sourceLanguage})`,
      `.SUBCKT ${subName} ${effectivePorts.join(" ")}${paramSuffix}`,
      ...bodyLines,
      `.ENDS ${subName}`,
    );
  }

  const rawXName = instanceName
    ? instanceName.toUpperCase().startsWith("X")
      ? sanitizeIdentifier(instanceName, "X1")
      : `X_${sanitizeIdentifier(instanceName, "cmp")}`
    : allocateUniqueIdentifier(docText, `X_${info.shortName.toLowerCase()}`, batchState);

  const instNodes = Array.from({ length: pinCount }, () => "0").join(" ");
  const nodePart = instNodes ? ` ${instNodes}` : "";
  chunks.push(`${rawXName}${nodePart} ${subName}${paramSuffix}`);

  const pos = { line: pt.line, character: pt.character };
  return [{ range: { start: pos, end: pos }, newText: `${pt.prefixNewline}${chunks.join("\n")}\n` }];
}
