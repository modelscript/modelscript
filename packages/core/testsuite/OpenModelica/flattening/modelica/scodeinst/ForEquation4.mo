// name: ForEquation4.mo
// keywords:
// status: correct
//
//

model ForEquation4
  constant Integer N = 4;
  Real x[N];
equation
  for i in 1:N loop
    x[i] = i;
  end for;
end ForEquation4;

// Result:
// Error processing file: ForEquation4.mo
// Error: Class ForEquation4.mo not found in scope <top>.
// Error: Error occurred while flattening model ForEquation4.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
