// name: dim1.mo
// keywords:
// status: correct
//


model B
  parameter Integer n = 3;
  Real x[n];
end B;

model A
  B b;
end A;

// Result:
// Error processing file: dim1.mo
// Error: Failed to load package dim1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class dim1.mo not found in scope <top>.
// Error: Error occurred while flattening model dim1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
