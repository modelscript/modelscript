// name:     DoubleClassDeclaration1.mo
// status:   incorrect
//
// Checks that duplicate top-level classes are detected.
//

model M
end M;

model M
end M;

// Result:
// class M
// end M;
// endResult
