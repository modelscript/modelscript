// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parseTouchstone } from "./parser/touchstone-parser.js";

/**
 * Declarative `UnifiedWorkspace` file indexer for Touchstone N-Port network decks (`.s1p` ... `.sNp`, `.ts2`).
 */
export function indexTouchstoneFile(ctx: DslIndexFileContext): void {
  try {
    const deck = parseTouchstone(ctx.text, ctx.uri);
    ctx.setParsedModel(deck);

    const rootName = `Touchstone_${deck.numPorts}Port`;
    const rootId = ctx.addSymbol(
      rootName,
      "package",
      null,
      0,
      ctx.text.length,
      {
        numPorts: deck.numPorts,
        version: deck.version,
        parameterType: deck.options.parameterType,
        referenceResistance: deck.options.referenceResistance,
      },
      { ruleName: "touchstone_symbol" },
    );

    if (deck.points.length > 0) {
      const fMin = deck.points[0]!.frequencyHz;
      const fMax = deck.points[deck.points.length - 1]!.frequencyHz;
      ctx.addSymbol(
        "FrequencySweep",
        "constant",
        rootId,
        0,
        50,
        {
          fMin,
          fMax,
          numPoints: deck.points.length,
          unit: deck.options.frequencyUnit,
        },
        { ruleName: "touchstone_symbol" },
      );
    }

    for (let p = 1; p <= deck.numPorts; p++) {
      ctx.addSymbol(
        `Port_${p}`,
        "variable",
        rootId,
        0,
        50,
        {
          portIndex: p,
          impedance: deck.options.referenceResistance,
        },
        { ruleName: "touchstone_symbol" },
      );
    }

    for (let r = 1; r <= deck.numPorts; r++) {
      for (let c = 1; c <= deck.numPorts; c++) {
        ctx.addSymbol(
          `S${r}${c}`,
          "property",
          rootId,
          0,
          50,
          {
            row: r,
            col: c,
          },
          { ruleName: "touchstone_symbol" },
        );
      }
    }
  } catch {
    // Preserve empty symbol table if parsing fails
  }
}
