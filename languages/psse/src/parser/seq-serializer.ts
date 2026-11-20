// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSS/E `.seq` Sequence Data Serializer.
 */

import type { PsseSeqCase } from "../types.js";

function q(str: string): string {
  return `'${str.replaceAll("'", "''")}'`;
}

export interface WriteSeqOptions {
  /** Target PSS/E `.seq` revision (`30 | 31 | 32 | 33 | 34 | 35 | 36`). Defaults to `33`. */
  rev?: number | undefined;
  /** Emit `@!` column metadata headers (default: `true` for `rev >= 34`). */
  includeMetadataHeaders?: boolean | undefined;
}

/**
 * Serializes a `PsseSeqCase` into PSS/E `.seq` ASCII text for revisions `v30`–`v36`.
 */
export function serializePsseSeq(seqCase: PsseSeqCase, opts?: WriteSeqOptions): string {
  const rev = opts?.rev ?? 33;
  const emitMeta = opts?.includeMetadataHeaders ?? rev >= 34;
  const lines: string[] = [];

  if (emitMeta) {
    lines.push(`0, ${rev} / PSS/E-${rev} SEQUENCE DATA FILE`);
    lines.push("@! I, 'ID', ZRPOS, ZXPOS, ZRNEG, ZXNEG, ZR0, ZX0, ZRG, ZXG");
  }
  for (const g of seqCase.generators) {
    lines.push(
      `${g.i}, ${q(g.id)}, ${g.zrpos}, ${g.zxpos}, ${g.zrneg}, ${g.zxneg}, ${g.zr0}, ${g.zx0}, ${g.zrg}, ${g.zxg}`,
    );
  }
  lines.push("0 / END OF SEQUENCE GENERATOR DATA");

  if (emitMeta) {
    lines.push("@! I, J, 'CKT', R0, X0, B0, GI0, BI0, GJ0, BJ0");
  }
  for (const b of seqCase.branches) {
    lines.push(`${b.i}, ${b.j}, ${q(b.ckt)}, ${b.r0}, ${b.x0}, ${b.b0}, ${b.gi0}, ${b.bi0}, ${b.gj0}, ${b.bj0}`);
  }
  lines.push("0 / END OF SEQUENCE BRANCH DATA");

  if (emitMeta) {
    lines.push("@! I1, J1, 'CKT1', I2, J2, 'CKT2', RM, XM");
  }
  for (const m of seqCase.mutuals) {
    lines.push(`${m.i1}, ${m.j1}, ${q(m.ckt1)}, ${m.i2}, ${m.j2}, ${q(m.ckt2)}, ${m.rm}, ${m.xm}`);
  }
  lines.push("0 / END OF SEQUENCE MUTUAL DATA");

  if (emitMeta) {
    lines.push("@! I, J, 'CKT', CC, RG1, XG1, R01, X01, RG2, XG2, R02, X02");
  }
  for (const t of seqCase.transformers) {
    lines.push(
      `${t.i}, ${t.j}, ${q(t.ckt)}, ${t.cc}, ${t.rg1}, ${t.xg1}, ${t.r01}, ${t.x01}, ${t.rg2}, ${t.xg2}, ${t.r02}, ${t.x02}`,
    );
  }
  lines.push("0 / END OF SEQUENCE TRANSFORMER DATA");

  if (emitMeta) {
    lines.push("@! I, G0, B0");
  }
  for (const s of seqCase.shunts) {
    lines.push(`${s.i}, ${s.g0}, ${s.b0}`);
  }
  lines.push("0 / END OF SEQUENCE SHUNT DATA");

  return lines.join("\n");
}
