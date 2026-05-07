// name: const4.mo
// keywords:
// status: correct
//


model P
  constant Real i = 3;
end P;

model A
  P p[2](i = {1, 2});
  Real x[2] = p.i;
end A;

// Result:
// Error processing file: const4.mo
// Error: Failed to load package const4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const4.mo not found in scope <top>.
// Error: Error occurred while flattening model const4.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
