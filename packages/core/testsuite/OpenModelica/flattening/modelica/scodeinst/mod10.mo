// name: mod10.mo
// keywords:
// status: correct
//
//

model A
  Real x;
end A;

model B
  A a(x);
end B;

// Result:
// Error processing file: mod10.mo
// Error: Failed to load package mod10 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class mod10.mo not found in scope <top>.
// Error: Error occurred while flattening model mod10.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
