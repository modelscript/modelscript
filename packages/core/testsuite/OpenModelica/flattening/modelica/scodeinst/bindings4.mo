// name: bindings4.mo
// keywords:
// status: correct
//


model A
  Real x;
equation
  x = 2.0;
end A;

model B
  A a[3];
end B;

// Result:
// Error processing file: bindings4.mo
// Error: Failed to load package bindings4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class bindings4.mo not found in scope <top>.
// Error: Error occurred while flattening model bindings4.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
