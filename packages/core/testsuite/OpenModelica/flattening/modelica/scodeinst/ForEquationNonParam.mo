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
// Error: Failed to load package ForEquationNonPAram (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ForEquationNonPAram.mo not found in scope <top>.
// Error: Error occurred while flattening model ForEquationNonPAram.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
