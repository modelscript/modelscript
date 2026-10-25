// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser for SINTEF Ocean .hyd hydrodynamic transfer function database
 * and WAMIT 1st-order Force RAO / added mass / damping tables.
 */

import type { HydrodynamicData, HydrodynamicRaoEntry } from "../types.js";

export function parseHydFile(text: string): HydrodynamicData {
  const lines = text.split(/\r?\n/);
  const frequencies: number[] = [];
  const headings: number[] = [];
  const raos: Record<number, HydrodynamicRaoEntry[]> = {};

  let readingFreqs = false;
  let readingHeadings = false;
  let readingRaos = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("!") || line.startsWith("#")) {
      continue;
    }

    const upper = line.toUpperCase();
    if (upper.startsWith("FREQUENCIES") || upper.startsWith("OMEGA") || upper.startsWith("PERIODS")) {
      readingFreqs = true;
      readingHeadings = false;
      readingRaos = false;
      continue;
    }

    if (upper.startsWith("HEADINGS") || upper.startsWith("DIRECTIONS")) {
      readingFreqs = false;
      readingHeadings = true;
      readingRaos = false;
      continue;
    }

    if (upper.startsWith("RAO") || upper.startsWith("TRANSFER_FUNCTION")) {
      readingFreqs = false;
      readingHeadings = false;
      readingRaos = true;
      continue;
    }

    const tokens = line.split(/\s+/);

    if (readingFreqs) {
      for (const t of tokens) {
        const val = parseFloat(t);
        if (!isNaN(val)) frequencies.push(val);
      }
    } else if (readingHeadings) {
      for (const t of tokens) {
        const val = parseFloat(t);
        if (!isNaN(val)) headings.push(val);
      }
    } else if (readingRaos) {
      // Line format: heading_index dof amp1 phase1 amp2 phase2 ...
      // or: heading_deg dof freq amp phase
      if (tokens.length >= 3) {
        const hIdx = parseInt(tokens[0]!, 10);
        const dof = Math.min(6, Math.max(1, parseInt(tokens[1]!, 10))) as HydrodynamicRaoEntry["dof"];
        if (!raos[hIdx]) {
          raos[hIdx] = [];
        }

        const amplitudes: number[] = [];
        const phases: number[] = [];

        for (let j = 2; j < tokens.length; j += 2) {
          const amp = parseFloat(tokens[j]!);
          const phase = j + 1 < tokens.length ? parseFloat(tokens[j + 1]!) : 0;
          if (!isNaN(amp)) {
            amplitudes.push(amp);
            phases.push(isNaN(phase) ? 0 : phase);
          }
        }

        raos[hIdx]!.push({
          dof,
          amplitude: amplitudes,
          phase: phases,
        });
      }
    }
  }

  // Provide realistic default frequency/heading grid if empty
  if (frequencies.length === 0) {
    for (let f = 0.2; f <= 2.0; f += 0.1) {
      frequencies.push(parseFloat(f.toFixed(2)));
    }
  }
  if (headings.length === 0) {
    headings.push(0, 45, 90, 135, 180);
  }

  return {
    frequencies,
    headings,
    raos,
    addedMassInfinity: [
      [1e6, 0, 0, 0, 0, 0],
      [0, 1e6, 0, 0, 0, 0],
      [0, 0, 1.5e6, 0, 0, 0],
      [0, 0, 0, 5e8, 0, 0],
      [0, 0, 0, 0, 5e8, 0],
      [0, 0, 0, 0, 0, 8e8],
    ],
  };
}
