// SPDX-License-Identifier: AGPL-3.0-or-later

// This file contains code adapted from the OpenModelica project

import { describe, expect, test } from "@jest/globals";
import { NodeFileSystem } from "../../../../src/util/filesystem.js";
import { Context } from "../../../../src/compiler/context.js";

describe("Modification", () => {
  test("This file tests simple modifications of variables", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      ".mo",
      `
      model Motor

        model Foo
          parameter Real q;
        end Foo;

        parameter Real j = 1.0;
        Foo f(q=2.0);

      end Motor;

      model Modification1
        Motor m(j = 3.0);
        Motor n(f(q=5.0));
        annotation(__OpenModelica_commandLineOptions="-d=-newInst");
      end Modification1;
    `,
    );
    const result = context.flatten("Modification1");
    expect(result).toBe(`
      class Modification1
        parameter Real m.j = 3.0;
        parameter Real m.f.q = 2.0;
        parameter Real n.j = 1.0;
        parameter Real n.f.q = 5.0;
      end Modification1;
    `);
  });
});
