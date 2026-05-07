// name: eq10.mo
// keywords:
// status: correct
//
//

model A
  model B
    Integer ba;
  end B;

  B aa;
equation
  aa.ba = 1;
end A;

// Result:
// Error processing file: eq10.mo
// Error: Failed to load package eq10 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class eq10.mo not found in scope <top>.
// Error: Error occurred while flattening model eq10.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
