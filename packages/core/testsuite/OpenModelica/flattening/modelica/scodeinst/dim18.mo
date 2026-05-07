// name: dim18
// keywords:
// status: correct
//

model A
  parameter Integer m = 2;
  parameter Integer n = m;
  Real x[n];
end A;

// Result:
// Error processing file: dim18.mo
// Error: Failed to load package dim18 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class dim18 not found in scope <top>.
// Error: Error occurred while flattening model dim18
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
