import { generateAdJacobian } from "../src/codegen/ad_jacobian";

describe("Analytical Jacobians (AD) Codegen", () => {
  it("should generate AssemblyScript code for AD Jacobians when acausal flag is set", () => {
    const mockGrammar = { name: "Modelica", acausal: true };
    const mockNormalized = { symToInt: new Map() };
    const code = generateAdJacobian(mockGrammar as any, mockNormalized);

    expect(code).toContain("computeJacobianCCS");
    expect(code).toContain("computeHessianCCS");
    expect(code).toContain("initVarHashTable");
    expect(code).toContain("fnvHashPtr");
    expect(code).toContain("initDependencies");
  });

  it("should return empty string for non-acausal non-Calc grammars", () => {
    const mockGrammar = { name: "ToyLang", acausal: false };
    const mockNormalized = { symToInt: new Map() };
    const code = generateAdJacobian(mockGrammar as any, mockNormalized);

    expect(code).toBe("");
  });
});
