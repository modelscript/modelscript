/**
 * OMG Systems Modeling Language (SysML v2) Normative Systems Library
 * Version: 2026.3.0
 */

package SysML {
    doc /* The normative OMG Systems Modeling Language (SysML v2) root library package, importing foundational Kernel Modeling Language (KerML) types, physical quantities (ISQ/SI), and systems engineering metamodel definitions (Parts, Ports, Connections, Actions, States, Requirements, Constraints, Calculations, AnalysisCases, VerificationCases, Views, and Metadata). */

    import ScalarValues::*;
    import Base::*;
    import Quantities::*;
    import MeasurementReferences::*;
    import ISQ::*;
    import SI::*;
    import Parts::*;
    import Items::*;
    import Ports::*;
    import Connections::*;
    import Interfaces::*;
    import Allocations::*;
    import Actions::*;
    import States::*;
    import Constraints::*;
    import Requirements::*;
    import Calculations::*;
    import AnalysisCases::*;
    import VerificationCases::*;
    import UseCases::*;
    import Views::*;
    import Metadata::*;
}

package Items {
    doc /* Normative library definitions for items (matter, energy, or information) that flow through a system or exist in its physical context. */

    import Base::*;
    import Occurrences::*;
    import ScalarValues::*;

    item def Item :> Occurrence {
        doc /* Base definition for all distinguishable items that exist in space and time and may flow across system boundaries and ports. */
        attribute itemId : String;
        attribute isContinuous : Boolean = false;
    }

    item def PhysicalItem :> Item {
        doc /* An item with physical mass and spatial extent. */
        attribute mass : Real;
        attribute volume : Real;
    }

    item def Signal :> Item {
        doc /* An information-bearing item transmitted asynchronously between ports or actions. */
        attribute timestamp : Real;
        attribute payload : String;
    }
}

package Parts {
    doc /* Normative library definitions for modular structural system components (parts) and their lifecycle configurations. */

    import Items::*;
    import ScalarValues::*;

    part def Part :> Item {
        doc /* Base definition for all structural system elements (parts) that have state, behavior, ports, and internal sub-parts. */
        attribute serialNumber : String;
        attribute partNumber : String;
        attribute mass : Real;
    }

    part def System :> Part {
        doc /* Top-level engineered system composed of interacting subsystems, hardware, software, and interfaces. */
        attribute version : String = "1.0.0";
        attribute operationalAvailability : Real = 0.999;
    }

    part def Subsystem :> Part {
        doc /* Major functional or physical division of an engineered system. */
        attribute domain : String;
    }

    part def Component :> Part {
        doc /* Replaceable hardware or software unit within a subsystem. */
        attribute mtbfHours : Real = 50000.0;
    }
}

package Ports {
    doc /* Normative library definitions for interaction points (ports) through which parts exchange items, flows, and signals. */

    import Base::*;
    import ScalarValues::*;

    port def Port :> Object {
        doc /* Base definition for all interaction points on a Part definition or usage. Supports conjugated (~Port) and nested port interfaces. */
        attribute protocol : String;
        attribute isConjugated : Boolean = false;
    }

    port def FlowPort :> Port {
        doc /* Port specialized for continuous or discrete flow of energy, matter, or signals. */
        attribute direction : String = "inout";
        attribute nominalRate : Real;
    }

    port def PowerPort :> FlowPort {
        doc /* Electrical or mechanical power transfer interface port. */
        attribute voltage : Real;
        attribute current : Real;
    }

    port def DataPort :> Port {
        doc /* Digital communication or telemetry port for structured messages and signals. */
        attribute baudRate : Integer = 115200;
        attribute busStandard : String = "CAN-FD";
    }
}

package Connections {
    doc /* Normative library definitions for structural links, connectors, and flow connections between system elements. */

    import Base::*;
    import Links::*;
    import ScalarValues::*;

    connection def Connection :> BinaryLink {
        doc /* Base definition for structural connections linking two or more features, parts, or ports. */
        attribute connectionId : String;
    }

    connection def FlowConnection :> Connection {
        doc /* Directed transfer connection carrying items or conserved quantities between source and target ports. */
        attribute transferDelay : Real = 0.0;
    }
}

package Interfaces {
    doc /* Normative library definitions for structured point-to-point and bus interfaces connecting ports across subsystems. */

    import Connections::*;
    import Ports::*;
    import ScalarValues::*;

    interface def Interface :> Connection {
        doc /* Base definition for system interfaces binding endpoint ports and coordinating protocol and flow exchange. */
        port supplierPort : Port;
        port consumerPort : Port;
    }

    interface def BusInterface :> Interface {
        doc /* Multi-drop communication or power bus interface. */
        attribute bandwidthMbps : Real = 100.0;
    }
}

package Allocations {
    doc /* Normative library definitions for logical-to-physical, functional-to-structural, and software-to-hardware allocations. */

    import Connections::*;
    import ScalarValues::*;

    allocation def Allocation :> Connection {
        doc /* Base definition for mapping a logical element (action, requirement, or function) onto a physical or structural realization (part or port). */
        attribute allocationRationale : String;
        attribute utilizationRatio : Real;
    }
}

package Actions {
    doc /* Normative library definitions for functional behaviors, dataflow transformations, control nodes, and discrete action execution. */

    import Occurrences::*;
    import Performances::*;
    import ScalarValues::*;

    action def Action :> Performance {
        doc /* Base definition for all time-bounded behaviors and functional transformations performed by a system or part. */
        attribute duration : Real;
        attribute isAtomic : Boolean = false;
    }

    action def SendAction :> Action {
        doc /* Action that transmits a payload item out of a port to a target receiver. */
        attribute targetAddress : String;
    }

    action def AcceptAction :> Action {
        doc /* Action that waits for and receives an incoming trigger or signal item. */
        attribute timeoutSeconds : Real;
    }

    action def AssignAction :> Action {
        doc /* Action that updates the value of a structural feature or state variable. */
        attribute targetFeature : String;
    }
}

package States {
    doc /* Normative library definitions for finite state machines, hierarchical states, transitions, and entry/do/exit behaviors. */

    import Actions::*;
    import ScalarValues::*;

    state def StateAction :> Action {
        doc /* Base definition for system states and mode configurations, supporting entry, do, and exit actions as well as guarded transitions. */
        attribute stateName : String;
        attribute isParallel : Boolean = false;
    }

    action def TransitionAction :> Action {
        doc /* Guarded state transition triggered by an event or condition evaluation. */
        attribute guardExpression : String;
    }
}

package Constraints {
    doc /* Normative library definitions for boolean invariants, physical conservation laws, and parametric equations. */

    import Performances::*;
    import ScalarValues::*;

    constraint def ConstraintCheck :> BooleanEvaluation {
        doc /* Base definition for parametric and boolean constraints that must hold true across system properties. */
        attribute expression : String;
        attribute isHardConstraint : Boolean = true;
    }

    constraint def ConservationConstraint :> ConstraintCheck {
        doc /* Physical conservation law (e.g. Kirchhoff, mass continuity, energy balance) applied across connected ports. */
        attribute conservedQuantity : String;
    }
}

package Requirements {
    doc /* Normative library definitions for stakeholder and system requirements, verification criteria, and traceability links. */

    import Constraints::*;
    import ScalarValues::*;

    requirement def RequirementCheck :> ConstraintCheck {
        doc /* Base definition for formal system requirements with unique identifier, normative text, assumptions, and required constraints. */
        attribute reqId : String;
        attribute text : String;
        attribute priority : String = "mandatory";
        attribute verificationMethod : String = "Test";
    }

    requirement def FunctionalRequirement :> RequirementCheck {
        doc /* Requirement specifying a mandatory functional behavior or input-output transformation. */
        attribute allocatedFunction : String;
    }

    requirement def PerformanceRequirement :> RequirementCheck {
        doc /* Quantitative requirement bounding latency, throughput, mass, power, accuracy, or reliability. */
        attribute thresholdValue : Real;
        attribute objectiveValue : Real;
        attribute unitSymbol : String;
    }

    requirement def SafetyRequirement :> RequirementCheck {
        doc /* Safety-critical requirement associated with hazard mitigation and integrity levels (ISO 26262 ASIL / DO-178C DAL). */
        attribute integrityLevel : String = "ASIL-D";
        attribute hazardId : String;
    }
}

package Calculations {
    doc /* Normative library definitions for side-effect-free mathematical functions and engineering calculations. */

    import Functions::*;
    import ScalarValues::*;

    calc def Calculation :> Function {
        doc /* Base definition for side-effect-free engineering calculations that evaluate typed input parameters and return a result value. */
        attribute isDeterministic : Boolean = true;
    }
}

package AnalysisCases {
    doc /* Normative library definitions for trade studies, fidelity simulations, and quantitative engineering analyses. */

    import Calculations::*;
    import ScalarValues::*;

    calc def AnalysisCase :> Calculation {
        doc /* Base definition for engineering analysis cases that evaluate a subject system against an analysis objective (e.g. thermal, structural, reliability, or control stability). */
        attribute solverName : String;
        attribute tolerance : Real = 1e-6;
    }

    calc def TradeStudy :> AnalysisCase {
        doc /* Multi-objective trade study comparing alternative system architectures using an objective evaluation function. */
        attribute objectiveDirection : String = "maximize";
    }
}

package VerificationCases {
    doc /* Normative library definitions for requirement verification tests, inspections, demonstrations, and pass/fail verdicts. */

    import AnalysisCases::*;
    import ScalarValues::*;

    enum def VerdictKind {
        doc /* Standard verification outcome verdict enumeration (pass, fail, inconclusive, error). */
        enum pass;
        enum fail;
        enum inconclusive;
        enum error;
    }

    calc def VerificationCase :> AnalysisCase {
        doc /* Formal verification test case that evaluates a subject part or model against one or more Requirements and yields a VerdictKind. */
        attribute verifiedRequirementId : String;
        attribute verdict : String = "pass";
    }
}

package UseCases {
    doc /* Normative library definitions for operational scenarios, actors, and mission use cases. */

    import AnalysisCases::*;
    import ScalarValues::*;

    calc def UseCase :> AnalysisCase {
        doc /* Operational interaction scenario between an engineered system subject and external actors to achieve a mission goal. */
        attribute primaryActor : String;
        attribute precondition : String;
        attribute postcondition : String;
    }
}

package Views {
    doc /* Normative library definitions for stakeholder viewpoints, model queries, and graphical/tabular view renderings. */

    import Parts::*;
    import ScalarValues::*;

    part def View :> Part {
        doc /* Model projection that filters and renders elements from imported namespaces according to a stakeholder Viewpoint. */
        attribute viewpointName : String;
        attribute renderingFormat : String = "diagram";
    }

    part def Viewpoint :> Part {
        doc /* Specification of stakeholder concerns and rules governing how a View constructs its model presentation. */
        attribute stakeholder : String;
        attribute concern : String;
    }
}

package Metadata {
    doc /* Normative library definitions for semantic annotations, tool extensions, safety/security markings, and model governance metadata. */

    import Base::*;
    import ScalarValues::*;

    attribute def MetadataItem :> DataValue {
        doc /* Base definition for user-defined and standard metadata annotations attached to SysML v2 model elements (@Metadata). */
        attribute annotationSource : String;
    }

    attribute def RiskMetadata :> MetadataItem {
        doc /* Risk assessment metadata capturing likelihood, severity, and mitigation status. */
        attribute probability : Real;
        attribute severity : Integer;
    }
}
