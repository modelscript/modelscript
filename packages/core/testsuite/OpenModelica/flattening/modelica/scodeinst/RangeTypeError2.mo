// name: RangeTypeError2.mo
// keywords:
// status: incorrect
//
//

model RangeTypeError2
  type E = enumeration(one, two, three);
  Real x[3] = 1:E.one:3;
end RangeTypeError2;

// Result:
// Error processing file: RangeTypeError2.mo
// Error: Class RangeTypeError2.mo not found in scope <top>.
// Error: Error occurred while flattening model RangeTypeError2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
