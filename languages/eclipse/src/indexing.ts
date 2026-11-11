// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseEclipse } from "./parser/eclipse-parser.js";
import type { EclipseDeck } from "./types.js";

/**
 * Declarative multi-file workspace indexer for Schlumberger ECLIPSE reservoir decks (.data, .dat, .inc).
 */
export function canIndexEclipse(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".data") || lower.endsWith(".inc")) return true;
  if (lower.endsWith(".dat") && text) {
    return /\b(RUNSPEC|DIMENS|WELSPECS|COMPDAT|SWOF|PVDO)\b/.test(text);
  }
  return false;
}

export function indexEclipseDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  try {
    const deck = parseEclipse(text, uri);
    ctx.setParsedModel(deck);

    const rootName = deck.title || "ReservoirModel";
    const rootId = ctx.addSymbol(
      rootName,
      "package",
      null,
      0,
      text.length,
      {
        units: deck.units,
        startDate: deck.startDate,
        dimensions: deck.dimensions,
      },
      { ruleName: "eclipse_symbol", namePath: rootName },
    );

    if (deck.grid) {
      const start = deck.grid.range?.startOffset ?? 0;
      const end = deck.grid.range?.endOffset ?? 50;
      ctx.addSymbol(
        "ReservoirGrid",
        "struct",
        rootId,
        start,
        end,
        {
          nx: deck.dimensions.nx,
          ny: deck.dimensions.ny,
          nz: deck.dimensions.nz,
          poro: deck.grid.poro,
          permX: deck.grid.permX,
        },
        { ruleName: "eclipse_symbol", namePath: "ReservoirGrid" },
      );
    }

    if (deck.props) {
      const start = deck.props.range?.startOffset ?? 0;
      const end = deck.props.range?.endOffset ?? 50;
      ctx.addSymbol(
        "PVT_Props",
        "class",
        rootId,
        start,
        end,
        {
          pvdoEntries: deck.props.pvdo.length,
          swofEntries: deck.props.swof.length,
        },
        { ruleName: "eclipse_symbol", namePath: "PVT_Props" },
      );
    }

    if (deck.solution) {
      const start = deck.solution.range?.startOffset ?? 0;
      const end = deck.solution.range?.endOffset ?? 50;
      ctx.addSymbol(
        "ReservoirSolution",
        "field",
        rootId,
        start,
        end,
        {
          initialPressure: deck.solution.initialPressure,
          equil: Boolean(deck.solution.equil),
        },
        { ruleName: "eclipse_symbol", namePath: "ReservoirSolution" },
      );
    }

    for (const [name, well] of deck.wells) {
      const start = well.range?.startOffset ?? 0;
      const end = well.range?.endOffset ?? 50;
      ctx.addSymbol(
        name,
        "component",
        rootId,
        start,
        end,
        {
          preferredPhase: well.preferredPhase,
          completions: well.completions.length,
          isProducer: Boolean(well.productionControl),
          isInjector: Boolean(well.injectionControl),
        },
        { ruleName: "eclipse_symbol", namePath: name },
      );
    }
  } catch {
    // Ignore partial parse errors during workspace indexing
  }
}

export function getEclipseDeck(workspace: UnifiedWorkspace, uri: string): EclipseDeck | undefined {
  return workspace.getParsedModel<EclipseDeck>(uri);
}
