// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  bucketHypergraphExamples,
  compileRelationalHypergraph,
  type HypergraphTokenOverride,
  type RelTypeId,
} from "@modelscript/runtime";
import { z } from "zod";
import type { ServerContext } from "../types.js";

/**
 * Registers Relational Dynamic-m Hypergraph & DiskANN Engineering Memory MCP tools.
 * Enables external AI agents and compact reasoning LLMs to compile 4-column zonotope tensors
 * and query version-pinned DiskANN package + verified social knowledge shards.
 */
export function registerMemoryHypergraphTools(server: McpServer, _ctx: ServerContext): void {
  server.tool(
    "modelscript_compile_hypergraph",
    "Compiles engineering code (Modelica, SysML2, SCAD, STEP, URDF, SPICE, OWL2) or Markdown into the 4-column Typed Relational Hypergraph (tokenIds, groupIds, relTypeIds, relSigns, mInit) for Dynamic-m zonotope training.",
    {
      source: z.string().describe("Raw engineering source code or Markdown specification"),
      dialect: z
        .string()
        .default("modelica")
        .describe("Language dialect (e.g., modelica, scad, step, sysml2, owl2, markdown)"),
      uri: z.string().optional().describe("Optional logical document URI"),
      overrides: z
        .array(
          z.object({
            tokenIndex: z.number().int().optional(),
            symbolName: z.string().optional(),
            groupId: z.number().int().min(0).optional(),
            relTypeId: z.number().int().min(0).max(6).optional(),
            relSign: z.union([z.literal(-1), z.literal(0), z.literal(1)]).optional(),
            ontologyIri: z.string().optional(),
          }),
        )
        .optional()
        .describe("Optional interactive annotator overrides (e.g., lock token to groupId=0 or flip relSign)"),
    },
    async ({ source, dialect, uri, overrides }) => {
      const record = compileRelationalHypergraph({
        source,
        dialect,
        uri,
        overrides: overrides as HypergraphTokenOverride[] | undefined,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                exampleId: record.exampleId,
                dialect: record.dialect,
                mInit: record.mInit,
                tokenCount: record.tokenIds.length,
                groups: record.groups,
                tokenIds: record.tokenIds,
                groupIds: record.groupIds,
                relTypeIds: record.relTypeIds as RelTypeId[],
                relSigns: record.relSigns,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "modelscript_bucket_dynamic_m",
    "Compiles a batch of engineering examples into 4-column Relational Hypergraphs and groups them into Dynamic-m batch buckets by similar mInit counts to avoid wasted GPU/WebGPU padding.",
    {
      examples: z
        .array(
          z.object({
            uri: z.string().optional(),
            dialect: z.string(),
            source: z.string(),
          }),
        )
        .min(1)
        .describe("Batch of engineering examples to compile and bucket"),
      batchSize: z.number().int().min(1).default(4).describe("Mini-batch size per bucket"),
      mCap: z.number().int().min(1).default(32).describe("Hard VRAM safety cap on generator dimension m"),
    },
    async ({ examples, batchSize, mCap }) => {
      const compiled = examples.map((ex, idx) =>
        compileRelationalHypergraph({
          source: ex.source,
          dialect: ex.dialect,
          uri: ex.uri ?? `memory://batch/${idx}.${ex.dialect}`,
        }),
      );
      const buckets = bucketHypergraphExamples(compiled, batchSize, mCap);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                totalExamples: compiled.length,
                bucketCount: buckets.length,
                buckets: buckets.map((b) => ({
                  bucketId: b.bucketId,
                  mBatchMax: b.mBatchMax,
                  examples: b.examples.map((e) => ({
                    exampleId: e.exampleId,
                    uri: e.uri,
                    dialect: e.dialect,
                    mInit: e.mInit,
                    tokenCount: e.tokenIds.length,
                  })),
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "modelscript_memory_query",
    "Queries the federated or local DiskANN Vector Memory API for version-pinned package documentation, OWL2 axioms, and formally verified social RLHF fixes.",
    {
      mode: z
        .enum(["hybrid", "latent"])
        .default("hybrid")
        .describe("Query mode: 'hybrid' text+symbol or 'latent' W_q projection vector"),
      textQuery: z.string().optional().describe("Natural-language or symbol query (required when mode === 'hybrid')"),
      latentVector: z
        .array(z.number())
        .optional()
        .describe("Normalized latent vector q = Normalize(W_q h_t + b_q) (required when mode === 'latent')"),
      packagePins: z
        .record(z.string(), z.string())
        .optional()
        .describe("Exact semver lockfile pins from modelscript.json"),
      dialects: z.array(z.string()).optional().describe("Filter chunks by engineering dialects"),
      includeSocialPosts: z.boolean().default(true).describe("Include verified social threads & RLHF Fix-It solutions"),
      topK: z.number().int().min(1).max(50).default(6).describe("Number of chunks to retrieve"),
      apiBaseUrl: z
        .string()
        .optional()
        .describe("Optional ModelScript API endpoint (defaults to MODELSCRIPT_API_URL or http://localhost:3001)"),
    },
    async ({ mode, textQuery, latentVector, packagePins, dialects, includeSocialPosts, topK, apiBaseUrl }) => {
      const base = (apiBaseUrl || process.env["MODELSCRIPT_API_URL"] || "http://localhost:3001").replace(/\/+$/, "");
      try {
        const res = await fetch(`${base}/api/v1/memory/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            textQuery,
            latentVector,
            packagePins,
            dialects,
            includeSocialPosts,
            topK,
          }),
        });
        const data = await res.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          isError: !res.ok,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: `Unable to reach DiskANN Memory API at ${base}/api/v1/memory/query: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
