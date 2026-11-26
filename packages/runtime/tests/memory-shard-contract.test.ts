// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AiGovernancePolicy,
  type MemoryShardContract,
  type MemoryShardPin,
  validateMemoryShardCompatibility,
} from "../src/index.js";

describe("Federated Memory Shard Contracts & Embedder Compatibility", () => {
  const basePin: MemoryShardPin = {
    originNode: "ansatz.social",
    packageName: "@modelica/msl-memory",
    version: "4.1.0",
    signerPubkey: "z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH",
    gitSha: "a1b2c3d4e5f6",
  };

  const baseContract: MemoryShardContract = {
    embedderId: "ansatz-embed-v1",
    embedderHash: "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    dimension: 4,
    quantization: "int8-diskann",
    sourcePackages: [basePin],
  };

  const baseGovernance: AiGovernancePolicy = {
    allowRag: true,
    allowPretrain: true,
    allowPosttrain: true,
    tenantScope: "public",
    license: "BSD-3-Clause",
    reciprocalTrainingLicense: "CC-BY-SA-4.0",
  };

  const baseShard = {
    originNode: basePin.originNode,
    packageName: basePin.packageName,
    signerPubkey: basePin.signerPubkey,
    aiGovernance: baseGovernance,
    memoryContract: baseContract,
  };

  it("accepts a latent query matching canonical embedderId, hash, dimension, and trust pins", () => {
    const res = validateMemoryShardCompatibility(
      {
        mode: "latent",
        embedderId: "ansatz-embed-v1",
        embedderHash: baseContract.embedderHash,
        latentVector: [0.5, -0.5, 0.5, 0.5],
        memoryPins: [basePin],
      },
      baseShard,
    );

    assert.equal(res.compatible, true);
    assert.deepEqual(res.reasons, []);
  });

  it("rejects latent queries with mismatched canonical embedderId or dimension", () => {
    const res = validateMemoryShardCompatibility(
      {
        mode: "latent",
        embedderId: "other-embed-v2",
        latentVector: [0.1, 0.2],
      },
      baseShard,
    );

    assert.equal(res.compatible, false);
    assert.equal(res.reasons.length, 2);
    assert.match(res.reasons[0]!, /Embedder mismatch/);
    assert.match(res.reasons[1]!, /Latent vector dimension mismatch/);
  });

  it("blocks untrusted remote shards not listed in memoryPins", () => {
    const res = validateMemoryShardCompatibility(
      {
        mode: "latent",
        embedderId: "ansatz-embed-v1",
        latentVector: [0.5, -0.5, 0.5, 0.5],
        memoryPins: [basePin],
      },
      {
        ...baseShard,
        originNode: "untrusted-node.example",
        signerPubkey: "z6MkUntrustedKey",
      },
    );

    assert.equal(res.compatible, false);
    assert.equal(res.reasons.length, 1);
    assert.match(res.reasons[0]!, /not in query memoryPins/);
  });

  it("enforces aiGovernance.allowRag=false on both latent and hybrid queries", () => {
    const res = validateMemoryShardCompatibility(
      {
        mode: "hybrid",
      },
      {
        ...baseShard,
        aiGovernance: {
          ...baseGovernance,
          allowRag: false,
        },
      },
    );

    assert.equal(res.compatible, false);
    assert.match(res.reasons[0]!, /allowRag=false/);
  });
});
