// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Declarative Workspace Indexing.
 *
 * Indexes junctions, reservoirs, tanks, pipes, pumps, and valves across US EPA EPANET (.inp) files.
 */

import {
  extractValidWasmCstRoot,
  indexSymbolsFromWasmCst,
  type DslIndexFileContext,
  type WasmCstIndexedSymbol,
} from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseInp } from "./parser/index.js";
import type { EpanetNetwork } from "./types.js";

const EPANET_CST_KIND_MAP: Record<string, string> = {
  IniSectionHeader: "section",
  IniRecord: "record",
};

const EPANET_CST_NAME_FIELDS = ["head", "sectionName", "name", "id"];

export function canIndexEpanet(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".epanet") || lower.endsWith(".epanet.inp")) return true;
  if (text && /\[(JUNCTIONS|RESERVOIRS|PIPES|TANKS|PUMPS|VALVES)\]/i.test(text)) {
    return true;
  }
  return false;
}

export function indexEpanetDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const cstRoot = extractValidWasmCstRoot(ctx.tree);
  const cstSymbols = cstRoot
    ? indexSymbolsFromWasmCst(cstRoot, text, {
        kindMap: EPANET_CST_KIND_MAP,
        nameFields: EPANET_CST_NAME_FIELDS,
      })
    : null;
  const cstByName = new Map<string, WasmCstIndexedSymbol>();
  if (cstSymbols) {
    for (const sym of cstSymbols) {
      const lower = sym.name.toLowerCase();
      if (!cstByName.has(lower)) cstByName.set(lower, sym);
    }
  }

  const net = parseInp(text, uri);
  ctx.setParsedModel(net);

  const addSym = (
    name: string,
    kind: string,
    parentId: number | null = null,
    extra?: Record<string, unknown>,
  ): number => {
    const cst = cstByName.get(name.toLowerCase());
    return ctx.addSymbol(name, kind, parentId, cst?.startOffset ?? 0, cst?.endOffset ?? 0, extra ?? {}, {
      ruleName: kind,
      namePath: name,
      ...(cst
        ? {
            nameStartOffset: cst.nameStartOffset,
            nameEndOffset: cst.nameEndOffset,
            fieldRanges: { name: { startOffset: cst.nameStartOffset, endOffset: cst.nameEndOffset } },
          }
        : {}),
    });
  };

  let titleSymId: number | null = null;
  if (net.title) {
    titleSymId = addSym(net.title, "network", null, {
      units: net.options.units,
      headloss: net.options.headloss,
    });
  }

  for (const j of net.junctions) {
    addSym(j.id, "junction", titleSymId, {
      elevation: j.elevation,
      demand: j.demand,
    });
  }

  for (const r of net.reservoirs) {
    addSym(r.id, "reservoir", titleSymId, {
      totalHead: r.totalHead,
    });
  }

  for (const t of net.tanks) {
    addSym(t.id, "tank", titleSymId, {
      elevation: t.elevation,
      diameter: t.diameter,
    });
  }

  for (const p of net.pipes) {
    addSym(p.id, "pipe", titleSymId, {
      node1: p.node1,
      node2: p.node2,
      length: p.length,
      diameter: p.diameter,
      roughness: p.roughness,
    });
  }

  for (const pump of net.pumps) {
    addSym(pump.id, "pump", titleSymId, {
      node1: pump.node1,
      node2: pump.node2,
      power: pump.power,
      curveId: pump.headCurveId,
    });
  }

  for (const v of net.valves) {
    addSym(v.id, "valve", titleSymId, {
      node1: v.node1,
      node2: v.node2,
      type: v.type,
      setting: v.setting,
    });
  }
}

export function getEpanetNetwork(workspace: UnifiedWorkspace, uri: string): EpanetNetwork | undefined {
  return workspace.getParsedModel<EpanetNetwork>(uri);
}
