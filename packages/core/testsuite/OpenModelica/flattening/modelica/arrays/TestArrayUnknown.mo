// name:     TestArrayUnknown.mo
// keywords: structural parameter giving array dimensions with no binding
// status:   incorrect
//
// Test we fail for a structural parameter with no binding.
//

model TestArrayUnknown
  parameter Integer p;
  model X
    Real x;
  end X;
  X blah[p];
equation
  blah.x = fill(0, p);
end TestArrayUnknown;

// Result:
// Error processing file: TestArrayUnknown.mo
// Error: Class TestArrayUnknown.mo not found in scope <top>.
// Error: Error occurred while flattening model TestArrayUnknown.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
