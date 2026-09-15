// SPDX-License-Identifier: AGPL-3.0-or-later

export interface Point2D {
  x: number;
  y: number;
}

export type Extent2D = [[number, number], [number, number]];

/**
 * 2D Affine Transformation Matrix:
 * | a  c  tx |
 * | b  d  ty |
 * | 0  0   1 |
 *
 * x' = a * x + c * y + tx
 * y' = b * x + d * y + ty
 */
export class AffineMatrix2D {
  public a: number;
  public b: number;
  public c: number;
  public d: number;
  public tx: number;
  public ty: number;

  constructor(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.tx = tx;
    this.ty = ty;
  }

  static identity(): AffineMatrix2D {
    return new AffineMatrix2D(1, 0, 0, 1, 0, 0);
  }

  static translation(dx: number, dy: number): AffineMatrix2D {
    return new AffineMatrix2D(1, 0, 0, 1, dx, dy);
  }

  static rotation(degrees: number, cx = 0, cy = 0): AffineMatrix2D {
    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    if (cx === 0 && cy === 0) {
      return new AffineMatrix2D(cos, sin, -sin, cos, 0, 0);
    }
    return new AffineMatrix2D(cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos);
  }

  static scaling(sx: number, sy = sx, cx = 0, cy = 0): AffineMatrix2D {
    if (cx === 0 && cy === 0) {
      return new AffineMatrix2D(sx, 0, 0, sy, 0, 0);
    }
    return new AffineMatrix2D(sx, 0, 0, sy, cx * (1 - sx), cy * (1 - sy));
  }

  /**
   * Multiplies this matrix by another: this = this * other
   */
  multiply(other: AffineMatrix2D): this {
    const a = this.a * other.a + this.c * other.b;
    const b = this.b * other.a + this.d * other.b;
    const c = this.a * other.c + this.c * other.d;
    const d = this.b * other.c + this.d * other.d;
    const tx = this.a * other.tx + this.c * other.ty + this.tx;
    const ty = this.b * other.tx + this.d * other.ty + this.ty;

    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.tx = tx;
    this.ty = ty;
    return this;
  }

  translate(dx: number, dy: number): this {
    return this.multiply(AffineMatrix2D.translation(dx, dy));
  }

  rotate(degrees: number, cx = 0, cy = 0): this {
    return this.multiply(AffineMatrix2D.rotation(degrees, cx, cy));
  }

  scale(sx: number, sy = sx, cx = 0, cy = 0): this {
    return this.multiply(AffineMatrix2D.scaling(sx, sy, cx, cy));
  }

  /**
   * Inverts the Y-axis (transforms Cartesian Y-up to screen Y-down or vice-versa)
   */
  invertY(): this {
    return this.multiply(new AffineMatrix2D(1, 0, 0, -1, 0, 0));
  }

  transformPoint(p: Point2D): Point2D {
    return {
      x: this.a * p.x + this.c * p.y + this.tx,
      y: this.b * p.x + this.d * p.y + this.ty,
    };
  }

  transformExtent(extent: Extent2D): Extent2D {
    const p1 = this.transformPoint({ x: extent[0][0], y: extent[0][1] });
    const p2 = this.transformPoint({ x: extent[1][0], y: extent[0][1] });
    const p3 = this.transformPoint({ x: extent[0][0], y: extent[1][1] });
    const p4 = this.transformPoint({ x: extent[1][0], y: extent[1][1] });

    const minX = Math.min(p1.x, p2.x, p3.x, p4.x);
    const maxX = Math.max(p1.x, p2.x, p3.x, p4.x);
    const minY = Math.min(p1.y, p2.y, p3.y, p4.y);
    const maxY = Math.max(p1.y, p2.y, p3.y, p4.y);

    return [
      [minX, minY],
      [maxX, maxY],
    ];
  }

  inverse(): AffineMatrix2D {
    const det = this.a * this.d - this.b * this.c;
    if (Math.abs(det) < 1e-12) {
      return AffineMatrix2D.identity();
    }
    const invDet = 1 / det;
    const a = this.d * invDet;
    const b = -this.b * invDet;
    const c = -this.c * invDet;
    const d = this.a * invDet;
    const tx = (this.c * this.ty - this.d * this.tx) * invDet;
    const ty = (this.b * this.tx - this.a * this.ty) * invDet;
    return new AffineMatrix2D(a, b, c, d, tx, ty);
  }

  toSvgMatrix(): string {
    return `matrix(${this.a.toFixed(4)}, ${this.b.toFixed(4)}, ${this.c.toFixed(4)}, ${this.d.toFixed(4)}, ${this.tx.toFixed(2)}, ${this.ty.toFixed(2)})`;
  }
}
