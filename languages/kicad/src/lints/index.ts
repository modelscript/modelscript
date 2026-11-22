// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/kicad — Static Verification & ECAD Lint Rules (K1xxx–K5xxx).
 */

import { extractSchematicNetlist } from "../schematic-netlist.js";
import type { KiCadBoard, KiCadDiagnostic, KiCadSchematic } from "../types.js";

export function lintKiCadBoard(board: KiCadBoard): KiCadDiagnostic[] {
  const diags: KiCadDiagnostic[] = [...board.diagnostics];

  // K2001: Duplicate reference designators
  const seenRefs = new Set<string>();
  for (const fp of board.footprints) {
    if (!fp.refDes) {
      const diag: KiCadDiagnostic = {
        code: "K4001",
        severity: "warning",
        message: `Footprint '${fp.libId}' is missing a Reference designator.`,
      };
      if (fp.span) diag.span = fp.span;
      diags.push(diag);
      continue;
    }
    if (seenRefs.has(fp.refDes)) {
      const diag: KiCadDiagnostic = {
        code: "K2001",
        severity: "error",
        message: `Duplicate reference designator '${fp.refDes}' on PCB.`,
      };
      if (fp.span) diag.span = fp.span;
      diags.push(diag);
    }
    seenRefs.add(fp.refDes);
  }

  // K4002: Segments/vias referencing undeclared net IDs
  const declaredNets = new Set(board.nets.map((n) => n.id));
  declaredNets.add(0);
  for (const seg of board.segments) {
    if (!declaredNets.has(seg.netId)) {
      const diag: KiCadDiagnostic = {
        code: "K4002",
        severity: "error",
        message: `Copper segment on '${seg.layer}' references undeclared net ID '${seg.netId}'.`,
      };
      if (seg.span) diag.span = seg.span;
      diags.push(diag);
    }
  }
  for (const via of board.vias) {
    if (!declaredNets.has(via.netId)) {
      const diag: KiCadDiagnostic = {
        code: "K4002",
        severity: "error",
        message: `Via at (${via.at[0]}, ${via.at[1]}) references undeclared net ID '${via.netId}'.`,
      };
      if (via.span) diag.span = via.span;
      diags.push(diag);
    }
  }

  // K5001: Missing board outline on Edge.Cuts
  if (board.outline.length < 3) {
    diags.push({
      code: "K5001",
      severity: "warning",
      message: "Board is missing a closed outline on layer 'Edge.Cuts'.",
    });
  }

  return diags;
}

function samePos(a: [number, number], b: [number, number], eps = 0.02): boolean {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
}

/**
 * Runs Electrical Rules Check (ERC) lints on a parsed KiCad `.kicad_sch` schematic.
 */
export function lintKiCadSchematic(sch: KiCadSchematic): KiCadDiagnostic[] {
  const diags: KiCadDiagnostic[] = [...sch.diagnostics];
  const seenRefs = new Set<string>();

  for (const sym of sch.symbols) {
    const isPower = sym.refDes.startsWith("#PWR") || sym.refDes.startsWith("#FLG") || sym.libId.startsWith("power:");

    // K2003: Unresolved lib_id
    if (sym.libId && !sch.libSymbols[sym.libId]) {
      const diag: KiCadDiagnostic = {
        code: "K2003",
        severity: "error",
        message: `Symbol '${sym.refDes || sym.libId}' references lib_id '${sym.libId}' which is not defined in lib_symbols.`,
      };
      if (sym.span) diag.span = sym.span;
      diags.push(diag);
    }

    if (isPower) continue;

    // K2002: Duplicate schematic reference designator
    if (sym.refDes) {
      if (seenRefs.has(sym.refDes)) {
        const diag: KiCadDiagnostic = {
          code: "K2002",
          severity: "error",
          message: `Duplicate schematic reference designator '${sym.refDes}'.`,
        };
        if (sym.span) diag.span = sym.span;
        diags.push(diag);
      }
      seenRefs.add(sym.refDes);
    }

    // K4003: Missing value
    if (!sym.value) {
      const diag: KiCadDiagnostic = {
        code: "K4003",
        severity: "warning",
        message: `Component '${sym.refDes || sym.libId}' is missing a Value property.`,
      };
      if (sym.span) diag.span = sym.span;
      diags.push(diag);
    }
  }

  const { netlist, pinDetails, powerFlagNets } = extractSchematicNetlist(sch);
  const netPinCount = new Map<string, number>();
  for (const net of netlist.nets) {
    netPinCount.set(net.id, net.pins.length);
  }

  // Group pin details by resolved net for ERC conflict & power-drive checks
  const pinsByNet = new Map<string, typeof pinDetails>();
  for (const pd of pinDetails) {
    if (!pd.netName) continue;
    let list = pinsByNet.get(pd.netName);
    if (!list) {
      list = [];
      pinsByNet.set(pd.netName, list);
    }
    list.push(pd);
  }

  for (const [netName, pins] of pinsByNet) {
    // K3001: Output-to-output conflict
    const drivers = pins.filter(
      (p) => !p.isPowerSymbol && (p.electricalType === "output" || p.electricalType === "power_out"),
    );
    if (drivers.length >= 2) {
      diags.push({
        code: "K3001",
        severity: "error",
        message: `ERC output conflict on net '${netName}': multiple output pins (${drivers.map((d) => `${d.component}.${d.pinNumber}`).join(", ")}) connected together.`,
      });
    }

    // K3003: Undriven power_in pin
    const powerInputs = pins.filter((p) => !p.isPowerSymbol && p.electricalType === "power_in");
    if (powerInputs.length > 0 && !powerFlagNets.has(netName)) {
      const hasPowerSource = pins.some(
        (p) => p.electricalType === "power_out" || (p.isPowerSymbol && p.electricalType === "power_in"),
      );
      if (!hasPowerSource) {
        diags.push({
          code: "K3003",
          severity: "warning",
          message: `ERC power pin '${powerInputs[0]!.component}.${powerInputs[0]!.pinNumber}' on net '${netName}' is not driven by a power_out pin or PWR_FLAG.`,
        });
      }
    }
  }

  // K3002: Unconnected non-power pins without a no_connect marker
  for (const pd of pinDetails) {
    if (pd.isPowerSymbol || pd.electricalType === "no_connect" || pd.electricalType === "free") continue;
    const isMarkedNc = sch.noConnects.some((nc) => samePos(nc.at, pd.sheetPos));
    if (isMarkedNc) continue;
    const netCount = netPinCount.get(pd.netName) ?? 0;
    const hasPowerOnNet = (pinsByNet.get(pd.netName) ?? []).some((p) => p.isPowerSymbol);
    if (netCount <= 1 && !hasPowerOnNet) {
      diags.push({
        code: "K3002",
        severity: "warning",
        message: `ERC unconnected pin '${pd.component}.${pd.pinNumber}' (${pd.pinName}).`,
      });
    }
  }

  return diags;
}
