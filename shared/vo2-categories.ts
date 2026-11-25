/**
 * VO₂ max fitness categories by age and sex (ml/kg/min), approximating the published cardio-fitness bands
 * Apple uses (derived from ACSM norms). Thresholds are the lower bounds of Below average, Above average and High.
 */
const TABLE: Record<'male' | 'female', [number, number, number, number][]> = {
  // [maxAge, belowAvgFrom, aboveAvgFrom, highFrom]
  male: [[29, 38, 44, 51], [39, 36, 42, 48], [49, 34, 39, 45], [59, 31, 36, 41], [69, 28, 32, 37], [200, 24, 28, 33]],
  female: [[29, 32, 37, 43], [39, 30, 35, 40], [49, 28, 33, 38], [59, 25, 30, 34], [69, 23, 27, 31], [200, 21, 24, 28]],
};

export function vo2Category(vo2: number, age: number, sex: 'male' | 'female'): 'Low' | 'Below average' | 'Above average' | 'High' {
  const row = TABLE[sex].find((r) => age <= r[0])!;
  if (vo2 < row[1]) return 'Low';
  if (vo2 < row[2]) return 'Below average';
  if (vo2 < row[3]) return 'Above average';
  return 'High';
}
