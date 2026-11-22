// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Offline MCP tools for querying locally synced ALM requirements & traceability
 * (`modelscript.yaml` + `modelscript.lock` + materialized `.sysml`/`.ms` projections).
 *
 * Requires zero live ALM credentials in AI agent sandboxes.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  isRemoteDependency,
  lintAlmWorkspace,
  MANIFEST_FILENAME,
  normalizeRemoteDependency,
  PACKAGES_DIR,
  parseMaterializedExternalItems,
  parseModelScriptYaml,
  type AlmArtifact,
} from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ServerContext } from "./types.js";

async function loadLocalAlmArtifacts(workspaceDir: string): Promise<{
  manifestPath: string;
  manifest: ReturnType<typeof parseModelScriptYaml>;
  artifactsByPackage: Record<string, AlmArtifact[]>;
}> {
  const manifestPath = path.join(workspaceDir, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`${MANIFEST_FILENAME} not found in ${workspaceDir}`);
  }
  const manifest = parseModelScriptYaml(fs.readFileSync(manifestPath, "utf-8"), manifestPath);
  const artifactsByPackage: Record<string, AlmArtifact[]> = {};

  for (const [pkgName, depSpec] of Object.entries(manifest.dependencies ?? {})) {
    if (!isRemoteDependency(depSpec)) continue;
    const norm = normalizeRemoteDependency(depSpec);
    if (!norm) continue;

    const dir = norm.materialize
      ? path.resolve(workspaceDir, norm.materialize)
      : path.join(workspaceDir, PACKAGES_DIR, ...pkgName.split("/"));

    const items: AlmArtifact[] = [];
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || (!entry.name.endsWith(".sysml") && !entry.name.endsWith(".ms"))) continue;
        const content = fs.readFileSync(path.join(dir, entry.name), "utf-8");
        const parsed = await parseMaterializedExternalItems(content);
        for (const p of parsed) {
          items.push({
            externalId: p.externalId,
            kind: norm.connector === "jira" ? "change_request" : "requirement",
            uri: p.uri ?? "",
            webUrl: p.webUrl,
            title: p.title ?? p.externalId,
            text: p.text ?? "",
            status: p.status ?? "Unknown",
            priority: p.priority,
            revision: p.revision,
            attributes: {},
          });
        }
      }
    }
    artifactsByPackage[pkgName] = items;
  }

  return { manifestPath, manifest, artifactsByPackage };
}

export function registerAlmTools(server: McpServer, ctx: ServerContext): void {
  const defaultCwd = () => (ctx as unknown as { workspaceRoot?: string }).workspaceRoot || process.cwd();

  server.tool(
    "alm_list_requirements",
    "List locally synced ALM requirements and change requests from modelscript.yaml remotes (offline, zero credentials).",
    {
      workspaceDir: z.string().optional().describe("Workspace directory containing modelscript.yaml (defaults to cwd)"),
      packageName: z.string().optional().describe("Optional remote package name filter (e.g. '@reqs/battery-safety')"),
    },
    async ({ workspaceDir, packageName }) => {
      const dir = workspaceDir ? path.resolve(workspaceDir) : defaultCwd();
      const { artifactsByPackage } = await loadLocalAlmArtifacts(dir);
      const filtered = packageName ? { [packageName]: artifactsByPackage[packageName] ?? [] } : artifactsByPackage;
      return {
        content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }],
      };
    },
  );

  server.tool(
    "alm_trace_coverage",
    "Run offline ALM workspace linting (ALM001–ALM004) against synced requirements and modelscript.yaml baseline policies.",
    {
      workspaceDir: z.string().optional().describe("Workspace directory containing modelscript.yaml"),
      gitBranch: z.string().optional().describe("Current Git branch name for protected-branch baseline checks"),
    },
    async ({ workspaceDir, gitBranch }) => {
      const dir = workspaceDir ? path.resolve(workspaceDir) : defaultCwd();
      const { manifest, artifactsByPackage } = await loadLocalAlmArtifacts(dir);
      const diagnostics = lintAlmWorkspace({
        manifest,
        gitBranch,
        artifactsByPackage,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                packages: Object.keys(artifactsByPackage),
                totalItems: Object.values(artifactsByPackage).reduce((sum, arr) => sum + arr.length, 0),
                diagnostics,
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
    "alm_blast_radius",
    "Find locally synced ALM requirements and Jira issues impacted by a symbol, parameter, or keyword.",
    {
      query: z.string().describe("Symbol name, parameter, or keyword to search across synced ALM artifacts"),
      workspaceDir: z.string().optional().describe("Workspace directory containing modelscript.yaml"),
    },
    async ({ query, workspaceDir }) => {
      const dir = workspaceDir ? path.resolve(workspaceDir) : defaultCwd();
      const { artifactsByPackage } = await loadLocalAlmArtifacts(dir);
      const needle = query.toLowerCase();
      const hits: Array<{
        packageName: string;
        externalId: string;
        title: string;
        status: string;
        webUrl?: string | undefined;
      }> = [];

      for (const [pkgName, items] of Object.entries(artifactsByPackage)) {
        for (const item of items) {
          const hay = `${item.externalId} ${item.title} ${item.text}`.toLowerCase();
          if (hay.includes(needle)) {
            hits.push({
              packageName: pkgName,
              externalId: item.externalId,
              title: item.title,
              status: item.status,
              webUrl: item.webUrl,
            });
          }
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ query, impactedCount: hits.length, hits }, null, 2) }],
      };
    },
  );
}
