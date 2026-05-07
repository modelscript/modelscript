// name: WhenVariablity2
// keywords:
// status: incorrect
//

model WhenVariability2
  Real x;
algorithm
  when pre(x) > 1 then
  end when;
end WhenVariability2;

// Result:
// Error processing file: WhenVariability2.mo
// [<interactive>:9:3-10:11:writable] Error: Argument 1 of pre must be a discrete expression, but x is continuous.
// Error: Error occurred while flattening model WhenVariability2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
