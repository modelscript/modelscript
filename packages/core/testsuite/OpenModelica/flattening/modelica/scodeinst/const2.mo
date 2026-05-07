// name: const2.mo
// keywords:
// status: correct
//


model A
  package P
    constant Integer i = 2;
  end P;

  Real x[P.i];
end A;

// Result:
// Error processing file: const2.mo
// Error: Failed to load package const2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const2.mo not found in scope <top>.
// Error: Error occurred while flattening model const2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
