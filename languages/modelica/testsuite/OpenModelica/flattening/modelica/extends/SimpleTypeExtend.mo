// name: SimpleTypeExtend
// keywords: inheritance
// status: incorrect
//
// Tests to make sure you cannot extend built-in types and add components
// THIS TEST SHOULD FAIL
//

model SimpleTypeExtend
  extends Real;
  Real illegalReal;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end SimpleTypeExtend;

// Result:
// class SimpleTypeExtend
//   Real illegalReal;
// end SimpleTypeExtend;
// endResult
