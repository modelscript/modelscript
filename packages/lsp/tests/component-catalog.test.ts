// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerClassQueryEndpoints, type CatalogComponentInfo } from "../src/handlers/classqueryEndpoints.js";
import { iconCache } from "../src/handlers/treeHandler.js";
import type { LspContext } from "../src/lsp-context.js";
import { mountedLibraryMetadata } from "../src/utils/hierarchy-utils.js";

describe("Full Component Catalog & Pre-baked MSL Search Endpoints", () => {
  it("returns 1,300+ leaf schematic MSL components and mounted custom library classes via modelscript/getComponentCatalog", async () => {
    const handlers = new Map<string, (params?: any) => any>();
    mountedLibraryMetadata.clear();
    mountedLibraryMetadata.set("CustomDriveLib", {
      name: "CustomDriveLib",
      version: "2.1.0",
      language: "modelica",
    });

    const mockIndex = {
      symbols: new Map<number, any>([
        [
          1,
          {
            id: 1,
            name: "CustomDriveLib",
            kind: "Class",
            metadata: { classPrefixes: "package" },
            parentId: null,
            resourceId: "modelica:/packages/CustomDriveLib/CustomDriveLib/package.mo",
          },
        ],
        [
          2,
          {
            id: 2,
            name: "ServoInverter",
            kind: "Class",
            metadata: { classPrefixes: "model", description: "Three-phase SiC servo inverter" },
            parentId: 1,
            resourceId: "modelica:/packages/CustomDriveLib/CustomDriveLib/ServoInverter.mo",
          },
        ],
      ]),
      childrenOf: new Map<number | null, number[]>([
        [null, [1]],
        [1, [2]],
      ]),
    };

    const fakeContext = {
      connection: {
        onRequest: (method: string, fn: (params?: any) => any) => {
          handlers.set(method, fn);
        },
      },
      parserService: {
        getServerDistBase: () => undefined,
      },
      workspaceManager: {
        documentInstances: new Map(),
        documentContexts: new Map(),
        getWorkspaceIndex: () => ({ fileLoaders: new Map() }),
        unifiedWorkspace: {
          getIndex: () => mockIndex,
        },
      },
    } as unknown as LspContext;

    registerClassQueryEndpoints(fakeContext);

    const getCatalog = handlers.get("modelscript/getComponentCatalog");
    assert.ok(getCatalog, "modelscript/getComponentCatalog handler should be registered");

    const catalogResp = (await getCatalog!({})) as { components: CatalogComponentInfo[] };
    const catalog = catalogResp.components;
    assert.ok(Array.isArray(catalog), "Response should contain components array");
    assert.ok(catalog.length >= 1300, `Expected >= 1,300 placeable schematic components, got ${catalog.length}`);

    // Essential MSL schematic components across domains must be present with live icons
    const byFqn = new Map(catalog.map((c) => [c.fqn, c]));
    assert.ok(byFqn.has("Modelica.Electrical.Analog.Basic.Resistor"));
    assert.ok(byFqn.has("Modelica.Electrical.Analog.Ideal.IdealOpAmp3Pin"));
    assert.ok(byFqn.has("Modelica.Blocks.Continuous.LimPID"));
    assert.ok(byFqn.has("Modelica.Blocks.Math.Add"), "Modelica.Blocks.Math.* control blocks must be retained");
    assert.ok(byFqn.has("Modelica.Mechanics.Rotational.Components.SpringDamper"));
    assert.ok(byFqn.has("Modelica.Magnetic.FluxTubes.Basic.ConstantReluctance"));
    assert.equal(byFqn.get("Modelica.Electrical.Analog.Basic.Resistor")?.hasLiveIcon, true);
    assert.ok((iconCache.get("Modelica.Electrical.Analog.Basic.Resistor") || "").includes("<svg"));

    // Non-placeable containers, Media functions/records, and Examples must be excluded from component gallery
    assert.equal(byFqn.has("Modelica.Electrical"), false, "Container package must be excluded");
    assert.equal(
      catalog.some((c) => c.fqn.startsWith("Modelica.Media.")),
      false,
      "Modelica.Media property packages/functions must be excluded",
    );
    assert.equal(
      catalog.some((c) => c.fqn.includes(".Examples.")),
      false,
      "Runnable Examples belong in Open Model Hub, not Component Gallery",
    );

    // Custom mounted package component from unifiedIndex must also be merged
    const customItem = byFqn.get("CustomDriveLib.ServoInverter");
    assert.ok(customItem, "Mounted custom library component should be included in catalog");
    assert.equal(customItem.packageName, "CustomDriveLib");
    assert.equal(customItem.description, "Three-phase SiC servo inverter");

    // Verify modelscript/searchClasses also matches lazy unparsed MSL classes & examples via iconCache
    const searchClasses = handlers.get("modelscript/searchClasses");
    assert.ok(searchClasses, "modelscript/searchClasses handler should be registered");
    const searchResp = (await searchClasses!({ query: "ChuaCircuit", limit: 20 })) as { results: any[] };
    assert.ok(
      Array.isArray(searchResp.results) &&
        searchResp.results.some((r: any) => r.compositeName === "Modelica.Electrical.Analog.Examples.ChuaCircuit"),
      "modelscript/searchClasses should match lazy MSL ChuaCircuit via pre-baked icon index",
    );

    mountedLibraryMetadata.clear();
  });
});
