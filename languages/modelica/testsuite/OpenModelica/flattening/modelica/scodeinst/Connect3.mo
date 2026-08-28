// name: Connect3
// keywords:
// status: correct
//

connector C
  Real e;
  flow Real f;
end C;

class C2 = C;

model Connect3
  C2 c1, c2;
equation
  connect(c1, c2);
end Connect3;

// Result:
// Error processing file: Connect3.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/Connect3.mo:16:3-16:18:writable] Error: c1 is not a valid connector.
//
// Execution failed!
// endResult
