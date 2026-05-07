// name: ForEquationEnum2.mo
// keywords:
// status: correct
//
//

model ForEquationEnum2
  type E = enumeration(one, two, three);
  E x[E];
equation
  for i in E.one:E.three loop
    x[i] = i;
  end for;
end ForEquationEnum2;

// Result:
// Error processing file: ForEquationEnum2.mo
// Error: Class ForEquationEnum2.mo not found in scope <top>.
// Error: Error occurred while flattening model ForEquationEnum2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
