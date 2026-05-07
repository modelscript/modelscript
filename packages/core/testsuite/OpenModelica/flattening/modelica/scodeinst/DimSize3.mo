// name: DimSize3
// keywords:
// status: correct
//

function f
  input Real x[:, size(x, 1)];
end f;

model DimSize3
algorithm
  f({{1, 2}, {3, 4}});
end DimSize3;

// Result:
// class DimSize3
// end DimSize3;
// endResult
