// name: loop3.mo
// keywords:
// status: correct
//


model A
  parameter Integer n = 2;
  parameter Real x[2, 3] = zeros(2, 3);
  parameter Integer i = size(x, n);
end A;

// Result:
// Error processing file: loop3.mo
// Error: Failed to load package loop3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class loop3.mo not found in scope <top>.
// Error: Error occurred while flattening model loop3.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
