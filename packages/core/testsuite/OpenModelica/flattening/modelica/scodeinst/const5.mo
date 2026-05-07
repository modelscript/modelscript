// name: const5.mo
// keywords:
// status: correct
//


package P
  constant Integer n = 2;
  constant A a;
end P;

model A
  Real x[P.n];
end A;

// Result:
// Error processing file: const5.mo
// Error: Failed to load package const5 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const5.mo not found in scope <top>.
// Error: Error occurred while flattening model const5.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
