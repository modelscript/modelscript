// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable react-refresh/only-export-components */

import {
  compileAssemblyScriptDyrInWorker,
  lintPsse,
  loadFmuForPsse,
  parseDyr,
  parseRaw,
  parseSeq,
  simulatePsseTransient,
  solvePowerFlowAsync,
  type PsseDiagnostic,
  type PsseDynamicModelIO,
  type PsseLinkedDynamicInstance,
  type PsseTransientResult,
} from "@modelscript/psse";
import React, { useMemo, useRef, useState } from "react";
import { InspectorTabs } from "./InspectorTabs.js";

const CsvViewer = React.lazy(() => import("../../../artifacts/CsvViewer.js").then((m) => ({ default: m.CsvViewer })));

export interface PowerGridInspectorProps {
  code: string;
  lines: string[];
  colorMode: "dark" | "light";
  dialect?: string | undefined;
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
}

export interface GridBus {
  id: string;
  name: string;
  baseKv: number;
  vmPu: number;
  vaDeg: number;
  pInjMw: number;
  bShuntPu: number;
  line: number;
}

export interface GridBranch {
  id: string;
  from: string;
  to: string;
  kind: string;
  r: number;
  x: number;
  bHalf: number;
  gPu: number;
  bPu: number;
  rateMva: number;
  flowMw: number;
  loadingPct: number;
  line: number;
}

export interface GridMode {
  name: string;
  sigma: number;
  omegaRad: number;
  freqHz: number;
  dampingPct: number;
  source: string;
  line: number;
}

export interface PowerGridSummary {
  buses: GridBus[];
  branches: GridBranch[];
  yBusEntries: Array<{ row: string; col: string; g: number; b: number; isDiag: boolean; line: number }>;
  eigenmodes: GridMode[];
  diagnostics?: PsseDiagnostic[] | undefined;
}

export function analyzePowerGrid(code: string, lines: string[]): PowerGridSummary {
  const busMap = new Map<string, GridBus>();
  const branches: GridBranch[] = [];
  const lumpedL: Array<{ name: string; valH: number; n1: string; n2: string; line: number }> = [];
  const lumpedC: Array<{ name: string; valF: number; n1: string; n2: string; line: number }> = [];
  const lumpedR = new Map<string, number>();
  const genInertias: Array<{ name: string; hSec: number; xDp: number; line: number }> = [];

  const parseEng = (raw: string): number => {
    const m = /^([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)([TGMkmunpf]|meg)?/i.exec(raw.trim());
    if (!m) return NaN;
    const base = Number(m[1]);
    const suf = (m[2] ?? "").toLowerCase();
    const mult: Record<string, number> = {
      t: 1e12,
      g: 1e9,
      meg: 1e6,
      k: 1e3,
      m: 1e-3,
      u: 1e-6,
      n: 1e-9,
      p: 1e-12,
      f: 1e-15,
    };
    return base * (mult[suf] ?? 1);
  };

  const ensureBus = (id: string, line: number, patch?: Partial<GridBus>): GridBus => {
    const key = id.trim();
    const existing = busMap.get(key);
    if (existing) {
      if (patch) Object.assign(existing, patch);
      return existing;
    }
    const created: GridBus = {
      id: key,
      name: patch?.name ?? `Node_${key}`,
      baseKv: patch?.baseKv ?? 138,
      vmPu: patch?.vmPu ?? 1.0,
      vaDeg: patch?.vaDeg ?? 0.0,
      pInjMw: patch?.pInjMw ?? 0.0,
      bShuntPu: patch?.bShuntPu ?? 0.0,
      line,
    };
    busMap.set(key, created);
    return created;
  };

  let psseDiagnostics: PsseDiagnostic[] | undefined;
  const hasPsseHeaders = /BEGIN\s+BUS\s+DATA|0\s*\/.*PSS|0,\s*[\d.]+,\s*3[0-5]/i.test(code);
  if (hasPsseHeaders) {
    try {
      const psseCase = parseRaw(code);
      if (psseCase.buses.size > 0) {
        for (const b of psseCase.buses.values()) {
          ensureBus(String(b.i), b.span?.line ?? 1, {
            name: b.name || `Bus_${b.i}`,
            baseKv: b.baseKv || 138,
            vmPu: b.vm || 1.0,
            vaDeg: b.va || 0.0,
          });
        }
        for (const l of psseCase.loads) {
          ensureBus(String(l.i), l.span?.line ?? 1).pInjMw -= l.pl;
        }
        for (const g of psseCase.generators) {
          ensureBus(String(g.i), g.span?.line ?? 1).pInjMw += g.pg;
          genInertias.push({ name: `Gen@${g.i}`, hSec: 4.5, xDp: 0.25, line: g.span?.line ?? 1 });
        }
        for (const br of psseCase.branches) {
          const from = String(br.i);
          const to = String(br.j);
          const r = br.r || 0.005;
          const x = br.x || 0.05;
          const denom = r * r + x * x || 1e-9;
          ensureBus(from, br.span?.line ?? 1);
          ensureBus(to, br.span?.line ?? 1);
          branches.push({
            id: `L_${from}_${to}_${br.ckt || branches.length + 1}`,
            from,
            to,
            kind: "AC Line",
            r,
            x,
            bHalf: (br.b || 0) * 0.5,
            gPu: r / denom,
            bPu: -x / denom,
            rateMva: br.rateA || 100,
            flowMw: 0,
            loadingPct: 0,
            line: br.span?.line ?? 1,
          });
        }
        for (const tr of psseCase.transformers) {
          const from = String(tr.i);
          const to = String(tr.j);
          const r = tr.r12 || 0.002;
          const x = tr.x12 || 0.05;
          const denom = r * r + x * x || 1e-9;
          ensureBus(from, tr.span?.line ?? 1);
          ensureBus(to, tr.span?.line ?? 1);
          branches.push({
            id: `XFR_${from}_${to}_${tr.ckt || branches.length + 1}`,
            from,
            to,
            kind: tr.k && tr.k !== 0 ? "3W Transformer" : "2W Transformer",
            r,
            x,
            bHalf: 0,
            gPu: r / denom,
            bPu: -x / denom,
            rateMva: tr.rata1 || 100,
            flowMw: 0,
            loadingPct: 0,
            line: tr.span?.line ?? 1,
          });
        }
        psseDiagnostics = lintPsse(psseCase);
      }
    } catch {
      // Fall back to line-by-line scanner for partial/non-RAW inputs
    }
  }

  let psseSection: "bus" | "load" | "gen" | "branch" | "other" = "other";
  if (hasPsseHeaders && busMap.size === 0) psseSection = "bus";

  for (let i = 0; i < lines.length && !(hasPsseHeaders && busMap.size > 0); i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("!") || trimmed.startsWith("*")) continue;

    // PSS/E section transitions
    if (/END OF BUS DATA/i.test(trimmed)) {
      psseSection = /BEGIN LOAD DATA/i.test(trimmed) ? "load" : "other";
      continue;
    }
    if (/BEGIN LOAD DATA/i.test(trimmed)) {
      psseSection = "load";
      continue;
    }
    if (/BEGIN GENERATOR DATA/i.test(trimmed)) {
      psseSection = "gen";
      continue;
    }
    if (/BEGIN BRANCH DATA/i.test(trimmed)) {
      psseSection = "branch";
      continue;
    }
    if (/END OF BRANCH DATA|BEGIN TRANSFORMER/i.test(trimmed)) {
      psseSection = "other";
      continue;
    }

    // 1. PSS/E CSV rows
    if (trimmed.includes(",") && /^\d+\s*,/.test(trimmed)) {
      const cols = trimmed.split(",").map((c) => c.trim());
      if ((psseSection === "bus" || (!hasPsseHeaders && cols[1]?.startsWith("'"))) && cols.length >= 8) {
        const id = cols[0]!;
        const name = (cols[1] ?? "").replace(/^'|'$/g, "").trim() || `Bus_${id}`;
        const baseKv = Number(cols[2]) || 138;
        const vmPu = Number(cols[7]) || 1.0;
        const vaDeg = Number(cols[8]) || 0.0;
        ensureBus(id, i + 1, { name, baseKv, vmPu, vaDeg });
        continue;
      }
      if (psseSection === "load" && cols.length >= 6) {
        const bus = ensureBus(cols[0]!, i + 1);
        bus.pInjMw -= Number(cols[5]) || 0;
        continue;
      }
      if (psseSection === "gen" && cols.length >= 3) {
        const bus = ensureBus(cols[0]!, i + 1);
        const pg = Number(cols[2]) || 0;
        bus.pInjMw += pg;
        genInertias.push({ name: `Gen@${cols[0]}`, hSec: 4.5, xDp: 0.25, line: i + 1 });
        continue;
      }
      if ((psseSection === "branch" || (!hasPsseHeaders && /^\d+$/.test(cols[1] ?? ""))) && cols.length >= 6) {
        const from = cols[0]!;
        const to = cols[1]!;
        const r = Number(cols[3]) || 0.005;
        const x = Number(cols[4]) || 0.05;
        const b = Number(cols[5]) || 0;
        const rateMva = Number(cols[6]) || 100;
        ensureBus(from, i + 1);
        ensureBus(to, i + 1);
        const denom = r * r + x * x || 1e-9;
        branches.push({
          id: `L_${from}_${to}_${branches.length + 1}`,
          from,
          to,
          kind: "AC Line",
          r,
          x,
          bHalf: b * 0.5,
          gPu: r / denom,
          bPu: -x / denom,
          rateMva,
          flowMw: 0,
          loadingPct: 0,
          line: i + 1,
        });
        continue;
      }
    }

    // 2. OpenDSS commands: New Line.L1 Bus1=A Bus2=B R1=0.02 X1=0.08 NormAmps=400
    const dssLine = /^New\s+(Line|Transformer)\.([^\s]+)\s+(.+)$/i.exec(trimmed);
    if (dssLine) {
      const kind = dssLine[1]!;
      const name = dssLine[2]!;
      const rest = dssLine[3]!;
      const bus1 = /\bbus1\s*=\s*([^\s.]+)/i.exec(rest)?.[1] ?? /\bbuses\s*=\s*\(\s*([^\s.]+)/i.exec(rest)?.[1];
      const bus2 =
        /\bbus2\s*=\s*([^\s.]+)/i.exec(rest)?.[1] ?? /\bbuses\s*=\s*\(\s*[^\s]+\s+([^\s.)]+)/i.exec(rest)?.[1];
      if (bus1 && bus2) {
        const r = Number(/\b(?:r1|r)\s*=\s*([0-9.eE+-]+)/i.exec(rest)?.[1] ?? 0.01);
        const x = Number(/\b(?:x1|xhl|x)\s*=\s*([0-9.eE+-]+)/i.exec(rest)?.[1] ?? 0.06);
        const rateMva = Number(/\b(?:kva|normamps)\s*=\s*([0-9.eE+-]+)/i.exec(rest)?.[1] ?? 100) / 1000 || 50;
        ensureBus(bus1, i + 1, { name: bus1 });
        ensureBus(bus2, i + 1, { name: bus2 });
        const denom = r * r + x * x || 1e-9;
        branches.push({
          id: name,
          from: bus1,
          to: bus2,
          kind,
          r,
          x,
          bHalf: 0,
          gPu: r / denom,
          bPu: -x / denom,
          rateMva: Math.max(1, rateMva),
          flowMw: 0,
          loadingPct: 0,
          line: i + 1,
        });
      }
      continue;
    }

    const dssLoadGen = /^New\s+(Load|Generator|Vsource)\.([^\s]+)\s+(.+)$/i.exec(trimmed);
    if (dssLoadGen) {
      const kind = dssLoadGen[1]!.toLowerCase();
      const rest = dssLoadGen[3]!;
      const busId = /\bbus1\s*=\s*([^\s.]+)/i.exec(rest)?.[1];
      const kw = Number(/\bkw\s*=\s*([0-9.eE+-]+)/i.exec(rest)?.[1] ?? 0);
      const kv = Number(/\b(?:kv|basekv)\s*=\s*([0-9.eE+-]+)/i.exec(rest)?.[1] ?? 13.8);
      const pu = Number(/\bpu\s*=\s*([0-9.eE+-]+)/i.exec(rest)?.[1] ?? 1.0);
      if (busId) {
        const b = ensureBus(busId, i + 1, { name: busId, baseKv: kv, vmPu: pu });
        b.pInjMw += kind === "load" ? -kw / 1000 : kw / 1000;
      }
      continue;
    }

    // 3. SPICE netlist elements: R1 n1 n2 10 / L1 n1 n2 1m / C1 n1 0 10u / V1 in 0 12
    const spiceElem =
      /^([RLCVI][A-Za-z0-9_]*)\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s+([0-9.+eE-]+(?:[TGMkmunpf]|meg)?)/i.exec(trimmed);
    if (spiceElem && !trimmed.startsWith(".")) {
      const elemId = spiceElem[1]!;
      const n1 = spiceElem[2]!;
      const n2 = spiceElem[3]!;
      const val = parseEng(spiceElem[4]!);
      if (!Number.isFinite(val)) continue;
      if (n1 !== "0") ensureBus(n1, i + 1, { name: n1, baseKv: 0.4 });
      if (n2 !== "0") ensureBus(n2, i + 1, { name: n2, baseKv: 0.4 });

      const kindChar = elemId[0]!.toUpperCase();
      if (kindChar === "R" && val > 0) {
        lumpedR.set(`${n1}:${n2}`, val);
        if (n1 !== "0" && n2 !== "0") {
          branches.push({
            id: elemId,
            from: n1,
            to: n2,
            kind: "Resistor",
            r: val,
            x: 0,
            bHalf: 0,
            gPu: 1 / val,
            bPu: 0,
            rateMva: 10,
            flowMw: 0,
            loadingPct: 0,
            line: i + 1,
          });
        } else {
          const active = n1 !== "0" ? n1 : n2;
          if (active !== "0") ensureBus(active, i + 1).bShuntPu += 0;
        }
      } else if (kindChar === "L" && val > 0) {
        lumpedL.push({ name: elemId, valH: val, n1, n2, line: i + 1 });
        const x60 = 2 * Math.PI * 60 * val;
        if (n1 !== "0" && n2 !== "0") {
          branches.push({
            id: elemId,
            from: n1,
            to: n2,
            kind: "Inductor",
            r: 0,
            x: x60,
            bHalf: 0,
            gPu: 0,
            bPu: -1 / x60,
            rateMva: 10,
            flowMw: 0,
            loadingPct: 0,
            line: i + 1,
          });
        }
      } else if (kindChar === "C" && val > 0) {
        lumpedC.push({ name: elemId, valF: val, n1, n2, line: i + 1 });
        const b60 = 2 * Math.PI * 60 * val;
        if (n1 !== "0") ensureBus(n1, i + 1).bShuntPu += b60;
        if (n2 !== "0") ensureBus(n2, i + 1).bShuntPu += b60;
      } else if (kindChar === "V") {
        if (n1 !== "0") ensureBus(n1, i + 1).vmPu = val || 1.0;
      }
      continue;
    }

    // 4. Verilog-A electrical declarations
    const vaElec = /^electrical\s+([^;]+);/.exec(trimmed);
    if (vaElec) {
      for (const node of vaElec[1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (node !== "gnd") ensureBus(node, i + 1, { name: node, baseKv: 0.005 });
      }
    }
  }

  const buses = Array.from(busMap.values());

  // Solve DC power flow / voltage-angle branch flows if angles or injections exist
  const busById = new Map(buses.map((b) => [b.id, b]));
  if (buses.length > 1 && branches.length > 0) {
    const anyAngle = buses.some((b) => Math.abs(b.vaDeg) > 1e-4);
    if (!anyAngle && buses.some((b) => Math.abs(b.pInjMw) > 1e-4)) {
      // Single Gauss-Jacobi sweep for phase angles θ_i (slack = buses[0])
      for (let iter = 0; iter < 25; iter++) {
        for (let bi = 1; bi < buses.length; bi++) {
          const bus = buses[bi]!;
          let sumB = 0;
          let rhs = bus.pInjMw / 100; // 100 MVA base
          for (const br of branches) {
            const bSeries = Math.abs(br.bPu) > 1e-6 ? Math.abs(br.bPu) : Math.abs(br.gPu);
            if (br.from === bus.id) {
              const nb = busById.get(br.to);
              if (nb) {
                sumB += bSeries;
                rhs += bSeries * ((nb.vaDeg * Math.PI) / 180);
              }
            } else if (br.to === bus.id) {
              const nb = busById.get(br.from);
              if (nb) {
                sumB += bSeries;
                rhs += bSeries * ((nb.vaDeg * Math.PI) / 180);
              }
            }
          }
          if (sumB > 1e-9) {
            bus.vaDeg = ((rhs / sumB) * 180) / Math.PI;
          }
        }
      }
    }

    for (const br of branches) {
      const bf = busById.get(br.from);
      const bt = busById.get(br.to);
      if (bf && bt) {
        const dThetaRad = ((bf.vaDeg - bt.vaDeg) * Math.PI) / 180;
        const dVm = bf.vmPu - bt.vmPu;
        const pPu =
          Math.abs(br.bPu) > 1e-6
            ? bf.vmPu * bt.vmPu * Math.abs(br.bPu) * Math.sin(dThetaRad) + dVm * br.gPu
            : dVm * br.gPu;
        const flowMw = Math.abs(pPu) * 100;
        br.flowMw = Number(flowMw.toFixed(2));
        br.loadingPct = Number(Math.min(200, (flowMw / Math.max(br.rateMva, 1e-3)) * 100).toFixed(1));
      }
    }
  }

  // Assemble nodal Y_bus = G + jB matrix entries
  const yMap = new Map<string, { row: string; col: string; g: number; b: number; isDiag: boolean; line: number }>();
  for (const b of buses) {
    yMap.set(`${b.id}::${b.id}`, {
      row: b.id,
      col: b.id,
      g: 0,
      b: b.bShuntPu,
      isDiag: true,
      line: b.line,
    });
  }
  for (const br of branches) {
    const dFrom = yMap.get(`${br.from}::${br.from}`);
    const dTo = yMap.get(`${br.to}::${br.to}`);
    if (dFrom) {
      dFrom.g += br.gPu;
      dFrom.b += br.bPu + br.bHalf;
    }
    if (dTo) {
      dTo.g += br.gPu;
      dTo.b += br.bPu + br.bHalf;
    }
    const offKey = `${br.from}::${br.to}`;
    const existingOff = yMap.get(offKey);
    if (existingOff) {
      existingOff.g -= br.gPu;
      existingOff.b -= br.bPu;
    } else {
      yMap.set(offKey, {
        row: br.from,
        col: br.to,
        g: -br.gPu,
        b: -br.bPu,
        isDiag: false,
        line: br.line,
      });
    }
  }

  const yBusEntries = Array.from(yMap.values());

  // Compute physical resonant LC or electromechanical swing modes from parsed components
  const eigenmodes: GridMode[] = [];
  for (let idx = 0; idx < Math.min(lumpedL.length, lumpedC.length); idx++) {
    const l = lumpedL[idx]!;
    const c = lumpedC[idx]!;
    const omega0 = 1 / Math.sqrt(l.valH * c.valF);
    const rEst = Array.from(lumpedR.values())[0] ?? 1.0;
    const alpha = rEst / (2 * l.valH);
    const zeta = Math.min(1, alpha / omega0);
    const omegaD = omega0 * Math.sqrt(Math.max(0, 1 - zeta * zeta));
    eigenmodes.push({
      name: `LC Resonance (${l.name}–${c.name})`,
      sigma: Number((-alpha).toFixed(3)),
      omegaRad: Number(omegaD.toFixed(2)),
      freqHz: Number((omegaD / (2 * Math.PI)).toFixed(2)),
      dampingPct: Number((zeta * 100).toFixed(1)),
      source: `${l.name}=${l.valH}H, ${c.name}=${c.valF}F`,
      line: l.line,
    });
  }

  for (let idx = 0; idx < genInertias.length; idx++) {
    const g = genInertias[idx]!;
    const eqX = g.xDp + (branches[idx]?.x ?? 0.1);
    const syncCoeff = (2 * Math.PI * 60) / (2 * g.hSec * Math.max(eqX, 0.05));
    const omega = Math.sqrt(syncCoeff);
    const sigma = -0.35;
    const mag = Math.hypot(sigma, omega);
    eigenmodes.push({
      name: `Swing Mode (${g.name})`,
      sigma,
      omegaRad: Number(omega.toFixed(2)),
      freqHz: Number((omega / (2 * Math.PI)).toFixed(2)),
      dampingPct: Number(((Math.abs(sigma) / mag) * 100).toFixed(1)),
      source: `H=${g.hSec}s, X_eq=${eqX.toFixed(3)}pu`,
      line: g.line,
    });
  }

  return { buses, branches, yBusEntries, eigenmodes, diagnostics: psseDiagnostics };
}

type NortonCompanion = NonNullable<Awaited<ReturnType<typeof loadFmuForPsse>>["nortonCompanion"]>;
type FmiTerminals = NonNullable<Awaited<ReturnType<typeof loadFmuForPsse>>["terminals"]>;

interface AttachedFmuEntry {
  name: string;
  busNumber: number;
  instance: PsseLinkedDynamicInstance;
  nortonCompanion?: NortonCompanion | undefined;
  terminals?: FmiTerminals | undefined;
}

const DEFAULT_CUSTOM_USRMDL_AS = `// Custom PSS/E USRMDL in AssemblyScript (exports MY_USRMDL_init & MY_USRMDL_step)
// ioPtr layout (f64): [0]=eterm, [1]=speedDev, [2]=efd, [3]=pmech, [4]=vr, [5]=vi
export function MY_USRMDL_init(conPtr: usize, count: i32, statePtr: usize, ioPtr: usize): void {
  const efd = load<f64>(ioPtr + 16);
  store<f64>(statePtr, efd);
}

export function MY_USRMDL_step(t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const eterm = load<f64>(ioPtr);
  const vref = 1.0;
  const kA = 25.0;
  const efd = Math.max(0.0, Math.min(5.0, load<f64>(statePtr) + kA * (vref - eterm) * dt));
  store<f64>(statePtr, efd);
  store<f64>(ioPtr + 16, efd);
}
`;

export const PowerGridInspector: React.FC<PowerGridInspectorProps> = ({
  code,
  lines,
  colorMode,
  dialect,
  onRevealLine,
}) => {
  const isDark = colorMode === "dark";
  const isTouchstone = dialect === "touchstone" || lines.some((l) => /^#\s*\w+\s+[SYZGH]\s+/i.test(l.trim()));
  const [subView, setSubView] = useState<"ybus" | "thermal" | "eigen" | "table">(isTouchstone ? "table" : "ybus");
  const [dyrText, setDyrText] = useState<string | null>(null);
  const [dyrName, setDyrName] = useState<string | null>(null);
  const [seqText, setSeqText] = useState<string | null>(null);
  const [seqName, setSeqName] = useState<string | null>(null);
  const [fmuEntries, setFmuEntries] = useState<AttachedFmuEntry[]>([]);
  const [showCustomUsrmdl, setShowCustomUsrmdl] = useState(false);
  const [customUsrmdlName, setCustomUsrmdlName] = useState("MY_USRMDL");
  const [customUsrmdlBus, setCustomUsrmdlBus] = useState<number>(1);
  const [customUsrmdlSource, setCustomUsrmdlSource] = useState(DEFAULT_CUSTOM_USRMDL_AS);
  const [faultBus, setFaultBus] = useState<string>("");
  const [faultStartSec, setFaultStartSec] = useState<number>(0.1);
  const [faultClearSec, setFaultClearSec] = useState<number>(0.2);
  const [tEndSec, setTEndSec] = useState<number>(1.0);
  const [transientResult, setTransientResult] = useState<PsseTransientResult | null>(null);
  const [studyStatus, setStudyStatus] = useState<string | null>(null);
  const [runningStudy, setRunningStudy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const borderCol = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  const cardBg = isDark ? "rgba(30, 30, 34, 0.75)" : "rgba(255, 255, 255, 0.9)";
  const textPrimary = isDark ? "#e6edf3" : "#1f2328";
  const textMuted = isDark ? "#8b949e" : "#59636e";

  const { buses, branches, yBusEntries, eigenmodes, diagnostics } = useMemo(
    () => analyzePowerGrid(code, lines),
    [code, lines],
  );

  const handleAttachFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    for (const file of Array.from(fileList)) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".dyr")) {
        setDyrText(await file.text());
        setDyrName(file.name);
      } else if (lower.endsWith(".seq")) {
        setSeqText(await file.text());
        setSeqName(file.name);
      } else if (lower.endsWith(".fmu")) {
        try {
          const parsed = parseRaw(code);
          const defaultBus = parsed.generators[0]?.i ?? parsed.buses[0]?.i ?? 1;
          const bytes = new Uint8Array(await file.arrayBuffer());
          const linked = await loadFmuForPsse(bytes, {});
          const busNumber = linked.instance.busNumber !== 1 ? linked.instance.busNumber : defaultBus;
          setFmuEntries((prev) => [
            ...prev,
            {
              name: file.name,
              busNumber,
              instance: linked.instance,
              ...(linked.nortonCompanion ? { nortonCompanion: linked.nortonCompanion } : {}),
              ...(linked.terminals && linked.terminals.length > 0 ? { terminals: linked.terminals } : {}),
            },
          ]);
        } catch (err) {
          setStudyStatus(`FMU load failed (${file.name}): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  };

  const handleCompileCustomUsrmdl = async () => {
    setRunningStudy(true);
    try {
      const res = await compileAssemblyScriptDyrInWorker(customUsrmdlSource);
      if (!res.wasmBytes) {
        setStudyStatus(`USRMDL compile failed: ${res.diagnostics.join("; ") || "no wasm output"}`);
        return;
      }
      const mod = new WebAssembly.Module(new Uint8Array(res.wasmBytes));
      const inst = new WebAssembly.Instance(mod, { env: { abort: () => {} } });
      const exports = inst.exports as Record<string, unknown>;
      const mem = exports["memory"] as WebAssembly.Memory | undefined;
      const safeName = customUsrmdlName.trim().replace(/[^A-Za-z0-9_]/g, "_") || "MY_USRMDL";
      const initFn = exports[`${safeName}_init`] as
        | ((conPtr: number, count: number, statePtr: number, ioPtr: number) => void)
        | undefined;
      const stepFn = exports[`${safeName}_step`] as
        | ((t: number, dt: number, conPtr: number, statePtr: number, ioPtr: number) => void)
        | undefined;
      if (!mem || typeof initFn !== "function" || typeof stepFn !== "function") {
        setStudyStatus(`USRMDL missing ${safeName}_init / ${safeName}_step exports`);
        return;
      }
      const conPtr = 4096;
      const statePtr = 4608;
      const ioPtr = 4736;
      const linkedInst: PsseLinkedDynamicInstance = {
        busNumber: customUsrmdlBus,
        modelName: safeName,
        init(io: PsseDynamicModelIO) {
          if (mem.buffer.byteLength < ioPtr + 64) mem.grow(1);
          const f64 = new Float64Array(mem.buffer);
          const o = ioPtr >> 3;
          f64[o + 0] = io.eterm;
          f64[o + 1] = io.speedDev;
          f64[o + 2] = io.efd;
          f64[o + 3] = io.pmech;
          f64[o + 4] = io.vr;
          f64[o + 5] = io.vi;
          initFn(conPtr, 0, statePtr, ioPtr);
        },
        doStep(tSec: number, dtSec: number, io: PsseDynamicModelIO) {
          const f64 = new Float64Array(mem.buffer);
          const o = ioPtr >> 3;
          f64[o + 0] = io.eterm;
          f64[o + 1] = io.speedDev;
          f64[o + 2] = io.efd;
          f64[o + 3] = io.pmech;
          f64[o + 4] = io.vr;
          f64[o + 5] = io.vi;
          stepFn(tSec, dtSec, conPtr, statePtr, ioPtr);
          return { efd: f64[o + 2], pmech: f64[o + 3] };
        },
      };
      setFmuEntries((prev) => [
        ...prev,
        { name: `${safeName}.wasm`, busNumber: customUsrmdlBus, instance: linkedInst },
      ]);
      setStudyStatus(`Compiled & attached ${safeName} at Bus ${customUsrmdlBus}`);
      setShowCustomUsrmdl(false);
    } catch (err) {
      setStudyStatus(`USRMDL compile error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningStudy(false);
    }
  };

  const runPowerFlowStudy = async () => {
    setRunningStudy(true);
    try {
      const parsed = parseRaw(code);
      if (dyrText) parsed.dyr = parseDyr(dyrText);
      const res = await solvePowerFlowAsync(parsed);
      setStudyStatus(
        res.converged
          ? `Power Flow: converged in ${res.iterations} iters (${res.buses.length} buses)`
          : `Power Flow: did not converge (${res.iterations} iters)`,
      );
    } catch (err) {
      setStudyStatus(`Power Flow error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningStudy(false);
    }
  };

  const runTransientStudy = async () => {
    setRunningStudy(true);
    try {
      const parsed = parseRaw(code);
      if (dyrText) parsed.dyr = parseDyr(dyrText);
      if (seqText) {
        // Parse sequence data to validate companion .seq syntax before simulation
        parseSeq(seqText);
      }
      const fmuModels = fmuEntries.map((entry) => ({
        ...entry.instance,
        busNumber: entry.busNumber,
      }));
      const nortonCompanions = fmuEntries
        .filter((entry): entry is AttachedFmuEntry & { nortonCompanion: NortonCompanion } =>
          Boolean(entry.nortonCompanion),
        )
        .map((entry) => ({
          ...entry.nortonCompanion,
          busNumber: entry.busNumber,
        }));
      const parsedFaultBus = Number(faultBus);
      const sim = simulatePsseTransient(parsed, {
        tEnd: Number.isFinite(tEndSec) && tEndSec > 0 ? tEndSec : 1.0,
        dt: 0.01,
        ...(Number.isFinite(parsedFaultBus) && faultBus.trim() !== "" ? { faultBus: parsedFaultBus } : {}),
        ...(Number.isFinite(faultStartSec) ? { faultStartSec } : {}),
        ...(Number.isFinite(faultClearSec) ? { faultClearSec } : {}),
        useWasmStdLib: true,
        ...(fmuModels.length > 0 ? { fmuModels } : {}),
        ...(nortonCompanions.length > 0 ? { nortonCompanions } : {}),
      });
      setTransientResult(sim);
      setStudyStatus(
        `Transient: ${sim.t.length} steps, ${sim.states.length} channels` + (dyrName ? ` (${dyrName})` : ""),
      );
    } catch (err) {
      setStudyStatus(`Transient error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningStudy(false);
    }
  };

  const btnStyle: React.CSSProperties = {
    padding: "4px 9px",
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 5,
    border: `1px solid ${borderCol}`,
    backgroundColor: cardBg,
    color: textPrimary,
    cursor: runningStudy ? "wait" : "pointer",
  };

  const numInputStyle: React.CSSProperties = {
    width: 56,
    padding: "3px 5px",
    fontSize: 11,
    borderRadius: 4,
    border: `1px solid ${borderCol}`,
    backgroundColor: cardBg,
    color: textPrimary,
  };

  const tracePalette = ["#58a6ff", "#3fb950", "#d29922", "#f85149"];
  const plotKeys = useMemo(() => {
    if (!transientResult) return [];
    const preferred = transientResult.states.filter(
      (s) => s.startsWith("vt_") || s.startsWith("delta_") || s.startsWith("omega_"),
    );
    return (preferred.length > 0 ? preferred : transientResult.states).slice(0, 4);
  }, [transientResult]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 6,
          padding: "8px 10px",
          borderRadius: 6,
          border: `1px solid ${borderCol}`,
          backgroundColor: cardBg,
          fontSize: 11,
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".dyr,.seq,.fmu"
          style={{ display: "none" }}
          onChange={(e) => {
            void handleAttachFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button type="button" style={btnStyle} onClick={() => fileInputRef.current?.click()} disabled={runningStudy}>
          + Attach .dyr / .seq / .fmu
        </button>
        <button
          type="button"
          style={btnStyle}
          onClick={() => setShowCustomUsrmdl((prev) => !prev)}
          disabled={runningStudy}
        >
          + Custom USRMDL (AS)
        </button>
        <button type="button" style={btnStyle} onClick={() => void runPowerFlowStudy()} disabled={runningStudy}>
          Solve Power Flow
        </button>
        <button type="button" style={btnStyle} onClick={() => void runTransientStudy()} disabled={runningStudy}>
          Run Transient
        </button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: textMuted }}>
          Fault Bus
          <input
            type="text"
            placeholder="auto"
            value={faultBus}
            onChange={(e) => setFaultBus(e.target.value)}
            style={numInputStyle}
          />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: textMuted }}>
          t_f(s)
          <input
            type="number"
            step="0.05"
            value={faultStartSec}
            onChange={(e) => setFaultStartSec(Number(e.target.value))}
            style={numInputStyle}
          />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: textMuted }}>
          t_clr(s)
          <input
            type="number"
            step="0.05"
            value={faultClearSec}
            onChange={(e) => setFaultClearSec(Number(e.target.value))}
            style={numInputStyle}
          />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: textMuted }}>
          t_end(s)
          <input
            type="number"
            step="0.5"
            min="0.1"
            value={tEndSec}
            onChange={(e) => setTEndSec(Number(e.target.value))}
            style={numInputStyle}
          />
        </label>
        {dyrName && <span style={{ color: textMuted }}>DYR: {dyrName}</span>}
        {seqName && <span style={{ color: textMuted }}>SEQ: {seqName}</span>}
        {fmuEntries.map((entry, idx) => (
          <span
            key={`${entry.name}-${idx}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 6px",
              borderRadius: 4,
              border: `1px solid ${borderCol}`,
              color: textMuted,
            }}
          >
            <span>{entry.name}</span>
            {entry.terminals && entry.terminals.length > 0 && (
              <span
                title={entry.terminals
                  .map((t) => `${t.name}${t.terminalKind ? ` (${t.terminalKind})` : ""}`)
                  .join(", ")}
                style={{
                  fontSize: 10,
                  padding: "0 4px",
                  borderRadius: 3,
                  border: `1px solid ${borderCol}`,
                }}
              >
                {entry.terminals.length} term{entry.terminals.length === 1 ? "" : "s"}
              </span>
            )}
            <span>@Bus</span>
            <input
              type="number"
              min="1"
              value={entry.busNumber}
              onChange={(e) => {
                const nextBus = Math.max(1, Math.trunc(Number(e.target.value) || 1));
                setFmuEntries((prev) => prev.map((it, j) => (j === idx ? { ...it, busNumber: nextBus } : it)));
              }}
              style={{ ...numInputStyle, width: 48, padding: "1px 4px" }}
            />
            <button
              type="button"
              onClick={() => setFmuEntries((prev) => prev.filter((_, j) => j !== idx))}
              style={{
                border: "none",
                background: "transparent",
                color: textMuted,
                cursor: "pointer",
                padding: "0 2px",
                fontSize: 11,
              }}
              title="Detach model"
            >
              ×
            </button>
          </span>
        ))}
        {studyStatus && <span style={{ color: textPrimary, marginLeft: "auto" }}>{studyStatus}</span>}
      </div>
      {showCustomUsrmdl && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "10px 12px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            fontSize: 11,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong style={{ color: textPrimary }}>Custom AssemblyScript USRMDL</strong>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: textMuted }}>
              Model
              <input
                type="text"
                value={customUsrmdlName}
                onChange={(e) => setCustomUsrmdlName(e.target.value)}
                style={{ ...numInputStyle, width: 110 }}
              />
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: textMuted }}>
              Bus
              <input
                type="number"
                min="1"
                value={customUsrmdlBus}
                onChange={(e) => setCustomUsrmdlBus(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                style={numInputStyle}
              />
            </label>
            <button
              type="button"
              style={btnStyle}
              onClick={() => void handleCompileCustomUsrmdl()}
              disabled={runningStudy}
            >
              Compile &amp; Attach
            </button>
          </div>
          <textarea
            value={customUsrmdlSource}
            onChange={(e) => setCustomUsrmdlSource(e.target.value)}
            rows={8}
            spellCheck={false}
            style={{
              width: "100%",
              fontFamily: "monospace",
              fontSize: 11,
              padding: 8,
              borderRadius: 4,
              border: `1px solid ${borderCol}`,
              backgroundColor: isDark ? "#121214" : "#f6f8fa",
              color: textPrimary,
              resize: "vertical",
            }}
          />
        </div>
      )}
      {transientResult && transientResult.t.length > 1 && plotKeys.length > 0 && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            fontSize: 11,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <span style={{ fontWeight: 600, color: textPrimary }}>
              Transient Stability ({transientResult.summary.stable ? "Stable" : "Unstable"})
            </span>
            <span style={{ color: textMuted }}>
              Fault Bus {transientResult.summary.faultBus} ({transientResult.summary.faultStartSec.toFixed(2)}s–
              {transientResult.summary.faultClearSec.toFixed(2)}s)
            </span>
            <span style={{ color: textMuted }}>
              Max Δδ: {transientResult.summary.maxRotorAngleSpreadDeg.toFixed(1)}°
            </span>
            <span style={{ color: textMuted }}>
              Max |Δf|: {transientResult.summary.maxFreqDeviationHz.toFixed(3)} Hz
            </span>
            <span style={{ color: textMuted }}>Min V: {transientResult.summary.minBusVoltagePu.toFixed(3)} pu</span>
          </div>
          <svg viewBox="0 0 420 110" style={{ width: "100%", height: 110, display: "block", overflow: "visible" }}>
            <rect x={0} y={0} width={420} height={110} rx={4} fill="none" stroke={borderCol} />
            {plotKeys.map((key, idx) => {
              const vals = transientResult.variables[key] ?? [];
              const tArr = transientResult.t;
              const tMax = tArr[tArr.length - 1] || 1;
              let minV = Infinity;
              let maxV = -Infinity;
              for (const v of vals) {
                if (v < minV) minV = v;
                if (v > maxV) maxV = v;
              }
              const span = maxV - minV > 1e-6 ? maxV - minV : 1;
              const pts = vals
                .map((v, i) => {
                  const x = 8 + ((tArr[i] ?? 0) / tMax) * 404;
                  const y = 98 - ((v - minV) / span) * 86;
                  return `${x.toFixed(1)},${y.toFixed(1)}`;
                })
                .join(" ");
              return (
                <polyline
                  key={key}
                  fill="none"
                  stroke={tracePalette[idx % tracePalette.length]}
                  strokeWidth={1.6}
                  points={pts}
                />
              );
            })}
          </svg>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {plotKeys.map((key, idx) => (
              <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: textMuted }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    backgroundColor: tracePalette[idx % tracePalette.length],
                    display: "inline-block",
                  }}
                />
                {key}
              </span>
            ))}
          </div>
        </div>
      )}
      {diagnostics && diagnostics.length > 0 && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: `1px solid ${diagnostics.some((d) => d.severity === "error") ? "#f85149" : "#d29922"}`,
            backgroundColor: diagnostics.some((d) => d.severity === "error")
              ? "rgba(248, 81, 73, 0.1)"
              : "rgba(210, 153, 34, 0.1)",
            fontSize: 12,
            color: textPrimary,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ fontWeight: 600 }}>PSS/E Grid Diagnostics ({diagnostics.length})</div>
          {diagnostics.slice(0, 5).map((d, idx) => (
            <div
              key={`${d.code}-${idx}`}
              onClick={() => d.line && onRevealLine?.(d.line)}
              style={{ cursor: d.line ? "pointer" : "default", color: textMuted }}
            >
              [{d.code}] {d.message}
              {d.line ? ` (line ${d.line})` : ""}
            </div>
          ))}
        </div>
      )}
      <InspectorTabs
        ariaLabel="Power grid inspector views"
        value={subView}
        onChange={(id) => setSubView(id as typeof subView)}
        tabs={[
          ...(isTouchstone ? [{ id: "table", label: "📊 S-Parameter Grid" }] : []),
          { id: "ybus", label: `🕸️ Nodal Admittance Y-Bus (${buses.length}×${buses.length})` },
          { id: "thermal", label: `🔥 Branch Impedance & Loading (${branches.length})` },
          { id: "eigen", label: `📈 Oscillatory Modes (${eigenmodes.length})` },
        ]}
      />

      {subView === "table" && isTouchstone && (
        <div style={{ height: 460, borderRadius: 8, overflow: "hidden", border: `1px solid ${borderCol}` }}>
          <React.Suspense fallback={null}>
            <CsvViewer
              viewConfig={{ code, format: "touchstone", initialMode: "table", title: "s_parameters.s2p" }}
              dialect="touchstone"
              isFullScreen
              onRevealLine={onRevealLine}
            />
          </React.Suspense>
        </div>
      )}

      {subView === "ybus" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            Sparse Nodal Admittance Matrix Y_bus = G + jB ({yBusEntries.length} non-zeros across {buses.length} nodes)
          </div>
          {yBusEntries.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No electrical buses or circuit nodes found in the active buffer.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Entry (i, j)</th>
                    <th style={{ padding: "6px 8px" }}>Role</th>
                    <th style={{ padding: "6px 8px" }}>Conductance G</th>
                    <th style={{ padding: "6px 8px" }}>Susceptance jB</th>
                    <th style={{ padding: "6px 8px" }}>|Y_ij|</th>
                  </tr>
                </thead>
                <tbody>
                  {yBusEntries.slice(0, 60).map((entry, idx) => (
                    <tr
                      key={idx}
                      onClick={() => onRevealLine?.(entry.line, entry.row)}
                      style={{ borderBottom: `1px solid ${borderCol}`, cursor: "pointer" }}
                    >
                      <td
                        style={{
                          padding: "6px 8px",
                          fontWeight: 700,
                          color: entry.isDiag ? "var(--fgColor-accent, var(--ms-brand))" : textPrimary,
                        }}
                      >
                        Y[{entry.row}, {entry.col}]
                      </td>
                      <td style={{ padding: "6px 8px", color: entry.isDiag ? "#3fb950" : "#a371f7" }}>
                        {entry.isDiag ? "Self-Admittance" : "Mutual Coupling"}
                      </td>
                      <td style={{ padding: "6px 8px" }}>{entry.g.toFixed(4)}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {entry.b >= 0 ? "+" : ""}
                        {entry.b.toFixed(4)}j
                      </td>
                      <td style={{ padding: "6px 8px", fontWeight: 600 }}>{Math.hypot(entry.g, entry.b).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subView === "thermal" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10 }}>
            Branch Impedance (R + jX) & DC Power-Flow Thermal Loading
          </div>
          {branches.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No series transmission lines, transformers, or two-terminal impedance branches detected.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {branches.map((br) => {
                const barColor = br.loadingPct > 90 ? "#f85149" : br.loadingPct > 75 ? "#d29922" : "#3fb950";
                return (
                  <div
                    key={br.id}
                    onClick={() => onRevealLine?.(br.line, br.id)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: `1px solid ${borderCol}`,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 5,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        fontFamily: "monospace",
                        gap: 10,
                      }}
                    >
                      <span style={{ fontWeight: 700, color: textPrimary }}>
                        {br.id} ({br.from} → {br.to}) [{br.kind}]
                      </span>
                      <span style={{ color: barColor, fontWeight: 700 }}>
                        R={br.r.toFixed(4)}, X={br.x.toFixed(4)} | {br.flowMw} MW / {br.rateMva} MVA ({br.loadingPct}%)
                      </span>
                    </div>
                    <div
                      style={{
                        width: "100%",
                        height: 6,
                        borderRadius: 99,
                        backgroundColor: "rgba(128,128,128,0.2)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, br.loadingPct)}%`,
                          height: "100%",
                          backgroundColor: barColor,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {subView === "eigen" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            Linearized LC Resonance & Electromechanical Swing Modes (λ = σ ± jω)
          </div>
          {eigenmodes.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No dynamic energy-storage pairs (L–C tanks or synchronous generator inertia blocks) found in this static
              network.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {eigenmodes.map((m, idx) => (
                <div
                  key={idx}
                  onClick={() => onRevealLine?.(m.line)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: `1px solid ${borderCol}`,
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 11,
                    fontFamily: "monospace",
                    gap: 10,
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 700, color: "var(--fgColor-accent, var(--ms-brand))" }}>{m.name}</span>
                    <span style={{ color: textMuted, marginLeft: 8 }}>({m.source})</span>
                  </div>
                  <div style={{ display: "flex", gap: 14 }}>
                    <span>
                      λ = {m.sigma} ± j{m.omegaRad}
                    </span>
                    <span>f = {m.freqHz} Hz</span>
                    <span style={{ color: m.dampingPct < 5 ? "#f0883e" : "#3fb950", fontWeight: 700 }}>
                      ζ = {m.dampingPct}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
