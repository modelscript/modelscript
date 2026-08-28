// name:     ImportShadowing1
// keywords: import shadowing
// status:   correct
//
// Checks that a warning is displayed when imports are shadowed.
//

package P
  model M
    Real x;
  end M;
end P;

model ImportShadowing1
  import P.M;
  Real M;
end ImportShadowing1;

// Result:
// class ImportShadowing1
//   Real M;
// end ImportShadowing1;
// endResult
