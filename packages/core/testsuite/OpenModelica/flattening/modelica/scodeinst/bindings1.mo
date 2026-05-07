// name: bindings1.mo
// keywords:
// status: correct
//


model A
  constant Real x = 2 * y;
  constant Real z = 5;
  constant Real y = 3 + z;
end A;

// Result:
// Error processing file: bindings1.mo
// Error: Failed to load package bindings1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class bindings1.mo not found in scope <top>.
// Error: Error occurred while flattening model bindings1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
