// name: ConnectorRestriction4
// keywords:
// status: incorrect
//

connector C
  Real e;
  flow Real f;
initial equation
  e = f;
end C;

model ConnectorRestriction4
  C c;
end ConnectorRestriction4;

// Result:
// Error processing file: ConnectorRestriction4.mo
// [OpenModelica/flattening/modelica/declarations/ConnectorRestriction4.mo:10:3-10:8:writable] Error: Equations are not allowed in connector.
// Error: Error occurred while flattening model ConnectorRestriction4
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
