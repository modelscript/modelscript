// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/kicad — Schematic ↔ PCB Consistency Verifier.
 *
 * Cross-checks a `.kicad_sch` schematic against its paired `.kicad_pcb` board
 * to detect missing components, orphan footprints, value/footprint drift, and
 * pin-to-net connectivity mismatches before manufacturing.
 */

import { extractSchematicNetlist } from "./schematic-netlist.js";
import type { KiCadBoard, KiCadDiagnostic, KiCadFootprint, KiCadSchematic } from "./types.js";

export function verifySchematicPcbConsistency(sch: KiCadSchematic, board: KiCadBoard): KiCadDiagnostic[] {
  const diags: KiCadDiagnostic[] = [];
  const schNet = extractSchematicNetlist(sch);

  const fpByRef = new Map<string, KiCadFootprint>();
  for (const fp of board.footprints) {
    if (fp.refDes) fpByRef.set(fp.refDes, fp);
  }

  const schRefs = new Set<string>();

  for (const sym of sch.symbols) {
    const isPower = sym.refDes.startsWith("#PWR") || sym.refDes.startsWith("#FLG") || sym.libId.startsWith("power:");
    if (isPower || !sym.refDes) continue;
    schRefs.add(sym.refDes);

    const fp = fpByRef.get(sym.refDes);
    if (!fp) {
      const d: KiCadDiagnostic = {
        code: "K2010",
        severity: "error",
        message: `Component '${sym.refDes}' is present in schematic but missing from PCB.`,
      };
      if (sym.span) d.span = sym.span;
      diags.push(d);
      continue;
    }

    // Value drift check
    if (sym.value && fp.value && sym.value !== fp.value) {
      const d: KiCadDiagnostic = {
        code: "K2012",
        severity: "warning",
        message: `Component '${sym.refDes}' value mismatch: schematic has '${sym.value}', PCB has '${fp.value}'.`,
      };
      if (fp.span) d.span = fp.span;
      diags.push(d);
    }

    // Footprint drift check
    if (sym.footprint && fp.libId && sym.footprint !== fp.libId) {
      const d: KiCadDiagnostic = {
        code: "K2013",
        severity: "warning",
        message: `Component '${sym.refDes}' footprint mismatch: schematic specifies '${sym.footprint}', PCB places '${fp.libId}'.`,
      };
      if (fp.span) d.span = fp.span;
      diags.push(d);
    }

    // Pin-to-net connectivity check
    for (const pad of fp.pads) {
      const schNetName = schNet.pinNetMap.get(`${sym.refDes}.${pad.number}`);
      if (schNetName && pad.netName && schNetName !== pad.netName) {
        const d: KiCadDiagnostic = {
          code: "K2014",
          severity: "error",
          message: `Net mismatch on '${sym.refDes}.${pad.number}': schematic connects to '${schNetName}', PCB connects to '${pad.netName}'.`,
        };
        if (fp.span) d.span = fp.span;
        diags.push(d);
      }
    }
  }

  // Orphan footprints on PCB
  for (const fp of board.footprints) {
    if (!fp.refDes || schRefs.has(fp.refDes)) continue;
    const d: KiCadDiagnostic = {
      code: "K2011",
      severity: "warning",
      message: `Footprint '${fp.refDes}' (${fp.libId}) is placed on PCB but not present in schematic.`,
    };
    if (fp.span) d.span = fp.span;
    diags.push(d);
  }

  return diags;
}
