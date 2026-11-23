// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mcnp — Projection from MCNP CSG Geometry to OpenSCAD (.scad).
 */

import type { McnpCsgExpr, McnpDeck, McnpSurfaceCard } from "../types.js";

function surfaceToScad(surf: McnpSurfaceCard): string {
  const p = surf.params;
  switch (surf.type) {
    case "SO":
      return `sphere(r = ${p[0] ?? 1}, $fn = 48);`;
    case "S":
    case "SPH":
      return `translate([${p[0] ?? 0}, ${p[1] ?? 0}, ${p[2] ?? 0}]) sphere(r = ${p[3] ?? 1}, $fn = 48);`;
    case "SX":
      return `translate([${p[0] ?? 0}, 0, 0]) sphere(r = ${p[1] ?? 1}, $fn = 48);`;
    case "SY":
      return `translate([0, ${p[0] ?? 0}, 0]) sphere(r = ${p[1] ?? 1}, $fn = 48);`;
    case "SZ":
      return `translate([0, 0, ${p[0] ?? 0}]) sphere(r = ${p[1] ?? 1}, $fn = 48);`;
    case "RPP": {
      const [x0 = 0, x1 = 1, y0 = 0, y1 = 1, z0 = 0, z1 = 1] = p;
      return `translate([${x0}, ${y0}, ${z0}]) cube([${Math.abs(x1 - x0)}, ${Math.abs(y1 - y0)}, ${Math.abs(z1 - z0)}]);`;
    }
    case "RCC": {
      const [vx = 0, vy = 0, vz = 0, hx = 0, hy = 0, hz = 1, r = 1] = p;
      const h = Math.hypot(hx, hy, hz);
      return `translate([${vx}, ${vy}, ${vz}]) cylinder(h = ${h}, r = ${r}, $fn = 48);`;
    }
    case "CZ":
      return `cylinder(h = 1000, r = ${p[0] ?? 1}, center = true, $fn = 48);`;
    case "C/Z":
      return `translate([${p[0] ?? 0}, ${p[1] ?? 0}, 0]) cylinder(h = 1000, r = ${p[2] ?? 1}, center = true, $fn = 48);`;
    case "PX":
      return `translate([${p[0] ?? 0}, 0, 0]) cube([1000, 1000, 1000], center = false);`;
    case "PY":
      return `translate([0, ${p[0] ?? 0}, 0]) cube([1000, 1000, 1000], center = false);`;
    case "PZ":
      return `translate([0, 0, ${p[0] ?? 0}]) cube([1000, 1000, 1000], center = false);`;
    default:
      return `// Surface ${surf.id} (${surf.type})`;
  }
}

function csgToScad(expr: McnpCsgExpr | null, deck: McnpDeck, indent: string): string {
  if (!expr) return `${indent}// empty CSG`;
  switch (expr.kind) {
    case "surface": {
      const surf = deck.surfaces.get(expr.id);
      if (!surf) return `${indent}// undefined surface ${expr.id}`;
      return `${indent}${surfaceToScad(surf)}`;
    }
    case "union": {
      const body = expr.operands.map((op) => csgToScad(op, deck, `${indent}  `)).join("\n");
      return `${indent}union() {\n${body}\n${indent}}`;
    }
    case "intersection": {
      // Detect spherical/solid shell pattern (-outer +inner) -> difference()
      if (expr.operands.length === 2) {
        const [a, b] = expr.operands;
        if (a?.kind === "surface" && b?.kind === "surface" && a.sense !== b.sense) {
          const outer = a.sense === -1 ? a : b;
          const inner = a.sense === 1 ? a : b;
          return (
            `${indent}difference() {\n` +
            `${csgToScad(outer, deck, `${indent}  `)}\n` +
            `${csgToScad(inner, deck, `${indent}  `)}\n` +
            `${indent}}`
          );
        }
      }
      const body = expr.operands.map((op) => csgToScad(op, deck, `${indent}  `)).join("\n");
      return `${indent}intersection() {\n${body}\n${indent}}`;
    }
    case "complement": {
      if (expr.expr) {
        return `${indent}// complement\n${csgToScad(expr.expr, deck, indent)}`;
      }
      return `${indent}// complement of cell #${expr.cellId ?? 0}`;
    }
  }
}

/**
 * Generates an OpenSCAD (`.scad`) geometry script for all non-graveyard cells in an MCNP deck.
 */
export function mcnpToOpenScad(deck: McnpDeck): string {
  const lines: string[] = [`// OpenSCAD CSG Geometry projected from MCNP Deck: ${deck.title}`, `// Units: cm`, ``];

  for (const cell of deck.cells.values()) {
    const isGraveyard = Object.values(cell.imp).some((v) => v === 0);
    if (isGraveyard) continue;
    lines.push(`module cell_${cell.id}() { // material M${cell.materialId}`);
    lines.push(csgToScad(cell.csg, deck, "  "));
    lines.push(`}`);
    lines.push(``);
  }

  lines.push(`// Top-level assembly`);
  for (const cell of deck.cells.values()) {
    const isGraveyard = Object.values(cell.imp).some((v) => v === 0);
    if (isGraveyard) continue;
    lines.push(`cell_${cell.id}();`);
  }

  return lines.join("\n") + "\n";
}
