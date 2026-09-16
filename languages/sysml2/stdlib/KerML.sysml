/**
 * Minimal SysML v2 / KerML stubs needed for simulation.
 */
package ScalarValues {
    abstract attribute def Real;
    abstract attribute def Integer;
    abstract attribute def Boolean;
    abstract attribute def String;
}

package ISQ {
    import ScalarValues::*;
    abstract attribute def Time :> Real;
    abstract attribute def Mass :> Real;
    abstract attribute def Length :> Real;
    abstract attribute def ElectricCurrent :> Real;
    abstract attribute def Voltage :> Real;
}
