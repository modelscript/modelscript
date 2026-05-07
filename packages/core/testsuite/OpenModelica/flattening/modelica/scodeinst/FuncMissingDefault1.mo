// name: FuncMissingDefault1
// keywords:
// status: incorrect
//
// Checks that missing default arguments are detected.
// 

function f
  input Real x;
  input Real y;
  output Real z = x + y;
end f;

model M
  Real x = f(1.0);
end M;

// Result:
// Error processing file: FuncMissingDefault1.mo
// Error: Failed to load package FuncMissingDefault1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class FuncMissingDefault1 not found in scope <top>.
// Error: Error occurred while flattening model FuncMissingDefault1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
