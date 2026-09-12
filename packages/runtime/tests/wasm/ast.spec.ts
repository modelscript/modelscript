import { allocNode, getNodeByteLength, getNodeEnvHash, getNodePadding, getNodeType } from "./src-gen/arena";

describe("ASTNode pointer arithmetic", () => {
  it("should allocate and read node metadata correctly", () => {
    let node = allocNode(10, 2, 100, 42);

    expect<u16>(getNodeType(node)).toBe(10, "Node type should be 10");
    expect<u32>(getNodePadding(node)).toBe(2, "Node padding should be 2");
    expect<u32>(getNodeByteLength(node)).toBe(100, "Node byte length should be 100");
    expect<u32>(getNodeEnvHash(node)).toBe(42, "Node env hash should be 42");
  });
});
