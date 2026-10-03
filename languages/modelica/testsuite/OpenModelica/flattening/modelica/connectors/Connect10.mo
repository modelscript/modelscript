// name:     Connect10
// keywords: connect
// status:   incorrect
//
// Testing of input/output flags
//

connector C1
  input Real x;
end C1;

connector C2
  input Real x;
end C2;

class Connect10
  C1 c1;
  C2 c2;
equation
  connect(c1,c2);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Connect10;

// Result:
// class Connect10
//   input Real c1.x;
//   input Real c2.x;
// equation
//   c1.x = c2.x;
// end Connect10;
// endResult
