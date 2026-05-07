// name: const8.mo
// keywords:
// status: correct
//


model M
  parameter Real A[i, j];
  parameter Integer i = size(A, 2);
  parameter Integer j = size(A, 1);
end M;

model M2
  parameter Real A[2, 3] = ones(2, 3);
  parameter Integer j = size(A, i);
  parameter Integer i = size(A, 1);
end M2;

// Result:
// Error processing file: const8.mo
// Error: Failed to load package const8 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const8.mo not found in scope <top>.
// Error: Error occurred while flattening model const8.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
