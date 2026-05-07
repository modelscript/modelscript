// name: ForEquation5.mo
// keywords:
// status: correct
//
//

model ForEquation5
  constant Integer N = 4;
  Real x[N];
equation
  for i in 1:N-1 loop
    x[i] = i;
  end for;
  x[4] = 0;
end ForEquation5;

// Result:
// Error processing file: ForEquation5.mo
// Error: Class ForEquation5.mo not found in scope <top>.
// Error: Error occurred while flattening model ForEquation5.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
