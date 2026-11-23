// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  LsDynaBoundarySpc,
  LsDynaCurve,
  LsDynaDeck,
  LsDynaElement,
  LsDynaElementKind,
  LsDynaInitialVelocity,
  LsDynaLoadNodePoint,
  LsDynaMaterial,
  LsDynaMaterialType,
  LsDynaNode,
  LsDynaNodeSet,
  LsDynaPart,
  LsDynaSection,
  LsDynaSectionKind,
} from "../types.js";

/**
 * Parses a numeric field supporting standard floating point, Fortran `D` exponents,
 * and exponent-without-E notation (e.g., `1.0-5` -> `1.0e-5`).
 */
export function parseLsDynaNumber(raw: string | undefined, defaultValue = 0): number {
  if (raw === undefined) return defaultValue;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return defaultValue;
  // Normalize Fortran D/d exponent and shorthand signed exponents like 1.5-3 -> 1.5e-3
  const normalized = trimmed.replace(/[dD]/g, "e").replace(/([0-9.])([+-][0-9]+)$/, "$1e$2");
  const val = Number(normalized);
  return Number.isFinite(val) ? val : Number.NaN;
}

/**
 * Parses an integer field.
 */
export function parseLsDynaInt(raw: string | undefined, defaultValue = 0): number {
  const val = parseLsDynaNumber(raw, defaultValue);
  return Number.isFinite(val) ? Math.trunc(val) : Number.NaN;
}

/**
 * Splits a fixed-width card line into fields according to the provided column widths.
 */
function sliceFixedColumns(line: string, widths: number[]): string[] {
  const fields: string[] = [];
  let pos = 0;
  for (const w of widths) {
    if (pos >= line.length) {
      fields.push("");
    } else {
      fields.push(line.slice(pos, pos + w).trim());
    }
    pos += w;
  }
  return fields;
}

/**
 * Checks if any non-empty field contains internal whitespace (indicating a misaligned fixed-width slice).
 */
function hasInternalWhitespace(fields: string[]): boolean {
  for (const f of fields) {
    if (f.length > 0 && /\s/.test(f)) return true;
  }
  return false;
}

/**
 * Splits an LS-DYNA data card line into fields.
 * Supports comma-delimited free format, 10-character fixed-column format,
 * and custom column widths (such as 8/16/16/16/8/8 for *NODE).
 */
export function splitLsDynaCard(line: string, widths: number[] = [10, 10, 10, 10, 10, 10, 10, 10]): string[] {
  if (line.includes(",")) {
    return line.split(",").map((s) => s.trim());
  }
  const fixed = sliceFixedColumns(line, widths);
  if (!hasInternalWhitespace(fixed)) {
    return fixed;
  }
  // Try standard 10-char fixed columns if custom widths had internal whitespace
  const fixed10 = sliceFixedColumns(line, [10, 10, 10, 10, 10, 10, 10, 10]);
  if (!hasInternalWhitespace(fixed10)) {
    return fixed10;
  }
  // Fallback to whitespace-delimited tokens
  return line.trim().split(/\s+/);
}

interface RawLine {
  text: string;
  line: number; // 1-indexed
  offset: number;
}

function normalizeKeyword(line: string): string {
  // Strip leading '*', trim, uppercase, strip trailing comments/whitespace
  const body = line.trim().slice(1).trim();
  const firstToken = body.split(/[\s,]/)[0] ?? "";
  return firstToken.toUpperCase();
}

function mapMaterialKeyword(kw: string): LsDynaMaterialType | undefined {
  if (kw === "MAT_ELASTIC" || kw === "MAT_001" || kw === "MAT_ELASTIC_TITLE") {
    return "MAT_ELASTIC";
  }
  if (kw === "MAT_PLASTIC_KINEMATIC" || kw === "MAT_003" || kw === "MAT_PLASTIC_KINEMATIC_TITLE") {
    return "MAT_PLASTIC_KINEMATIC";
  }
  if (kw === "MAT_RIGID" || kw === "MAT_020" || kw === "MAT_RIGID_TITLE") {
    return "MAT_RIGID";
  }
  if (kw === "MAT_PIECEWISE_LINEAR_PLASTICITY" || kw === "MAT_024" || kw === "MAT_PIECEWISE_LINEAR_PLASTICITY_TITLE") {
    return "MAT_PIECEWISE_LINEAR_PLASTICITY";
  }
  return undefined;
}

/**
 * Parses an LS-DYNA / DYNA3D `.k` explicit dynamics keyword deck (both 10-character
 * fixed-column and comma-delimited free-format cards) into a structured `LsDynaDeck`.
 */
export function parseLsDynaDeck(source: string): LsDynaDeck {
  const deck: LsDynaDeck = {
    title: "Untitled",
    hasKeywordHeader: false,
    hasEndCard: false,
    nodes: new Map<number, LsDynaNode>(),
    elements: new Map<number, LsDynaElement>(),
    parts: new Map<number, LsDynaPart>(),
    sections: new Map<number, LsDynaSection>(),
    materials: new Map<number, LsDynaMaterial>(),
    boundaries: [],
    initialVelocities: [],
    loads: [],
    curves: new Map<number, LsDynaCurve>(),
    nodeSets: new Map<number, LsDynaNodeSet>(),
    keywordsFound: [],
    duplicates: [],
    parseErrors: [],
  };

  // Pre-split lines with byte/char offsets, filtering out `$` comments and blank lines
  const rawLines = source.split(/\r?\n/);
  const lines: RawLine[] = [];
  let offset = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const text = rawLines[i] ?? "";
    const trimmed = text.trim();
    if (trimmed.length > 0 && !trimmed.startsWith("$")) {
      lines.push({ text, line: i + 1, offset });
    }
    offset += text.length + 1;
  }

  let idx = 0;
  while (idx < lines.length) {
    const current = lines[idx]!;
    const trimmed = current.text.trim();

    if (!trimmed.startsWith("*")) {
      deck.parseErrors.push({
        message: `Unexpected data card outside keyword section: '${trimmed.slice(0, 40)}'`,
        line: current.line,
        column: 1,
      });
      idx++;
      continue;
    }

    const kw = normalizeKeyword(trimmed);
    const kwLine = current.line;
    const kwOffset = current.offset;
    deck.keywordsFound.push(kw);
    idx++;

    // Collect data lines until next '*' keyword
    const cardLines: RawLine[] = [];
    while (idx < lines.length && !lines[idx]!.text.trim().startsWith("*")) {
      cardLines.push(lines[idx]!);
      idx++;
    }

    if (kw === "KEYWORD" || kw.startsWith("KEYWORD_")) {
      deck.hasKeywordHeader = true;
      continue;
    }

    if (kw === "END") {
      deck.hasEndCard = true;
      break;
    }

    if (kw === "TITLE") {
      if (cardLines.length > 0) {
        deck.title = cardLines[0]!.text.trim();
      }
      continue;
    }

    if (kw === "NODE") {
      for (const cl of cardLines) {
        // LS-DYNA *NODE uses (8, 16, 16, 16, 8, 8) or 10-char fixed or comma-delimited
        const f = splitLsDynaCard(cl.text, [8, 16, 16, 16, 8, 8]);
        const nid = parseLsDynaInt(f[0], Number.NaN);
        const x = parseLsDynaNumber(f[1], 0);
        const y = parseLsDynaNumber(f[2], 0);
        const z = parseLsDynaNumber(f[3], 0);
        const tc = parseLsDynaInt(f[4], 0);
        const rc = parseLsDynaInt(f[5], 0);

        if (!Number.isFinite(nid) || Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
          deck.parseErrors.push({
            message: `Invalid *NODE card: '${cl.text.trim()}'`,
            line: cl.line,
            column: 1,
            keyword: kw,
          });
          continue;
        }
        if (deck.nodes.has(nid)) {
          deck.duplicates.push({ kind: "node", id: nid, line: cl.line });
        }
        deck.nodes.set(nid, {
          nid,
          x,
          y,
          z,
          tc: Number.isFinite(tc) ? tc : 0,
          rc: Number.isFinite(rc) ? rc : 0,
          loc: { line: cl.line, column: 1, startOffset: cl.offset, endOffset: cl.offset + cl.text.length },
        });
      }
      continue;
    }

    if (kw === "ELEMENT_SOLID" || kw === "ELEMENT_SHELL" || kw === "ELEMENT_BEAM") {
      const kind: LsDynaElementKind = kw === "ELEMENT_SOLID" ? "SOLID" : kw === "ELEMENT_SHELL" ? "SHELL" : "BEAM";
      const widths = [8, 8, 8, 8, 8, 8, 8, 8, 8, 8];
      for (const cl of cardLines) {
        const f = splitLsDynaCard(cl.text, widths);
        const eid = parseLsDynaInt(f[0], Number.NaN);
        const pid = parseLsDynaInt(f[1], Number.NaN);
        if (!Number.isFinite(eid) || !Number.isFinite(pid)) {
          deck.parseErrors.push({
            message: `Invalid *${kw} card: '${cl.text.trim()}'`,
            line: cl.line,
            column: 1,
            keyword: kw,
          });
          continue;
        }
        const nodes: number[] = [];
        for (let k = 2; k < f.length; k++) {
          const raw = f[k];
          if (raw && raw.length > 0) {
            const n = parseLsDynaInt(raw, Number.NaN);
            if (Number.isFinite(n) && n > 0) {
              nodes.push(n);
            }
          }
        }
        if (deck.elements.has(eid)) {
          deck.duplicates.push({ kind: "element", id: eid, line: cl.line });
        }
        deck.elements.set(eid, {
          eid,
          pid,
          kind,
          nodes,
          loc: { line: cl.line, column: 1, startOffset: cl.offset, endOffset: cl.offset + cl.text.length },
        });
      }
      continue;
    }

    if (kw === "PART") {
      // *PART comes in pairs of cards: Card 1 = title, Card 2 = pid, secid, mid, eosid, hgid, grav, adpopt, tmid
      for (let i = 0; i + 1 < cardLines.length; i += 2) {
        const titleLine = cardLines[i]!;
        const dataLine = cardLines[i + 1]!;
        const f = splitLsDynaCard(dataLine.text);
        const pid = parseLsDynaInt(f[0], Number.NaN);
        const secid = parseLsDynaInt(f[1], 0);
        const mid = parseLsDynaInt(f[2], 0);
        if (!Number.isFinite(pid)) {
          deck.parseErrors.push({
            message: `Invalid *PART data card: '${dataLine.text.trim()}'`,
            line: dataLine.line,
            column: 1,
            keyword: kw,
          });
          continue;
        }
        if (deck.parts.has(pid)) {
          deck.duplicates.push({ kind: "part", id: pid, line: dataLine.line });
        }
        deck.parts.set(pid, {
          pid,
          title: titleLine.text.trim(),
          secid,
          mid,
          eosid: parseLsDynaInt(f[3], 0),
          hgid: parseLsDynaInt(f[4], 0),
          grav: parseLsDynaInt(f[5], 0),
          adpopt: parseLsDynaInt(f[6], 0),
          tmid: parseLsDynaInt(f[7], 0),
          loc: {
            line: titleLine.line,
            column: 1,
            startOffset: titleLine.offset,
            endOffset: dataLine.offset + dataLine.text.length,
          },
        });
      }
      continue;
    }

    if (kw === "SECTION_SOLID" || kw === "SECTION_SHELL" || kw === "SECTION_BEAM") {
      const kind: LsDynaSectionKind = kw === "SECTION_SOLID" ? "SOLID" : kw === "SECTION_SHELL" ? "SHELL" : "BEAM";
      if (cardLines.length === 0) {
        deck.parseErrors.push({
          message: `Empty *${kw} block`,
          line: kwLine,
          column: 1,
          keyword: kw,
        });
        continue;
      }
      const c1 = splitLsDynaCard(cardLines[0]!.text);
      const secid = parseLsDynaInt(c1[0], Number.NaN);
      const elform = parseLsDynaInt(c1[1], 1);
      if (!Number.isFinite(secid)) {
        deck.parseErrors.push({
          message: `Invalid *${kw} section ID: '${cardLines[0]!.text.trim()}'`,
          line: cardLines[0]!.line,
          column: 1,
          keyword: kw,
        });
        continue;
      }
      const sec: LsDynaSection = {
        secid,
        kind,
        elform,
        loc: {
          line: cardLines[0]!.line,
          column: 1,
          startOffset: kwOffset,
          endOffset: cardLines[cardLines.length - 1]!.offset + cardLines[cardLines.length - 1]!.text.length,
        },
      };
      if (kind === "SHELL") {
        sec.shrf = parseLsDynaNumber(c1[2], 1.0);
        sec.nip = parseLsDynaInt(c1[3], 2);
        if (cardLines.length >= 2) {
          const c2 = splitLsDynaCard(cardLines[1]!.text);
          sec.thickness = parseLsDynaNumber(c2[0], 0.01);
        }
      } else if (kind === "BEAM") {
        sec.shrf = parseLsDynaNumber(c1[2], 1.0);
        if (cardLines.length >= 2) {
          const c2 = splitLsDynaCard(cardLines[1]!.text);
          // Card 2: For ELFORM=3 (truss) or ELFORM=1 (Hughes-Liu): A or TS1, TS2, TT1, TT2
          const v0 = parseLsDynaNumber(c2[0], 0);
          const v1 = parseLsDynaNumber(c2[1], 0);
          if (elform === 3 || (v0 > 0 && v1 === 0)) {
            sec.area = v0;
          } else {
            // Rectangular cross section TS1 x TT1 or explicit area
            const tt1 = parseLsDynaNumber(c2[2], v0);
            sec.area = v0 > 0 && tt1 > 0 ? v0 * tt1 : v0;
            sec.iss = v0 > 0 && tt1 > 0 ? (v0 * Math.pow(tt1, 3)) / 12 : undefined;
            sec.itt = v0 > 0 && tt1 > 0 ? (tt1 * Math.pow(v0, 3)) / 12 : undefined;
          }
        }
      }
      if (deck.sections.has(secid)) {
        deck.duplicates.push({ kind: "section", id: secid, line: cardLines[0]!.line });
      }
      deck.sections.set(secid, sec);
      continue;
    }

    const matType = mapMaterialKeyword(kw);
    if (matType) {
      const hasTitleCard = kw.endsWith("_TITLE");
      const dataIdx = hasTitleCard ? 1 : 0;
      if (cardLines.length <= dataIdx) {
        deck.parseErrors.push({
          message: `Missing data card in *${kw}`,
          line: kwLine,
          column: 1,
          keyword: kw,
        });
        continue;
      }
      const c1 = splitLsDynaCard(cardLines[dataIdx]!.text);
      const mid = parseLsDynaInt(c1[0], Number.NaN);
      const ro = parseLsDynaNumber(c1[1], Number.NaN);
      const e = parseLsDynaNumber(c1[2], Number.NaN);
      const pr = parseLsDynaNumber(c1[3], Number.NaN);
      if (!Number.isFinite(mid)) {
        deck.parseErrors.push({
          message: `Invalid material ID in *${kw}: '${cardLines[dataIdx]!.text.trim()}'`,
          line: cardLines[dataIdx]!.line,
          column: 1,
          keyword: kw,
        });
        continue;
      }
      const mat: LsDynaMaterial = {
        mid,
        type: matType,
        ro: Number.isNaN(ro) ? 0 : ro,
        e: Number.isNaN(e) ? 0 : e,
        pr: Number.isNaN(pr) ? 0 : pr,
        loc: {
          line: cardLines[dataIdx]!.line,
          column: 1,
          startOffset: kwOffset,
          endOffset: cardLines[cardLines.length - 1]!.offset + cardLines[cardLines.length - 1]!.text.length,
        },
      };
      if (matType === "MAT_PLASTIC_KINEMATIC" || matType === "MAT_PIECEWISE_LINEAR_PLASTICITY") {
        mat.sigy = parseLsDynaNumber(c1[4], 0);
        mat.etan = parseLsDynaNumber(c1[5], 0);
        mat.beta = parseLsDynaNumber(c1[6], 0);
        if (cardLines.length > dataIdx + 1) {
          const c2 = splitLsDynaCard(cardLines[dataIdx + 1]!.text);
          mat.src = parseLsDynaNumber(c2[0], 0);
          mat.srp = parseLsDynaNumber(c2[1], 0);
          mat.fs = parseLsDynaNumber(c2[2], 0);
        }
      } else if (matType === "MAT_RIGID") {
        if (cardLines.length > dataIdx + 1) {
          const c2 = splitLsDynaCard(cardLines[dataIdx + 1]!.text);
          mat.cmo = parseLsDynaNumber(c2[0], 0);
          mat.con1 = parseLsDynaInt(c2[1], 0);
          mat.con2 = parseLsDynaInt(c2[2], 0);
        }
      }
      if (deck.materials.has(mid)) {
        deck.duplicates.push({ kind: "material", id: mid, line: cardLines[dataIdx]!.line });
      }
      deck.materials.set(mid, mat);
      continue;
    }

    if (kw === "BOUNDARY_SPC_NODE" || kw === "BOUNDARY_SPC_SET") {
      const targetType = kw === "BOUNDARY_SPC_NODE" ? "NODE" : "SET";
      for (const cl of cardLines) {
        const f = splitLsDynaCard(cl.text);
        const targetId = parseLsDynaInt(f[0], Number.NaN);
        if (!Number.isFinite(targetId)) {
          deck.parseErrors.push({
            message: `Invalid *${kw} card: '${cl.text.trim()}'`,
            line: cl.line,
            column: 1,
            keyword: kw,
          });
          continue;
        }
        const spc: LsDynaBoundarySpc = {
          targetType,
          targetId,
          cid: parseLsDynaInt(f[1], 0),
          dofx: parseLsDynaInt(f[2], 0) !== 0,
          dofy: parseLsDynaInt(f[3], 0) !== 0,
          dofz: parseLsDynaInt(f[4], 0) !== 0,
          dofrx: parseLsDynaInt(f[5], 0) !== 0,
          dofry: parseLsDynaInt(f[6], 0) !== 0,
          dofrz: parseLsDynaInt(f[7], 0) !== 0,
          loc: { line: cl.line, column: 1, startOffset: cl.offset, endOffset: cl.offset + cl.text.length },
        };
        deck.boundaries.push(spc);
      }
      continue;
    }

    if (kw === "INITIAL_VELOCITY") {
      // Card 1: nsid, nsidex, boxid, irigid, icid
      // Card 2: vx, vy, vz, vxr, vyr, vzr
      for (let i = 0; i + 1 < cardLines.length; i += 2) {
        const c1 = splitLsDynaCard(cardLines[i]!.text);
        const c2 = splitLsDynaCard(cardLines[i + 1]!.text);
        const iv: LsDynaInitialVelocity = {
          nsid: parseLsDynaInt(c1[0], 0),
          nsidex: parseLsDynaInt(c1[1], 0),
          boxid: parseLsDynaInt(c1[2], 0),
          vx: parseLsDynaNumber(c2[0], 0),
          vy: parseLsDynaNumber(c2[1], 0),
          vz: parseLsDynaNumber(c2[2], 0),
          vxr: parseLsDynaNumber(c2[3], 0),
          vyr: parseLsDynaNumber(c2[4], 0),
          vzr: parseLsDynaNumber(c2[5], 0),
          loc: {
            line: cardLines[i]!.line,
            column: 1,
            startOffset: cardLines[i]!.offset,
            endOffset: cardLines[i + 1]!.offset + cardLines[i + 1]!.text.length,
          },
        };
        deck.initialVelocities.push(iv);
      }
      continue;
    }

    if (kw === "LOAD_NODE_POINT") {
      for (const cl of cardLines) {
        const f = splitLsDynaCard(cl.text);
        const nid = parseLsDynaInt(f[0], Number.NaN);
        const dof = parseLsDynaInt(f[1], 1);
        const lcid = parseLsDynaInt(f[2], 0);
        const sf = parseLsDynaNumber(f[3], 1.0);
        if (!Number.isFinite(nid)) {
          deck.parseErrors.push({
            message: `Invalid *LOAD_NODE_POINT card: '${cl.text.trim()}'`,
            line: cl.line,
            column: 1,
            keyword: kw,
          });
          continue;
        }
        const load: LsDynaLoadNodePoint = {
          nid,
          dof,
          lcid,
          sf,
          cid: parseLsDynaInt(f[4], 0),
          m1: parseLsDynaInt(f[5], 0),
          m2: parseLsDynaInt(f[6], 0),
          m3: parseLsDynaInt(f[7], 0),
          loc: { line: cl.line, column: 1, startOffset: cl.offset, endOffset: cl.offset + cl.text.length },
        };
        deck.loads.push(load);
      }
      continue;
    }

    if (kw === "DEFINE_CURVE") {
      if (cardLines.length === 0) continue;
      const c1 = splitLsDynaCard(cardLines[0]!.text);
      const lcid = parseLsDynaInt(c1[0], Number.NaN);
      if (!Number.isFinite(lcid)) {
        deck.parseErrors.push({
          message: `Invalid *DEFINE_CURVE header: '${cardLines[0]!.text.trim()}'`,
          line: cardLines[0]!.line,
          column: 1,
          keyword: kw,
        });
        continue;
      }
      const curve: LsDynaCurve = {
        lcid,
        sidr: parseLsDynaInt(c1[1], 0),
        sfa: parseLsDynaNumber(c1[2], 1.0) || 1.0,
        sfo: parseLsDynaNumber(c1[3], 1.0) || 1.0,
        offa: parseLsDynaNumber(c1[4], 0),
        offo: parseLsDynaNumber(c1[5], 0),
        points: [],
        loc: { line: cardLines[0]!.line, column: 1, startOffset: kwOffset },
      };
      for (let i = 1; i < cardLines.length; i++) {
        const pt = splitLsDynaCard(cardLines[i]!.text, [20, 20]);
        const a1 = parseLsDynaNumber(pt[0], Number.NaN);
        const o1 = parseLsDynaNumber(pt[1], Number.NaN);
        if (Number.isFinite(a1) && Number.isFinite(o1)) {
          curve.points.push({ abscissa: a1, ordinate: o1 });
        }
      }
      deck.curves.set(lcid, curve);
      continue;
    }

    if (kw === "SET_NODE_LIST") {
      if (cardLines.length === 0) continue;
      const c1 = splitLsDynaCard(cardLines[0]!.text);
      const sid = parseLsDynaInt(c1[0], Number.NaN);
      if (!Number.isFinite(sid)) {
        deck.parseErrors.push({
          message: `Invalid *SET_NODE_LIST header: '${cardLines[0]!.text.trim()}'`,
          line: cardLines[0]!.line,
          column: 1,
          keyword: kw,
        });
        continue;
      }
      const nodeIds: number[] = [];
      for (let i = 1; i < cardLines.length; i++) {
        const f = splitLsDynaCard(cardLines[i]!.text);
        for (const tok of f) {
          if (tok.length > 0) {
            const nid = parseLsDynaInt(tok, Number.NaN);
            if (Number.isFinite(nid) && nid > 0) {
              nodeIds.push(nid);
            }
          }
        }
      }
      const set: LsDynaNodeSet = {
        sid,
        nodes: nodeIds,
        loc: { line: cardLines[0]!.line, column: 1, startOffset: kwOffset },
      };
      deck.nodeSets.set(sid, set);
      continue;
    }

    if (kw === "CONTROL_TERMINATION") {
      if (cardLines.length > 0) {
        const f = splitLsDynaCard(cardLines[0]!.text);
        deck.controlTermination = {
          endtim: parseLsDynaNumber(f[0], 0),
          endcyc: parseLsDynaInt(f[1], 0),
          dtmin: parseLsDynaNumber(f[2], 0),
          endeng: parseLsDynaNumber(f[3], 0),
          endmas: parseLsDynaNumber(f[4], 0),
          loc: { line: cardLines[0]!.line, column: 1, startOffset: kwOffset },
        };
      }
      continue;
    }

    if (kw === "CONTROL_TIMESTEP") {
      if (cardLines.length > 0) {
        const f = splitLsDynaCard(cardLines[0]!.text);
        deck.controlTimestep = {
          dtinit: parseLsDynaNumber(f[0], 0),
          tssfac: parseLsDynaNumber(f[1], 0.9) || 0.9,
          isdo: parseLsDynaInt(f[2], 0),
          tslimt: parseLsDynaNumber(f[3], 0),
          dt2ms: parseLsDynaNumber(f[4], 0),
          lctm: parseLsDynaInt(f[5], 0),
          erode: parseLsDynaInt(f[6], 0),
          ms1st: parseLsDynaInt(f[7], 0),
          loc: { line: cardLines[0]!.line, column: 1, startOffset: kwOffset },
        };
      }
      continue;
    }

    if (kw === "DATABASE_GLSTAT") {
      if (cardLines.length > 0) {
        const f = splitLsDynaCard(cardLines[0]!.text);
        deck.databaseGlstat = {
          dt: parseLsDynaNumber(f[0], 0),
          binary: parseLsDynaInt(f[1], 0),
          lcur: parseLsDynaInt(f[2], 0),
          ioopt: parseLsDynaInt(f[3], 1),
          loc: { line: cardLines[0]!.line, column: 1, startOffset: kwOffset },
        };
      }
      continue;
    }
  }

  return deck;
}
