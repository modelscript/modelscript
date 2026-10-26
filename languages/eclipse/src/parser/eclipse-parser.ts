// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/eclipse — Zero-Regex Schlumberger ECLIPSE Reservoir Deck Parser & Serializer.
 *
 * Implements keyword section parsing for ECLIPSE 100/300 (.DATA, .DAT, .inc).
 */

import type {
  EclipseCompletion,
  EclipseDeck,
  EclipseDimensions,
  EclipseGrid,
  EclipsePhases,
  EclipseProps,
  EclipseRange,
  EclipseSolution,
  EclipseUnitSystem,
  EclipseWell,
} from "../types.js";

interface RawKeywordRecord {
  keyword: string;
  tokens: string[];
  range: EclipseRange;
  hasTerminalSlash: boolean;
}

const SECTION_KEYWORDS = new Set(["RUNSPEC", "GRID", "EDIT", "PROPS", "REGIONS", "SOLUTION", "SUMMARY", "SCHEDULE"]);

const FLAG_KEYWORDS = new Set([
  "OIL",
  "WATER",
  "GAS",
  "DISGAS",
  "VAPOIL",
  "FIELD",
  "METRIC",
  "LAB",
  "END",
  "NOWARNINGS",
  "MESSAGES",
  "ECHO",
  "NOECHO",
  "DIFFUSE",
]);

const TABLE_KEYWORDS = new Set(["WELSPECS", "COMPDAT", "WCONPROD", "WCONINJE", "WCONHIST", "WCONINJH"]);

const KNOWN_DATA_KEYWORDS = new Set([
  "TITLE",
  "DIMENS",
  "START",
  "DX",
  "DY",
  "DZ",
  "TOPS",
  "PORO",
  "PERMX",
  "PERMY",
  "PERMZ",
  "DENSITY",
  "PVTW",
  "PVDO",
  "PVDG",
  "SWOF",
  "SGOF",
  "EQUIL",
  "PRESSURE",
  "SWAT",
  "SOIL",
  "SGAS",
  "WELSPECS",
  "COMPDAT",
  "WCONPROD",
  "WCONINJE",
  "TSTEP",
]);

function expandRepeat(token: string): string[] {
  const starIdx = token.indexOf("*");
  if (starIdx > 0) {
    const countStr = token.slice(0, starIdx);
    const val = token.slice(starIdx + 1);
    const count = parseInt(countStr, 10);
    if (!isNaN(count) && count > 0 && count <= 50000) {
      if (val.length === 0) {
        return Array(count).fill("1*");
      }
      return Array(count).fill(val);
    }
  }
  return [token];
}

function splitWords(line: string): string[] {
  const words: string[] = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "'" || ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && (ch === " " || ch === "\t" || ch === ",")) {
      if (current.length > 0) {
        for (const exp of expandRepeat(current)) words.push(exp);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    for (const exp of expandRepeat(current)) words.push(exp);
  }
  return words;
}

function parseNum(val: string | undefined, defaultVal: number): number {
  if (!val || val === "1*" || val.endsWith("*")) return defaultVal;
  const num = parseFloat(val);
  return isNaN(num) ? defaultVal : num;
}

export function parseEclipse(source: string, filename?: string): EclipseDeck {
  const lines = source.split("\n");
  const records: RawKeywordRecord[] = [];

  let currentKeyword = "";
  let currentTokens: string[] = [];
  let kwStartLine = 1;
  let kwStartOffset = 0;
  let lineOffset = 0;

  for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
    let line = lines[lineNum - 1]!;
    // Strip -- comment
    const commentIdx = line.indexOf("--");
    if (commentIdx !== -1) {
      line = line.slice(0, commentIdx);
    }
    const trimmed = line.trim();

    if (trimmed.length > 0) {
      const tokens = splitWords(trimmed);
      let tIdx = 0;

      while (tIdx < tokens.length) {
        const tok = tokens[tIdx]!;
        const upper = tok.toUpperCase();

        if (currentKeyword === "") {
          if (SECTION_KEYWORDS.has(upper)) {
            records.push({
              keyword: upper,
              tokens: [],
              range: {
                startLine: lineNum,
                startColumn: 1,
                endLine: lineNum,
                endColumn: line.length + 1,
                startOffset: lineOffset,
                endOffset: lineOffset + line.length,
              },
              hasTerminalSlash: false,
            });
            tIdx++;
            continue;
          }

          if (FLAG_KEYWORDS.has(upper)) {
            records.push({
              keyword: upper,
              tokens: [],
              range: {
                startLine: lineNum,
                startColumn: 1,
                endLine: lineNum,
                endColumn: line.length + 1,
                startOffset: lineOffset,
                endOffset: lineOffset + line.length,
              },
              hasTerminalSlash: true,
            });
            tIdx++;
            continue;
          }

          // Starts a data-entry keyword
          currentKeyword = upper;
          kwStartLine = lineNum;
          kwStartOffset = lineOffset;
          currentTokens = [];
          tIdx++;
          continue;
        }

        // We are currently in a keyword (currentKeyword !== "")
        if (tok === "/") {
          if (TABLE_KEYWORDS.has(currentKeyword)) {
            if (currentTokens.length > 0) {
              records.push({
                keyword: currentKeyword,
                tokens: currentTokens,
                range: {
                  startLine: kwStartLine,
                  startColumn: 1,
                  endLine: lineNum,
                  endColumn: line.length + 1,
                  startOffset: kwStartOffset,
                  endOffset: lineOffset + line.length,
                },
                hasTerminalSlash: true,
              });
              currentTokens = [];
            } else {
              // Blank slash ends the table keyword!
              currentKeyword = "";
            }
          } else {
            records.push({
              keyword: currentKeyword,
              tokens: currentTokens,
              range: {
                startLine: kwStartLine,
                startColumn: 1,
                endLine: lineNum,
                endColumn: line.length + 1,
                startOffset: kwStartOffset,
                endOffset: lineOffset + line.length,
              },
              hasTerminalSlash: true,
            });
            currentKeyword = "";
            currentTokens = [];
          }
          tIdx++;
          continue;
        }

        if (tok.endsWith("/")) {
          const val = tok.slice(0, -1);
          if (val.length > 0) currentTokens.push(val);
          records.push({
            keyword: currentKeyword,
            tokens: currentTokens,
            range: {
              startLine: kwStartLine,
              startColumn: 1,
              endLine: lineNum,
              endColumn: line.length + 1,
              startOffset: kwStartOffset,
              endOffset: lineOffset + line.length,
            },
            hasTerminalSlash: true,
          });
          if (TABLE_KEYWORDS.has(currentKeyword)) {
            currentTokens = [];
          } else {
            currentKeyword = "";
            currentTokens = [];
          }
          tIdx++;
          continue;
        }

        // If a new section or keyword starts while previous had no slash
        if (
          (SECTION_KEYWORDS.has(upper) || FLAG_KEYWORDS.has(upper) || KNOWN_DATA_KEYWORDS.has(upper)) &&
          !TABLE_KEYWORDS.has(currentKeyword) &&
          currentKeyword !== "TITLE"
        ) {
          records.push({
            keyword: currentKeyword,
            tokens: currentTokens,
            range: {
              startLine: kwStartLine,
              startColumn: 1,
              endLine: lineNum,
              endColumn: line.length + 1,
              startOffset: kwStartOffset,
              endOffset: lineOffset + line.length,
            },
            hasTerminalSlash: false,
          });
          currentKeyword = "";
          currentTokens = [];
          // Do not increment tIdx so outer loop re-processes this keyword
          continue;
        }

        currentTokens.push(tok);
        tIdx++;
      }
    }

    lineOffset += lines[lineNum - 1]!.length + 1;
  }

  // If a keyword record was left unclosed at EOF
  if (currentKeyword !== "") {
    records.push({
      keyword: currentKeyword,
      tokens: currentTokens,
      range: {
        startLine: kwStartLine,
        startColumn: 1,
        endLine: lines.length,
        endColumn: 1,
        startOffset: kwStartOffset,
        endOffset: lineOffset,
      },
      hasTerminalSlash: false,
    });
  }

  // Build Structured Eclipse Deck
  let title = "ECLIPSE Reservoir Simulation Model";
  const dimensions: EclipseDimensions = { nx: 10, ny: 10, nz: 3 };
  const phases: EclipsePhases = { oil: false, water: false, gas: false };
  let units: EclipseUnitSystem = "FIELD";
  let startDate = "1 'JAN' 2026";

  const grid: EclipseGrid = {
    dx: 100.0,
    dy: 100.0,
    dz: 20.0,
    tops: 5000.0,
    poro: 0.22,
    permX: 150.0,
    permY: 150.0,
    permZ: 15.0,
  };

  const props: EclipseProps = {
    density: { oil: 50.0, water: 62.4, gas: 0.06 },
    pvdo: [],
    pvdg: [],
    swof: [],
    sgof: [],
  };

  const solution: EclipseSolution = {};
  const wells = new Map<string, EclipseWell>();
  const timeSteps: number[] = [];
  const rawKeywords: string[] = [];

  for (const rec of records) {
    const kw = rec.keyword;
    rawKeywords.push(kw);
    const tok = rec.tokens;

    // RUNSPEC
    if (kw === "TITLE" && tok.length > 0) {
      title = tok.join(" ");
    } else if (kw === "DIMENS" && tok.length >= 3) {
      dimensions.nx = parseInt(tok[0] ?? "10", 10);
      dimensions.ny = parseInt(tok[1] ?? "10", 10);
      dimensions.nz = parseInt(tok[2] ?? "3", 10);
    } else if (kw === "OIL") {
      phases.oil = true;
    } else if (kw === "WATER") {
      phases.water = true;
    } else if (kw === "GAS") {
      phases.gas = true;
    } else if (kw === "DISGAS") {
      phases.disgas = true;
    } else if (kw === "VAPOIL") {
      phases.vapoil = true;
    } else if (kw === "FIELD") {
      units = "FIELD";
    } else if (kw === "METRIC") {
      units = "METRIC";
    } else if (kw === "LAB") {
      units = "LAB";
    } else if (kw === "START" && tok.length > 0) {
      startDate = tok.join(" ");
    }

    // GRID
    else if (kw === "DX" && tok.length > 0) {
      grid.dx = parseFloat(tok[0] ?? "100.0");
    } else if (kw === "DY" && tok.length > 0) {
      grid.dy = parseFloat(tok[0] ?? "100.0");
    } else if (kw === "DZ" && tok.length > 0) {
      grid.dz = parseFloat(tok[0] ?? "20.0");
    } else if (kw === "TOPS" && tok.length > 0) {
      grid.tops = parseFloat(tok[0] ?? "5000.0");
    } else if (kw === "PORO" && tok.length > 0) {
      grid.poro = parseFloat(tok[0] ?? "0.22");
    } else if (kw === "PERMX" && tok.length > 0) {
      grid.permX = parseFloat(tok[0] ?? "150.0");
    } else if (kw === "PERMY" && tok.length > 0) {
      grid.permY = parseFloat(tok[0] ?? "150.0");
    } else if (kw === "PERMZ" && tok.length > 0) {
      grid.permZ = parseFloat(tok[0] ?? "15.0");
    }

    // PROPS
    else if (kw === "DENSITY" && tok.length >= 3) {
      props.density = {
        oil: parseFloat(tok[0] ?? "50.0"),
        water: parseFloat(tok[1] ?? "62.4"),
        gas: parseFloat(tok[2] ?? "0.06"),
      };
    } else if (kw === "PVTW" && tok.length >= 5) {
      props.pvtw = {
        pref: parseFloat(tok[0] ?? "4000.0"),
        bw: parseFloat(tok[1] ?? "1.02"),
        cw: parseFloat(tok[2] ?? "3e-6"),
        muw: parseFloat(tok[3] ?? "0.4"),
        cmu: parseFloat(tok[4] ?? "0.0"),
      };
    } else if (kw === "PVDO") {
      for (let i = 0; i + 2 < tok.length; i += 3) {
        props.pvdo.push({
          pressure: parseFloat(tok[i] ?? "0"),
          fvf: parseFloat(tok[i + 1] ?? "1.2"),
          viscosity: parseFloat(tok[i + 2] ?? "1.0"),
        });
      }
    } else if (kw === "PVDG") {
      for (let i = 0; i + 2 < tok.length; i += 3) {
        props.pvdg.push({
          pressure: parseFloat(tok[i] ?? "0"),
          fvf: parseFloat(tok[i + 1] ?? "0.001"),
          viscosity: parseFloat(tok[i + 2] ?? "0.02"),
        });
      }
    } else if (kw === "SWOF") {
      for (let i = 0; i + 3 < tok.length; i += 4) {
        props.swof.push({
          saturation: parseFloat(tok[i] ?? "0.2"),
          krPhase: parseFloat(tok[i + 1] ?? "0.0"),
          krowPhase: parseFloat(tok[i + 2] ?? "1.0"),
          pcPhase: parseFloat(tok[i + 3] ?? "0.0"),
        });
      }
    } else if (kw === "SGOF") {
      for (let i = 0; i + 3 < tok.length; i += 4) {
        props.sgof.push({
          saturation: parseFloat(tok[i] ?? "0.0"),
          krPhase: parseFloat(tok[i + 1] ?? "0.0"),
          krowPhase: parseFloat(tok[i + 2] ?? "1.0"),
          pcPhase: parseFloat(tok[i + 3] ?? "0.0"),
        });
      }
    }

    // SOLUTION
    else if (kw === "EQUIL" && tok.length >= 6) {
      solution.equil = {
        datumDepth: parseFloat(tok[0] ?? "5000.0"),
        datumPressure: parseFloat(tok[1] ?? "4000.0"),
        woc: parseFloat(tok[2] ?? "5500.0"),
        pcWoc: parseFloat(tok[3] ?? "0.0"),
        goc: parseFloat(tok[4] ?? "4500.0"),
        pcGoc: parseFloat(tok[5] ?? "0.0"),
      };
    } else if (kw === "PRESSURE" && tok.length > 0) {
      solution.initialPressure = parseFloat(tok[0] ?? "4000.0");
    } else if (kw === "SWAT" && tok.length > 0) {
      solution.initialSwat = parseFloat(tok[0] ?? "0.25");
    }

    // SCHEDULE - Wells
    else if (kw === "WELSPECS") {
      if (tok.length >= 6) {
        const wName = tok[0] ?? "PROD1";
        wells.set(wName, {
          name: wName,
          group: tok[1] ?? "G1",
          i: parseInt(tok[2] ?? "1", 10),
          j: parseInt(tok[3] ?? "1", 10),
          refDepth: parseFloat(tok[4] ?? "5000.0"),
          preferredPhase: (tok[5]?.toUpperCase() ?? "OIL") as any,
          completions: [],
          range: rec.range,
        });
      }
    } else if (kw === "COMPDAT") {
      if (tok.length >= 5) {
        const wName = tok[0] ?? "PROD1";
        const comp: EclipseCompletion = {
          wellName: wName,
          i: parseInt(tok[1] ?? "1", 10),
          j: parseInt(tok[2] ?? "1", 10),
          k1: parseInt(tok[3] ?? "1", 10),
          k2: parseInt(tok[4] ?? "1", 10),
          status: tok[5]?.toUpperCase() === "SHUT" ? "SHUT" : "OPEN",
          satTable: tok[6] && tok[6] !== "1*" ? parseInt(tok[6], 10) : 1,
          wellIndex: parseNum(tok[7], 50.0),
          diameter: parseNum(tok[8], 0.5),
          range: rec.range,
        };
        const w = wells.get(wName);
        if (w) {
          w.completions.push(comp);
        } else {
          wells.set(wName, {
            name: wName,
            group: "G1",
            i: comp.i,
            j: comp.j,
            refDepth: 5000.0,
            preferredPhase: "OIL",
            completions: [comp],
            range: rec.range,
          });
        }
      }
    } else if (kw === "WCONPROD") {
      if (tok.length >= 8) {
        const wName = tok[0] ?? "PROD1";
        const w = wells.get(wName);
        const prodCtrl = {
          status: (tok[1]?.toUpperCase() === "SHUT" ? "SHUT" : "OPEN") as any,
          controlMode: (tok[2]?.toUpperCase() ?? "ORAT") as any,
          oilRate: parseNum(tok[3], 1000.0),
          waterRate: parseNum(tok[4], 0.0),
          gasRate: parseNum(tok[5], 0.0),
          liquidRate: parseNum(tok[6], 1000.0),
          bhpLimit: parseNum(tok[7], 2000.0),
        };
        if (w) w.productionControl = prodCtrl;
      }
    } else if (kw === "WCONINJE") {
      if (tok.length >= 6) {
        const wName = tok[0] ?? "INJ1";
        const w = wells.get(wName);
        const injCtrl = {
          fluidType: (tok[1]?.toUpperCase() === "GAS" ? "GAS" : "WATER") as any,
          status: (tok[2]?.toUpperCase() === "SHUT" ? "SHUT" : "OPEN") as any,
          controlMode: (tok[3]?.toUpperCase() ?? "RATE") as any,
          rate: parseNum(tok[4], 2000.0),
          bhpLimit: parseNum(tok[5], 5000.0),
        };
        if (w) w.injectionControl = injCtrl;
      }
    } else if (kw === "TSTEP" && tok.length > 0) {
      for (const t of tok) {
        const num = parseFloat(t);
        if (!isNaN(num)) timeSteps.push(num);
      }
    }
  }

  return {
    title,
    dimensions,
    phases,
    units,
    startDate,
    grid,
    props,
    solution,
    wells,
    timeSteps,
    sourceFile: filename,
    rawKeywords,
  };
}

/**
 * Serializes EclipseDeck back to standard ECLIPSE formatted card deck.
 */
export function serializeEclipse(deck: EclipseDeck): string {
  const lines: string[] = [];
  lines.push(`-- ====================================================================`);
  lines.push(`-- ECLIPSE Reservoir Simulation Model`);
  lines.push(`-- Generated by ModelScript`);
  lines.push(`-- ====================================================================`);
  lines.push(`RUNSPEC`);
  lines.push(`TITLE`);
  lines.push(`  ${deck.title}`);
  lines.push(`/`);
  lines.push(``);
  lines.push(`DIMENS`);
  lines.push(`  ${deck.dimensions.nx} ${deck.dimensions.ny} ${deck.dimensions.nz} /`);
  lines.push(``);
  lines.push(`${deck.units}`);
  if (deck.phases.oil) lines.push(`OIL`);
  if (deck.phases.water) lines.push(`WATER`);
  if (deck.phases.gas) lines.push(`GAS`);
  if (deck.phases.disgas) lines.push(`DISGAS`);
  if (deck.phases.vapoil) lines.push(`VAPOIL`);

  lines.push(``);
  lines.push(`START`);
  lines.push(`  ${deck.startDate} /`);

  lines.push(``);
  lines.push(`GRID`);
  lines.push(`DX`);
  lines.push(`  ${deck.grid.dx} /`);
  lines.push(`DY`);
  lines.push(`  ${deck.grid.dy} /`);
  lines.push(`DZ`);
  lines.push(`  ${deck.grid.dz} /`);
  lines.push(`TOPS`);
  lines.push(`  ${deck.grid.tops} /`);
  lines.push(`PORO`);
  lines.push(`  ${deck.grid.poro} /`);
  lines.push(`PERMX`);
  lines.push(`  ${deck.grid.permX} /`);
  lines.push(`PERMY`);
  lines.push(`  ${deck.grid.permY} /`);
  lines.push(`PERMZ`);
  lines.push(`  ${deck.grid.permZ} /`);

  lines.push(``);
  lines.push(`PROPS`);
  lines.push(`DENSITY`);
  lines.push(`  ${deck.props.density.oil} ${deck.props.density.water} ${deck.props.density.gas} /`);
  if (deck.props.pvtw) {
    lines.push(`PVTW`);
    lines.push(
      `  ${deck.props.pvtw.pref} ${deck.props.pvtw.bw} ${deck.props.pvtw.cw} ${deck.props.pvtw.muw} ${deck.props.pvtw.cmu} /`,
    );
  }
  if (deck.props.pvdo.length > 0) {
    lines.push(`PVDO`);
    for (const p of deck.props.pvdo) {
      lines.push(`  ${p.pressure} ${p.fvf} ${p.viscosity}`);
    }
    lines.push(`  /`);
  }
  if (deck.props.swof.length > 0) {
    lines.push(`SWOF`);
    for (const s of deck.props.swof) {
      lines.push(`  ${s.saturation} ${s.krPhase} ${s.krowPhase} ${s.pcPhase}`);
    }
    lines.push(`  /`);
  }

  lines.push(``);
  lines.push(`SOLUTION`);
  if (deck.solution.equil) {
    const eq = deck.solution.equil;
    lines.push(`EQUIL`);
    lines.push(`  ${eq.datumDepth} ${eq.datumPressure} ${eq.woc} ${eq.pcWoc} ${eq.goc} ${eq.pcGoc} /`);
  }

  lines.push(``);
  lines.push(`SCHEDULE`);
  lines.push(`WELSPECS`);
  for (const w of deck.wells.values()) {
    lines.push(`  '${w.name}' '${w.group}' ${w.i} ${w.j} ${w.refDepth} '${w.preferredPhase}' /`);
  }
  lines.push(`/`);

  lines.push(`COMPDAT`);
  for (const w of deck.wells.values()) {
    for (const c of w.completions) {
      lines.push(
        `  '${c.wellName}' ${c.i} ${c.j} ${c.k1} ${c.k2} '${c.status}' ${c.satTable} ${c.wellIndex} ${c.diameter} /`,
      );
    }
  }
  lines.push(`/`);

  const producers = Array.from(deck.wells.values()).filter((w) => w.productionControl);
  if (producers.length > 0) {
    lines.push(`WCONPROD`);
    for (const w of producers) {
      const pc = w.productionControl!;
      lines.push(
        `  '${w.name}' '${pc.status}' '${pc.controlMode}' ${pc.oilRate} ${pc.waterRate} ${pc.gasRate} ${pc.liquidRate} ${pc.bhpLimit} /`,
      );
    }
    lines.push(`/`);
  }

  const injectors = Array.from(deck.wells.values()).filter((w) => w.injectionControl);
  if (injectors.length > 0) {
    lines.push(`WCONINJE`);
    for (const w of injectors) {
      const ic = w.injectionControl!;
      lines.push(`  '${w.name}' '${ic.fluidType}' '${ic.status}' '${ic.controlMode}' ${ic.rate} ${ic.bhpLimit} /`);
    }
    lines.push(`/`);
  }

  if (deck.timeSteps.length > 0) {
    lines.push(`TSTEP`);
    lines.push(`  ${deck.timeSteps.join(" ")} /`);
  }

  lines.push(`END`);
  return lines.join("\n");
}
