// name: bindings7.mo
// keywords:
// status: correct
//

model A
  Real x[3];
  Real y[3] = x;
end A;

model B
  A a(x = {1, 2, 3});
end B;

// Result:
// Error processing file: bindings7.mo
// Error: Failed to load package bindings7 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class bindings7.mo not found in scope <top>.
// Error: Error occurred while flattening model bindings7.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
