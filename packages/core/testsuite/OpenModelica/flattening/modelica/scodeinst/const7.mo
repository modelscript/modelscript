// name: const7.mo
// keywords:
// status: correct
//


model M
  parameter Real A[1, n] = ones(1, n);
  parameter Integer n = size(A, 1);
end M;

// Result:
// Error processing file: const7.mo
// Error: Failed to load package const7 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const7.mo not found in scope <top>.
// Error: Error occurred while flattening model const7.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
