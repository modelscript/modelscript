// name: FuncExtends
// keywords:
// status: correct
//

function f
  input Real x;
end f;

function f2
  extends f;
  output Real y = x;
end f2;

model M
  Real x = f2(1.0);
end M;

// Result:
// Error processing file: FuncExtends.mo
// Error: Failed to load package FuncExtends (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class FuncExtends not found in scope <top>.
// Error: Error occurred while flattening model FuncExtends
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
