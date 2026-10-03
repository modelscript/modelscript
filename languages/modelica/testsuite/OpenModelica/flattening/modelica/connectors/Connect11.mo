// name:     Connect11
// keywords: connect
// status:   incorrect
//
// Testing of input/output flags
//

connector C1
  output Real x;
end C1;

connector C2
  output Real x;
end C2;

class Connect11
  C1 c1;
  C2 c2;
equation
  connect(c1,c2);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Connect11;

// Result:
// class Connect11
//   output Real c1.x;
//   output Real c2.x;
// equation
//   c1.x = c2.x;
// end Connect11;
// endResult
