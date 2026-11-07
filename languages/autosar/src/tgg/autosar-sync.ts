// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/autosar — Bidirectional TGG Round-Trip Synchronizer.
 *
 * Executes declarative TGG rules via `PolyglotTransformer` (`evaluateRuleForward` /
 * `evaluateRuleBackward`), `parseSysml2Cst`, and `@modelscript/dsl` lossless XML CST
 * splicing (`xml.parseXml`, `setElementTextSplice`, `appendChildSplice`, `removeElementSplice`,
 * `applySplices`) to round-trip AUTOSAR ARXML <-> SysML v2 while preserving unmapped XML
 * elements (`<REQUIRED-INTERFACE-TREF>`, `<EVENTS>`, `<SYMBOL>`, comments).
 */

import { xml } from "@modelscript/dsl";
import type { Splice, XmlElement } from "@modelscript/dsl/xml";
import { PolyglotTransformer, parseSysml2Cst } from "@modelscript/runtime";
import { parseArxml } from "../parser/arxml-parser.js";
import { autosarToSysml } from "../projections/sysml.js";
import type { AutosarModel, SwComponentKind } from "../types.js";
import { autosarPolyglotConfig } from "./autosar-rules.js";

export interface AutosarSyncChange {
  target: "swc" | "port" | "runnable";
  elementId: string;
  reconciledVal: unknown;
  strategy: string;
}

export interface AutosarSyncResult {
  updatedText: string;
  changes: AutosarSyncChange[];
  conflicts: ReturnType<PolyglotTransformer["getConflicts"]>;
  transformer: PolyglotTransformer;
}

const SWC_TAG_NAMES = new Set([
  "APPLICATION-SW-COMPONENT-TYPE",
  "SENSOR-ACTUATOR-SW-COMPONENT-TYPE",
  "COMPOSITION-SW-COMPONENT-TYPE",
  "COMPLEX-DEVICE-DRIVER-SW-COMPONENT-TYPE",
  "SERVICE-SW-COMPONENT-TYPE",
  "ECU-ABSTRACTION-SW-COMPONENT-TYPE",
]);

function findSwcElements(el: XmlElement | null, out: XmlElement[] = []): XmlElement[] {
  if (!el) return out;
  if (SWC_TAG_NAMES.has(el.name.toUpperCase())) out.push(el);
  for (const c of el.children) findSwcElements(c, out);
  return out;
}

function findDirectChild(el: XmlElement | undefined, tagName: string): XmlElement | undefined {
  if (!el) return undefined;
  return el.children.find((c: any) => c.name.toUpperCase() === tagName.toUpperCase());
}

function findXmlElements(el: XmlElement | null | undefined, tagName: string, out: XmlElement[] = []): XmlElement[] {
  if (!el) return out;
  if (el.name.toUpperCase() === tagName.toUpperCase()) out.push(el);
  for (const c of el.children) findXmlElements(c, tagName, out);
  return out;
}

/**
 * Projects an AUTOSAR ARXML string or model to SysML v2 via `PolyglotTransformer.evaluateRuleForward`,
 * recording correspondence threads and shadow complements for round-trip sync.
 */
export function projectAutosarViaTgg(
  arxmlOrModel: string | AutosarModel,
  rootPackageName = "AutosarArchitecture",
): { sysmlText: string; transformer: PolyglotTransformer; model: AutosarModel } {
  const model = typeof arxmlOrModel === "string" ? parseArxml(arxmlOrModel) : arxmlOrModel;
  const transformer = new PolyglotTransformer(autosarPolyglotConfig);

  let swcIdx = 0;
  for (const swc of model.components.values()) {
    const swcNode = {
      kind: "SwComponent",
      name: swc.shortName,
      shortName: swc.shortName,
      swcKind: swc.kind,
      internalBehaviorShortName: swc.internalBehavior?.shortName ?? `IB_${swc.shortName}`,
      properties: {
        shortName: swc.shortName,
        kind: swc.kind,
        internalBehaviorShortName: swc.internalBehavior?.shortName ?? `IB_${swc.shortName}`,
      },
    };
    transformer.evaluateRuleForward(swcNode, "sysml2", swc.shortName);
    const comp = transformer.getComplement(swc.shortName) ?? {};
    comp["kind"] = swc.kind;
    comp["internalBehaviorShortName"] = swc.internalBehavior?.shortName ?? `IB_${swc.shortName}`;
    comp["events"] = swc.internalBehavior?.events ?? [];
    transformer.storeComplement(swc.shortName, comp);
    transformer.storeComplement(`pos:swc:${swcIdx++}`, comp);

    for (const [portName, port] of swc.ports) {
      const threadId = `${swc.shortName}.${portName}`;
      transformer.evaluateRuleForward(
        {
          kind: "PortPrototype",
          name: portName,
          shortName: portName,
          direction: port.direction,
          interfaceRef: port.interfaceRef,
          interfaceTrefKind: port.interfaceTrefKind,
          properties: {
            shortName: portName,
            direction: port.direction,
            interfaceRef: port.interfaceRef,
            interfaceTrefKind: port.interfaceTrefKind,
          },
        },
        "sysml2",
        threadId,
      );
    }

    if (swc.internalBehavior) {
      for (const runnable of swc.internalBehavior.runnables.values()) {
        const threadId = `${swc.shortName}.${runnable.shortName}`;
        transformer.evaluateRuleForward(
          {
            kind: "RunnableEntity",
            name: runnable.shortName,
            shortName: runnable.shortName,
            symbol: runnable.symbol,
            executionTimeWcet: runnable.executionTimeWcet,
            canBeInvokedConcurrently: runnable.canBeInvokedConcurrently,
            dataReadAccess: runnable.dataReadAccess,
            dataWriteAccess: runnable.dataWriteAccess,
            properties: {
              shortName: runnable.shortName,
              symbol: runnable.symbol,
              executionTimeWcet: runnable.executionTimeWcet,
              canBeInvokedConcurrently: runnable.canBeInvokedConcurrently,
              dataReadAccess: runnable.dataReadAccess,
              dataWriteAccess: runnable.dataWriteAccess,
            },
          },
          "sysml2",
          threadId,
        );
      }
    }
  }

  transformer.registerEmitter("sysml2", () => {
    return autosarToSysml(model, rootPackageName)
      .split("\n")
      .filter((line) => !line.startsWith("// Synthesized by"))
      .join("\n")
      .replace(/\n\n+\}/g, "\n}")
      .trim();
  });

  const sysmlText = transformer.transform(
    { kind: "AutosarModel", name: rootPackageName, properties: {} },
    "sysml2",
  );
  return { sysmlText, transformer, model };
}

/**
 * Synchronizes modified SysML v2 part definitions, ports, and actions back into AUTOSAR ARXML
 * using `parseSysml2Cst`, declarative TGG backward evaluation (`evaluateRuleBackward`),
 * and `@modelscript/dsl` lossless XML CST splicing.
 */
export function synchronizeSysmlToAutosar(
  originalArxml: string,
  modifiedSysmlText: string,
  strategy: "source-wins" | "target-wins" | "physics-simplex" = "target-wins",
): AutosarSyncResult {
  const { transformer, model: originalModel } = projectAutosarViaTgg(originalArxml);
  const sysmlCst = parseSysml2Cst(modifiedSysmlText);
  if (sysmlCst.partDefs.length === 0) {
    throw new Error("Expected at least one 'part def <Name> { ... }' in SysML v2 code.");
  }

  const changes: AutosarSyncChange[] = [];
  const origSwcs = Array.from(originalModel.components.values());

  const xmlDoc = xml.parseXml(originalArxml);
  const swcXmlElements = findSwcElements(xmlDoc.root);
  const splices: Splice[] = [];

  for (let idx = 0; idx < sysmlCst.partDefs.length; idx++) {
    const partDef = sysmlCst.partDefs[idx]!;
    const origSwc = originalModel.components.get(partDef.name) ?? origSwcs[idx];
    const swcKey = origSwc?.shortName ?? partDef.name;
    const complement = transformer.getComplement(swcKey) ?? transformer.getComplement(`pos:swc:${idx}`) ?? {};
    const swcKind =
      (complement["kind"] as SwComponentKind | undefined) ?? origSwc?.kind ?? "APPLICATION-SW-COMPONENT-TYPE";

    const swcBack = transformer.evaluateRuleBackward(
      {
        kind: "PartDefinition",
        name: partDef.name,
        stereotype: swcKind,
        properties: { name: partDef.name, stereotype: swcKind },
      },
      "autosar",
      {
        strategy,
        threadId: swcKey,
        fallbackThreadId: `pos:swc:${idx}`,
      },
    );

    const resolvedSwcName = String(swcBack?.sourceNode["properties"]?.["shortName"] ?? partDef.name);
    if (origSwc && origSwc.shortName !== partDef.name) {
      changes.push({
        target: "swc",
        elementId: origSwc.shortName,
        reconciledVal: resolvedSwcName,
        strategy: strategy === "physics-simplex" ? "target-wins" : strategy,
      });
    }

    const swcEl =
      swcXmlElements.find((el) => findDirectChild(el, "SHORT-NAME")?.text === (origSwc?.shortName ?? partDef.name)) ??
      swcXmlElements[idx];

    if (swcEl) {
      const shortNameEl = findDirectChild(swcEl, "SHORT-NAME");
      if (shortNameEl && !shortNameEl.selfClosing && shortNameEl.text !== resolvedSwcName) {
        splices.push(xml.setElementTextSplice(shortNameEl, resolvedSwcName));
      }

      // Synchronize ports via declarative TGG rules (#2 R-Port, #3 P-Port, #6 ClientServerPort) and XML CST splices
      const portsContainer = findDirectChild(swcEl, "PORTS");
      const existingPortEls = portsContainer
        ? portsContainer.children.filter(
            (c: any) => c.name.toUpperCase() === "R-PORT-PROTOTYPE" || c.name.toUpperCase() === "P-PORT-PROTOTYPE",
          )
        : [];
      const matchedPortEls = new Set<XmlElement>();

      for (const pNode of partDef.ports) {
        const dir: "required" | "provided" = pNode.direction === "out" ? "provided" : "required";
        const portTypeName = pNode.typeName;
        const isClientServer = Boolean(pNode.isConjugated && portTypeName);
        const portBack = transformer.evaluateRuleBackward(
          isClientServer
            ? {
                kind: "ConjugatedPortUsage",
                name: pNode.name,
                portType: portTypeName,
                isConjugated: true,
                direction: "in",
                properties: {
                  name: pNode.name,
                  portType: portTypeName,
                  isConjugated: true,
                  direction: "in",
                },
              }
            : {
                kind: "PortUsage",
                name: pNode.name,
                direction: pNode.direction === "out" ? "out" : "in",
                properties: {
                  name: pNode.name,
                  direction: pNode.direction === "out" ? "out" : "in",
                },
              },
          "autosar",
          {
            strategy,
            threadId: `${swcKey}.${pNode.name}`,
          },
        );
        const resolvedPortName = String(portBack?.sourceNode["properties"]?.["shortName"] ?? pNode.name);

        if (!origSwc?.ports.has(resolvedPortName)) {
          changes.push({
            target: "port",
            elementId: `${resolvedSwcName}.${resolvedPortName}`,
            reconciledVal: `${dir}:${resolvedPortName}`,
            strategy: strategy === "physics-simplex" ? "target-wins" : strategy,
          });
        }

        const existingEl = existingPortEls.find(
          (el: any) => findDirectChild(el, "SHORT-NAME")?.text === resolvedPortName,
        );
        if (existingEl) {
          matchedPortEls.add(existingEl);
        } else if (portsContainer && !portsContainer.selfClosing) {
          const tag = dir === "required" ? "R-PORT-PROTOTYPE" : "P-PORT-PROTOTYPE";
          const csTref = isClientServer
            ? `\n      <REQUIRED-INTERFACE-TREF DEST="CLIENT-SERVER-INTERFACE">/Interfaces/${portTypeName}</REQUIRED-INTERFACE-TREF>`
            : "";
          const newPortXml = `<${tag}>\n      <SHORT-NAME>${resolvedPortName}</SHORT-NAME>${csTref}\n    </${tag}>`;
          splices.push(xml.appendChildSplice(portsContainer, newPortXml, originalArxml));
        }
      }

      for (const oldEl of existingPortEls) {
        if (!matchedPortEls.has(oldEl)) {
          splices.push(xml.removeElementSplice(oldEl, originalArxml));
        }
      }

      // Synchronize runnables via declarative TGG rule (#4 RunnableEntity) and XML CST splices
      const runnablesContainer = findXmlElements(swcEl, "RUNNABLES")[0];
      const existingRunnableEls = runnablesContainer
        ? runnablesContainer.children.filter((c: any) => c.name.toUpperCase() === "RUNNABLE-ENTITY")
        : [];
      const matchedRunnableEls = new Set<XmlElement>();
      const actionNames = new Set(partDef.actions.map((a) => a.name));

      for (let actIdx = 0; actIdx < partDef.actions.length; actIdx++) {
        const actNode = partDef.actions[actIdx]!;
        const runBack = transformer.evaluateRuleBackward(
          {
            kind: "ActionUsage",
            name: actNode.name,
            properties: { name: actNode.name },
          },
          "autosar",
          {
            strategy,
            threadId: `${swcKey}.${actNode.name}`,
          },
        );
        const resolvedRunnableName = String(runBack?.sourceNode["properties"]?.["shortName"] ?? actNode.name);

        if (!origSwc?.internalBehavior?.runnables.has(resolvedRunnableName)) {
          changes.push({
            target: "runnable",
            elementId: `${resolvedSwcName}.${resolvedRunnableName}`,
            reconciledVal: resolvedRunnableName,
            strategy,
          });
        }

        let existingRunEl = existingRunnableEls.find(
          (el: any) => findDirectChild(el, "SHORT-NAME")?.text === resolvedRunnableName,
        );
        if (!existingRunEl && actIdx < existingRunnableEls.length) {
          const candidate = existingRunnableEls[actIdx]!;
          const candidateName = findDirectChild(candidate, "SHORT-NAME")?.text ?? "";
          if (!matchedRunnableEls.has(candidate) && !actionNames.has(candidateName)) {
            existingRunEl = candidate;
          }
        }

        if (existingRunEl) {
          matchedRunnableEls.add(existingRunEl);
          const runShortNameEl = findDirectChild(existingRunEl, "SHORT-NAME");
          if (runShortNameEl && !runShortNameEl.selfClosing && runShortNameEl.text !== resolvedRunnableName) {
            splices.push(xml.setElementTextSplice(runShortNameEl, resolvedRunnableName));
          }
        } else if (runnablesContainer && !runnablesContainer.selfClosing) {
          const newRunXml = `<RUNNABLE-ENTITY>\n          <SHORT-NAME>${resolvedRunnableName}</SHORT-NAME>\n        </RUNNABLE-ENTITY>`;
          splices.push(xml.appendChildSplice(runnablesContainer, newRunXml, originalArxml));
        }
      }

      for (const oldRunEl of existingRunnableEls) {
        if (!matchedRunnableEls.has(oldRunEl)) {
          splices.push(xml.removeElementSplice(oldRunEl, originalArxml));
        }
      }
    }
  }

  const updatedText = xml.applySplices(originalArxml, splices);

  return {
    updatedText,
    changes,
    conflicts: transformer.getConflicts(),
    transformer,
  };
}
