// name:     PartialLookup1
// keywords: lookup partial redeclare
// status:   correct
//
// Checks that it's not allowed to look up a name in a partial class.
//

model PartialLookup1
  partial package P
    model A end A;
  end P;

  P.A a;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end PartialLookup1;

// Result:
// class PartialLookup1
// end PartialLookup1;
// endResult
