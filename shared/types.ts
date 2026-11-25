export type Sport = 'run' | 'ride' | 'walk' | 'hike' | 'swim' | 'strength' | 'hiit' | 'other';
export type SleepStage = 'awake' | 'rem' | 'core' | 'deep' | 'inBed' | 'asleep';

export interface Sample { metric: string; start: string; end: string; value: number; unit: string; source: string }
export interface SleepSegment { start: string; end: string; stage: SleepStage; source: string }

export interface Streams {
  time: number[];
  distance?: number[];
  latlng?: [number, number][];
  altitude?: number[];
  speed?: number[];
  heartrate?: number[];
  cadence?: number[];
  watts?: number[];
  grade?: number[];
  moving?: boolean[];
}

export interface WorkoutRecord {
  source: 'apple' | 'strava';
  sourceId: string;
  sport: Sport;
  start: string;
  end: string;
  tzOffsetMin: number;
  durationS: number;
  movingS?: number;
  distanceM?: number;
  elevGainM?: number;
  energyKcal?: number;
  avgHr?: number;
  maxHr?: number;
  name?: string;
  gearId?: string;
  polyline?: string;
}

export interface Baseline { median: number; iqr: number; low: number; high: number; n: number }

export interface Settings {
  tz: string;
  dob?: string;
  sex?: 'male' | 'female';
  hrMax?: number;
  hrRestOverride?: number;
  sleepNeedMin: number;
  goals: { steps: number; activeKcal: number; exerciseMin: number; standHours: number };
  ftp?: number;
  zoneModel: 'hrr' | 'pctMax';
  units: 'metric' | 'imperial';
  haeFolder?: string;
  lanMode: boolean;
  passcodeHash?: string;
  ingestToken?: string;
}

export type DailyRow = { date: string } & Record<string, number | null>;

export interface Series { points: { date: string; value: number | null }[]; band: { low: number; high: number } | null }
