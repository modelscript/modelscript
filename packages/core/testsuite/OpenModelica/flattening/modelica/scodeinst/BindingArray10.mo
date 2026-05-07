// name: BindingArray10
// keywords:
// status: correct
//

model BindingArray10
  Real x[:] = ones(3);
end BindingArray10;

// Result:
// class BindingArray10
//   Real x[1];
//   Real x[2];
//   Real x[3];
// equation
//   x = {1.0, 1.0, 1.0};
// end BindingArray10;
// endResult
