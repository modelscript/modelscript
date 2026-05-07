// status: correct
// See ticket:4471

model TypeConnector
  type T
    extends String;
  end T;
  connector C = output T;
  C c;
end TypeConnector;

// Result:
// Error processing file: TypeConnector.mo
// Error: Failed to load package C (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class C not found in scope <top>.
// Error: Error occurred while flattening model C
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
