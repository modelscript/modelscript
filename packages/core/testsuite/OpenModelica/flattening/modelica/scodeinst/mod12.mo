// name: mod12.mo
// keywords:
// status: correct
//

model A
  Real x;
end A;

model B
  extends A;
  Real x;
end B;

model C
  extends B(x = 5);
end C;

// Result:
// Error processing file: mod12.mo
// Error: Failed to load package mod12 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class mod12.mo not found in scope <top>.
// Error: Error occurred while flattening model mod12.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
