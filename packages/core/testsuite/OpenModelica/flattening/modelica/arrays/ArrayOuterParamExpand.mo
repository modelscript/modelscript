// name:     ArrayOuterParamExpand
// keywords: array inner outer parameter
// status:   correct
//
// Checks that outer parameters are expanded correctly.
//

model A
  outer parameter Real[3] p1;
  parameter Real[3] p2;
  Real v;
equation
  v = p1 * p2;
end A;

model ArrayOuterParamExpand
  inner parameter Real[3] p1;
  A a;
end ArrayOuterParamExpand;

// Result:
// Error processing file: ArrayOuterParamExpand.mo
// [OpenModelica/flattening/modelica/arrays/ArrayOuterParamExpand.mo:17:3-17:29:writable] Error: Parameter p1 has neither value nor start value, and is fixed during initialization (fixed=true).
// Error: Error occurred while flattening model ArrayOuterParamExpand
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
