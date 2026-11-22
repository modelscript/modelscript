// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/kicad — Cross-File LSP Hover & Go-To-Definition Providers.
 */

import { extractBoardParasitics } from "./parasitics.js";
import type { KiCadBoard, KiCadDocument, KiCadSchematic, SourceSpan } from "./types.js";

export interface KiCadHoverInfo {
  markdown: string;
  span: SourceSpan;
}

export interface KiCadCrossFileTarget {
  kind: "kicad_pcb" | "kicad_sch";
  refDes: string;
  span: SourceSpan;
}

function containsOffset(span: SourceSpan | undefined, offset: number): span is SourceSpan {
  return span !== undefined && offset >= span.startOffset && offset <= span.endOffset;
}

/**
 * Returns rich Markdown hover documentation for a cursor byte offset inside a
 * parsed KiCad board or schematic document.
 */
export function resolveKiCadHover(doc: KiCadDocument, offset: number): KiCadHoverInfo | null {
  if (doc.kind === "kicad_pcb") {
    for (const fp of doc.footprints) {
      if (containsOffset(fp.span, offset)) {
        const lines = [
          `**Footprint \`${fp.refDes || fp.libId}\`** (\`${fp.libId}\`)`,
          `- **Value:** \`${fp.value || "—"}\``,
          `- **Layer:** \`${fp.layer}\` at \`(${fp.at[0]}, ${fp.at[1]}) mm\`, rot \`${fp.rotation}°\``,
          `- **Pads:** ${fp.pads.length}`,
        ];
        if (fp.mpn) lines.push(`- **MPN:** \`${fp.mpn}\``);
        return { markdown: lines.join("\n"), span: fp.span };
      }
    }

    for (const net of doc.nets) {
      if (containsOffset(net.span, offset) && net.name) {
        const parasitics = extractBoardParasitics(doc);
        const summary = parasitics.nets[net.name];
        const lines = [`**Net \`${net.name}\`** (id \`${net.id}\`)`];
        if (summary) {
          lines.push(`- **Routed Length:** ${summary.totalLengthMm.toFixed(2)} mm (${summary.segmentCount} segs)`);
          lines.push(
            `- **Parasitics:** R = ${summary.totalResistanceOhm.toFixed(4)} Ω, L = ${summary.totalInductanceNH.toFixed(2)} nH, C = ${summary.totalCapacitancePF.toFixed(2)} pF`,
          );
          lines.push(`- **Impedance:** ${summary.minImpedanceOhm.toFixed(1)}–${summary.maxImpedanceOhm.toFixed(1)} Ω`);
          lines.push(`- **IPC-2221 Ampacity (ΔT=10°C):** ${summary.minMaxCurrentA.toFixed(2)} A`);
        }
        return { markdown: lines.join("\n"), span: net.span };
      }
    }
    return null;
  }

  if (doc.kind === "kicad_sch") {
    for (const sym of doc.symbols) {
      if (containsOffset(sym.span, offset)) {
        const lines = [
          `**Symbol \`${sym.refDes || sym.libId}\`** (\`${sym.libId}\`)`,
          `- **Value:** \`${sym.value || "—"}\``,
          `- **Pins:** ${sym.pins.length}`,
        ];
        if (sym.footprint) lines.push(`- **Footprint:** \`${sym.footprint}\``);
        return { markdown: lines.join("\n"), span: sym.span };
      }
    }
  }

  return null;
}

/**
 * Resolves cross-file go-to-definition between a `.kicad_sch` symbol and its
 * paired `.kicad_pcb` footprint by reference designator.
 */
export function findCrossFileDefinition(
  refDes: string,
  fromKind: "kicad_sch" | "kicad_pcb",
  sch: KiCadSchematic,
  board: KiCadBoard,
): KiCadCrossFileTarget | null {
  if (fromKind === "kicad_sch") {
    const fp = board.footprints.find((f) => f.refDes === refDes);
    if (fp?.span) return { kind: "kicad_pcb", refDes, span: fp.span };
    return null;
  }
  const sym = sch.symbols.find((s) => s.refDes === refDes);
  if (sym?.span) return { kind: "kicad_sch", refDes, span: sym.span };
  return null;
}
