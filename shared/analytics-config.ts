/** Every analytics threshold and weight lives here. Tune freely. */
export const CONFIG = {
  baseline: { windowDays: 30, minN: 7 },
  recovery: {
    weights: { hrv: 40, rhr: 25, sleep: 25, resp: 5, form: 5 },
    scale: 16,
    bands: { well: 67, moderate: 34 },
    sleepZPerTenPct: 1,
  },
  sleep: {
    nightStartHour: 18,
    nightEndHour: 14,
    mergeGapMin: 45,
    defaultNeedMin: 450,
    debtWindowNights: 14,
    surplusCapMin: 60,
    regularityNights: 14,
  },
  sleepScore: {
    duration: 50, efficiency: 15, restorative: 20, regularity: 15,
    effFloor: 0.7, effFull: 0.95, sdFullMin: 15, sdZeroMin: 60,
  },
  load: { atlDays: 7, ctlDays: 42, acwrFlag: 1.5 },
  flags: { rhrDelta: 5, rhrDays: 2, respDelta: 1.5, hrvLowDays: 3, debtMin: 300 },
  merge: { startToleranceS: 120, durationTolerance: 0.1 },
  patterns: { minAbsRho: 0.3, minN: 30, windowDays: 90 },
  climbs: { minGrade: 0.03, minLengthM: 500 },
  strava: { budget15: 90, budgetDay: 900 },
  sync: { intervalMin: 55, tickMin: 5, staleHours: 3, haeWindowDays: 7 },
  gear: { shoeWarnKm: 600 },
  decoupling: { flagPct: 5 },
} as const;
