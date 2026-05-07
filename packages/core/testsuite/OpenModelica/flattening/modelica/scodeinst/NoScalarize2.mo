// name: NoScalarize2
// keywords:
// status: correct
//

model NoScalarize2
  model M
    Real p;
  end M;

  model Q
    M m[2];
  end Q;

  M m[2](each p = 2);
  Q q[3](m(each p = 2));
end NoScalarize2;

// Result:
// class NoScalarize2
//   Real m[1].p = 2.0;
//   Real m[2].p = 2.0;
//   Real q[1].m[1].p = 2.0;
//   Real q[1].m[2].p = 2.0;
//   Real q[2].m[1].p = 2.0;
//   Real q[2].m[2].p = 2.0;
//   Real q[3].m[1].p = 2.0;
//   Real q[3].m[2].p = 2.0;
// end NoScalarize2;
// endResult
