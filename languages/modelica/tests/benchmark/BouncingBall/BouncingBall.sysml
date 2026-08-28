package BouncingBallReqs {
  requirement def HeightRequirement {
    attribute maxHeight: Real = 1.0;
    require constraint {
      h <= maxHeight
    }
  }

  requirement def VelocityRequirement {
    attribute limit: Real = 5.0;
    require constraint {
      v < limit
    }
  }

  // To trigger a violation and validate the loop, we make the constraint impossible:
  requirement def ImpossibleVelocityRequirement {
    attribute maxVel: Real = 0.5; // Will be violated!
    require constraint {
      v <= maxVel
    }
  }

  part def BouncingBall;

  verification def BouncingBallCase {
    verify ImpossibleVelocityRequirement;
    objective simTarget {
      subject target : BouncingBall;
    }
  }
}
