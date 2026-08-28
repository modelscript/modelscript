// name:     Connect3
// keywords: connect
// status:   incorrect
//
// Only connector variables can be connected.

model Connect3
  Real e1,e2;
  flow Real f1,f2;
equation
  connect(e1,e2);
  connect(f1,f2);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Connect3;

// Result:
// class Connect3
//   Real e1;
//   Real e2;
//   Real f1;
//   Real f2;
// equation
//   e1 = e2;
//   (-f1) + (-f2) = 0.0;
// end Connect3;
// endResult
