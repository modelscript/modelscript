// name: mod11.mo
// keywords:
// status: incorrect
//
//

model A
  Real x;
end A;

model B
  extends A(final x);
end B;

model C
  B b(x = 3);
end C;

// Result:
// Error processing file: mod11.mo
// Error: Failed to load package mod11 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class mod11.mo not found in scope <top>.
// Error: Error occurred while flattening model mod11.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
