// name: const6.mo
// keywords:
// status: incorrect
//
//


model M
  constant Integer i = 3;
  constant Integer j = x;
  parameter Integer x = i;
end M;

// Result:
// Error processing file: const6.mo
// Error: Failed to load package const6 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const6.mo not found in scope <top>.
// Error: Error occurred while flattening model const6.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
