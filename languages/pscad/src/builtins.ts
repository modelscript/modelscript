// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslBuiltinSymbol } from "@modelscript/dsl";
import { getMasterLibrarySchemas, type PscadComponentSchema } from "./catalog/master-library-schemas.js";

export const PSCAD_MASTER_RESOURCE_ID = "builtin://pscad";

function buildPscadComponentSymbol(schema: PscadComponentSchema): DslBuiltinSymbol {
  const children: DslBuiltinSymbol[] = [];

  for (const p of schema.parameters) {
    const typeName = p.kind === "number" ? "Real" : p.kind === "boolean" ? "Boolean" : "String";
    children.push({
      name: p.key,
      kind: "Variable",
      ruleName: "pscad_parameter",
      resourceId: PSCAD_MASTER_RESOURCE_ID,
      metadata: {
        typeName,
        variability: "parameter",
        defaultValue: String(p.defaultValue),
        unit: p.unit,
        description: p.description,
      },
    });
  }

  for (const port of schema.ports) {
    const isSignal = port.kind === "signal";
    const typeName = isSignal ? "PSCAD.Interfaces.SignalInput" : "PSCAD.Interfaces.ElectricalPin";
    children.push({
      name: port.name,
      kind: "Port",
      ruleName: "pscad_port",
      resourceId: PSCAD_MASTER_RESOURCE_ID,
      metadata: {
        typeName,
        causality: isSignal ? "input" : "inout",
        domain: port.kind,
        side: port.side,
        offsetX: port.offsetX,
        offsetY: port.offsetY,
        isConnector: true,
      },
    });
  }

  return {
    name: schema.className,
    kind: "Class",
    ruleName: "pscad_component",
    resourceId: PSCAD_MASTER_RESOURCE_ID,
    metadata: {
      classPrefixes: ["model"],
      classKind: "model",
      language: "pscad",
      category: schema.category,
      domain: schema.domain,
      description: schema.description,
    },
    children,
  };
}

/**
 * Materializes the built-in `PSCAD` Master Library package into `UnifiedWorkspace`
 * so PSCAD components resolve directly by qualified name (`PSCAD.<ClassName>`)
 * without black-box wrappers.
 */
export function buildPscadBuiltinSymbols(): DslBuiltinSymbol[] {
  const children: DslBuiltinSymbol[] = [
    {
      name: "Interfaces",
      kind: "Class",
      ruleName: "pscad_package",
      resourceId: PSCAD_MASTER_RESOURCE_ID,
      metadata: {
        classPrefixes: ["package"],
        classKind: "package",
        language: "pscad",
        description: "3-phase EMT electrical and CSMF control signal connectors for PSCAD components.",
      },
      children: [
        {
          name: "ElectricalPin",
          kind: "Class",
          ruleName: "pscad_connector",
          resourceId: PSCAD_MASTER_RESOURCE_ID,
          metadata: {
            classPrefixes: ["connector"],
            classKind: "connector",
            causality: "inout",
            isConnector: true,
            baseType: "Real",
            description: "EMT electrical nodal terminal (v, i).",
          },
        },
        {
          name: "SignalInput",
          kind: "Class",
          ruleName: "pscad_connector",
          resourceId: PSCAD_MASTER_RESOURCE_ID,
          metadata: {
            classPrefixes: ["connector"],
            classKind: "connector",
            causality: "input",
            isConnector: true,
            baseType: "Real",
            description: "CSMF scalar control input signal.",
          },
        },
        {
          name: "SignalOutput",
          kind: "Class",
          ruleName: "pscad_connector",
          resourceId: PSCAD_MASTER_RESOURCE_ID,
          metadata: {
            classPrefixes: ["connector"],
            classKind: "connector",
            causality: "output",
            isConnector: true,
            baseType: "Real",
            description: "CSMF scalar control output signal.",
          },
        },
      ],
    },
  ];

  const seen = new Set<string>(["Interfaces"]);
  for (const schema of getMasterLibrarySchemas()) {
    if (seen.has(schema.className)) continue;
    seen.add(schema.className);
    children.push(buildPscadComponentSymbol(schema));
  }

  return [
    {
      name: "PSCAD",
      kind: "Class",
      ruleName: "pscad_package",
      resourceId: PSCAD_MASTER_RESOURCE_ID,
      metadata: {
        classPrefixes: ["package"],
        classKind: "package",
        language: "pscad",
        description: "PSCAD v5 Master Library EMT power system and CSMF control components.",
      },
      children,
    },
  ];
}
