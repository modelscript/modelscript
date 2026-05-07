// name: ConnectArrays4
// keywords:
// status: correct
//
//

model ConnectArrays4
  connector C
    Real e;
    flow Real f;
  end C;

  type E = enumeration(a, b, c);
  C c[2], c2[2];
equation
  connect(c[E.a], c2[E.a]);
  connect(c[1], c2[2]);
end ConnectArrays4;

// Result:
// Error processing file: ConnectArrays4.mo
// [OpenModelica/flattening/modelica/scodeinst/ConnectArrays4.mo:16:3-16:27:writable] Error: Subscript 'E.a' has type enumeration E(a, b, c), expected type Integer.
// Error: Error occurred while flattening model ConnectArrays4
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
