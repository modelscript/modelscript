// name: eq3.mo
// keywords:
// status: correct
//

model A
  Real x;
  Real y[3];
equation
  y = {x, x, x};
end A;

model B
  A a[3](x = {1, 2, 3});
end B;

// Result:
// Error processing file: eq3.mo
// Error: Failed to load package eq3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class eq3.mo not found in scope <top>.
// Error: Error occurred while flattening model eq3.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
