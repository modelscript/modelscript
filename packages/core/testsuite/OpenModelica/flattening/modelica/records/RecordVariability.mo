// name:     Record Variability
// keywords: record
// status:   correct

record abcRec
  Integer a;
  parameter Integer b = 2;
  constant Integer c = 3;
end abcRec;

model example
  constant  Integer p = 13;
  constant  abcRec x = abcRec(1);
  parameter abcRec y = abcRec(4,p*2);
            abcRec z = abcRec(2,p);
end example;

// Result:
// class RecordConstant3
//   constant Real r2 = 2.0;
// end RecordConstant3;
// endResult
