// name: ProtectedMod4
// keywords:
// status: incorrect
//
//

model A
  protected Real x = 1.0;
end A;

model B = A;

model ProtectedMod4
  B b(x = 1.0);
end ProtectedMod4;

// Result:
// class ProtectedMod4
//   protected Real b.x = 1.0;
// end ProtectedMod4;
// endResult
