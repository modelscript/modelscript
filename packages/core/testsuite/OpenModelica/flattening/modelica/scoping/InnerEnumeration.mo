// name:     InnerEnumeration
// keywords: inner outer variables
// status:   correct
//
// makes sure that outer variables are replaced with the correct inner ones on the top scope
//

model InnerEnumeration

  package P
    type E = enumeration(
        four,
        one,
        two,
        three,
        five);

    class A
      outer E T0;
    end A;

    class C
      outer E T0 = E.one;
    end C;

    class B
      inner E T0 = E.five;
      A a1, a2; // B.T0, B.a1.T0 and B.a2.T0 is the same variable
      C c;
    end B;
  end P;

  P.B b;

equation
  assert(b.a1.T0 == P.E.five, "b.a1.T0 was not set to the correct value");
  assert(b.a2.T0 == P.E.five, "b.a2.T0 was not set to the correct value");
  assert(b.T0 == P.E.five, "b.T0 was not set to the correct value");
  assert(b.c.T0 == P.E.five, "b.c.T0 was not set to the correct value");
end InnerEnumeration;

// Result:
// Error processing file: InnerEnumeration.mo
// [OpenModelica/flattening/modelica/scoping/InnerEnumeration.mo:19:7-19:17:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/scoping/InnerEnumeration.mo:23:7-23:25:writable] Error: Modifier ' = E.one' found on outer element T0.
// Error: Error occurred while flattening model InnerEnumeration
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
