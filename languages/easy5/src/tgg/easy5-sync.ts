// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/easy5 — Bidirectional TGG Round-Trip Synchronizer.
 *
 * Synchronizes parameter modifications, component additions, and connection rewiring
 * from modified Modelica models back into Boeing/MSC Software EASY5 (.ez5) decks.
 */

import { PolyglotTransformer } from "@modelscript/runtime";
import { parseEasy5 } from "../parser/easy5-parser.js";
import { easy5PolyglotConfig } from "./easy5-rules.js";
import { parseModelicaBlocks } from "./modelica-parser.js";
import type { ReconciledChange, SyncOptions, SyncResult } from "./types.js";

export function synchronizeModelicaToEasy5(
  originalEz5Text: string,
  modifiedModelicaText: string,
  options?: SyncOptions,
): SyncResult {
  const model = parseEasy5(originalEz5Text);
  const parsedModelica = parseModelicaBlocks(modifiedModelicaText);
  const transformer = new PolyglotTransformer(easy5PolyglotConfig);
  const changes: ReconciledChange[] = [];
  const strategy = options?.strategy ?? "target-wins";

  const updatedParams = new Map<string, Record<string, number | number[] | string>>();
  const updatedStates = new Map<string, Record<string, number>>();
  const addedComponents: { id: string; type: string; xp: string }[] = [];
  const addedConnections: string[] = [];

  // 1. Reconcile Parameters with Modelica Modifications
  for (const [rawCompName, moComp] of parsedModelica.components) {
    const compId = rawCompName.toUpperCase();
    const comp = model.components.get(compId);

    if (comp) {
      const t = comp.type.toUpperCase().replace(/^GP\//, "");

      if (t === "GA" && moComp.modifications["k"] !== undefined) {
        const oldK = typeof comp.parameters["K"] === "number" ? comp.parameters["K"] : 1.0;
        const newK = Number(moComp.modifications["k"]);
        if (!isNaN(newK) && newK !== oldK) {
          const resolved = resolveParameterConflict(transformer, `${compId}.K`, oldK, newK, strategy, options);
          if (!updatedParams.has(compId)) updatedParams.set(compId, {});
          updatedParams.get(compId)!["K"] = resolved;
          changes.push({
            target: "parameter",
            elementId: compId,
            property: "K",
            sourceOldVal: oldK,
            targetNewVal: newK,
            reconciledVal: resolved,
            strategy,
          });
        }
      }

      if (t === "IN") {
        if (moComp.modifications["k"] !== undefined) {
          const oldGain = typeof comp.parameters["GAIN"] === "number" ? comp.parameters["GAIN"] : 1.0;
          const newGain = Number(moComp.modifications["k"]);
          if (!isNaN(newGain) && newGain !== oldGain) {
            const resolved = resolveParameterConflict(
              transformer,
              `${compId}.GAIN`,
              oldGain,
              newGain,
              strategy,
              options,
            );
            if (!updatedParams.has(compId)) updatedParams.set(compId, {});
            updatedParams.get(compId)!["GAIN"] = resolved;
            changes.push({
              target: "parameter",
              elementId: compId,
              property: "GAIN",
              sourceOldVal: oldGain,
              targetNewVal: newGain,
              reconciledVal: resolved,
              strategy,
            });
          }
        }
        if (moComp.modifications["y_start"] !== undefined) {
          const oldS0 =
            comp.initialStates["S1"] ?? (typeof comp.parameters["S0"] === "number" ? comp.parameters["S0"] : 0.0);
          const newS0 = Number(moComp.modifications["y_start"]);
          if (!isNaN(newS0) && newS0 !== oldS0) {
            const resolved = resolveParameterConflict(transformer, `${compId}.S0`, oldS0, newS0, strategy, options);
            if (comp.parameters["S0"] !== undefined || Object.keys(comp.initialStates).length === 0) {
              if (!updatedParams.has(compId)) updatedParams.set(compId, {});
              updatedParams.get(compId)!["S0"] = resolved;
            } else {
              if (!updatedStates.has(compId)) updatedStates.set(compId, {});
              updatedStates.get(compId)!["S1"] = resolved;
            }
            changes.push({
              target: "state",
              elementId: compId,
              property: "S0",
              sourceOldVal: oldS0,
              targetNewVal: newS0,
              reconciledVal: resolved,
              strategy,
            });
          }
        }
      }

      if (t === "LM") {
        if (moComp.modifications["uMax"] !== undefined) {
          const oldUl = typeof comp.parameters["UL"] === "number" ? comp.parameters["UL"] : 1.0;
          const newUl = Number(moComp.modifications["uMax"]);
          if (!isNaN(newUl) && newUl !== oldUl) {
            if (!updatedParams.has(compId)) updatedParams.set(compId, {});
            updatedParams.get(compId)!["UL"] = newUl;
            changes.push({
              target: "parameter",
              elementId: compId,
              property: "UL",
              sourceOldVal: oldUl,
              targetNewVal: newUl,
              reconciledVal: newUl,
              strategy,
            });
          }
        }
        if (moComp.modifications["uMin"] !== undefined) {
          const oldLl = typeof comp.parameters["LL"] === "number" ? comp.parameters["LL"] : -1.0;
          const newLl = Number(moComp.modifications["uMin"]);
          if (!isNaN(newLl) && newLl !== oldLl) {
            if (!updatedParams.has(compId)) updatedParams.set(compId, {});
            updatedParams.get(compId)!["LL"] = newLl;
            changes.push({
              target: "parameter",
              elementId: compId,
              property: "LL",
              sourceOldVal: oldLl,
              targetNewVal: newLl,
              reconciledVal: newLl,
              strategy,
            });
          }
        }
      }

      if (t === "TF") {
        if (Array.isArray(moComp.modifications["b"])) {
          if (!updatedParams.has(compId)) updatedParams.set(compId, {});
          updatedParams.get(compId)!["NUM"] = moComp.modifications["b"];
          changes.push({
            target: "parameter",
            elementId: compId,
            property: "NUM",
            reconciledVal: moComp.modifications["b"],
            strategy,
          });
        }
        if (Array.isArray(moComp.modifications["a"])) {
          if (!updatedParams.has(compId)) updatedParams.set(compId, {});
          updatedParams.get(compId)!["DEN"] = moComp.modifications["a"];
          changes.push({
            target: "parameter",
            elementId: compId,
            property: "DEN",
            reconciledVal: moComp.modifications["a"],
            strategy,
          });
        }
      }
    } else {
      // 2. Newly Added Component in Modelica
      const easy5Type = mapModelicaTypeToEasy5(moComp.typeSpecifier);
      let xp = "";
      if (easy5Type === "GP/GA") {
        const k = moComp.modifications["k"] ?? 1.0;
        xp = `K=${k}`;
      } else if (easy5Type === "GP/IN") {
        const k = moComp.modifications["k"] ?? 1.0;
        const s0 = moComp.modifications["y_start"] ?? 0.0;
        xp = `GAIN=${k}, S0=${s0}`;
      }
      addedComponents.push({ id: compId, type: easy5Type, xp });
      changes.push({
        target: "component",
        elementId: compId,
        reconciledVal: easy5Type,
        strategy,
      });
    }
  }

  // 3. Newly Added Connections
  for (const conn of parsedModelica.connections) {
    const srcParts = conn.source.split(".");
    const dstParts = conn.target.split(".");
    if (srcParts.length === 2 && dstParts.length === 2) {
      const fromComp = srcParts[0]!.toUpperCase();
      const toComp = dstParts[0]!.toUpperCase();
      const fromPort = srcParts[1] === "y" ? "OUT" : "OUT";
      const toPort = dstParts[1] === "u2" ? "IN2" : dstParts[1] === "u1" ? "IN1" : "IN";

      const exists = model.connections.some((c) => c.fromComponent === fromComp && c.toComponent === toComp);
      if (!exists) {
        addedConnections.push(`  ${fromComp}.${fromPort} -> ${toComp}.${toPort}`);
        changes.push({
          target: "connection",
          elementId: `${fromComp}->${toComp}`,
          reconciledVal: `${fromComp}.${fromPort} -> ${toComp}.${toPort}`,
          strategy,
        });
      }
    }
  }

  // 4. Surgical Source Text Rewriter preserving layout, Fortran blocks, and comments
  const lines = originalEz5Text.split(/\r?\n/);
  const outputLines: string[] = [];
  let currentCompId: string | null = null;
  let seenXpForCurrentComp = false;
  let inFortran = false;
  let seenConnectionsHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (inFortran) {
      if (/^\s*(ENDFORTRAN|END_USER_CODE|END\s+USER_CODE|END\s+CODE)\b/i.test(trimmed)) {
        inFortran = false;
      }
      outputLines.push(line);
      continue;
    }

    if (/^\s*(FORTRAN|USER_CODE|CODE)\s*:/i.test(trimmed)) {
      inFortran = true;
      outputLines.push(line);
      continue;
    }

    // Check for component declaration line
    const cmpMatch = /^([A-Za-z0-9_]{2,8})\s+(?:TYPE\s*=\s*[A-Za-z0-9_/]+|[A-Za-z0-9_/]+)(?:\s|$)/i.exec(trimmed);
    if (cmpMatch && !trimmed.startsWith("XP:") && !trimmed.startsWith("S0:") && !trimmed.startsWith("PORTS:")) {
      // If previous component needed XP line inserted
      if (currentCompId && !seenXpForCurrentComp && updatedParams.has(currentCompId)) {
        outputLines.push(formatXpLine(updatedParams.get(currentCompId)!));
      }
      currentCompId = cmpMatch[1]!.toUpperCase();
      seenXpForCurrentComp = false;
      outputLines.push(line);
      continue;
    }

    // Check for XP line
    if (currentCompId && /^\s*XP\s*:\s*/i.test(trimmed)) {
      seenXpForCurrentComp = true;
      if (updatedParams.has(currentCompId)) {
        const newParams = updatedParams.get(currentCompId)!;
        outputLines.push(updateXpLine(line, newParams));
      } else {
        outputLines.push(line);
      }
      continue;
    }

    // Check for S0 line
    if (currentCompId && /^\s*S0\s*:\s*/i.test(trimmed)) {
      if (updatedStates.has(currentCompId)) {
        const newStates = updatedStates.get(currentCompId)!;
        outputLines.push(updateS0Line(line, newStates));
      } else {
        outputLines.push(line);
      }
      continue;
    }

    // Check for CONNECTIONS: section
    if (/^CONNECTIONS\s*:/i.test(trimmed)) {
      seenConnectionsHeader = true;
      // Before entering connections, if last component needed XP inserted
      if (currentCompId && !seenXpForCurrentComp && updatedParams.has(currentCompId)) {
        outputLines.push(formatXpLine(updatedParams.get(currentCompId)!));
        seenXpForCurrentComp = true;
      }
      // If new components were added, insert them before CONNECTIONS
      if (addedComponents.length > 0) {
        for (const added of addedComponents) {
          outputLines.push(`  ${added.id} TYPE=${added.type}`);
          if (added.xp) {
            outputLines.push(`    XP: ${added.xp}`);
          }
        }
      }
      outputLines.push(line);
      continue;
    }

    outputLines.push(line);
  }

  // If last component in file needed XP
  if (currentCompId && !seenXpForCurrentComp && updatedParams.has(currentCompId)) {
    outputLines.push(formatXpLine(updatedParams.get(currentCompId)!));
  }

  // If new connections need to be appended
  if (addedConnections.length > 0) {
    if (!seenConnectionsHeader) {
      outputLines.push("\nCONNECTIONS:");
    }
    for (const connLine of addedConnections) {
      outputLines.push(connLine);
    }
  }

  return {
    updatedText: outputLines.join("\n"),
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

  transformer.resolveConflict(id, "target");
  return targetVal;
}

function formatXpLine(params: Record<string, number | number[] | string>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      parts.push(`${k}=[${v.join(", ")}]`);
    } else {
      parts.push(`${k}=${v}`);
    }
  }
  return `    XP: ${parts.join(", ")}`;
}

function updateXpLine(origLine: string, params: Record<string, number | number[] | string>): string {
  const indentMatch = /^\s*/.exec(origLine);
  const indent = indentMatch ? indentMatch[0] : "    ";
  const content = origLine.replace(/^\s*XP\s*:\s*/i, "");

  // Update existing key=val or append
  const map: Record<string, string> = {};
  const pairs = content.split(",");
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx !== -1) {
      const k = pair.slice(0, eqIdx).trim().toUpperCase();
      const v = pair.slice(eqIdx + 1).trim();
      map[k] = v;
    }
  }

  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      map[k] = `[${v.join(", ")}]`;
    } else {
      map[k] = String(v);
    }
  }

  const serialized = Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return `${indent}XP: ${serialized}`;
}

function updateS0Line(origLine: string, states: Record<string, number>): string {
  const indentMatch = /^\s*/.exec(origLine);
  const indent = indentMatch ? indentMatch[0] : "    ";
  const content = origLine.replace(/^\s*S0\s*:\s*/i, "");

  const map: Record<string, string> = {};
  const pairs = content.split(",");
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx !== -1) {
      const k = pair.slice(0, eqIdx).trim().toUpperCase();
      const v = pair.slice(eqIdx + 1).trim();
      map[k] = v;
    }
  }

  for (const [k, v] of Object.entries(states)) {
    map[k] = String(v);
  }

  const serialized = Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return `${indent}S0: ${serialized}`;
}

function mapModelicaTypeToEasy5(typeSpec: string): string {
  if (typeSpec.includes("Math.Gain")) return "GP/GA";
  if (typeSpec.includes("Continuous.Integrator")) return "GP/IN";
  if (typeSpec.includes("Math.Add")) return "GP/SJ";
  if (typeSpec.includes("Math.Feedback")) return "GP/SJ";
  if (typeSpec.includes("Nonlinear.Limiter")) return "GP/LM";
  if (typeSpec.includes("Continuous.TransferFunction")) return "GP/TF";
  return "GP/GA";
}
