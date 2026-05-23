// name: TypeClass1
// keywords: type
// status: correct
//
// Tests type declaration from a legal class
//

class LegalClass
  extends Integer;
end LegalClass;

type LegalType = LegalClass;

model TypeClass1
  LegalType lt;
equation
  lt = 1;
end TypeClass1;

// Result:
// class TypeClass1
// equation
//   lt = 1;
// end TypeClass1;
// Info: Class 'LegalType' has no members
// endResult
