// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Alternative Transients Program (ATP-EMTP) Rule-Based Deck Parser.
 *
 * Ingests fixed-column and free-format card decks (.atp / .dat) describing
 * high-voltage electrical networks, transformers, transmission lines, and switches.
 */

import type { AtpBranch, AtpCase, AtpSimulationControl, AtpSource, AtpSwitch } from "../types.js";

type ParserSection = "HEADER" | "CONTROL" | "BRANCH" | "SWITCH" | "SOURCE" | "OUTPUT" | "UNKNOWN";

export function parseAtp(content: string): AtpCase {
  const lines = content.split(/\r?\n/);

  let title = "ATP_Simulation_Case";
  const control: AtpSimulationControl = {
    deltaTSec: 1e-5,
    tMaxSec: 0.1,
  };

  const branches: AtpBranch[] = [];
  const switches: AtpSwitch[] = [];
  const sources: AtpSource[] = [];
  const outputNodes: string[] = [];

  let currentSection: ParserSection = "HEADER";
  let controlParsed = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) {
      continue;
    }

    // Comment lines in ATP: starting with 'C', 'c', '*', '$'
    if (
      trimmed.startsWith("C ") ||
      trimmed.startsWith("c ") ||
      trimmed.startsWith("C\t") ||
      trimmed.startsWith("c\t") ||
      trimmed.startsWith("*")
    ) {
      if ((currentSection === "HEADER" || currentSection === "CONTROL") && title === "ATP_Simulation_Case") {
        title = trimmed.replace(/^[Cc*]\s*/, "").trim() || title;
      }
      continue;
    }

    // Section headers
    const upper = trimmed.toUpperCase();
    if (upper === "BEGIN NEW DATA CASE") {
      currentSection = "CONTROL";
      continue;
    }
    if (upper.startsWith("/BRANCH")) {
      currentSection = "BRANCH";
      continue;
    }
    if (upper.startsWith("/SWITCH")) {
      currentSection = "SWITCH";
      continue;
    }
    if (upper.startsWith("/SOURCE")) {
      currentSection = "SOURCE";
      continue;
    }
    if (upper.startsWith("/OUTPUT")) {
      currentSection = "OUTPUT";
      continue;
    }
    if (upper.startsWith("BLANK") || upper === "/") {
      // Section terminator
      continue;
    }

    // Control line parser: dT, Tmax
    if (!controlParsed && (currentSection === "CONTROL" || currentSection === "HEADER")) {
      // Match two numeric tokens e.g. "1.E-5  0.1" or "0.00001 0.05"
      const tokens = trimmed.split(/[\s,]+/);
      if (tokens.length >= 2) {
        const dt = parseFloat(tokens[0]!);
        const tmax = parseFloat(tokens[1]!);
        if (!Number.isNaN(dt) && dt > 0 && !Number.isNaN(tmax) && tmax > 0) {
          control.deltaTSec = dt;
          control.tMaxSec = tmax;
          controlParsed = true;
          currentSection = "BRANCH";
          continue;
        }
      }
    }

    // Parse according to current section
    switch (currentSection) {
      case "BRANCH": {
        // e.g. "BUS1  BUS2  10.5  25.0  0.1"
        const tokens = trimmed.split(/[\s,]+/);
        if (tokens.length >= 2) {
          const n1 = tokens[0]!;
          const n2 = tokens[1]!;
          const r = tokens.length > 2 ? parseFloat(tokens[2]!) : 0;
          const l = tokens.length > 3 ? parseFloat(tokens[3]!) : 0;
          const c = tokens.length > 4 ? parseFloat(tokens[4]!) : 0;
          branches.push({
            node1: n1,
            node2: n2,
            rOhms: Number.isNaN(r) ? 0 : r,
            lMh: Number.isNaN(l) ? 0 : l,
            cUf: Number.isNaN(c) ? 0 : c,
          });
        }
        break;
      }

      case "SWITCH": {
        // e.g. "BUS1  BUS2  0.01  0.05"
        const tokens = trimmed.split(/[\s,]+/);
        if (tokens.length >= 2) {
          const n1 = tokens[0]!;
          const n2 = tokens[1]!;
          const tClose = tokens.length > 2 ? parseFloat(tokens[2]!) : 0.0;
          const tOpen = tokens.length > 3 ? parseFloat(tokens[3]!) : 1e6;
          switches.push({
            node1: n1,
            node2: n2,
            tCloseSec: Number.isNaN(tClose) ? 0.0 : tClose,
            tOpenSec: Number.isNaN(tOpen) ? 1e6 : tOpen,
          });
        }
        break;
      }

      case "SOURCE": {
        // e.g. "14  BUS1  100000.0  60.0  0.0" or "BUS1  100000.0  60.0  0.0"
        const tokens = trimmed.split(/[\s,]+/);
        if (tokens.length >= 2) {
          let typeCode = 14;
          let node = tokens[0]!;
          let startIdx = 1;

          if (!Number.isNaN(parseInt(tokens[0]!, 10)) && tokens.length >= 3) {
            typeCode = parseInt(tokens[0]!, 10);
            node = tokens[1]!;
            startIdx = 2;
          }

          const amp = tokens.length > startIdx ? parseFloat(tokens[startIdx]!) : 1000.0;
          const freq = tokens.length > startIdx + 1 ? parseFloat(tokens[startIdx + 1]!) : 60.0;
          const phase = tokens.length > startIdx + 2 ? parseFloat(tokens[startIdx + 2]!) : 0.0;

          sources.push({
            node,
            typeCode,
            amplitude: Number.isNaN(amp) ? 1000.0 : amp,
            frequencyHz: Number.isNaN(freq) ? 60.0 : freq,
            phaseDeg: Number.isNaN(phase) ? 0.0 : phase,
          });
        }
        break;
      }

      case "OUTPUT": {
        const tokens = trimmed.split(/[\s,]+/);
        for (const tok of tokens) {
          if (tok.length > 0 && !outputNodes.includes(tok)) {
            outputNodes.push(tok);
          }
        }
        break;
      }

      default:
        break;
    }
  }

  return {
    title,
    control,
    branches,
    switches,
    sources,
    outputNodes,
  };
}
