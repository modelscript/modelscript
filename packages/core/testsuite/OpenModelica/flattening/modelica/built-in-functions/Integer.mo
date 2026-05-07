// name: Integer
// keywords: integer
// status: correct
//
// Tests the built-in integer function
//

model IntegerTest
  Real r;
equation
  r = integer(4.5);
end IntegerTest;

// Result:
// class Scalar
//   Real r1 = 3.0;
//   Real r2 = 4.0;
//   Real r3 = 5.0;
//   Real r4 = 6.0;
//   Real r5 = 3.0;
// end Scalar;
// endResult
