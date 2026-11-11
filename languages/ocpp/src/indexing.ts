// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseOcpp } from "./parser/ocpp-parser.js";
import type { OcppNetwork } from "./types.js";

export function indexOcppFile(ctx: DslIndexFileContext): void {
  const network = parseOcpp(ctx.text);
  ctx.setParsedModel(network);

  for (const station of network.stations) {
    const stationId = ctx.addSymbol(
      station.id,
      "Component",
      null,
      0,
      ctx.text.length,
      {
        model: station.model,
        vendor: station.vendor,
        gridLimitKW: station.gridLimitKW,
        line: station.line,
      },
      {
        ruleName: "charging_station",
        namePath: station.id,
      },
    );

    for (const evse of station.evses) {
      const evseName = `EVSE_${evse.id}`;
      const evseId = ctx.addSymbol(
        evseName,
        "Component",
        stationId,
        0,
        0,
        { evseId: evse.id, line: evse.line },
        {
          ruleName: "evse",
          namePath: `${station.id}.${evseName}`,
        },
      );

      for (const conn of evse.connectors) {
        const connName = `Connector_${conn.id}`;
        ctx.addSymbol(
          connName,
          "Port",
          evseId,
          0,
          0,
          {
            connectorId: conn.id,
            connectorType: conn.type,
            maxPowerKW: conn.maxPowerKW,
            status: conn.status,
            line: conn.line,
          },
          {
            ruleName: "connector",
            namePath: `${station.id}.${evseName}.${connName}`,
          },
        );
      }
    }
  }
}

export function getOcppNetwork(workspace: UnifiedWorkspace, uri: string): OcppNetwork | undefined {
  return workspace.getParsedModel<OcppNetwork>(uri);
}

export function getAllOcppStations(workspace: UnifiedWorkspace): OcppNetwork {
  const all = Array.from(workspace.getAllParsedModels<OcppNetwork>().values()).flatMap((n) => n.stations);
  return { stations: all };
}
