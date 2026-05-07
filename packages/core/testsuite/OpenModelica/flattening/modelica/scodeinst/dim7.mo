// name: dim7.mo
// keywords:
// status: correct
//


model A
  Real x[size(x, 2), size(x, 3), size(x, 4), 2];
  Real y[size(y, 2), 2];
end A;

// Result:
// Error processing file: dim7.mo
// Error: Failed to load package dim7 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class dim7.mo not found in scope <top>.
// Error: Error occurred while flattening model dim7.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
