import { generateSAT } from "../src/codegen/sat";

describe("SMT/SAT DPLL(T) Solver Codegen", () => {
  it("should generate AssemblyScript DPLL CDCL solver code", () => {
    const mockGrammar = { name: "SysML", semantics: { reasoner: { smt: { theories: ["LRA"] } } } };
    const mockNormalized = { symToInt: new Map() };
    const code = generateSAT(mockGrammar as any, mockNormalized);

    expect(code).toContain("solveDPLL");
    expect(code).toContain("propagateBCP");
    expect(code).toContain("analyzeConflict");
    expect(code).toContain("lubySequence");
    expect(code).toContain("extractModel");
  });
});
