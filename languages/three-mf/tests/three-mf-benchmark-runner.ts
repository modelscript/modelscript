// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { parseThreeMf } from "../src/parser/index.js";
import { lowerThreeMfToDae, verifyMeshTopology } from "../src/topology/index.js";

const TETRA_3MF = `<model unit="millimeter">
  <resources>
    <object id="1" name="TetraGuide" type="model" material="Ti-6Al-4V" wallThickness="2.0">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/>
          <vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/>
          <triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/>
        </triangles>
      </mesh>
    </object>
  </resources>
  <build><item objectid="1"/></build>
</model>`;

export const threeMfBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "three-mf",
  referenceTool: "3MF Consortium 2-Manifold Euler-Poincare Kernel",
  defaultTolerance: 1e-3,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const doc = parseThreeMf(TETRA_3MF);
    const topo = verifyMeshTopology(doc);
    const dae = lowerThreeMfToDae(doc);
    const d1 = performance.now() - t0;

    const exactVol = 1000.0 / 6.0;
    const volErr = Math.abs(topo.signedVolumeMm3 - exactVol) / exactVol;

    return [
      {
        id: "three-mf-manifold-euler",
        name: "3MF Watertight 2-Manifold Euler (V-E+F=2) & Volume",
        scale: "micro",
        referenceTool: "3MF Consortium 2-Manifold Euler-Poincare Kernel",
        metricKind: "max-relative-error",
        threshold: 1e-3,
        measuredError: volErr,
        passed: topo.isWatertightManifold && topo.eulerCharacteristic === 2 && volErr < 1e-3 && dae.getVarCount() > 0,
        durationMs: d1,
        details: `chi=${topo.eulerCharacteristic}, V=${topo.signedVolumeMm3.toFixed(2)}mm3`,
      },
    ];
  },
};
