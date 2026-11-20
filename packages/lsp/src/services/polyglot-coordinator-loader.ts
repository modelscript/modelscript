// SPDX-License-Identifier: AGPL-3.0-or-later

let cachedProvidersPromise: Promise<Record<string, unknown>> | null = null;

/**
 * Lazily loads optional polyglot domain providers (CFD, FEA, SCAD, STEP, URDF, CAD, Simulate)
 * used by `@modelscript/runtime`'s `createPolyglotCoordinator`.
 */
export function loadPolyglotCoordinatorProviders(): Promise<Record<string, unknown>> {
  if (!cachedProvidersPromise) {
    cachedProvidersPromise = (async () => {
      const providers: Record<string, unknown> = {};
      const results = await Promise.allSettled([
        import("@modelscript/cfd"),
        import("@modelscript/fea"),
        import("@modelscript/scad"),
        import("@modelscript/step"),
        import("@modelscript/urdf"),
        import("@modelscript/cad"),
        import("@modelscript/simulate"),
      ]);
      const pick = (idx: number): Record<string, unknown> =>
        results[idx]?.status === "fulfilled" ? (results[idx].value as Record<string, unknown>) : {};
      const cfd = pick(0);
      const fea = pick(1);
      const scad = pick(2);
      const step = pick(3);
      const urdf = pick(4);
      const cad = pick(5);
      const sim = pick(6);
      Object.assign(providers, {
        OpenFoamDialect: cfd["OpenFoamDialect"],
        evaluateCfdExpression: cfd["evaluateCfdExpression"],
        InpDialect: fea["InpDialect"],
        evaluateScad: scad["evaluateScad"],
        scanStepEntities: step["scanStepEntities"],
        parseUrdf: urdf["parseUrdf"],
        computeMeshVolumeAndArea: cad["computeMeshVolumeAndArea"],
        ToleranceStackVerifier: cad["ToleranceStackVerifier"],
        SolidKind: cad["SolidKind"],
        LbmVoxelizer: sim["LbmVoxelizer"],
        WebGPULbmRunner: sim["WebGPULbmRunner"],
        FeaSolver: sim["FeaSolver"],
        Tet4Mesher: sim["Tet4Mesher"],
        MeshQualityAnalyzer: sim["MeshQualityAnalyzer"],
      });
      return providers;
    })();
  }
  return cachedProvidersPromise;
}
