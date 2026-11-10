// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ANSI/TIA-598-D Optical Fiber Cable Color Coding standard definitions.
 */

export interface Tia598Color {
  number: number;
  name: string;
  hex: string;
  tracerColorHex?: string | undefined;
}

export const TIA_598_COLORS: readonly Tia598Color[] = [
  { number: 1, name: "Blue", hex: "#0000FF" },
  { number: 2, name: "Orange", hex: "#FFA500" },
  { number: 3, name: "Green", hex: "#008000" },
  { number: 4, name: "Brown", hex: "#8B4513" },
  { number: 5, name: "Slate", hex: "#708090" },
  { number: 6, name: "White", hex: "#FFFFFF" },
  { number: 7, name: "Red", hex: "#FF0000" },
  { number: 8, name: "Black", hex: "#000000" },
  { number: 9, name: "Yellow", hex: "#FFFF00" },
  { number: 10, name: "Violet", hex: "#8A2BE2" },
  { number: 11, name: "Rose", hex: "#FF69B4" },
  { number: 12, name: "Aqua", hex: "#00CED1" },
] as const;

export interface ResolvedStrandColor {
  strandNumber: number;
  tubeNumber: number;
  tubeColor: Tia598Color;
  tubeHasStripe: boolean;
  fiberInTube: number;
  fiberColor: Tia598Color;
  fiberHasStripe: boolean;
}

export function getTia598Color(colorNumber1Based: number): Tia598Color {
  const idx = (((colorNumber1Based - 1) % 12) + 12) % 12;
  const col = TIA_598_COLORS[idx];
  return col ?? TIA_598_COLORS[0]!;
}

export function resolveStrandColor(strandNumber1Based: number, fibersPerTube = 12): ResolvedStrandColor {
  if (strandNumber1Based <= 0) {
    throw new Error(`Strand number must be >= 1 (got ${strandNumber1Based})`);
  }

  const zeroBased = strandNumber1Based - 1;
  const tubeNumber = Math.floor(zeroBased / fibersPerTube) + 1;
  const fiberInTube = (zeroBased % fibersPerTube) + 1;

  const tubeColor = getTia598Color(tubeNumber);
  const fiberColor = getTia598Color(fiberInTube);

  const tubeHasStripe = tubeNumber > 12;
  const fiberHasStripe = fibersPerTube > 12 && fiberInTube > 12;

  return {
    strandNumber: strandNumber1Based,
    tubeNumber,
    tubeColor,
    tubeHasStripe,
    fiberInTube,
    fiberColor,
    fiberHasStripe,
  };
}

export function getStrandColorInfo(strandNumber1Based: number): Tia598Color {
  return getTia598Color(strandNumber1Based);
}

export function getBufferTubeColorInfo(tubeNumber1Based: number): Tia598Color {
  return getTia598Color(tubeNumber1Based);
}

