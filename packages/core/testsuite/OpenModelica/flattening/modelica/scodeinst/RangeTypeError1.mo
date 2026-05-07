// name: RangeTypeError1.mo
// keywords:
// status: incorrect
//
//

model RangeTypeError1
  type E = enumeration(one, two, three);
  Real x[3] = 1:"3";
end RangeTypeError1;

// Result:
// Error processing file: RangeTypeError1.mo
// Error: Class RangeTypeError1.mo not found in scope <top>.
// Error: Error occurred while flattening model RangeTypeError1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
