// name:     ReplaceableBaseClass
// keywords: redeclare, replaceable, extends
// status:   incorrect
//
// Checks that the compiler gives an error if the base class in an extends
// clause is replaceable.
//

model M
  replaceable type T = Real;
  extends T;
end M;

model ReplaceableBaseClass
  M m(redeclare type T = Integer);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end ReplaceableBaseClass;

// Result:
// class ReplaceableBaseClass
// end ReplaceableBaseClass;
// endResult
