// name: mod5.mo
// keywords:
// status: incorrect
//


model A
  Real x;
end A;

model B
  A a(y = 2.0);
end B;

// Result:
// Error processing file: mod5.mo
// Error: Failed to load package mod5 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class mod5.mo not found in scope <top>.
// Error: Error occurred while flattening model mod5.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
