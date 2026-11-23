// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Periodic table element metadata (IUPAC standard atomic weights & covalent radii).
 * Supports elements Z = 1..118 plus Gaussian dummy/ghost atoms (`X`, `Bq`, `TV`).
 */

export interface ElementData {
  symbol: string;
  name: string;
  atomicNumber: number;
  atomicWeight: number;
  covalentRadius: number;
  isDummy?: boolean | undefined;
}

const RAW_ELEMENTS: ReadonlyArray<[string, string, number, number, number]> = [
  ["H", "Hydrogen", 1, 1.00794, 0.31],
  ["He", "Helium", 2, 4.002602, 0.28],
  ["Li", "Lithium", 3, 6.941, 1.28],
  ["Be", "Beryllium", 4, 9.012182, 0.96],
  ["B", "Boron", 5, 10.811, 0.84],
  ["C", "Carbon", 6, 12.0107, 0.76],
  ["N", "Nitrogen", 7, 14.0067, 0.71],
  ["O", "Oxygen", 8, 15.9994, 0.66],
  ["F", "Fluorine", 9, 18.9984032, 0.57],
  ["Ne", "Neon", 10, 20.1797, 0.58],
  ["Na", "Sodium", 11, 22.98976928, 1.66],
  ["Mg", "Magnesium", 12, 24.305, 1.41],
  ["Al", "Aluminum", 13, 26.9815386, 1.21],
  ["Si", "Silicon", 14, 28.0855, 1.11],
  ["P", "Phosphorus", 15, 30.973762, 1.07],
  ["S", "Sulfur", 16, 32.065, 1.05],
  ["Cl", "Chlorine", 17, 35.453, 1.02],
  ["Ar", "Argon", 18, 39.948, 1.06],
  ["K", "Potassium", 19, 39.0983, 2.03],
  ["Ca", "Calcium", 20, 40.078, 1.76],
  ["Sc", "Scandium", 21, 44.955912, 1.7],
  ["Ti", "Titanium", 22, 47.867, 1.6],
  ["V", "Vanadium", 23, 50.9415, 1.53],
  ["Cr", "Chromium", 24, 51.9961, 1.39],
  ["Mn", "Manganese", 25, 54.938045, 1.39],
  ["Fe", "Iron", 26, 55.845, 1.32],
  ["Co", "Cobalt", 27, 58.933195, 1.26],
  ["Ni", "Nickel", 28, 58.6934, 1.24],
  ["Cu", "Copper", 29, 63.546, 1.32],
  ["Zn", "Zinc", 30, 65.38, 1.22],
  ["Ga", "Gallium", 31, 69.723, 1.22],
  ["Ge", "Germanium", 32, 72.64, 1.2],
  ["As", "Arsenic", 33, 74.9216, 1.19],
  ["Se", "Selenium", 34, 78.96, 1.2],
  ["Br", "Bromine", 35, 79.904, 1.2],
  ["Kr", "Krypton", 36, 83.798, 1.16],
  ["Rb", "Rubidium", 37, 85.4678, 2.2],
  ["Sr", "Strontium", 38, 87.62, 1.95],
  ["Y", "Yttrium", 39, 88.90585, 1.9],
  ["Zr", "Zirconium", 40, 91.224, 1.75],
  ["Nb", "Niobium", 41, 92.90638, 1.64],
  ["Mo", "Molybdenum", 42, 95.96, 1.54],
  ["Tc", "Technetium", 43, 98.0, 1.47],
  ["Ru", "Ruthenium", 44, 101.07, 1.46],
  ["Rh", "Rhodium", 45, 102.9055, 1.42],
  ["Pd", "Palladium", 46, 106.42, 1.39],
  ["Ag", "Silver", 47, 107.8682, 1.45],
  ["Cd", "Cadmium", 48, 112.411, 1.44],
  ["In", "Indium", 49, 114.818, 1.42],
  ["Sn", "Tin", 50, 118.71, 1.39],
  ["Sb", "Antimony", 51, 121.76, 1.39],
  ["Te", "Tellurium", 52, 127.6, 1.38],
  ["I", "Iodine", 53, 126.90447, 1.39],
  ["Xe", "Xenon", 54, 131.293, 1.4],
  ["Cs", "Cesium", 55, 132.9054519, 2.44],
  ["Ba", "Barium", 56, 137.327, 2.15],
  ["La", "Lanthanum", 57, 138.90547, 2.07],
  ["Ce", "Cerium", 58, 140.116, 2.04],
  ["Pr", "Praseodymium", 59, 140.90765, 2.03],
  ["Nd", "Neodymium", 60, 144.242, 2.01],
  ["Pm", "Promethium", 61, 145.0, 1.99],
  ["Sm", "Samarium", 62, 150.36, 1.98],
  ["Eu", "Europium", 63, 151.964, 1.98],
  ["Gd", "Gadolinium", 64, 157.25, 1.96],
  ["Tb", "Terbium", 65, 158.92535, 1.94],
  ["Dy", "Dysprosium", 66, 162.5, 1.92],
  ["Ho", "Holmium", 67, 164.93032, 1.92],
  ["Er", "Erbium", 68, 167.259, 1.89],
  ["Tm", "Thulium", 69, 168.93421, 1.9],
  ["Yb", "Ytterbium", 70, 173.054, 1.87],
  ["Lu", "Lutetium", 71, 174.9668, 1.87],
  ["Hf", "Hafnium", 72, 178.49, 1.75],
  ["Ta", "Tantalum", 73, 180.94788, 1.7],
  ["W", "Tungsten", 74, 183.84, 1.62],
  ["Re", "Rhenium", 75, 186.207, 1.51],
  ["Os", "Osmium", 76, 190.23, 1.44],
  ["Ir", "Iridium", 77, 192.217, 1.41],
  ["Pt", "Platinum", 78, 195.084, 1.36],
  ["Au", "Gold", 79, 196.966569, 1.36],
  ["Hg", "Mercury", 80, 200.59, 1.32],
  ["Tl", "Thallium", 81, 204.3833, 1.45],
  ["Pb", "Lead", 82, 207.2, 1.46],
  ["Bi", "Bismuth", 83, 208.9804, 1.48],
  ["Po", "Polonium", 84, 209.0, 1.4],
  ["At", "Astatine", 85, 210.0, 1.5],
  ["Rn", "Radon", 86, 222.0, 1.5],
  ["Fr", "Francium", 87, 223.0, 2.6],
  ["Ra", "Radium", 88, 226.0, 2.21],
  ["Ac", "Actinium", 89, 227.0, 2.15],
  ["Th", "Thorium", 90, 232.03806, 2.06],
  ["Pa", "Protactinium", 91, 231.03588, 2.0],
  ["U", "Uranium", 92, 238.02891, 1.96],
  ["Np", "Neptunium", 93, 237.0, 1.9],
  ["Pu", "Plutonium", 94, 244.0, 1.87],
  ["Am", "Americium", 95, 243.0, 1.8],
  ["Cm", "Curium", 96, 247.0, 1.69],
  ["Bk", "Berkelium", 97, 247.0, 1.66],
  ["Cf", "Californium", 98, 251.0, 1.68],
  ["Es", "Einsteinium", 99, 252.0, 1.65],
  ["Fm", "Fermium", 100, 257.0, 1.67],
  ["Md", "Mendelevium", 101, 258.0, 1.73],
  ["No", "Nobelium", 102, 259.0, 1.76],
  ["Lr", "Lawrencium", 103, 262.0, 1.61],
  ["Rf", "Rutherfordium", 104, 267.0, 1.57],
  ["Db", "Dubnium", 105, 268.0, 1.49],
  ["Sg", "Seaborgium", 106, 269.0, 1.43],
  ["Bh", "Bohrium", 107, 270.0, 1.41],
  ["Hs", "Hassium", 108, 277.0, 1.34],
  ["Mt", "Meitnerium", 109, 278.0, 1.29],
  ["Ds", "Darmstadtium", 110, 281.0, 1.28],
  ["Rg", "Roentgenium", 111, 282.0, 1.21],
  ["Cn", "Copernicium", 112, 285.0, 1.22],
  ["Nh", "Nihonium", 113, 286.0, 1.36],
  ["Fl", "Flerovium", 114, 289.0, 1.43],
  ["Mc", "Moscovium", 115, 290.0, 1.62],
  ["Lv", "Livermorium", 116, 293.0, 1.75],
  ["Ts", "Tennessine", 117, 294.0, 1.65],
  ["Og", "Oganesson", 118, 294.0, 1.57],
];

const BY_SYMBOL = new Map<string, ElementData>();
const BY_ATOMIC_NUMBER = new Map<number, ElementData>();

for (const [symbol, name, atomicNumber, atomicWeight, covalentRadius] of RAW_ELEMENTS) {
  const entry: ElementData = { symbol, name, atomicNumber, atomicWeight, covalentRadius, isDummy: false };
  BY_SYMBOL.set(symbol.toLowerCase(), entry);
  BY_ATOMIC_NUMBER.set(atomicNumber, entry);
}

const DUMMY_ATOMS: ReadonlyArray<ElementData> = [
  { symbol: "X", name: "Dummy Atom", atomicNumber: 0, atomicWeight: 0.0, covalentRadius: 0.0, isDummy: true },
  { symbol: "Bq", name: "Ghost Atom (Banquo)", atomicNumber: 0, atomicWeight: 0.0, covalentRadius: 0.0, isDummy: true },
  { symbol: "TV", name: "Translation Vector", atomicNumber: 0, atomicWeight: 0.0, covalentRadius: 0.0, isDummy: true },
];

for (const d of DUMMY_ATOMS) {
  BY_SYMBOL.set(d.symbol.toLowerCase(), d);
}

/**
 * Looks up element metadata by chemical symbol (case-insensitive, optionally with
 * Gaussian isotope/MM suffix like `C-CT`, `H(Iso=2)`, `O1`) or atomic number string/number.
 */
export function lookupElement(symbolOrZ: string | number): ElementData | undefined {
  if (typeof symbolOrZ === "number") {
    return BY_ATOMIC_NUMBER.get(symbolOrZ);
  }
  const trimmed = symbolOrZ.trim();
  if (!trimmed) return undefined;

  if (/^\d+$/.test(trimmed)) {
    const z = Number.parseInt(trimmed, 10);
    return BY_ATOMIC_NUMBER.get(z);
  }

  // Strip optional Gaussian isotope/MM/fragment suffix: e.g. C(Iso=13), O-OW, H1 -> base symbol
  const baseMatch = /^([A-Za-z]{1,2})(?:$|[-(\d])/.exec(trimmed);
  if (!baseMatch) return undefined;
  const candidate = baseMatch[1]!;

  // Exact full-string match takes priority over prefix strip (so "Xx" won't match "X")
  const exact = BY_SYMBOL.get(trimmed.toLowerCase());
  if (exact) return exact;

  // Allow suffixes like C-CT, O(Iso=18), H1 only when delimited by -, (, or digits
  if (/^[A-Za-z]{1,2}(?:[-(\d].*)$/.test(trimmed)) {
    return BY_SYMBOL.get(candidate.toLowerCase());
  }
  return undefined;
}

export function isDummyAtomSymbol(symbol: string): boolean {
  const el = lookupElement(symbol);
  return Boolean(el?.isDummy);
}

export function getAllElements(): ElementData[] {
  return [...BY_ATOMIC_NUMBER.values()];
}
