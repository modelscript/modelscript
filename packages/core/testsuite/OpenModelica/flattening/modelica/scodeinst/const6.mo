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
// [<interactive>:10:3-10:25:writable] Error: Component j of variability constant has binding 'x' of higher variability parameter.
// Error: Error occurred while flattening model M
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
