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
// Error processing file: ForEquationShadow1.mo
// [OpenModelica/flattening/modelica/scodeinst/ForEquationShadow1.mo:9:3-13:10:writable] Notification: From here:
// [OpenModelica/flattening/modelica/scodeinst/ForEquationShadow1.mo:10:5-12:12:writable] Warning: An iterator named 'i' is already declared in this scope.
// Error: Class ForEquationShadow1.mo not found in scope <top>.
// Error: Error occurred while flattening model ForEquationShadow1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
