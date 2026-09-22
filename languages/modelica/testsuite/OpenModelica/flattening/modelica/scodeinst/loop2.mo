// name: loop2.mo
// keywords:
// status: correct
// xfail:    true
//


model A
  Real x = x + 1;
end A;

// Result:
// class A
//   Real x = x + 1.0;
// end A;
// endResult
