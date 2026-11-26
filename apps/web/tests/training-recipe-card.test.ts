// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeRecipeSemanticDiff,
  generateRecipeBibtex,
  parseTrainingRecipeViewConfig,
} from "../src/components/artifacts/training-recipe-model.js";

describe("TrainingRecipeArtifactCard Model & Semantic Diff", () => {
  const parentCfg = {
    packageName: "@grid/ieee39-qlora-recipe",
    version: "1.0.0",
    title: "IEEE 39-Bus Fault Recovery QLoRA (1.5B)",
    authorHandle: "@alice@lab-a.edu",
    dependencies: {
      "@modelica/msl-dataset": "^4.1.0",
    },
    ml: {
      kind: "training-recipe",
      targetModel: {
        baseModel: "ansatz-core-1.5b",
        parameterScale: "1.5B",
        mode: "posttrain-qlora",
        loraRank: 16,
      },
      dynamicM: {
        mStart: 1,
        mMax: 16,
        mCap: 32,
        expansionTau: 0.05,
        pruneEps: 1e-4,
        collinearCosineThreshold: 0.98,
        girardReduceEvery: 4,
        retrievalTau: 0.35,
      },
      rewardWeights: {
        gate1Syntax: 0.15,
        gate2Units: 0.2,
        gate3Smt: 0.2,
        gate4Dae: 0.2,
        physicsSim: 0.15,
        cadClearance: 0.0,
        zonotopeContraction: 0.1,
      },
      memoryContract: {
        embedderId: "ansatz-embed-v1",
        embedderHash: "sha256:abc",
        dimension: 1024,
        quantization: "int8-diskann",
        sourcePackages: [],
      },
      memoryPins: [
        {
          originNode: "ansatz.social",
          packageName: "@modelica/msl-memory",
          version: "4.1.0",
          signerPubkey: "z6MkpTHR8VNsBxYAAW",
        },
      ],
    },
    evalMetrics: {
      passAt1: 0.64,
      gate1To4PassRate: 0.91,
      simRmse: 0.018,
      independentReproductions: 2,
    },
  };

  it("parses view_config into normalized card data and flags WebGPU-runnable QLoRA recipes", () => {
    const parsed = parseTrainingRecipeViewConfig(parentCfg);
    assert.equal(parsed.kind, "training-recipe");
    assert.equal(parsed.packageName, "@grid/ieee39-qlora-recipe");
    assert.equal(parsed.webGpuRunnable, true);
    assert.equal(parsed.memoryPins.length, 1);
    assert.equal(parsed.memoryContract?.embedderId, "ansatz-embed-v1");
    assert.equal(parsed.evalMetrics.passAt1, 0.64);
  });

  it("computes semantic diffs across dataset pins, Dynamic-m, reward weights, and Pass@1", () => {
    const parent = parseTrainingRecipeViewConfig(parentCfg);
    const child = parseTrainingRecipeViewConfig({
      ...parentCfg,
      version: "1.1.0",
      dependencies: {
        "@modelica/msl-dataset": "^4.1.0",
        "@ieee/grid-faults-posttrain": "^2.1.0",
      },
      ml: {
        ...parentCfg.ml,
        dynamicM: { ...parentCfg.ml.dynamicM, mMax: 24 },
        rewardWeights: { ...parentCfg.ml.rewardWeights, gate2Units: 0.35 },
      },
      evalMetrics: { ...parentCfg.evalMetrics, passAt1: 0.78 },
    });

    const diff = computeRecipeSemanticDiff(parent, child);
    assert.ok(diff.some((d) => d.field === "dataset:@ieee/grid-faults-posttrain" && d.kind === "added"));
    assert.ok(diff.some((d) => d.field === "dynamicM.mMax" && d.before === "16" && d.after === "24"));
    assert.ok(diff.some((d) => d.field === "reward.gate2Units" && d.before === "0.20" && d.after === "0.35"));
    assert.ok(diff.some((d) => d.field === "eval.passAt1" && d.deltaLabel === "+14%"));
  });

  it("generates a citable BibTeX block including embedder metadata", () => {
    const parsed = parseTrainingRecipeViewConfig(parentCfg);
    const bib = generateRecipeBibtex(parsed, "https://ansatz.social/@alice/status/42");
    assert.match(bib, /@misc\{grid_ieee39_qlora_recipe_1_0_0_/);
    assert.match(bib, /ansatz-embed-v1/);
    assert.match(bib, /https:\/\/ansatz\.social\/@alice\/status\/42/);
  });
});
