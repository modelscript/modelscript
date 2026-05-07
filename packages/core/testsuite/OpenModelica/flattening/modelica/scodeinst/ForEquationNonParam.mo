// name: ForEquationNonPAram.mo
// keywords:
// status: incorrect
//
// Checks that the range of a for loop equation must be a parameter expression.
//

model ForEquationNonParam
  Real x[5];
  Real y = time;
equation
  for i in 1:y loop
    x[i] = i;
  end for;
end ForEquationNonParam;

// Result:
// Error processing file: ForEquationNonParam.mo
// [<interactive>:12:3-14:10:writable] Error: The iteration range 1.0:y is not a constant or parameter expression.
// Error: Error occurred while flattening model ForEquationNonParam
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
