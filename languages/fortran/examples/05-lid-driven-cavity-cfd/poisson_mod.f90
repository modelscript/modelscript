module poisson_mod
  use grid_mod
  implicit none
contains
  subroutine solve_pressure_poisson(p, rhs, nit)
    real(8), intent(inout) :: p(NX, NY)
    real(8), intent(in)    :: rhs(NX, NY)
    integer, intent(in)    :: nit
    real(8) :: pn(NX, NY), denom
    integer :: it, i, j

    denom = 2.0d0 * (DX * DX + DY * DY)
    do it = 1, nit
      pn = p
      do j = 2, NY - 1
        do i = 2, NX - 1
          p(i, j) = ((pn(i + 1, j) + pn(i - 1, j)) * DY * DY + &
                     (pn(i, j + 1) + pn(i, j - 1)) * DX * DX - &
                     rhs(i, j) * DX * DX * DY * DY) / denom
        end do
      end do
      p(1, :) = p(2, :)
      p(NX, :) = p(NX - 1, :)
      p(:, 1) = p(:, 2)
      p(:, NY) = 0.0d0
    end do
  end subroutine solve_pressure_poisson
end module poisson_mod
