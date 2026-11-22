// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — SysML 1.x Blocks & Parametric Constraints → Modelica (.mo) Projection.
 *
 * Translates SysML 1.x `«block»` value properties, `«constraintBlock»` equations,
 * and `«binding»` connectors into executable Modelica 3.x models.
 */

import { parseMagicDraw } from "../parser/index.js";
import { lookupUmlPrimitive } from "../profiles/index.js";
import type { MagicDrawDocument } from "../types.js";

function sanitizeMoIdent(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_]/g, "_");
  if (!cleaned) return "Unnamed";
  if (/^[0-9]/.test(cleaned)) return `_${cleaned}`;
  return cleaned;
}

function mapTypeToModelica(typeName: string | undefined): string {
  if (!typeName) return "Real";
  const prim = lookupUmlPrimitive(typeName);
  if (prim) return prim.modelicaType;
  return "Real";
}

/**
 * Projects a MagicDraw SysML 1.x model's blocks and parametric constraint blocks into Modelica (`.mo`).
 */
export function magicDrawToModelica(docOrText: MagicDrawDocument | string): string {
  const doc = typeof docOrText === "string" ? parseMagicDraw(docOrText) : docOrText;
  const pkgName = sanitizeMoIdent(doc.metadata.projectName ?? "MagicDrawModel");
  const lines: string[] = [`// Projected from MagicDraw / SysML 1.x by @modelscript/magicdraw`, `package ${pkgName}`];

  for (const cls of doc.classifiers.values()) {
    if (cls.kind === "Requirement" || cls.kind === "ValueType" || cls.kind === "DataType") continue;
    const mName = sanitizeMoIdent(cls.name);
    lines.push(`  model ${mName}`);

    for (const prop of cls.properties) {
      const pName = sanitizeMoIdent(prop.name);
      if (prop.compartment === "parts" || prop.compartment === "constraints") {
        const targetCls = prop.typeRef?.resolvedId ? doc.classifiers.get(prop.typeRef.resolvedId) : undefined;
        if (targetCls) {
          lines.push(`    ${sanitizeMoIdent(targetCls.name)} ${pName};`);
        }
      } else {
        const moType = mapTypeToModelica(prop.typeRef?.resolvedName);
        const isParam = prop.isReadOnly || (prop.defaultValue !== undefined && cls.kind !== "ConstraintBlock");
        const prefix = isParam ? "parameter " : "";
        const unitAttr = prop.typeRef?.unit ? `(unit = "${prop.typeRef.unit}")` : "";
        const defVal = prop.defaultValue !== undefined && prop.defaultValue !== "" ? ` = ${prop.defaultValue}` : "";
        lines.push(`    ${prefix}${moType} ${pName}${unitAttr}${defVal};`);
      }
    }

    const eqLines: string[] = [];
    for (const c of cls.constraints) {
      const body = c.body.trim();
      if (body && body.includes("=")) {
        eqLines.push(`    ${body.replace(/;+$/, "")};`);
      }
    }

    for (const conn of cls.connectors) {
      if (conn.kind === "binding" && conn.ends.length >= 2) {
        const formatEnd = (end: (typeof conn.ends)[0]): string => {
          const partName = end.partWithPortId ? doc.elementsById.get(end.partWithPortId)?.name : undefined;
          const roleName = end.roleId ? doc.elementsById.get(end.roleId)?.name : undefined;
          if (partName && roleName) return `${sanitizeMoIdent(partName)}.${sanitizeMoIdent(roleName)}`;
          return sanitizeMoIdent(roleName ?? partName ?? "v");
        };
        eqLines.push(`    ${formatEnd(conn.ends[0]!)} = ${formatEnd(conn.ends[1]!)};`);
      }
    }

    if (eqLines.length > 0) {
      lines.push(`  equation`, ...eqLines);
    }

    lines.push(`  end ${mName};`, "");
  }

  lines.push(`end ${pkgName};`);
  return `${lines.join("\n")}\n`;
}
