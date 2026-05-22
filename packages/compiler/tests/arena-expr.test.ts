import { describe, expect, it } from "vitest";
import { ArenaDAEBuilder } from "../src/dae-arena.js";

describe("arena-expr", () => {
  it("creates subscript expressions on the arena", () => {
    const dae = new ArenaDAEBuilder();
    const baseId = dae.addNameExpr("a.b");
    const subId = dae.addSubscriptExpr(baseId, [dae.addIntLiteral(1)]);
    expect(subId).toBeGreaterThanOrEqual(0);
  });
});
