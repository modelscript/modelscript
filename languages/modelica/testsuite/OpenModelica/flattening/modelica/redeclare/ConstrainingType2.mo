// name:     ConstrainType2
// keywords: redeclare component constrainedby
// status:   incorrect
//
// Tests that the constraining class of a replaceable component is implicitly
// the type of the component if no constraining class is defined.
//

class C
  replaceable Real r;
end C;

class ConstrainType2
  extends C;

  redeclare Integer r;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end ConstrainType2;

// Result:
// class ConstrainType2
//   Integer r;
// end ConstrainType2;
// endResult
