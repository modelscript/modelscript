// name: const15.mo
// keywords:
// status: correct
//
//

model A
  model B
    constant Integer i = 3;
  end B;
end A;

model C
  extends A(B(i = 4));
  Real x = B.i;
end C;

// Result:
// Error processing file: const15.mo
// Error: Failed to load package const15 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const15.mo not found in scope <top>.
// Error: Error occurred while flattening model const15.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
