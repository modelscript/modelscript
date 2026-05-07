// name: conn9.mo
// keywords:
// status: correct
//

connector C
  Real e;
  Real f;
  Real s;
end C;

model A
  flow C c;
end A;

// Result:
// Error processing file: conn9.mo
// Error: Failed to load package conn9 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class conn9.mo not found in scope <top>.
// Error: Error occurred while flattening model conn9.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
