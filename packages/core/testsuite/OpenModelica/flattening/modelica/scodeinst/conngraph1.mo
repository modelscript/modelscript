// name: conngraph1.mo
// keywords:
// status: incorrect
//

model A
  connector RealInput = input Real;

  RealInput ri;
equation
  Connections.root(ri);
end A;

// Result:
// Error processing file: conngraph1.mo
// Error: Failed to load package conngraph1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class conngraph1.mo not found in scope <top>.
// Error: Error occurred while flattening model conngraph1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
