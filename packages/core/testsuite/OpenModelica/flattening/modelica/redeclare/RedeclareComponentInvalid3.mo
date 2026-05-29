// name:     RedeclareComponentInvalid3
// keywords: redeclare component
// status:   incorrect
//
// Tests that it's only allowed to redeclare a component marked as replaceable.
//

class C
  Real r;
end C;

class RedeclareComponentInvalid3
  extends C;

  redeclare Real r(start = 1.0);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end RedeclareComponentInvalid3;

// Result:
// class RedeclareComponentInvalid3
//   Real r(start = 1.0);
// end RedeclareComponentInvalid3;
// endResult
