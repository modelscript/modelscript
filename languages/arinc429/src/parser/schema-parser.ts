// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser for ARINC 429 bus schema and trace files (`.a429`, `.arinc429`, `.429`).
 *
 * Supported directives:
 *   BUS <name>
 *   RATE <HIGH|LOW>
 *   LABEL <octal> <name> [ENCODING BNR|BCD|DISCRETE] [SDI <0..3>] [RANGE <num>]
 *                        [RESOLUTION <num>] [UNITS <unit>] [RATE <hz>] [EQUIPMENT <eq>]
 *   FRAME <timestamp> WORD <0xXXXXXXXX>
 *   WORD <0xXXXXXXXX>
 *   # comments
 */

import { lookupStandardArinc429Label } from "../catalog/arinc429-std-schemas.js";
import type {
  Arinc429BusRate,
  Arinc429Document,
  Arinc429Encoding,
  Arinc429FrameEntry,
  Arinc429LabelDef,
  Arinc429ParseError,
} from "../types.js";
import { formatArinc429Hex, parseOctalLabel } from "./codec.js";

/**
 * Parses an ARINC 429 bus schema & trace text into an `Arinc429Document`.
 */
export function parseArinc429(source: string): Arinc429Document {
  let busName = "ARINC429_BUS";
  let rate: Arinc429BusRate = "LOW";
  let rateExplicit = false;
  const labels: Arinc429LabelDef[] = [];
  const frames: Arinc429FrameEntry[] = [];
  const parseErrors: Arinc429ParseError[] = [];

  const lines = source.split(/\r?\n/);
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const lineNum = i + 1;
    const lineStartOffset = offset;
    offset += rawLine.length + 1;

    // Strip inline '#' comments
    const hashIdx = rawLine.indexOf("#");
    const comment = hashIdx >= 0 ? rawLine.slice(hashIdx + 1).trim() : undefined;
    const body = (hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine).trim();
    if (!body) continue;

    const tokens = body.split(/\s+/);
    const keyword = (tokens[0] ?? "").toUpperCase();

    if (keyword === "BUS") {
      const nameTok = tokens[1];
      if (!nameTok) {
        parseErrors.push({ message: "Expected bus identifier after BUS", line: lineNum, column: 1 });
      } else {
        busName = nameTok;
      }
      continue;
    }

    if (keyword === "RATE") {
      const rateTok = (tokens[1] ?? "").toUpperCase();
      if (rateTok === "HIGH" || rateTok === "LOW") {
        rate = rateTok;
        rateExplicit = true;
      } else {
        parseErrors.push({
          message: `Invalid bus RATE '${tokens[1] ?? ""}'; expected 'HIGH' or 'LOW'`,
          line: lineNum,
          column: 1,
        });
      }
      continue;
    }

    if (keyword === "LABEL") {
      const octalTok = tokens[1];
      if (!octalTok) {
        parseErrors.push({ message: "Expected octal label after LABEL", line: lineNum, column: 1 });
        continue;
      }

      const labelValue = parseOctalLabel(octalTok);
      const labelOctal = Number.isNaN(labelValue) ? octalTok : octalTok.padStart(3, "0");
      const std = Number.isNaN(labelValue) ? undefined : lookupStandardArinc429Label(labelOctal);

      // Next token is either the parameter name or a keyword
      const labelKeywords = new Set(["ENCODING", "SDI", "RANGE", "RESOLUTION", "UNITS", "RATE", "EQUIPMENT"]);

      let idx = 2;
      let name = std?.name ?? `LABEL_${labelOctal}`;
      const maybeName = tokens[idx];
      if (maybeName && !labelKeywords.has(maybeName.toUpperCase())) {
        name = maybeName;
        idx++;
      }

      let encoding: Arinc429Encoding = std?.encoding ?? "BNR";
      let sdi: number | undefined;
      let range: number | undefined = std?.range;
      let resolution: number | undefined = std?.resolution;
      let units: string | undefined = std?.units;
      let rateHz: number | undefined = std?.defaultRateHz;
      let equipment: string | undefined = std?.equipment;

      while (idx < tokens.length) {
        const key = (tokens[idx] ?? "").toUpperCase();
        const val = tokens[idx + 1];
        if (!val) {
          parseErrors.push({
            message: `Missing value for LABEL attribute '${key}'`,
            line: lineNum,
            column: 1,
          });
          break;
        }
        switch (key) {
          case "ENCODING": {
            const encUp = val.toUpperCase();
            if (encUp === "BNR" || encUp === "BCD" || encUp === "DISCRETE") {
              encoding = encUp;
            } else {
              parseErrors.push({
                message: `Invalid ENCODING '${val}'; expected BNR, BCD, or DISCRETE`,
                line: lineNum,
                column: 1,
              });
            }
            break;
          }
          case "SDI": {
            const parsed = Number.parseInt(val, 10);
            if (Number.isNaN(parsed)) {
              parseErrors.push({ message: `Invalid SDI value '${val}'`, line: lineNum, column: 1 });
            } else {
              sdi = parsed;
            }
            break;
          }
          case "RANGE": {
            const parsed = Number.parseFloat(val);
            if (!Number.isFinite(parsed)) {
              parseErrors.push({ message: `Invalid RANGE value '${val}'`, line: lineNum, column: 1 });
            } else {
              range = parsed;
            }
            break;
          }
          case "RESOLUTION": {
            const parsed = Number.parseFloat(val);
            if (!Number.isFinite(parsed) || parsed <= 0) {
              parseErrors.push({ message: `Invalid RESOLUTION value '${val}'`, line: lineNum, column: 1 });
            } else {
              resolution = parsed;
            }
            break;
          }
          case "UNITS": {
            units = val.replace(/^["']|["']$/g, "");
            break;
          }
          case "RATE": {
            const parsed = Number.parseFloat(val);
            if (!Number.isFinite(parsed) || parsed < 0) {
              parseErrors.push({ message: `Invalid label RATE value '${val}'`, line: lineNum, column: 1 });
            } else {
              rateHz = parsed;
            }
            break;
          }
          case "EQUIPMENT": {
            equipment = val;
            break;
          }
          default: {
            parseErrors.push({
              message: `Unknown LABEL attribute '${key}'`,
              line: lineNum,
              column: 1,
            });
            break;
          }
        }
        idx += 2;
      }

      labels.push({
        labelOctal,
        labelValue,
        name,
        encoding,
        sdi,
        range,
        resolution,
        units,
        rateHz,
        equipment,
        line: lineNum,
        startOffset: lineStartOffset,
        endOffset: lineStartOffset + rawLine.length,
      });
      continue;
    }

    if (keyword === "FRAME" || keyword === "WORD") {
      let timestampSec = frames.length * 0.05;
      let hexTok: string | undefined;

      if (keyword === "WORD") {
        hexTok = tokens[1];
      } else {
        // FRAME <ts> WORD <hex>  OR  FRAME <hex>
        if (tokens.length >= 4 && (tokens[2] ?? "").toUpperCase() === "WORD") {
          const ts = Number.parseFloat(tokens[1] ?? "");
          if (Number.isFinite(ts)) {
            timestampSec = ts;
          } else {
            parseErrors.push({
              message: `Invalid FRAME timestamp '${tokens[1] ?? ""}'`,
              line: lineNum,
              column: 1,
            });
          }
          hexTok = tokens[3];
        } else if (tokens.length === 2) {
          hexTok = tokens[1];
        } else if (tokens.length === 3 && (tokens[1] ?? "").toUpperCase() === "WORD") {
          hexTok = tokens[2];
        } else {
          parseErrors.push({
            message: `Invalid FRAME syntax: '${body}'`,
            line: lineNum,
            column: 1,
          });
          continue;
        }
      }

      if (!hexTok || !/^0[xX][0-9a-fA-F]{1,8}$/.test(hexTok)) {
        parseErrors.push({
          message: `Invalid 32-bit hex word '${hexTok ?? ""}'`,
          line: lineNum,
          column: 1,
        });
        continue;
      }

      const rawWord = Number.parseInt(hexTok, 16) >>> 0;
      frames.push({
        timestampSec,
        rawWord,
        rawHex: formatArinc429Hex(rawWord),
        comment,
        line: lineNum,
        startOffset: lineStartOffset,
        endOffset: lineStartOffset + rawLine.length,
      });
      continue;
    }

    parseErrors.push({
      message: `Unrecognized directive '${tokens[0] ?? ""}'`,
      line: lineNum,
      column: 1,
    });
  }

  return {
    busName,
    rate,
    rateExplicit,
    labels,
    frames,
    parseErrors,
  };
}
