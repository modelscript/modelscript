/**
 * SysML v2 / KerML standard library foundation.
 */
package ScalarValues {
    abstract attribute def Real;
    abstract attribute def Integer;
    abstract attribute def Boolean;
    abstract attribute def String;
    abstract attribute def Natural :> Integer;
    abstract attribute def Positive :> Integer;
}

package ISQ {
    import ScalarValues::*;

    /* SI Base Quantities */
    abstract attribute def Time :> Real;
    abstract attribute def Mass :> Real;
    abstract attribute def Length :> Real;
    abstract attribute def ElectricCurrent :> Real;
    abstract attribute def ThermodynamicTemperature :> Real;
    abstract attribute def AmountOfSubstance :> Real;
    abstract attribute def LuminousIntensity :> Real;

    /* SI Derived Quantities */
    abstract attribute def Area :> Real;
    abstract attribute def Volume :> Real;
    abstract attribute def Velocity :> Real;
    abstract attribute def Acceleration :> Real;
    abstract attribute def Force :> Real;
    abstract attribute def Pressure :> Real;
    abstract attribute def Energy :> Real;
    abstract attribute def Power :> Real;
    abstract attribute def Voltage :> Real;
    abstract attribute def ElectricResistance :> Real;
    abstract attribute def Frequency :> Real;
}

package SIBaseUnits {
    import ScalarValues::*;
    abstract attribute def Second :> Real;
    abstract attribute def Kilogram :> Real;
    abstract attribute def Metre :> Real;
    abstract attribute def Ampere :> Real;
    abstract attribute def Kelvin :> Real;
    abstract attribute def Mole :> Real;
    abstract attribute def Candela :> Real;
}

package SIDerivedUnits {
    import ScalarValues::*;
    abstract attribute def Newton :> Real;
    abstract attribute def Pascal :> Real;
    abstract attribute def Joule :> Real;
    abstract attribute def Watt :> Real;
    abstract attribute def Volt :> Real;
    abstract attribute def Ohm :> Real;
    abstract attribute def Hertz :> Real;
}

package Collections {
    abstract item def Collection;
    abstract item def List :> Collection;
    abstract item def Set :> Collection;
}

package Base {
    abstract item def Anything;
    abstract item def Element :> Anything;
    abstract item def Feature :> Element;
    abstract item def Type :> Element;
    abstract item def Classifier :> Type;
    abstract item def DataType :> Classifier;
    abstract item def Class :> Classifier;
    abstract item def Structure :> Class;
    abstract item def Behavior :> Class;
}

package Control {
    abstract action def ControlNode;
    abstract action def MergeNode :> ControlNode;
    abstract action def DecisionNode :> ControlNode;
    abstract action def ForkNode :> ControlNode;
    abstract action def JoinNode :> ControlNode;
}

package Transfers {
    abstract item def Transfer;
    abstract item def Flow :> Transfer;
    abstract item def Message :> Transfer;
}

package Performances {
    abstract action def Performance;
    abstract action def Evaluation :> Performance;
    abstract action def Execution :> Performance;
}

