// name:     ConnectArrayCond
// keywords: connect conditional
// status:   correct
//
// Tests connecting deleted conditional array components.
//

connector C
  flow Real f;
  Real e;
end C;

model A
  C c;
end A;

model ConnectArrayCond
  C c1[2] if false;
equation
  connect(c1[1].c, c1[2].c);
end ConnectArrayCond;

// Result:
// Error processing file: ConnectArrayCond.mo
// [OpenModelica/flattening/modelica/connectors/ConnectArrayCond.mo:20:3-20:28:writable] Error: Variable c1[1].c not found in scope ConnectArrayCond.
// Error: Error occurred while flattening model ConnectArrayCond
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
