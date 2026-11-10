// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser for Wastewater Treatment Plant (.asm, .bsm, .wrrf) Model Descriptions.
 */

import { DEFAULT_TAKACS_CONFIG } from "../clarifier/takacs.js";
import type { AsmBioreactor, AsmModelType, AsmPlantModel, AsmReactorType, TakacsClarifierConfig } from "../types.js";

/**
 * Parses an ASM/BSM plant configuration text into an AsmPlantModel.
 */
export function parseAsmPlant(text: string): AsmPlantModel {
  let plantName = "Wastewater_Plant";
  let modelType: AsmModelType = "ASM1";
  let influentFlow = 18446.0;
  const influentConcentrations: Record<string, number> = {
    S_I: 30.0,
    S_S: 69.5,
    X_I: 51.2,
    X_S: 202.32,
    X_BH: 28.17,
    X_BA: 0.0,
    X_P: 0.0,
    S_O: 0.0,
    S_NO: 0.0,
    S_NH: 31.56,
    S_ND: 6.95,
    X_ND: 10.59,
    S_ALK: 7.0,
  };
  let internalRecycleRatio = 3.0;
  let sludgeRecycleRatio = 1.0;
  let wasteFlowM3Day = 385.0;

  const reactors: AsmBioreactor[] = [];
  const clarifiers: TakacsClarifierConfig[] = [];

  // Plant name
  const plantMatch = /plant\s+([a-zA-Z0-9_]+)/i.exec(text);
  if (plantMatch && plantMatch[1]) {
    plantName = plantMatch[1];
  }

  // Model type
  const modelMatch = /model\s*:\s*([a-zA-Z0-9_]+)/i.exec(text);
  if (modelMatch && modelMatch[1]) {
    const raw = modelMatch[1].toUpperCase();
    if (raw === "ASM1" || raw === "ASM2D" || raw === "ASM3" || raw === "ADM1") {
      modelType = raw as AsmModelType;
    }
  }

  // Influent section
  const infMatch = /influent\s*\{([\s\S]*?)\}/i.exec(text);
  if (infMatch && infMatch[1]) {
    const infContent = infMatch[1];
    const flowMatch = /flow\s*:\s*([\d.]+)/i.exec(infContent);
    if (flowMatch && flowMatch[1]) {
      influentFlow = parseFloat(flowMatch[1]);
    }
    const propRegex = /([a-zA-Z0-9_]+)\s*:\s*(-?[\d.]+)/gi;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = propRegex.exec(infContent)) !== null) {
      const key = pMatch[1]!;
      if (key.toLowerCase() !== "flow") {
        influentConcentrations[key] = parseFloat(pMatch[2]!);
      }
    }
  }

  // Recycle section
  const recMatch = /recycle\s*\{([\s\S]*?)\}/i.exec(text);
  if (recMatch && recMatch[1]) {
    const recContent = recMatch[1];
    const intMatch = /internal_ratio\s*:\s*([\d.]+)/i.exec(recContent);
    if (intMatch && intMatch[1]) internalRecycleRatio = parseFloat(intMatch[1]);

    const rasMatch = /sludge_ratio\s*:\s*([\d.]+)/i.exec(recContent);
    if (rasMatch && rasMatch[1]) sludgeRecycleRatio = parseFloat(rasMatch[1]);

    const wasMatch = /waste_flow\s*:\s*([\d.]+)/i.exec(recContent);
    if (wasMatch && wasMatch[1]) wasteFlowM3Day = parseFloat(wasMatch[1]);
  }

  // Bioreactors
  const reactorRegex = /bioreactor\s+([a-zA-Z0-9_]+)\s*\{([\s\S]*?)\}/gi;
  let rMatch: RegExpExecArray | null;
  while ((rMatch = reactorRegex.exec(text)) !== null) {
    const rName = rMatch[1]!;
    const rContent = rMatch[2]!;

    let type: AsmReactorType = "Aerobic";
    let volume = 1000.0;
    let kla: number | undefined;
    let doTarget: number | undefined;

    const typeMatch = /type\s*:\s*([a-zA-Z0-9_]+)/i.exec(rContent);
    if (typeMatch && typeMatch[1]) {
      type = typeMatch[1] as AsmReactorType;
    }

    const volMatch = /volume\s*:\s*([\d.]+)/i.exec(rContent);
    if (volMatch && volMatch[1]) volume = parseFloat(volMatch[1]);

    const klaMatch = /kla\s*:\s*([\d.]+)/i.exec(rContent);
    if (klaMatch && klaMatch[1]) kla = parseFloat(klaMatch[1]);

    const doMatch = /do_target\s*:\s*([\d.]+)/i.exec(rContent);
    if (doMatch && doMatch[1]) doTarget = parseFloat(doMatch[1]);

    reactors.push({
      name: rName,
      type,
      volumeM3: volume,
      klaHr: kla,
      doTargetMgL: doTarget,
    });
  }

  // Clarifiers
  const clarifierRegex = /clarifier\s+([a-zA-Z0-9_]+)\s*\{([\s\S]*?)\}/gi;
  let cMatch: RegExpExecArray | null;
  while ((cMatch = clarifierRegex.exec(text)) !== null) {
    const cName = cMatch[1]!;
    const cContent = cMatch[2]!;

    let area = DEFAULT_TAKACS_CONFIG.surfaceAreaM2;
    let depth = DEFAULT_TAKACS_CONFIG.heightM;
    let layers = DEFAULT_TAKACS_CONFIG.layers;
    let feedLayer = DEFAULT_TAKACS_CONFIG.feedLayer;

    const areaMatch = /area\s*:\s*([\d.]+)/i.exec(cContent);
    if (areaMatch && areaMatch[1]) area = parseFloat(areaMatch[1]);

    const depthMatch = /depth\s*:\s*([\d.]+)/i.exec(cContent);
    if (depthMatch && depthMatch[1]) depth = parseFloat(depthMatch[1]);

    const layersMatch = /layers\s*:\s*(\d+)/i.exec(cContent);
    if (layersMatch && layersMatch[1]) layers = parseInt(layersMatch[1], 10);

    const feedMatch = /feed_layer\s*:\s*(\d+)/i.exec(cContent);
    if (feedMatch && feedMatch[1]) feedLayer = parseInt(feedMatch[1], 10);

    clarifiers.push({
      ...DEFAULT_TAKACS_CONFIG,
      name: cName,
      surfaceAreaM2: area,
      heightM: depth,
      layers,
      feedLayer,
    });
  }

  return {
    name: plantName,
    modelType,
    reactors,
    clarifiers,
    influentFlowM3Day: influentFlow,
    influentConcentrations,
    internalRecycleRatio,
    sludgeRecycleRatio,
    wasteFlowM3Day,
  };
}
