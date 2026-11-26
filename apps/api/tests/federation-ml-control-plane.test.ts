// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FederatedMemoryShardRelease, FederatedVerificationAttestation } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import {
  ANSATZ_CONTROL_PLANE_NS,
  parseInboundMlControlPlaneActivity,
  serializeArtifactAttachment,
  serializeMlReleaseActivity,
  serializeVerificationAttestationActivity,
} from "../src/routes/federation.js";

const ACTOR_URL = "https://node-a.ansatz.example/users/mlbot";
const PUBLIC_URL = "https://node-a.ansatz.example";

function makeSampleRelease(overrides: Partial<FederatedMemoryShardRelease> = {}): FederatedMemoryShardRelease {
  return {
    type: "ansatz:MemoryShardRelease",
    id: "https://node-a.ansatz.example/releases/msl-memory/1.4.0",
    originNode: "node-a.ansatz.example",
    packageName: "@modelica/msl-memory",
    version: "1.4.0",
    embedderId: "ansatz-embed-v1",
    embedderHash: "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    manifestCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    mirrorUrl: "https://cdn.ansatz.example/mirrors/msl-memory-1.4.0/manifest.json",
    signerPubkey: "z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH",
    aiGovernance: {
      allowRag: true,
      allowPretrain: true,
      allowPosttrain: false,
      tenantScope: "public",
      license: "BSD-3-Clause",
      attributionRequired: true,
    },
    formalCertSummary: {
      gate1: true,
      gate2: true,
      gate3: true,
      gate4: true,
    },
    ...overrides,
  };
}

function makeSampleAttestation(
  overrides: Partial<FederatedVerificationAttestation> = {},
): FederatedVerificationAttestation {
  return {
    type: "ansatz:VerificationAttestation",
    targetReleaseId: "https://node-a.ansatz.example/releases/msl-memory/1.4.0",
    manifestCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    verifierNode: "lab-b.ansatz.example",
    verifierPubkey: "z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2",
    passedGates: {
      gate1: true,
      gate2: true,
      gate3: true,
      gate4: true,
    },
    verifiedAtIso: "2026-11-26T17:30:00.000Z",
    ...overrides,
  };
}

test("serializeArtifactAttachment maps ML artifact view types to vendor JSON MIME types", () => {
  const recipeAttachment = serializeArtifactAttachment(
    {
      id: 101,
      title: "Dynamic-m Zonotope Recipe",
      view_type: "training-recipe",
      source_type: "ml",
      view_config: { url: "https://cdn.ansatz.example/recipes/101.json" },
    },
    PUBLIC_URL,
  );
  assert.ok(recipeAttachment);
  assert.equal(recipeAttachment["type"], "Document");
  assert.equal(recipeAttachment["mediaType"], "application/vnd.modelscript.training-recipe+json");
  assert.equal(recipeAttachment["viewType"], "training-recipe");

  const shardAttachment = serializeArtifactAttachment(
    {
      id: 102,
      title: "MSL DiskANN Memory Shard",
      view_type: "memory-shard",
      source_type: "diskann",
      view_config: { url: "https://cdn.ansatz.example/shards/102/manifest.json" },
    },
    PUBLIC_URL,
  );
  assert.ok(shardAttachment);
  assert.equal(shardAttachment["mediaType"], "application/vnd.modelscript.memory-shard+json");
  assert.equal(shardAttachment["viewType"], "memory-shard");

  const pretrainAttachment = serializeArtifactAttachment(
    {
      id: 103,
      title: "Pretrain Hypergraph Corpus",
      view_type: "dataset-pretrain",
    },
    PUBLIC_URL,
  );
  assert.ok(pretrainAttachment);
  assert.equal(pretrainAttachment["mediaType"], "application/vnd.modelscript.dataset+json");

  const posttrainAttachment = serializeArtifactAttachment(
    {
      id: 104,
      title: "Posttrain RLHF Corpus",
      view_type: "dataset-posttrain",
    },
    PUBLIC_URL,
  );
  assert.ok(posttrainAttachment);
  assert.equal(posttrainAttachment["mediaType"], "application/vnd.modelscript.dataset+json");
});

test("serializeMlReleaseActivity and parseInboundMlControlPlaneActivity round-trip all ML release types", () => {
  const proof = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: `${ACTOR_URL}#ed25519-key`,
    proofPurpose: "assertionMethod",
    proofValue: "z58DAdFfa9SkqZMVPxAQpic7ndSayn1PzZs6ZjWp1CktyGesjuTSwRdoWhAfGFCF5bppETSTojQCrfFPP2oumHKtz",
  };

  for (const releaseType of [
    "ansatz:MemoryShardRelease",
    "ansatz:DatasetRelease",
    "ansatz:TrainingRecipeRelease",
  ] as const) {
    const release = makeSampleRelease({ type: releaseType });
    const activity = serializeMlReleaseActivity(release, ACTOR_URL, proof);

    assert.equal(activity["type"], "Create");
    assert.equal(activity["actor"], ACTOR_URL);

    const ctx = activity["@context"] as unknown[];
    assert.ok(Array.isArray(ctx));
    assert.ok(ctx.includes("https://www.w3.org/ns/activitystreams"));
    assert.ok(ctx.includes("https://w3id.org/security/data-integrity/v1"));
    const nsObj = ctx.find((entry) => typeof entry === "object" && entry !== null) as
      Record<string, unknown> | undefined;
    assert.equal(nsObj?.["ansatz"], ANSATZ_CONTROL_PLANE_NS);

    const parsed = parseInboundMlControlPlaneActivity(activity);
    assert.equal(parsed.matched, true);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.kind, "release");
    assert.deepEqual(parsed.release, release);
    assert.deepEqual(parsed.proof, proof);
  }
});

test("serializeVerificationAttestationActivity and parseInboundMlControlPlaneActivity round-trip", () => {
  const attestation = makeSampleAttestation();
  const proof = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: "https://lab-b.ansatz.example/actor#ed25519-key",
    proofPurpose: "assertionMethod",
    proofValue: "z3FXQqF1d2E3H4J5K6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z",
  };

  const activity = serializeVerificationAttestationActivity(attestation, "https://lab-b.ansatz.example/actor", proof);

  assert.equal(activity["type"], "Create");
  assert.equal(activity["actor"], "https://lab-b.ansatz.example/actor");
  assert.equal(activity["published"], attestation.verifiedAtIso);

  const parsed = parseInboundMlControlPlaneActivity(activity);
  assert.equal(parsed.matched, true);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.kind, "attestation");
  assert.deepEqual(parsed.attestation, attestation);
  assert.deepEqual(parsed.proof, proof);

  // Also accept expanded JSON-LD IRI type
  const expandedActivity = {
    ...activity,
    object: {
      ...(activity["object"] as Record<string, unknown>),
      type: `${ANSATZ_CONTROL_PLANE_NS}VerificationAttestation`,
    },
  };
  const parsedExpanded = parseInboundMlControlPlaneActivity(expandedActivity);
  assert.equal(parsedExpanded.matched, true);
  assert.equal(parsedExpanded.valid, true);
  assert.equal(parsedExpanded.kind, "attestation");
  assert.deepEqual(parsedExpanded.attestation, attestation);
});

test("parseInboundMlControlPlaneActivity rejects unsafe mirrorUrl, missing manifestCid, and invalid gate summaries", () => {
  // 1. Non-HTTPS mirrorUrl
  const httpRelease = serializeMlReleaseActivity(
    makeSampleRelease({ mirrorUrl: "http://cdn.ansatz.example/mirrors/shard.parquet" }),
    ACTOR_URL,
  );
  const httpRes = parseInboundMlControlPlaneActivity(httpRelease);
  assert.equal(httpRes.matched, true);
  assert.equal(httpRes.valid, false);
  assert.match(httpRes.error, /HTTPS is required/i);

  // 2. Localhost / SSRF private IP mirrorUrl
  const ssrfRelease = serializeMlReleaseActivity(
    makeSampleRelease({ mirrorUrl: "https://127.0.0.1/internal/shard.parquet" }),
    ACTOR_URL,
  );
  const ssrfRes = parseInboundMlControlPlaneActivity(ssrfRelease);
  assert.equal(ssrfRes.matched, true);
  assert.equal(ssrfRes.valid, false);
  assert.match(ssrfRes.error, /Unsafe mirrorUrl/i);

  // 3. Missing manifestCid on release
  const noCidRelease = serializeMlReleaseActivity(makeSampleRelease({ manifestCid: "   " }), ACTOR_URL);
  const noCidRes = parseInboundMlControlPlaneActivity(noCidRelease);
  assert.equal(noCidRes.matched, true);
  assert.equal(noCidRes.valid, false);
  assert.match(noCidRes.error, /manifestCid/i);

  // 4. Missing manifestCid on attestation
  const noCidAttestation = serializeVerificationAttestationActivity(
    makeSampleAttestation({ manifestCid: "" }),
    ACTOR_URL,
  );
  const noCidAttRes = parseInboundMlControlPlaneActivity(noCidAttestation);
  assert.equal(noCidAttRes.matched, true);
  assert.equal(noCidAttRes.valid, false);
  assert.match(noCidAttRes.error, /manifestCid/i);

  // 5. Invalid formalCertSummary gate fields
  const badGatesRelease = serializeMlReleaseActivity(makeSampleRelease(), ACTOR_URL);
  (badGatesRelease["object"] as Record<string, unknown>)["formalCertSummary"] = {
    gate1: true,
    gate2: "yes",
    gate3: true,
    gate4: true,
  };
  const badGatesRes = parseInboundMlControlPlaneActivity(badGatesRelease);
  assert.equal(badGatesRes.matched, true);
  assert.equal(badGatesRes.valid, false);
  assert.match(badGatesRes.error, /formalCertSummary/i);

  // 6. Invalid passedGates on attestation
  const badAttGates = serializeVerificationAttestationActivity(makeSampleAttestation(), ACTOR_URL);
  (badAttGates["object"] as Record<string, unknown>)["passedGates"] = {
    gate1: true,
    gate2: true,
  };
  const badAttGatesRes = parseInboundMlControlPlaneActivity(badAttGates);
  assert.equal(badAttGatesRes.matched, true);
  assert.equal(badAttGatesRes.valid, false);
  assert.match(badAttGatesRes.error, /passedGates/i);

  // 7. Standard Note activity does not match ML control plane
  const noteActivity = {
    type: "Create",
    actor: ACTOR_URL,
    object: {
      id: `${ACTOR_URL}/posts/1`,
      type: "Note",
      content: "Hello fediverse",
    },
  };
  const noteRes = parseInboundMlControlPlaneActivity(noteActivity);
  assert.equal(noteRes.matched, false);
  assert.equal(noteRes.valid, false);
});
