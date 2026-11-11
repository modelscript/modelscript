// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseGproms } from "./parser/gproms-parser.js";
import type { GpromsDocument } from "./types.js";

/**
 * Indexes a gPROMS Process Modeling Language (.gproms, .pml) document into UnifiedWorkspace.
 */
export function indexGpromsDocument(ctx: DslIndexFileContext): void {
  try {
    const doc = parseGproms(ctx.text, ctx.uri);
    ctx.setParsedModel(doc);

    // Index DECLARE TYPE definitions
    for (const [tName, vt] of doc.variableTypes) {
      const start = vt.range?.startOffset ?? 0;
      const end = vt.range?.endOffset ?? 50;
      ctx.addSymbol(
        tName,
        "type",
        null,
        start,
        end,
        {
          defaultValue: vt.defaultValue,
          lowerBound: vt.lowerBound,
          upperBound: vt.upperBound,
          unit: vt.unit,
        },
        {
          ruleName: "gproms_symbol",
          namePath: tName,
        },
      );
    }

    // Index MODEL blocks and their members
    for (const [mName, m] of doc.models) {
      const mStart = m.range?.startOffset ?? 0;
      const mEnd = m.range?.endOffset ?? ctx.text.length;
      const modelSymId = ctx.addSymbol(
        mName,
        "class",
        null,
        mStart,
        mEnd,
        {
          parameterCount: m.parameters.size,
          variableCount: m.variables.size,
          equationCount: m.equations.length,
        },
        {
          ruleName: "gproms_symbol",
          namePath: mName,
        },
      );

      for (const [pName, p] of m.parameters) {
        const start = p.range?.startOffset ?? mStart;
        const end = p.range?.endOffset ?? start + 20;
        ctx.addSymbol(
          pName,
          "constant",
          modelSymId,
          start,
          end,
          {
            dataType: p.dataType,
            defaultValue: p.defaultValue,
            unit: p.unit,
          },
          {
            ruleName: "gproms_symbol",
            namePath: pName,
          },
        );
      }

      for (const [dName, dom] of m.domains) {
        const start = dom.range?.startOffset ?? mStart;
        const end = dom.range?.endOffset ?? start + 20;
        ctx.addSymbol(
          dName,
          "struct",
          modelSymId,
          start,
          end,
          {
            lowerBound: dom.lowerBound,
            upperBound: dom.upperBound,
            gridPoints: dom.gridPoints,
          },
          {
            ruleName: "gproms_symbol",
            namePath: dName,
          },
        );
      }

      for (const [vName, v] of m.variables) {
        const start = v.range?.startOffset ?? mStart;
        const end = v.range?.endOffset ?? start + 20;
        ctx.addSymbol(
          vName,
          "variable",
          modelSymId,
          start,
          end,
          {
            typeName: v.typeName,
            domains: v.domains,
          },
          {
            ruleName: "gproms_symbol",
            namePath: vName,
          },
        );
      }
    }

    // Index PROCESS blocks
    for (const [procName, proc] of doc.processes) {
      const pStart = proc.range?.startOffset ?? 0;
      const pEnd = proc.range?.endOffset ?? ctx.text.length;
      ctx.addSymbol(
        procName,
        "module",
        null,
        pStart,
        pEnd,
        {
          unitCount: proc.units.size,
          assignCount: proc.assignEntries.length,
          initialCount: proc.initialEntries.length,
        },
        {
          ruleName: "gproms_symbol",
          namePath: procName,
        },
      );
    }
  } catch {
    // Ignore parse errors during incremental workspace indexing
  }
}

/**
 * Retrieves a cached parsed gPROMS document from a UnifiedWorkspace.
 */
export function getGpromsDocument(workspace: UnifiedWorkspace, uri: string): GpromsDocument | undefined {
  return workspace.getParsedModel<GpromsDocument>(uri);
}
