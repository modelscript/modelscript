// name: ForEquation3.mo
// keywords:
// status: correct
//
//

model ForEquation3
  Real x[5];
equation
  for i in {1, 2, 3, 4, 5} loop
    x[i] = i;
  end for;
end ForEquation3;

// Result:
// Error processing file: ForEquation3.mo
// Error: Class ForEquation3.mo not found in scope <top>.
// Error: Error occurred while flattening model ForEquation3.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
