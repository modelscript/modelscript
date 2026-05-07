// name: ceval1.mo
// status: correct

model A
  parameter Integer n = (-1+2)*2-3+4;
  Real x[n] = {1.0, 2.0, 3.0};
end A;

// Result:
// Error processing file: ceval1.mo
// Error: Failed to load package ceval1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ceval1.mo not found in scope <top>.
// Error: Error occurred while flattening model ceval1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
