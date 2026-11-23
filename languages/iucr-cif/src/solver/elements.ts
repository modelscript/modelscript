// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Element database: IUPAC atomic weights (g/mol), atomic numbers, covalent radii (Å),
 * CPK visualization colors, and International Tables Vol. C Cromer-Mann X-ray scattering factors.
 */

export interface ElementInfo {
  symbol: string;
  z: number;
  mass: number;
  covalentRadius: number;
  cpkColor: string;
  /** Cromer-Mann [a1, b1, a2, b2, a3, b3, a4, b4, c] for f(s), s = sin(theta)/lambda (Å^-1). */
  cm?: [number, number, number, number, number, number, number, number, number];
}

export const ELEMENT_TABLE: Record<string, ElementInfo> = {
  H: {
    symbol: "H",
    z: 1,
    mass: 1.00794,
    covalentRadius: 0.31,
    cpkColor: "#e2e8f0",
    cm: [0.493002, 10.5109, 0.322912, 26.1257, 0.140191, 3.14236, 0.04081, 57.7997, 0.003038],
  },
  He: { symbol: "He", z: 2, mass: 4.0026, covalentRadius: 0.28, cpkColor: "#bae6fd" },
  Li: { symbol: "Li", z: 3, mass: 6.941, covalentRadius: 1.28, cpkColor: "#c084fc" },
  Be: { symbol: "Be", z: 4, mass: 9.01218, covalentRadius: 0.96, cpkColor: "#86efac" },
  B: { symbol: "B", z: 5, mass: 10.811, covalentRadius: 0.84, cpkColor: "#fca5a5" },
  C: {
    symbol: "C",
    z: 6,
    mass: 12.0107,
    covalentRadius: 0.76,
    cpkColor: "#64748b",
    cm: [2.31, 20.8439, 1.02, 10.2075, 1.5886, 0.5687, 0.865, 51.6512, 0.2156],
  },
  N: {
    symbol: "N",
    z: 7,
    mass: 14.0067,
    covalentRadius: 0.71,
    cpkColor: "#3b82f6",
    cm: [12.2126, 0.0057, 3.1322, 9.8933, 2.0125, 28.9975, 1.1663, 0.5826, -11.529],
  },
  O: {
    symbol: "O",
    z: 8,
    mass: 15.9994,
    covalentRadius: 0.66,
    cpkColor: "#ef4444",
    cm: [3.0485, 13.2771, 2.2868, 5.7011, 1.5463, 0.3239, 0.867, 32.9089, 0.2508],
  },
  F: {
    symbol: "F",
    z: 9,
    mass: 18.9984,
    covalentRadius: 0.57,
    cpkColor: "#4ade80",
    cm: [3.5392, 10.2825, 2.6412, 4.2944, 1.517, 0.2615, 1.0243, 26.1476, 0.2776],
  },
  Ne: { symbol: "Ne", z: 10, mass: 20.1797, covalentRadius: 0.58, cpkColor: "#7dd3fc" },
  Na: {
    symbol: "Na",
    z: 11,
    mass: 22.98977,
    covalentRadius: 1.66,
    cpkColor: "#a855f7",
    cm: [4.7626, 3.285, 3.1736, 8.8422, 1.2674, 0.3136, 1.1128, 129.424, 0.676],
  },
  Mg: {
    symbol: "Mg",
    z: 12,
    mass: 24.305,
    covalentRadius: 1.41,
    cpkColor: "#22c55e",
    cm: [5.4204, 2.8275, 2.1735, 79.2611, 1.2269, 0.3808, 2.3073, 7.1937, 0.8584],
  },
  Al: {
    symbol: "Al",
    z: 13,
    mass: 26.98154,
    covalentRadius: 1.21,
    cpkColor: "#94a3b8",
    cm: [6.4202, 3.0387, 1.9002, 0.7426, 1.5936, 31.5472, 1.9646, 85.0886, 1.1151],
  },
  Si: {
    symbol: "Si",
    z: 14,
    mass: 28.0855,
    covalentRadius: 1.11,
    cpkColor: "#f59e0b",
    cm: [6.2915, 2.4386, 3.0353, 32.3337, 1.9891, 0.6785, 1.541, 81.6937, 1.1407],
  },
  P: {
    symbol: "P",
    z: 15,
    mass: 30.97376,
    covalentRadius: 1.07,
    cpkColor: "#f97316",
    cm: [6.4345, 1.9067, 4.1791, 27.157, 1.78, 0.526, 1.4908, 68.1645, 1.1149],
  },
  S: {
    symbol: "S",
    z: 16,
    mass: 32.065,
    covalentRadius: 1.05,
    cpkColor: "#eab308",
    cm: [6.9053, 1.4679, 5.2034, 22.2151, 1.4379, 0.2536, 1.5863, 56.172, 0.8669],
  },
  Cl: {
    symbol: "Cl",
    z: 17,
    mass: 35.453,
    covalentRadius: 1.02,
    cpkColor: "#10b981",
    cm: [11.4604, 0.0104, 7.1964, 1.1662, 6.2556, 18.5194, 1.6455, 47.7784, -9.5574],
  },
  Ar: { symbol: "Ar", z: 18, mass: 39.948, covalentRadius: 1.06, cpkColor: "#38bdf8" },
  K: {
    symbol: "K",
    z: 19,
    mass: 39.0983,
    covalentRadius: 2.03,
    cpkColor: "#9333ea",
    cm: [8.2186, 12.7949, 7.4398, 0.7748, 1.0519, 213.187, 0.8659, 41.6841, 1.4228],
  },
  Ca: {
    symbol: "Ca",
    z: 20,
    mass: 40.078,
    covalentRadius: 1.76,
    cpkColor: "#16a34a",
    cm: [8.6266, 10.4421, 7.3873, 0.6599, 1.5899, 85.7484, 1.0211, 178.437, 1.3751],
  },
  Ti: {
    symbol: "Ti",
    z: 22,
    mass: 47.867,
    covalentRadius: 1.6,
    cpkColor: "#94a3b8",
    cm: [9.7595, 7.8508, 7.3558, 0.5, 1.6991, 35.6338, 1.9021, 116.105, 1.2807],
  },
  V: { symbol: "V", z: 23, mass: 50.9415, covalentRadius: 1.53, cpkColor: "#a1a1aa" },
  Cr: { symbol: "Cr", z: 24, mass: 51.9961, covalentRadius: 1.39, cpkColor: "#60a5fa" },
  Mn: { symbol: "Mn", z: 25, mass: 54.93805, covalentRadius: 1.39, cpkColor: "#a78bfa" },
  Fe: {
    symbol: "Fe",
    z: 26,
    mass: 55.845,
    covalentRadius: 1.32,
    cpkColor: "#ea580c",
    cm: [11.7695, 4.7611, 7.3573, 0.3072, 3.5222, 15.3535, 2.3045, 76.8805, 1.0369],
  },
  Co: { symbol: "Co", z: 27, mass: 58.9332, covalentRadius: 1.26, cpkColor: "#f472b6" },
  Ni: {
    symbol: "Ni",
    z: 28,
    mass: 58.6934,
    covalentRadius: 1.24,
    cpkColor: "#34d399",
    cm: [12.8376, 3.8785, 7.292, 0.2565, 4.4438, 12.1763, 2.38, 66.3421, 1.0341],
  },
  Cu: {
    symbol: "Cu",
    z: 29,
    mass: 63.546,
    covalentRadius: 1.32,
    cpkColor: "#d97706",
    cm: [13.338, 3.5828, 7.1676, 0.247, 5.6158, 11.3966, 1.6735, 64.8126, 1.191],
  },
  Zn: {
    symbol: "Zn",
    z: 30,
    mass: 65.38,
    covalentRadius: 1.22,
    cpkColor: "#818cf8",
    cm: [14.0743, 3.2655, 7.0318, 0.2333, 5.1652, 10.3163, 2.41, 58.7097, 1.3041],
  },
  Ga: { symbol: "Ga", z: 31, mass: 69.723, covalentRadius: 1.22, cpkColor: "#c084fc" },
  Ge: { symbol: "Ge", z: 32, mass: 72.64, covalentRadius: 1.2, cpkColor: "#2dd4bf" },
  As: { symbol: "As", z: 33, mass: 74.9216, covalentRadius: 1.19, cpkColor: "#c084fc" },
  Se: { symbol: "Se", z: 34, mass: 78.96, covalentRadius: 1.2, cpkColor: "#fb923c" },
  Br: { symbol: "Br", z: 35, mass: 79.904, covalentRadius: 1.2, cpkColor: "#b91c1c" },
  Sr: { symbol: "Sr", z: 38, mass: 87.62, covalentRadius: 1.95, cpkColor: "#22c55e" },
  Zr: { symbol: "Zr", z: 40, mass: 91.224, covalentRadius: 1.75, cpkColor: "#38bdf8" },
  Ag: {
    symbol: "Ag",
    z: 47,
    mass: 107.8682,
    covalentRadius: 1.45,
    cpkColor: "#cbd5e1",
    cm: [19.2808, 0.6446, 16.6885, 7.4726, 4.8045, 24.6605, 1.0463, 99.8156, 5.179],
  },
  Cd: { symbol: "Cd", z: 48, mass: 112.411, covalentRadius: 1.44, cpkColor: "#fde047" },
  In: { symbol: "In", z: 49, mass: 114.818, covalentRadius: 1.42, cpkColor: "#a78bfa" },
  Sn: { symbol: "Sn", z: 50, mass: 118.71, covalentRadius: 1.39, cpkColor: "#64748b" },
  Sb: { symbol: "Sb", z: 51, mass: 121.76, covalentRadius: 1.39, cpkColor: "#8b5cf6" },
  Te: { symbol: "Te", z: 52, mass: 127.6, covalentRadius: 1.38, cpkColor: "#d97706" },
  I: { symbol: "I", z: 53, mass: 126.90447, covalentRadius: 1.39, cpkColor: "#7e22ce" },
  Cs: { symbol: "Cs", z: 55, mass: 132.90545, covalentRadius: 2.44, cpkColor: "#7c3aed" },
  Ba: {
    symbol: "Ba",
    z: 56,
    mass: 137.327,
    covalentRadius: 2.15,
    cpkColor: "#15803d",
    cm: [20.3361, 3.216, 19.297, 0.2756, 10.888, 20.2073, 2.6959, 167.202, 2.7731],
  },
  La: { symbol: "La", z: 57, mass: 138.90547, covalentRadius: 2.07, cpkColor: "#38bdf8" },
  W: { symbol: "W", z: 74, mass: 183.84, covalentRadius: 1.62, cpkColor: "#0284c7" },
  Pt: { symbol: "Pt", z: 78, mass: 195.084, covalentRadius: 1.36, cpkColor: "#cbd5e1" },
  Au: {
    symbol: "Au",
    z: 79,
    mass: 196.96657,
    covalentRadius: 1.36,
    cpkColor: "#facc15",
    cm: [16.8819, 0.4611, 18.5913, 8.6216, 25.5582, 1.4826, 5.86, 36.3956, 12.0658],
  },
  Hg: { symbol: "Hg", z: 80, mass: 200.59, covalentRadius: 1.32, cpkColor: "#94a3b8" },
  Pb: {
    symbol: "Pb",
    z: 82,
    mass: 207.2,
    covalentRadius: 1.46,
    cpkColor: "#475569",
    cm: [31.0617, 0.6902, 13.0637, 2.3576, 18.442, 8.618, 5.9696, 47.2579, 13.4118],
  },
  Bi: { symbol: "Bi", z: 83, mass: 208.9804, covalentRadius: 1.48, cpkColor: "#9333ea" },
  U: { symbol: "U", z: 92, mass: 238.02891, covalentRadius: 1.96, cpkColor: "#0ea5e9" },
};

export function lookupElement(symbol: string): ElementInfo | undefined {
  if (!symbol) return undefined;
  const norm = symbol.length === 1 ? symbol.toUpperCase() : symbol[0]!.toUpperCase() + symbol.slice(1).toLowerCase();
  return ELEMENT_TABLE[norm];
}

export function isKnownElement(symbol: string): boolean {
  return lookupElement(symbol) !== undefined;
}

/**
 * Evaluates the Cromer-Mann atomic X-ray scattering factor f(s) where s = sin(theta) / lambda (Å^-1).
 */
export function atomicScatteringFactor(symbol: string, s: number): number {
  const el = lookupElement(symbol);
  if (!el) return 6.0 * Math.exp(-8.0 * s * s);
  const s2 = s * s;
  if (el.cm) {
    const [a1, b1, a2, b2, a3, b3, a4, b4, c] = el.cm;
    return a1 * Math.exp(-b1 * s2) + a2 * Math.exp(-b2 * s2) + a3 * Math.exp(-b3 * s2) + a4 * Math.exp(-b4 * s2) + c;
  }
  // Smooth Gaussian approximation scaled by Z for elements without explicit Cromer-Mann coefficients
  return el.z * (0.45 * Math.exp(-2.5 * s2) + 0.35 * Math.exp(-12.0 * s2) + 0.2 * Math.exp(-45.0 * s2));
}
