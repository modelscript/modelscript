// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IbisComponent, IbisDeck, IbisModel, IbisModelType, IbisWaveform, TableRow, Triplet } from "../types.js";

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

/**
 * Parse an engineering number string with optional SI unit suffixes (e.g. 5.0pF, 1.2nH, 0.5V, 50ohm).
 */
export function parseEngineeringNumber(raw: string): number {
  const text = raw.trim();
  if (text.toUpperCase() === "NA" || text === "") {
    return 0;
  }

  // Scan digits, sign, decimal, and exponent
  let i = 0;
  const n = text.length;
  while (i < n && isWhitespace(text[i]!)) i++;

  let numPart = "";
  if (i < n && (text[i] === "+" || text[i] === "-")) {
    numPart += text[i]!;
    i++;
  }
  while (i < n && ((text[i]! >= "0" && text[i]! <= "9") || text[i] === ".")) {
    numPart += text[i]!;
    i++;
  }
  if (i < n && (text[i] === "e" || text[i] === "E")) {
    numPart += text[i]!;
    i++;
    if (i < n && (text[i] === "+" || text[i] === "-")) {
      numPart += text[i]!;
      i++;
    }
    while (i < n && text[i]! >= "0" && text[i]! <= "9") {
      numPart += text[i]!;
      i++;
    }
  }

  const baseVal = parseFloat(numPart);
  if (isNaN(baseVal)) return 0;

  // Remainder is SI suffix / units
  const suffix = text.slice(i).trim().toLowerCase();
  if (suffix.startsWith("f")) return baseVal * 1e-15; // femto
  if (suffix.startsWith("p")) return baseVal * 1e-12; // pico
  if (suffix.startsWith("n")) return baseVal * 1e-9; // nano
  if (suffix.startsWith("u")) return baseVal * 1e-6; // micro
  if (suffix.startsWith("m") && !suffix.startsWith("meg")) return baseVal * 1e-3; // milli
  if (suffix.startsWith("k")) return baseVal * 1e3; // kilo
  if (suffix.startsWith("meg")) return baseVal * 1e6; // mega
  if (suffix.startsWith("g")) return baseVal * 1e9; // giga

  return baseVal;
}

/**
 * Parse a 3-value triplet line: typ min max
 */
export function parseTriplet(tokens: string[]): Triplet {
  const typ = tokens.length > 0 ? parseEngineeringNumber(tokens[0]!) : 0;
  const min = tokens.length > 1 ? parseEngineeringNumber(tokens[1]!) : typ;
  const max = tokens.length > 2 ? parseEngineeringNumber(tokens[2]!) : typ;
  return { typ, min, max };
}

/**
 * Split a string into whitespace-separated tokens without regex.
 */
export function splitWords(s: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && isWhitespace(s[i]!)) i++;
    if (i >= n) break;
    let tok = "";
    while (i < n && !isWhitespace(s[i]!)) {
      tok += s[i]!;
      i++;
    }
    if (tok.length > 0) tokens.push(tok);
  }
  return tokens;
}

/**
 * Zero-regex parser for ANSI/EIA-656-B IBIS files.
 */
export function parseIbis(content: string, filename?: string): IbisDeck {
  const comments: string[] = [];
  const components = new Map<string, IbisComponent>();
  const models = new Map<string, IbisModel>();

  let ibisVer = "3.2";
  let fileName = filename;
  let fileRev: string | undefined;
  let date: string | undefined;
  let source: string | undefined;

  let currentComponent: IbisComponent | null = null;
  let currentModel: IbisModel | null = null;
  let currentSection = "";
  let currentWaveform: IbisWaveform | null = null;

  // Split lines manually
  const lines: string[] = [];
  let lineStart = 0;
  const len = content.length;
  for (let i = 0; i < len; i++) {
    if (content[i] === "\n") {
      lines.push(content.slice(lineStart, i));
      lineStart = i + 1;
    } else if (content[i] === "\r") {
      lines.push(content.slice(lineStart, i));
      if (i + 1 < len && content[i + 1] === "\n") i++;
      lineStart = i + 1;
    }
  }
  if (lineStart < len) {
    lines.push(content.slice(lineStart));
  }

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    let lineText = lines[lineNum]!;

    // Strip comments starting with '|'
    const barIdx = lineText.indexOf("|");
    if (barIdx !== -1) {
      const commentPart = lineText.slice(barIdx + 1).trim();
      if (commentPart.length > 0) comments.push(commentPart);
      lineText = lineText.slice(0, barIdx);
    }

    lineText = lineText.trim();
    if (lineText.length === 0) continue;

    // Check for section headers: [Keyword]
    if (lineText.startsWith("[")) {
      const closeIdx = lineText.indexOf("]");
      if (closeIdx !== -1) {
        const kw = lineText.slice(1, closeIdx).trim().toUpperCase();
        const remainder = lineText.slice(closeIdx + 1).trim();

        currentSection = kw;

        if (kw === "IBIS VER") {
          ibisVer = remainder || "3.2";
        } else if (kw === "FILE NAME") {
          fileName = remainder || fileName;
        } else if (kw === "FILE REV") {
          fileRev = remainder;
        } else if (kw === "DATE") {
          date = remainder;
        } else if (kw === "SOURCE") {
          source = remainder;
        } else if (kw === "COMPONENT") {
          const compName = remainder || "Component1";
          const newComp: IbisComponent = {
            name: compName,
            package: {
              rPkg: { typ: 0.1, min: 0.05, max: 0.2 },
              lPkg: { typ: 2.5e-9, min: 1.0e-9, max: 4.0e-9 },
              cPkg: { typ: 1.0e-12, min: 0.5e-12, max: 2.0e-12 },
            },
            pins: new Map(),
            line: lineNum + 1,
          };
          components.set(compName, newComp);
          currentComponent = newComp;
        } else if (kw === "MODEL") {
          const modName = remainder || "Model1";
          const newMod: IbisModel = {
            name: modName,
            modelType: "I/O",
            cComp: { typ: 2.0e-12, min: 1.5e-12, max: 3.0e-12 },
            voltageRange: { typ: 3.3, min: 3.0, max: 3.6 },
            line: lineNum + 1,
          };
          models.set(modName, newMod);
          currentModel = newMod;
        } else if (kw === "VOLTAGE RANGE") {
          if (remainder.length > 0 && currentModel) {
            currentModel.voltageRange = parseTriplet(splitWords(remainder));
          }
        } else if (kw === "TEMPERATURE RANGE") {
          if (remainder.length > 0 && currentModel) {
            currentModel.temperatureRange = parseTriplet(splitWords(remainder));
          }
        } else if (kw === "RISING WAVEFORM" || kw === "FALLING WAVEFORM") {
          const wfType = kw === "RISING WAVEFORM" ? "rising" : "falling";
          currentWaveform = {
            type: wfType,
            rFixture: 50,
            vFixture: 0,
            rows: [],
          };
          if (currentModel) {
            if (wfType === "rising") {
              currentModel.risingWaveforms = currentModel.risingWaveforms ?? [];
              currentModel.risingWaveforms.push(currentWaveform);
            } else {
              currentModel.fallingWaveforms = currentModel.fallingWaveforms ?? [];
              currentModel.fallingWaveforms.push(currentWaveform);
            }
          }
        }
        continue;
      }
    }

    const tokens = splitWords(lineText);
    if (tokens.length === 0) continue;

    // Handle sections
    if (currentSection === "MANUFACTURER") {
      if (currentComponent) currentComponent.manufacturer = lineText;
    } else if (currentSection === "PACKAGE") {
      if (currentComponent && tokens.length >= 2) {
        const pName = tokens[0]!.toLowerCase();
        const trip = parseTriplet(tokens.slice(1));
        if (pName.startsWith("r_pkg")) currentComponent.package.rPkg = trip;
        else if (pName.startsWith("l_pkg")) currentComponent.package.lPkg = trip;
        else if (pName.startsWith("c_pkg")) currentComponent.package.cPkg = trip;
      }
    } else if (currentSection === "PIN") {
      // Pin table row: pin_name signal_name model_name [R_pin L_pin C_pin]
      if (currentComponent && tokens.length >= 3) {
        const pinName = tokens[0]!;
        const signalName = tokens[1]!;
        const modelName = tokens[2]!;
        const rPin = tokens.length > 3 ? parseEngineeringNumber(tokens[3]!) : undefined;
        const lPin = tokens.length > 4 ? parseEngineeringNumber(tokens[4]!) : undefined;
        const cPin = tokens.length > 5 ? parseEngineeringNumber(tokens[5]!) : undefined;

        currentComponent.pins.set(pinName, {
          pinName,
          signalName,
          modelName,
          rPin,
          lPin,
          cPin,
          line: lineNum + 1,
        });
      }
    } else if (currentSection === "MODEL") {
      if (currentModel) {
        const firstTok = tokens[0]!.toLowerCase();
        if (firstTok === "model_type") {
          currentModel.modelType = (tokens[1] ?? "I/O") as IbisModelType;
        } else if (firstTok === "polarity") {
          currentModel.polarity = tokens[1] as "Non-Inverting" | "Inverting";
        } else if (firstTok === "enable") {
          currentModel.enable = tokens[1] as "Active-High" | "Active-Low";
        } else if (firstTok === "vinl") {
          currentModel.vinl = parseEngineeringNumber(tokens[tokens.length - 1]!);
        } else if (firstTok === "vinh") {
          currentModel.vinh = parseEngineeringNumber(tokens[tokens.length - 1]!);
        } else if (firstTok === "c_comp") {
          currentModel.cComp = parseTriplet(tokens.slice(1));
        }
      }
    } else if (currentSection === "VOLTAGE RANGE") {
      if (currentModel) {
        currentModel.voltageRange = parseTriplet(tokens);
      }
    } else if (currentSection === "TEMPERATURE RANGE") {
      if (currentModel) {
        currentModel.temperatureRange = parseTriplet(tokens);
      }
    } else if (
      currentSection === "PULLUP" ||
      currentSection === "PULLDOWN" ||
      currentSection === "GND CLAMP" ||
      currentSection === "POWER CLAMP"
    ) {
      if (currentModel && tokens.length >= 2) {
        const v = parseEngineeringNumber(tokens[0]!);
        const typ = parseEngineeringNumber(tokens[1]!);
        const min = tokens.length > 2 ? parseEngineeringNumber(tokens[2]!) : typ;
        const max = tokens.length > 3 ? parseEngineeringNumber(tokens[3]!) : typ;
        const row: TableRow = { vOrT: v, typ, min, max };

        if (currentSection === "PULLUP") {
          currentModel.pullup = currentModel.pullup ?? [];
          currentModel.pullup.push(row);
        } else if (currentSection === "PULLDOWN") {
          currentModel.pulldown = currentModel.pulldown ?? [];
          currentModel.pulldown.push(row);
        } else if (currentSection === "GND CLAMP") {
          currentModel.gndClamp = currentModel.gndClamp ?? [];
          currentModel.gndClamp.push(row);
        } else if (currentSection === "POWER CLAMP") {
          currentModel.powerClamp = currentModel.powerClamp ?? [];
          currentModel.powerClamp.push(row);
        }
      }
    } else if (currentSection === "RAMP") {
      if (currentModel && tokens.length >= 2) {
        const key = tokens[0]!.toLowerCase();
        currentModel.ramp = currentModel.ramp ?? {
          dvDtRising: { typ: 1e9, min: 0.8e9, max: 1.2e9 },
          dvDtFalling: { typ: 1e9, min: 0.8e9, max: 1.2e9 },
        };
        const trip = parseTriplet(tokens.slice(1));
        if (key.startsWith("dv/dt_r")) currentModel.ramp.dvDtRising = trip;
        else if (key.startsWith("dv/dt_f")) currentModel.ramp.dvDtFalling = trip;
        else if (key.startsWith("r_load")) currentModel.ramp.rLoad = parseEngineeringNumber(tokens[1]!);
      }
    } else if (currentSection === "RISING WAVEFORM" || currentSection === "FALLING WAVEFORM") {
      if (currentWaveform) {
        const first = tokens[0]!.toLowerCase();
        if (first.startsWith("r_fixture")) {
          currentWaveform.rFixture = parseEngineeringNumber(tokens[tokens.length - 1]!);
        } else if (first.startsWith("v_fixture")) {
          currentWaveform.vFixture = parseEngineeringNumber(tokens[tokens.length - 1]!);
        } else if (tokens.length >= 2) {
          const t = parseEngineeringNumber(tokens[0]!);
          const vTyp = parseEngineeringNumber(tokens[1]!);
          const vMin = tokens.length > 2 ? parseEngineeringNumber(tokens[2]!) : vTyp;
          const vMax = tokens.length > 3 ? parseEngineeringNumber(tokens[3]!) : vTyp;
          currentWaveform.rows.push({ vOrT: t, typ: vTyp, min: vMin, max: vMax });
        }
      }
    }
  }

  return {
    ibisVer,
    fileName,
    fileRev,
    date,
    source,
    components,
    models,
    comments,
    sourceFile: filename,
  };
}

/**
 * Serialize an IBIS deck AST back into ANSI/EIA-656-B file format.
 */
export function serializeIbis(deck: IbisDeck): string {
  const lines: string[] = [];

  lines.push(`[IBIS Ver] ${deck.ibisVer}`);
  lines.push(`[File Name] ${deck.fileName ?? "model.ibs"}`);
  if (deck.fileRev) lines.push(`[File Rev] ${deck.fileRev}`);
  if (deck.date) lines.push(`[Date] ${deck.date}`);
  lines.push(`| ModelScript IBIS Serializer`);

  for (const [, comp] of deck.components) {
    lines.push(``);
    lines.push(`[Component] ${comp.name}`);
    if (comp.manufacturer) lines.push(`[Manufacturer] ${comp.manufacturer}`);
    lines.push(`[Package]`);
    lines.push(`| variable   typ          min          max`);
    lines.push(`R_pkg        ${comp.package.rPkg.typ}        ${comp.package.rPkg.min}        ${comp.package.rPkg.max}`);
    lines.push(`L_pkg        ${comp.package.lPkg.typ}        ${comp.package.lPkg.min}        ${comp.package.lPkg.max}`);
    lines.push(`C_pkg        ${comp.package.cPkg.typ}        ${comp.package.cPkg.min}        ${comp.package.cPkg.max}`);

    lines.push(`[Pin] signal_name model_name R_pin L_pin C_pin`);
    for (const [, pin] of comp.pins) {
      lines.push(`${pin.pinName} ${pin.signalName} ${pin.modelName}`);
    }
  }

  for (const [, mod] of deck.models) {
    lines.push(``);
    lines.push(`[Model] ${mod.name}`);
    lines.push(`Model_type ${mod.modelType}`);
    lines.push(`C_comp ${mod.cComp.typ} ${mod.cComp.min} ${mod.cComp.max}`);
    lines.push(`[Voltage Range] ${mod.voltageRange.typ} ${mod.voltageRange.min} ${mod.voltageRange.max}`);

    if (mod.pulldown && mod.pulldown.length > 0) {
      lines.push(`[Pulldown]`);
      lines.push(`| Voltage   I(typ)       I(min)       I(max)`);
      for (const r of mod.pulldown) {
        lines.push(
          `${r.vOrT.toFixed(3)} ${r.typ.toExponential(4)} ${r.min.toExponential(4)} ${r.max.toExponential(4)}`,
        );
      }
    }

    if (mod.pullup && mod.pullup.length > 0) {
      lines.push(`[Pullup]`);
      lines.push(`| Voltage   I(typ)       I(min)       I(max)`);
      for (const r of mod.pullup) {
        lines.push(
          `${r.vOrT.toFixed(3)} ${r.typ.toExponential(4)} ${r.min.toExponential(4)} ${r.max.toExponential(4)}`,
        );
      }
    }

    if (mod.ramp) {
      lines.push(`[Ramp]`);
      lines.push(`dV/dt_r ${mod.ramp.dvDtRising.typ} ${mod.ramp.dvDtRising.min} ${mod.ramp.dvDtRising.max}`);
      lines.push(`dV/dt_f ${mod.ramp.dvDtFalling.typ} ${mod.ramp.dvDtFalling.min} ${mod.ramp.dvDtFalling.max}`);
    }
  }

  lines.push(`[End]`);
  return lines.join("\n") + "\n";
}
