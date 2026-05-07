// name: RangeTypeError3.mo
// keywords:
// status: incorrect
//
//

model RangeTypeError3
  Real x[3] = "1":"3";
end RangeTypeError3;

// Result:
// Error processing file: RangeTypeError3.mo
// Error: Class RangeTypeError3.mo not found in scope <top>.
// Error: Error occurred while flattening model RangeTypeError3.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
