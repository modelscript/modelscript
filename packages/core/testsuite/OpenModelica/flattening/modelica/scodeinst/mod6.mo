// name: mod6.mo
// keywords:
// status: correct
//


model A
  Real x = 1.0;
end A;

model B
  A a(x = 2.0);
end B;

// Result:
// Error processing file: mod6.mo
// Error: Failed to load package mod6 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class mod6.mo not found in scope <top>.
// Error: Error occurred while flattening model mod6.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
