import { DAEArenaBuilder } from "../src/dae-arena.js";

const dae = new DAEArenaBuilder();
const baseId = dae.addNameExpr("a.b");
const subId = dae.addSubscriptExpr(baseId, [dae.addIntLiteral(1)]);
console.log(subId);
