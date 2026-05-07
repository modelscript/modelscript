// name: dim8.mo
// keywords:
// status: incorrect
//

model M
  Integer x;
  Real y[x];
end M;

// Result:
// Error processing file: dim8.mo
// Error: Failed to load package dim8 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class dim8.mo not found in scope <top>.
// Error: Error occurred while flattening model dim8.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
