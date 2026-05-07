// name: ForEquation1.mo
// keywords:
// status: correct
//
//

model ForEquation1
  Real x[5];
equation
  for i in 1:5 loop
    x[i] = i;
  end for;
end ForEquation1;

// Result:
// Error processing file: ForEquation1.mo
// Error: Class ForEquation1.mo not found in scope <top>.
// Error: Error occurred while flattening model ForEquation1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
