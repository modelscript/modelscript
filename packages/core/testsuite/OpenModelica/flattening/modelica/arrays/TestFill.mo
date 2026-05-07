// name:     TestFill.mo [BUG: https://trac.openmodelica.org/OpenModelica/ticket/2113]
// keywords: array fill
// status:   correct
//
// Test that fill has integer second argument but not necessary a parameter.
//


model test
  Real y[5];
  Integer n;

algorithm
  n := 0;
  y := fill(1, 5);
  n := n + 2;
  y[1:n] := fill(2, n);
end test;

// Result:
// class Array12
//   parameter Real a[1,1] = 2.0;
//   parameter Real a[1,2] = 1.0;
//   parameter Real a[2,1] = 1.2;
//   parameter Real a[2,2] = 2.3;
//   parameter Real b[1] = 1.0;
//   parameter Real b[2] = 2.4;
//   parameter Real b[3] = 5.0;
//   parameter Real c[1,1] = 1.0;
//   parameter Real c[1,2] = 3.0;
//   parameter Real c[2,1] = 4.0;
//   parameter Real c[2,2] = 5.2;
// end Array12;
// endResult
