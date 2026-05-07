// name: FunctionRecordArg1
// keywords:
// status: correct
//

record R
  Real x;
  Real y;
end R;

function f
  input R r;
  output Real x;
algorithm
  x := r.x;
end f;

model M
  R r = R(2.0, 4.0);
  Real x = f(r);
end M;

// Result:
// Error processing file: FunctionRecordArg1.mo
// Error: Failed to load package FunctionRecordArg1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class FunctionRecordArg1 not found in scope <top>.
// Error: Error occurred while flattening model FunctionRecordArg1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
