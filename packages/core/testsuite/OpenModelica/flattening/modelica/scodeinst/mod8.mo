// name: mod8.mo
// keywords:
// status: correct
//


model A
  Real x;
end A;

model B
  Real y;
  A a(x = y);
end B;

// Result:
// Error processing file: mod8.mo
// Error: Failed to load package mod8 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class mod8.mo not found in scope <top>.
// Error: Error occurred while flattening model mod8.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
