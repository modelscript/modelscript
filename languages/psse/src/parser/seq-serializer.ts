// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSS/E `.seq` Sequence Data Serializer.
 */

import type { PsseSeqCase } from "../types.js";

function q(str: string): string {
  return `'${str.replaceAll("'", "''")}'`;
}

/**
 * Serializes a `PsseSeqCase` into PSS/E `.seq` ASCII text.
 */
export function serializePsseSeq(seqCase: PsseSeqCase): string {
  const lines: string[] = [];

  for (const g of seqCase.generators) {
    lines.push(
      `${g.i}, ${q(g.id)}, ${g.zrpos}, ${g.zxpos}, ${g.zrneg}, ${g.zxneg}, ${g.zr0}, ${g.zx0}, ${g.zrg}, ${g.zxg}`,
    );
  }
  lines.push("0 / END OF SEQUENCE GENERATOR DATA");

  for (const b of seqCase.branches) {
    lines.push(`${b.i}, ${b.j}, ${q(b.ckt)}, ${b.r0}, ${b.x0}, ${b.b0}, ${b.gi0}, ${b.bi0}, ${b.gj0}, ${b.bj0}`);
  }
  lines.push("0 / END OF SEQUENCE BRANCH DATA");

  for (const m of seqCase.mutuals) {
    lines.push(`${m.i1}, ${m.j1}, ${q(m.ckt1)}, ${m.i2}, ${m.j2}, ${q(m.ckt2)}, ${m.rm}, ${m.xm}`);
  }
  lines.push("0 / END OF SEQUENCE MUTUAL DATA");

  for (const t of seqCase.transformers) {
    lines.push(
      `${t.i}, ${t.j}, ${q(t.ckt)}, ${t.cc}, ${t.rg1}, ${t.xg1}, ${t.r01}, ${t.x01}, ${t.rg2}, ${t.xg2}, ${t.r02}, ${t.x02}`,
    );
  }
  lines.push("0 / END OF SEQUENCE TRANSFORMER DATA");

  for (const s of seqCase.shunts) {
    lines.push(`${s.i}, ${s.g0}, ${s.b0}`);
  }
  lines.push("0 / END OF SEQUENCE SHUNT DATA");

  return lines.join("\n");
}
