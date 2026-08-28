// name:     ConcatArr1
// keywords: <insert keywords here>
// status:   correct
//
// MORE WORK HAS TO BE DONE ON THIS FILE!
// Drmodelica: 7.3 General Array concatenation (p. 213)
//

class ConcatArr1
  Real[5] c1 = cat(1, {1, 2}, {10, 12, 13}); // Result: {1, 2, 10, 12, 13}
  Real[2, 3] c2 = cat(2, {{1, 2}, {3, 4}}, {{10}, {11}}); // Result: {{1, 2, 10}, {3, 4, 11}}
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end ConcatArr1;

// insert expected flat file here. Can be done by issuing the command
// ./omc XXX.mo >> XXX.mo and then comment the inserted class.
//
// class <XXX>
// Real x;
// end <XXX>;

// Result:
// class ConcatArr1
//   Real c1[1];
//   Real c1[2];
//   Real c1[3];
//   Real c1[4];
//   Real c1[5];
//   Real c2[1,1];
//   Real c2[1,2];
//   Real c2[1,3];
//   Real c2[2,1];
//   Real c2[2,2];
//   Real c2[2,3];
// equation
//   c1 = {1.0, 2.0, 10.0, 12.0, 13.0};
//   c2 = {{1.0, 2.0, 10.0}, {3.0, 4.0, 11.0}};
// end ConcatArr1;
// endResult
