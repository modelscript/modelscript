// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  ALL_LOADABLE_CLUSTERS,
  AMBIGUOUS_EXTENSION_CLUSTERS,
  AMBIGUOUS_SHARED_EXTENSIONS,
  CORE_EXTENSIONS,
  CORE_LANGUAGE_IDS,
  type CorePluginsOptions,
  DOMAIN_CLUSTER_EXTENSIONS,
  DOMAIN_CLUSTER_LANGUAGE_IDS,
  ensureLazyLanguagePluginLoaded,
  HERITAGE_EXTENSIONS,
  HERITAGE_LANGUAGE_IDS,
  type LazyClusterLoaders,
  type LoadablePluginCluster,
  registerCoreLanguagePlugins,
  resetLazyPluginLoaderStateForTest,
  resolveLazyPluginCluster,
  resolveLazyPluginClusters,
  setLazyClusterLoadersForTest,
} from "../src/registry/core-plugins.js";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";

function createTestOptions(): CorePluginsOptions {
  return {
    workspaceManager: new WorkspaceManager(),
  };
}

function createCountingLoaders(): {
  counts: Record<LoadablePluginCluster, number>;
  loaders: LazyClusterLoaders;
} {
  const counts: Record<LoadablePluginCluster, number> = {
    heritage: 0,
    "power-electronics": 0,
    "fluid-process-nuclear": 0,
    "multibody-robotics": 0,
    "aerospace-controls": 0,
    "cad-continuum": 0,
    "bio-chem-medical": 0,
    "systems-scientific": 0,
  };
  const loaders = Object.fromEntries(
    ALL_LOADABLE_CLUSTERS.map((cluster) => [
      cluster,
      async () => {
        counts[cluster] += 1;
      },
    ]),
  ) as LazyClusterLoaders;
  return { counts, loaders };
}

describe("LSP registry cluster lazy-loading", () => {
  afterEach(() => {
    setLazyClusterLoadersForTest(null);
    resetLazyPluginLoaderStateForTest();
  });

  it("registers all 9 core language plugins eagerly without triggering any lazy cluster", async () => {
    const options = createTestOptions();
    registerCoreLanguagePlugins(options);

    for (const id of CORE_LANGUAGE_IDS) {
      assert.ok(globalLanguageRegistry.getPluginById(id), `Expected core plugin '${id}' to be eagerly registered`);
    }

    const { counts, loaders } = createCountingLoaders();
    setLazyClusterLoadersForTest(loaders);

    for (const id of CORE_LANGUAGE_IDS) {
      await ensureLazyLanguagePluginLoaded(id, options);
    }
    for (const ext of CORE_EXTENSIONS) {
      await ensureLazyLanguagePluginLoaded(ext, options);
    }
    await ensureLazyLanguagePluginLoaded("file:///workspace/Pendulum.mo", options);

    for (const cluster of ALL_LOADABLE_CLUSTERS) {
      assert.equal(counts[cluster], 0, `Core languages must never trigger '${cluster}' loader`);
    }
  });

  it("classifies core, heritage, all 7 domain clusters, compound extensions, ambiguous extensions, and __all__ accurately", () => {
    assert.equal(HERITAGE_LANGUAGE_IDS.size, 63, "Expected all 63 heritage language IDs in routing table");

    const totalDomainLanguages = Object.values(DOMAIN_CLUSTER_LANGUAGE_IDS).reduce((sum, set) => sum + set.size, 0);
    assert.equal(totalDomainLanguages, 99, "Expected all 99 non-core domain language IDs across the 7 clusters");

    // Ensure no language ID is duplicated across clusters
    const seenIds = new Set<string>(CORE_LANGUAGE_IDS);
    for (const id of HERITAGE_LANGUAGE_IDS) {
      assert.equal(seenIds.has(id), false, `Duplicate language ID '${id}' in heritage`);
      seenIds.add(id);
    }
    for (const [cluster, ids] of Object.entries(DOMAIN_CLUSTER_LANGUAGE_IDS)) {
      for (const id of ids) {
        assert.equal(seenIds.has(id), false, `Duplicate language ID '${id}' in '${cluster}'`);
        seenIds.add(id);
      }
    }

    // Core IDs, extensions, and URIs
    assert.equal(resolveLazyPluginCluster("modelica"), "core");
    assert.equal(resolveLazyPluginCluster("SysML2"), "core");
    assert.equal(resolveLazyPluginCluster(".mo"), "core");
    assert.equal(resolveLazyPluginCluster("file:///models/Arm.step"), "core");

    // Heritage IDs, extensions, and URIs
    assert.equal(resolveLazyPluginCluster("vhdl"), "heritage");
    assert.equal(resolveLazyPluginCluster("ACSL"), "heritage");
    assert.equal(resolveLazyPluginCluster("cplex-lp"), "heritage");
    assert.equal(resolveLazyPluginCluster("asn1"), "heritage");
    assert.equal(resolveLazyPluginCluster(".vhd"), "heritage");
    assert.equal(resolveLazyPluginCluster(".gms"), "heritage");
    assert.equal(resolveLazyPluginCluster(".stl"), "heritage");
    assert.equal(resolveLazyPluginCluster("file:///hdl/alu.vhdl"), "heritage");

    // Per-cluster domain IDs, extensions, and URIs
    assert.equal(resolveLazyPluginCluster("psse"), "power-electronics");
    assert.equal(resolveLazyPluginCluster(".raw"), "power-electronics");
    assert.equal(resolveLazyPluginCluster("file:///grid/case14.raw"), "power-electronics");
    assert.equal(resolveLazyPluginCluster("file:///telecom/net.fiber.geojson"), "power-electronics");

    assert.equal(resolveLazyPluginCluster("epanet"), "fluid-process-nuclear");
    assert.equal(resolveLazyPluginCluster("olga"), "fluid-process-nuclear");
    assert.equal(resolveLazyPluginCluster(".genkey"), "fluid-process-nuclear");
    assert.equal(resolveLazyPluginCluster("file:///hydro/aquifer.dis6"), "fluid-process-nuclear");

    assert.equal(resolveLazyPluginCluster("adams"), "multibody-robotics");
    assert.equal(resolveLazyPluginCluster("urdf"), "multibody-robotics");
    assert.equal(resolveLazyPluginCluster(".adm"), "multibody-robotics");
    assert.equal(resolveLazyPluginCluster("file:///robots/arm.urdf"), "multibody-robotics");

    assert.equal(resolveLazyPluginCluster("simulink"), "aerospace-controls");
    assert.equal(resolveLazyPluginCluster("ccsds"), "aerospace-controls");
    assert.equal(resolveLazyPluginCluster(".slx"), "aerospace-controls");
    assert.equal(resolveLazyPluginCluster("file:///orbit/ephemeris.oem"), "aerospace-controls");

    assert.equal(resolveLazyPluginCluster("fea"), "cad-continuum");
    assert.equal(resolveLazyPluginCluster("usd"), "cad-continuum");
    assert.equal(resolveLazyPluginCluster(".su2"), "cad-continuum");
    assert.equal(resolveLazyPluginCluster("file:///cad/part.3mf"), "cad-continuum");

    assert.equal(resolveLazyPluginCluster("sbml"), "bio-chem-medical");
    assert.equal(resolveLazyPluginCluster("dicom-rt"), "bio-chem-medical");
    assert.equal(resolveLazyPluginCluster(".cellml"), "bio-chem-medical");
    assert.equal(resolveLazyPluginCluster("file:///med/plan.rtplan.json"), "bio-chem-medical");

    assert.equal(resolveLazyPluginCluster("ampl"), "systems-scientific");
    assert.equal(resolveLazyPluginCluster("fortran"), "systems-scientific");
    assert.equal(resolveLazyPluginCluster(".reqif"), "systems-scientific");
    assert.equal(resolveLazyPluginCluster("file:///sec/ssp.oscal.json"), "systems-scientific");

    // Ambiguous extensions shared across clusters
    for (const ext of AMBIGUOUS_SHARED_EXTENSIONS) {
      assert.equal(resolveLazyPluginCluster(ext), "all", `Expected '${ext}' to route to 'all'`);
      assert.deepEqual(
        resolveLazyPluginClusters(ext),
        AMBIGUOUS_EXTENSION_CLUSTERS[ext],
        `Expected '${ext}' to resolve to its exact matching clusters`,
      );
      assert.equal(
        HERITAGE_EXTENSIONS.has(ext),
        false,
        `Ambiguous extension '${ext}' must not be listed as heritage-only`,
      );
      for (const [cluster, exts] of Object.entries(DOMAIN_CLUSTER_EXTENSIONS)) {
        assert.equal(exts.has(ext), false, `Ambiguous extension '${ext}' must not be listed in '${cluster}'`);
      }
    }

    // Explicit __all__
    assert.equal(resolveLazyPluginCluster("__all__"), "all");
    assert.deepEqual(resolveLazyPluginClusters("__all__"), ALL_LOADABLE_CLUSTERS);
  });

  it("isolates cluster loading when opening a single domain file (e.g. .raw loads only power-electronics)", async () => {
    const options = createTestOptions();
    const { counts, loaders } = createCountingLoaders();
    setLazyClusterLoadersForTest(loaders);

    await ensureLazyLanguagePluginLoaded("file:///grid/case14.raw", options);
    await ensureLazyLanguagePluginLoaded("pscad", options);
    await ensureLazyLanguagePluginLoaded(".dss", options);

    assert.equal(counts["power-electronics"], 1, "power-electronics loader should be called once and memoized");
    for (const cluster of ALL_LOADABLE_CLUSTERS) {
      if (cluster !== "power-electronics") {
        assert.equal(counts[cluster], 0, `Opening power-electronics files must not load '${cluster}'`);
      }
    }
  });

  it("loads only the matching subset of clusters for ambiguous shared extensions", async () => {
    const options = createTestOptions();
    const { counts, loaders } = createCountingLoaders();
    setLazyClusterLoadersForTest(loaders);

    await ensureLazyLanguagePluginLoaded("file:///case/deck.sim", options);
    assert.equal(counts.heritage, 1);
    assert.equal(counts["multibody-robotics"], 1);
    assert.equal(counts["power-electronics"], 0);
    assert.equal(counts["bio-chem-medical"], 0);
    assert.equal(counts["fluid-process-nuclear"], 0);

    resetLazyPluginLoaderStateForTest();
    const { counts: inpCounts, loaders: inpLoaders } = createCountingLoaders();
    setLazyClusterLoadersForTest(inpLoaders);

    await ensureLazyLanguagePluginLoaded("file:///models/network.inp", options);
    assert.equal(inpCounts["cad-continuum"], 1);
    assert.equal(inpCounts["fluid-process-nuclear"], 1);
    assert.equal(inpCounts["multibody-robotics"], 1);
    assert.equal(inpCounts.heritage, 0);
    assert.equal(inpCounts["power-electronics"], 0);
    assert.equal(inpCounts["bio-chem-medical"], 0);
  });

  it("loads all 8 clusters when requested with __all__", async () => {
    const options = createTestOptions();
    const { counts, loaders } = createCountingLoaders();
    setLazyClusterLoadersForTest(loaders);

    await ensureLazyLanguagePluginLoaded("__all__", options);

    for (const cluster of ALL_LOADABLE_CLUSTERS) {
      assert.equal(counts[cluster], 1, `Expected '__all__' to load '${cluster}' exactly once`);
    }
  });

  it("loads real power-electronics cluster on demand without registering bio-chem-medical or heritage plugins", async () => {
    const options = createTestOptions();
    registerCoreLanguagePlugins(options);

    assert.equal(globalLanguageRegistry.getPluginById("psse"), undefined);
    assert.equal(globalLanguageRegistry.getPluginById("sbml"), undefined);
    assert.equal(globalLanguageRegistry.getPluginById("vhdl"), undefined);

    await ensureLazyLanguagePluginLoaded("file:///grid/case14.raw", options);

    // Power-electronics plugins are now registered
    for (const id of DOMAIN_CLUSTER_LANGUAGE_IDS["power-electronics"]) {
      assert.ok(globalLanguageRegistry.getPluginById(id), `Expected power-electronics plugin '${id}' to be registered`);
    }

    // Other clusters must STILL be unloaded
    assert.equal(globalLanguageRegistry.getPluginById("sbml"), undefined, "bio-chem-medical 'sbml' must stay unloaded");
    assert.equal(globalLanguageRegistry.getPluginById("adams"), undefined, "multibody 'adams' must stay unloaded");
    assert.equal(globalLanguageRegistry.getPluginById("vhdl"), undefined, "heritage 'vhdl' must stay unloaded");
  });

  it("loads real heritage-plugins.js on demand without registering unrelated domain clusters", async () => {
    const options = createTestOptions();
    registerCoreLanguagePlugins(options);

    assert.equal(globalLanguageRegistry.getPluginById("vhdl"), undefined);
    assert.equal(globalLanguageRegistry.getPluginById("sbml"), undefined);

    await ensureLazyLanguagePluginLoaded("vhdl", options);

    for (const id of HERITAGE_LANGUAGE_IDS) {
      assert.ok(globalLanguageRegistry.getPluginById(id), `Expected heritage plugin '${id}' to be registered`);
    }

    assert.equal(globalLanguageRegistry.getPluginById("sbml"), undefined, "bio-chem-medical 'sbml' must stay unloaded");
    assert.equal(globalLanguageRegistry.getPluginById("adams"), undefined, "multibody 'adams' must stay unloaded");
  });
});
