export type MetricKey =
  | 'hr' | 'rhr' | 'hrv' | 'resp' | 'vo2max' | 'walkHr' | 'hrRecovery'
  | 'steps' | 'distance' | 'flights' | 'activeKcal' | 'basalKcal' | 'exerciseMin' | 'standHours'
  | 'runPower' | 'runSpeed' | 'strideLength' | 'groundContact' | 'vertOsc' | 'weight' | 'daylightMin';

export interface MetricDef {
  label: string;
  unit: string;
  better: 'up' | 'down' | 'none';
  daily: 'sum' | 'avg' | 'min' | 'max' | 'last';
  hae: string[];
}

export const METRICS: Record<MetricKey, MetricDef> = {
  hr: { label: 'Heart rate', unit: 'bpm', better: 'none', daily: 'avg', hae: ['heart_rate'] },
  rhr: { label: 'Resting HR', unit: 'bpm', better: 'down', daily: 'last', hae: ['resting_heart_rate'] },
  hrv: { label: 'HRV', unit: 'ms', better: 'up', daily: 'avg', hae: ['heart_rate_variability'] },
  resp: { label: 'Breathing rate', unit: '/min', better: 'none', daily: 'avg', hae: ['respiratory_rate'] },
  vo2max: { label: 'VO₂ max', unit: 'ml/kg/min', better: 'up', daily: 'last', hae: ['vo2_max'] },
  walkHr: { label: 'Walking HR', unit: 'bpm', better: 'down', daily: 'avg', hae: ['walking_heart_rate_average'] },
  hrRecovery: { label: 'HR recovery', unit: 'bpm', better: 'up', daily: 'last', hae: ['cardio_recovery'] },
  steps: { label: 'Steps', unit: 'steps', better: 'up', daily: 'sum', hae: ['step_count'] },
  distance: { label: 'Walking + running distance', unit: 'km', better: 'up', daily: 'sum', hae: ['walking_running_distance'] },
  flights: { label: 'Flights climbed', unit: 'flights', better: 'up', daily: 'sum', hae: ['flights_climbed'] },
  activeKcal: { label: 'Active energy', unit: 'kcal', better: 'up', daily: 'sum', hae: ['active_energy'] },
  basalKcal: { label: 'Resting energy', unit: 'kcal', better: 'none', daily: 'sum', hae: ['basal_energy_burned'] },
  exerciseMin: { label: 'Exercise', unit: 'min', better: 'up', daily: 'sum', hae: ['apple_exercise_time'] },
  standHours: { label: 'Stand hours', unit: 'h', better: 'up', daily: 'sum', hae: ['apple_stand_hour'] },
  runPower: { label: 'Running power', unit: 'W', better: 'none', daily: 'avg', hae: ['running_power'] },
  runSpeed: { label: 'Running speed', unit: 'km/h', better: 'up', daily: 'avg', hae: ['running_speed'] },
  strideLength: { label: 'Stride length', unit: 'm', better: 'none', daily: 'avg', hae: ['running_stride_length'] },
  groundContact: { label: 'Ground contact', unit: 'ms', better: 'down', daily: 'avg', hae: ['running_ground_contact_time'] },
  vertOsc: { label: 'Vertical oscillation', unit: 'cm', better: 'down', daily: 'avg', hae: ['running_vertical_oscillation'] },
  weight: { label: 'Weight', unit: 'kg', better: 'none', daily: 'last', hae: ['weight_body_mass'] },
  daylightMin: { label: 'Time in daylight', unit: 'min', better: 'up', daily: 'sum', hae: ['time_in_daylight'] },
};

const HAE_INDEX = new Map<string, MetricKey>();
for (const [key, def] of Object.entries(METRICS) as [MetricKey, MetricDef][]) {
  for (const name of def.hae) HAE_INDEX.set(name, key);
}

export function metricFromHae(name: string): MetricKey | null {
  return HAE_INDEX.get(name) ?? null;
}
