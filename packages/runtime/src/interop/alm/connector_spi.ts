// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Universal `AlmConnector` SPI and protocol registry.
 *
 * Routes `modelscript.yaml` protocol-prefixed dependencies (`oslc+https://`,
 * `jama+https://`, `codebeamer+https://`, `polarion+https://`, `jira+https://`,
 * or custom third-party protocols) to their concrete connector implementation.
 */

import type { ParsedProtocolUri, RemoteDependencySpec } from "../../workspace/manifest.js";
import type {
  AlmDelta,
  AlmLink,
  AlmVerificationRun,
  ArtifactEdit,
  AuthContext,
  PushResult,
  RemoteCapabilities,
} from "./alm_ir.js";

export type ResolvedRemoteSpec = RemoteDependencySpec & {
  packageName: string;
  parsed: ParsedProtocolUri;
};

export interface AlmConnector {
  /** Protocol scheme handled by this connector (e.g. `"oslc"`, `"jama"`, `"codebeamer"`, `"polarion"`, `"jira"`). */
  readonly protocol: string;
  /** Optional aliases (e.g. `"doors"` -> `"oslc"`). */
  readonly aliases?: readonly string[] | undefined;

  /** Probes remote server metadata, authentication, and supported capabilities. */
  discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities>;

  /** Pulls a full snapshot or incremental delta (when `cursor` is provided). */
  fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta>;

  /** Pushes traceability links back to the remote ALM system. */
  pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult>;

  /** Pushes verification/simulation run evidence back to the remote ALM system. */
  pushVerificationRuns(spec: ResolvedRemoteSpec, auth: AuthContext, runs: AlmVerificationRun[]): Promise<PushResult>;

  /** Optional bidirectional artifact upsert guarded by optimistic concurrency (`expectedEtag` / `expectedRevision`). */
  upsertArtifacts?(spec: ResolvedRemoteSpec, auth: AuthContext, edits: ArtifactEdit[]): Promise<PushResult>;
}

export class AlmConnectorRegistry {
  private readonly connectors = new Map<string, AlmConnector>();

  register(connector: AlmConnector): void {
    this.connectors.set(connector.protocol.toLowerCase(), connector);
    if (connector.aliases) {
      for (const alias of connector.aliases) {
        this.connectors.set(alias.toLowerCase(), connector);
      }
    }
  }

  get(protocol: string): AlmConnector | undefined {
    return this.connectors.get(protocol.toLowerCase());
  }

  has(protocol: string): boolean {
    return this.connectors.has(protocol.toLowerCase());
  }

  listProtocols(): string[] {
    const seen = new Set<string>();
    for (const c of this.connectors.values()) {
      seen.add(c.protocol);
    }
    return [...seen].sort();
  }
}

export const globalAlmConnectorRegistry = new AlmConnectorRegistry();

/**
 * Node.js helper: dynamically loads custom third-party ALM connector plugins
 * placed under `<cwd>/.modelscript/connectors/*.{js,mjs}`.
 * Each plugin module may export a default `AlmConnector` or named `connector` / `register(registry)`.
 */
export async function loadWorkspaceConnectors(
  cwd: string,
  registry: AlmConnectorRegistry = globalAlmConnectorRegistry,
): Promise<string[]> {
  const fsId = "node:fs";
  const pathId = "node:path";
  const urlId = "node:url";
  const fs = await import(fsId);
  const path = await import(pathId);
  const { pathToFileURL } = await import(urlId);

  const connectorsDir = path.join(cwd, ".modelscript", "connectors");
  if (!fs.existsSync(connectorsDir)) return [];

  const loadedProtocols: string[] = [];
  const entries = fs.readdirSync(connectorsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || (!entry.name.endsWith(".js") && !entry.name.endsWith(".mjs"))) continue;
    const modUrl = pathToFileURL(path.join(connectorsDir, entry.name)).href;
    const mod = (await import(modUrl)) as Record<string, unknown>;
    if (typeof mod["register"] === "function") {
      (mod["register"] as (reg: AlmConnectorRegistry) => void)(registry);
      loadedProtocols.push(entry.name);
    } else {
      const candidate = (mod["default"] ?? mod["connector"]) as AlmConnector | undefined;
      if (candidate && typeof candidate.protocol === "string" && typeof candidate.fetchDelta === "function") {
        registry.register(candidate);
        loadedProtocols.push(candidate.protocol);
      }
    }
  }
  return loadedProtocols;
}
