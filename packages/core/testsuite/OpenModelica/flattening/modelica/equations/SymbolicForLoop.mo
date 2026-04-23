// name: SymbolicForLoop
// status: correct
// arrayMode: preserve

model SymbolicForLoop
  parameter Integer n = 1000;
  Real x[n];
  Real y[n];

equation
  for i in 1:n loop
    annotation(PreserveArray=true);
    x[i] = i * 2.0;
    y[i] = x[i] + 1.0;
  end for;
end SymbolicForLoop;

// Result:
// end Result;
