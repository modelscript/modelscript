// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  parseModelDescription,
  parseTerminalsAndIcons,
  type FmiModelDescription,
  type FmiTerminal,
} from "@modelscript/exchange";
import type { DiagramComponentSpec, DiagramPortSpec, LibrarySymbolStub } from "@modelscript/runtime";
import { registerPscadLibraryBundle, schemasToLibraryPayloads } from "./library-package-adapter.js";
import type { PscadComponentSchema, PscadParameterSchema, PscadPortSchema } from "./master-library-schemas.js";

/**
 * Converts an FMU's `modelDescription.xml` and optional FMI 3.0 `terminalsAndIcons.xml`
 * into a PSCAD component schema, `LibrarySymbolStub`, and `DiagramComponentSpec`.
 */
export function fmuToPscadComponent(
  modelDescriptionXml: string,
  terminalsAndIconsXml?: string,
  options?: {
    className?: string | undefined;
    svgIcon?: string | undefined;
  },
): {
  schema: PscadComponentSchema;
  symbol: LibrarySymbolStub;
  diagram: DiagramComponentSpec;
  modelDescription: FmiModelDescription;
  terminals: FmiTerminal[];
} {
  const desc = parseModelDescription(modelDescriptionXml);
  const terminals = terminalsAndIconsXml ? parseTerminalsAndIcons(terminalsAndIconsXml) : [];
  const className = options?.className ?? `fmu:${desc.modelName}`;

  const parameters: PscadParameterSchema[] = [];
  const ports: PscadPortSchema[] = [];

  for (const v of desc.variables ?? []) {
    if (v.causality === "parameter" || v.causality === "calculatedParameter") {
      const kind: PscadParameterSchema["kind"] =
        v.type === "Boolean" ? "boolean" : v.type === "String" ? "string" : "number";
      parameters.push({
        key: v.name,
        label: v.name,
        tab: "General",
        group: "FMU Parameters",
        kind,
        unit: v.unit,
        defaultValue: v.start !== undefined ? v.start : kind === "boolean" ? false : kind === "string" ? "" : 0,
        description: v.description ?? `FMU parameter ${v.name}`,
      });
    }
  }

  // Prefer FMI 3.0 Terminals when present (gives grouped electrical/signal ports + coordinates)
  if (terminals.length > 0) {
    let leftIdx = 0;
    let rightIdx = 0;
    for (const term of terminals) {
      const isElectrical =
        term.terminalKind?.toLowerCase().includes("electr") ||
        term.memberVariables.some((m) => m.variableKind === "potential" || m.variableKind === "flow");
      const pos = term.graphicalRepresentation;
      const side: PscadPortSchema["side"] =
        pos?.x !== undefined ? (pos.x < 0 ? "left" : "right") : isElectrical ? "right" : "left";
      const offsetX = pos?.x ?? (side === "left" ? -36 : 36);
      const offsetY = pos?.y ?? (side === "left" ? -20 + leftIdx++ * 20 : -20 + rightIdx++ * 20);

      ports.push({
        name: term.name,
        kind: isElectrical ? "electrical" : "signal",
        side,
        offsetX,
        offsetY,
      });
    }
  } else {
    // Fallback: map FMI input/output scalar variables to left/right signal ports
    let inIdx = 0;
    let outIdx = 0;
    for (const v of desc.variables ?? []) {
      if (v.causality === "input") {
        ports.push({
          name: v.name,
          kind: "signal",
          side: "left",
          offsetX: -36,
          offsetY: -20 + inIdx++ * 20,
        });
      } else if (v.causality === "output") {
        ports.push({
          name: v.name,
          kind: "signal",
          side: "right",
          offsetX: 36,
          offsetY: -20 + outIdx++ * 20,
        });
      }
    }
  }

  const height = Math.max(60, Math.max(ports.length, 2) * 24);
  const schema: PscadComponentSchema = {
    className,
    aliases: [desc.modelName, `master:${desc.modelName}`],
    label: desc.modelName,
    category: "Power Electronics, HVDC & FACTS",
    domain: ports.some((p) => p.kind === "electrical") ? "electrical" : "control",
    description: desc.description ?? `FMI ${desc.fmiVersion} component (${desc.modelName})`,
    defaultWidth: 72,
    defaultHeight: height,
    ports,
    parameters,
  };

  const { symbols, diagrams } = schemasToLibraryPayloads([schema]);
  const symbol = symbols[0]!;
  const diagram: DiagramComponentSpec = {
    ...diagrams[0]!,
    ports: diagrams[0]!.ports as DiagramPortSpec[],
    ...(options?.svgIcon ? { svg: options.svgIcon } : {}),
  };

  return { schema, symbol, diagram, modelDescription: desc, terminals };
}

/**
 * Registers one or more FMU-backed components into `globalLibraryRegistry` as a
 * `package.json#modelscript` PSCAD library so they appear in LSP, DiagramBuilder, and EmtSolver.
 */
export function registerFmuComponentsAsPscadLibrary(
  packageName: string,
  entries: Array<{
    modelDescriptionXml: string;
    terminalsAndIconsXml?: string | undefined;
    className?: string | undefined;
    svgIcon?: string | undefined;
  }>,
  wasmBytes?: Uint8Array,
) {
  const symbols: LibrarySymbolStub[] = [];
  const diagrams: DiagramComponentSpec[] = [];

  for (const e of entries) {
    const converted = fmuToPscadComponent(e.modelDescriptionXml, e.terminalsAndIconsXml, {
      className: e.className,
      svgIcon: e.svgIcon,
    });
    symbols.push(converted.symbol);
    diagrams.push(converted.diagram);
  }

  return registerPscadLibraryBundle(
    {
      name: packageName,
      version: "1.0.0",
      modelscript: {
        category: "library",
        language: "pscad",
        symbols: "./dist/symbols.json",
        diagrams: "./dist/diagrams.json",
        ...(wasmBytes ? { runtime: { wasm: "./dist/runtime.wasm" } } : {}),
      },
    },
    { symbols, diagrams, wasmBytes },
  );
}
