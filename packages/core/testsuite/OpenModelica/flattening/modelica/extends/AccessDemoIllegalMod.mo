// name:     AccessDemo Illegal Mod
// keywords: <insert keywords here>
// status:   correct
//
// Test the public and protected access keywords
// Drmodelica: 3.4 Access Control (p. 88)
//

class AccessDemo "Illustration of access prefixes"
      parameter Real a = 2;
  public   Real x, z;
      parameter Real y;
  protected
      parameter Real w, u;
      Real u2;
  public   Real u3;
equation
  x  = 2;  // Legal, since code inside the class
  z  = 5;  // Legal, since code inside the class
  u2 = 5;  // Legal, since code inside the class
  u3 = 8;    // Legal, since code inside the class
end AccessDemo;

class A
  AccessDemo ad(a = 2, y = 7, w = 7);
  // Illegal modifier of protected w, since AccessDemo is not inherited
end A;


// Result:
// class ExtendsModWithImport
//   parameter Real m.param = 1.0;
// end ExtendsModWithImport;
// endResult
