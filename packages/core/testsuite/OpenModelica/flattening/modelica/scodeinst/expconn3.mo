// name: expconn3.mo
// keywords:
// status: correct
//
// FAILREASON: Expandable connectors not handled yet.
//

expandable connector EC
end EC;

connector RealInput = input Real;

model M
  EC ec;
  RealInput ri;
equation
  connect(ec.ri, ri);
end M;

// Result:
// class M
//   Real ec.ri "virtual variable in expandable connector";
//   input Real ri;
// equation
//   ec.ri = ri;
// end M;
// endResult
