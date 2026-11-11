// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/qif — Declarative UnifiedWorkspace Indexing & Scope Helpers.
 *
 * Indexes ISO 23952 / ANSI DMSC QIF 3.0 files (.qif, .qif.xml):
 * datum definitions, features, GD&T characteristics, measurement devices,
 * inspection plan steps, and metrology actuals.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseQif } from "./parser/index.js";

export const qifIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".qif") || lower.endsWith(".qif.xml")) return true;
    return Boolean(text && (text.includes("<QIFDocument") || /^\s*QIF\s+3\./m.test(text)));
  },

  indexFile(ctx: DslIndexFileContext): void {
    const doc = parseQif(ctx.text, ctx.uri);
    ctx.setParsedModel(doc);

    // 1. Index Datum Definitions
    for (const d of doc.datumDefinitions) {
      ctx.addSymbol(
        d.label,
        "Constant",
        null,
        d.range.startOffset,
        d.range.endOffset,
        {
          datumId: d.id,
          qpId: d.qpId,
          featureId: d.featureId,
        },
        {
          ruleName: "qif_datum",
          namePath: d.label,
          aliases: d.id && d.id !== d.label ? [d.id] : [],
        },
      );
    }

    // 2. Index Features
    for (const f of doc.features) {
      ctx.addSymbol(
        f.name,
        "Component",
        null,
        f.range.startOffset,
        f.range.endOffset,
        {
          featureId: f.id,
          qpId: f.qpId,
          featureType: f.featureType,
          isFeatureOfSize: f.isFeatureOfSize,
          nominalSize: f.nominalSize,
          stepEntityId: f.stepEntityId,
          probingPoints: f.probingPoints,
        },
        {
          ruleName: "qif_feature",
          namePath: f.name,
          aliases: f.id && f.id !== f.name ? [f.id] : [],
        },
      );
    }

    // 3. Index Characteristics & Child Actuals
    for (const c of doc.characteristics) {
      const charSymId = ctx.addSymbol(
        c.name,
        "Property",
        null,
        c.range.startOffset,
        c.range.endOffset,
        {
          characteristicId: c.id,
          qpId: c.qpId,
          gdtType: c.gdtType,
          toleranceZone: c.toleranceZone,
          materialCondition: c.materialCondition,
          balloonNumber: c.balloonNumber,
        },
        {
          ruleName: "qif_characteristic",
          namePath: c.name,
          aliases: c.id && c.id !== c.name ? [c.id] : [],
        },
      );

      const matchingActuals = doc.actuals.filter(
        (a) => a.characteristicId === c.id || (c.qpId && a.characteristicId === c.qpId),
      );
      for (const act of matchingActuals) {
        ctx.addSymbol(
          act.id,
          "Variable",
          charSymId,
          act.range.startOffset,
          act.range.endOffset,
          {
            partSerialNumber: act.partSerialNumber,
            measuredValue: act.measuredValue,
            actualFeatureSize: act.actualFeatureSize,
            status: act.status,
          },
          {
            ruleName: "qif_actual",
            namePath: `${c.name}.${act.id}`,
          },
        );
      }
    }

    // 4. Index Measurement Devices
    for (const dev of doc.devices) {
      ctx.addSymbol(
        dev.name,
        "Class",
        null,
        dev.range.startOffset,
        dev.range.endOffset,
        {
          deviceId: dev.id,
          qpId: dev.qpId,
          deviceType: dev.deviceType,
          calibrationUncertainty: dev.calibrationUncertainty,
        },
        {
          ruleName: "qif_device",
          namePath: dev.name,
          aliases: dev.id && dev.id !== dev.name ? [dev.id] : [],
        },
      );
    }

    // 5. Index Plan Steps
    for (const step of doc.planSteps) {
      ctx.addSymbol(
        step.id,
        "Event",
        null,
        step.range.startOffset,
        step.range.endOffset,
        {
          stepNumber: step.stepNumber,
          featureId: step.featureId,
          characteristicId: step.characteristicId,
          deviceId: step.deviceId,
          probingPointCount: step.probingPointCount,
        },
        {
          ruleName: "qif_plan_step",
          namePath: step.id,
        },
      );
    }
  },
};

/**
 * Resolves a QIF symbol in a characteristic/local scope or across the workspace.
 */
export function resolveQifInScope(
  workspace: UnifiedWorkspace,
  name: string,
  scopeId: SymbolId | null,
  uri: string,
): SymbolEntry | null {
  const fileIdx = workspace.getFileIndex(uri);
  if (fileIdx && scopeId !== null) {
    const children = fileIdx.childrenOf.get(scopeId);
    if (children) {
      for (const cid of children) {
        const sym = fileIdx.symbols.get(cid);
        if (sym && sym.name.toLowerCase() === name.toLowerCase()) {
          return sym;
        }
      }
    }
  }

  const matches = workspace.findSymbolsByName(name);
  return matches[0] ?? null;
}
