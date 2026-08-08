import vm from "node:vm";
import { getCompilerWorkerJs, getLspWorkerJs } from "../src/commands/playground";

describe("Playground Embedded Worker Script Syntax", () => {
  it("should have valid JavaScript syntax for getLspWorkerJs()", () => {
    const lspJs = getLspWorkerJs();
    expect(() => {
      new vm.Script(lspJs);
    }).not.toThrow();
  });

  it("should have valid JavaScript syntax for getCompilerWorkerJs()", () => {
    const compilerJs = getCompilerWorkerJs();
    expect(() => {
      new vm.Script(compilerJs);
    }).not.toThrow();
  });
});
