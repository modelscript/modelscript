// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/autosar — Bidirectional TGG Round-Trip Synchronizer.
 *
 * Executes declarative TGG rules via `PolyglotTransformer` (`evaluateRuleForward` /
 * `evaluateRuleBackward`), `parseSysml2Cst`, and `@modelscript/dsl/unparser` lossless XML CST
 * transactions (`CstDocumentSession`, `CstTransaction`, `CstXmlAdapter`) to round-trip AUTOSAR
 * ARXML <-> SysML v2 while preserving unmapped XML elements (`<REQUIRED-INTERFACE-TREF>`,
 * `<EVENTS>`, `<SYMBOL>`, comments).
 */

import { CstDocumentSession, CstTransaction, CstXmlAdapter } from "@modelscript/dsl/unparser";
import type { SyntaxNode } from "@modelscript/dsl/utils";
import { getXmlWasmParser } from "@modelscript/dsl/xml";
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

function findDirectChild(el: SyntaxNode | undefined, tagName: string, source: string): SyntaxNode | undefined {
  if (!el) return undefined;
  const upper = tagName.toUpperCase();
  return CstXmlAdapter.getChildElements(el).find(
    (c) => (CstXmlAdapter.getTagName(c, source) ?? "").toUpperCase() === upper,
  );
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

  const sysmlText = transformer.transform({ kind: "AutosarModel", name: rootPackageName, properties: {} }, "sysml2");
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

  let xmlParser: unknown = null;
  try {
    xmlParser = getXmlWasmParser();
  } catch {
    xmlParser = null;
  }
  const session = new CstDocumentSession({
    uri: "file:///autosar.arxml",
    text: originalArxml,
    parser: xmlParser as never,
    xmlFallback: true,
  });

  try {
    const root = session.rootNode;
    const swcXmlElements = root
      ? CstXmlAdapter.findElements(root, originalArxml, (_n, t) => SWC_TAG_NAMES.has(t.toUpperCase()))
      : [];
    const tx = new CstTransaction(session);

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
        swcXmlElements.find((el) => {
          const sn = findDirectChild(el, "SHORT-NAME", originalArxml);
          return sn ? CstXmlAdapter.getElementText(sn, originalArxml) === (origSwc?.shortName ?? partDef.name) : false;
        }) ?? swcXmlElements[idx];

      if (swcEl) {
        const shortNameEl = findDirectChild(swcEl, "SHORT-NAME", originalArxml);
        if (
          shortNameEl &&
          !CstXmlAdapter.isSelfClosing(shortNameEl, originalArxml) &&
          CstXmlAdapter.getElementText(shortNameEl, originalArxml) !== resolvedSwcName
        ) {
          CstXmlAdapter.setElementText(tx, shortNameEl, resolvedSwcName);
        }

        // Synchronize ports via declarative TGG rules (#2 R-Port, #3 P-Port, #6 ClientServerPort) and CST transactions
        const portsContainer = findDirectChild(swcEl, "PORTS", originalArxml);
        const existingPortEls = portsContainer
          ? CstXmlAdapter.getChildElements(portsContainer).filter((c) => {
              const t = (CstXmlAdapter.getTagName(c, originalArxml) ?? "").toUpperCase();
              return t === "R-PORT-PROTOTYPE" || t === "P-PORT-PROTOTYPE";
            })
          : [];
        const matchedPortEls = new Set<SyntaxNode>();

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

          const existingEl = existingPortEls.find((el) => {
            const sn = findDirectChild(el, "SHORT-NAME", originalArxml);
            return sn ? CstXmlAdapter.getElementText(sn, originalArxml) === resolvedPortName : false;
          });
          if (existingEl) {
            matchedPortEls.add(existingEl);
          } else if (portsContainer) {
            const tag = dir === "required" ? "R-PORT-PROTOTYPE" : "P-PORT-PROTOTYPE";
            const csTref = isClientServer
              ? `\n      <REQUIRED-INTERFACE-TREF DEST="CLIENT-SERVER-INTERFACE">/Interfaces/${portTypeName}</REQUIRED-INTERFACE-TREF>`
              : "";
            const newPortXml = `<${tag}>\n      <SHORT-NAME>${resolvedPortName}</SHORT-NAME>${csTref}\n    </${tag}>`;
            CstXmlAdapter.appendChild(tx, portsContainer, newPortXml);
          }
        }

        for (const oldEl of existingPortEls) {
          if (!matchedPortEls.has(oldEl)) {
            CstXmlAdapter.deleteElement(tx, oldEl);
          }
        }

        // Synchronize runnables via declarative TGG rule (#4 RunnableEntity) and CST transactions
        const runnablesContainer = CstXmlAdapter.findElements(
          swcEl,
          originalArxml,
          (_n, t) => t.toUpperCase() === "RUNNABLES",
        )[0];
        const existingRunnableEls = runnablesContainer
          ? CstXmlAdapter.getChildElements(runnablesContainer).filter(
              (c) => (CstXmlAdapter.getTagName(c, originalArxml) ?? "").toUpperCase() === "RUNNABLE-ENTITY",
            )
          : [];
        const matchedRunnableEls = new Set<SyntaxNode>();
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

          let existingRunEl = existingRunnableEls.find((el) => {
            const sn = findDirectChild(el, "SHORT-NAME", originalArxml);
            return sn ? CstXmlAdapter.getElementText(sn, originalArxml) === resolvedRunnableName : false;
          });
          if (!existingRunEl && actIdx < existingRunnableEls.length) {
            const candidate = existingRunnableEls[actIdx]!;
            const candSn = findDirectChild(candidate, "SHORT-NAME", originalArxml);
            const candidateName = candSn ? CstXmlAdapter.getElementText(candSn, originalArxml) : "";
            if (!matchedRunnableEls.has(candidate) && !actionNames.has(candidateName)) {
              existingRunEl = candidate;
            }
          }

          if (existingRunEl) {
            matchedRunnableEls.add(existingRunEl);
            const runShortNameEl = findDirectChild(existingRunEl, "SHORT-NAME", originalArxml);
            if (
              runShortNameEl &&
              !CstXmlAdapter.isSelfClosing(runShortNameEl, originalArxml) &&
              CstXmlAdapter.getElementText(runShortNameEl, originalArxml) !== resolvedRunnableName
            ) {
              CstXmlAdapter.setElementText(tx, runShortNameEl, resolvedRunnableName);
            }
          } else if (runnablesContainer) {
            const newRunXml = `<RUNNABLE-ENTITY>\n          <SHORT-NAME>${resolvedRunnableName}</SHORT-NAME>\n        </RUNNABLE-ENTITY>`;
            CstXmlAdapter.appendChild(tx, runnablesContainer, newRunXml);
          }
        }

        for (const oldRunEl of existingRunnableEls) {
          if (!matchedRunnableEls.has(oldRunEl)) {
            CstXmlAdapter.deleteElement(tx, oldRunEl);
          }
        }
      }
    }

    const updatedText = tx.commit().applyToString(originalArxml);

    return {
      updatedText,
      changes,
      conflicts: transformer.getConflicts(),
      transformer,
    };
  } finally {
    session.dispose();
  }
}
