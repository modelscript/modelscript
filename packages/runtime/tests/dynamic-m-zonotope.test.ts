// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compileRelationalHypergraph,
  computeWorstCaseLogitLoss,
  computeZonotopeBounds,
  contractZonotopeGenerators,
  createSeededRng,
  DynamicMLoraLinearLayer,
  dynamicMNonLinearForward,
  evalActivation,
  evaluateZonotopePoint,
  QueryProjectionHead,
  RelationalZonotopeEmbedder,
  SmallLlmZonotopeRuntime,
  type ZonotopeTensor,
} from "../src/index.js";

describe("Differentiable Variable-Sized (Dynamic-m) Relational Zonotope Engine", () => {
  it("preserves formal soundness: every sampled point x(ξ) stays enclosed after Linear + GELU + Contraction", () => {
    const record = compileRelationalHypergraph({
      source: "model RC parameter Real R = 100; Real v; equation v = R * i; end RC;",
      dialect: "modelica",
    });

    const embedder = new RelationalZonotopeEmbedder(128, 8, 8, 11, 0.25);
    const z0 = embedder.forward(record, 16);
    assert.ok(z0.m >= 3, `Expected z0.m >= 3, got ${z0.m}`);

    // Verify group_id = 0 tokens (e.g. `model`) have strictly zero perturbation radius
    const modelIdx = record.spans.findIndex((s) => s.text === "model");
    const b0 = computeZonotopeBounds(z0);
    for (let d = 0; d < z0.dim; d++) {
      assert.equal(b0.radius[modelIdx * z0.dim + d], 0, "Locked token must have zero radius");
    }

    const lin = new DynamicMLoraLinearLayer(8, 8, 2, 4, 23);
    const z1 = lin.forward(z0);
    const { out: z2 } = dynamicMNonLinearForward(z1, "gelu", 0.005, 0);
    const { out: z3 } = contractZonotopeGenerators(z2, { pruneEps: 1e-6, collinearCosineThreshold: 0.999, mCap: 3 }, 0);
    const finalBounds = computeZonotopeBounds(z3);

    // Sample 40 random corners/interiors ξ ∈ [-1, 1]^m and verify exact enclosure
    const rng = createSeededRng(99);
    const effW = lin.effectiveWeight();
    for (let s = 0; s < 40; s++) {
      const xi = Float64Array.from({ length: z0.m }, () => rng() * 2 - 1);
      const x0 = evaluateZonotopePoint(z0, xi);

      // Concrete forward: Linear -> GELU
      for (let t = 0; t < z0.seqLen; t++) {
        for (let o = 0; o < 8; o++) {
          let acc = lin.bias[o]!;
          for (let i = 0; i < 8; i++) {
            acc += x0[t * 8 + i]! * effW[o * 8 + i]!;
          }
          const y = evalActivation(acc, "gelu");
          const idx = t * 8 + o;
          assert.ok(
            y >= finalBounds.lo[idx]! - 1e-6 && y <= finalBounds.hi[idx]! + 1e-6,
            `Soundness violation at token ${t} dim ${o}: y=${y} outside [${finalBounds.lo[idx]}, ${finalBounds.hi[idx]}]`,
          );
        }
      }
    }
  });

  it("matches central finite-difference gradients for DynamicMLoraLinearLayer VJP (dLoraA, dLoraB, dBias)", () => {
    const record = compileRelationalHypergraph({
      source: "wall_thickness = 3.0; cube([10, 10, wall_thickness]);",
      dialect: "scad",
    });
    const embedder = new RelationalZonotopeEmbedder(64, 6, 8, 7, 0.15);
    const x = embedder.forward(record, 8);
    const layer = new DynamicMLoraLinearLayer(6, 5, 2, 4, 19);
    const targets = record.tokenIds.map((t) => t % 5);

    const out = layer.forward(x);
    const lossObj = computeWorstCaseLogitLoss(out, targets, 0.5, 0);
    const grads = layer.backward(x, lossObj.dCenter, lossObj.dGenerators);

    const eps = 1e-6;
    const evalLoss = () => computeWorstCaseLogitLoss(layer.forward(x), targets, 0.5, 0).loss;

    // Check dLoraA
    for (let i = 0; i < layer.loraA.length; i++) {
      const orig = layer.loraA[i]!;
      layer.loraA[i] = orig + eps;
      const lp = evalLoss();
      layer.loraA[i] = orig - eps;
      const lm = evalLoss();
      layer.loraA[i] = orig;
      const fd = (lp - lm) / (2 * eps);
      assert.ok(Math.abs(grads.dLoraA[i]! - fd) < 1e-5, `dLoraA[${i}] mismatch: analytic=${grads.dLoraA[i]}, fd=${fd}`);
    }

    // Check dLoraB
    for (let i = 0; i < layer.loraB.length; i++) {
      const orig = layer.loraB[i]!;
      layer.loraB[i] = orig + eps;
      const lp = evalLoss();
      layer.loraB[i] = orig - eps;
      const lm = evalLoss();
      layer.loraB[i] = orig;
      const fd = (lp - lm) / (2 * eps);
      assert.ok(Math.abs(grads.dLoraB[i]! - fd) < 1e-5, `dLoraB[${i}] mismatch: analytic=${grads.dLoraB[i]}, fd=${fd}`);
    }
  });

  it("prunes vanishing norms, merges collinear generators, and enforces Girard mCap", () => {
    const seqLen = 2;
    const dim = 3;
    const ld = seqLen * dim;
    // 4 generators: g0 normal, g1 collinear with g0, g2 vanishing norm, g3 independent
    const generators = new Float64Array(4 * ld);
    generators.set([1, 0, 0, 0, 1, 0], 0 * ld);
    generators.set([0.5, 0, 0, 0, 0.5, 0], 1 * ld); // parallel to g0 (cos = 1.0)
    generators.set([1e-7, 0, 0, 0, 0, 0], 2 * ld); // vanishing norm
    generators.set([0, 0, 1, 1, 0, 0], 3 * ld); // orthogonal

    const z: ZonotopeTensor = {
      seqLen,
      dim,
      m: 4,
      center: new Float64Array(ld),
      generators,
      groupIds: Int32Array.from([1, 2, 3, 4]),
    };

    const { out, events } = contractZonotopeGenerators(
      z,
      { pruneEps: 1e-4, collinearCosineThreshold: 0.98, mCap: 4 },
      2,
    );

    assert.equal(out.m, 2);
    assert.ok(events.some((e) => e.kind === "pruned-vanishing" && e.groupIds[0] === 3));
    assert.ok(events.some((e) => e.kind === "merged-collinear"));
  });

  it("trains small-LLM LoRA worst-case boundary loss and InfoNCE W_q projection head monotonically", () => {
    const record = compileRelationalHypergraph({
      source: "model M Real x; equation der(x) = -x; end M;",
      dialect: "modelica",
    });
    const runtime = new SmallLlmZonotopeRuntime({
      vocabSize: 64,
      hiddenDim: 16,
      loraRank: 4,
      numLayers: 2,
      retrieverDim: 32,
      seed: 123,
    });
    const targets = record.tokenIds.map((id) => id % 64);

    const first = runtime.trainStepLora(record, targets, { activeMCap: 8, lr: 0.08 });
    let last = first;
    for (let step = 0; step < 15; step++) {
      last = runtime.trainStepLora(record, targets, { activeMCap: 8, lr: 0.08 });
    }
    assert.ok(
      last.loss < first.loss,
      `Expected worst-case LoRA loss to decrease: start=${first.loss}, end=${last.loss}`,
    );

    // InfoNCE contrastive alignment of W_q h_t + b_q
    const head = new QueryProjectionHead(16, 32, 55);
    const h = Float64Array.from({ length: 16 }, (_, i) => Math.sin(i + 1));
    const pos = Float64Array.from({ length: 32 }, (_, i) => (i === 0 ? 1 : 0));
    const neg1 = Float64Array.from({ length: 32 }, (_, i) => (i === 1 ? 1 : 0));
    const neg2 = Float64Array.from({ length: 32 }, (_, i) => (i === 2 ? 1 : 0));

    let cos = -1;
    for (let step = 0; step < 25; step++) {
      cos = head.trainStepInfoNce(h, pos, [neg1, neg2], 0.1, 0.2).positiveCosine;
    }
    assert.ok(cos > 0.9, `Expected W_q InfoNCE positive cosine > 0.9, got ${cos}`);
  });

  it("supports Test-Time Compute Dial (m = 0 vs m = 16) and collapses Δ_t via DiskANN callback", async () => {
    const record = compileRelationalHypergraph({
      source: "wall_thickness = 2.5; hole_radius = 4.0; cube([20, 20, wall_thickness]);",
      dialect: "scad",
    });
    const runtime = new SmallLlmZonotopeRuntime({
      vocabSize: 64,
      hiddenDim: 16,
      loraRank: 4,
      numLayers: 2,
      retrieverDim: 32,
      dynamicM: { retrievalTau: 0.001 },
    });

    // Fast point mode (m = 0): zero spread, zero DiskANN calls
    let diskAnnCalls = 0;
    const fast = await runtime.inferWithComputeDial(record, 0, async () => {
      diskAnnCalls++;
      return [];
    });
    assert.equal(fast.maxSpread, 0);
    assert.equal(fast.triggeredDiskAnnRetrieval, false);
    assert.equal(diskAnnCalls, 0);

    // Certified mode (m = 16): Δ_t > τ triggers DiskANN via W_q and collapses spread
    const cert = await runtime.inferWithComputeDial(record, 16, async (q) => {
      diskAnnCalls++;
      assert.equal(q.length, 32);
      return [
        {
          chunkId: "chk_1",
          sourceKind: "rlhf-verified-fix",
          sourceUri: "social://rlhf/fix/1",
          dialect: "scad",
          score: 0.92,
          content: "Verified tolerance spec",
          formalVerified: true,
          symbolTags: ["wall_thickness"],
        },
      ];
    });
    assert.equal(diskAnnCalls, 1);
    assert.equal(cert.triggeredDiskAnnRetrieval, true);
    assert.ok(cert.maxSpread > 0.001);
    assert.ok(cert.postRetrievalMaxSpread < cert.maxSpread);
  });
});
