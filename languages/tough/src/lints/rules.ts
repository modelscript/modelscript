// SPDX-License-Identifier: AGPL-3.0-or-later

import { ToughErrorCode } from "../errors.js";
import type { ToughDeck } from "../types.js";

export interface ToughDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
}

export function lintTough(deck: ToughDeck): ToughDiagnostic[] {
  const diags: ToughDiagnostic[] = [];
  const rockSet = new Set(deck.rocks.map((r) => r.name.trim().toUpperCase()));
  const elemSet = new Set(deck.elements.map((e) => e.name.trim()));

  // 1. Rock material property bounds
  for (const r of deck.rocks) {
    if (r.porosity <= 0.0 || r.porosity >= 1.0) {
      diags.push({
        code: ToughErrorCode.INVALID_POROSITY.code,
        rule: ToughErrorCode.INVALID_POROSITY.rule,
        severity: ToughErrorCode.INVALID_POROSITY.severity,
        message: ToughErrorCode.INVALID_POROSITY.message(r.name, r.porosity),
        line: r.line,
      });
    }
  }

  // 2. Element rock references
  for (const el of deck.elements) {
    if (el.rockName && !rockSet.has(el.rockName.trim().toUpperCase())) {
      diags.push({
        code: ToughErrorCode.ROCK_NOT_FOUND.code,
        rule: ToughErrorCode.ROCK_NOT_FOUND.rule,
        severity: ToughErrorCode.ROCK_NOT_FOUND.severity,
        message: ToughErrorCode.ROCK_NOT_FOUND.message(el.name, el.rockName),
        line: el.line,
      });
    }
  }

  // 3. Connection endpoint resolution
  for (let i = 0; i < deck.connections.length; i++) {
    const c = deck.connections[i]!;
    if (!elemSet.has(c.elem1.trim())) {
      diags.push({
        code: ToughErrorCode.DANGLING_CONNECTION.code,
        rule: ToughErrorCode.DANGLING_CONNECTION.rule,
        severity: ToughErrorCode.DANGLING_CONNECTION.severity,
        message: ToughErrorCode.DANGLING_CONNECTION.message(c.elem1, i + 1),
        line: c.line,
      });
    }
    if (!elemSet.has(c.elem2.trim())) {
      diags.push({
        code: ToughErrorCode.DANGLING_CONNECTION.code,
        rule: ToughErrorCode.DANGLING_CONNECTION.rule,
        severity: ToughErrorCode.DANGLING_CONNECTION.severity,
        message: ToughErrorCode.DANGLING_CONNECTION.message(c.elem2, i + 1),
        line: c.line,
      });
    }
  }

  // 4. Incon temperature checks
  for (const ic of deck.inconds) {
    if (ic.temperature < 0.0) {
      diags.push({
        code: ToughErrorCode.NEGATIVE_TEMPERATURE.code,
        rule: ToughErrorCode.NEGATIVE_TEMPERATURE.rule,
        severity: ToughErrorCode.NEGATIVE_TEMPERATURE.severity,
        message: ToughErrorCode.NEGATIVE_TEMPERATURE.message(ic.elem, ic.temperature),
        line: ic.line,
      });
    }
  }

  return diags;
}
