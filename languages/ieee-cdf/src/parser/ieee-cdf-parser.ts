// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  IeeeCdfBranch,
  IeeeCdfBranchType,
  IeeeCdfBus,
  IeeeCdfBusType,
  IeeeCdfFormat,
  IeeeCdfInterchange,
  IeeeCdfLossZone,
  IeeeCdfNetwork,
  IeeeCdfParseIssue,
  IeeeCdfTieLine,
  IeeeCdfTitleCard,
} from "../types.js";

function parseNum(s: string | undefined, fallback = 0): number {
  if (!s) return fallback;
  const trimmed = s.trim();
  if (!trimmed) return fallback;
  const v = Number(trimmed);
  return Number.isFinite(v) ? v : fallback;
}

function parseIntSafe(s: string | undefined, fallback = 0): number {
  if (!s) return fallback;
  const trimmed = s.trim();
  if (!trimmed) return fallback;
  const v = Number.parseInt(trimmed, 10);
  return Number.isFinite(v) ? v : fallback;
}

function tokenizeLine(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    while (i < n && (line[i] === " " || line[i] === "\t" || line[i] === ",")) i++;
    if (i >= n) break;
    if (line[i] === '"' || line[i] === "'") {
      const quote = line[i];
      i++;
      const start = i;
      while (i < n && line[i] !== quote) i++;
      tokens.push(line.slice(start, i));
      if (i < n && line[i] === quote) i++;
    } else {
      const start = i;
      while (i < n && line[i] !== " " && line[i] !== "\t" && line[i] !== ",") i++;
      tokens.push(line.slice(start, i));
    }
  }
  return tokens;
}

/**
 * Detects whether a power-flow deck is in IEEE CDF (1973) or BPA IPF (1970s) format.
 */
export function detectIeeeCdfFormat(source: string): IeeeCdfFormat {
  if (/^\s*BUS\s+DATA\s+FOLLOWS/im.test(source) || /^\s*BRANCH\s+DATA\s+FOLLOWS/im.test(source)) {
    return "ieee-cdf";
  }
  if (/^\s*END\s+OF\s+DATA\s*$/im.test(source)) {
    return "ieee-cdf";
  }
  const lines = source.split(/\r?\n/);
  let bpaCardCount = 0;
  for (const raw of lines) {
    if (/^(?:B[ EQSL]|L |T |E |R |C |\/MVA_BASE|\(POWERFLOW)/i.test(raw)) {
      bpaCardCount++;
    }
  }
  return bpaCardCount >= 2 ? "bpa-ipf" : "ieee-cdf";
}

function parseTitleCard(line: string, lineNumber: number): { card: IeeeCdfTitleCard; valid: boolean } {
  const trimmed = line.trim();
  if (!trimmed) {
    return {
      valid: false,
      card: {
        date: "",
        originator: "",
        mvaBase: 0,
        year: 0,
        season: "",
        caseId: "",
        rawLine: line,
        line: lineNumber,
      },
    };
  }

  // Fixed-column IEEE CDF title card (cols 2-9 date, 11-30 originator, 32-37 MVA base, 39-42 year, 44 season, 46-73 caseId)
  if (line.length >= 35) {
    const mvaFixed = parseNum(line.slice(31, 38), Number.NaN);
    if (Number.isFinite(mvaFixed) && mvaFixed > 0) {
      const restAfterMva = line.slice(37).trim();
      const yearMatch = restAfterMva.match(/^(\d{4})\s+([A-Za-z])\s+(.*)$/);
      return {
        valid: true,
        card: {
          date: line.slice(1, 9).trim(),
          originator: line.slice(10, 31).trim(),
          mvaBase: mvaFixed,
          year: yearMatch ? Number.parseInt(yearMatch[1]!, 10) : parseIntSafe(line.slice(38, 43), 0),
          season: yearMatch ? yearMatch[2]! : line.slice(43, 45).trim(),
          caseId: yearMatch ? yearMatch[3]!.trim() : line.slice(45).trim(),
          rawLine: line,
          line: lineNumber,
        },
      };
    }
  }

  // Free-format fallback: look for MVA base token (e.g. "100.0" or "MVA=100")
  const kvMva = trimmed.match(/MVA(?:_?BASE)?\s*=\s*([+-]?\d+(?:\.\d+)?)/i);
  if (kvMva) {
    const mva = Number(kvMva[1]);
    return {
      valid: Number.isFinite(mva) && mva > 0,
      card: {
        date: "",
        originator: "",
        mvaBase: Number.isFinite(mva) ? mva : 0,
        year: 0,
        season: "",
        caseId: trimmed,
        rawLine: line,
        line: lineNumber,
      },
    };
  }

  const tokens = tokenizeLine(trimmed);
  let mvaBase = 0;
  let year = 0;
  for (const tok of tokens) {
    if (/^\d+\.\d+$/.test(tok) && mvaBase === 0) {
      mvaBase = Number(tok);
    } else if (/^(?:19|20)\d{2}$/.test(tok) && year === 0) {
      year = Number.parseInt(tok, 10);
    }
  }
  if (mvaBase === 0) {
    // Try an integer token like "100" if no decimal float found
    for (const tok of tokens) {
      if (/^\d+$/.test(tok)) {
        const v = Number.parseInt(tok, 10);
        if (v >= 1 && v <= 10000 && v !== year) {
          mvaBase = v;
          break;
        }
      }
    }
  }

  return {
    valid: mvaBase > 0,
    card: {
      date: tokens[0] ?? "",
      originator: tokens[1] ?? "",
      mvaBase,
      year,
      season: "",
      caseId: trimmed,
      rawLine: line,
      line: lineNumber,
    },
  };
}

function clampBusType(t: number): IeeeCdfBusType {
  if (t === 1 || t === 2 || t === 3) return t;
  return 0;
}

function clampBranchType(t: number): IeeeCdfBranchType {
  if (t === 1 || t === 2 || t === 3 || t === 4) return t;
  return 0;
}

function parseCdfBusLine(line: string, lineNumber: number, startOffset: number, endOffset: number): IeeeCdfBus | null {
  // Detect fixed-column IEEE CDF bus line: length >= 50, no quotes, bus number in cols 0..4
  const hasQuotes = line.includes('"') || line.includes("'");
  const fixedBusNum = Number.parseInt(line.slice(0, 4).trim(), 10);

  if (!hasQuotes && line.length >= 50 && Number.isFinite(fixedBusNum) && fixedBusNum > 0) {
    const name = line.slice(5, 17).trim() || `BUS_${fixedBusNum}`;
    const tailTokens = line.slice(17).trim().split(/\s+/);
    const allNumeric = tailTokens.length >= 14 && tailTokens.every((tok) => /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(tok));

    if (allNumeric) {
      return {
        busNumber: fixedBusNum,
        name,
        area: parseIntSafe(tailTokens[0], 1),
        lossZone: parseIntSafe(tailTokens[1], 1),
        type: clampBusType(parseIntSafe(tailTokens[2], 0)),
        finalVoltagePu: parseNum(tailTokens[3], 1.0),
        finalAngleDeg: parseNum(tailTokens[4], 0),
        loadMw: parseNum(tailTokens[5], 0),
        loadMvar: parseNum(tailTokens[6], 0),
        genMw: parseNum(tailTokens[7], 0),
        genMvar: parseNum(tailTokens[8], 0),
        baseKv: parseNum(tailTokens[9], 0),
        desiredVoltsPu: parseNum(tailTokens[10], 0),
        maxMvarOrVolt: parseNum(tailTokens[11], 0),
        minMvarOrVolt: parseNum(tailTokens[12], 0),
        shuntG: parseNum(tailTokens[13], 0),
        shuntB: parseNum(tailTokens[14], 0),
        remoteControlledBus: parseIntSafe(tailTokens[15], 0),
        line: lineNumber,
        startOffset,
        endOffset,
      };
    }

    // Strict packed Fortran fixed-column fallback (handles fused negative signs like "1.0100-12.72")
    const fixedTypeStr = line.slice(24, 26).trim();
    const fixedType = Number.parseInt(fixedTypeStr, 10);
    const fixedVoltStr = line.slice(27, 33).trim();
    const fixedVolt = Number(fixedVoltStr);
    if (
      fixedTypeStr.length > 0 &&
      fixedType >= 0 &&
      fixedType <= 3 &&
      fixedVoltStr.length > 0 &&
      Number.isFinite(fixedVolt)
    ) {
      return {
        busNumber: fixedBusNum,
        name,
        area: parseIntSafe(line.slice(18, 20), 1),
        lossZone: parseIntSafe(line.slice(20, 23), 1),
        type: clampBusType(fixedType),
        finalVoltagePu: fixedVolt,
        finalAngleDeg: parseNum(line.slice(33, 40), 0),
        loadMw: parseNum(line.slice(40, 49), 0),
        loadMvar: parseNum(line.slice(49, 59), 0),
        genMw: parseNum(line.slice(59, 67), 0),
        genMvar: parseNum(line.slice(67, 75), 0),
        baseKv: parseNum(line.slice(76, 83), 0),
        desiredVoltsPu: parseNum(line.slice(84, 90), 0),
        maxMvarOrVolt: parseNum(line.slice(90, 98), 0),
        minMvarOrVolt: parseNum(line.slice(98, 106), 0),
        shuntG: parseNum(line.slice(106, 114), 0),
        shuntB: parseNum(line.slice(114, 122), 0),
        remoteControlledBus: parseIntSafe(line.slice(123, 127), 0),
        line: lineNumber,
        startOffset,
        endOffset,
      };
    }
  }

  // Free-format IEEE CDF bus line:
  // busNumber name area zone type V angle Pload Qload Pgen Qgen baseKv Vdes Qmax Qmin G B remoteBus
  const tokens = tokenizeLine(line);
  if (tokens.length < 6) return null;
  const busNumber = Number.parseInt(tokens[0] ?? "", 10);
  if (!Number.isFinite(busNumber) || busNumber <= 0) return null;

  return {
    busNumber,
    name: tokens[1] || `BUS_${busNumber}`,
    area: parseIntSafe(tokens[2], 1),
    lossZone: parseIntSafe(tokens[3], 1),
    type: clampBusType(parseIntSafe(tokens[4], 0)),
    finalVoltagePu: parseNum(tokens[5], 1.0),
    finalAngleDeg: parseNum(tokens[6], 0),
    loadMw: parseNum(tokens[7], 0),
    loadMvar: parseNum(tokens[8], 0),
    genMw: parseNum(tokens[9], 0),
    genMvar: parseNum(tokens[10], 0),
    baseKv: parseNum(tokens[11], 0),
    desiredVoltsPu: parseNum(tokens[12], 0),
    maxMvarOrVolt: parseNum(tokens[13], 0),
    minMvarOrVolt: parseNum(tokens[14], 0),
    shuntG: parseNum(tokens[15], 0),
    shuntB: parseNum(tokens[16], 0),
    remoteControlledBus: parseIntSafe(tokens[17], 0),
    line: lineNumber,
    startOffset,
    endOffset,
  };
}

function parseCdfBranchLine(
  line: string,
  lineNumber: number,
  startOffset: number,
  endOffset: number,
): IeeeCdfBranch | null {
  // Whitespace-delimited branch line (handles both free-format and spaced fixed-column IEEE CDF)
  const tokens = tokenizeLine(line);
  if (tokens.length >= 8) {
    const fromBus = Number.parseInt(tokens[0] ?? "", 10);
    const toBus = Number.parseInt(tokens[1] ?? "", 10);
    const rVal = Number(tokens[6]);
    const xVal = Number(tokens[7]);
    if (Number.isFinite(fromBus) && Number.isFinite(toBus) && Number.isFinite(rVal) && Number.isFinite(xVal)) {
      return {
        fromBus,
        toBus,
        area: parseIntSafe(tokens[2], 1),
        lossZone: parseIntSafe(tokens[3], 1),
        circuit: tokens[4] || "1",
        type: clampBranchType(parseIntSafe(tokens[5], 0)),
        r: rVal,
        x: xVal,
        b: parseNum(tokens[8], 0),
        rateA: parseNum(tokens[9], 0),
        rateB: parseNum(tokens[10], 0),
        rateC: parseNum(tokens[11], 0),
        controlBus: parseIntSafe(tokens[12], 0),
        side: parseIntSafe(tokens[13], 0),
        tapRatio: parseNum(tokens[14], 0),
        phaseShiftDeg: parseNum(tokens[15], 0),
        minTapOrShift: parseNum(tokens[16], 0),
        maxTapOrShift: parseNum(tokens[17], 0),
        stepSize: parseNum(tokens[18], 0),
        minVoltOrMw: parseNum(tokens[19], 0),
        maxVoltOrMw: parseNum(tokens[20], 0),
        line: lineNumber,
        startOffset,
        endOffset,
      };
    }
  }

  // Packed Fortran fixed-column fallback
  const fixedFrom = Number.parseInt(line.slice(0, 4).trim(), 10);
  const fixedTo = Number.parseInt(line.slice(5, 9).trim(), 10);
  const fixedRStr = line.slice(19, 29).trim();
  const fixedXStr = line.slice(29, 40).trim();

  if (
    line.length >= 40 &&
    Number.isFinite(fixedFrom) &&
    fixedFrom > 0 &&
    Number.isFinite(fixedTo) &&
    fixedTo > 0 &&
    fixedRStr.length > 0 &&
    fixedXStr.length > 0 &&
    Number.isFinite(Number(fixedRStr)) &&
    Number.isFinite(Number(fixedXStr))
  ) {
    return {
      fromBus: fixedFrom,
      toBus: fixedTo,
      area: parseIntSafe(line.slice(10, 12), 1),
      lossZone: parseIntSafe(line.slice(12, 14), 1),
      circuit: line.slice(16, 17).trim() || "1",
      type: clampBranchType(parseIntSafe(line.slice(18, 19), 0)),
      r: parseNum(fixedRStr, 0),
      x: parseNum(fixedXStr, 0),
      b: parseNum(line.slice(40, 50), 0),
      rateA: parseNum(line.slice(50, 55), 0),
      rateB: parseNum(line.slice(56, 61), 0),
      rateC: parseNum(line.slice(62, 67), 0),
      controlBus: parseIntSafe(line.slice(68, 72), 0),
      side: parseIntSafe(line.slice(73, 74), 0),
      tapRatio: parseNum(line.slice(76, 82), 0),
      phaseShiftDeg: parseNum(line.slice(83, 90), 0),
      minTapOrShift: parseNum(line.slice(90, 97), 0),
      maxTapOrShift: parseNum(line.slice(97, 104), 0),
      stepSize: parseNum(line.slice(105, 111), 0),
      minVoltOrMw: parseNum(line.slice(112, 119), 0),
      maxVoltOrMw: parseNum(line.slice(119, 126), 0),
      line: lineNumber,
      startOffset,
      endOffset,
    };
  }

  return null;
}

function parseKeyValuePairs(tokens: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const tok of tokens) {
    const eq = tok.indexOf("=");
    if (eq > 0) {
      map.set(tok.slice(0, eq).toUpperCase(), tok.slice(eq + 1));
    }
  }
  return map;
}

/**
 * Parses a BPA IPF (1970s Interactive Power Flow) deck into the unified `IeeeCdfNetwork` model.
 * Supports `B `, `BE`, `BQ`, `BS`, `L `, `T `, `E `, `R `, and `C ` comment cards.
 */
export function parseBpaIpf(source: string): IeeeCdfNetwork {
  const lines = source.split(/\r?\n/);
  const buses: IeeeCdfBus[] = [];
  const branches: IeeeCdfBranch[] = [];
  const comments: string[] = [];
  const parseIssues: IeeeCdfParseIssue[] = [];

  let mvaBase = 100.0;
  let caseId = "BPA_IPF_CASE";
  let nextBusNum = 1;
  const busNameToNum = new Map<string, number>();

  const getOrLookupBusNum = (nameOrNum: string): number => {
    const trimmed = nameOrNum.trim();
    const key = trimmed.toUpperCase();
    const existing = busNameToNum.get(key);
    if (existing !== undefined) return existing;
    const asInt = Number.parseInt(trimmed, 10);
    if (Number.isFinite(asInt) && String(asInt) === trimmed) return asInt;
    return -1;
  };

  let offset = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx] ?? "";
    const lineNum = idx + 1;
    const startOffset = offset;
    const endOffset = offset + raw.length;
    offset = endOffset + 1;

    if (!raw.trim()) continue;

    // BPA Comment card: 'C ' or '.' or '!'
    if (/^(?:C(?:\s|$)|\.|!)/i.test(raw)) {
      comments.push(raw.slice(1).trim());
      continue;
    }

    // Control cards
    if (/^\s*\(POWERFLOW/i.test(raw)) {
      const m = raw.match(/CASEID\s*=\s*([^,)]+)/i);
      if (m?.[1]) caseId = m[1].trim();
      const baseM = raw.match(/MVA(?:_?BASE)?\s*=\s*([+-]?\d+(?:\.\d+)?)/i);
      if (baseM?.[1]) mvaBase = parseNum(baseM[1], 100.0);
      continue;
    }
    if (/^\s*\/?\s*MVA_?BASE/i.test(raw)) {
      const m = raw.match(/([+-]?\d+(?:\.\d+)?)/);
      if (m?.[1]) mvaBase = parseNum(m[1], 100.0);
      continue;
    }
    if (/^\s*\(END\)/i.test(raw) || /^\s*\/END/i.test(raw)) {
      continue;
    }

    const cardCode = raw.slice(0, 2).toUpperCase();

    // BPA Bus cards: B , BE, BQ, BS
    if (cardCode === "B " || cardCode === "BE" || cardCode === "BQ" || cardCode === "BS") {
      const busType: IeeeCdfBusType = cardCode === "BS" ? 3 : cardCode === "BQ" || cardCode === "BE" ? 2 : 0;
      const body = raw.slice(2).trim();
      const tokens = tokenizeLine(body);
      const kv = parseKeyValuePairs(tokens);
      const positional = tokens.filter((t) => !t.includes("="));

      if (positional.length === 0) {
        parseIssues.push({
          code: "CDF1001",
          message: `Malformed BPA bus card '${cardCode}' on line ${lineNum}`,
          line: lineNum,
        });
        continue;
      }

      let busNumber = nextBusNum++;
      let name = positional[0] ?? `BUS_${busNumber}`;
      let baseKv = 100.0;
      let posStart = 1;

      // Support optional leading integer bus ID if second token is non-numeric name
      if (/^\d+$/.test(name) && positional.length >= 2 && !/^[+-]?\d+(?:\.\d+)?$/.test(positional[1] ?? "")) {
        busNumber = Number.parseInt(name, 10);
        name = positional[1] ?? `BUS_${busNumber}`;
        posStart = 2;
      }

      if (positional[posStart] !== undefined && /^[+-]?\d+(?:\.\d+)?$/.test(positional[posStart] ?? "")) {
        baseKv = parseNum(positional[posStart], 100.0);
        posStart++;
      }

      const loadMw = kv.has("PL")
        ? parseNum(kv.get("PL"))
        : kv.has("PLOAD")
          ? parseNum(kv.get("PLOAD"))
          : parseNum(positional[posStart], 0);
      const loadMvar = kv.has("QL")
        ? parseNum(kv.get("QL"))
        : kv.has("QLOAD")
          ? parseNum(kv.get("QLOAD"))
          : parseNum(positional[posStart + 1], 0);
      const genMw = kv.has("PG")
        ? parseNum(kv.get("PG"))
        : kv.has("PGEN")
          ? parseNum(kv.get("PGEN"))
          : parseNum(positional[posStart + 2], 0);
      const qMax = kv.has("QMAX") ? parseNum(kv.get("QMAX")) : parseNum(positional[posStart + 3], 0);
      const qMin = kv.has("QMIN") ? parseNum(kv.get("QMIN")) : parseNum(positional[posStart + 4], 0);
      const vm = kv.has("V")
        ? parseNum(kv.get("V"), 1.0)
        : kv.has("VM")
          ? parseNum(kv.get("VM"), 1.0)
          : kv.has("VHOLD")
            ? parseNum(kv.get("VHOLD"), 1.0)
            : parseNum(positional[posStart + 5], 1.0);
      const va = kv.has("ANG")
        ? parseNum(kv.get("ANG"), 0)
        : kv.has("VA")
          ? parseNum(kv.get("VA"), 0)
          : parseNum(positional[posStart + 6], 0);
      const shuntG = kv.has("G") ? parseNum(kv.get("G"), 0) : 0;
      const shuntB = kv.has("B") ? parseNum(kv.get("B"), 0) : 0;

      busNameToNum.set(name.toUpperCase(), busNumber);
      buses.push({
        busNumber,
        name,
        area: 1,
        lossZone: 1,
        type: busType,
        finalVoltagePu: vm,
        finalAngleDeg: va,
        loadMw,
        loadMvar,
        genMw,
        genMvar: 0,
        baseKv,
        desiredVoltsPu: busType === 2 || busType === 3 ? vm : 0,
        maxMvarOrVolt: qMax,
        minMvarOrVolt: qMin,
        shuntG,
        shuntB,
        remoteControlledBus: 0,
        bpaCardType: cardCode,
        line: lineNum,
        startOffset,
        endOffset,
      });
      continue;
    }

    // BPA Branch cards: L  (line), T  (transformer), E  (equivalent pi)
    if (cardCode === "L " || cardCode === "T " || cardCode === "E ") {
      const body = raw.slice(2).trim();
      const tokens = tokenizeLine(body);
      const kv = parseKeyValuePairs(tokens);
      const positional = tokens.filter((t) => !t.includes("="));

      if (positional.length < 2) {
        parseIssues.push({
          code: "CDF1001",
          message: `Malformed BPA branch card '${cardCode}' on line ${lineNum}`,
          line: lineNum,
        });
        continue;
      }

      const fromBus = getOrLookupBusNum(positional[0] ?? "");
      const toBus = getOrLookupBusNum(positional[1] ?? "");
      let pIdx = 2;
      let circuit = "1";
      if (positional[pIdx] && !/^[+-]?(?:\d+\.\d*|\.\d+)$/.test(positional[pIdx] ?? "")) {
        // Could be circuit ID or base kV — if it's a single letter/digit like "1" or "A"
        if (/^[A-Za-z0-9]$/.test(positional[pIdx] ?? "")) {
          circuit = positional[pIdx] ?? "1";
          pIdx++;
        }
      }

      const r = kv.has("R") ? parseNum(kv.get("R"), 0) : parseNum(positional[pIdx], 0);
      const x = kv.has("X") ? parseNum(kv.get("X"), 0) : parseNum(positional[pIdx + 1], 0);
      // In BPA, B/2 is per-end charging; if B2= is given, double it; if B= is given, use total B
      const b = kv.has("B")
        ? parseNum(kv.get("B"), 0)
        : kv.has("B2")
          ? 2 * parseNum(kv.get("B2"), 0)
          : 2 * parseNum(positional[pIdx + 2], 0);
      const tapRatio = kv.has("TAP")
        ? parseNum(kv.get("TAP"), cardCode === "T " ? 1.0 : 0)
        : cardCode === "T "
          ? parseNum(positional[pIdx + 3], 1.0)
          : 0;
      const phaseShiftDeg = kv.has("SHIFT")
        ? parseNum(kv.get("SHIFT"), 0)
        : kv.has("ANG")
          ? parseNum(kv.get("ANG"), 0)
          : cardCode === "T "
            ? parseNum(positional[pIdx + 4], 0)
            : 0;

      const branchType: IeeeCdfBranchType = cardCode === "T " ? (Math.abs(phaseShiftDeg) > 1e-9 ? 4 : 1) : 0;

      branches.push({
        fromBus,
        toBus,
        area: 1,
        lossZone: 1,
        circuit,
        type: branchType,
        r,
        x,
        b,
        rateA: kv.has("RATE") ? parseNum(kv.get("RATE"), 0) : 0,
        rateB: 0,
        rateC: 0,
        controlBus: 0,
        side: 0,
        tapRatio,
        phaseShiftDeg,
        minTapOrShift: 0,
        maxTapOrShift: 0,
        stepSize: 0,
        minVoltOrMw: 0,
        maxVoltOrMw: 0,
        bpaCardType: cardCode,
        line: lineNum,
        startOffset,
        endOffset,
      });
      continue;
    }

    // BPA Regulator card: R  from to TMAX=... TMIN=...
    if (cardCode === "R ") {
      const body = raw.slice(2).trim();
      const tokens = tokenizeLine(body);
      const kv = parseKeyValuePairs(tokens);
      const positional = tokens.filter((t) => !t.includes("="));
      if (positional.length >= 2) {
        const fromBus = getOrLookupBusNum(positional[0] ?? "");
        const toBus = getOrLookupBusNum(positional[1] ?? "");
        const existing = branches.find(
          (br) => (br.fromBus === fromBus && br.toBus === toBus) || (br.fromBus === toBus && br.toBus === fromBus),
        );
        if (existing) {
          existing.type = 2;
          if (kv.has("TMAX")) existing.maxTapOrShift = parseNum(kv.get("TMAX"), existing.maxTapOrShift);
          if (kv.has("TMIN")) existing.minTapOrShift = parseNum(kv.get("TMIN"), existing.minTapOrShift);
          if (kv.has("STEP")) existing.stepSize = parseNum(kv.get("STEP"), existing.stepSize);
        }
      }
      continue;
    }

    parseIssues.push({
      code: "CDF1001",
      message: `Unrecognized BPA IPF card '${raw.trim().slice(0, 24)}'`,
      line: lineNum,
    });
  }

  return {
    format: "bpa-ipf",
    title: {
      date: "",
      originator: "BPA IPF",
      mvaBase,
      year: 1973,
      season: "",
      caseId,
      rawLine: caseId,
      line: 1,
    },
    hasTitleCard: true,
    hasEndOfData: true,
    buses,
    branches,
    lossZones: [],
    interchanges: [],
    tieLines: [],
    comments,
    parseIssues,
  };
}

/**
 * Parses an IEEE Common Data Format (1973) or BPA IPF (1970s) power-flow deck.
 */
export function parseIeeeCdf(source: string): IeeeCdfNetwork {
  if (detectIeeeCdfFormat(source) === "bpa-ipf") {
    return parseBpaIpf(source);
  }

  const lines = source.split(/\r?\n/);
  const buses: IeeeCdfBus[] = [];
  const branches: IeeeCdfBranch[] = [];
  const lossZones: IeeeCdfLossZone[] = [];
  const interchanges: IeeeCdfInterchange[] = [];
  const tieLines: IeeeCdfTieLine[] = [];
  const comments: string[] = [];
  const parseIssues: IeeeCdfParseIssue[] = [];

  let title: IeeeCdfTitleCard = {
    date: "",
    originator: "",
    mvaBase: 0,
    year: 0,
    season: "",
    caseId: "",
    rawLine: "",
    line: 1,
  };
  let hasTitleCard = false;
  let hasEndOfData = false;

  type Section = "none" | "bus" | "branch" | "lossZones" | "interchange" | "tieLines";
  let section: Section = "none";

  let offset = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx] ?? "";
    const lineNum = idx + 1;
    const startOffset = offset;
    const endOffset = offset + raw.length;
    offset = endOffset + 1;

    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Optional comment lines outside data sections
    if (section === "none" && (trimmed.startsWith("#") || trimmed.startsWith("//"))) {
      comments.push(trimmed);
      continue;
    }

    // Section headers
    if (/^BUS\s+DATA\s+FOLLOWS/i.test(trimmed)) {
      section = "bus";
      continue;
    }
    if (/^BRANCH\s+DATA\s+FOLLOWS/i.test(trimmed)) {
      section = "branch";
      continue;
    }
    if (/^LOSS\s+ZONES\s+FOLLOWS/i.test(trimmed)) {
      section = "lossZones";
      continue;
    }
    if (/^INTERCHANGE\s+DATA\s+FOLLOWS/i.test(trimmed)) {
      section = "interchange";
      continue;
    }
    if (/^TIE\s+LINES\s+FOLLOWS/i.test(trimmed)) {
      section = "tieLines";
      continue;
    }
    if (/^END\s+OF\s+DATA\s*$/i.test(trimmed)) {
      hasEndOfData = true;
      section = "none";
      break;
    }

    // Title card: first non-empty non-section line before BUS DATA FOLLOWS
    if (!hasTitleCard && section === "none" && buses.length === 0 && branches.length === 0) {
      const parsed = parseTitleCard(raw, lineNum);
      title = parsed.card;
      hasTitleCard = parsed.valid;
      continue;
    }

    // Section terminators
    if (section === "bus" && /^-999\b/.test(trimmed)) {
      section = "none";
      continue;
    }
    if (section === "branch" && /^-999\b/.test(trimmed)) {
      section = "none";
      continue;
    }
    if (section === "lossZones" && /^-99\b|^-999\b/.test(trimmed)) {
      section = "none";
      continue;
    }
    if (section === "interchange" && /^-9\b|^-999\b/.test(trimmed)) {
      section = "none";
      continue;
    }
    if (section === "tieLines" && /^-999\b/.test(trimmed)) {
      section = "none";
      continue;
    }

    // Data cards
    if (section === "bus") {
      const bus = parseCdfBusLine(raw, lineNum, startOffset, endOffset);
      if (bus) {
        buses.push(bus);
      } else {
        parseIssues.push({
          code: "CDF1001",
          message: `Malformed BUS DATA card on line ${lineNum}: '${trimmed.slice(0, 40)}'`,
          line: lineNum,
        });
      }
      continue;
    }

    if (section === "branch") {
      const branch = parseCdfBranchLine(raw, lineNum, startOffset, endOffset);
      if (branch) {
        branches.push(branch);
      } else {
        parseIssues.push({
          code: "CDF1001",
          message: `Malformed BRANCH DATA card on line ${lineNum}: '${trimmed.slice(0, 40)}'`,
          line: lineNum,
        });
      }
      continue;
    }

    if (section === "lossZones") {
      const zoneNum = parseIntSafe(raw.slice(0, 3), Number.NaN);
      if (Number.isFinite(zoneNum) && zoneNum > 0) {
        lossZones.push({
          zoneNumber: zoneNum,
          name: raw.slice(4).trim() || `ZONE_${zoneNum}`,
          line: lineNum,
        });
      } else {
        const toks = tokenizeLine(trimmed);
        const z = parseIntSafe(toks[0], Number.NaN);
        if (Number.isFinite(z) && z > 0) {
          lossZones.push({ zoneNumber: z, name: toks.slice(1).join(" ") || `ZONE_${z}`, line: lineNum });
        }
      }
      continue;
    }

    if (section === "interchange") {
      const areaNum = parseIntSafe(raw.slice(0, 2), Number.NaN);
      if (Number.isFinite(areaNum) && areaNum > 0 && raw.length >= 25) {
        interchanges.push({
          areaNumber: areaNum,
          slackBus: parseIntSafe(raw.slice(3, 7), 0),
          alternateSwingBusName: raw.slice(8, 20).trim(),
          exportMw: parseNum(raw.slice(20, 28), 0),
          toleranceMw: parseNum(raw.slice(29, 35), 0),
          areaCode: raw.slice(37, 43).trim(),
          areaName: raw.slice(45).trim(),
          line: lineNum,
        });
      } else {
        const toks = tokenizeLine(trimmed);
        const a = parseIntSafe(toks[0], Number.NaN);
        if (Number.isFinite(a) && a > 0) {
          interchanges.push({
            areaNumber: a,
            slackBus: parseIntSafe(toks[1], 0),
            alternateSwingBusName: toks[2] ?? "",
            exportMw: parseNum(toks[3], 0),
            toleranceMw: parseNum(toks[4], 0),
            areaCode: toks[5] ?? "",
            areaName: toks.slice(6).join(" "),
            line: lineNum,
          });
        }
      }
      continue;
    }

    if (section === "tieLines") {
      const toks = tokenizeLine(trimmed);
      if (toks.length >= 4) {
        tieLines.push({
          meteredBus: parseIntSafe(toks[0], 0),
          meteredArea: parseIntSafe(toks[1], 0),
          nonMeteredBus: parseIntSafe(toks[2], 0),
          nonMeteredArea: parseIntSafe(toks[3], 0),
          circuit: toks[4] ?? "1",
          line: lineNum,
        });
      }
      continue;
    }
  }

  return {
    format: "ieee-cdf",
    title,
    hasTitleCard,
    hasEndOfData,
    buses,
    branches,
    lossZones,
    interchanges,
    tieLines,
    comments,
    parseIssues,
  };
}
