// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — Modelica Verifier Block Projection.
 *
 * Emits production Modelica 3.x verification blocks with inputs,
 * pass/fail Boolean monitors, and assert() clauses from formal ReqIF contracts.
 */

import type { ReqIfDocument } from "../types.js";

function sanitizeIdent(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `req_${cleaned}` : cleaned;
}

/**
 * Generates a Modelica verification block monitoring all contracted ReqIF requirements.
 */
export function reqifToModelicaVerifier(doc: ReqIfDocument, blockName = "RequirementsVerifier"): string {
  const lines: string[] = [];
  const safeBlockName = sanitizeIdent(blockName);

  lines.push(`block ${safeBlockName}`);
  lines.push(`  "Auto-generated requirements verifier for ${doc.header.title}"`);
  lines.push("");

  // Collect unique contracted variables
  const variables = new Set<string>();
  const contractedObjs: { id: string; varName: string; comp: string; limit: number; text: string }[] = [];

  for (const obj of doc.specObjects.values()) {
    if (obj.contract) {
      const v = sanitizeIdent(obj.contract.variable);
      variables.add(v);
      contractedObjs.push({
        id: sanitizeIdent(obj.identifier),
        varName: v,
        comp: obj.contract.comparator,
        limit: obj.contract.limitValue,
        text: obj.text.replace(/["\\]/g, ""),
      });
    }
  }

  // 1. Declare inputs for monitored plant variables
  lines.push("  // ── Monitored Plant Signals ──");
  for (const v of variables) {
    lines.push(
      `  Modelica.Blocks.Interfaces.RealInput ${v} annotation(Placement(transformation(extent={{-120,-10},{-100,10}})));`,
    );
  }
  lines.push("");

  // 2. Declare Boolean monitor outputs
  lines.push("  // ── Requirement Compliance Outputs ──");
  for (const c of contractedObjs) {
    lines.push(
      `  Modelica.Blocks.Interfaces.BooleanOutput ${c.id}_pass annotation(Placement(transformation(extent={{100,-10},{120,10}})));`,
    );
  }
  lines.push("  Modelica.Blocks.Interfaces.BooleanOutput all_requirements_passed;");
  lines.push("");

  // 3. Equations & Assertions
  lines.push("equation");
  for (const c of contractedObjs) {
    lines.push(`  ${c.id}_pass = ${c.varName} ${c.comp} ${c.limit};`);
    lines.push(`  assert(${c.id}_pass, "ReqIF Violation: [${c.id}] ${c.text}");`);
  }

  if (contractedObjs.length > 0) {
    const allPassedExpr = contractedObjs.map((c) => `${c.id}_pass`).join(" and ");
    lines.push(`  all_requirements_passed = ${allPassedExpr};`);
  } else {
    lines.push("  all_requirements_passed = true;");
  }

  lines.push(`end ${safeBlockName};`);
  return lines.join("\n");
}
