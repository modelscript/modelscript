/* eslint-disable */
import { describe, expect, it } from "vitest";
import { alias, blank, choice, def, field, opt, prec, ref, rep, rep1, seq, token } from "../src/index.js";

describe("combinators", () => {
  it("seq() creates a SeqNode", () => {
    const node = seq("a", "b", "c");
    expect(node.type).toBe("seq");
    expect(node.args).toEqual(["a", "b", "c"]);
  });

  it("opt() creates an OptNode", () => {
    const node = opt("x");
    expect(node.type).toBe("opt");
    expect(node.arg).toBe("x");
  });

  it("rep() creates a RepNode", () => {
    const node = rep("x");
    expect(node.type).toBe("rep");
    expect(node.arg).toBe("x");
  });

  it("rep1() creates a Rep1Node", () => {
    const node = rep1("x");
    expect(node.type).toBe("rep1");
    expect(node.arg).toBe("x");
  });

  it("choice() creates a ChoiceNode", () => {
    const node = choice("a", "b");
    expect(node.type).toBe("choice");
    expect(node.args).toEqual(["a", "b"]);
  });

  it("token() creates a TokenNode", () => {
    const node = token("x");
    expect(node.type).toBe("token");
    expect(node.arg).toBe("x");
  });

  it("token.immediate() creates a TokenImmediateNode", () => {
    const node = token.immediate("x");
    expect(node.type).toBe("token_immediate");
    expect(node.arg).toBe("x");
  });

  it("field() creates a FieldNode with a literal name", () => {
    const node = field("name", "x");
    expect(node.type).toBe("field");
    expect(node.name).toBe("name");
    expect(node.arg).toBe("x");
  });

  it("prec() creates a PrecNode", () => {
    const node = prec(5, "x");
    expect(node.type).toBe("prec");
    expect(node.precedence).toBe(5);
    expect(node.arg).toBe("x");
  });

  it("prec.left() creates a PrecLeftNode", () => {
    const node = prec.left(3, "x");
    expect(node.type).toBe("prec_left");
    expect(node.precedence).toBe(3);
  });

  it("prec.right() creates a PrecRightNode", () => {
    const node = prec.right(3, "x");
    expect(node.type).toBe("prec_right");
    expect(node.precedence).toBe(3);
  });

  it("prec.dynamic() creates a PrecDynamicNode", () => {
    const node = prec.dynamic(1, "x");
    expect(node.type).toBe("prec_dynamic");
    expect(node.precedence).toBe(1);
  });

  it("alias() creates an AliasNode", () => {
    const node = alias("x", "y");
    expect(node.type).toBe("alias");
    expect(node.arg).toBe("x");
    expect(node.value).toBe("y");
  });

  it("blank() creates a BlankNode", () => {
    const node = blank();
    expect(node.type).toBe("blank");
  });

  it("def() wraps a rule with semantic options", () => {
    const node = def({
      syntax: seq(field("name", "x")),
      symbol: (self) => ({
        kind: "Class",
        name: self.name,
      }),
    });
    expect(node.type).toBe("def");
    expect((node.rule as any).type).toBe("seq");
    expect(node.options.symbol).toBeDefined();
  });

  it("ref() wraps a rule with reference options", () => {
    const node = ref({
      syntax: field("name", "x"),
      name: (self) => self.name,
      targetKinds: ["Class"],
      resolve: "lexical",
    });
    expect(node.type).toBe("ref");
    expect(node.options.targetKinds).toEqual(["Class"]);
    expect(node.options.resolve).toBe("lexical");
  });

  it("combinators compose deeply", () => {
    const node = seq(
      "class",
      field("name", "IDENT"),
      opt(seq("extends", field("superclass", "NAME"))),
      field("body", rep(choice("decl", "stmt"))),
      "end",
    );
    expect(node.type).toBe("seq");
    expect(node.args.length).toBe(5);
    expect((node.args[2] as any).type).toBe("opt");
  });
});
