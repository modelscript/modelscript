// name: enum8.mo
// keywords:
// status: correct
//

model M
  Real x[StateSelect];
end M;

// Result:
// Error processing file: enum8.mo
// Error: Failed to load package enum8 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class enum8.mo not found in scope <top>.
// Error: Error occurred while flattening model enum8.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
