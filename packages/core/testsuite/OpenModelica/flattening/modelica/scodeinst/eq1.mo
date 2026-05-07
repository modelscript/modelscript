// name: eq1.mo
// keywords:
// status: correct
//

model A
  Real x;
  Real y;
equation
  x = 2;
  y = 3;
end A;

// Result:
// Error processing file: eq1.mo
// Error: Failed to load package eq1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class eq1.mo not found in scope <top>.
// Error: Error occurred while flattening model eq1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
