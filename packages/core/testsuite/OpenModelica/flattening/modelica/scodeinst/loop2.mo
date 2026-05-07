// name: loop2.mo
// keywords:
// status: correct
//


model A
  Real x = x + 1;
end A;

// Result:
// Error processing file: loop2.mo
// Error: Failed to load package loop2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class loop2.mo not found in scope <top>.
// Error: Error occurred while flattening model loop2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
