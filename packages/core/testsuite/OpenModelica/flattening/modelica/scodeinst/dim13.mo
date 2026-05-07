// name: dim13
// keywords:
// status: correct
//


model A
  parameter Integer n = 3;
end A;

model B
  extends A;
  parameter Real x[n] = ones(n);
end B;

// Result:
// Error processing file: dim13.mo
// Error: Failed to load package dim13 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class dim13 not found in scope <top>.
// Error: Error occurred while flattening model dim13
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
