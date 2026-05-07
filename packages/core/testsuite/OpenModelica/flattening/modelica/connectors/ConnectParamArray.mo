// name:     ConnectParamArray
// keywords: connect parameter array
// status:   correct
//
// Tests that asserts are generated for parameters arrays in connectors.
//

connector C
  parameter Real e[3];
end C;

model ConnectParamArray
  C c1, c2;
equation
  connect(c1, c2);
end ConnectParamArray;

// Result:
// Error processing file: ConnectParamArray.mo
// [OpenModelica/flattening/modelica/connectors/ConnectParamArray.mo:9:3-9:22:writable] Error: Parameter c1.e has neither value nor start value, and is fixed during initialization (fixed=true).
// Error: Error occurred while flattening model ConnectParamArray
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
