// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for US EPA EPANET network files (.inp).
 * Indexes junctions, reservoirs, tanks, pipes, pumps, valves, and curves.
 */

import { BaseWorkspaceIndex, type SymbolId, type SymbolIndex } from "@modelscript/runtime";
import { parseInp } from "./parser/index.js";
import type { EpanetNetwork } from "./types.js";

export type EpanetDocumentLoader = () => string | EpanetNetwork | null | undefined;

export class EpanetWorkspaceIndex extends BaseWorkspaceIndex<EpanetNetwork> {
  public readonly languageName = "epanet";

  public indexFile(uri: string, text: string): SymbolIndex {
    this.indexSource(uri, text);
    return this.getFileIndex(uri)!;
  }

  public indexSource(uri: string, source: string): void {
    const net = parseInp(source, uri);
    this.indexDocument(uri, net);
  }

  public indexDocument(uri: string, net: EpanetNetwork): void {
    this._version++;
    this.fileDecks.set(uri, net);

    const { addSymbol } = this.createIndexContext(uri);
    const addSym = (name: string, kind: string, parentId: SymbolId | null = null, extra?: Record<string, unknown>) =>
      addSymbol(name, kind, parentId, 0, 0, extra);

    // 1. Title Symbol
    let titleSymId: SymbolId | null = null;
    if (net.title) {
      titleSymId = addSym(net.title, "network", null, {
        units: net.options.units,
        headloss: net.options.headloss,
      });
    }

    // 2. Junctions
    for (const j of net.junctions) {
      addSym(j.id, "junction", titleSymId, {
        elevation: j.elevation,
        demand: j.demand,
      });
    }

    // 3. Reservoirs & Tanks
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

    // 4. Pipes
    for (const p of net.pipes) {
      addSym(p.id, "pipe", titleSymId, {
        node1: p.node1,
        node2: p.node2,
        length: p.length,
        diameter: p.diameter,
        roughness: p.roughness,
      });
    }

    // 5. Pumps & Valves
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
}
