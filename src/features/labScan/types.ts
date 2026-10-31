export interface LabScanField {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  confidence: number; // 0.0 to 1.0
  source_text?: string | null;
  needs_review: boolean;
  min_plausible?: number;
  max_plausible?: number;
}

export interface LabScanResponse {
  fields: LabScanField[];
  raw_text: string;
  warnings: string[];
}

export interface LabScanReviewState {
  fields: Record<string, number | null>;
  units: Record<string, string>;
  needsReview: Record<string, boolean>;
  confidence: Record<string, number>;
}
