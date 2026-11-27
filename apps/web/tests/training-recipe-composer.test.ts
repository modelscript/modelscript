// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRecipeBlogMarkdownDraft,
  buildTrainingRecipeArtifactPayload,
  parseTrainingStudioUrlParams,
} from "../src/components/artifacts/training-recipe-composer-helpers.js";
import { parseTrainingRecipeViewConfig } from "../src/components/artifacts/training-recipe-model.js";

describe("Training Recipe Composer Helpers & Deep-Link UX", () => {
  describe("parseTrainingStudioUrlParams", () => {
    it("parses Fork & Tune deep-links from TrainingRecipeArtifactCard", () => {
      const parsed = parseTrainingStudioUrlParams("?mode=training-studio&forkRecipe=%40grid%2Fieee39-qlora-recipe");
      assert.equal(parsed.isTrainingStudio, true);
      assert.equal(parsed.forkRecipe, "@grid/ieee39-qlora-recipe");
      assert.equal(parsed.recipe, null);
      assert.equal(parsed.runBackend, null);
      assert.equal(parsed.artifactId, null);
    });

    it("parses Run in WebGPU deep-links with recipe and artifact ID", () => {
      const parsed = parseTrainingStudioUrlParams(
        "?mode=training-studio&run=webgpu&recipe=%40grid%2Fieee39-qlora-recipe&artifact=42",
      );
      assert.equal(parsed.isTrainingStudio, true);
      assert.equal(parsed.forkRecipe, null);
      assert.equal(parsed.recipe, "@grid/ieee39-qlora-recipe");
      assert.equal(parsed.runBackend, "webgpu");
      assert.equal(parsed.artifactId, "42");
    });

    it("returns inactive defaults when mode is not training-studio", () => {
      const parsed = parseTrainingStudioUrlParams("?template=rlc-circuit&lang=modelica");
      assert.equal(parsed.isTrainingStudio, false);
      assert.equal(parsed.forkRecipe, null);
      assert.equal(parsed.recipe, null);
      assert.equal(parsed.runBackend, null);
      assert.equal(parsed.artifactId, null);
    });
  });

  describe("buildTrainingRecipeArtifactPayload", () => {
    it("round-trips a training-recipe payload cleanly through parseTrainingRecipeViewConfig", () => {
      const payload = buildTrainingRecipeArtifactPayload({
        kind: "training-recipe",
        title: "IEEE 39-Bus Fault Recovery QLoRA (1.5B)",
        packageName: "@grid/ieee39-qlora-recipe",
        version: "1.1.0",
        authorHandle: "@alice@lab-a.edu",
        summary: "QLoRA fine-tune with expanded Dynamic-m zonotope schedule.",
        baseModel: "ansatz-core-1.5b",
        parameterScale: "1.5B",
        mode: "posttrain-qlora",
        loraRank: 16,
        mStart: 1,
        mMax: 24,
        mCap: 32,
        embedderId: "ansatz-embed-v1",
        embedderHash: "sha256:abc123",
        embedderDimension: 1024,
        quantization: "int8-diskann",
        datasetDependencies: {
          "@modelica/msl-dataset": "^4.1.0",
          "@ieee/grid-faults-posttrain": "^2.1.0",
        },
        memoryPins: [
          {
            originNode: "ansatz.social",
            packageName: "@modelica/msl-memory",
            version: "4.1.0",
            signerPubkey: "z6MkpTHR8VNsBxYAAW",
          },
        ],
        evalMetrics: {
          gate1To4PassRate: 0.94,
          passAt1: 0.78,
          simRmse: 0.012,
        },
        failureBounties: [
          {
            challengeId: 107,
            title: "Three-phase fault crowbar oscillation",
            dialect: "modelica",
            deltaT: 0.62,
            bountyCredits: 250,
          },
        ],
      });

      assert.equal(payload.view_type, "training-recipe");
      assert.equal(payload.title, "IEEE 39-Bus Fault Recovery QLoRA (1.5B)");

      const parsed = parseTrainingRecipeViewConfig(payload.view_config, payload.title, payload.view_type);
      assert.equal(parsed.kind, "training-recipe");
      assert.equal(parsed.packageName, "@grid/ieee39-qlora-recipe");
      assert.equal(parsed.version, "1.1.0");
      assert.equal(parsed.webGpuRunnable, true);
      assert.equal(parsed.targetModel?.baseModel, "ansatz-core-1.5b");
      assert.equal(parsed.targetModel?.mode, "posttrain-qlora");
      assert.equal(parsed.dynamicM?.mStart, 1);
      assert.equal(parsed.dynamicM?.mMax, 24);
      assert.equal(parsed.dynamicM?.mCap, 32);
      assert.equal(parsed.memoryContract?.embedderId, "ansatz-embed-v1");
      assert.equal(parsed.memoryPins.length, 1);
      assert.equal(parsed.datasetDependencies["@ieee/grid-faults-posttrain"], "^2.1.0");
      assert.equal(parsed.evalMetrics.gate1To4PassRate, 0.94);
      assert.equal(parsed.evalMetrics.passAt1, 0.78);
      assert.equal(parsed.evalMetrics.simRmse, 0.012);
      assert.equal(parsed.failureBounties.length, 1);
    });

    it("round-trips a memory-shard payload with view_type='memory-shard'", () => {
      const payload = buildTrainingRecipeArtifactPayload({
        kind: "memory-shard",
        packageName: "@modelica/msl-memory",
        version: "4.1.0",
        baseModel: "ansatz-core-1.5b",
        parameterScale: "1.5B",
        mode: "projection-head-align",
        mStart: 1,
        mMax: 16,
        mCap: 32,
        embedderId: "ansatz-embed-v1",
      });

      assert.equal(payload.view_type, "memory-shard");
      const parsed = parseTrainingRecipeViewConfig(payload.view_config, payload.title, payload.view_type);
      assert.equal(parsed.kind, "memory-shard");
      assert.equal(parsed.packageName, "@modelica/msl-memory");
      assert.equal(parsed.memoryContract?.embedderId, "ansatz-embed-v1");
    });
  });

  describe("buildRecipeBlogMarkdownDraft", () => {
    const parentPayload = buildTrainingRecipeArtifactPayload({
      kind: "training-recipe",
      title: "IEEE 39-Bus Baseline QLoRA (1.5B)",
      packageName: "@grid/ieee39-qlora-recipe",
      version: "1.0.0",
      authorHandle: "@alice@lab-a.edu",
      baseModel: "ansatz-core-1.5b",
      parameterScale: "1.5B",
      mode: "posttrain-qlora",
      mStart: 1,
      mMax: 16,
      mCap: 32,
      embedderId: "ansatz-embed-v1",
      datasetDependencies: {
        "@modelica/msl-dataset": "^4.1.0",
      },
      memoryPins: [
        {
          originNode: "ansatz.social",
          packageName: "@modelica/msl-memory",
          version: "4.1.0",
          signerPubkey: "z6MkpTHR8VNsBxYAAW",
        },
      ],
      evalMetrics: {
        gate1To4PassRate: 0.91,
        passAt1: 0.64,
        simRmse: 0.018,
      },
    });

    const childPayload = buildTrainingRecipeArtifactPayload({
      kind: "training-recipe",
      title: "IEEE 39-Bus Fault Recovery QLoRA (1.5B)",
      packageName: "@grid/ieee39-qlora-recipe",
      version: "1.1.0",
      authorHandle: "@bob@lab-b.edu",
      baseModel: "ansatz-core-1.5b",
      parameterScale: "1.5B",
      mode: "posttrain-qlora",
      mStart: 1,
      mMax: 24,
      mCap: 32,
      embedderId: "ansatz-embed-v1",
      datasetDependencies: {
        "@modelica/msl-dataset": "^4.1.0",
        "@ieee/grid-faults-posttrain": "^2.1.0",
      },
      memoryPins: [
        {
          originNode: "ansatz.social",
          packageName: "@modelica/msl-memory",
          version: "4.1.0",
          signerPubkey: "z6MkpTHR8VNsBxYAAW",
        },
      ],
      evalMetrics: {
        gate1To4PassRate: 0.94,
        passAt1: 0.78,
        simRmse: 0.012,
      },
      failureBounties: [
        {
          challengeId: 107,
          title: "Three-phase fault crowbar oscillation",
          dialect: "modelica",
          deltaT: 0.62,
          bountyCredits: 250,
        },
      ],
    });

    const parentRecipe = parseTrainingRecipeViewConfig(
      parentPayload.view_config,
      parentPayload.title,
      parentPayload.view_type,
    );
    const childRecipe = parseTrainingRecipeViewConfig(
      childPayload.view_config,
      childPayload.title,
      childPayload.view_type,
    );

    it("generates a standalone lab report with eval table, pins, bounties, and BibTeX", () => {
      const md = buildRecipeBlogMarkdownDraft(childRecipe, undefined, "https://ansatz.social/@bob/status/99");

      assert.match(md, /# IEEE 39-Bus Fault Recovery QLoRA \(1\.5B\)/);
      assert.match(md, /\| Base Model \| ansatz-core-1\.5b · 1\.5B \(posttrain-qlora\) \|/);
      assert.match(md, /\| Dynamic-m Schedule \| mStart=1 → mMax=24 \(cap 32/);
      assert.match(md, /\| Embedder \| ansatz-embed-v1 \(1024d, int8-diskann\) \|/);
      assert.match(md, /\| Gate 1–4 Pass Rate \| 94% \|/);
      assert.match(md, /\| Pass@1 \| 78% \|/);
      assert.match(md, /\| Sim RMSE \| 0\.012 \|/);
      assert.match(md, /## Pinned Datasets & Memory Shards/);
      assert.match(md, /@ieee\/grid-faults-posttrain@\^2\.1\.0/);
      assert.match(md, /@modelica\/msl-memory@4\.1\.0/);
      assert.match(md, /## Help Fix Remaining Failure Cases/);
      assert.match(md, /Three-phase fault crowbar oscillation/);
      assert.match(md, /\/annotate\/107/);
      assert.match(md, /```bibtex[\s\S]*@misc\{grid_ieee39_qlora_recipe_1_1_0_/);
      assert.match(md, /https:\/\/ansatz\.social\/@bob\/status\/99/);
      assert.doesNotMatch(md, /## Semantic Diff/);
    });

    it("includes a Semantic Diff table when a parent recipe is provided", () => {
      const md = buildRecipeBlogMarkdownDraft(childRecipe, parentRecipe);

      assert.match(md, /## Semantic Diff vs\. `@grid\/ieee39-qlora-recipe@1\.0\.0`/);
      assert.match(md, /\| `dataset:@ieee\/grid-faults-posttrain` \| added \| — \| \^2\.1\.0 \| — \|/);
      assert.match(md, /\| `dynamicM\.mMax` \| changed \| 16 \| 24 \| — \|/);
      assert.match(md, /\| `eval\.passAt1` \| changed \| 64% \| 78% \| \+14% \|/);
      assert.match(md, /## Help Fix Remaining Failure Cases/);
      assert.match(md, /```bibtex[\s\S]*@misc\{grid_ieee39_qlora_recipe_1_1_0_/);
    });
  });
});
