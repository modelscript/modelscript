// name: RangeInvalidStep2.mo
// keywords:
// status: incorrect
//
// Check that a step size of 0 isn't allowed, since that would give an infinite
// range.
// 

model RangeInvalidStep2
  Real x[10] = 1:0.0:10;
end RangeInvalidStep2;

// Result:
// Error processing file: RangeInvalidStep2.mo
// Error: Class RangeInvalidStep2.mo not found in scope <top>.
// Error: Error occurred while flattening model RangeInvalidStep2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
