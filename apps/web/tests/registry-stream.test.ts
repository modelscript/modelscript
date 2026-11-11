// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { globalClassIconCache } from "../src/components/morsel/util/lsp-bridge";
import {
  buildLibraryClassPathClient,
  clearRegistryStreamCache,
  fetchRegistryClassSource,
  fetchRegistryComponentIcon,
  fetchRegistryPackagesList,
  mergeLocalAndStreamedComponents,
  streamRegistryComponents,
  streamRegistryModels,
} from "../src/components/morsel/util/registry-stream";

describe("Morsel Ansatz Registry Streaming Client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearRegistryStreamCache();
    globalClassIconCache.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearRegistryStreamCache();
  });

  it("encodes scoped and unscoped library class paths cleanly", () => {
    assert.equal(
      buildLibraryClassPathClient("Buildings", "11.0.0", "Buildings.Fluid.Movers.Pump"),
      "/api/v1/libraries/Buildings/11.0.0/classes/Buildings.Fluid.Movers.Pump",
    );
    assert.equal(
      buildLibraryClassPathClient("@acme/drives", "2.1.0", "AcmeDrives.Machines.PMSM"),
      "/api/v1/libraries/%40acme/drives/2.1.0/classes/AcmeDrives.Machines.PMSM",
    );
  });

  it("streams components with normalized subpackage filter, inline iconSvg cache hydration, and peer dependencies", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      return new Response(
        JSON.stringify({
          total: 142,
          offset: 0,
          limit: 72,
          hasMore: true,
          components: [
            {
              fqn: "Buildings.Fluid.Movers.FlowControlled_m_flow",
              name: "FlowControlled_m_flow",
              kind: "model",
              domain: "fluids-thermal",
              subpackage: "Fluid.Movers",
              packageName: "Buildings",
              packageVersion: "11.0.0",
              description: "Prescribed mass flow rate pump/fan",
              hasIcon: true,
              iconSvg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="35"/></svg>',
            },
          ],
          availablePackages: [{ name: "Buildings", version: "11.0.0", count: 80 }],
          availableSubpackages: [{ id: "Fluid.Movers", label: "Fluid › Movers", count: 14 }],
          packageDependencies: {
            Buildings: { Modelica: ">=4.0.0" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const res = await streamRegistryComponents({
      q: "pump",
      domain: "fluids-thermal",
      packageName: "Buildings",
      subpackage: "Fluid · Movers",
      limit: 72,
      offset: 0,
    });

    assert.equal(res.fromRegistry, true);
    assert.equal(res.total, 142);
    assert.equal(res.hasMore, true);
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0]!.fqn, "Buildings.Fluid.Movers.FlowControlled_m_flow");
    assert.equal(res.items[0]!.category, "fluids-thermal");
    assert.equal(res.packageDependencies["Buildings"]?.["Modelica"], ">=4.0.0");
    assert.ok(
      globalClassIconCache.get("Buildings.Fluid.Movers.FlowControlled_m_flow")?.includes("<circle"),
      "Expected inline iconSvg to hydrate globalClassIconCache",
    );
    assert.equal(requestedUrls.length, 1);
    assert.ok(requestedUrls[0]!.includes("subpackage=Fluid.Movers"));
    assert.ok(requestedUrls[0]!.includes("includeSvg=1"));
  });

  it("merges local and streamed components without duplicates while upgrading scoped @scope/pkg metadata", () => {
    const merged = mergeLocalAndStreamedComponents(
      [
        {
          id: "local-1",
          shortName: "PMSM",
          fqn: "AcmeDrives.Machines.PMSM",
          kind: "model",
          category: "electrical",
          packageName: "AcmeDrives",
          packageVersion: "latest",
          summary: "Local LSP entry",
          portsAndParams: "AcmeDrives.Machines",
          declarationSnippet: "AcmeDrives.Machines.PMSM pmsm1;",
          keywords: ["pmsm"],
          schematicSvg: "<svg/>",
        },
      ],
      [
        {
          id: "reg-1",
          shortName: "PMSM",
          fqn: "acmedrives.machines.pmsm",
          kind: "model",
          category: "electrical",
          packageName: "@acme/drives",
          packageVersion: "2.3.1",
          summary: "Registry entry",
          portsAndParams: "AcmeDrives.Machines",
          declarationSnippet: "AcmeDrives.Machines.PMSM pmsm1;",
          keywords: ["pmsm"],
          schematicSvg: "<svg/>",
        },
        {
          id: "reg-2",
          shortName: "Inverter3Phase",
          fqn: "AcmeDrives.Converters.Inverter3Phase",
          kind: "model",
          category: "electrical",
          packageName: "@acme/drives",
          packageVersion: "2.3.1",
          summary: "Three-phase inverter",
          portsAndParams: "AcmeDrives.Converters",
          declarationSnippet: "AcmeDrives.Converters.Inverter3Phase inv1;",
          keywords: ["inverter"],
          schematicSvg: "<svg/>",
        },
      ],
    );

    assert.equal(merged.length, 2, "Duplicate FQN should be deduplicated case-insensitively");
    assert.equal(merged[0]!.packageName, "@acme/drives", "Scoped package name should upgrade local FQN root");
    assert.equal(merged[0]!.packageVersion, "2.3.1");
    assert.equal(merged[1]!.fqn, "AcmeDrives.Converters.Inverter3Phase");
  });

  it("streams runnable models with diagramSvg and fetches standalone class source & lazy icons", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/v1/models?")) {
        return new Response(
          JSON.stringify({
            total: 1,
            offset: 0,
            limit: 48,
            hasMore: false,
            models: [
              {
                fqn: "AcmeDrives.Examples.ServoBench",
                name: "ServoBench",
                kind: "model",
                domain: "control",
                packageName: "@acme/drives",
                packageVersion: "2.3.1",
                description: "Closed-loop PMSM servo drive benchmark",
                diagramSvg: '<svg viewBox="0 0 200 120"><rect width="80" height="40"/></svg>',
              },
            ],
            availablePackages: [{ name: "@acme/drives", version: "2.3.1", count: 1 }],
            packageDependencies: { "@acme/drives": { Modelica: ">=4.0.0" } },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === "/api/v1/libraries/%40acme/drives/2.3.1/classes/AcmeDrives.Examples.ServoBench") {
        return new Response(
          JSON.stringify({
            sourceCode: "model ServoBench\n  Real w;\nequation\n  der(w) = -w;\nend ServoBench;\n",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === "/api/v1/libraries/%40acme/drives/2.3.1/classes/AcmeDrives.Machines.PMSM/icon.svg") {
        return new Response('<svg viewBox="0 0 80 80"><path d="M10 10H70"/></svg>', { status: 200 });
      }
      if (url.startsWith("/api/v1/libraries?limit=")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.startsWith("/api/v1/packages?limit=")) {
        return new Response(
          JSON.stringify({
            packages: [
              {
                name: "@acme/drives",
                latestVersion: "2.3.1",
                description: "Industrial servo drives",
                totalDownloads: 950,
                domains: ["controls"],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const modelPage = await streamRegistryModels({ domain: "control" });
    assert.equal(modelPage.fromRegistry, true);
    assert.equal(modelPage.models.length, 1);
    assert.equal(modelPage.models[0]!.fqn, "AcmeDrives.Examples.ServoBench");
    assert.ok(modelPage.models[0]!.diagramSvg?.includes("<svg"));

    const src = await fetchRegistryClassSource("@acme/drives", "2.3.1", "AcmeDrives.Examples.ServoBench");
    assert.ok(src?.includes("model ServoBench"));

    const icon = await fetchRegistryComponentIcon("@acme/drives", "2.3.1", "AcmeDrives.Machines.PMSM");
    assert.ok(icon?.includes("<svg"));

    const pkgs = await fetchRegistryPackagesList(20);
    assert.equal(pkgs.length, 1);
    assert.equal(pkgs[0]!.name, "@acme/drives");
    assert.equal(pkgs[0]!.version, "2.3.1");
    assert.equal(pkgs[0]!.domain, "control");
    assert.equal(pkgs[0]!.downloads, 950);
  });

  it("degrades gracefully with fromRegistry=false when offline or registry returns an error", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    const compRes = await streamRegistryComponents({ q: "resistor" });
    assert.equal(compRes.fromRegistry, false);
    assert.deepEqual(compRes.items, []);

    const modelRes = await streamRegistryModels({ q: "chua" });
    assert.equal(modelRes.fromRegistry, false);
    assert.deepEqual(modelRes.models, []);
  });
});
