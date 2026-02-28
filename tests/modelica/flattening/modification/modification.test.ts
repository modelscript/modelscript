// SPDX-License-Identifier: AGPL-3.0-or-later

// This file contains code adapted from the OpenModelica project

import { describe, expect, test } from "@jest/globals";
import dedent from "dedent-js";
import { NodeFileSystem } from "../../../../packages/cli/src/util/filesystem.js";
import { Context } from "../../../../src/compiler/context.js";

describe("Modification", () => {
  test("Modification1 - This file tests simple modifications of variables", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      model Motor

        model Foo
          parameter Real q;
        end Foo;

        parameter Real j = 1.0;
        Foo f(q = 2.0);

      end Motor;

      model Modification1
        Motor m(j = 3.0);
        Motor n(f(q = 5.0));
      end Modification1;
    `),
    );
    expect(context.flatten("Modification1")).toBe(
      dedent(`
      class Modification1
        parameter Real m.j = 3.0;
        parameter Real m.f.q = 2.0;
        parameter Real n.j = 1.0;
        parameter Real n.f.q = 5.0;
      end Modification1;
    `),
    );
  });

  test("Modification2 - Modifying a parameter in a local class is allowed.", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      class B
        class A
          parameter Real p = 1.0;
        end A;
        A a;
      end B;

      class Modification2
        B b(A(p = 2.0));
      end Modification2;
    `),
    );
    expect(context.flatten("Modification2")).toBe(
      dedent(`
      class Modification2
        parameter Real b.a.p = 2.0;
      end Modification2;
    `),
    );
  });

  test("Modification3", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      class A
        class AA
          parameter Real p = 1.0;
        end AA;
      end A;

      class B
        replaceable class A = .A.AA;
        A a;
        A a2;
      end B;

      class Modification3
        B b(redeclare class A = A.AA(p = 2), a2(p = 4));
      end Modification3;
    `),
    );
    expect(context.flatten("Modification3")).toBe(
      dedent(`
      class Modification3
        parameter Real b.a.p = 2.0;
        parameter Real b.a2.p = 4.0;
      end Modification3;
    `),
    );
  });

  test.skip("Modification4 - Error since no p inside A.", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      class A
        Integer x = 1;
      end A;

      class B
        A a;
      end B;

      class Modification4
        B b(a(p=2));
      end Modification4;
    `),
    );
    expect(context.flatten("Modification4")).toBe(null);
  });

  test.skip("Modification5 - By removing the declare-before-use this is legal in Modelica.", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      class A
        Real x = 17 + 2 * x;
      end A;

      class Modification5
        extends A;
      end Modification5;
    `),
    );
    expect(context.flatten("Modification5")).toBe(
      dedent(`
      class Modification5
        Real x = 17.0 + 2.0 * x;
      end Modification5;
    `),
    );
  });

  test("Modification6 - This file tests modification precedence.", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      model M
        replaceable model Foo
          parameter Real q = 1.0;
        end Foo;
        Foo f(q=2.0);
      end M;

      model Modification6
        model myFoo parameter Real q=5;end myFoo;
        M m1(redeclare model Foo=myFoo(q=3.0), f(q=4.0));
        M m2(f(q=4.0), redeclare model Foo=myFoo(q=3.0));
      end Modification6;
    `),
    );
    expect(context.flatten("Modification6")).toBe(
      dedent(`
      class Modification6
        parameter Real m1.f.q = 4.0;
        parameter Real m2.f.q = 4.0;
      end Modification6;
    `),
    );
  });

  test("Modification7 - This test checks that two modifications of subsubcomponents are both taken care of.", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      class Modification7
        class A
          Real x,y;
        end A;
        class B
          A a;
        end B;

        // This could be written as
        //   B b(a(x = 1.0, y = 2.0))
        // This tests whether it works in the following way too.
        B b(a.x = 1.0, a.y = 2.0);
      end Modification7;
    `),
    );
    expect(context.flatten("Modification7")).toBe(
      dedent(`
      class Modification7
        Real b.a.x = 1.0;
        Real b.a.y = 2.0;
      end Modification7;
    `),
    );
  });

  test.skip("Modification8 - These are seen as two modifications of the same element.", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      class Modification8
        class A
          Real x;
        end A;
        class B
          A a;
        end B;
        B b(a.x = 1.0, a(x = 2.0));
      end Modification8;
    `),
    );
    expect(context.flatten("Modification8")).toBe(null);
  });

  test("Modification10", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      class B
        Real x = 1.0;
      end B;

      class C
        B b;
      end C;

      class A
        replaceable class B2=B;
        C c;
        B2 b;
      end A;

      class Modification10
        A a(redeclare class B2=B(x = 17.0));
      end Modification10;
    `),
    );
    expect(context.flatten("Modification10")).toBe(
      dedent(`
      class Modification10
        Real a.c.b.x = 1.0;
        Real a.b.x = 17.0;
      end Modification10;
    `),
    );
  });

  test("Modification11", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      class B
        Real x = 1.0;
      end B;

      class A
        B b1;
        B b2;
      end A;

      class Modification11
        A a(b2(x = 17.0));
      end Modification11;
    `),
    );
    expect(context.flatten("Modification11")).toBe(
      dedent(`
      class Modification11
        Real a.b1.x = 1.0;
        Real a.b2.x = 17.0;
      end Modification11;
    `),
    );
  });

  test.skip("Modification12", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      class Modification12
        Real x[:] (min = fill(1,size(x,1))) = {1.0};
      end Modification12;
    `),
    );
    expect(context.flatten("Modification12")).toBe(
      dedent(`
      class Modification12
        Real x[1](min = 1.0);
      equation
        x = {1.0};
      end Modification12;
    `),
    );
  });

  test.skip("Modification13", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      class Modification12
        Real x[:] (min = fill(1,size(x,1))) = {1.0,2.0};
      end Modification12;

      class Modification13
        Modification12 a(x={1.0,2.0,4.0});
      end Modification13;
    `),
    );
    expect(context.flatten("Modification13")).toBe(
      dedent(`
      class Modification13
        Real a.x[1](min = 1.0);
        Real a.x[2](min = 1.0);
        Real a.x[3](min = 1.0);
      equation
        a.x = {1.0, 2.0, 4.0};
      end Modification13;
    `),
    );
  });

  test("Modification14 - This file tests modification precedence.", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      model M
        replaceable model Foo
          parameter Real q = 1.0;
        end Foo;
        Foo f(q=2.0);
      end M;

      model Modification14
        model myFoo parameter Real q=5.0; parameter Real z=1.0; end myFoo;
        M m1(redeclare model Foo=myFoo(q=3.0), f(q=4.0,z=3));
        M m2(f(q=4.0), redeclare model Foo=myFoo(q=3.0));
        M m3(redeclare model Foo=myFoo(q=333));
      end Modification14;
    `),
    );
    expect(context.flatten("Modification14")).toBe(
      dedent(`
      class Modification14
        parameter Real m1.f.q = 4.0;
        parameter Real m1.f.z = 3.0;
        parameter Real m2.f.q = 4.0;
        parameter Real m2.f.z = 1.0;
        parameter Real m3.f.q = 2.0;
        parameter Real m3.f.z = 1.0;
      end Modification14;
    `),
    );
  });

  test("Modification15", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      class C3
        class C4
          Real x;
        end C4;

        // Ok, different attributes designated (unit, displayUnit and value)
        C4 a(x.unit = "V", x.displayUnit="mV", x=5.0);
        // identical to:
        C4 b(x(unit = "V", displayUnit="mV") = 5.0);
        // Not OK, modifying the same attribute unit
        C4 c(x(unit = "V", displayUnit="mV", unit="J") = 5.0, x(unit = "K"));
      end C3;
    `),
    );
    expect(context.flatten("Modification15")).toBe(null);
  });

  test.skip("Modification16", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      model Modification16

        model Inertia
          parameter Real J;
          Real phi;
          Real w;
        equation
          phi = 1;
          w = 1;
        end Inertia;

        Inertia inertia1(w.start = 1, w.stateSelect=StateSelect.always, J=1, phi.start=0, phi.stateSelect=StateSelect.always);
      end Modification16;
    `),
    );
    expect(context.flatten("Modification16")).toBe(
      dedent(`
      class Modification16
        parameter Real inertia1.J = 1.0;
        Real inertia1.phi(start = 0.0, stateSelect = StateSelect.always);
        Real inertia1.w(start = 1.0, stateSelect = StateSelect.always);
      equation
        inertia1.phi = 1.0;
        inertia1.w = 1.0;
      end Modification16;
    `),
    );
  });

  test.skip("Modification17", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      package Modelica
        package SIunits
          type Length = Real;
          type Area = Real;
          type Volume = Real;
        end SIunits;
      end Modelica;

      type MyType = enumeration(divisionType1 , divisionType2 );

      partial model myPartialModel
        parameter Integer m(min = 1) = 2;
        input Modelica.SIunits.Volume[n] v;
      end myPartialModel;

      partial model mySecondPartialModel
        parameter Integer n(min = 1) = 3;
        parameter MyType myDivision = MyType.divisionType1;
        extends myPartialModel(final m = n - 1, final v = z);
        parameter Modelica.SIunits.Length[n] x;
        parameter Modelica.SIunits.Area[n] y;
        parameter Modelica.SIunits.Volume[n] z;
      end mySecondPartialModel;

      model Modification17
        parameter Modelica.SIunits.Length a = 1;
        parameter Modelica.SIunits.Length b = 1;
        final parameter Modelica.SIunits.Length c = a * a;
        final parameter Modelica.SIunits.Area[n] areas = fill(c / n, n);
        final parameter Modelica.SIunits.Length[n] lengths = if n == 1 then {b} elseif myDivision == MyType.divisionType1 then cat(1, {b / (n - 1) / 2}, fill(b / (n - 1), n - 2), {b / (n - 1) / 2}) else fill(b / n, n);
        final parameter Modelica.SIunits.Volume[n] volumes = array(areas[i] * lengths[i] for i in 1:n);
        extends mySecondPartialModel(final x = lengths, final y = areas, final z = volumes);
      end Modification17;
    `),
    );
    expect(context.flatten("Modification17")).toBe(
      dedent(`
      class Modification17
        parameter Integer n(min = 1) = 3;
        parameter enumeration(divisionType1, divisionType2) myDivision = MyType.divisionType1;
        parameter Integer m(min = 1) = -1 + n;
        input Real v[1];
        input Real v[2];
        input Real v[3];
        parameter Real x[1] = lengths[1];
        parameter Real x[2] = lengths[2];
        parameter Real x[3] = lengths[3];
        parameter Real y[1] = areas[1];
        parameter Real y[2] = areas[2];
        parameter Real y[3] = areas[3];
        parameter Real z[1] = volumes[1];
        parameter Real z[2] = volumes[2];
        parameter Real z[3] = volumes[3];
        parameter Real a = 1.0;
        parameter Real b = 1.0;
        final parameter Real c = a ^ 2.0;
        final parameter Real areas[1] = c / /*Real*/(n);
        final parameter Real areas[2] = c / /*Real*/(n);
        final parameter Real areas[3] = c / /*Real*/(n);
        final parameter Real lengths[1] = if myDivision == MyType.divisionType1 then 0.5 * b / /*Real*/(-1 + n) else b / /*Real*/(n);
        final parameter Real lengths[2] = if myDivision == MyType.divisionType1 then b / /*Real*/(-1 + n) else b / /*Real*/(n);
        final parameter Real lengths[3] = if myDivision == MyType.divisionType1 then 0.5 * b / /*Real*/(-1 + n) else b / /*Real*/(n);
        final parameter Real volumes[1] = areas[1] * lengths[1];
        final parameter Real volumes[2] = areas[2] * lengths[2];
        final parameter Real volumes[3] = areas[3] * lengths[3];
      equation
        v = {z[1], z[2], z[3]};
      end Modification17;
    `),
    );
  });

  test("simple", () => {
    const context = new Context(new NodeFileSystem());
    context.load(
      dedent(`
      model A
        Real x(start = 12) = 10;
      end A;
    `),
    );
    console.log(context.flatten("A"));
  });
});
