// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulink — Bidirectional TGG Round-Trip Synchronizer.
 *
 * Propagates parameter adjustments, topological rewiring, and component lifecycle changes
 * from modified Modelica models back into MATLAB/Simulink (.mdl, .slx) source models.
 */

import { PolyglotTransformer } from "@modelscript/runtime";
import { parseMdl, serializeMdl } from "../parser/mdl-parser.js";
import type { SimulinkBlock, SimulinkModel } from "../types.js";
import { parseModelicaBlocks } from "./modelica-parser.js";
import { simulinkPolyglotConfig } from "./simulink-rules.js";
import type { ReconciledChange, SyncOptions, SyncResult } from "./types.js";

export function synchronizeModelicaToSimulink(
  originalSimulinkText: string,
  modifiedModelicaText: string,
  options?: SyncOptions,
): SyncResult {
  const model: SimulinkModel = parseMdl(originalSimulinkText);
  const parsedModelica = parseModelicaBlocks(modifiedModelicaText);
  const transformer = new PolyglotTransformer(simulinkPolyglotConfig);
  const changes: ReconciledChange[] = [];
  const strategy = options?.strategy ?? "target-wins";

  // Index existing blocks by normalized identifier
  const blocksById = new Map<string, SimulinkBlock>();
  let maxSid = 0;
  for (const block of model.rootSystem.blocks.values()) {
    blocksById.set(block.name, block);
    const sidNum = parseInt(block.id, 10);
    if (!isNaN(sidNum) && sidNum > maxSid) {
      maxSid = sidNum;
    }
  }

  // 1. Synchronize Parameter Modifications
  for (const [compName, moComp] of parsedModelica.components) {
    const block = blocksById.get(compName);
    if (!block) continue;

    switch (block.type) {
      case "Gain": {
        const oldGain = Number(block.parameters.get("Gain") ?? 1.0);
        const newGain = moComp.modifications["k"] !== undefined ? Number(moComp.modifications["k"]) : oldGain;
        if (!isNaN(newGain) && newGain !== oldGain) {
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
        if (!isNaN(newIc) && newIc !== oldIc) {
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
        if (!isNaN(newVal) && newVal !== oldVal) {
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
        if (Array.isArray(moComp.modifications["b"])) {
          const bVec = `[${(moComp.modifications["b"] as number[]).join(" ")}]`;
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
          const aVec = `[${(moComp.modifications["a"] as number[]).join(" ")}]`;
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

  const updatedText = serializeMdl(model);

  return {
    updatedText,
    changes,
    conflicts: transformer.getConflicts(),
  };
}

function resolveParameterConflict(
  transformer: PolyglotTransformer,
  id: string,
  sourceVal: number,
  targetVal: number,
  strategy: string,
  options?: SyncOptions,
): number {
  transformer.recordConflict(id, sourceVal, targetVal);

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

  // default: target-wins
  transformer.resolveConflict(id, "target");
  return targetVal;
}

function mapModelicaTypeToSimulink(typeSpec: string): SimulinkBlock["type"] {
  if (typeSpec.includes("Math.Gain")) return "Gain";
  if (typeSpec.includes("Continuous.Integrator")) return "Integrator";
  if (typeSpec.includes("Sources.Constant")) return "Constant";
  if (typeSpec.includes("Math.Feedback")) return "Sum";
  if (typeSpec.includes("Math.Add")) return "Sum";
  if (typeSpec.includes("Continuous.TransferFunction")) return "TransferFcn";
  if (typeSpec.includes("Discrete.UnitDelay")) return "UnitDelay";
  if (typeSpec.includes("Interfaces.RealInput")) return "Inport";
  if (typeSpec.includes("Interfaces.RealOutput")) return "Outport";
  return "Gain";
}
