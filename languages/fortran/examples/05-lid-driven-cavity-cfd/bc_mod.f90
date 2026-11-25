module bc_mod
  use grid_mod
  implicit none
contains
  subroutine apply_cavity_bc(u, v)
    real(8), intent(inout) :: u(NX, NY), v(NX, NY)
    u(1, :) = 0.0d0
    u(NX, :) = 0.0d0
    u(:, 1) = 0.0d0
    u(:, NY) = 1.0d0
    v(1, :) = 0.0d0
    v(NX, :) = 0.0d0
    v(:, 1) = 0.0d0
    v(:, NY) = 0.0d0
  end subroutine apply_cavity_bc
end module bc_mod
