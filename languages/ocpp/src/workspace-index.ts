// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseOcpp } from "./parser/ocpp-parser.js";
import type { OcppNetwork } from "./types.js";

export class OcppWorkspaceIndex {
  private readonly networks = new Map<string, OcppNetwork>();

  public indexDocument(uri: string, content: string): void {
    this.networks.set(uri, parseOcpp(content));
  }

  public getNetwork(uri: string): OcppNetwork | undefined {
    return this.networks.get(uri);
  }

  public getAllStations(): OcppNetwork {
    const all = Array.from(this.networks.values()).flatMap((n) => n.stations);
    return { stations: all };
  }

  public clear(): void {
    this.networks.clear();
  }
}
