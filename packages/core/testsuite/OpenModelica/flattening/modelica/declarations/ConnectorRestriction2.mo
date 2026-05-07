// name: ConnectorRestriction2
// keywords:
// status: incorrect
//

connector C
  Real e;
  flow Real f;
algorithm
  e := f;
end C;

model ConnectorRestriction2
  C c;
end ConnectorRestriction2;

// Result:
// Error processing file: ConnectorRestriction2.mo
// [OpenModelica/flattening/modelica/declarations/ConnectorRestriction2.mo:10:3-10:9:writable] Error: Algorithm sections are not allowed in connector.
// Error: Error occurred while flattening model ConnectorRestriction2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
