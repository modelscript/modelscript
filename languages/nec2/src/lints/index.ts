// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis and Linter Engine for LLNL NEC-2 Wire Antenna Decks (`NEC1001`–`NEC5006`).
 */

import { Nec2ErrorCode } from "../errors.js";
import { expandNec2Frequencies, expandNec2Geometry } from "../parser/deck-parser.js";
import type { Nec2Deck } from "../types.js";

const C0 = 299792458.0;

export interface Nec2Diagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

/**
 * Validates a parsed NEC-2 deck and returns all static analysis diagnostics (`NEC1001`–`NEC5006`).
 */
export function lintNec2(deck: Nec2Deck): Nec2Diagnostic[] {
  const diags: Nec2Diagnostic[] = [];

  // NEC1001: Syntax errors recorded during parsing
  for (const err of deck.parseErrors) {
    diags.push({
      code: Nec2ErrorCode.SYNTAX_ERROR.code,
      id: Nec2ErrorCode.SYNTAX_ERROR.id,
      rule: Nec2ErrorCode.SYNTAX_ERROR.rule,
      severity: Nec2ErrorCode.SYNTAX_ERROR.severity,
      message: Nec2ErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
      startOffset: err.startOffset,
      endOffset: err.endOffset,
    });
  }

  // NEC1002: Missing CE after CM
  const hasCm = deck.cards.some((c) => c.mnemonic === "CM");
  if (hasCm && !deck.hasCommentEnd) {
    const firstCm = deck.cards.find((c) => c.mnemonic === "CM")!;
    diags.push({
      code: Nec2ErrorCode.MISSING_CE.code,
      id: Nec2ErrorCode.MISSING_CE.id,
      rule: Nec2ErrorCode.MISSING_CE.rule,
      severity: Nec2ErrorCode.MISSING_CE.severity,
      message: Nec2ErrorCode.MISSING_CE.message(),
      line: firstCm.line,
      column: firstCm.column,
      startOffset: firstCm.startOffset,
      endOffset: firstCm.endOffset,
    });
  }

  // NEC1003: Missing GE geometry-end card
  if (!deck.hasGeometryEnd && (deck.wires.length > 0 || deck.arcs.length > 0 || deck.helices.length > 0)) {
    const lastCard = deck.cards[deck.cards.length - 1];
    diags.push({
      code: Nec2ErrorCode.MISSING_GE.code,
      id: Nec2ErrorCode.MISSING_GE.id,
      rule: Nec2ErrorCode.MISSING_GE.rule,
      severity: Nec2ErrorCode.MISSING_GE.severity,
      message: Nec2ErrorCode.MISSING_GE.message(),
      line: lastCard?.line ?? 1,
      column: lastCard?.column ?? 1,
      startOffset: lastCard?.startOffset ?? 0,
      endOffset: lastCard?.endOffset ?? 0,
    });
  }

  // NEC1004: Missing EN end-of-run card
  if (!deck.hasEnd && deck.cards.length > 0) {
    const lastCard = deck.cards[deck.cards.length - 1]!;
    diags.push({
      code: Nec2ErrorCode.MISSING_EN.code,
      id: Nec2ErrorCode.MISSING_EN.id,
      rule: Nec2ErrorCode.MISSING_EN.rule,
      severity: Nec2ErrorCode.MISSING_EN.severity,
      message: Nec2ErrorCode.MISSING_EN.message(),
      line: lastCard.line,
      column: lastCard.column,
      startOffset: lastCard.startOffset,
      endOffset: lastCard.endOffset,
    });
  }

  // Build tag -> total segment count map from expanded geometry
  const expandedWires = expandNec2Geometry(deck);
  const tagSegments = new Map<number, number>();
  const seenDeclaredTags = new Set<number>();

  for (const w of deck.wires) {
    if (w.tag > 0) {
      if (seenDeclaredTags.has(w.tag)) {
        // NEC5005: Duplicate non-zero wire tag
        diags.push({
          code: Nec2ErrorCode.DUPLICATE_WIRE_TAG.code,
          id: Nec2ErrorCode.DUPLICATE_WIRE_TAG.id,
          rule: Nec2ErrorCode.DUPLICATE_WIRE_TAG.rule,
          severity: Nec2ErrorCode.DUPLICATE_WIRE_TAG.severity,
          message: Nec2ErrorCode.DUPLICATE_WIRE_TAG.message(w.tag),
          line: w.line,
          column: w.column,
          startOffset: w.startOffset,
          endOffset: w.endOffset,
        });
      }
      seenDeclaredTags.add(w.tag);
    }
  }

  for (const w of expandedWires) {
    if (w.tag > 0) {
      tagSegments.set(w.tag, (tagSegments.get(w.tag) ?? 0) + Math.max(0, w.segments));
    }
  }

  // Determine highest operating frequency for λ/10 check
  const freqs = expandNec2Frequencies(deck);
  const maxFreqMhz = freqs.length > 0 ? Math.max(...freqs) : 0;
  const minLambda = maxFreqMhz > 0 ? C0 / (maxFreqMhz * 1e6) : Infinity;

  // Determine active ground plane
  const hasGroundPlane =
    (deck.geometryEnd !== undefined && deck.geometryEnd.gpflag !== 0) || deck.grounds.some((g) => g.iperf >= 0);

  // Wire geometry checks (NEC2001, NEC2002, NEC2003, NEC4001, NEC5004)
  for (const w of deck.wires) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const dz = w.z2 - w.z1;
    const length = Math.hypot(dx, dy, dz);

    if (w.segments <= 0) {
      diags.push({
        code: Nec2ErrorCode.ZERO_LENGTH_WIRE.code,
        id: Nec2ErrorCode.ZERO_LENGTH_WIRE.id,
        rule: Nec2ErrorCode.ZERO_LENGTH_WIRE.rule,
        severity: Nec2ErrorCode.ZERO_LENGTH_WIRE.severity,
        message: Nec2ErrorCode.ZERO_LENGTH_WIRE.message(w.tag, `segment count is ${w.segments} (must be >= 1)`),
        line: w.line,
        column: w.column,
        startOffset: w.startOffset,
        endOffset: w.endOffset,
      });
      continue;
    }

    if (length <= 1e-12) {
      diags.push({
        code: Nec2ErrorCode.ZERO_LENGTH_WIRE.code,
        id: Nec2ErrorCode.ZERO_LENGTH_WIRE.id,
        rule: Nec2ErrorCode.ZERO_LENGTH_WIRE.rule,
        severity: Nec2ErrorCode.ZERO_LENGTH_WIRE.severity,
        message: Nec2ErrorCode.ZERO_LENGTH_WIRE.message(w.tag, "wire has zero length"),
        line: w.line,
        column: w.column,
        startOffset: w.startOffset,
        endOffset: w.endOffset,
      });
      continue;
    }

    const segLen = length / w.segments;

    if (w.radius <= 0 || w.radius >= segLen) {
      diags.push({
        code: Nec2ErrorCode.WIRE_RADIUS_EXCEEDS_SEGMENT.code,
        id: Nec2ErrorCode.WIRE_RADIUS_EXCEEDS_SEGMENT.id,
        rule: Nec2ErrorCode.WIRE_RADIUS_EXCEEDS_SEGMENT.rule,
        severity: Nec2ErrorCode.WIRE_RADIUS_EXCEEDS_SEGMENT.severity,
        message: Nec2ErrorCode.WIRE_RADIUS_EXCEEDS_SEGMENT.message(w.tag, w.radius, segLen),
        line: w.line,
        column: w.column,
        startOffset: w.startOffset,
        endOffset: w.endOffset,
      });
    } else if (segLen / w.radius < 2.0) {
      diags.push({
        code: Nec2ErrorCode.THIN_WIRE_RATIO_VIOLATION.code,
        id: Nec2ErrorCode.THIN_WIRE_RATIO_VIOLATION.id,
        rule: Nec2ErrorCode.THIN_WIRE_RATIO_VIOLATION.rule,
        severity: Nec2ErrorCode.THIN_WIRE_RATIO_VIOLATION.severity,
        message: Nec2ErrorCode.THIN_WIRE_RATIO_VIOLATION.message(w.tag, segLen / w.radius),
        line: w.line,
        column: w.column,
        startOffset: w.startOffset,
        endOffset: w.endOffset,
      });
    }

    if (Number.isFinite(minLambda) && segLen > minLambda / 10.0 + 1e-12) {
      diags.push({
        code: Nec2ErrorCode.UNDER_SEGMENTED_WIRE.code,
        id: Nec2ErrorCode.UNDER_SEGMENTED_WIRE.id,
        rule: Nec2ErrorCode.UNDER_SEGMENTED_WIRE.rule,
        severity: Nec2ErrorCode.UNDER_SEGMENTED_WIRE.severity,
        message: Nec2ErrorCode.UNDER_SEGMENTED_WIRE.message(w.tag, segLen, minLambda / 10.0, maxFreqMhz),
        line: w.line,
        column: w.column,
        startOffset: w.startOffset,
        endOffset: w.endOffset,
      });
    }

    if (hasGroundPlane) {
      const minZ = Math.min(w.z1, w.z2);
      if (minZ < -1e-9) {
        diags.push({
          code: Nec2ErrorCode.WIRE_BELOW_GROUND.code,
          id: Nec2ErrorCode.WIRE_BELOW_GROUND.id,
          rule: Nec2ErrorCode.WIRE_BELOW_GROUND.rule,
          severity: Nec2ErrorCode.WIRE_BELOW_GROUND.severity,
          message: Nec2ErrorCode.WIRE_BELOW_GROUND.message(w.tag, minZ),
          line: w.line,
          column: w.column,
          startOffset: w.startOffset,
          endOffset: w.endOffset,
        });
      }
    }
  }

  // NEC5001: Invalid frequency cards
  for (const fr of deck.frequencies) {
    if (fr.fmhz <= 0 || fr.nfrq < 1) {
      diags.push({
        code: Nec2ErrorCode.INVALID_FREQUENCY.code,
        id: Nec2ErrorCode.INVALID_FREQUENCY.id,
        rule: Nec2ErrorCode.INVALID_FREQUENCY.rule,
        severity: Nec2ErrorCode.INVALID_FREQUENCY.severity,
        message: Nec2ErrorCode.INVALID_FREQUENCY.message(fr.fmhz, fr.nfrq),
        line: fr.line,
        column: fr.column,
        startOffset: fr.startOffset,
        endOffset: fr.endOffset,
      });
    }
  }

  const totalAllSegments = expandedWires.reduce((acc, w) => acc + Math.max(0, w.segments), 0);

  // NEC3001 & NEC3002: EX excitations referencing undefined tag or out-of-range segment
  for (const ex of deck.excitations) {
    // Excitation types 0, 4, 5 target a wire tag/segment (1,2,3 are plane waves)
    if (ex.type === 0 || ex.type === 4 || ex.type === 5) {
      if (ex.tag > 0) {
        const maxSeg = tagSegments.get(ex.tag);
        if (maxSeg === undefined) {
          diags.push({
            code: Nec2ErrorCode.UNDEFINED_WIRE_TAG.code,
            id: Nec2ErrorCode.UNDEFINED_WIRE_TAG.id,
            rule: Nec2ErrorCode.UNDEFINED_WIRE_TAG.rule,
            severity: Nec2ErrorCode.UNDEFINED_WIRE_TAG.severity,
            message: Nec2ErrorCode.UNDEFINED_WIRE_TAG.message("EX", ex.tag),
            line: ex.line,
            column: ex.column,
            startOffset: ex.startOffset,
            endOffset: ex.endOffset,
          });
        } else if (ex.segment < 1 || ex.segment > maxSeg) {
          diags.push({
            code: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.code,
            id: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.id,
            rule: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.rule,
            severity: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.severity,
            message: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.message("EX", ex.segment, ex.tag, maxSeg),
            line: ex.line,
            column: ex.column,
            startOffset: ex.startOffset,
            endOffset: ex.endOffset,
          });
        }
      } else if (ex.tag === 0 && totalAllSegments > 0 && (ex.segment < 1 || ex.segment > totalAllSegments)) {
        diags.push({
          code: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.code,
          id: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.id,
          rule: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.rule,
          severity: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.severity,
          message: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.message("EX", ex.segment, 0, totalAllSegments),
          line: ex.line,
          column: ex.column,
          startOffset: ex.startOffset,
          endOffset: ex.endOffset,
        });
      }
    }
  }

  // NEC3001, NEC3002, NEC5006: LD loads
  for (const ld of deck.loads) {
    if (ld.ldtyp < -1 || ld.ldtyp > 5) {
      diags.push({
        code: Nec2ErrorCode.INVALID_LOAD_IMPEDANCE.code,
        id: Nec2ErrorCode.INVALID_LOAD_IMPEDANCE.id,
        rule: Nec2ErrorCode.INVALID_LOAD_IMPEDANCE.rule,
        severity: Nec2ErrorCode.INVALID_LOAD_IMPEDANCE.severity,
        message: Nec2ErrorCode.INVALID_LOAD_IMPEDANCE.message(ld.tag, `unsupported load type ${ld.ldtyp}`),
        line: ld.line,
        column: ld.column,
        startOffset: ld.startOffset,
        endOffset: ld.endOffset,
      });
    } else if (ld.ldtyp >= 0 && ld.ldtyp <= 4 && ld.z1 < 0) {
      diags.push({
        code: Nec2ErrorCode.INVALID_LOAD_IMPEDANCE.code,
        id: Nec2ErrorCode.INVALID_LOAD_IMPEDANCE.id,
        rule: Nec2ErrorCode.INVALID_LOAD_IMPEDANCE.rule,
        severity: Nec2ErrorCode.INVALID_LOAD_IMPEDANCE.severity,
        message: Nec2ErrorCode.INVALID_LOAD_IMPEDANCE.message(ld.tag, `negative resistance R = ${ld.z1} Ω`),
        line: ld.line,
        column: ld.column,
        startOffset: ld.startOffset,
        endOffset: ld.endOffset,
      });
    }

    if (ld.ldtyp === -1) continue; // LD -1 clears all loads

    if (ld.tag > 0) {
      const maxSeg = tagSegments.get(ld.tag);
      if (maxSeg === undefined) {
        diags.push({
          code: Nec2ErrorCode.UNDEFINED_WIRE_TAG.code,
          id: Nec2ErrorCode.UNDEFINED_WIRE_TAG.id,
          rule: Nec2ErrorCode.UNDEFINED_WIRE_TAG.rule,
          severity: Nec2ErrorCode.UNDEFINED_WIRE_TAG.severity,
          message: Nec2ErrorCode.UNDEFINED_WIRE_TAG.message("LD", ld.tag),
          line: ld.line,
          column: ld.column,
          startOffset: ld.startOffset,
          endOffset: ld.endOffset,
        });
      } else {
        if (ld.segStart > 0 && (ld.segStart < 1 || ld.segStart > maxSeg)) {
          diags.push({
            code: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.code,
            id: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.id,
            rule: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.rule,
            severity: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.severity,
            message: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.message("LD", ld.segStart, ld.tag, maxSeg),
            line: ld.line,
            column: ld.column,
            startOffset: ld.startOffset,
            endOffset: ld.endOffset,
          });
        }
        if (ld.segEnd > 0 && (ld.segEnd < 1 || ld.segEnd > maxSeg || (ld.segStart > 0 && ld.segEnd < ld.segStart))) {
          diags.push({
            code: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.code,
            id: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.id,
            rule: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.rule,
            severity: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.severity,
            message: Nec2ErrorCode.SEGMENT_OUT_OF_RANGE.message("LD", ld.segEnd, ld.tag, maxSeg),
            line: ld.line,
            column: ld.column,
            startOffset: ld.startOffset,
            endOffset: ld.endOffset,
          });
        }
      }
    }
  }

  // NEC5002: Missing EX excitation before RP or XQ
  let hasExSeen = false;
  for (const card of deck.cards) {
    if (card.mnemonic === "EX") {
      hasExSeen = true;
    } else if ((card.mnemonic === "RP" || card.mnemonic === "XQ") && !hasExSeen) {
      diags.push({
        code: Nec2ErrorCode.MISSING_EXCITATION.code,
        id: Nec2ErrorCode.MISSING_EXCITATION.id,
        rule: Nec2ErrorCode.MISSING_EXCITATION.rule,
        severity: Nec2ErrorCode.MISSING_EXCITATION.severity,
        message: Nec2ErrorCode.MISSING_EXCITATION.message(card.mnemonic),
        line: card.line,
        column: card.column,
        startOffset: card.startOffset,
        endOffset: card.endOffset,
      });
    }
  }

  // NEC5003: Ground GE vs GN mismatch
  if (deck.geometryEnd && deck.grounds.length > 0) {
    const gp = deck.geometryEnd.gpflag;
    for (const gn of deck.grounds) {
      if ((gp === 0 && gn.iperf >= 0) || (gp !== 0 && gn.iperf === -1)) {
        diags.push({
          code: Nec2ErrorCode.GROUND_GE_MISMATCH.code,
          id: Nec2ErrorCode.GROUND_GE_MISMATCH.id,
          rule: Nec2ErrorCode.GROUND_GE_MISMATCH.rule,
          severity: Nec2ErrorCode.GROUND_GE_MISMATCH.severity,
          message: Nec2ErrorCode.GROUND_GE_MISMATCH.message(gp, gn.iperf),
          line: gn.line,
          column: gn.column,
          startOffset: gn.startOffset,
          endOffset: gn.endOffset,
        });
      }
    }
  }

  return diags;
}

export { Nec2ErrorCode };
