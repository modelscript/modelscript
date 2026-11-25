subroutine cg_tridiagonal_solve(res_norm)
  implicit none
  real(8) :: res_norm
  real(8) :: x(16), b(16), r(16), p(16), ap(16)
  real(8) :: rsold, rsnew, pap, alpha, beta, denom_pap, denom_rs
  integer :: i, iter

  do i = 1, 16
    x(i) = 0.0d0
    b(i) = 1.0d0
    r(i) = 1.0d0
    p(i) = 1.0d0
    ap(i) = 0.0d0
  end do

  rsold = 16.0d0

  do iter = 1, 30
    ap(1) = 2.0d0 * p(1) - p(2)
    do i = 2, 15
      ap(i) = -p(i - 1) + 2.0d0 * p(i) - p(i + 1)
    end do
    ap(16) = -p(15) + 2.0d0 * p(16)

    pap = 0.0d0
    do i = 1, 16
      pap = pap + p(i) * ap(i)
    end do

    denom_pap = 1.0d0
    if (pap > 1.0d-12) then
      denom_pap = pap
    end if
    alpha = rsold / denom_pap

    rsnew = 0.0d0
    do i = 1, 16
      x(i) = x(i) + alpha * p(i)
      r(i) = r(i) - alpha * ap(i)
      rsnew = rsnew + r(i) * r(i)
    end do

    denom_rs = 1.0d0
    if (rsold > 1.0d-12) then
      denom_rs = rsold
    end if
    beta = rsnew / denom_rs

    do i = 1, 16
      p(i) = r(i) + beta * p(i)
    end do
    rsold = rsnew
  end do

  res_norm = rsold
end subroutine cg_tridiagonal_solve
