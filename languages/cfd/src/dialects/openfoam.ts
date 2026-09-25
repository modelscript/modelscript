// SPDX-License-Identifier: AGPL-3.0-or-later

import { materializeCfdConfig } from "../materializer.js";
import type { CfdDialect, CfdModelData, MaterializeOptions } from "../types.js";

/**
 * OpenFOAM case dictionary dialect implementation stub.
 */
export class OpenFoamDialect implements CfdDialect {
  public readonly id = "openfoam";
  public readonly name = "OpenFOAM Case Dictionaries";
  public readonly extensions = [".foam", "controlDict"];

  public materialize(templateText: string, options?: MaterializeOptions): string {
    return materializeCfdConfig(templateText, options);
  }

  public parse(content: string): CfdModelData {
    const rawDirectives = new Map<string, string>();
    const lines = content.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//")) continue;
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        rawDirectives.set(parts[0], parts[1].replace(/;$/, ""));
      }
    }

    return {
      dialect: this.id,
      wallMarkers: [],
      directives: rawDirectives,
      rawDirectives,
      markers: new Map(),
    };
  }
}
