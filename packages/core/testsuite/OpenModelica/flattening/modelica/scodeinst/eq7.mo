// name: eq7.mo
// keywords:
// status: correct
//

model A
  Real x, y;
equation
  y = x;
end A;

model B
  A a[3](x = {1, 2, 3});
end B;
// Result:
// Error processing file: eq7.mo
// Error: Failed to load package eq7 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class eq7.mo not found in scope <top>.
// Error: Error occurred while flattening model eq7.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
