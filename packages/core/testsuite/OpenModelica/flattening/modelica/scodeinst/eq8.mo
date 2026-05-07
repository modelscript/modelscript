// name: eq8.mo
// keywords:
// status: correct
//

model A
  Real x[3], y[3];
equation
  x = y;
end A;

model B
  A a(x = {1, 2, 3});
end B;

// Result:
// Error processing file: eq8.mo
// Error: Failed to load package eq8 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class eq8.mo not found in scope <top>.
// Error: Error occurred while flattening model eq8.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
