// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  ToughConnection,
  ToughDeck,
  ToughElement,
  ToughGenerator,
  ToughIncon,
  ToughRock,
} from "../types.js";

export function parseTough(text: string): ToughDeck {
  const lines = text.split(/\r?\n/);
  const rocks: ToughRock[] = [];
  const elements: ToughElement[] = [];
  const connections: ToughConnection[] = [];
  const generators: ToughGenerator[] = [];
  const inconds: ToughIncon[] = [];

  let title: string | undefined;
  let activeBlock = "";

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("+++") || trimmed.startsWith("#")) continue;

    // Check for block headers
    const upper = trimmed.toUpperCase();
    if (
      [
        "ROCKS",
        "ELEME",
        "CONNE",
        "GENER",
        "INCON",
        "PARAM",
        "START",
        "ENDCY",
        "FOFT",
        "COFT",
      ].includes(upper)
    ) {
      activeBlock = upper;
      continue;
    }

    if (!activeBlock && !title) {
      title = trimmed;
      continue;
    }

    if (activeBlock === "ENDCY") {
      break;
    }

    // 1. ROCKS
    if (activeBlock === "ROCKS") {
      const parts = trimmed.split(/[\s,]+/).filter(Boolean);
      if (parts.length >= 2) {
        const name = parts[0]!;
        const density = parseFloat(parts[1] || "2600.0");
        const porosity = parseFloat(parts[2] || "0.1");
        const kx = parseFloat(parts[3] || "1e-14");
        const ky = parseFloat(parts[4] || String(kx));
        const kz = parseFloat(parts[5] || String(kx));
        const cond = parseFloat(parts[6] || "2.5");
        const cp = parseFloat(parts[7] || "1000.0");

        rocks.push({
          name,
          density,
          porosity,
          permeabilityX: kx,
          permeabilityY: ky,
          permeabilityZ: kz,
          thermalConductivity: cond,
          specificHeat: cp,
          line: i + 1,
        });
      }
      continue;
    }

    // 2. ELEME
    if (activeBlock === "ELEME") {
      let name = "";
      let rockName = "";
      let volume = 1000.0;

      // Try finding any known rock name in the line
      let matchedRock: ToughRock | undefined;
      let rockIdx = -1;
      for (const r of rocks) {
        const idx = rawLine.toUpperCase().indexOf(r.name.toUpperCase());
        if (idx > 0) {
          matchedRock = r;
          rockIdx = idx;
          break;
        }
      }

      if (matchedRock && rockIdx > 0) {
        name = rawLine.substring(0, rockIdx).trim();
        rockName = matchedRock.name;
        const rest = rawLine.substring(rockIdx + matchedRock.name.length).trim().split(/[\s,]+/)[0];
        volume = parseFloat(rest || "1000.0") || 1000.0;
      } else {
        const parts = trimmed.split(/[\s,]+/).filter(Boolean);
        name = parts[0]!;
        rockName = parts[1] || "DEFAULT";
        volume = parseFloat(parts[2] || "1000.0") || 1000.0;
      }

      elements.push({
        name,
        rockName,
        volume,
        line: i + 1,
      });
      continue;
    }

    // 3. CONNE
    if (activeBlock === "CONNE") {
      let elem1 = "";
      let elem2 = "";
      let d1 = 50.0;
      let d2 = 50.0;
      let area = 1000.0;
      let angle = 0.0;

      // Check if line starts with two known elements
      let foundPair = false;
      for (const e1 of elements) {
        if (rawLine.startsWith(e1.name) || rawLine.trim().startsWith(e1.name)) {
          const startAfter1 = rawLine.indexOf(e1.name) + e1.name.length;
          const after1 = rawLine.substring(startAfter1);
          for (const e2 of elements) {
            const idx2 = after1.indexOf(e2.name);
            if (idx2 >= 0 && idx2 < 5) {
              elem1 = e1.name;
              elem2 = e2.name;
              const restNums = after1.substring(idx2 + e2.name.length).trim().split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));
              d1 = restNums[0] ?? 50.0;
              d2 = restNums[1] ?? 50.0;
              area = restNums[2] ?? 1000.0;
              angle = restNums[3] ?? 0.0;
              foundPair = true;
              break;
            }
          }
          if (foundPair) break;
        }
      }

      if (!foundPair) {
        const parts = trimmed.split(/[\s,]+/).filter(Boolean);
        elem1 = parts[0]!;
        elem2 = parts[1]!;
        d1 = parseFloat(parts[2] || "50.0");
        d2 = parseFloat(parts[3] || "50.0");
        area = parseFloat(parts[4] || "1000.0");
        angle = parts.length > 5 ? parseFloat(parts[5]!) : 0.0;
      }

      connections.push({
        elem1,
        elem2,
        dist1: d1,
        dist2: d2,
        area,
        angle,
        line: i + 1,
      });
      continue;
    }

    // 4. GENER
    if (activeBlock === "GENER") {
      let elem = "";
      let name = "";
      let type = "MASS";
      let rate = 0.0;
      let enthalpy = 0.0;

      // Check for known element prefix
      let matchedElem: ToughElement | undefined;
      for (const el of elements) {
        if (rawLine.startsWith(el.name) || rawLine.trim().startsWith(el.name)) {
          matchedElem = el;
          break;
        }
      }

      if (matchedElem && (rawLine.includes("MASS") || rawLine.includes("HEAT") || rawLine.includes("DELV"))) {
        elem = matchedElem.name;
        const afterElem = rawLine.substring(rawLine.indexOf(matchedElem.name) + matchedElem.name.length);
        const typeMatch = /(MASS|HEAT|DELV)/i.exec(afterElem);
        if (typeMatch) {
          name = afterElem.substring(0, typeMatch.index).trim();
          type = typeMatch[1]!.toUpperCase();
          const restNums = afterElem.substring(typeMatch.index + 4).trim().split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));
          rate = restNums[0] ?? 0.0;
          enthalpy = restNums[1] ?? 0.0;
        }
      } else {
        const parts = trimmed.split(/[\s,]+/).filter(Boolean);
        elem = parts[0]!;
        name = parts[1]!;
        type = parts[2]!.toUpperCase();
        rate = parseFloat(parts[3] || "0.0");
        enthalpy = parts.length > 4 ? parseFloat(parts[4]!) : 0.0;
      }

      generators.push({
        elem,
        name,
        type,
        rate,
        enthalpy,
        line: i + 1,
      });
      continue;
    }

    // 5. INCON
    if (activeBlock === "INCON") {
      let elem = "";
      let p = 1.0e7;
      let t = 200.0;

      let matchedElem: ToughElement | undefined;
      for (const el of elements) {
        if (rawLine.startsWith(el.name) || rawLine.trim().startsWith(el.name)) {
          matchedElem = el;
          break;
        }
      }

      if (matchedElem) {
        elem = matchedElem.name;
        const afterElem = rawLine.substring(rawLine.indexOf(matchedElem.name) + matchedElem.name.length);
        const restNums = afterElem.trim().split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));
        p = restNums[0] ?? 1.0e7;
        t = restNums[1] ?? 200.0;
      } else {
        const parts = trimmed.split(/[\s,]+/).filter(Boolean);
        elem = parts[0]!;
        p = parseFloat(parts[1] || "1.0E+07");
        t = parseFloat(parts[2] || "200.0");
      }

      inconds.push({
        elem,
        pressure: p,
        temperature: t,
        line: i + 1,
      });
      continue;
    }
  }

  return {
    title,
    rocks,
    elements,
    connections,
    generators,
    inconds,
  };
}
