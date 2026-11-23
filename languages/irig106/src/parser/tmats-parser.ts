// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  TmatsAttribute,
  TmatsConversionGroup,
  TmatsConversionType,
  TmatsDataSource,
  TmatsGeneralGroup,
  TmatsMeasurement,
  TmatsMeasurementGroup,
  TmatsModel,
  TmatsMultiplexGroup,
  TmatsParseError,
  TmatsPcmFormatGroup,
  TmatsTransmissionGroup,
} from "../types.js";

/**
 * Computes the bit length of a TMATS sync pattern string (binary or hex).
 */
export function inferSyncPatternBits(pattern: string): number {
  const trimmed = pattern.trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (!trimmed) return 0;
  if (/^[01]+$/.test(trimmed) && trimmed.length >= 8) {
    return trimmed.length;
  }
  if (/^[0-9A-Fa-f]+$/.test(trimmed)) {
    return trimmed.length * 4;
  }
  return 0;
}

/**
 * Parses a TMATS word fragment mask (`FW`, binary mask, or hex mask) into bit start & bit length.
 */
export function parseWordFragmentMask(
  mask: string | undefined,
  commonWordLength: number,
): { bitStart: number; bitLength: number } {
  if (!mask || mask.trim().toUpperCase() === "FW") {
    return { bitStart: 0, bitLength: commonWordLength };
  }
  const trimmed = mask.trim();
  if (/^[01]+$/.test(trimmed)) {
    const firstOne = trimmed.indexOf("1");
    const lastOne = trimmed.lastIndexOf("1");
    if (firstOne === -1) return { bitStart: 0, bitLength: 0 };
    return { bitStart: firstOne, bitLength: lastOne - firstOne + 1 };
  }
  const hexMatch = /^(?:0x)?([0-9A-Fa-f]+)$/.exec(trimmed);
  if (hexMatch) {
    const val = Number.parseInt(hexMatch[1]!, 16);
    if (!Number.isFinite(val) || val === 0) return { bitStart: 0, bitLength: 0 };
    const bin = val.toString(2).padStart(commonWordLength, "0");
    const firstOne = bin.indexOf("1");
    const lastOne = bin.lastIndexOf("1");
    if (firstOne === -1) return { bitStart: 0, bitLength: 0 };
    return { bitStart: firstOne, bitLength: lastOne - firstOne + 1 };
  }
  return { bitStart: 0, bitLength: commonWordLength };
}

function parseNumber(val: string): number | undefined {
  const n = Number(val.trim());
  return Number.isFinite(n) ? n : undefined;
}

function normalizeConversionType(val: string): TmatsConversionType {
  const u = val.trim().toUpperCase();
  if (u === "COE" || u === "DER" || u === "PRS" || u === "NON" || u === "DIS") {
    return u;
  }
  return "OTH";
}

/**
 * Parses an IRIG 106 Chapter 9 TMATS document into a structured `TmatsModel`.
 */
export function parseIrig106(source: string): TmatsModel {
  const attributes: TmatsAttribute[] = [];
  const comments: Array<{ text: string; line: number; startOffset: number; endOffset: number }> = [];
  const parseErrors: TmatsParseError[] = [];

  const general: TmatsGeneralGroup = { dataSources: [] };
  const dataSourceMap = new Map<number, TmatsDataSource>();
  const transmissions = new Map<number, TmatsTransmissionGroup>();
  const multiplexes = new Map<number, TmatsMultiplexGroup>();
  const pcmFormats = new Map<number, TmatsPcmFormatGroup>();
  const measurementGroups = new Map<number, TmatsMeasurementGroup>();
  const measurementMap = new Map<string, TmatsMeasurement>();
  const conversions = new Map<number, TmatsConversionGroup>();
  const pairSetMap = new Map<string, { raw?: number; eu?: number }>();

  const lines = source.split(/\r?\n/);
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const lineNum = i + 1;
    const lineStart = offset;
    const lineEnd = offset + rawLine.length;
    // Advance offset by line length + newline (1 char; exact enough for LF, or handle CRLF)
    offset = lineEnd + (source[lineEnd] === "\r" && source[lineEnd + 1] === "\n" ? 2 : 1);

    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Allow C/hash style line comments in addition to TMATS COMMENT:
    if (trimmed.startsWith("//") || trimmed.startsWith("#")) {
      comments.push({ text: trimmed, line: lineNum, startOffset: lineStart, endOffset: lineEnd });
      continue;
    }

    const leadingWs = rawLine.length - rawLine.trimStart().length;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      parseErrors.push({
        message: `Expected 'CODE:VALUE;' attribute syntax, found '${trimmed}'`,
        line: lineNum,
        column: leadingWs + 1,
        startOffset: lineStart + leadingWs,
        endOffset: lineEnd,
      });
      continue;
    }

    const hasSemi = trimmed.endsWith(";");
    if (!hasSemi) {
      parseErrors.push({
        message: `Missing ';' terminator on TMATS attribute '${trimmed.slice(0, colonIdx)}'`,
        line: lineNum,
        column: rawLine.trimEnd().length + 1,
        startOffset: lineStart + leadingWs,
        endOffset: lineEnd,
      });
    }

    const rawCode = trimmed.slice(0, colonIdx).trim();
    const rawValue = (hasSemi ? trimmed.slice(colonIdx + 1, -1) : trimmed.slice(colonIdx + 1)).trim();

    if (rawCode.toUpperCase() === "COMMENT") {
      comments.push({ text: rawValue, line: lineNum, startOffset: lineStart + leadingWs, endOffset: lineEnd });
      attributes.push({
        rawCode: "COMMENT",
        group: "COMMENT",
        subPath: "",
        value: rawValue,
        line: lineNum,
        column: leadingWs + 1,
        startOffset: lineStart + leadingWs,
        endOffset: lineEnd,
        missingTerminator: !hasSemi,
      });
      continue;
    }

    const slashIdx = rawCode.indexOf("\\");
    if (slashIdx === -1) {
      parseErrors.push({
        message: `Invalid TMATS attribute code '${rawCode}' (missing '\\' group separator)`,
        line: lineNum,
        column: leadingWs + 1,
        startOffset: lineStart + leadingWs,
        endOffset: lineEnd,
      });
      continue;
    }

    const groupToken = rawCode.slice(0, slashIdx).toUpperCase();
    const subPath = rawCode.slice(slashIdx + 1).toUpperCase();

    const groupMatch = /^([A-Z])(?:-(\d+))?$/.exec(groupToken);
    if (!groupMatch) {
      parseErrors.push({
        message: `Invalid TMATS group identifier '${groupToken}'`,
        line: lineNum,
        column: leadingWs + 1,
        startOffset: lineStart + leadingWs,
        endOffset: lineEnd,
      });
      continue;
    }

    const groupLetter = groupMatch[1]!;
    const groupIndex = groupMatch[2] !== undefined ? Number.parseInt(groupMatch[2], 10) : undefined;

    const attr: TmatsAttribute = {
      rawCode: `${groupToken}\\${subPath}`,
      group: groupLetter,
      groupIndex,
      subPath,
      value: rawValue,
      line: lineNum,
      column: leadingWs + 1,
      startOffset: lineStart + leadingWs,
      endOffset: lineEnd,
      missingTerminator: !hasSemi,
    };
    attributes.push(attr);

    // Populate structured group models
    switch (groupLetter) {
      case "G": {
        if (general.line === undefined) {
          general.line = lineNum;
          general.startOffset = attr.startOffset;
        }
        general.endOffset = attr.endOffset;
        if (subPath === "PN") general.programName = rawValue;
        else if (subPath === "TA") general.testItem = rawValue;
        else if (subPath === "106") general.irigVersion = rawValue;
        else if (subPath === "OD") general.originationDate = rawValue;
        else if (subPath === "RN") general.revisionNumber = rawValue;
        else {
          const dsiMatch = /^DSI-(\d+)$/.exec(subPath);
          if (dsiMatch) {
            const idx = Number.parseInt(dsiMatch[1]!, 10);
            const ds = dataSourceMap.get(idx) ?? { index: idx, id: rawValue };
            ds.id = rawValue;
            dataSourceMap.set(idx, ds);
          }
          const dstMatch = /^DST-(\d+)$/.exec(subPath);
          if (dstMatch) {
            const idx = Number.parseInt(dstMatch[1]!, 10);
            const ds = dataSourceMap.get(idx) ?? { index: idx, id: "" };
            ds.type = rawValue;
            dataSourceMap.set(idx, ds);
          }
        }
        break;
      }

      case "T": {
        const idx = groupIndex ?? 1;
        let t = transmissions.get(idx);
        if (!t) {
          t = { index: idx, line: lineNum, startOffset: attr.startOffset, endOffset: attr.endOffset };
          transmissions.set(idx, t);
        }
        t.endOffset = attr.endOffset;
        if (subPath === "ID") t.id = rawValue;
        else if (subPath === "RF1") t.rfCarrierFreqMHz = parseNumber(rawValue);
        else if (subPath === "RF2") t.rfBandwidthKHz = parseNumber(rawValue);
        else if (subPath === "RF4") t.modulationType = rawValue;
        else if (subPath === "SCO\\N") t.subcarrierCount = parseNumber(rawValue);
        break;
      }

      case "M": {
        const idx = groupIndex ?? 1;
        let m = multiplexes.get(idx);
        if (!m) {
          m = { index: idx, line: lineNum, startOffset: attr.startOffset, endOffset: attr.endOffset };
          multiplexes.set(idx, m);
        }
        m.endOffset = attr.endOffset;
        if (subPath === "ID") m.id = rawValue;
        else if (subPath === "BB1") m.signalStructureType = rawValue;
        else if (subPath === "BB2") m.basebandModulation = rawValue;
        else if (subPath === "BB\\DLN") m.pcmDataLinkName = rawValue;
        break;
      }

      case "P": {
        const idx = groupIndex ?? 1;
        let p = pcmFormats.get(idx);
        if (!p) {
          p = {
            index: idx,
            minorFramesPerMajorFrame: 1,
            line: lineNum,
            startOffset: attr.startOffset,
            endOffset: attr.endOffset,
          };
          pcmFormats.set(idx, p);
        }
        p.endOffset = attr.endOffset;
        if (subPath === "DLN") p.dataLinkName = rawValue;
        else if (subPath === "D1") p.bitRateBps = parseNumber(rawValue);
        else if (subPath === "D2") p.bitEncoding = rawValue;
        else if (subPath === "D4") p.declaredMinorFrameRateHz = parseNumber(rawValue);
        else if (subPath === "F1") p.commonWordLengthBits = parseNumber(rawValue);
        else if (subPath === "F2") p.wordTransferOrder = rawValue;
        else if (subPath === "F3") p.parity = rawValue;
        else if (subPath === "MF\\N") {
          const n = parseNumber(rawValue);
          if (n !== undefined && n >= 1) p.minorFramesPerMajorFrame = Math.floor(n);
        } else if (subPath === "MF1") p.wordsPerMinorFrame = parseNumber(rawValue);
        else if (subPath === "MF2") p.bitsPerMinorFrame = parseNumber(rawValue);
        else if (subPath === "MF3") p.syncType = rawValue;
        else if (subPath === "MF4") {
          // If MF4 is a small integer (like 16, 24, 32) and MF5 later supplies the pattern, store length;
          // otherwise treat MF4 directly as the sync pattern (hex or binary).
          const asNum = /^\d+$/.test(rawValue) ? Number.parseInt(rawValue, 10) : NaN;
          if (!Number.isNaN(asNum) && asNum >= 4 && asNum <= 64 && rawValue.length <= 2) {
            p.syncPatternBits = asNum;
          } else {
            p.syncPattern = rawValue;
            p.syncPatternBits = inferSyncPatternBits(rawValue);
          }
        } else if (subPath === "MF5") {
          p.syncPattern = rawValue;
          if (p.syncPatternBits === undefined) {
            p.syncPatternBits = inferSyncPatternBits(rawValue);
          }
        } else if (subPath === "ID1") p.subframeIdWordPosition = parseNumber(rawValue);
        break;
      }

      case "D": {
        const idx = groupIndex ?? 1;
        let dg = measurementGroups.get(idx);
        if (!dg) {
          dg = {
            index: idx,
            measurementListNames: new Map<number, string>(),
            measurements: [],
            line: lineNum,
            startOffset: attr.startOffset,
            endOffset: attr.endOffset,
          };
          measurementGroups.set(idx, dg);
        }
        dg.endOffset = attr.endOffset;
        if (subPath === "DLN") {
          dg.dataLinkName = rawValue;
          break;
        }
        const mlnMatch = /^MLN-(\d+)$/.exec(subPath);
        if (mlnMatch) {
          dg.measurementListNames.set(Number.parseInt(mlnMatch[1]!, 10), rawValue);
          break;
        }
        const measMatch = /^(MN|LT|WP|WI|FP|FI|WFM|WFS|WFL)-(\d+)-(\d+)(?:-\d+-\d+)?$/.exec(subPath);
        if (measMatch) {
          const fieldKey = measMatch[1]!;
          const listIdx = Number.parseInt(measMatch[2]!, 10);
          const measIdx = Number.parseInt(measMatch[3]!, 10);
          const mKey = `${idx}:${listIdx}:${measIdx}`;
          let meas = measurementMap.get(mKey);
          if (!meas) {
            meas = {
              groupIndex: idx,
              listIndex: listIdx,
              measurementIndex: measIdx,
              name: `MEAS_${idx}_${listIdx}_${measIdx}`,
              framePosition: 1,
              frameInterval: 1,
              line: lineNum,
              startOffset: attr.startOffset,
              endOffset: attr.endOffset,
            };
            measurementMap.set(mKey, meas);
            dg.measurements.push(meas);
          }
          meas.endOffset = attr.endOffset;
          if (fieldKey === "MN") {
            meas.name = rawValue;
            meas.line = lineNum;
            meas.startOffset = attr.startOffset;
          } else if (fieldKey === "LT") meas.locationType = rawValue;
          else if (fieldKey === "WP") meas.wordPosition = parseNumber(rawValue);
          else if (fieldKey === "WI") meas.wordInterval = parseNumber(rawValue);
          else if (fieldKey === "FP") meas.framePosition = parseNumber(rawValue) ?? 1;
          else if (fieldKey === "FI") meas.frameInterval = parseNumber(rawValue) ?? 1;
          else if (fieldKey === "WFM") meas.wordFragmentMask = rawValue;
          else if (fieldKey === "WFS") meas.bitStart = parseNumber(rawValue);
          else if (fieldKey === "WFL") meas.bitLength = parseNumber(rawValue);
        }
        break;
      }

      case "C": {
        const idx = groupIndex ?? 1;
        let conv = conversions.get(idx);
        if (!conv) {
          conv = {
            index: idx,
            measurementName: `CONV_${idx}`,
            conversionType: "NON",
            coefficients: [],
            derivedParameters: [],
            pairSets: [],
            line: lineNum,
            startOffset: attr.startOffset,
            endOffset: attr.endOffset,
          };
          conversions.set(idx, conv);
        }
        conv.endOffset = attr.endOffset;
        if (subPath === "DCN") {
          conv.measurementName = rawValue;
          conv.line = lineNum;
          conv.startOffset = attr.startOffset;
        } else if (subPath === "MN1") conv.description = rawValue;
        else if (subPath === "MN3") conv.engineeringUnits = rawValue;
        else if (subPath === "BFM") conv.binaryFormat = rawValue.toUpperCase();
        else if (subPath === "DCT") conv.conversionType = normalizeConversionType(rawValue);
        else if (subPath === "CO\\N") conv.polynomialOrder = parseNumber(rawValue);
        else if (subPath === "CO") {
          const v = parseNumber(rawValue);
          if (v !== undefined) conv.coefficients[0] = v;
        } else if (subPath === "DR") {
          conv.derivedFormula = rawValue;
        } else {
          const coMatch = /^CO-(\d+)$/.exec(subPath);
          if (coMatch) {
            const k = Number.parseInt(coMatch[1]!, 10);
            const v = parseNumber(rawValue);
            if (v !== undefined) {
              while (conv.coefficients.length <= k) conv.coefficients.push(0);
              conv.coefficients[k] = v;
            }
          }
          const dpMatch = /^DP-(\d+)$/.exec(subPath);
          if (dpMatch) {
            conv.derivedParameters.push(rawValue);
          }
          const psMatch = /^PS([12])-(\d+)$/.exec(subPath);
          if (psMatch) {
            const which = psMatch[1]!;
            const ptIdx = Number.parseInt(psMatch[2]!, 10);
            const pKey = `${idx}:${ptIdx}`;
            const entry = pairSetMap.get(pKey) ?? {};
            const v = parseNumber(rawValue);
            if (v !== undefined) {
              if (which === "1") entry.raw = v;
              else entry.eu = v;
            }
            pairSetMap.set(pKey, entry);
          }
        }
        break;
      }

      default:
        break;
    }
  }

  // Finalize data sources
  general.dataSources = Array.from(dataSourceMap.values()).sort((a, b) => a.index - b.index);

  // Finalize pair sets & conversion name lookup
  const conversionsByName = new Map<string, TmatsConversionGroup>();
  for (const [idx, conv] of conversions) {
    const pts: Array<{ idx: number; raw: number; eu: number }> = [];
    for (const [pKey, entry] of pairSetMap) {
      const [cIdxStr, ptIdxStr] = pKey.split(":");
      if (Number.parseInt(cIdxStr!, 10) === idx && entry.raw !== undefined && entry.eu !== undefined) {
        pts.push({ idx: Number.parseInt(ptIdxStr!, 10), raw: entry.raw, eu: entry.eu });
      }
    }
    pts.sort((a, b) => a.idx - b.idx);
    conv.pairSets = pts.map((p) => ({ raw: p.raw, eu: p.eu }));
    conversionsByName.set(conv.measurementName, conv);
  }

  const name = general.programName || pcmFormats.values().next().value?.dataLinkName || "TMATS_TELEMETRY";

  return {
    name,
    source,
    attributes,
    general,
    transmissions,
    multiplexes,
    pcmFormats,
    measurementGroups,
    conversions,
    conversionsByName,
    comments,
    parseErrors,
  };
}

/** Alias for `parseIrig106`. */
export const parseTmats = parseIrig106;

/**
 * Serializes a `TmatsModel` back to canonical IRIG 106 Chapter 9 `CODE:VALUE;` text.
 */
export function serializeIrig106(model: TmatsModel): string {
  const lines: string[] = [];
  for (const attr of model.attributes) {
    lines.push(`${attr.rawCode}:${attr.value};`);
  }
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}
