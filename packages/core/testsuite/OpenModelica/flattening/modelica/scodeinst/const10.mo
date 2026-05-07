// name: const10.mo
// keywords:
// status: correct
//

model A
  constant Integer i = 3;

  model B
    constant Integer j = i;
    Real x = j;
  end B;
end A;

model C
  A.B b;
end C;

// Result:
// Error processing file: const10.mo
// Error: Failed to load package const10 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const10.mo not found in scope <top>.
// Error: Error occurred while flattening model const10.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
