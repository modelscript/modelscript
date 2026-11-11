// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sedml — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes Simulation Experiment Description Markup Language documents (.sedml, .xml) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseSedml } from "./parser/sedml-parser.js";

export const sedmlIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".sedml") || lower.endsWith(".sedml.xml")) return true;
    return Boolean(text && text.includes("<sedML"));
  },

  indexFile(ctx: DslIndexFileContext): void {
    try {
      const doc = parseSedml(ctx.text, ctx.uri);
      ctx.setParsedModel(doc);

      // Root Experiment symbol
      const rootId = ctx.addSymbol(
        "SedmlExperiment",
        "package",
        null,
        0,
        ctx.text.length,
        {
          level: doc.level,
          version: doc.version,
          simulationCount: doc.simulations.length,
          modelCount: doc.models.length,
          taskCount: doc.tasks.length,
          dataGeneratorCount: doc.dataGenerators.length,
          outputCount: doc.outputs.length,
        },
        {
          ruleName: "sedml_symbol",
          namePath: "SedmlExperiment",
        },
      );

      // Index Simulations
      for (const sim of doc.simulations) {
        const start = sim.range?.startOffset ?? 0;
        const end = sim.range?.endOffset ?? 50;
        ctx.addSymbol(
          sim.id,
          "event",
          rootId,
          start,
          end,
          {
            name: sim.name,
            type: sim.type,
            kisaoID: sim.algorithm?.kisaoID,
            initialTime: sim.initialTime,
            outputStartTime: sim.outputStartTime,
            outputEndTime: sim.outputEndTime,
            numberOfSteps: sim.numberOfSteps,
          },
          {
            ruleName: "sedml_symbol",
            namePath: sim.id,
          },
        );
      }

      // Index Models
      for (const m of doc.models) {
        const start = m.range?.startOffset ?? 0;
        const end = m.range?.endOffset ?? 50;
        ctx.addSymbol(
          m.id,
          "struct",
          rootId,
          start,
          end,
          {
            name: m.name,
            language: m.language,
            source: m.source,
            changeCount: m.changes.length,
          },
          {
            ruleName: "sedml_symbol",
            namePath: m.id,
          },
        );
      }

      // Index Tasks
      for (const t of doc.tasks) {
        const start = t.range?.startOffset ?? 0;
        const end = t.range?.endOffset ?? 50;
        ctx.addSymbol(
          t.id,
          "function",
          rootId,
          start,
          end,
          {
            name: t.name,
            type: t.type,
            modelReference: t.modelReference,
            simulationReference: t.simulationReference,
          },
          {
            ruleName: "sedml_symbol",
            namePath: t.id,
          },
        );
      }

      // Index DataGenerators
      for (const dg of doc.dataGenerators) {
        const start = dg.range?.startOffset ?? 0;
        const end = dg.range?.endOffset ?? 50;
        ctx.addSymbol(
          dg.id,
          "variable",
          rootId,
          start,
          end,
          {
            name: dg.name,
            math: dg.math,
            variableCount: dg.variables.length,
            parameterCount: dg.parameters.length,
          },
          {
            ruleName: "sedml_symbol",
            namePath: dg.id,
          },
        );
      }

      // Index Outputs
      for (const out of doc.outputs) {
        const start = out.range?.startOffset ?? 0;
        const end = out.range?.endOffset ?? 50;
        ctx.addSymbol(
          out.id,
          "interface",
          rootId,
          start,
          end,
          {
            name: out.name,
            type: out.type,
            curveCount: out.curves.length,
            dataSetCount: out.dataSets.length,
          },
          {
            ruleName: "sedml_symbol",
            namePath: out.id,
          },
        );
      }
    } catch {
      // Return partial symbol map if parsing failed
    }
  },
};
