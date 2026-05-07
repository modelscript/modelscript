// name: ForEquationEnum1.mo
// keywords:
// status: correct
//
//

model ForEquationEnum1
  type E = enumeration(one, two, three);
  E x[E];
equation
  for i in E loop
    x[i] = i;
  end for;
end ForEquationEnum1;

// Result:
// Error processing file: ForEquationEnum1.mo
// Error: Class ForEquationEnum1.mo not found in scope <top>.
// Error: Error occurred while flattening model ForEquationEnum1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
