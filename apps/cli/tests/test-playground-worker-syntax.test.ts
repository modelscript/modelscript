import vm from "node:vm";
import { getCompilerWorkerJs, getIndexHtml, getLspWorkerJs } from "../src/commands/playground";

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

  it("should render Monarch Colorizer toggle in playground HTML", () => {
    const html = getIndexHtml();
    expect(html).toContain('id="toggle-monarch"');
    expect(html).toContain("Monarch Colorizer");
    expect(html).toContain("applyMonarchTokens");
    expect(html).toContain("setMonarchTokensProvider");
  });
});
