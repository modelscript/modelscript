import { describe, expect, it } from "@jest/globals";
import { WasmLanguageBinding } from "../src/bindings/javascript/bindings.js";

describe("Zero-GC Hybrid Unparser & Formatting Engine", () => {
  it("should have formatDocument method on WasmLanguageBinding prototype", () => {
    expect(typeof WasmLanguageBinding.prototype.formatDocument).toBe("function");
  });
});
