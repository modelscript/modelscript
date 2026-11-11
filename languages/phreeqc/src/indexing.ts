// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, UnifiedWorkspace } from "@modelscript/runtime";
import { parsePhreeqc } from "./parser/phreeqc-parser.js";
import type { PhreeqcDocument } from "./types.js";

/**
 * Declarative multi-file indexer for USGS PHREEQC input decks and thermodynamic databases (.pqi, .dat).
 */
export function indexPhreeqcFile(ctx: DslIndexFileContext): void {
  try {
    const doc = parsePhreeqc(ctx.text, ctx.uri);
    ctx.setParsedModel(doc);

    const rootName = doc.title ?? "PhreeqcDeck";
    const rootId = ctx.addSymbol(
      rootName,
      "package",
      null,
      0,
      ctx.text.length,
      {
        title: doc.title,
        solutionCount: doc.solutions.size,
        equilibriumPhaseCount: doc.equilibriumPhases.length,
        kineticsCount: doc.kinetics.length,
      },
      {
        ruleName: "phreeqc_symbol",
        namePath: rootName,
      },
    );

    // Index Solutions and Solutes
    for (const [, sol] of doc.solutions) {
      const solStart = sol.range?.startOffset ?? 0;
      const solEnd = sol.range?.endOffset ?? 50;
      const solSymName = `SOLUTION_${sol.number}`;
      const solId = ctx.addSymbol(
        solSymName,
        "struct",
        rootId,
        solStart,
        solEnd,
        {
          number: sol.number,
          name: sol.name,
          temp: sol.temp,
          pH: sol.pH,
          pe: sol.pe,
          units: sol.units,
        },
        {
          ruleName: "phreeqc_symbol",
          namePath: solSymName,
        },
      );

      for (const [elem, conc] of sol.solutes) {
        const spec = sol.soluteSpecs?.get(elem);
        const sStart = spec?.range?.startOffset ?? solStart;
        const sEnd = spec?.range?.endOffset ?? solEnd;
        ctx.addSymbol(
          elem,
          "variable",
          solId,
          sStart,
          sEnd,
          {
            concentration: conc,
            units: spec?.units ?? sol.units,
            solutionNumber: sol.number,
          },
          {
            ruleName: "phreeqc_symbol",
            namePath: elem,
          },
        );
      }
    }

    // Index Equilibrium Phases
    for (const ep of doc.equilibriumPhases) {
      const start = ep.range?.startOffset ?? 0;
      const end = ep.range?.endOffset ?? 50;
      ctx.addSymbol(
        ep.name,
        "constant",
        rootId,
        start,
        end,
        {
          targetSI: ep.targetSI,
          initialMoles: ep.initialMoles,
          blockNumber: ep.blockNumber,
        },
        {
          ruleName: "phreeqc_symbol",
          namePath: ep.name,
        },
      );
    }

    // Index Reactions
    for (const [, rxn] of doc.reactions) {
      const start = rxn.range?.startOffset ?? 0;
      const end = rxn.range?.endOffset ?? 50;
      const rxnName = `REACTION_${rxn.number}`;
      ctx.addSymbol(
        rxnName,
        "function",
        rootId,
        start,
        end,
        {
          number: rxn.number,
          totalMoles: rxn.totalMoles,
          stepCount: rxn.stepCount,
        },
        {
          ruleName: "phreeqc_symbol",
          namePath: rxnName,
        },
      );
    }

    // Index Kinetics
    for (const kin of doc.kinetics) {
      const start = kin.range?.startOffset ?? 0;
      const end = kin.range?.endOffset ?? 50;
      ctx.addSymbol(
        kin.name,
        "function",
        rootId,
        start,
        end,
        {
          m0: kin.m0,
          rateConstant: kin.rateConstant,
          surfaceArea: kin.surfaceArea,
        },
        {
          ruleName: "phreeqc_symbol",
          namePath: kin.name,
        },
      );
    }

    // Index Mixes
    for (const [, mix] of doc.mixes) {
      const start = mix.range?.startOffset ?? 0;
      const end = mix.range?.endOffset ?? 50;
      const mixName = `MIX_${mix.number}`;
      ctx.addSymbol(
        mixName,
        "struct",
        rootId,
        start,
        end,
        {
          number: mix.number,
          fractions: Object.fromEntries(mix.fractions),
        },
        {
          ruleName: "phreeqc_symbol",
          namePath: mixName,
        },
      );
    }
  } catch {
    // Preserve partial symbol map if parsing failed
  }
}

export function getPhreeqcDocument(workspace: UnifiedWorkspace, uri: string): PhreeqcDocument | undefined {
  return workspace.getParsedModel<PhreeqcDocument>(uri);
}

export function findPhreeqcDefinition(workspace: UnifiedWorkspace, name: string): SymbolEntry | undefined {
  return workspace.findSymbolsByName(name)[0];
}

export function findPhreeqcReferences(workspace: UnifiedWorkspace, name: string): SymbolEntry[] {
  return workspace.findSymbolsByName(name);
}
