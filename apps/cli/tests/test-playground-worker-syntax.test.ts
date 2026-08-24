import { getCompilerWorkerJs, getLspWorkerJs } from "../src/commands/playground.js";

describe("Playground Worker Syntax", () => {
  test("compiler worker js has valid syntax", () => {
    const code = getCompilerWorkerJs();
    expect(() => new Function(code)).not.toThrow();
  });

  test("lsp worker js has valid syntax", () => {
    const code = getLspWorkerJs();
    expect(() => new Function(code)).not.toThrow();
  });
});
