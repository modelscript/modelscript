import { generateSAT } from "../src/codegen/sat";
import { generateSimplex } from "../src/codegen/simplex";

describe("SMT/SAT DPLL(T) Solver Codegen", () => {
  it("should generate AssemblyScript DPLL CDCL solver code with clause ingestion APIs", () => {
    const mockGrammar = { name: "PureSAT", semantics: { reasoner: { smt: { theories: [] } } } };
    const mockNormalized = { symToInt: new Map() };
    const code = generateSAT(mockGrammar as any, mockNormalized);

    expect(code).toContain("solveDPLL");
    expect(code).toContain("propagateBCP");
    expect(code).toContain("analyzeConflict");
    expect(code).toContain("lubySequence");
    expect(code).toContain("extractModel");
    expect(code).toContain("addClause");
    expect(code).toContain("addClause2");
    expect(code).toContain("addClause1");
  });

  it("should generate LRA Theory Solver integration when LRA theory is enabled", () => {
    const mockGrammar = { name: "SysML_LRA", semantics: { reasoner: { smt: { theories: ["LRA"] } } } };
    const mockNormalized = { symToInt: new Map() };
    const code = generateSAT(mockGrammar as any, mockNormalized);

    expect(code).toContain("Theory Solver: Linear Real Arithmetic (T_LRA)");
    expect(code).toContain("checkTheoryLRA");
    expect(code).toContain("registerLraConstraint");
    expect(code).toContain("initLraTheory");
  });

  it("should generate EUF / E-Graph Theory Solver integration when EUF or egraph optimization is enabled", () => {
    const mockGrammar = { name: "SysML_EUF", semantics: { reasoner: { smt: { theories: ["EUF"] } } } };
    const mockNormalized = { symToInt: new Map() };
    const code = generateSAT(mockGrammar as any, mockNormalized);

    expect(code).toContain("Theory Solver: Equality with Uninterpreted Functions (T_EUF)");
    expect(code).toContain("checkTheoryEUF");
    expect(code).toContain("registerEufEquality");
    expect(code).toContain("initEufTheory");
  });

  it("should generate combined DPLL(T) with both LRA and EUF theory solvers", () => {
    const mockGrammar = { name: "CombinedSMT", semantics: { reasoner: { smt: { theories: ["LRA", "EUF"] } } } };
    const mockNormalized = { symToInt: new Map() };
    const code = generateSAT(mockGrammar as any, mockNormalized);

    expect(code).toContain("checkTheoryLRA");
    expect(code).toContain("checkTheoryEUF");
    expect(code).toContain("solveDPLL");
  });

  it("should generate Simplex Tableau module with feasibility check and unsat cores", () => {
    const mockGrammar = { semantics: { reasoner: { smt: { maxSimplexVars: 250 } } } };
    const code = generateSimplex(mockGrammar);

    expect(code).toContain("checkSimplexFeasibility");
    expect(code).toContain("extractUnsatCore");
    expect(code).toContain("pivotSimplex");
    expect(code).toContain("SIMPLEX_MAX_VARS: u32 = 250");
  });
});
