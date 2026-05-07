// name: dim8.mo
// keywords:
// status: incorrect
//

model M
  Integer x;
  Real y[x];
end M;

// Result:
// Error processing file: dim8.mo
// [<interactive>:8:3-8:12:writable] Error: Dimensions must be parameter or constant expression (in x).
// Error: Error occurred while flattening model M
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
