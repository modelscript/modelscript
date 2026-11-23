// SPDX-License-Identifier: AGPL-3.0-or-later

import { DatcomErrorCode } from "../errors.js";
import type {
  AsyflpParams,
  BodyParams,
  DatcomCase,
  DatcomControlCard,
  DatcomDeck,
  DatcomDerivUnit,
  DatcomNacaCard,
  DatcomNamelistBlock,
  DatcomNamelistValue,
  DatcomParseError,
  DatcomUnitSystem,
  FltconParams,
  OptinsParams,
  PlanformParams,
  SymflpParams,
  SynthsParams,
  WgschrParams,
} from "../types.js";

function parseFortranNumber(token: string): number | null {
  const cleaned = token.trim().replace(/[dD]/g, "e");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(cleaned)) {
    return null;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseNamelistBody(
  body: string,
  baseLine: number,
  errors: DatcomParseError[],
): Record<string, DatcomNamelistValue> {
  const result: Record<string, DatcomNamelistValue> = {};
  // Strip inline comments starting with !
  const stripped = body
    .split(/\r?\n/)
    .map((l) => l.replace(/!.*$/, ""))
    .join(" ");

  // Tokenize by assignments: KEY[(idx)] = values...
  // Match all `NAME` or `NAME(idx)` followed by `=`
  const assignRe = /([A-Za-z][A-Za-z0-9_]*)(?:\s*\(\s*(\d+)\s*\))?\s*=/g;
  const matches: Array<{ key: string; startIdx: number | null; valStart: number; matchStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = assignRe.exec(stripped)) !== null) {
    matches.push({
      key: m[1]!.toUpperCase(),
      startIdx: m[2] !== undefined ? parseInt(m[2], 10) : null,
      valStart: assignRe.lastIndex,
      matchStart: m.index,
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]!;
    const rawVal = stripped
      .slice(cur.valStart, i + 1 < matches.length ? matches[i + 1]!.matchStart : stripped.length)
      .trim()
      .replace(/,+$/, "")
      .trim();

    if (!rawVal) {
      errors.push({
        code: DatcomErrorCode.SYNTAX_ERROR.id,
        message: DatcomErrorCode.SYNTAX_ERROR.message(`Empty value for '${cur.key}'`),
        line: baseLine,
        column: 1,
      });
      continue;
    }

    // Split by comma or whitespace
    const rawTokens = rawVal
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    // Check boolean
    if (rawTokens.length === 1 && /^\.(TRUE|FALSE|T|F)\.$/i.test(rawTokens[0]!)) {
      const upper = rawTokens[0]!.toUpperCase();
      result[cur.key] = upper === ".TRUE." || upper === ".T.";
      continue;
    }

    // Expand Fortran repeat counts (e.g. 3*0.0) and parse numbers
    const nums: number[] = [];
    let allNumbers = true;
    for (const tok of rawTokens) {
      const repMatch = tok.match(/^(\d+)\*(.+)$/);
      if (repMatch) {
        const count = parseInt(repMatch[1]!, 10);
        const val = parseFortranNumber(repMatch[2]!);
        if (val === null) {
          allNumbers = false;
          break;
        }
        for (let r = 0; r < count; r++) nums.push(val);
      } else {
        const val = parseFortranNumber(tok);
        if (val === null) {
          allNumbers = false;
          break;
        }
        nums.push(val);
      }
    }

    if (!allNumbers) {
      // Quoted string or identifier fallback
      const unquoted = rawVal.replace(/^['"]|['"]$/g, "");
      result[cur.key] = unquoted;
      continue;
    }

    if (cur.startIdx !== null) {
      // 1-based indexed array assignment
      const existing = Array.isArray(result[cur.key]) ? [...(result[cur.key] as number[])] : [];
      const offset = Math.max(0, cur.startIdx - 1);
      for (let k = 0; k < nums.length; k++) {
        existing[offset + k] = nums[k]!;
      }
      result[cur.key] = existing;
    } else if (nums.length === 1) {
      result[cur.key] = nums[0]!;
    } else {
      result[cur.key] = nums;
    }
  }

  return result;
}

function asNum(v: DatcomNamelistValue | undefined): number | undefined {
  if (typeof v === "number") return v;
  if (Array.isArray(v) && v.length > 0) return v[0];
  return undefined;
}

function asNumArray(v: DatcomNamelistValue | undefined): number[] | undefined {
  if (Array.isArray(v)) return v;
  if (typeof v === "number") return [v];
  return undefined;
}

function asBool(v: DatcomNamelistValue | undefined): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

function applyNamelistToCase(c: DatcomCase, block: DatcomNamelistBlock): void {
  const v = block.values;
  switch (block.group) {
    case "FLTCON": {
      const prev: FltconParams = c.fltcon ?? {};
      c.fltcon = {
        ...prev,
        NMACH: asNum(v["NMACH"]) ?? prev.NMACH,
        MACH: asNumArray(v["MACH"]) ?? prev.MACH,
        NALPHA: asNum(v["NALPHA"]) ?? prev.NALPHA,
        ALSCHD: asNumArray(v["ALSCHD"]) ?? prev.ALSCHD,
        NALT: asNum(v["NALT"]) ?? prev.NALT,
        ALT: asNumArray(v["ALT"]) ?? prev.ALT,
        WT: asNum(v["WT"]) ?? prev.WT,
        LOOP: asNum(v["LOOP"]) ?? prev.LOOP,
        RNNUB: asNumArray(v["RNNUB"]) ?? prev.RNNUB,
        VINF: asNumArray(v["VINF"]) ?? prev.VINF,
        GAMMA: asNum(v["GAMMA"]) ?? prev.GAMMA,
        STMACH: asNum(v["STMACH"]) ?? prev.STMACH,
        TSMACH: asNum(v["TSMACH"]) ?? prev.TSMACH,
        TR: asNum(v["TR"]) ?? prev.TR,
      };
      break;
    }
    case "OPTINS": {
      const prev: OptinsParams = c.optins ?? {};
      c.optins = {
        ...prev,
        SREF: asNum(v["SREF"]) ?? prev.SREF,
        CBARR: asNum(v["CBARR"]) ?? prev.CBARR,
        BLREF: asNum(v["BLREF"]) ?? prev.BLREF,
        ROUGFC: asNum(v["ROUGFC"]) ?? prev.ROUGFC,
      };
      break;
    }
    case "SYNTHS": {
      const prev: SynthsParams = c.synths ?? {};
      c.synths = {
        ...prev,
        XCG: asNum(v["XCG"]) ?? prev.XCG,
        ZCG: asNum(v["ZCG"]) ?? prev.ZCG,
        XW: asNum(v["XW"]) ?? prev.XW,
        ZW: asNum(v["ZW"]) ?? prev.ZW,
        ALIW: asNum(v["ALIW"]) ?? prev.ALIW,
        XH: asNum(v["XH"]) ?? prev.XH,
        ZH: asNum(v["ZH"]) ?? prev.ZH,
        ALIH: asNum(v["ALIH"]) ?? prev.ALIH,
        XV: asNum(v["XV"]) ?? prev.XV,
        ZV: asNum(v["ZV"]) ?? prev.ZV,
        XVF: asNum(v["XVF"]) ?? prev.XVF,
        ZVF: asNum(v["ZVF"]) ?? prev.ZVF,
        VERTUP: asBool(v["VERTUP"]) ?? prev.VERTUP,
        HINAX: asNum(v["HINAX"]) ?? prev.HINAX,
      };
      break;
    }
    case "BODY": {
      const prev: BodyParams = c.body ?? {};
      c.body = {
        ...prev,
        NX: asNum(v["NX"]) ?? prev.NX,
        X: asNumArray(v["X"]) ?? prev.X,
        S: asNumArray(v["S"]) ?? prev.S,
        P: asNumArray(v["P"]) ?? prev.P,
        R: asNumArray(v["R"]) ?? prev.R,
        ZU: asNumArray(v["ZU"]) ?? prev.ZU,
        ZL: asNumArray(v["ZL"]) ?? prev.ZL,
        BNOSE: asNum(v["BNOSE"]) ?? prev.BNOSE,
        BTAIL: asNum(v["BTAIL"]) ?? prev.BTAIL,
        BLN: asNum(v["BLN"]) ?? prev.BLN,
        BLA: asNum(v["BLA"]) ?? prev.BLA,
        DS: asNum(v["DS"]) ?? prev.DS,
        ITYPE: asNum(v["ITYPE"]) ?? prev.ITYPE,
        METHOD: asNum(v["METHOD"]) ?? prev.METHOD,
      };
      break;
    }
    case "WGPLNF":
    case "HTPLNF":
    case "VTPLNF":
    case "VFPLNF": {
      const key = block.group.toLowerCase() as "wgplnf" | "htplnf" | "vtplnf" | "vfplnf";
      const prev: PlanformParams = c[key] ?? {};
      c[key] = {
        ...prev,
        CHRDTP: asNum(v["CHRDTP"]) ?? prev.CHRDTP,
        SSPNE: asNum(v["SSPNE"]) ?? prev.SSPNE,
        SSPN: asNum(v["SSPN"]) ?? prev.SSPN,
        CHRDR: asNum(v["CHRDR"]) ?? prev.CHRDR,
        SAVSI: asNum(v["SAVSI"]) ?? prev.SAVSI,
        CHSTAT: asNum(v["CHSTAT"]) ?? prev.CHSTAT,
        TWISTA: asNum(v["TWISTA"]) ?? prev.TWISTA,
        DHDADI: asNum(v["DHDADI"]) ?? prev.DHDADI,
        DHDADO: asNum(v["DHDADO"]) ?? prev.DHDADO,
        TYPE: asNum(v["TYPE"]) ?? prev.TYPE,
        SSPNOP: asNum(v["SSPNOP"]) ?? prev.SSPNOP,
        CHRDBP: asNum(v["CHRDBP"]) ?? prev.CHRDBP,
        SAVSO: asNum(v["SAVSO"]) ?? prev.SAVSO,
      };
      break;
    }
    case "SYMFLP": {
      const prev: SymflpParams = c.symflp ?? {};
      c.symflp = {
        ...prev,
        FTYPE: asNum(v["FTYPE"]) ?? prev.FTYPE,
        NDELTA: asNum(v["NDELTA"]) ?? prev.NDELTA,
        DELTA: asNumArray(v["DELTA"]) ?? prev.DELTA,
        SPANFI: asNum(v["SPANFI"]) ?? prev.SPANFI,
        SPANFO: asNum(v["SPANFO"]) ?? prev.SPANFO,
        CHRDFI: asNum(v["CHRDFI"]) ?? prev.CHRDFI,
        CHRDFO: asNum(v["CHRDFO"]) ?? prev.CHRDFO,
        PHETE: asNum(v["PHETE"]) ?? prev.PHETE,
        PHETEP: asNum(v["PHETEP"]) ?? prev.PHETEP,
        CB: asNum(v["CB"]) ?? prev.CB,
        TC: asNum(v["TC"]) ?? prev.TC,
        NTYPE: asNum(v["NTYPE"]) ?? prev.NTYPE,
      };
      break;
    }
    case "ASYFLP": {
      const prev: AsyflpParams = c.asyflp ?? {};
      c.asyflp = {
        ...prev,
        STYPE: asNum(v["STYPE"]) ?? prev.STYPE,
        NDELTA: asNum(v["NDELTA"]) ?? prev.NDELTA,
        DELTAL: asNumArray(v["DELTAL"]) ?? prev.DELTAL,
        DELTAR: asNumArray(v["DELTAR"]) ?? prev.DELTAR,
        SPANFI: asNum(v["SPANFI"]) ?? prev.SPANFI,
        SPANFO: asNum(v["SPANFO"]) ?? prev.SPANFO,
        CHRDFI: asNum(v["CHRDFI"]) ?? prev.CHRDFI,
        CHRDFO: asNum(v["CHRDFO"]) ?? prev.CHRDFO,
      };
      break;
    }
    case "WGSCHR": {
      const prev: WgschrParams = c.wgschr ?? {};
      c.wgschr = {
        ...prev,
        TYPEIN: asNum(v["TYPEIN"]) ?? prev.TYPEIN,
        NPTS: asNum(v["NPTS"]) ?? prev.NPTS,
        X: asNumArray(v["X"]) ?? prev.X,
        YUPPER: asNumArray(v["YUPPER"]) ?? prev.YUPPER,
        YLOWER: asNumArray(v["YLOWER"]) ?? prev.YLOWER,
        MEAN: asNumArray(v["MEAN"]) ?? prev.MEAN,
        THICK: asNumArray(v["THICK"]) ?? prev.THICK,
        TOVC: asNum(v["TOVC"]) ?? prev.TOVC,
        DELTAY: asNum(v["DELTAY"]) ?? prev.DELTAY,
        XOVC: asNum(v["XOVC"]) ?? prev.XOVC,
        CLI: asNum(v["CLI"]) ?? prev.CLI,
        ALPHAI: asNum(v["ALPHAI"]) ?? prev.ALPHAI,
        CLMAXL: asNum(v["CLMAXL"]) ?? prev.CLMAXL,
        CMO: asNum(v["CMO"]) ?? prev.CMO,
        LERI: asNum(v["LERI"]) ?? prev.LERI,
      };
      break;
    }
    default:
      break;
  }
}

function createEmptyCase(index: number, startOffset: number, inherited?: DatcomCase): DatcomCase {
  if (inherited) {
    return {
      caseId: `CASE_${index + 1}`,
      dim: inherited.dim,
      deriv: inherited.deriv,
      damp: inherited.damp,
      build: inherited.build,
      plot: inherited.plot,
      save: false,
      nacaCards: [...inherited.nacaCards],
      namelists: [],
      fltcon: inherited.fltcon ? { ...inherited.fltcon } : undefined,
      optins: inherited.optins ? { ...inherited.optins } : undefined,
      synths: inherited.synths ? { ...inherited.synths } : undefined,
      body: inherited.body ? { ...inherited.body } : undefined,
      wgplnf: inherited.wgplnf ? { ...inherited.wgplnf } : undefined,
      htplnf: inherited.htplnf ? { ...inherited.htplnf } : undefined,
      vtplnf: inherited.vtplnf ? { ...inherited.vtplnf } : undefined,
      vfplnf: inherited.vfplnf ? { ...inherited.vfplnf } : undefined,
      symflp: inherited.symflp ? { ...inherited.symflp } : undefined,
      asyflp: inherited.asyflp ? { ...inherited.asyflp } : undefined,
      wgschr: inherited.wgschr ? { ...inherited.wgschr } : undefined,
      controlCards: [],
      parseErrors: [],
      startOffset,
      endOffset: startOffset,
    };
  }
  return {
    caseId: `CASE_${index + 1}`,
    dim: "FT",
    deriv: "DEG",
    damp: false,
    build: false,
    plot: false,
    save: false,
    nacaCards: [],
    namelists: [],
    controlCards: [],
    parseErrors: [],
    startOffset,
    endOffset: startOffset,
  };
}

/**
 * Parses a USAF Stability and Control Digital DATCOM input deck into structured cases.
 */
export function parseDatcomDeck(source: string): DatcomDeck {
  const lines = source.split(/\r?\n/);
  const cases: DatcomCase[] = [];
  const globalErrors: DatcomParseError[] = [];

  let currentCase = createEmptyCase(0, 0);
  let hasContent = false;
  let offset = 0;

  let inNamelist = false;
  let nlGroup = "";
  let nlStartLine = 0;
  let nlStartOffset = 0;
  let nlBuffer = "";

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const lineNum = i + 1;
    const lineStart = offset;
    offset += rawLine.length + 1;

    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Skip comment lines outside namelist blocks
    if (!inNamelist && (trimmed.startsWith("*") || trimmed.startsWith("!") || trimmed.startsWith("#"))) {
      continue;
    }

    if (inNamelist) {
      // Look for closing `$`, `$END`, or `/`
      const endMatch = rawLine.match(/\$(?:END)?\b|\$\s*$|\/\s*$/i);
      if (endMatch && endMatch.index !== undefined) {
        nlBuffer += "\n" + rawLine.slice(0, endMatch.index);
        const values = parseNamelistBody(nlBuffer, nlStartLine, currentCase.parseErrors);
        const block: DatcomNamelistBlock = {
          group: nlGroup,
          values,
          line: nlStartLine,
          startOffset: nlStartOffset,
          endOffset: lineStart + endMatch.index + endMatch[0].length,
        };
        currentCase.namelists.push(block);
        applyNamelistToCase(currentCase, block);
        inNamelist = false;
        nlGroup = "";
        nlBuffer = "";
        currentCase.endOffset = offset;
      } else {
        nlBuffer += "\n" + rawLine;
      }
      continue;
    }

    // Check for NAMELIST start: `$GROUP ...` or `&GROUP ...`
    const nlStartMatch = trimmed.match(/^[$&]([A-Za-z][A-Za-z0-9_]*)\b(.*)$/);
    if (nlStartMatch) {
      hasContent = true;
      nlGroup = nlStartMatch[1]!.toUpperCase();
      nlStartLine = lineNum;
      nlStartOffset = lineStart + rawLine.indexOf(nlStartMatch[0][0]!);
      const rest = nlStartMatch[2] ?? "";

      // Check if closed on the same line
      const sameLineEnd = rest.match(/\$(?:END)?\b|\$\s*$|\/\s*$/i);
      if (sameLineEnd && sameLineEnd.index !== undefined) {
        const body = rest.slice(0, sameLineEnd.index);
        const values = parseNamelistBody(body, nlStartLine, currentCase.parseErrors);
        const block: DatcomNamelistBlock = {
          group: nlGroup,
          values,
          line: nlStartLine,
          startOffset: nlStartOffset,
          endOffset: lineStart + rawLine.length,
        };
        currentCase.namelists.push(block);
        applyNamelistToCase(currentCase, block);
        currentCase.endOffset = offset;
      } else {
        inNamelist = true;
        nlBuffer = rest;
      }
      continue;
    }

    // Control cards
    const upper = trimmed.toUpperCase();

    if (/^CASEID\b/.test(upper)) {
      hasContent = true;
      const val = trimmed.slice(6).trim();
      currentCase.caseId = val || currentCase.caseId;
      currentCase.controlCards.push({ kind: "CASEID", value: val, line: lineNum, raw: trimmed });
      currentCase.endOffset = offset;
      continue;
    }

    if (/^DIM\s+(FT|IN|M|CM)\b/.test(upper)) {
      hasContent = true;
      const m = upper.match(/^DIM\s+(FT|IN|M|CM)\b/)!;
      currentCase.dim = m[1] as DatcomUnitSystem;
      currentCase.controlCards.push({ kind: "DIM", value: m[1], line: lineNum, raw: trimmed });
      currentCase.endOffset = offset;
      continue;
    }

    if (/^DERIV\s+(DEG|RAD)\b/.test(upper)) {
      hasContent = true;
      const m = upper.match(/^DERIV\s+(DEG|RAD)\b/)!;
      currentCase.deriv = m[1] as DatcomDerivUnit;
      currentCase.controlCards.push({ kind: "DERIV", value: m[1], line: lineNum, raw: trimmed });
      currentCase.endOffset = offset;
      continue;
    }

    if (/^NACA[\s-]/.test(upper)) {
      hasContent = true;
      // Match NACA-W-4-0012 or NACA W 4 0012 or malformed NACA card
      const nacaMatch = upper.match(/^NACA[\s-]+([WHVF])[\s-]+(\d)[\s-]+([A-Z0-9]+)$/);
      if (nacaMatch) {
        const card: DatcomNacaCard = {
          surface: nacaMatch[1] as "W" | "H" | "V" | "F",
          series: parseInt(nacaMatch[2]!, 10),
          designation: nacaMatch[3]!,
          line: lineNum,
          raw: trimmed,
        };
        currentCase.nacaCards.push(card);
        currentCase.controlCards.push({ kind: "NACA", value: trimmed, line: lineNum, raw: trimmed });
      } else {
        // Store malformed NACA card for linter (DAT2002)
        currentCase.nacaCards.push({
          surface: "W",
          series: 0,
          designation: trimmed,
          line: lineNum,
          raw: trimmed,
        });
        currentCase.controlCards.push({ kind: "NACA", value: trimmed, line: lineNum, raw: trimmed });
      }
      currentCase.endOffset = offset;
      continue;
    }

    if (/^NEXT\s+CASE\b/.test(upper)) {
      currentCase.controlCards.push({ kind: "NEXT CASE", line: lineNum, raw: trimmed });
      currentCase.endOffset = offset;
      if (hasContent) {
        cases.push(currentCase);
      }
      const inherited = currentCase.save ? currentCase : undefined;
      currentCase = createEmptyCase(cases.length, offset, inherited);
      hasContent = false;
      continue;
    }

    const simpleCardMatch = upper.match(/^(DAMP|BUILD|PLOT|SAVE|PART|TRIM)\b/);
    if (simpleCardMatch) {
      hasContent = true;
      const kw = simpleCardMatch[1] as DatcomControlCard["kind"];
      if (kw === "DAMP") currentCase.damp = true;
      if (kw === "BUILD") currentCase.build = true;
      if (kw === "PLOT") currentCase.plot = true;
      if (kw === "SAVE") currentCase.save = true;
      currentCase.controlCards.push({ kind: kw, line: lineNum, raw: trimmed });
      currentCase.endOffset = offset;
      continue;
    }

    // Unrecognized line outside NAMELIST
    const err: DatcomParseError = {
      code: DatcomErrorCode.SYNTAX_ERROR.id,
      message: DatcomErrorCode.SYNTAX_ERROR.message(`Unrecognized card '${trimmed.slice(0, 40)}'`),
      line: lineNum,
      column: 1,
    };
    currentCase.parseErrors.push(err);
    globalErrors.push(err);
  }

  // Unterminated NAMELIST block at EOF
  if (inNamelist) {
    const err: DatcomParseError = {
      code: DatcomErrorCode.UNTERMINATED_NAMELIST.id,
      message: DatcomErrorCode.UNTERMINATED_NAMELIST.message(nlGroup),
      line: nlStartLine,
      column: 1,
    };
    currentCase.parseErrors.push(err);
    globalErrors.push(err);
    const values = parseNamelistBody(nlBuffer, nlStartLine, currentCase.parseErrors);
    const block: DatcomNamelistBlock = {
      group: nlGroup,
      values,
      line: nlStartLine,
      startOffset: nlStartOffset,
      endOffset: source.length,
    };
    currentCase.namelists.push(block);
    applyNamelistToCase(currentCase, block);
  }

  if (hasContent || cases.length === 0) {
    currentCase.endOffset = source.length;
    cases.push(currentCase);
  }

  return { cases, parseErrors: globalErrors };
}
