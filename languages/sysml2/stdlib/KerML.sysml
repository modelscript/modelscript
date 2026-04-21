/**
 * Minimal SysML v2 / KerML stubs needed for simulation.
 */
package ScalarValues {
    abstract def Real;
    abstract def Integer;
    abstract def Boolean;
    abstract def String;
}

package ISQ {
    import ScalarValues::*;
    abstract def Time :> Real;
    abstract def Mass :> Real;
    abstract def Length :> Real;
    abstract def ElectricCurrent :> Real;
    abstract def Voltage :> Real;
}
