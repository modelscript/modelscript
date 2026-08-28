// name: inst6.mo
// keywords:
// status: incorrect
//

model M
  package P end P;
  P p;
end M;

// Result:
// class M
// end M;
// endResult
