// name: ceval5.mo
// status: incorrect

model A
  parameter Real n = 3;
  parameter Integer m = n;
  Real x[m] = {1.0, 1.0, 1.0}; //fill(1.0, m);
end A;

// Result:
// Error processing file: ceval5.mo
// Error: Failed to load package ceval5 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ceval5.mo not found in scope <top>.
// Error: Error occurred while flattening model ceval5.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
