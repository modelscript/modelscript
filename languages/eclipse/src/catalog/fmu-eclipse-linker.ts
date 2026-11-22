// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EclipseLinkedPhysicsInstance, EclipseModelEvalOutput, EclipseModelIO } from "./wasm-eclipse-loader.js";

export interface EclipseFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface EclipseFmuDescriptor {
  modelName: string;
  variables: EclipseFmuVariableDescriptor[];
}

export interface EclipseFmuProjection {
  modelName: string;
  udqDeckBlock: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into an ECLIPSE `UDQ` / `UDT` user-defined keyword block
 * so proprietary or external surface-network / EOS / well-control FMUs can be linked alongside
 * cleanroom `@modelscript/eclipse-std-lib` models.
 */
export function fmuToEclipseUdq(fmu: EclipseFmuDescriptor, wellOrRegion = "FIELD"): EclipseFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const lines: string[] = [`-- Linked FMI 2.0/3.0 FMU: ${fmu.modelName} (${wellOrRegion})`, "UDQ"];
  for (const p of params) {
    const cleanName = p.name
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_")
      .slice(0, 7);
    lines.push(`  ASSIGN FU_${cleanName} ${(p.start ?? 0.0).toString()} /`);
  }
  lines.push("/");
  return {
    modelName: fmu.modelName,
    udqDeckBlock: lines.join("\n"),
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into an `EclipseLinkedPhysicsInstance` compatible with
 * cleanroom WASM models.
 */
export function createFmuEclipseInstance(
  id: string,
  modelName: string,
  evalFn: (io: EclipseModelIO) => Partial<EclipseModelEvalOutput>,
): EclipseLinkedPhysicsInstance {
  return {
    id,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    eval(io) {
      const partial = evalFn(io);
      return {
        out0: partial.out0 ?? 0,
        out1: partial.out1 ?? 0,
        out2: partial.out2 ?? 0,
        out3: partial.out3 ?? 0,
      };
    },
  };
}
