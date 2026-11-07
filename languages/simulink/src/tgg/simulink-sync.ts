// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulink — Bidirectional TGG Round-Trip Synchronizer.
 *
 * Propagates parameter adjustments, topological rewiring, and component lifecycle changes
 * from modified Modelica models back into MATLAB/Simulink (.mdl, .slx) source models
 * via `PolyglotTransformer` declarative rule evaluation (`evaluateRuleForward` /
 * `evaluateRuleBackward`) and `@modelscript/dsl` lossless XML CST splicing.
 */

import { xml } from "@modelscript/dsl";
import type { Splice, XmlElement } from "@modelscript/dsl/xml";
import { PolyglotTransformer } from "@modelscript/runtime";
import { parseMdl, serializeMdl } from "../parser/mdl-parser.js";
import { parseSlxXml } from "../parser/slx-xml-parser.js";
import { simulinkToModelica } from "../projections/modelica.js";
import type { SimulinkBlock, SimulinkModel } from "../types.js";
import { parseModelicaBlocks } from "./modelica-parser.js";
import { simulinkPolyglotConfig, simulinkTggRules } from "./simulink-rules.js";
import type { ReconciledChange, SyncOptions, SyncResult } from "./types.js";

function findXmlElements(el: XmlElement | null, tagName: string, out: XmlElement[] = []): XmlElement[] {
  if (!el) return out;
  if (el.name.toUpperCase() === tagName.toUpperCase()) out.push(el);
  for (const c of el.children) findXmlElements(c, tagName, out);
  return out;
}

/**
 * Projects a Simulink (.mdl or .slx XML) model to Modelica 3.x using declarative TGG rules
 * and `PolyglotTransformer.evaluateRuleForward` while recording correspondence threads and shadow complements.
 */
export function projectSimulinkViaTgg(
  simulinkInput: string | SimulinkModel,
  defaultName = "SuspensionControl",
): { modelicaText: string; transformer: PolyglotTransformer; model: SimulinkModel; isXml: boolean } {
  const isXml = typeof simulinkInput === "string" && simulinkInput.trim().startsWith("<");
  const model: SimulinkModel =
    typeof simulinkInput === "string"
      ? isXml
        ? parseSlxXml(simulinkInput, defaultName)
        : parseMdl(simulinkInput)
      : simulinkInput;

  const transformer = new PolyglotTransformer(simulinkPolyglotConfig);

  let idx = 0;
  for (const block of model.rootSystem.blocks.values()) {
    const blockProps: Record<string, any> = {
      blockType: block.type,
      name: block.name,
      gain: block.parameters.get("Gain"),
      initialCondition: block.parameters.get("InitialCondition"),
      value: block.parameters.get("Value"),
      inputs: block.parameters.get("Inputs"),
      numerator: block.parameters.get("Numerator"),
      denominator: block.parameters.get("Denominator"),
      sampleTime: block.parameters.get("SampleTime"),
      id: block.id,
      range: block.range,
      ports: block.ports,
      isXml,
    };
    transformer.evaluateRuleForward(
      {
        kind: "SimulinkBlock",
        name: block.name,
        ...blockProps,
        properties: blockProps,
      },
      "modelica",
      block.name,
    );
    const comp = transformer.getComplement(block.name) ?? {};
    comp["id"] = block.id;
    comp["range"] = block.range;
    comp["ports"] = block.ports;
    comp["isXml"] = isXml;
    transformer.storeComplement(block.name, comp);
    transformer.storeComplement(`pos:${idx++}`, comp);
  }

  for (const line of model.rootSystem.lines) {
    transformer.evaluateRuleForward(
      {
        kind: "SimulinkLine",
        name: line.id,
        srcBlock: line.srcBlock,
        srcPort: line.srcPort,
        dstBlock: line.dstBlock,
        dstPort: line.dstPort,
        properties: {
          srcBlock: line.srcBlock,
          srcPort: line.srcPort,
          dstBlock: line.dstBlock,
          dstPort: line.dstPort,
        },
      },
      "modelica",
      line.id,
    );
  }

  transformer.registerEmitter("modelica", () => {
    return simulinkToModelica(model)
      .split("\n")
      .filter((line) => !line.startsWith("// Synthesized by"))
      .join("\n")
      .trim();
  });

  const modelicaText = transformer.transform(
    { kind: "SimulinkModel", name: model.name || "SimulinkModel", properties: {} },
    "modelica",
  );
  return { modelicaText, transformer, model, isXml };
}

export function synchronizeModelicaToSimulink(
  originalSimulinkText: string,
  modifiedModelicaText: string,
  options?: SyncOptions,
): SyncResult {
  const parsedModelica = parseModelicaBlocks(modifiedModelicaText);
  const { model, transformer, isXml } = projectSimulinkViaTgg(
    originalSimulinkText,
    parsedModelica.name || "SuspensionControl",
  );
  if (parsedModelica.name && parsedModelica.name !== "SimulinkModel") {
    model.name = parsedModelica.name;
  }

  const changes: ReconciledChange[] = [];
  const strategy = options?.strategy ?? "target-wins";

  const blocksById = new Map<string, SimulinkBlock>();
  const origBlockList = Array.from(model.rootSystem.blocks.values());
  let maxSid = 0;
  for (const block of origBlockList) {
    blocksById.set(block.name, block);
    const sidNum = parseInt(block.id, 10);
    if (!Number.isNaN(sidNum) && sidNum > maxSid) {
      maxSid = sidNum;
    }
  }

  // 1. Synchronize Parameter Modifications via declarative TGG backward evaluation
  let compIdx = 0;
  for (const [compName, moComp] of parsedModelica.components) {
    let block = blocksById.get(compName);
    // Positional rename fallback when component count matches and type matches
    if (
      !block &&
      parsedModelica.components.size === origBlockList.length &&
      origBlockList[compIdx] &&
      origBlockList[compIdx]!.type === mapModelicaTypeToSimulink(moComp.typeSpecifier)
    ) {
      block = origBlockList[compIdx];
      if (block) {
        model.rootSystem.blocks.delete(block.name);
        block.name = compName;
        model.rootSystem.blocks.set(compName, block);
        blocksById.set(compName, block);
      }
    }
    compIdx++;
    if (!block) continue;

    // Evaluate declarative TGG rule backward for this ModelicaComponent -> SimulinkBlock
    transformer.evaluateRuleBackward(
      {
        kind: "ModelicaComponent",
        name: compName,
        typeSpecifier: moComp.typeSpecifier,
        ...moComp.modifications,
        properties: {
          name: compName,
          typeSpecifier: moComp.typeSpecifier,
          ...moComp.modifications,
        },
      },
      "simulink",
      {
        strategy: strategy as "source-wins" | "target-wins" | "physics-simplex",
        threadId: block.name,
        fallbackThreadId: `pos:${compIdx - 1}`,
      },
    );

    switch (block.type) {
      case "Gain": {
        const oldGain = Number(block.parameters.get("Gain") ?? 1.0);
        const newGain = moComp.modifications["k"] !== undefined ? Number(moComp.modifications["k"]) : oldGain;
        if (!Number.isNaN(newGain) && newGain !== oldGain) {
          const resolvedVal = resolveParameterConflict(
            transformer,
            `${compName}.Gain`,
            oldGain,
            newGain,
            strategy,
            options,
          );
          block.parameters.set("Gain", resolvedVal);
          changes.push({
            target: "parameter",
            elementId: compName,
            property: "Gain",
            sourceOldVal: oldGain,
            targetNewVal: newGain,
            reconciledVal: resolvedVal,
            strategy,
          });
        }
        break;
      }

      case "Integrator": {
        const oldIc = Number(block.parameters.get("InitialCondition") ?? 0.0);
        const newIc = moComp.modifications["y_start"] !== undefined ? Number(moComp.modifications["y_start"]) : oldIc;
        if (!Number.isNaN(newIc) && newIc !== oldIc) {
          const resolvedVal = resolveParameterConflict(
            transformer,
            `${compName}.InitialCondition`,
            oldIc,
            newIc,
            strategy,
            options,
          );
          block.parameters.set("InitialCondition", resolvedVal);
          changes.push({
            target: "parameter",
            elementId: compName,
            property: "InitialCondition",
            sourceOldVal: oldIc,
            targetNewVal: newIc,
            reconciledVal: resolvedVal,
            strategy,
          });
        }
        break;
      }

      case "Constant": {
        const oldVal = Number(block.parameters.get("Value") ?? 1.0);
        const newVal = moComp.modifications["k"] !== undefined ? Number(moComp.modifications["k"]) : oldVal;
        if (!Number.isNaN(newVal) && newVal !== oldVal) {
          const resolvedVal = resolveParameterConflict(
            transformer,
            `${compName}.Value`,
            oldVal,
            newVal,
            strategy,
            options,
          );
          block.parameters.set("Value", resolvedVal);
          changes.push({
            target: "parameter",
            elementId: compName,
            property: "Value",
            sourceOldVal: oldVal,
            targetNewVal: newVal,
            reconciledVal: resolvedVal,
            strategy,
          });
        }
        break;
      }

      case "UnitDelay": {
        if (moComp.modifications["samplePeriod"] !== undefined) {
          const oldSt = Number(block.parameters.get("SampleTime") ?? 0.01);
          const newSt = Number(moComp.modifications["samplePeriod"]);
          if (newSt !== oldSt) {
            block.parameters.set("SampleTime", newSt);
            changes.push({
              target: "parameter",
              elementId: compName,
              property: "SampleTime",
              sourceOldVal: oldSt,
              targetNewVal: newSt,
              reconciledVal: newSt,
              strategy,
            });
          }
        }
        if (moComp.modifications["y_start"] !== undefined) {
          const oldIc = Number(block.parameters.get("InitialCondition") ?? 0.0);
          const newIc = Number(moComp.modifications["y_start"]);
          if (newIc !== oldIc) {
            block.parameters.set("InitialCondition", newIc);
            changes.push({
              target: "parameter",
              elementId: compName,
              property: "InitialCondition",
              sourceOldVal: oldIc,
              targetNewVal: newIc,
              reconciledVal: newIc,
              strategy,
            });
          }
        }
        break;
      }

      case "TransferFcn": {
        const sep = isXml ? ", " : " ";
        if (Array.isArray(moComp.modifications["b"])) {
          const bVec = `[${(moComp.modifications["b"] as number[]).join(sep)}]`;
          block.parameters.set("Numerator", bVec);
          changes.push({
            target: "parameter",
            elementId: compName,
            property: "Numerator",
            reconciledVal: bVec,
            strategy,
          });
        }
        if (Array.isArray(moComp.modifications["a"])) {
          const aVec = `[${(moComp.modifications["a"] as number[]).join(sep)}]`;
          block.parameters.set("Denominator", aVec);
          changes.push({
            target: "parameter",
            elementId: compName,
            property: "Denominator",
            reconciledVal: aVec,
            strategy,
          });
        }
        break;
      }

      case "DiscreteFilter": {
        const sep = isXml ? ", " : " ";
        if (Array.isArray(moComp.modifications["b"])) {
          const bVec = `[${(moComp.modifications["b"] as number[]).map(formatFloatVecElem).join(sep)}]`;
          const oldNum = String(block.parameters.get("Numerator") ?? "");
          if (bVec !== oldNum) {
            block.parameters.set("Numerator", bVec);
            changes.push({
              target: "parameter",
              elementId: compName,
              property: "Numerator",
              sourceOldVal: oldNum,
              targetNewVal: bVec,
              reconciledVal: bVec,
              strategy,
            });
          }
        }
        if (Array.isArray(moComp.modifications["a"])) {
          const aVec = `[${(moComp.modifications["a"] as number[]).map(formatFloatVecElem).join(sep)}]`;
          const oldDen = String(block.parameters.get("Denominator") ?? "");
          if (aVec !== oldDen) {
            block.parameters.set("Denominator", aVec);
            changes.push({
              target: "parameter",
              elementId: compName,
              property: "Denominator",
              sourceOldVal: oldDen,
              targetNewVal: aVec,
              reconciledVal: aVec,
              strategy,
            });
          }
        }
        if (moComp.modifications["samplePeriod"] !== undefined) {
          const oldSt = Number(block.parameters.get("SampleTime") ?? 0.001);
          const newSt = Number(moComp.modifications["samplePeriod"]);
          if (!Number.isNaN(newSt) && newSt !== oldSt) {
            const resolvedSt = resolveParameterConflict(
              transformer,
              `${compName}.SampleTime`,
              oldSt,
              newSt,
              strategy,
              options,
            );
            block.parameters.set("SampleTime", resolvedSt);
            changes.push({
              target: "parameter",
              elementId: compName,
              property: "SampleTime",
              sourceOldVal: oldSt,
              targetNewVal: newSt,
              reconciledVal: resolvedSt,
              strategy,
            });
          }
        }
        break;
      }
    }
  }

  // 2. Synchronize Newly Added Blocks
  for (const [compName, moComp] of parsedModelica.components) {
    if (!blocksById.has(compName)) {
      const blockType = mapModelicaTypeToSimulink(moComp.typeSpecifier);
      maxSid++;
      const newBlock: SimulinkBlock = {
        name: compName,
        type: blockType,
        id: String(maxSid),
        parameters: new Map(),
        ports: [
          { id: "1", portNumber: 1, type: "in" },
          { id: "2", portNumber: 1, type: "out" },
        ],
      };

      if (blockType === "Gain") {
        const kVal = moComp.modifications["k"];
        newBlock.parameters.set("Gain", typeof kVal === "number" || typeof kVal === "string" ? kVal : 1.0);
      } else if (blockType === "Integrator") {
        const icVal = moComp.modifications["y_start"];
        newBlock.parameters.set(
          "InitialCondition",
          typeof icVal === "number" || typeof icVal === "string" ? icVal : 0.0,
        );
      } else if (blockType === "Constant") {
        const cVal = moComp.modifications["k"];
        newBlock.parameters.set("Value", typeof cVal === "number" || typeof cVal === "string" ? cVal : 1.0);
      } else if (blockType === "DiscreteFilter") {
        const sep = isXml ? ", " : " ";
        const bMod = moComp.modifications["b"];
        const aMod = moComp.modifications["a"];
        const stMod = moComp.modifications["samplePeriod"];
        newBlock.parameters.set(
          "Numerator",
          Array.isArray(bMod) ? `[${bMod.map(formatFloatVecElem).join(sep)}]` : "[1.0]",
        );
        newBlock.parameters.set(
          "Denominator",
          Array.isArray(aMod) ? `[${aMod.map(formatFloatVecElem).join(sep)}]` : "[1.0, 1.0]",
        );
        newBlock.parameters.set("SampleTime", typeof stMod === "number" ? stMod : 0.001);
      }

      model.rootSystem.blocks.set(compName, newBlock);
      blocksById.set(compName, newBlock);
      changes.push({
        target: "component",
        elementId: compName,
        reconciledVal: blockType,
        strategy,
      });
    }
  }

  // 3. Synchronize Newly Added Connections
  for (const conn of parsedModelica.connections) {
    const srcParts = conn.source.split(".");
    const dstParts = conn.target.split(".");
    if (srcParts.length === 2 && dstParts.length === 2) {
      const srcBlock = srcParts[0]!;
      const dstBlock = dstParts[0]!;
      const dstPort = dstParts[1] === "u2" ? 2 : 1;

      const exists = model.rootSystem.lines.some(
        (l) => l.srcBlock === srcBlock && (l.dstBlock === dstBlock || l.branches.some((b) => b.dstBlock === dstBlock)),
      );

      if (!exists && blocksById.has(srcBlock) && blocksById.has(dstBlock)) {
        model.rootSystem.lines.push({
          id: `Line_${srcBlock}_to_${dstBlock}`,
          srcBlock,
          srcPort: 1,
          dstBlock,
          dstPort,
          branches: [],
        });
        changes.push({
          target: "connection",
          elementId: `${srcBlock}->${dstBlock}`,
          reconciledVal: `${conn.source} -> ${conn.target}`,
          strategy,
        });
      }
    }
  }

  const updatedText = isXml ? patchSlxXmlViaCst(originalSimulinkText, model) : serializeMdl(model);

  return {
    updatedText,
    changes,
    conflicts: transformer.getConflicts(),
  };
}

function formatFloatVecElem(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

/**
 * Applies surgical XML CST splices (`@modelscript/dsl/xml`) to `<System>` SLX XML,
 * preserving XML comments, unmapped `<P>` tags, `SID` attributes, and formatting.
 */
function patchSlxXmlViaCst(originalXml: string, model: SimulinkModel): string {
  const xmlDoc = xml.parseXml(originalXml);
  if (!xmlDoc.root) {
    return serializeSlxXmlFallback(model);
  }

  const splices: Splice[] = [];
  const sysEl =
    xmlDoc.root.name.toUpperCase() === "SYSTEM" ? xmlDoc.root : findXmlElements(xmlDoc.root, "System")[0];

  if (sysEl && model.name && model.name !== "SimulinkModel") {
    const nameAttr = sysEl.attributes.find((a: any) => a.name === "Name");
    if (nameAttr && nameAttr.value !== model.name) {
      splices.push(xml.setAttributeSplice(sysEl, "Name", model.name, originalXml));
    }
  }

  const blockEls = findXmlElements(xmlDoc.root, "Block");
  const matchedBlockNames = new Set<string>();

  for (const block of model.rootSystem.blocks.values()) {
    const blockEl = blockEls.find(
      (el) =>
        el.attributes.find((a: any) => a.name === "SID")?.value === block.id ||
        el.attributes.find((a: any) => a.name === "Name")?.value === block.name,
    );

    if (blockEl) {
      matchedBlockNames.add(block.name);
      const nameAttr = blockEl.attributes.find((a: any) => a.name === "Name");
      if (nameAttr && nameAttr.value !== block.name) {
        splices.push(xml.setAttributeSplice(blockEl, "Name", block.name, originalXml));
      }

      const pEls = blockEl.children.filter((c: any) => c.name === "P");
      for (const [k, v] of block.parameters) {
        let formatted = String(v);
        if (k === "Gain" && typeof v === "number" && Number.isInteger(v)) {
          formatted = `${v}.0`;
        }
        const pEl = pEls.find((p: any) => p.attributes.find((a: any) => a.name === "Name")?.value === k);
        if (pEl && !pEl.selfClosing) {
          if (pEl.text !== formatted) {
            splices.push(xml.setElementTextSplice(pEl, formatted));
          }
        } else if (!blockEl.selfClosing) {
          splices.push(xml.appendChildSplice(blockEl, `<P Name="${k}">${formatted}</P>`, originalXml));
        }
      }
    } else if (sysEl && !sysEl.selfClosing) {
      matchedBlockNames.add(block.name);
      const sidAttr = block.id && block.id !== block.name ? ` SID="${block.id}"` : "";
      if (block.parameters.size === 0) {
        splices.push(
          xml.appendChildSplice(sysEl, `<Block BlockType="${block.type}" Name="${block.name}"${sidAttr}/>`, originalXml),
        );
      } else {
        const paramLines: string[] = [];
        for (const [k, v] of block.parameters) {
          let formatted = String(v);
          if (k === "Gain" && typeof v === "number" && Number.isInteger(v)) {
            formatted = `${v}.0`;
          }
          paramLines.push(`    <P Name="${k}">${formatted}</P>`);
        }
        const blockXml = `<Block BlockType="${block.type}" Name="${block.name}"${sidAttr}>\n${paramLines.join("\n")}\n  </Block>`;
        splices.push(xml.appendChildSplice(sysEl, blockXml, originalXml));
      }
    }
  }

  return xml.applySplices(originalXml, splices);
}

function serializeSlxXmlFallback(model: SimulinkModel): string {
  const sysName = model.name || "SuspensionControl";
  const lines: string[] = [];
  lines.push(`<System Name="${sysName}">`);

  const sidByBlockName = new Map<string, string>();
  for (const block of model.rootSystem.blocks.values()) {
    sidByBlockName.set(block.name, block.id);
    const sidAttr = block.id && block.id !== block.name ? ` SID="${block.id}"` : "";
    if (block.parameters.size === 0) {
      lines.push(`  <Block BlockType="${block.type}" Name="${block.name}"${sidAttr}/>`);
    } else {
      lines.push(`  <Block BlockType="${block.type}" Name="${block.name}"${sidAttr}>`);
      for (const [k, v] of block.parameters) {
        let formatted = String(v);
        if (k === "Gain" && typeof v === "number" && Number.isInteger(v)) {
          formatted = `${v}.0`;
        }
        lines.push(`    <P Name="${k}">${formatted}</P>`);
      }
      lines.push(`  </Block>`);
    }
  }

  for (const line of model.rootSystem.lines) {
    const srcSid = sidByBlockName.get(line.srcBlock) ?? line.srcBlock;
    if (line.dstBlock) {
      const dstSid = sidByBlockName.get(line.dstBlock) ?? line.dstBlock;
      lines.push(`  <Line>`);
      lines.push(`    <P Name="Src">${srcSid}#out:${line.srcPort}</P>`);
      lines.push(`    <P Name="Dst">${dstSid}#in:${line.dstPort ?? 1}</P>`);
      lines.push(`  </Line>`);
    }
  }

  lines.push(`</System>`);
  return lines.join("\n");
}

function resolveParameterConflict(
  transformer: PolyglotTransformer,
  id: string,
  sourceVal: number,
  targetVal: number,
  strategy: string,
  options?: SyncOptions,
): number {
  transformer.recordConflict(id, sourceVal, targetVal, simulinkTggRules[0]?.name);

  if (strategy === "source-wins") {
    transformer.resolveConflict(id, "source");
    return sourceVal;
  }

  if (strategy === "physics-simplex") {
    const bounds = options?.physicsBounds?.[id] || options?.physicsBounds?.[id.split(".")[0]!];
    const min = bounds?.min ?? Math.min(sourceVal, targetVal) * 0.8;
    const max = bounds?.max ?? Math.max(sourceVal, targetVal) * 1.2;
    transformer.resolveConflictPhysics(id, min, max);
    const resolved = transformer.getConflicts().find((c) => c.id === id)?.resolved;
    return typeof resolved === "number" ? resolved : targetVal;
  }

  transformer.resolveConflict(id, "target");
  return targetVal;
}

function mapModelicaTypeToSimulink(typeSpec: string): SimulinkBlock["type"] {
  if (typeSpec.includes("Math.Gain")) return "Gain";
  if (typeSpec.includes("Continuous.Integrator")) return "Integrator";
  if (typeSpec.includes("Sources.Constant")) return "Constant";
  if (typeSpec.includes("Math.Feedback")) return "Sum";
  if (typeSpec.includes("Math.Add")) return "Sum";
  if (typeSpec.includes("Discrete.TransferFunction")) return "DiscreteFilter";
  if (typeSpec.includes("Continuous.TransferFunction")) return "TransferFcn";
  if (typeSpec.includes("Discrete.UnitDelay")) return "UnitDelay";
  if (typeSpec.includes("Interfaces.RealInput")) return "Inport";
  if (typeSpec.includes("Interfaces.RealOutput")) return "Outport";
  return "Gain";
}
