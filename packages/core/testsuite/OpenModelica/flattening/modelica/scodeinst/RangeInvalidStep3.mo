// name: RangeInvalidStep3.mo
// keywords:
// status: incorrect
//
// Checks that an enumeration range isn't allowed to have a step size.
// 

model RangeInvalidStep3
  type E = enumeration(one, two, three);
  E x[3] = E.one:E.one:E.three;
end RangeInvalidStep3;

// Result:
// Error processing file: RangeInvalidStep3.mo
// Error: Class RangeInvalidStep3.mo not found in scope <top>.
// Error: Error occurred while flattening model RangeInvalidStep3.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
