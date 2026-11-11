// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseOpenRoadmTopology } from "./parser/openroadm-parser.js";
import { parseSor } from "./sor/sor-parser.js";
import type { SorDocument } from "./sor/sor-types.js";
import type { OpticalTopology } from "./types.js";

/**
 * Declarative file indexer for optical networks (.sor OTDR binary files and OpenROADM/GNPy topologies).
 */
export function indexOpticalFile(ctx: DslIndexFileContext): void {
  try {
    if (ctx.extension === ".sor" || ctx.uri.toLowerCase().endsWith(".sor")) {
      const bytes = ctx.text.startsWith("base64:")
        ? Buffer.from(ctx.text.slice(7), "base64")
        : Buffer.from(ctx.text, "latin1");
      const sorDoc = parseSor(bytes);
      ctx.setParsedModel(sorDoc, "sor");
      ctx.setParsedModel(sorDoc);

      const fiberName = sorDoc.genParams.fiberId || sorDoc.genParams.cableId || "OTDR_Trace";
      const rootSymId = ctx.addSymbol(
        fiberName,
        "package",
        null,
        0,
        0,
        {
          wavelength: sorDoc.genParams.nominalWavelengthNm,
          fiberType: sorDoc.genParams.fiberType,
        },
        {
          ruleName: "otdr_trace",
          namePath: fiberName,
        },
      );

      for (const ev of sorDoc.keyEvents) {
        const evName = `Event_${ev.eventNumber}_${ev.eventType}_${Math.round(ev.distanceMeters)}m`;
        ctx.addSymbol(
          evName,
          "property",
          rootSymId,
          0,
          0,
          {
            eventType: ev.eventType,
            distanceMeters: ev.distanceMeters,
            lossDb: ev.eventLossDb,
          },
          {
            ruleName: "otdr_event",
            namePath: evName,
          },
        );
      }
      return;
    }

    if (ctx.text) {
      const topo = parseOpenRoadmTopology(ctx.text);
      ctx.setParsedModel(topo, "topology");
      ctx.setParsedModel(topo);

      const rootSymId = ctx.addSymbol(
        topo.name,
        "package",
        null,
        0,
        0,
        {
          nodeCount: topo.nodes.size,
          spanCount: topo.spans.size,
        },
        {
          ruleName: "optical_topology",
          namePath: topo.name,
        },
      );

      for (const node of topo.nodes.values()) {
        ctx.addSymbol(
          node.name,
          "class",
          rootSymId,
          0,
          0,
          {
            nodeType: node.nodeType,
            degrees: node.degrees.length,
          },
          {
            ruleName: "optical_node",
            namePath: node.name,
          },
        );
      }

      for (const span of topo.spans.values()) {
        ctx.addSymbol(
          span.id,
          "component",
          rootSymId,
          0,
          0,
          {
            lengthKm: span.lengthKm,
            fiberType: span.fiberType,
          },
          {
            ruleName: "optical_span",
            namePath: span.id,
          },
        );
      }
    }
  } catch {
    // Preserve empty index if parsing fails
  }
}

export function setOpticalSorDocument(workspace: UnifiedWorkspace, uri: string, bytes: Uint8Array): void {
  workspace.setDocument(uri, Buffer.from(bytes).toString("latin1"));
}

export function getOpticalSorDocument(workspace: UnifiedWorkspace, uri: string): SorDocument | undefined {
  return workspace.getParsedModel<SorDocument>(uri, "sor");
}

export function getOpticalTopology(workspace: UnifiedWorkspace, uri: string): OpticalTopology | undefined {
  return workspace.getParsedModel<OpticalTopology>(uri, "topology");
}
