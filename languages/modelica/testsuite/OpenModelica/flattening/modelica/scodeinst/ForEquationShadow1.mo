// name: ForEquationShadow1.mo
// keywords:
// status: correct
//

model ForEquationShadow1
  Real x;
equation
  for i in 1:2 loop
    for i in 1:2 loop
      x = i + i;
    end for;
  end for;
end ForEquationShadow1;

// Result:
// class ForEquationShadow1
//   Real x;
// equation
//   x = 2.0;
//   x = 4.0;
//   x = 2.0;
//   x = 4.0;
// end ForEquationShadow1;
// endResult
