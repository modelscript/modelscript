// name:     BuiltinTimeInvalid2
// keywords: time builtin
// status:   incorrect
//
// Checks that time is not a valid component name.
//

model BuiltinTimeInvalid2
  Real time = 1.0;
end BuiltinTimeInvalid2;

// Result:
// class BuiltinTimeInvalid2
//   Real time = 1.0;
// end BuiltinTimeInvalid2;
// endResult
