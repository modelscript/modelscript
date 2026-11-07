// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/autosar — Bidirectional Triple Graph Grammar (TGG) Rules.
 *
 * Establishes declarative bijective and symmetric transformation rules mapping
 * AUTOSAR Classic & Adaptive SW-Components, R/P-Ports, Runnables, and Assembly
 * Connectors to SysML v2 Part Definitions, Directed Ports, Actions, and Connections.
 */

import { tggComplement, tggEq, tggReconcile, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const autosarTggRules = [
  // 1. AUTOSAR SW-Component <-> SysML v2 Part Definition
  tggRule({
    name: "AutosarSwcToSysmlPartDef",
    sourceLang: "autosar",
    targetLang: "sysml2",
    source: ($, v) =>
      $.SwComponent({
        shortName: v("swcName"),
        kind: v("swcKind"),
      }),
    target: ($, v) =>
      $.PartDefinition({
        name: v("swcName"),
        stereotype: v("swcKind"),
      }),
    where: (v) => [
      tggEq(v("swcName"), v("swcName")),
      tggReconcile(v("swcName"), v("swcName"), "target-wins"),
      tggComplement(["kind", "internalBehaviorShortName", "range"]),
    ],
  }),

  // 2. AUTOSAR R-Port-Prototype (required) <-> SysML v2 In Port
  tggRule({
    name: "AutosarRPortToSysmlInPort",
    sourceLang: "autosar",
    targetLang: "sysml2",
    source: ($, v) =>
      $.PortPrototype({
        shortName: v("portName"),
        direction: "required",
      }),
    target: ($, v) =>
      $.PortUsage({
        name: v("portName"),
        direction: "in",
      }),
    where: (v) => [
      tggEq(v("portName"), v("portName")),
      tggReconcile(v("portName"), v("portName"), "target-wins"),
      tggComplement(["interfaceRef", "interfaceTrefKind", "range"]),
    ],
  }),

  // 3. AUTOSAR P-Port-Prototype (provided) <-> SysML v2 Out Port
  tggRule({
    name: "AutosarPPortToSysmlOutPort",
    sourceLang: "autosar",
    targetLang: "sysml2",
    source: ($, v) =>
      $.PortPrototype({
        shortName: v("portName"),
        direction: "provided",
      }),
    target: ($, v) =>
      $.PortUsage({
        name: v("portName"),
        direction: "out",
      }),
    where: (v) => [
      tggEq(v("portName"), v("portName")),
      tggReconcile(v("portName"), v("portName"), "target-wins"),
      tggComplement(["interfaceRef", "interfaceTrefKind", "range"]),
    ],
  }),

  // 4. AUTOSAR Runnable-Entity <-> SysML v2 Action Usage
  tggRule({
    name: "AutosarRunnableToSysmlAction",
    sourceLang: "autosar",
    targetLang: "sysml2",
    source: ($, v) =>
      $.RunnableEntity({
        shortName: v("runnableName"),
      }),
    target: ($, v) =>
      $.ActionUsage({
        name: v("runnableName"),
      }),
    where: (v) => [
      tggEq(v("runnableName"), v("runnableName")),
      tggReconcile(v("runnableName"), v("runnableName"), "target-wins"),
      tggComplement(["symbol", "executionTimeWcet", "canBeInvokedConcurrently", "dataReadAccess", "dataWriteAccess"]),
    ],
  }),

  // 5. AUTOSAR Assembly-Sw-Connector <-> SysML v2 Connection Usage
  tggRule({
    name: "AutosarConnectorToSysmlConnection",
    sourceLang: "autosar",
    targetLang: "sysml2",
    source: ($, v) =>
      $.AssemblySwConnector({
        provider: v("provRef"),
        requirer: v("reqRef"),
      }),
    target: ($, v) =>
      $.ConnectionUsage({
        source: v("provRef"),
        target: v("reqRef"),
      }),
    where: (v) => [
      tggEq(v("provRef"), v("provRef")),
      tggEq(v("reqRef"), v("reqRef")),
      tggComplement(["shortName", "kind", "range"]),
    ],
  }),

  // 6. AUTOSAR Client-Server R-Port <-> SysML v2 Conjugated Typed Port (~Interface)
  tggRule({
    name: "AutosarClientServerPortToConjugatedPort",
    sourceLang: "autosar",
    targetLang: "sysml2",
    source: ($, v) =>
      $.ClientServerPort({
        shortName: v("portName"),
        interfaceName: v("ifName"),
        direction: "required",
      }),
    target: ($, v) =>
      $.ConjugatedPortUsage({
        name: v("portName"),
        portType: v("ifName"),
        isConjugated: true,
        direction: "in",
      }),
    where: (v) => [
      tggEq(v("portName"), v("portName")),
      tggEq(v("ifName"), v("ifName")),
      tggReconcile(v("portName"), v("portName"), "target-wins"),
      tggComplement(["interfaceRef", "operations", "timeout", "uuid", "range"]),
    ],
  }),
];

export const autosarPolyglotConfig: PolyglotConfig = {
  languages: ["autosar", "sysml2"],
  typeMaps: {
    sysml2: {
      float32: "Real",
      float64: "Real",
      uint8: "Integer",
      uint16: "Integer",
      uint32: "Integer",
      boolean: "Boolean",
    },
  },
  rules: autosarTggRules,
};
