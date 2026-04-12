package VehicleRequirements {
    requirement def MassRequirement {
        doc /* The system shall have a total mass below the specified limit. */
        subject vehicle : Parts::Vehicle;
        require constraint { vehicle.mass <= 2000 }
    }

    requirement def SafetyRequirement {
        doc /* The vehicle shall pass all crash test ratings. */
        subject vehicle : Parts::Vehicle;
        require constraint { vehicle.crashRating >= 5 }
    }

    requirement def PerformanceRequirement {
        doc /* The vehicle shall accelerate from 0-60 in under 6 seconds. */
        subject vehicle : Parts::Vehicle;
    }

    requirement def ReliabilityRequirement {
        doc /* The vehicle shall operate for 200000 km without major failure. */
        subject vehicle : Parts::Vehicle;
        assume constraint { vehicle.mileage >= 0 }
        require constraint { vehicle.mtbf >= 200000 }
    }
}

package VehicleVerification {
    verification def MassVerificationCase {
        doc /* Weigh the vehicle on a certified scale. */
        objective {
            require constraint { 1 == 1 }
        }
        verify MassRequirement;
    }

    verification def SafetyVerificationCase {
        doc /* Run the full NCAP crash test suite. */
        objective {
            require constraint { 1 == 1 }
        }
        verify SafetyRequirement;
    }

    verification def ReliabilityVerificationCase {
        doc /* Run endurance testing over 200000 km equivalent. */
        verify ReliabilityRequirement;
    }
}

package IntegrationTest {
    part vehicle : Parts::Vehicle;

    satisfy MassRequirement by vehicle;
    satisfy SafetyRequirement by vehicle;
}

// ===================================================================
// CALCULATION & EXPRESSION EVALUATION TESTS
// ===================================================================

package CalculationTests {

    // --- Literal arithmetic in calc definitions ---
    calc def Add {
        in a : Real;
        in b : Real;
        return : Real;
        a + b
    }

    calc def Multiply {
        in a : Real;
        in b : Real;
        return : Real;
        a * b
    }

    calc def TotalMass {
        in vehicleMass : Real;
        in cargoMass : Real;
        in fuelMass : Real;
        return : Real;
        vehicleMass + cargoMass + fuelMass
    }

    // --- Constraint evaluation with literals ---
    constraint def MassLimit {
        1500 + 300 <= 2000
    }

    constraint def PowerCheck {
        250 * 2 >= 400
    }

    // --- Boolean logic ---
    constraint def CombinedCheck {
        true and true
    }

    constraint def DisjunctiveCheck {
        false or true
    }

    constraint def ImplicationCheck {
        false implies true
    }

    // --- Equality ---
    constraint def EqualityCheck {
        42 == 42
    }

    constraint def InequalityCheck {
        1 != 2
    }

    // --- Exponentiation ---
    calc def SquaredDistance {
        in x : Real;
        return : Real;
        x ** 2
    }

    // --- Requirement with evaluatable constraint (literal: true) ---
    requirement def LiteralMassReq {
        doc /* Mass must be under 2000 kg (literal check). */
        require constraint { 1800 <= 2000 }
    }

    // --- Requirement with violated constraint (literal: false) ---
    requirement def ViolatedReq {
        doc /* This requirement has a constraint that is violated. */
        require constraint { 2500 <= 2000 }
    }

    // Satisfy the evaluatable requirements
    part vehicle : Parts::Vehicle;
    satisfy LiteralMassReq by vehicle;
    satisfy ViolatedReq by vehicle;
}
