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
// [<interactive>:9:3-13:10:writable] Notification: From here:
// [<interactive>:10:5-12:12:writable] Warning: An iterator named 'i' is already declared in this scope.
// endResult
