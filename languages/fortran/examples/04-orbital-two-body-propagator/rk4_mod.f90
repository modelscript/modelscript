module rk4_mod
  use constants_mod
  implicit none
contains
  subroutine two_body_rhs(y, dydt)
    real(8), intent(in)  :: y(6)
    real(8), intent(out) :: dydt(6)
    real(8) :: r, r3

    r = sqrt(y(1)*y(1) + y(2)*y(2) + y(3)*y(3))
    r3 = max(r * r * r, 1.0d-12)
    dydt(1) = y(4)
    dydt(2) = y(5)
    dydt(3) = y(6)
    dydt(4) = -MU_EARTH * y(1) / r3
    dydt(5) = -MU_EARTH * y(2) / r3
    dydt(6) = -MU_EARTH * y(3) / r3
  end subroutine two_body_rhs

  subroutine rk4_orbit_step(y, dt)
    real(8), intent(inout) :: y(6)
    real(8), intent(in)    :: dt
    real(8) :: k1(6), k2(6), k3(6), k4(6)

    call two_body_rhs(y, k1)
    call two_body_rhs(y + 0.5d0 * dt * k1, k2)
    call two_body_rhs(y + 0.5d0 * dt * k2, k3)
    call two_body_rhs(y + dt * k3, k4)
    y = y + (dt / 6.0d0) * (k1 + 2.0d0 * k2 + 2.0d0 * k3 + k4)
  end subroutine rk4_orbit_step
end module rk4_mod
