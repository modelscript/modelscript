// name: dim19.mo
// keywords:
// status: correct
//
//

model A
  parameter Integer n[3] = {1, 2, 3};
  parameter Integer m = n[2];
  Real x[m];
end A;

// Result:
// Error processing file: dim19.mo
// Error: Failed to load package dim19 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class dim19.mo not found in scope <top>.
// Error: Error occurred while flattening model dim19.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
