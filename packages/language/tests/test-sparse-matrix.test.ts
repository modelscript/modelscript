import { describe, expect, test } from "@jest/globals";
import { generateSparseMatrix } from "../src/codegen/sparse_matrix.js";

describe("Sparse Matrix Generator", () => {
  test("generates valid CSR matrix AssemblyScript string", () => {
    const code = generateSparseMatrix();
    expect(code).toContain("class CSRMatrix");
    expect(code).toContain("public numRows: u32;");
    expect(code).toContain("public rowPtrs: u32;");
    expect(code).toContain("public colIndices: u32;");
    expect(code).toContain("public insert(row: u32, col: u32, value: u8)");
    expect(code).toContain("public finalize(): void");
    expect(code).toContain("public get(row: u32, col: u32): u8");
  });
});
