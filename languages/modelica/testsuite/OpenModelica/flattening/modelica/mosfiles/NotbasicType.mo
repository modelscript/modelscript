model BaseProperties
  parameter Integer a;
  parameter Integer b = 1;
end BaseProperties;

model BP
  extends BaseProperties(a = b);
  parameter Integer b = 1;
end BP;

// Result:
// class BP
//   parameter Integer a = b;
//   parameter Integer b = 1;
// end BP;
// endResult
