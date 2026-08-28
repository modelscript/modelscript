// name:     ArrayAlgebraFunc
// keywords: <insert keywords here>
// status:   correct
//
// MORE WORK HAS TO BE DONE ON THIS FILE!
// Drmodelica: 7.7 Built-in Functions (p. 225)
//

class ArrayAlgebraFunc
  Real transp1[2, 2] = transpose([1, 2; 3, 4]); // Gives [1, 2; 3, 4] of type Integer[2, 2]
  Real transp2[2, 2, 1] = transpose({{{1},{2}},{{3},{4}}}); // Gives {{{1},{2}},{{3},{4}}} of type Integer[2, 2, 1]
  Real out[2, 2] = outerProduct({2, 1}, {3, 2}); // Gives {{6, 4}, {3, 2}}
  Real symm[2, 2] = symmetric({{1, 2}, {3, 1}}); // Gives {{1, 2}, {2, 1}}
  Real c[3] = cross({1, 0, 0}, {0, 1, 0}); // Gives {0, 0, 1}
  Real s[3, 3] = skew({1, 2, 3}); // Gives {{0, -3, 2}, {3, 0, -1}, {-2, 1, 0}};
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end ArrayAlgebraFunc;

// insert expected flat file here. Can be done by issuing the command
// ./omc XXX.mo >> XXX.mo and then comment the inserted class.
//
// class <XXX>
// Real x;
// end <XXX>;

// Result:
// class ArrayAlgebraFunc
//   Real transp1[1,1];
//   Real transp1[1,2];
//   Real transp1[2,1];
//   Real transp1[2,2];
//   Real transp2[1,1,1];
//   Real transp2[1,2,1];
//   Real transp2[2,1,1];
//   Real transp2[2,2,1];
//   Real out[1,1];
//   Real out[1,2];
//   Real out[2,1];
//   Real out[2,2];
//   Real symm[1,1];
//   Real symm[1,2];
//   Real symm[2,1];
//   Real symm[2,2];
//   Real c[1];
//   Real c[2];
//   Real c[3];
//   Real s[1,1];
//   Real s[1,2];
//   Real s[1,3];
//   Real s[2,1];
//   Real s[2,2];
//   Real s[2,3];
//   Real s[3,1];
//   Real s[3,2];
//   Real s[3,3];
// equation
//   transp1 = {{1.0, 3.0}, {2.0, 4.0}};
//   transp2 = {{{1.0}, {3.0}}, {{2.0}, {4.0}}};
//   out = {{6.0, 4.0}, {3.0, 2.0}};
//   symm = {{1.0, 2.0}, {2.0, 1.0}};
//   c = {0.0, 0.0, 1.0};
//   s = {{0.0, -3.0, 2.0}, {3.0, 0.0, -1.0}, {-2.0, 1.0, 0.0}};
// end ArrayAlgebraFunc;
// endResult
