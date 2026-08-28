// name:     ConcatArr4
// keywords: <insert keywords here>
// status:   correct
//
// MORE WORK HAS TO BE DONE ON THIS FILE!
//

class ConcatArr4
  Real[1, 1, 1] A = {{{1}}};
  Real[1, 1, 2] B = {{{2, 3}}};
  Real[1, 1, 3] C = {{{4, 5, 6}}};
  Real[1, 1, 6] R = cat(3, A, B, C); // Result value: {{{1, 2, 3, 4, 5, 6}}};
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end ConcatArr4;

// insert expected flat file here. Can be done by issuing the command
// ./omc XXX.mo >> XXX.mo and then comment the inserted class.
//
// class <XXX>
// Real x;
// end <XXX>;

// Result:
// class ConcatArr4
//   Real A[1,1,1];
//   Real B[1,1,1];
//   Real B[1,1,2];
//   Real C[1,1,1];
//   Real C[1,1,2];
//   Real C[1,1,3];
//   Real R[1,1,1];
//   Real R[1,1,2];
//   Real R[1,1,3];
//   Real R[1,1,4];
//   Real R[1,1,5];
//   Real R[1,1,6];
// equation
//   A = {{{1.0}}};
//   B = {{{2.0, 3.0}}};
//   C = {{{4.0, 5.0, 6.0}}};
//   R = {{{A[1,1,1], B[1,1,1], B[1,1,2], C[1,1,1], C[1,1,2], C[1,1,3]}}};
// end ConcatArr4;
// endResult
