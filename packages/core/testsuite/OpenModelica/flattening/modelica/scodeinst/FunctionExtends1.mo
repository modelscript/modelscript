// name: FunctionExtends1
// keywords:
// status: correct
//

partial function f
  input Real x;
  output Real y;
end f;

function f2
  extends f;
algorithm
  y := x;
end f2;

model M
  Real x = f2(1.0);
end M;

// Result:
// Error processing file: FunctionExtends1.mo
// Error: Failed to load package FunctionExtends1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class FunctionExtends1 not found in scope <top>.
// Error: Error occurred while flattening model FunctionExtends1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
