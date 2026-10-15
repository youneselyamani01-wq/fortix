/**
 * D-006/NX GATE 2 — THE NUMERICAL CORE.
 *
 * PCA (variant C), spectral embedding (D1) and diffusion maps (D2) all reduce
 * to one operation: the eigendecomposition of a real SYMMETRIC matrix. This
 * module provides exactly that, in pure TypeScript — the repository has no
 * numpy, no scipy and no native BLAS, and a projection nobody can reproduce is
 * not evidence of anything.
 *
 * The method is the CYCLIC JACOBI ROTATION. For a symmetric matrix it is
 * unconditionally convergent, needs no starting guess, and returns a fully
 * orthonormal eigenvector set — which matters here because the whole point of
 * the exercise is that the axes be genuinely independent. At n = 58 its O(n³)
 * cost is irrelevant.
 *
 * NOTHING IN THIS FILE KNOWS WHAT A RECEIPT IS. It is arithmetic, kept separate
 * from meaning on purpose: the semantic rules — that similarity is not
 * causality, that a diffusion distance is not a causal distance — are enforced
 * where the features are built and where the result is drawn, not here.
 */

export type Eigen = Readonly<{
  /** Eigenvalues, descending. */
  values: readonly number[];
  /** `vectors[i]` is the unit eigenvector for `values[i]`. */
  vectors: readonly (readonly number[])[];
}>;

const clone = (matrix: readonly (readonly number[])[]) => matrix.map((row) => [...row]);

/**
 * Eigendecomposition of a real symmetric matrix by cyclic Jacobi rotations.
 *
 * Each sweep annihilates every off-diagonal entry in turn; because a rotation
 * preserves the Frobenius norm while moving weight onto the diagonal, the
 * off-diagonal mass falls monotonically. Iteration stops when it is negligible
 * relative to the matrix's own scale, so the tolerance means the same thing for
 * a correlation matrix and for a Laplacian.
 */
export function symmetricEigen(input: readonly (readonly number[])[], maxSweeps = 100): Eigen {
  const n = input.length;
  if (n === 0) return Object.freeze({ values: [], vectors: [] });
  const a = clone(input);
  // Eigenvectors accumulate as the product of the rotations, starting at I.
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  const offDiagonal = () => {
    let sum = 0;
    for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) sum += a[i]![j]! * a[i]![j]!;
    return Math.sqrt(2 * sum);
  };

  let scale = 0;
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) scale = Math.max(scale, Math.abs(a[i]![j]!));
  const tolerance = Math.max(scale, 1) * 1e-12;

  for (let sweep = 0; sweep < maxSweeps && offDiagonal() > tolerance; sweep += 1) {
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) <= tolerance) continue;
        // The rotation angle that zeroes a[p][q], via the numerically stable
        // form of t = sign(theta) / (|theta| + sqrt(theta^2 + 1)).
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((left, right) => a[right]![right]! - a[left]![left]!);
  return Object.freeze({
    values: Object.freeze(order.map((i) => a[i]![i]!)),
    // Sign is arbitrary for an eigenvector; fix it so the largest-magnitude
    // component is positive, making every projection reproducible run to run.
    vectors: Object.freeze(order.map((i) => {
      const column = v.map((row) => row[i]!);
      let dominant = 0;
      for (const value of column) if (Math.abs(value) > Math.abs(dominant)) dominant = value;
      const flip = dominant < 0 ? -1 : 1;
      return Object.freeze(column.map((value) => value * flip));
    })),
  });
}

/** Column means of a row-major matrix. */
export const columnMeans = (rows: readonly (readonly number[])[]): readonly number[] => {
  const width = rows[0]?.length ?? 0;
  return Array.from({ length: width }, (_, j) => rows.reduce((sum, row) => sum + row[j]!, 0) / Math.max(1, rows.length));
};

/** Population standard deviation per column; 0 for a constant column. */
export const columnDeviations = (rows: readonly (readonly number[])[], means: readonly number[]): readonly number[] => {
  const width = means.length;
  return Array.from({ length: width }, (_, j) => {
    const variance = rows.reduce((sum, row) => sum + (row[j]! - means[j]!) ** 2, 0) / Math.max(1, rows.length);
    return Math.sqrt(variance);
  });
};

/**
 * Z-score each column. A CONSTANT column is left at zero rather than divided by
 * a zero deviation: it carries no information, and dividing would turn a
 * rounding error into a dominant axis.
 */
export function standardize(rows: readonly (readonly number[])[]): Readonly<{
  matrix: readonly (readonly number[])[]; means: readonly number[]; deviations: readonly number[]; constantColumns: readonly number[];
}> {
  const means = columnMeans(rows);
  const deviations = columnDeviations(rows, means);
  const constantColumns = deviations.flatMap((deviation, index) => (deviation === 0 ? [index] : []));
  const matrix = rows.map((row) => row.map((value, j) => (deviations[j]! === 0 ? 0 : (value - means[j]!) / deviations[j]!)));
  return Object.freeze({ matrix, means, deviations, constantColumns: Object.freeze(constantColumns) });
}

/** `Xᵀ X / n` for an already-centred matrix — the covariance of its columns. */
export function covariance(rows: readonly (readonly number[])[]): readonly (readonly number[])[] {
  const width = rows[0]?.length ?? 0;
  const n = Math.max(1, rows.length);
  return Array.from({ length: width }, (_, i) => Array.from({ length: width }, (_, j) => (
    rows.reduce((sum, row) => sum + row[i]! * row[j]!, 0) / n
  )));
}

/** Project rows onto the first `k` eigenvectors — the scores of a PCA. */
export function project(rows: readonly (readonly number[])[], vectors: readonly (readonly number[])[], k: number): readonly (readonly number[])[] {
  const axes = vectors.slice(0, k);
  return rows.map((row) => axes.map((axis) => row.reduce((sum, value, j) => sum + value * axis[j]!, 0)));
}
