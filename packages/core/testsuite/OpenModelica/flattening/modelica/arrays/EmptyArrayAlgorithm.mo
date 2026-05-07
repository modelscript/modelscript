// name:     EmptyArrayAlgorithm.mo [BUG: #2300]
// keywords: Empty arrays used in algorithm
// status:   correct
//
// Empty arrays used in algorithm
//

model EmptyArrayAlgorithm
  parameter Integer N = 0;
  Real r1[N];
  Real r2[N];
equation
  r1 = fill(1.0, N);
algorithm
  r2 := r1;
end EmptyArrayAlgorithm;


// Result:
// class ArraySizeFromFunc
//   final parameter Integer n = 5;
//   parameter Real x[1] = 1.0;
//   parameter Real x[2] = 1.0;
//   parameter Real x[3] = 1.0;
//   parameter Real x[4] = 1.0;
//   parameter Real x[5] = 1.0;
// end ArraySizeFromFunc;
// endResult
