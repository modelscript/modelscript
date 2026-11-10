// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ASPEN OneLiner / CAPE Short-Circuit (.dxt / .olx) Data Exchange Parser.
 */

import type {
  OneLinerBranch,
  OneLinerBus,
  OneLinerCase,
  OneLinerDistanceRelay,
  OneLinerGenerator,
  OneLinerMutual,
  OneLinerOvercurrentRelay,
  TocCurveFamily,
} from "../types.js";

type SectionType = "NONE" | "CASE" | "BUS" | "LINE" | "MUTUAL" | "GENERATOR" | "RELAY_OVERCURRENT" | "RELAY_DISTANCE";

function stripQuotes(str: string): string {
  return str
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

export function parseOneLiner(content: string): OneLinerCase {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    return parseOneLinerJson(trimmed);
  }
  return parseOneLinerDxt(trimmed);
}

export function parseOneLinerDxt(text: string): OneLinerCase {
  const lines = text.split(/\r?\n/);

  let title = "OneLiner_Case";
  let baseMva = 100.0;
  let frequencyHz = 60.0;

  const busses: OneLinerBus[] = [];
  const branches: OneLinerBranch[] = [];
  const mutuals: OneLinerMutual[] = [];
  const generators: OneLinerGenerator[] = [];
  const overcurrentRelays: OneLinerOvercurrentRelay[] = [];
  const distanceRelays: OneLinerDistanceRelay[] = [];

  let currentSection: SectionType = "NONE";

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (raw.length === 0 || raw.startsWith("//") || raw.startsWith(";") || raw.startsWith("#")) {
      continue;
    }

    // Section headers
    if (raw.startsWith("[") && raw.endsWith("]")) {
      const secName = raw.slice(1, -1).trim().toUpperCase();
      if (secName.includes("CASE")) currentSection = "CASE";
      else if (secName.includes("BUS")) currentSection = "BUS";
      else if (secName.includes("LINE") || secName.includes("BRANCH")) currentSection = "LINE";
      else if (secName.includes("MUTUAL")) currentSection = "MUTUAL";
      else if (secName.includes("GEN")) currentSection = "GENERATOR";
      else if (secName.includes("OVERCURRENT") || secName.includes("OC")) currentSection = "RELAY_OVERCURRENT";
      else if (secName.includes("DISTANCE") || secName.includes("DIST")) currentSection = "RELAY_DISTANCE";
      else currentSection = "NONE";
      continue;
    }

    // Comma or whitespace separated tokens
    const tokens = raw.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map((t) => stripQuotes(t));

    switch (currentSection) {
      case "CASE": {
        // e.g. BASE_MVA=100.0, FREQ=60.0, TITLE="Sample Transmission Substation"
        for (const tok of tokens) {
          const [key, val] = tok.split("=").map((p) => p.trim());
          if (key && val) {
            const k = key.toUpperCase();
            if (k.includes("MVA")) baseMva = parseFloat(val) || baseMva;
            else if (k.includes("FREQ")) frequencyHz = parseFloat(val) || frequencyHz;
            else if (k.includes("TITLE")) title = stripQuotes(val);
          }
        }
        break;
      }

      case "BUS": {
        // BUS_ID, BUS_NAME, BASE_KV, AREA, ZONE
        if (tokens.length >= 3) {
          const id = tokens[0]!;
          const name = tokens[1]!;
          const baseKv = parseFloat(tokens[2]!) || 115.0;
          const area = tokens.length > 3 ? parseInt(tokens[3]!, 10) : undefined;
          const zone = tokens.length > 4 ? parseInt(tokens[4]!, 10) : undefined;
          busses.push({ id, name, baseKv, area, zone });
        }
        break;
      }

      case "LINE": {
        // LINE_ID, BUS1, BUS2, CKT, R1, X1, R0, X0, B1, B0, RATING, LENGTH
        if (tokens.length >= 8) {
          const id = tokens[0]!;
          const bus1 = tokens[1]!;
          const bus2 = tokens[2]!;
          const circuitId = tokens[3]!;
          const r1 = parseFloat(tokens[4]!) || 0.0;
          const x1 = parseFloat(tokens[5]!) || 0.0;
          const r0 = parseFloat(tokens[6]!) || 0.0;
          const x0 = parseFloat(tokens[7]!) || 0.0;
          const b1 = tokens.length > 8 ? parseFloat(tokens[8]!) : undefined;
          const b0 = tokens.length > 9 ? parseFloat(tokens[9]!) : undefined;
          const ratingMva = tokens.length > 10 ? parseFloat(tokens[10]!) : undefined;
          const lengthMiles = tokens.length > 11 ? parseFloat(tokens[11]!) : undefined;

          branches.push({
            id,
            bus1,
            bus2,
            circuitId,
            z1: { r: r1, x: x1 },
            z0: { r: r0, x: x0 },
            b1,
            b0,
            ratingMva,
            lengthMiles,
          });
        }
        break;
      }

      case "MUTUAL": {
        // LINE1, LINE2, R0M, X0M
        if (tokens.length >= 4) {
          const b1 = tokens[0]!;
          const b2 = tokens[1]!;
          const r0m = parseFloat(tokens[2]!) || 0.0;
          const x0m = parseFloat(tokens[3]!) || 0.0;
          mutuals.push({ branch1Id: b1, branch2Id: b2, z0m: { r: r0m, x: x0m } });
        }
        break;
      }

      case "GENERATOR": {
        // GEN_ID, BUS_ID, MVA, R1_SUB, X1_SUB, R0, X0
        if (tokens.length >= 7) {
          const id = tokens[0]!;
          const busId = tokens[1]!;
          const mva = parseFloat(tokens[2]!) || 100.0;
          const r1 = parseFloat(tokens[3]!) || 0.0;
          const x1 = parseFloat(tokens[4]!) || 0.2;
          const r0 = parseFloat(tokens[5]!) || 0.0;
          const x0 = parseFloat(tokens[6]!) || 0.1;

          generators.push({
            id,
            busId,
            mvaRating: mva,
            z1Subtransient: { r: r1, x: x1 },
            z0: { r: r0, x: x0 },
          });
        }
        break;
      }

      case "RELAY_OVERCURRENT": {
        // RELAY_ID, NAME, BRANCH, BUS, PICKUP, CT_RATIO, TD, CURVE, INST
        if (tokens.length >= 8) {
          const id = tokens[0]!;
          const name = tokens[1]!;
          const branchId = tokens[2]!;
          const busId = tokens[3]!;
          const pickupA = parseFloat(tokens[4]!) || 100.0;
          const ctRatio = parseFloat(tokens[5]!) || 1.0;
          const timeDial = parseFloat(tokens[6]!) || 1.0;
          const curve = (tokens[7]! as TocCurveFamily) || "IEEE_Very_Inverse";
          const inst = tokens.length > 8 ? parseFloat(tokens[8]!) : undefined;

          overcurrentRelays.push({
            id,
            name,
            branchId,
            busId,
            pickupA,
            ctRatio,
            timeDial,
            curve,
            instantaneousPickupA: inst,
          });
        }
        break;
      }

      case "RELAY_DISTANCE": {
        // RELAY_ID, NAME, BRANCH, BUS, Z1_REACH, Z2_REACH, Z2_DELAY, Z3_REACH, Z3_DELAY
        if (tokens.length >= 7) {
          const id = tokens[0]!;
          const name = tokens[1]!;
          const branchId = tokens[2]!;
          const busId = tokens[3]!;
          const z1 = parseFloat(tokens[4]!) || 5.0;
          const z2 = parseFloat(tokens[5]!) || 8.0;
          const t2 = parseFloat(tokens[6]!) || 0.35;
          const z3 = tokens.length > 7 ? parseFloat(tokens[7]!) : undefined;
          const t3 = tokens.length > 8 ? parseFloat(tokens[8]!) : undefined;

          distanceRelays.push({
            id,
            name,
            branchId,
            busId,
            zone1ReachOhms: z1,
            zone2ReachOhms: z2,
            zone2DelaySec: t2,
            zone3ReachOhms: z3,
            zone3DelaySec: t3,
          });
        }
        break;
      }

      default:
        break;
    }
  }

  return {
    title,
    baseMva,
    frequencyHz,
    busses,
    branches,
    mutuals,
    generators,
    overcurrentRelays,
    distanceRelays,
  };
}

export function parseOneLinerJson(jsonText: string): OneLinerCase {
  const data = JSON.parse(jsonText);
  return {
    title: data.title || "OneLiner_Case",
    baseMva: data.baseMva || 100.0,
    frequencyHz: data.frequencyHz || 60.0,
    busses: data.busses || [],
    branches: data.branches || [],
    mutuals: data.mutuals || [],
    generators: data.generators || [],
    overcurrentRelays: data.overcurrentRelays || [],
    distanceRelays: data.distanceRelays || [],
  };
}
