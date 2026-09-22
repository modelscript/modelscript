// name: CondDeclaration
// keywords: conditional, declaration
// status: correct
// xfail:    true
//
// Tests conditional declaration of components
//

model CondDeclaration
  Real r1 if true;
  Real r2 if false;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end CondDeclaration;

// Result:
// class CondDeclaration
//   Real r1;
// end CondDeclaration;
// endResult
