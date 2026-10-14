/**
 * SysML v2 / KerML standard library foundation.
 * Expanded comprehensive standard library snapshot:
 * - ScalarValues, Collections, Links, Occurrences
 * - Base, CoreTypes, Control, Transfers, Performances
 * - ISO/IEC 80000 International System of Quantities (ISQ)
 * - SI Base Units, SI Derived Units, SI Prefixes and Unit Symbols
 * - US Customary & Imperial Units
 * - CauseAndEffect (Safety, Hazards, Faults, Mitigations)
 * - SpatialFrames (Coordinate Frames, Points, Transforms)
 * - StateMachines (States, Transitions, Guards, Actions)
 */

package ScalarValues {
    abstract attribute def Real;
    abstract attribute def Integer;
    abstract attribute def Boolean;
    abstract attribute def String;
    abstract attribute def Natural :> Integer;
    abstract attribute def Positive :> Integer;
    abstract attribute def UnlimitedNatural :> Natural;
    abstract attribute def Complex;
    abstract attribute def Rational;
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
    abstract item def Occurrence :> Class;
    abstract item def Life :> Occurrence;
    abstract item def Snapshot :> Occurrence;
    abstract item def Link :> Relationship;
    abstract item def Relationship :> Element;
    abstract item def Association :> Classifier;
    abstract item def Connector :> Feature;
    abstract item def Interface :> Feature;
    abstract item def Metadata :> Feature;
}

package CoreTypes {
    import Base::*;

    abstract part def Part :> Structure;
    abstract item def Item :> Structure;
    abstract port def Port :> Feature;
    abstract action def Action :> Behavior;
    abstract state def State :> Behavior;
    abstract constraint def Constraint :> Behavior;
    abstract calc def Calculation :> Behavior;
    abstract requirement def Requirement :> Constraint;
}

package Collections {
    import Base::*;

    abstract item def Collection;
    abstract item def List :> Collection;
    abstract item def Set :> Collection;
    abstract item def Bag :> Collection;
    abstract item def Array :> Collection;
    abstract item def Map :> Collection;
}

package Control {
    abstract action def ControlNode;
    abstract action def MergeNode :> ControlNode;
    abstract action def DecisionNode :> ControlNode;
    abstract action def ForkNode :> ControlNode;
    abstract action def JoinNode :> ControlNode;
}

package Transfers {
    import Base::*;

    abstract item def Transfer;
    abstract item def Flow :> Transfer;
    abstract item def Message :> Transfer;
}

package Performances {
    abstract action def Performance;
    abstract action def Evaluation :> Performance;
    abstract action def Execution :> Performance;
}

package ISQ {
    import ScalarValues::*;

    /* ── ISO/IEC 80000-3 Space and Time ── */
    abstract attribute def Time :> Real;
    abstract attribute def Duration :> Time;
    abstract attribute def Period :> Time;
    abstract attribute def Length :> Real;
    abstract attribute def Width :> Length;
    abstract attribute def Height :> Length;
    abstract attribute def Distance :> Length;
    abstract attribute def Position :> Length;
    abstract attribute def Displacement :> Length;
    abstract attribute def Radius :> Length;
    abstract attribute def Diameter :> Length;
    abstract attribute def Thickness :> Length;
    abstract attribute def Area :> Real;
    abstract attribute def Volume :> Real;
    abstract attribute def Angle :> Real;
    abstract attribute def SolidAngle :> Real;
    abstract attribute def Velocity :> Real;
    abstract attribute def LinearVelocity :> Velocity;
    abstract attribute def Speed :> Velocity;
    abstract attribute def AngularVelocity :> Real;
    abstract attribute def Acceleration :> Real;
    abstract attribute def LinearAcceleration :> Acceleration;
    abstract attribute def AngularAcceleration :> Real;
    abstract attribute def GravitationalAcceleration :> Acceleration;
    abstract attribute def Frequency :> Real;
    abstract attribute def RotationalFrequency :> Frequency;

    /* ── ISO/IEC 80000-4 Mechanics ── */
    abstract attribute def Mass :> Real;
    abstract attribute def MassDensity :> Real;
    abstract attribute def SpecificVolume :> Real;
    abstract attribute def Momentum :> Real;
    abstract attribute def AngularMomentum :> Real;
    abstract attribute def MomentOfInertia :> Real;
    abstract attribute def Force :> Real;
    abstract attribute def Weight :> Force;
    abstract attribute def Torque :> Real;
    abstract attribute def MomentOfForce :> Torque;
    abstract attribute def Pressure :> Real;
    abstract attribute def Stress :> Pressure;
    abstract attribute def NormalStress :> Stress;
    abstract attribute def ShearStress :> Stress;
    abstract attribute def Strain :> Real;
    abstract attribute def Work :> Real;
    abstract attribute def Energy :> Real;
    abstract attribute def KineticEnergy :> Energy;
    abstract attribute def PotentialEnergy :> Energy;
    abstract attribute def Power :> Real;
    abstract attribute def Efficiency :> Real;

    /* ── Fluid Dynamics ── */
    abstract attribute def DynamicViscosity :> Real;
    abstract attribute def KinematicViscosity :> Real;
    abstract attribute def SurfaceTension :> Real;
    abstract attribute def VolumeFlowRate :> Real;
    abstract attribute def MassFlowRate :> Real;
    abstract attribute def ReynoldsNumber :> Real;
    abstract attribute def MachNumber :> Real;

    /* ── ISO/IEC 80000-5 Thermodynamics ── */
    abstract attribute def ThermodynamicTemperature :> Real;
    abstract attribute def CelsiusTemperature :> Real;
    abstract attribute def Heat :> Energy;
    abstract attribute def HeatFlowRate :> Power;
    abstract attribute def ThermalConductivity :> Real;
    abstract attribute def HeatCapacity :> Real;
    abstract attribute def SpecificHeatCapacity :> Real;
    abstract attribute def Entropy :> Real;
    abstract attribute def Enthalpy :> Energy;
    abstract attribute def InternalEnergy :> Energy;

    /* ── ISO/IEC 80000-6 Electromagnetism ── */
    abstract attribute def ElectricCurrent :> Real;
    abstract attribute def ElectricCharge :> Real;
    abstract attribute def Voltage :> Real;
    abstract attribute def ElectricPotential :> Voltage;
    abstract attribute def ElectromotiveForce :> Voltage;
    abstract attribute def ElectricFieldStrength :> Real;
    abstract attribute def ElectricFlux :> Real;
    abstract attribute def ElectricResistance :> Real;
    abstract attribute def Conductance :> Real;
    abstract attribute def Resistivity :> Real;
    abstract attribute def Conductivity :> Real;
    abstract attribute def Capacitance :> Real;
    abstract attribute def Permittivity :> Real;
    abstract attribute def MagneticFlux :> Real;
    abstract attribute def MagneticFluxDensity :> Real;
    abstract attribute def MagneticFieldStrength :> Real;
    abstract attribute def Permeability :> Real;
    abstract attribute def Inductance :> Real;
    abstract attribute def Impedance :> Real;
    abstract attribute def Reactance :> Real;

    /* ── ISO/IEC 80000-7/9 Light and Chemistry ── */
    abstract attribute def AmountOfSubstance :> Real;
    abstract attribute def MolarMass :> Real;
    abstract attribute def LuminousIntensity :> Real;
    abstract attribute def LuminousFlux :> Real;
    abstract attribute def Illuminance :> Real;
    abstract attribute def Luminance :> Real;
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
    abstract attribute def Coulomb :> Real;
    abstract attribute def Ohm :> Real;
    abstract attribute def Siemens :> Real;
    abstract attribute def Farad :> Real;
    abstract attribute def Henry :> Real;
    abstract attribute def Weber :> Real;
    abstract attribute def Tesla :> Real;
    abstract attribute def Hertz :> Real;
    abstract attribute def Radian :> Real;
    abstract attribute def Steradian :> Real;
    abstract attribute def Lumen :> Real;
    abstract attribute def Lux :> Real;
    abstract attribute def Becquerel :> Real;
    abstract attribute def Gray :> Real;
    abstract attribute def Sievert :> Real;
    abstract attribute def Katal :> Real;
    abstract attribute def DegreeCelsius :> Real;
}

package SI {
    import ScalarValues::*;
    import SIBaseUnits::*;
    import SIDerivedUnits::*;

    /* Base Unit Symbols */
    abstract attribute def s :> Second;
    abstract attribute def kg :> Kilogram;
    abstract attribute def m :> Metre;
    abstract attribute def A :> Ampere;
    abstract attribute def K :> Kelvin;
    abstract attribute def mol :> Mole;
    abstract attribute def cd :> Candela;

    /* Scaled and Derived Unit Symbols */
    abstract attribute def g :> Real;
    abstract attribute def mg :> Real;
    abstract attribute def mm :> Real;
    abstract attribute def cm :> Real;
    abstract attribute def km :> Real;
    abstract attribute def N :> Newton;
    abstract attribute def kN :> Real;
    abstract attribute def Pa :> Pascal;
    abstract attribute def kPa :> Real;
    abstract attribute def MPa :> Real;
    abstract attribute def bar :> Real;
    abstract attribute def J :> Joule;
    abstract attribute def kJ :> Real;
    abstract attribute def MJ :> Real;
    abstract attribute def W :> Watt;
    abstract attribute def kW :> Real;
    abstract attribute def MW :> Real;
    abstract attribute def V :> Volt;
    abstract attribute def mV :> Real;
    abstract attribute def kV :> Real;
    abstract attribute def C :> Coulomb;
    abstract attribute def ohm :> Ohm;
    abstract attribute def kOhm :> Real;
    abstract attribute def MOhm :> Real;
    abstract attribute def F :> Farad;
    abstract attribute def uF :> Real;
    abstract attribute def nF :> Real;
    abstract attribute def pF :> Real;
    abstract attribute def H :> Henry;
    abstract attribute def mH :> Real;
    abstract attribute def uH :> Real;
    abstract attribute def Hz :> Hertz;
    abstract attribute def kHz :> Real;
    abstract attribute def MHz :> Real;
    abstract attribute def GHz :> Real;
    abstract attribute def rad :> Radian;
    abstract attribute def sr :> Steradian;
    abstract attribute def kat :> Katal;
    abstract attribute def deg :> Real;
    abstract attribute def degC :> DegreeCelsius;

    /* Scaled Full Unit Names */
    abstract attribute def Millimetre :> Metre;
    abstract attribute def Centimetre :> Metre;
    abstract attribute def Kilometre :> Metre;
    abstract attribute def Gram :> Real;
    abstract attribute def Milligram :> Real;
    abstract attribute def Millisecond :> Second;
    abstract attribute def Minute :> Real;
    abstract attribute def Hour :> Real;
    abstract attribute def Day :> Real;
    abstract attribute def Kilowatt :> Watt;
    abstract attribute def Megawatt :> Watt;
    abstract attribute def Kilojoule :> Joule;
    abstract attribute def Megajoule :> Joule;
    abstract attribute def Kilopascal :> Pascal;
    abstract attribute def Megapascal :> Pascal;
    abstract attribute def Bar :> Real;
    abstract attribute def Litre :> Real;
    abstract attribute def Millilitre :> Real;

    /* Prefixes */
    abstract attribute def Yotta :> Real;
    abstract attribute def Zetta :> Real;
    abstract attribute def Exa :> Real;
    abstract attribute def Peta :> Real;
    abstract attribute def Tera :> Real;
    abstract attribute def Giga :> Real;
    abstract attribute def Mega :> Real;
    abstract attribute def Kilo :> Real;
    abstract attribute def Hecto :> Real;
    abstract attribute def Deca :> Real;
    abstract attribute def Deci :> Real;
    abstract attribute def Centi :> Real;
    abstract attribute def Milli :> Real;
    abstract attribute def Micro :> Real;
    abstract attribute def Nano :> Real;
    abstract attribute def Pico :> Real;
    abstract attribute def Femto :> Real;
    abstract attribute def Atto :> Real;

    abstract attribute def kilo :> Kilo;
    abstract attribute def mega :> Mega;
    abstract attribute def giga :> Giga;
    abstract attribute def milli :> Milli;
    abstract attribute def micro :> Micro;
    abstract attribute def nano :> Nano;
    abstract attribute def pico :> Pico;
}

package USCustomaryUnits {
    import ScalarValues::*;

    /* Length & Area */
    abstract attribute def Inch :> Real;
    abstract attribute def Foot :> Real;
    abstract attribute def Yard :> Real;
    abstract attribute def Mile :> Real;
    abstract attribute def NauticalMile :> Real;
    abstract attribute def SquareFoot :> Real;
    abstract attribute def Acre :> Real;

    abstract attribute def inch :> Inch;
    abstract attribute def ft :> Foot;
    abstract attribute def yd :> Yard;
    abstract attribute def mi :> Mile;

    /* Mass and Force */
    abstract attribute def Ounce :> Real;
    abstract attribute def Pound :> Real;
    abstract attribute def PoundMass :> Pound;
    abstract attribute def PoundForce :> Real;
    abstract attribute def Slug :> Real;
    abstract attribute def Ton :> Real;

    abstract attribute def oz :> Ounce;
    abstract attribute def lb :> Pound;
    abstract attribute def lbf :> PoundForce;

    /* Volume */
    abstract attribute def Gallon :> Real;
    abstract attribute def Quart :> Real;
    abstract attribute def Pint :> Real;
    abstract attribute def Cup :> Real;
    abstract attribute def FluidOunce :> Real;
    abstract attribute def gal :> Gallon;

    /* Pressure */
    abstract attribute def PoundPerSquareInch :> Real;
    abstract attribute def psi :> PoundPerSquareInch;
    abstract attribute def ksi :> Real;

    /* Energy, Power & Speed */
    abstract attribute def BritishThermalUnit :> Real;
    abstract attribute def Btu :> BritishThermalUnit;
    abstract attribute def FootPound :> Real;
    abstract attribute def Horsepower :> Real;
    abstract attribute def hp :> Horsepower;
    abstract attribute def MilePerHour :> Real;
    abstract attribute def mph :> MilePerHour;

    /* Temperature */
    abstract attribute def DegreeFahrenheit :> Real;
    abstract attribute def degF :> DegreeFahrenheit;
    abstract attribute def Rankine :> Real;
}

package CauseAndEffect {
    import Base::*;
    import CoreTypes::*;

    abstract item def Cause;
    abstract item def Effect;
    abstract item def Causation :> Relationship;
    abstract item def CausalConnection :> Relationship;
    abstract item def Hazard :> Classifier;
    abstract item def FailureMode :> Classifier;
    abstract item def Fault :> Classifier;
    abstract item def HazardousEvent;
    abstract item def Risk;
    abstract item def HazardousState;
    abstract item def Mitigation;
    abstract item def SafetyCase;
    abstract item def SafetyRequirement :> Requirement;
}

package SpatialFrames {
    import Base::*;
    import ScalarValues::*;

    abstract item def SpatialFrame;
    abstract item def WorldFrame :> SpatialFrame;
    abstract item def CoordinateFrame :> SpatialFrame;
    abstract item def CartesianFrame :> CoordinateFrame;
    abstract item def Cartesian3DFrame :> CartesianFrame;
    abstract item def Cartesian2DFrame :> CartesianFrame;
    abstract item def CylindricalFrame :> CoordinateFrame;
    abstract item def SphericalFrame :> CoordinateFrame;

    abstract attribute def PositionVector;
    abstract attribute def OrientationVector;
    abstract attribute def Orientation;
    abstract attribute def DisplacementVector;
    abstract attribute def RotationMatrix;
    abstract attribute def Quaternion;
    abstract attribute def Transform;
    abstract attribute def Transform3D :> Transform;
    abstract attribute def Point3D;
}

package StateMachines {
    import Base::*;
    import CoreTypes::*;

    abstract state def StateDefinition :> State;
    abstract item def Transition;
    abstract item def Trigger;
    abstract item def Guard;
    abstract action def EntryAction :> Action;
    abstract action def ExitAction :> Action;
    abstract action def DoAction :> Action;
}
