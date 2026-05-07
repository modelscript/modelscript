// name:     Connect16
// keywords: connect
// status:   correct
//
// Checks that the correct connect equations are generated when components are
// connected at different levels in the hierarchy.
//

connector C
  Real v;
  flow Real i;
end C;

model A
  C c;
end A;

model B
  A a1;
  A a2;
equation
  connect(a1.c, a2.c);
end B;

model Connect16
  B b;
  C c;
equation
  connect(c, b.a1.c);
  connect(c, b.a2.c);
end Connect16;

// Result:
// Error processing file: Connect16.mo
// [OpenModelica/flattening/modelica/connectors/Connect16.mo:29:3-29:21:writable] Error: b.a1.c is not a valid form for a connector, connectors must be either c1.c2...cn or m.c (where c is a connector and m is a non-connector).
// Error: Error occurred while flattening model Connect16
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
