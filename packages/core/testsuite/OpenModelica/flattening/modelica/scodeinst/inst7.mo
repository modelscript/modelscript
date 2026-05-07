// name: inst7.mo
// keywords:
// status: incorrect
//
//


model M
  Real x(start = 2.0);
  Real y = x.start;
end M;

// Result:
// Error processing file: inst7.mo
// Error: Failed to load package inst7 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class inst7.mo not found in scope <top>.
// Error: Error occurred while flattening model inst7.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
