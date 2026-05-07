// name: ceval2.mo
// status: correct

model A
  parameter Integer n = 1;
  parameter Integer m = 2+n;
  Real x[m] = fill(1.0, m);
end A;

// Result:
// Error processing file: ceval2.mo
// Error: Failed to load package ceval2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ceval2.mo not found in scope <top>.
// Error: Error occurred while flattening model ceval2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
