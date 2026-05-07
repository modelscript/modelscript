// name: RangeInvalidStep1.mo
// keywords:
// status: incorrect
//
// Check that a step size of 0 isn't allowed, since that would give an infinite
// range.
// 

model RangeInvalidStep1
  Real x[10] = 1:0:10;
end RangeInvalidStep1;

// Result:
// Error processing file: RangeInvalidStep1.mo
// Error: Class RangeInvalidStep1.mo not found in scope <top>.
// Error: Error occurred while flattening model RangeInvalidStep1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
