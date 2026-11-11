// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable react-refresh/only-export-components */

import React, { useMemo, useState } from "react";

export interface PowerGridInspectorProps {
  code: string;
  lines: string[];
  colorMode: "dark" | "light";
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

  let psseSection: "bus" | "load" | "gen" | "branch" | "other" = "other";
  const hasPsseHeaders = /BEGIN\s+BUS\s+DATA|0\s*\/.*PSS/i.test(code);
  if (hasPsseHeaders) psseSection = "bus";

  for (let i = 0; i < lines.length; i++) {
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

  return { buses, branches, yBusEntries, eigenmodes };
}

export const PowerGridInspector: React.FC<PowerGridInspectorProps> = ({ code, lines, colorMode, onRevealLine }) => {
  const isDark = colorMode === "dark";
  const [subView, setSubView] = useState<"ybus" | "thermal" | "eigen">("ybus");

  const borderCol = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  const cardBg = isDark ? "rgba(22, 27, 34, 0.7)" : "rgba(255, 255, 255, 0.9)";
  const textPrimary = isDark ? "#e6edf3" : "#1f2328";
  const textMuted = isDark ? "#8b949e" : "#59636e";

  const { buses, branches, yBusEntries, eigenmodes } = useMemo(() => analyzePowerGrid(code, lines), [code, lines]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[
          { id: "ybus", label: `🕸️ Nodal Admittance Y-Bus (${buses.length}×${buses.length})` },
          { id: "thermal", label: `🔥 Branch Impedance & Loading (${branches.length})` },
          { id: "eigen", label: `📈 Oscillatory Modes (${eigenmodes.length})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubView(t.id as typeof subView)}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              cursor: "pointer",
              backgroundColor: subView === t.id ? "#1f6feb" : cardBg,
              color: subView === t.id ? "#ffffff" : textPrimary,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

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
                        style={{ padding: "6px 8px", fontWeight: 700, color: entry.isDiag ? "#58a6ff" : textPrimary }}
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
                    <span style={{ fontWeight: 700, color: "#58a6ff" }}>{m.name}</span>
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
