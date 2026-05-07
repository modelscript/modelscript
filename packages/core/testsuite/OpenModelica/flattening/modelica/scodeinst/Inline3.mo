// name: Inline3
// keywords:
// status: correct
//

function f
  input Real x[3];
  input Real y[3];
  output Real z;
algorithm
  z := x * y;
  annotation(Inline = true);
end f;

model Inline3
  Real x = f({1, 2, 3}, {time, time, time});
end Inline3;

// Result:
// function f
//   input Real[3] x;
//   input Real[3] y;
//   output Real z;
// algorithm
//   z := x[1] * y[1] + x[2] * y[2] + x[3] * y[3];
// end f;
//
// class Inline3
//   Real x = f({1.0, 2.0, 3.0}, {time, time, time});
// end Inline3;
// endResult
