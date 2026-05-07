// name:     DuplicateElementsExtends
// keywords: check if duplicate elements one from extends are equivalent!
// status:   incorrect


package Crap
  type X = Real;
  type Y = Real;
end Crap;

model Duplicate
 Crap.Y x;
end Duplicate;

model DuplicateElementsExtends
 extends Duplicate; // have another x
 import C=Crap;
 C.X x;
end DuplicateElementsExtends;

// Result:
// class DuplicateElementsExtends
//   Real x;
// end DuplicateElementsExtends;
// endResult
