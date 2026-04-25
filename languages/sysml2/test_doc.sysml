// ═══════════════════════════════════════════════════════════════════════
// SysML v2 Kitchen Sink — comprehensive demonstration of SysML2 features
// ═══════════════════════════════════════════════════════════════════════

// ── STRUCTURAL DEFINITIONS ──────────────────────────────────────────

package VehicleSystem {

    // ---------- Port Definitions ----------
    port def TorquePort {
        attribute torqueValue : Real;
    }

    port def ElectricalPort {
        attribute voltage : Real;
        attribute current : Real;
    }

    port def FuelPort {
        attribute flowRate : Real;
    }

    // ---------- Part Definitions ----------
    part def Engine {
        attribute horsePower : Real;
        attribute displacement : Real;
        attribute fuelType : String;

        port torqueOut : TorquePort;
        port fuelIn : FuelPort;
    }

    part def Transmission {
        attribute gearRatio : Real;
        attribute numberOfGears : Integer;

        port torqueIn : TorquePort;
        port torqueOut : TorquePort;
    }

    part def Battery {
        attribute capacity : Real;
        attribute voltage : Real;

        port electricalOut : ElectricalPort;
    }

    part def ElectricMotor {
        attribute peakPower : Real;
        attribute efficiency : Real;

        port electricalIn : ElectricalPort;
        port torqueOut : TorquePort;
    }

    part def BrakeSystem {
        attribute maxBrakingForce : Real;
        attribute absEnabled : Boolean;
    }

    part def Wheel {
        attribute diameter : Real;
        attribute tirePressure : Real;
    }

    part def FuelTank {
        attribute capacity : Real;

        port fuelOut : FuelPort;
    }

    // ---------- Top-Level Vehicle Definition ----------
    part def Vehicle {
        attribute mass : Real;
        attribute topSpeed : Real;
        attribute vin : String;

        part engine : Engine;
        part transmission : Transmission;
        part battery : Battery;
        part motor : ElectricMotor;
        part brakes : BrakeSystem;
        part frontLeft : Wheel;
        part frontRight : Wheel;
        part rearLeft : Wheel;
        part rearRight : Wheel;
        part fuelTank : FuelTank;

        // Structural connections
        connect engine.torqueOut to transmission.torqueIn;
        connect battery.electricalOut to motor.electricalIn;
        connect fuelTank.fuelOut to engine.fuelIn;
    }

    // ── Actors & Use Cases ──

    part def Driver {
        doc /* Primary operator of the vehicle. */
    }

    part def Mechanic {
        doc /* Service technician responsible for maintenance. */
    }

    part def FleetManager {
        doc /* Oversees a fleet of vehicles remotely. */
    }
    
    part def Passenger {
        doc /* Rides the vehicle and adjusts convenience settings. */
    }
    
    part def ChargingStation {
        doc /* Provides electrical power to recharge the battery. */
    }
    
    part def Pedestrian {
        doc /* External actor interacting with vehicle safety systems. */
    }

    use case def DriveVehicle {
        doc /* The driver operates the vehicle for daily commute. */
        subject vehicle : Vehicle;
        actor driver : Driver;
        include use case startUp : StartVehicle;
        include use case navigate : NavigateRoute;
    }

    use case def StartVehicle {
        doc /* The driver starts the engine and checks dashboard. */
        subject vehicle : Vehicle;
        actor driver : Driver;
    }

    use case def NavigateRoute {
        doc /* The driver follows turn-by-turn directions. */
        subject vehicle : Vehicle;
        actor driver : Driver;
    }

    use case def PerformMaintenance {
        doc /* The mechanic performs scheduled service. */
        subject vehicle : Vehicle;
        actor mechanic : Mechanic;
    }

    use case def MonitorFleet {
        doc /* The fleet manager monitors vehicle telemetry. */
        actor manager : FleetManager;
    }
    
    use case def ChargeVehicle {
        doc /* The driver connects the vehicle to a charging station. */
        subject vehicle : Vehicle;
        actor driver : Driver;
        actor station : ChargingStation;
    }
    
    use case def UpdateSoftware {
        doc /* The mechanic updates the vehicle system software. */
        subject vehicle : Vehicle;
        actor mechanic : Mechanic;
    }
    
    use case def AdjustClimateControl {
        doc /* The passenger adjusts the cabin temperature and airflow. */
        subject vehicle : Vehicle;
        actor passenger : Passenger;
    }
    
    use case def DetectObstacle {
        doc /* The vehicle detects a pedestrian and alerts the driver. */
        subject vehicle : Vehicle;
        actor pedestrian : Pedestrian;
        actor driver : Driver;
    }
}

// ── BEHAVIORAL DEFINITIONS ──────────────────────────────────────────

package VehicleBehavior {

    // ---------- Action Definitions ----------
    action def StartEngine {
        in ignitionSignal : Boolean;
        out engineRunning : Boolean;
    }

    action def Accelerate {
        in throttlePosition : Real;
        in currentSpeed : Real;
        out newSpeed : Real;
    }

    action def Brake {
        in brakeForce : Real;
        in currentSpeed : Real;
        out newSpeed : Real;
    }

    action def ShiftGear {
        in targetGear : Integer;
        out gearEngaged : Integer;
    }

    // ---------- State Definitions ----------
    state def VehicleStates {
        state off;
        state idle;
        state driving;
        state charging;
        state emergency;

        transition off_to_idle
            first off
            then idle;

        transition idle_to_driving
            first idle
            then driving;

        transition driving_to_idle
            first driving
            then idle;

        transition idle_to_off
            first idle
            then off;

        transition any_to_emergency
            first driving
            then emergency;
    }

    // ---------- Composite Behavior ----------
    action def DriveCycle {
        action start : StartEngine;
        action accel : Accelerate;
        action shift : ShiftGear;
        action brake : Brake;

        succession start then accel;
        succession accel then shift;
        succession shift then brake;
    }
}

// ── REQUIREMENTS ────────────────────────────────────────────────────

package VehicleRequirements {

    requirement def MassRequirement {
        doc /* The total vehicle mass shall not exceed 2000 kg. */
        attribute maxMass : Real;
    }

    requirement def PerformanceRequirement {
        doc /* The vehicle shall accelerate 0–100 km/h in under 6 seconds. */
        attribute targetTime : Real;
    }

    requirement def SafetyRequirement {
        doc /* The vehicle shall pass NCAP 5-star crash test rating. */
        attribute minRating : Integer;
    }

    requirement def RangeRequirement {
        doc /* The electric range shall be at least 50 km. */
        attribute minRange : Real;
    }

    requirement def EmissionRequirement {
        doc /* CO2 emissions shall be below 120 g/km. */
        attribute maxEmission : Real;
    }

    requirement def ReliabilityRequirement {
        doc /* MTBF shall be at least 200,000 km. */
        attribute mtbf : Real;
    }
}

// ── VERIFICATION & ANALYSIS ─────────────────────────────────────────

package VehicleVerification {

    verification def MassVerificationCase {
        doc /* Weigh the assembled vehicle on a certified scale. */
        verify VehicleRequirements::MassRequirement;
    }

    verification def PerformanceVerificationCase {
        doc /* Run acceleration test on a dynamometer. */
        verify VehicleRequirements::PerformanceRequirement;
    }

    verification def SafetyVerificationCase {
        doc /* Execute full NCAP crash test suite. */
        verify VehicleRequirements::SafetyRequirement;
    }

    verification def EmissionVerificationCase {
        doc /* Perform WLTP emission cycle measurement. */
        verify VehicleRequirements::EmissionRequirement;
    }
}

// ── CALCULATIONS & CONSTRAINTS ──────────────────────────────────────

package VehicleAnalysis {

    calc def TotalMass {
        in bodyMass : Real;
        in drivetrainMass : Real;
        in batteryMass : Real;
        in cargoMass : Real;
        return : Real;
        bodyMass + drivetrainMass + batteryMass + cargoMass
    }

    calc def BrakingDistance {
        in speed : Real;
        in friction : Real;
        return : Real;
        speed ** 2 / (2 * friction * 9.81)
    }

    calc def PowerToWeight {
        in power : Real;
        in mass : Real;
        return : Real;
        power / mass
    }

    constraint def MaxMassConstraint {
        1500 + 200 + 150 + 100 <= 2000
    }

    constraint def PowerFloorConstraint {
        250 * 2 >= 400
    }

    constraint def RangeConstraint {
        60 >= 50
    }
}



// ── INTEGRATION & ALLOCATION ────────────────────────────────────────

package VehicleIntegration {

    // Instantiate the vehicle
    part vehicle : VehicleSystem::Vehicle;

    // Satisfy requirements
    satisfy VehicleRequirements::MassRequirement by vehicle;
    satisfy VehicleRequirements::SafetyRequirement by vehicle;
    satisfy VehicleRequirements::PerformanceRequirement by vehicle;
    satisfy VehicleRequirements::RangeRequirement by vehicle;

    // Allocate behavior to structure
    allocation def BehaviorAllocation {
        part source : VehicleBehavior::DriveCycle;
        part target : VehicleSystem::Vehicle;
    }
}
part badArray [2] : Integer = (1, 2, 3);
part errorBound [5..1];
