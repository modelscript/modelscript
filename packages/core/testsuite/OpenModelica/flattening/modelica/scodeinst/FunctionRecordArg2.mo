// name: FunctionRecordArg2
// keywords:
// status: correct
//

record R
  Real x = 1.0;
  Real y = 2.0;
end R;

function f
  output Real x;
protected
  R r;
algorithm
  x := r.x;
end f;

model M
  Real x = f();
end M;

// Result:
// Error processing file: FunctionRecordArg2.mo
// Error: Failed to load package FunctionRecordArg2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class FunctionRecordArg2 not found in scope <top>.
// Error: Error occurred while flattening model FunctionRecordArg2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
