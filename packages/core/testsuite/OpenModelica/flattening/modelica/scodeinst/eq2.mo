// name: eq2.mo
// keywords:
// status: correct
//

model A
  Real x;
  Real y[3];
equation
  x = 4;
  y = {1, 2, 3};
end A;

model B
  A a[3];
end B;

// Result:
// Error processing file: eq2.mo
// Error: Failed to load package eq2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class eq2.mo not found in scope <top>.
// Error: Error occurred while flattening model eq2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
