// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { formatTrainingRecipeOembedMetadata } from "../src/routes/oembed.js";
import { renderTrainingRecipeOgSvg } from "../src/routes/og.js";

test("renderTrainingRecipeOgSvg renders training-recipe card with model, dynamic-m, embedder, and eval badges", () => {
  const svg = renderTrainingRecipeOgSvg(
    {
      id: 42,
      title: "Modelica RLVR Post-Training",
      username: "ada_control",
      display_name: "Ada Control",
      view_type: "training-recipe",
      view_config: {
        packageName: "@ansatz/modelica-rlvr",
        version: "1.2.0",
        ml: {
          kind: "training-recipe",
          targetModel: {
            baseModel: "Qwen/Qwen2.5-Coder-1.5B",
            parameterScale: "1.5B",
            mode: "posttrain-qlora",
          },
          dynamicM: {
            mStart: 1,
            mMax: 24,
            mCap: 32,
          },
          memoryContract: {
            embedderId: "ansatz-embed-v1",
            dimension: 768,
            quantization: "int8-diskann",
          },
        },
        evalMetrics: {
          gate1To4PassRate: 0.942,
          passAt1: 0.785,
          simRmse: 0.00042,
          independentReproductions: 14,
        },
      },
    },
    "https://ansatz.social",
    "Ansatz",
  );

  assert.ok(svg.startsWith("<svg "));
  assert.ok(svg.includes("TRAINING RECIPE"));
  assert.ok(svg.includes("Modelica RLVR Post-Training"));
  assert.ok(svg.includes("@ansatz/modelica-rlvr@1.2.0"));
  assert.ok(svg.includes("Qwen/Qwen2.5-Coder-1.5B"));
  assert.ok(svg.includes("1.5B · posttrain-qlora"));
  assert.ok(svg.includes("m: 1→24 (cap 32)"));
  assert.ok(svg.includes("ansatz-embed-v1"));
  assert.ok(svg.includes("Gate 1–4: 94.2%"));
  assert.ok(svg.includes("Pass@1: 78.5%"));
  assert.ok(svg.includes("Sim RMSE: 4.20e-4"));
  assert.ok(svg.includes("14× Reproduced"));
  assert.ok(svg.includes("https://ansatz.social/p/42"));
});

test("renderTrainingRecipeOgSvg supports memory-shard, dataset-pretrain, and dataset-posttrain badges", () => {
  const shardSvg = renderTrainingRecipeOgSvg({
    id: 99,
    title: "MSL 4.0 DiskANN Memory Shard",
    view_type: "memory-shard",
    view_config: JSON.stringify({
      packageName: "@modelica/msl-memory",
      version: "4.0.0",
      ml: {
        kind: "memory-shard",
        memoryContract: {
          embedderId: "ansatz-embed-v1",
          dimension: 768,
          quantization: "int8-diskann",
        },
      },
      evalMetrics: {
        gate1To4PassRate: 0.99,
        independentReproductions: 6,
      },
    }),
  });

  assert.ok(shardSvg.includes("MEMORY SHARD"));
  assert.ok(shardSvg.includes("@modelica/msl-memory@4.0.0"));
  assert.ok(shardSvg.includes("ansatz-embed-v1 · 768d · int8-diskann"));
  assert.ok(shardSvg.includes("Gate 1–4: 99%"));
  assert.ok(shardSvg.includes("6× Reproduced"));

  const pretrainSvg = renderTrainingRecipeOgSvg({
    title: "Polyglot Corpus Pretrain",
    view_type: "dataset-pretrain",
  });
  assert.ok(pretrainSvg.includes("PRETRAIN DATASET"));

  const posttrainSvg = renderTrainingRecipeOgSvg({
    title: "RLHF Verified Fixes",
    view_type: "dataset-posttrain",
  });
  assert.ok(posttrainSvg.includes("POSTTRAIN DATASET"));
});

test("renderTrainingRecipeOgSvg safely XML-escapes untrusted title and metadata strings", () => {
  const svg = renderTrainingRecipeOgSvg({
    id: 7,
    title: `<script>alert("xss")</script> & 'quotes'`,
    username: `bad<user>&"name"`,
    display_name: `<Evil> & 'Author'`,
    view_type: "training-recipe",
    view_config: {
      packageName: `@evil/<pkg>&1`,
      version: `1.0.0"`,
      ml: {
        targetModel: {
          baseModel: `Model<A&B>`,
          parameterScale: "1.5B",
          mode: "posttrain-qlora",
        },
        memoryContract: {
          embedderId: `embed<id>&'v1'`,
        },
      },
    },
  });

  assert.ok(!svg.includes("<script>"));
  assert.ok(!svg.includes('alert("xss")'));
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(svg.includes("&amp;"));
  assert.ok(svg.includes("Model&lt;A&amp;B&gt;"));
  assert.ok(svg.includes("embed&lt;id&gt;&amp;&apos;v1&apos;"));
});

test("formatTrainingRecipeOembedMetadata formats rich title, description, and OG thumbnail URL", () => {
  const meta = formatTrainingRecipeOembedMetadata(
    {
      id: 108,
      title: "Power Grid EMT QLoRA Recipe",
      view_type: "training-recipe",
      view_config: {
        packageName: "@grid/emt-qlora",
        version: "0.3.1",
        ml: {
          kind: "training-recipe",
          targetModel: {
            baseModel: "Qwen/Qwen2.5-Coder-1.5B",
            parameterScale: "1.5B",
            mode: "posttrain-qlora",
          },
          dynamicM: { mStart: 1, mMax: 24, mCap: 32 },
          memoryContract: { embedderId: "ansatz-embed-v1", dimension: 768 },
        },
        evalMetrics: {
          gate1To4PassRate: 0.915,
          passAt1: 0.74,
          simRmse: 0.0025,
          independentReproductions: 9,
        },
      },
    },
    { host: "https://ansatz.social", postId: 108 },
  );

  assert.ok(meta.title.includes("Power Grid EMT QLoRA Recipe"));
  assert.ok(meta.title.includes("Qwen/Qwen2.5-Coder-1.5B (1.5B · posttrain-qlora)"));
  assert.ok(meta.title.includes("Gate 1–4: 91.5%"));
  assert.ok(meta.title.includes("Pass@1: 74%"));

  assert.ok(meta.description.includes("Training Recipe"));
  assert.ok(meta.description.includes("@grid/emt-qlora@0.3.1"));
  assert.ok(meta.description.includes("m: 1→24"));
  assert.ok(meta.description.includes("Embedder: ansatz-embed-v1 · 768d"));
  assert.ok(meta.description.includes("Gate 1–4: 91.5%"));
  assert.ok(meta.description.includes("Pass@1: 74%"));
  assert.ok(meta.description.includes("Sim RMSE: 0.0025"));
  assert.ok(meta.description.includes("9× Reproduced"));
  assert.equal(meta.thumbnailUrl, "https://ansatz.social/api/v1/og/post/108.png");
});

test("HTTP routes /api/v1/og/post/:id and /api/v1/oembed serve rich previews for training-recipe and memory-shard posts", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "og-oembed-recipe-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const user = db.createUser("ml_researcher", "ml@example.com", "hash", "Dr. ML Researcher");

  const recipeArtifactId = db.createArtifactView(
    user.id,
    "training-recipe",
    "inline",
    JSON.stringify({
      packageName: "@ansatz/sysml-qlora",
      version: "2.0.0",
      ml: {
        kind: "training-recipe",
        targetModel: {
          baseModel: "Qwen/Qwen2.5-Coder-1.5B",
          parameterScale: "1.5B",
          mode: "posttrain-qlora",
        },
        dynamicM: { mStart: 1, mMax: 24, mCap: 32 },
        memoryContract: { embedderId: "ansatz-embed-v1" },
      },
      evalMetrics: {
        gate1To4PassRate: 0.96,
        passAt1: 0.81,
        simRmse: 0.0008,
        independentReproductions: 5,
      },
    }),
    "SysML v2 QLoRA Recipe",
  );
  const recipePost = db.createPost(user.id, "SysML v2 QLoRA Recipe", recipeArtifactId);

  const ogRes = await request(app).get(`/api/v1/og/post/${recipePost.id}`).expect(200);
  const ogSvg = Buffer.isBuffer(ogRes.body) ? ogRes.body.toString("utf8") : String(ogRes.text ?? "");
  assert.ok(String(ogRes.headers["content-type"]).includes("image/svg+xml"));
  assert.ok(ogSvg.includes("TRAINING RECIPE"));
  assert.ok(ogSvg.includes("@ansatz/sysml-qlora@2.0.0"));
  assert.ok(ogSvg.includes("1.5B · posttrain-qlora"));
  assert.ok(ogSvg.includes("m: 1→24 (cap 32)"));
  assert.ok(ogSvg.includes("ansatz-embed-v1"));
  assert.ok(ogSvg.includes("Gate 1–4: 96%"));
  assert.ok(ogSvg.includes("Pass@1: 81%"));
  assert.ok(ogSvg.includes("5× Reproduced"));

  const postUrl = `https://ansatz.social/p/${recipePost.id}`;
  const oembedRes = await request(app)
    .get(`/api/v1/oembed?url=${encodeURIComponent(postUrl)}`)
    .expect(200);

  assert.equal(oembedRes.body.type, "rich");
  assert.ok(oembedRes.body.title.includes("SysML v2 QLoRA Recipe"));
  assert.ok(oembedRes.body.title.includes("Qwen/Qwen2.5-Coder-1.5B"));
  assert.ok(oembedRes.body.title.includes("Gate 1–4: 96%"));
  assert.ok(oembedRes.body.title.includes("Pass@1: 81%"));
  assert.ok(oembedRes.body.description.includes("Embedder: ansatz-embed-v1"));
  assert.equal(oembedRes.body.thumbnail_url, `https://ansatz.social/api/v1/og/post/${recipePost.id}.png`);

  // Also verify memory-shard oEmbed
  const shardArtifactId = db.createArtifactView(
    user.id,
    "memory-shard",
    "inline",
    JSON.stringify({
      packageName: "@ansatz/msl-shard",
      version: "1.0.0",
      ml: {
        kind: "memory-shard",
        memoryContract: { embedderId: "ansatz-embed-v2", dimension: 1024, quantization: "pq-diskann" },
      },
      evalMetrics: { gate1To4PassRate: 0.98 },
    }),
    "MSL Memory Shard",
  );
  const shardPost = db.createPost(user.id, "MSL Memory Shard", shardArtifactId);
  const shardOembedRes = await request(app)
    .get(`/api/v1/oembed?url=${encodeURIComponent(`https://ansatz.social/p/${shardPost.id}`)}`)
    .expect(200);

  assert.ok(shardOembedRes.body.title.includes("MSL Memory Shard"));
  assert.ok(shardOembedRes.body.title.includes("Embedder: ansatz-embed-v2"));
  assert.ok(shardOembedRes.body.description.includes("Memory Shard"));
  assert.ok(shardOembedRes.body.description.includes("ansatz-embed-v2 · 1024d · pq-diskann"));
  assert.equal(shardOembedRes.body.thumbnail_url, `https://ansatz.social/api/v1/og/post/${shardPost.id}.png`);
});
