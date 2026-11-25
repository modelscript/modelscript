$title Diet and Nutrition Cost-Minimization LP
Sets
  f  foods     / oats, chicken, eggs, milk, beans /
  n  nutrients / calories, protein, calcium / ;

Parameters
  price(f)  cost per serving in USD
    / oats     0.35
      chicken  2.40
      eggs     0.55
      milk     0.65
      beans    0.45 /
  nmin(n)   minimum daily requirement
    / calories 2000
      protein  55
      calcium  800 /
  maxsrv(f) maximum servings per day
    / oats     4
      chicken  3
      eggs     3
      milk     5
      beans    4 / ;

Table nut(f,n)  nutrient content per serving
             calories  protein  calcium
  oats          300       10       40
  chicken       280       32       15
  eggs          160       13       55
  milk          150        8      300
  beans         260       15       80 ;

Variables
  x(f)   servings of food f
  total  total daily food cost (USD) ;
Positive Variable x ;

x.up(f) = maxsrv(f) ;

Equations
  obj       total diet cost
  req(n)    minimum daily nutrient requirement ;

obj..     total =e= sum(f, price(f)*x(f)) ;
req(n)..  sum(f, nut(f,n)*x(f)) =g= nmin(n) ;

Model diet / all / ;
Solve diet using lp minimizing total ;
Display x.l, total.l ;
