// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/endf6 — 80-Column ENDF-6 Tape & Record Parser.
 *
 * Decodes ENDF-6 tapes into structured `HEAD`, `CONT`, `TAB1`, and `LIST` records,
 * supporting `MF=1` (`MT=451`), `MF=2` (`MT=151` SLBW resonances), `MF=3` (pointwise
 * cross-sections `MT=1, 2, 18, 102`, ...), `MF=8` (`MT=457` radioactive decay),
 * and `SEND`/`FEND`/`MEND`/`TEND` terminators.
 */

import type {
  Endf6Card,
  Endf6ContRecord,
  Endf6CrossSectionSection,
  Endf6DecayData,
  Endf6DecayMode,
  Endf6Description,
  Endf6DirectoryEntry,
  Endf6HeadRecord,
  Endf6InterpolationRegion,
  Endf6ListRecord,
  Endf6Material,
  Endf6ParseError,
  Endf6Point,
  Endf6Resonance,
  Endf6ResonanceRange,
  Endf6Section,
  Endf6Tab1Record,
  Endf6Tape,
  Endf6TerminatorKind,
} from "../types.js";
import { parseEndfFloat, parseEndfInt } from "./endf-float.js";

const ELEMENT_SYMBOLS: readonly string[] = [
  "n",
  "H",
  "He",
  "Li",
  "Be",
  "B",
  "C",
  "N",
  "O",
  "F",
  "Ne",
  "Na",
  "Mg",
  "Al",
  "Si",
  "P",
  "S",
  "Cl",
  "Ar",
  "K",
  "Ca",
  "Sc",
  "Ti",
  "V",
  "Cr",
  "Mn",
  "Fe",
  "Co",
  "Ni",
  "Cu",
  "Zn",
  "Ga",
  "Ge",
  "As",
  "Se",
  "Br",
  "Kr",
  "Rb",
  "Sr",
  "Y",
  "Zr",
  "Nb",
  "Mo",
  "Tc",
  "Ru",
  "Rh",
  "Pd",
  "Ag",
  "Cd",
  "In",
  "Sn",
  "Sb",
  "Te",
  "I",
  "Xe",
  "Cs",
  "Ba",
  "La",
  "Ce",
  "Pr",
  "Nd",
  "Pm",
  "Sm",
  "Eu",
  "Gd",
  "Tb",
  "Dy",
  "Ho",
  "Er",
  "Tm",
  "Yb",
  "Lu",
  "Hf",
  "Ta",
  "W",
  "Re",
  "Os",
  "Ir",
  "Pt",
  "Au",
  "Hg",
  "Tl",
  "Pb",
  "Bi",
  "Po",
  "At",
  "Rn",
  "Fr",
  "Ra",
  "Ac",
  "Th",
  "Pa",
  "U",
  "Np",
  "Pu",
  "Am",
  "Cm",
  "Bk",
  "Cf",
  "Es",
  "Fm",
  "Md",
  "No",
  "Lr",
  "Rf",
  "Db",
  "Sg",
  "Bh",
  "Hs",
  "Mt",
  "Ds",
  "Rg",
  "Cn",
  "Nh",
  "Fl",
  "Mc",
  "Lv",
  "Ts",
  "Og",
];

/** Converts an ENDF-6 `ZA = 1000*Z + A` identifier into a human-readable nuclide label (e.g. `"U-235"`). */
export function zaToNuclideName(za: number): string {
  const z = Math.floor(za / 1000);
  const a = Math.round(za % 1000);
  const sym = ELEMENT_SYMBOLS[z];
  if (!sym) return `ZA-${Math.round(za)}`;
  return a === 0 ? `${sym}-nat` : `${sym}-${a}`;
}

/**
 * Classifies an ENDF-6 card's `(MAT, MF, MT)` tuple as a terminator or `null`.
 */
export function classifyTerminator(mat: number, mf: number, mt: number): Endf6TerminatorKind | null {
  if (mat === -1 && mf === 0 && mt === 0) return "TEND";
  if (mat === 0 && mf === 0 && mt === 0) return "MEND";
  if (mat > 0 && mf === 0 && mt === 0) return "FEND";
  if (mat > 0 && mf > 0 && mt === 0) return "SEND";
  return null;
}

/**
 * Parses a single raw 80-column ENDF-6 line into an `Endf6Card`.
 */
export function parseEndf6Card(
  raw: string,
  line: number,
  startOffset: number = 0,
  endOffset: number = raw.length,
): Endf6Card {
  const padded = raw.length < 80 ? raw.padEnd(80, " ") : raw;
  const fields: [string, string, string, string, string, string] = [
    padded.slice(0, 11),
    padded.slice(11, 22),
    padded.slice(22, 33),
    padded.slice(33, 44),
    padded.slice(44, 55),
    padded.slice(55, 66),
  ];
  const mat = parseEndfInt(padded.slice(66, 70));
  const mf = parseEndfInt(padded.slice(70, 72));
  const mt = parseEndfInt(padded.slice(72, 75));
  const ns = parseEndfInt(padded.slice(75, 80));
  const terminator =
    Number.isFinite(mat) && Number.isFinite(mf) && Number.isFinite(mt) ? classifyTerminator(mat, mf, mt) : null;

  return {
    line,
    startOffset,
    endOffset,
    raw,
    fields,
    mat,
    mf,
    mt,
    ns: Number.isFinite(ns) ? ns : 0,
    terminator,
  };
}

/** Reads an ENDF-6 `CONT` record from a single card. */
export function readContRecord(card: Endf6Card): Endf6ContRecord {
  return {
    c1: parseEndfFloat(card.fields[0]),
    c2: parseEndfFloat(card.fields[1]),
    l1: parseEndfInt(card.fields[2]),
    l2: parseEndfInt(card.fields[3]),
    n1: parseEndfInt(card.fields[4]),
    n2: parseEndfInt(card.fields[5]),
    mat: card.mat,
    mf: card.mf,
    mt: card.mt,
    line: card.line,
  };
}

/** Reads an ENDF-6 `HEAD` record from a single card. */
export function readHeadRecord(card: Endf6Card): Endf6HeadRecord {
  const cont = readContRecord(card);
  return {
    za: cont.c1,
    awr: cont.c2,
    l1: cont.l1,
    l2: cont.l2,
    n1: cont.n1,
    n2: cont.n2,
    mat: cont.mat,
    mf: cont.mf,
    mt: cont.mt,
    line: cont.line,
  };
}

/**
 * Reads an ENDF-6 `LIST` record starting at `cards[cursor]`.
 * Returns the parsed `Endf6ListRecord` and the updated cursor index.
 */
export function readListRecord(
  cards: readonly Endf6Card[],
  cursor: number,
): { record: Endf6ListRecord; nextCursor: number } {
  const headCard = cards[cursor]!;
  const cont = readContRecord(headCard);
  const npl = Math.max(0, Number.isFinite(cont.n1) ? cont.n1 : 0);
  const values: number[] = [];
  let idx = cursor + 1;

  while (values.length < npl && idx < cards.length) {
    const c = cards[idx]!;
    for (let f = 0; f < 6 && values.length < npl; f++) {
      values.push(parseEndfFloat(c.fields[f]!));
    }
    idx++;
  }

  return {
    record: {
      c1: cont.c1,
      c2: cont.c2,
      l1: cont.l1,
      l2: cont.l2,
      npl,
      n2: cont.n2,
      values,
      mat: cont.mat,
      mf: cont.mf,
      mt: cont.mt,
      line: cont.line,
    },
    nextCursor: idx,
  };
}

/**
 * Reads an ENDF-6 `TAB1` record starting at `cards[cursor]`.
 * Returns the parsed `Endf6Tab1Record` and the updated cursor index.
 */
export function readTab1Record(
  cards: readonly Endf6Card[],
  cursor: number,
): { record: Endf6Tab1Record; nextCursor: number } {
  const headCard = cards[cursor]!;
  const cont = readContRecord(headCard);
  const nr = Math.max(0, Number.isFinite(cont.n1) ? cont.n1 : 0);
  const np = Math.max(0, Number.isFinite(cont.n2) ? cont.n2 : 0);

  let idx = cursor + 1;
  const regions: Endf6InterpolationRegion[] = [];
  const interpInts: number[] = [];
  const neededInterpInts = nr * 2;
  while (interpInts.length < neededInterpInts && idx < cards.length) {
    const c = cards[idx]!;
    for (let f = 0; f < 6 && interpInts.length < neededInterpInts; f++) {
      interpInts.push(parseEndfInt(c.fields[f]!));
    }
    idx++;
  }
  for (let r = 0; r < nr; r++) {
    regions.push({
      nbt: interpInts[r * 2] ?? np,
      interp: interpInts[r * 2 + 1] ?? 2,
    });
  }

  const points: Endf6Point[] = [];
  const pointFloats: number[] = [];
  const neededPointFloats = np * 2;
  while (pointFloats.length < neededPointFloats && idx < cards.length) {
    const c = cards[idx]!;
    for (let f = 0; f < 6 && pointFloats.length < neededPointFloats; f++) {
      pointFloats.push(parseEndfFloat(c.fields[f]!));
    }
    idx++;
  }
  for (let p = 0; p < np; p++) {
    points.push({
      x: pointFloats[p * 2] ?? 0,
      y: pointFloats[p * 2 + 1] ?? 0,
    });
  }

  return {
    record: {
      c1: cont.c1,
      c2: cont.c2,
      l1: cont.l1,
      l2: cont.l2,
      nr,
      np,
      regions,
      points,
      mat: cont.mat,
      mf: cont.mf,
      mt: cont.mt,
      line: cont.line,
    },
    nextCursor: idx,
  };
}

function decodeMf1Mt451(section: Endf6Section): Endf6Description | undefined {
  const cards = section.cards;
  if (cards.length < 4) return undefined;
  const head = readHeadRecord(cards[0]!);
  const c2 = readContRecord(cards[1]!);
  const c3 = readContRecord(cards[2]!);
  const c4 = readContRecord(cards[3]!);
  const nwd = Math.max(0, c4.n1);
  const nxc = Math.max(0, c4.n2);

  const textLines: string[] = [];
  let cursor = 4;
  for (let i = 0; i < nwd && cursor < cards.length; i++, cursor++) {
    textLines.push(cards[cursor]!.raw.slice(0, 66).trimEnd());
  }

  const directory: Endf6DirectoryEntry[] = [];
  for (let i = 0; i < nxc && cursor < cards.length; i++, cursor++) {
    const dc = readContRecord(cards[cursor]!);
    directory.push({
      mf: dc.l1,
      mt: dc.l2,
      nc: dc.n1,
      mod: dc.n2,
    });
  }

  return {
    za: head.za,
    awr: head.awr,
    lrp: head.l1,
    lfi: head.l2,
    nlib: head.n1,
    nmod: head.n2,
    elis: c2.c1,
    sta: c2.c2,
    lis: c2.l1,
    liso: c2.l2,
    nfor: c2.n2,
    awi: c3.c1,
    emax: c3.c2,
    lrel: c3.l1,
    nsub: c3.n1,
    nver: c3.n2,
    temp: c4.c1,
    ldrv: c4.l1,
    nwd,
    nxc,
    textLines,
    directory,
    line: head.line,
  };
}

function decodeMf2Mt151(section: Endf6Section): Endf6ResonanceRange[] {
  const cards = section.cards;
  if (cards.length < 4) return [];
  const head = readHeadRecord(cards[0]!);
  const nis = Math.max(1, head.n1);
  const ranges: Endf6ResonanceRange[] = [];
  let cursor = 1;

  for (let iso = 0; iso < nis && cursor < cards.length; iso++) {
    const isoCont = readContRecord(cards[cursor++]!);
    const ner = Math.max(0, isoCont.n1);
    for (let r = 0; r < ner && cursor < cards.length; r++) {
      const rangeCont = readContRecord(cards[cursor++]!);
      const el = rangeCont.c1;
      const eh = rangeCont.c2;
      const lru = rangeCont.l1;
      const lrf = rangeCont.l2;
      if (cursor >= cards.length) break;

      const spinCont = readContRecord(cards[cursor++]!);
      const spi = spinCont.c1;
      const ap = spinCont.c2;
      const nls = Math.max(0, spinCont.n1);

      for (let li = 0; li < nls && cursor < cards.length; li++) {
        const listStartLine = cards[cursor]!.line;
        const { record: list, nextCursor } = readListRecord(cards, cursor);
        cursor = nextCursor;
        const nrs = Math.max(0, list.n2);
        const resonances: Endf6Resonance[] = [];
        for (let k = 0; k < nrs && k * 6 + 5 < list.values.length; k++) {
          resonances.push({
            er: list.values[k * 6]!,
            aj: list.values[k * 6 + 1]!,
            gt: list.values[k * 6 + 2]!,
            gn: list.values[k * 6 + 3]!,
            gg: list.values[k * 6 + 4]!,
            gf: list.values[k * 6 + 5]!,
            line: listStartLine + 1 + k,
          });
        }
        ranges.push({
          za: isoCont.c1 > 0 ? isoCont.c1 : head.za,
          awr: list.c1 > 0 ? list.c1 : head.awr,
          el,
          eh,
          lru,
          lrf,
          spi,
          ap,
          l: list.l1,
          resonances,
          line: rangeCont.line,
        });
      }
    }
  }

  return ranges;
}

function decodeMf3Section(section: Endf6Section): Endf6CrossSectionSection | undefined {
  const cards = section.cards;
  if (cards.length < 2) return undefined;
  const head = readHeadRecord(cards[0]!);
  const { record: tab1 } = readTab1Record(cards, 1);

  return {
    mat: section.mat,
    mt: section.mt,
    za: head.za,
    awr: head.awr,
    qm: tab1.c1,
    qi: tab1.c2,
    lr: tab1.l2,
    tab1,
    line: section.startLine,
    endLine: section.endLine,
    startOffset: section.startOffset,
    endOffset: section.endOffset,
  };
}

function decodeMf8Mt457(section: Endf6Section): Endf6DecayData | undefined {
  const cards = section.cards;
  if (cards.length < 2) return undefined;
  const head = readHeadRecord(cards[0]!);
  const nst = head.n1;

  if (nst === 1) {
    // Stable nuclide
    const spList = cards.length >= 3 ? readListRecord(cards, 2).record : undefined;
    return {
      za: head.za,
      awr: head.awr,
      lis: head.l1,
      liso: head.l2,
      nst: 1,
      halfLife: Number.POSITIVE_INFINITY,
      halfLifeUnc: 0,
      averageEnergies: [],
      spin: spList?.c1 ?? 0,
      parity: spList?.c2 ?? 1,
      decayModes: [],
      line: head.line,
    };
  }

  const { record: hlList, nextCursor } = readListRecord(cards, 1);
  const decayModes: Endf6DecayMode[] = [];
  let spin = 0;
  let parity = 1;

  if (nextCursor < cards.length) {
    const { record: modeList } = readListRecord(cards, nextCursor);
    spin = modeList.c1;
    parity = modeList.c2;
    const ndk = Math.max(0, modeList.n2);
    for (let k = 0; k < ndk && k * 6 + 5 < modeList.values.length; k++) {
      decayModes.push({
        rtyp: modeList.values[k * 6]!,
        rfs: modeList.values[k * 6 + 1]!,
        q: modeList.values[k * 6 + 2]!,
        dq: modeList.values[k * 6 + 3]!,
        br: modeList.values[k * 6 + 4]!,
        dbr: modeList.values[k * 6 + 5]!,
      });
    }
  }

  return {
    za: head.za,
    awr: head.awr,
    lis: head.l1,
    liso: head.l2,
    nst,
    halfLife: hlList.c1,
    halfLifeUnc: hlList.c2,
    averageEnergies: hlList.values,
    spin,
    parity,
    decayModes,
    line: head.line,
  };
}

/**
 * Parses an 80-column ENDF-6 tape string into a structured `Endf6Tape`.
 */
export function parseEndf6Tape(source: string): Endf6Tape {
  const rawLines = source.split(/\r?\n/);
  const cards: Endf6Card[] = [];
  const parseErrors: Endf6ParseError[] = [];

  let offset = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const lineLen = raw.length;
    const startOffset = offset;
    const endOffset = offset + lineLen;
    // Account for \n (or \r\n approximate)
    offset = endOffset + 1;

    if (raw.trim().length === 0) continue;

    if (lineLen > 80) {
      parseErrors.push({
        line: i + 1,
        message: `Card exceeds 80 columns (${lineLen} columns)`,
      });
    }

    const card = parseEndf6Card(raw, i + 1, startOffset, endOffset);
    if (!Number.isFinite(card.mat) || !Number.isFinite(card.mf) || !Number.isFinite(card.mt)) {
      parseErrors.push({
        line: i + 1,
        message: `Malformed MAT/MF/MT control columns (cols 67–75)`,
      });
    }
    cards.push(card);
  }

  let tpid = "";
  let startIdx = 0;
  if (cards.length > 0) {
    const first = cards[0]!;
    // TPID card has MF=0, MT=0 and MAT >= 0 (commonly MAT=1 or MAT=0 with non-empty text)
    if (first.mf === 0 && first.mt === 0 && first.mat >= 0 && first.raw.slice(0, 66).trim().length > 0) {
      tpid = first.raw.slice(0, 66).trim();
      startIdx = 1;
    }
  }

  const materials = new Map<number, Endf6Material>();
  let hasTend = false;
  let currentSection: Endf6Section | null = null;
  let currentMat: Endf6Material | null = null;
  let lastActiveMf = 0;

  const ensureMaterial = (card: Endf6Card): Endf6Material => {
    let mat = materials.get(card.mat);
    if (!mat) {
      mat = {
        mat: card.mat,
        za: 0,
        awr: 0,
        name: `MAT ${card.mat}`,
        resonances: [],
        crossSections: new Map(),
        sections: [],
        terminatedFiles: new Set(),
        presentFiles: new Set(),
        hasMend: false,
        startLine: card.line,
        endLine: card.line,
        startOffset: card.startOffset,
        endOffset: card.endOffset,
      };
      materials.set(card.mat, mat);
    }
    mat.endLine = card.line;
    mat.endOffset = card.endOffset;
    return mat;
  };

  const finalizeSection = (sec: Endf6Section, mat: Endf6Material): void => {
    if (sec.cards.length > 0) {
      sec.head = readHeadRecord(sec.cards[0]!);
      if (mat.za === 0 && Number.isFinite(sec.head.za) && sec.head.za > 0) {
        mat.za = sec.head.za;
        mat.name = zaToNuclideName(sec.head.za);
      }
      if (mat.awr === 0 && Number.isFinite(sec.head.awr) && sec.head.awr > 0) {
        mat.awr = sec.head.awr;
      }
    }
    mat.sections.push(sec);

    if (sec.mf === 1 && sec.mt === 451) {
      const desc = decodeMf1Mt451(sec);
      if (desc) {
        mat.description = desc;
        if (desc.za > 0) {
          mat.za = desc.za;
          mat.name = zaToNuclideName(desc.za);
        }
        if (desc.awr > 0) {
          mat.awr = desc.awr;
        }
      }
    } else if (sec.mf === 2 && sec.mt === 151) {
      const ranges = decodeMf2Mt151(sec);
      mat.resonances.push(...ranges);
    } else if (sec.mf === 3 && sec.mt > 0) {
      const xs = decodeMf3Section(sec);
      if (xs) {
        mat.crossSections.set(sec.mt, xs);
      }
    } else if (sec.mf === 8 && sec.mt === 457) {
      const decay = decodeMf8Mt457(sec);
      if (decay) {
        mat.decay = decay;
      }
    }
  };

  for (let i = startIdx; i < cards.length; i++) {
    const card = cards[i]!;

    if (card.terminator === "TEND") {
      if (currentSection && currentMat) {
        finalizeSection(currentSection, currentMat);
        currentSection = null;
      }
      hasTend = true;
      break;
    }

    if (card.terminator === "MEND") {
      if (currentSection && currentMat) {
        finalizeSection(currentSection, currentMat);
        currentSection = null;
      }
      if (currentMat) {
        currentMat.hasMend = true;
        currentMat.endLine = card.line;
        currentMat.endOffset = card.endOffset;
        currentMat = null;
      }
      lastActiveMf = 0;
      continue;
    }

    if (card.terminator === "FEND") {
      if (currentSection && currentMat) {
        finalizeSection(currentSection, currentMat);
        currentSection = null;
      }
      const mat = ensureMaterial(card);
      currentMat = mat;
      if (lastActiveMf > 0) {
        mat.terminatedFiles.add(lastActiveMf);
      }
      lastActiveMf = 0;
      continue;
    }

    if (card.terminator === "SEND") {
      if (currentSection && currentMat && currentSection.mat === card.mat && currentSection.mf === card.mf) {
        currentSection.hasSend = true;
        currentSection.endLine = card.line;
        currentSection.endOffset = card.endOffset;
        finalizeSection(currentSection, currentMat);
        currentSection = null;
      }
      continue;
    }

    if (!Number.isFinite(card.mat) || !Number.isFinite(card.mf) || !Number.isFinite(card.mt)) {
      continue;
    }

    const mat = ensureMaterial(card);
    currentMat = mat;
    if (card.mf > 0) {
      mat.presentFiles.add(card.mf);
      lastActiveMf = card.mf;
    }

    if (
      !currentSection ||
      currentSection.mat !== card.mat ||
      currentSection.mf !== card.mf ||
      currentSection.mt !== card.mt
    ) {
      if (currentSection) {
        const prevMat = materials.get(currentSection.mat) ?? mat;
        finalizeSection(currentSection, prevMat);
      }
      currentSection = {
        mat: card.mat,
        mf: card.mf,
        mt: card.mt,
        startLine: card.line,
        endLine: card.line,
        startOffset: card.startOffset,
        endOffset: card.endOffset,
        cards: [card],
        hasSend: false,
      };
    } else {
      currentSection.cards.push(card);
      currentSection.endLine = card.line;
      currentSection.endOffset = card.endOffset;
    }
  }

  if (currentSection && currentMat) {
    finalizeSection(currentSection, currentMat);
  }

  return {
    tpid,
    materials,
    cards,
    hasTend,
    parseErrors,
  };
}
