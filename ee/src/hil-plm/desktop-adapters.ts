// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

/**
 * Enterprise-Only Desktop & Commercial-Licensed Tool Bridge Adapters.
 *
 * These adapters require a valid ModelScript Enterprise Edition license with the
 * `plm_connectors` entitlement (`MSX_LICENSE_KEY`) and communicate with a local
 * vendor-SDK desktop bridge daemon (COM / C++ / J-Link / NX Open / DXL / WSTP):
 * - PTC Creo (`creo`)
 * - Siemens NX (`nx`)
 * - Dassault SOLIDWORKS (`solidworks`) & SOLIDWORKS PDM (`solidworks-pdm`)
 * - IBM Rational DOORS Classic (`doors-classic`)
 * - ESTECO VOLTA (`volta`)
 * - Wolfram Mathematica (`mathematica`)
 */

import {
  almFetch,
  globalAlmConnectorRegistry,
  type AlmArtifact,
  type AlmArtifactKind,
  type AlmConnector,
  type AlmConnectorRegistry,
  type AlmDelta,
  type AlmLink,
  type AlmVerificationRun,
  type ArtifactEdit,
  type AuthContext,
  type PushResult,
  type RemoteCapabilities,
  type ResolvedRemoteSpec,
} from "@modelscript/runtime";
import { resolveActiveEnterpriseLicense } from "../license/verifier.js";

export interface EnterpriseDesktopBridgeConfig {
  readonly protocol: string;
  readonly aliases?: readonly string[] | undefined;
  readonly displayName: string;
  readonly sdkTransport: string;
  readonly defaultKind: AlmArtifactKind;
}

export const ENTERPRISE_DESKTOP_BRIDGE_CONFIGS: readonly EnterpriseDesktopBridgeConfig[] = [
  {
    protocol: "creo",
    aliases: ["ptc-creo"],
    displayName: "PTC Creo Parametric (J-Link / OTK Bridge)",
    sdkTransport: "J-Link / Object TOOLKIT",
    defaultKind: "document_section",
  },
  {
    protocol: "nx",
    aliases: ["siemens-nx"],
    displayName: "Siemens NX (NX Open Bridge)",
    sdkTransport: "NX Open",
    defaultKind: "document_section",
  },
  {
    protocol: "solidworks",
    aliases: ["sw"],
    displayName: "Dassault SOLIDWORKS (COM Bridge)",
    sdkTransport: "SOLIDWORKS COM API",
    defaultKind: "document_section",
  },
  {
    protocol: "solidworks-pdm",
    aliases: ["sw-pdm"],
    displayName: "Dassault SOLIDWORKS PDM (Vault API Bridge)",
    sdkTransport: "SOLIDWORKS PDM Professional API",
    defaultKind: "document_section",
  },
  {
    protocol: "doors-classic",
    aliases: ["doors9", "dxl"],
    displayName: "IBM Rational DOORS Classic (DXL Bridge)",
    sdkTransport: "DOORS DXL Bridge",
    defaultKind: "requirement",
  },
  {
    protocol: "volta",
    aliases: ["esteco-volta"],
    displayName: "ESTECO VOLTA (Optimization & Simulation Bridge)",
    sdkTransport: "VOLTA REST / Bridge",
    defaultKind: "document_section",
  },
  {
    protocol: "mathematica",
    aliases: ["wolfram"],
    displayName: "Wolfram Mathematica (WSTP / Wolfram Engine Bridge)",
    sdkTransport: "WSTP / Wolfram Engine",
    defaultKind: "document_section",
  },
] as const;

function assertEnterprisePlmLicense(protocol: string): void {
  const editionEnv = (process.env["MSX_EDITION"] || "").toLowerCase().trim();
  if (editionEnv === "ce" || editionEnv === "community") {
    throw new Error(
      `Desktop bridge connector '${protocol}' requires ModelScript Enterprise Edition (feature 'plm_connectors') and is disabled when MSX_EDITION=ce.`,
    );
  }
  const status = resolveActiveEnterpriseLicense();
  if (!status.valid) {
    throw new Error(
      `Desktop bridge connector '${protocol}' requires a valid ModelScript Enterprise license (${status.reason ?? "missing license"}).`,
    );
  }
  if (status.mode === "licensed" && status.claims && !status.claims.features.includes("plm_connectors")) {
    throw new Error(
      `Active ModelScript Enterprise license for '${status.claims.org}' does not include the 'plm_connectors' entitlement required for '${protocol}'.`,
    );
  }
}

export class EnterpriseDesktopBridgeConnector implements AlmConnector {
  readonly protocol: string;
  readonly aliases?: readonly string[] | undefined;

  constructor(private readonly config: EnterpriseDesktopBridgeConfig) {
    this.protocol = config.protocol;
    this.aliases = config.aliases;
  }

  private bridgeBase(spec: ResolvedRemoteSpec): string {
    return spec.parsed.url.replace(/\/+$/, "");
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    assertEnterprisePlmLicense(this.protocol);
    const res = await almFetch<Record<string, unknown>>(`${this.bridgeBase(spec)}/health`, { auth });
    let serverVersion: string | undefined = this.config.sdkTransport;
    if (res.ok) {
      try {
        const info = res.json();
        if (info["version"]) serverVersion = String(info["version"]);
      } catch {
        // Ignore parse failure
      }
    }
    return {
      protocol: this.protocol,
      serverName: this.config.displayName,
      serverVersion,
      supportsIncrementalDelta: true,
      supportsBaselines: true,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: true,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    assertEnterprisePlmLicense(this.protocol);
    const url = new URL(`${this.bridgeBase(spec)}/artifacts`);
    url.searchParams.set("adapter", this.protocol);
    if (spec.query?.trim()) url.searchParams.set("query", spec.query.trim());
    if (spec.baseline) url.searchParams.set("baseline", spec.baseline);
    if (cursor) url.searchParams.set("since", cursor);

    const res = await almFetch<{
      artifacts?: Array<Record<string, unknown>>;
      links?: AlmLink[];
      nextCursor?: string;
    }>(url.toString(), { auth });
    if (!res.ok) {
      throw new Error(`${this.config.displayName} fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
    }

    const data = res.json();
    const upserted: AlmArtifact[] = (data.artifacts ?? []).map((item) => {
      const id = String(item["externalId"] ?? item["id"] ?? "");
      return {
        externalId: id,
        kind: (item["kind"] as AlmArtifactKind | undefined) ?? this.config.defaultKind,
        uri: String(item["uri"] ?? `${this.bridgeBase(spec)}/artifacts/${encodeURIComponent(id)}`),
        webUrl: typeof item["webUrl"] === "string" ? item["webUrl"] : undefined,
        title: String(item["title"] ?? item["name"] ?? id),
        text: String(item["text"] ?? item["description"] ?? ""),
        status: String(item["status"] ?? "Active"),
        revision: item["revision"] !== undefined ? String(item["revision"]) : undefined,
        modifiedAt: typeof item["modifiedAt"] === "string" ? item["modifiedAt"] : undefined,
        attributes: {
          enterpriseBridge: this.protocol,
          sdkTransport: this.config.sdkTransport,
          ...((item["attributes"] as Record<string, string | number | boolean> | undefined) ?? {}),
        },
      };
    });

    return {
      upserted,
      deletedIds: [],
      links: data.links ?? [],
      isFullSnapshot: !cursor,
      nextCursor: data.nextCursor ?? cursor,
      baselineUri: spec.baseline,
      snapshotVersion: `${this.protocol}@${data.nextCursor ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    assertEnterprisePlmLicense(this.protocol);
    const res = await almFetch<PushResult>(`${this.bridgeBase(spec)}/links`, {
      method: "POST",
      auth,
      body: { adapter: this.protocol, links },
    });
    if (!res.ok) {
      return {
        pushed: 0,
        skipped: 0,
        errors: [{ id: this.protocol, message: res.text.slice(0, 200), statusCode: res.status }],
      };
    }
    return { pushed: links.length, skipped: 0, errors: [] };
  }

  async pushVerificationRuns(
    spec: ResolvedRemoteSpec,
    auth: AuthContext,
    runs: AlmVerificationRun[],
  ): Promise<PushResult> {
    assertEnterprisePlmLicense(this.protocol);
    const res = await almFetch<PushResult>(`${this.bridgeBase(spec)}/verification-runs`, {
      method: "POST",
      auth,
      body: { adapter: this.protocol, runs },
    });
    if (!res.ok) {
      return {
        pushed: 0,
        skipped: 0,
        errors: [{ id: this.protocol, message: res.text.slice(0, 200), statusCode: res.status }],
      };
    }
    return { pushed: runs.length, skipped: 0, errors: [] };
  }

  async upsertArtifacts(spec: ResolvedRemoteSpec, auth: AuthContext, edits: ArtifactEdit[]): Promise<PushResult> {
    assertEnterprisePlmLicense(this.protocol);
    const res = await almFetch<PushResult>(`${this.bridgeBase(spec)}/artifacts`, {
      method: "PATCH",
      auth,
      body: { adapter: this.protocol, edits },
    });
    if (!res.ok) {
      return {
        pushed: 0,
        skipped: 0,
        errors: [{ id: this.protocol, message: res.text.slice(0, 200), statusCode: res.status }],
      };
    }
    return { pushed: edits.length, skipped: 0, errors: [] };
  }
}

/**
 * Registers all Enterprise-only licensed desktop bridge connectors
 * (`creo`, `nx`, `solidworks`, `solidworks-pdm`, `doors-classic`, `volta`, `mathematica`)
 * on the given `AlmConnectorRegistry`. Each invocation verifies the `plm_connectors` license.
 */
export function registerEnterpriseDesktopConnectors(
  registry: AlmConnectorRegistry = globalAlmConnectorRegistry,
): string[] {
  const registered: string[] = [];
  for (const cfg of ENTERPRISE_DESKTOP_BRIDGE_CONFIGS) {
    registry.register(new EnterpriseDesktopBridgeConnector(cfg));
    registered.push(cfg.protocol);
  }
  return registered;
}
