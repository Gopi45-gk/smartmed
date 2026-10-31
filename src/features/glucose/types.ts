export type GlucoseContext = 'fasting' | 'before_meal' | 'after_meal' | 'bedtime' | 'random';
export type GlucoseUnit = 'mg/dL' | 'mmol/L';
export type GlucoseSource = 'manual' | 'voice' | 'lab_scan';
export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface GlucoseReading {
  id: string; // client-generated UUID
  patientId: string;
  value_mgdl: number;
  unit_entered: GlucoseUnit;
  context: GlucoseContext;
  measuredAt: string; // ISO 8601
  source: GlucoseSource;
  createdAt: string; // ISO 8601
  syncedAt?: string | null;
}

export interface GlucoseAlert {
  id: string;
  patient_id: string;
  rule_id: string;
  severity: AlertSeverity;
  message: string;
  value_mgdl?: number | null;
  context?: string | null;
  triggered_at: string;
  acknowledged?: boolean;
}

export interface GlucoseThresholds {
  patient_id: string;
  critical_low: number;
  critical_high: number;
  fasting_target_max: number;
  random_target_max: number;
  sudden_change_delta: number;
  sudden_change_window_hours: number;
  trend_days_count: number;
  cooldown_minutes: number;
}

export const DEFAULT_THRESHOLDS: GlucoseThresholds = {
  patient_id: 'default',
  critical_low: 70,
  critical_high: 250,
  fasting_target_max: 130,
  random_target_max: 180,
  sudden_change_delta: 100,
  sudden_change_window_hours: 3,
  trend_days_count: 3,
  cooldown_minutes: 180,
};

export interface GlucoseCorrelationInsight {
  patient_id: string;
  missed_doses_analyzed: number;
  avg_glucose_after_missed: number | null;
  avg_glucose_normal: number | null;
  correlation_detected: boolean;
  insight_summary: string;
}

export interface LocalAlertEvaluationResult {
  hasCriticalAlert: boolean;
  alert: GlucoseAlert | null;
}
