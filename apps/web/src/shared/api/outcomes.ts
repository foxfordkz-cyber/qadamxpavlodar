import type { ZoneAnalysis } from '../analytics/plan';
import type { RateEntry } from '../analytics/rates';
import type { CandidateSite, DataClass, Species } from './types';

export type DeepReadonly<T> = T extends readonly (infer U)[] ? readonly DeepReadonly<U>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OutcomeProvenance {
  source: 'mock' | 'api';
  capturedAt: string; // ISO timestamp with explicit timezone
  dataClass: DataClass;
  isDemo: boolean;
  evidenceIds: string[];
  siteVersion: number | null;
  ratesVersion: number | null;
}

/** Stable codes for UI translation; fields identify the missing/invalid input. */
export type OutcomeIssueCode =
  | 'empty_scheme' | 'invalid_quantity' | 'missing_species' | 'species_tier_mismatch'
  | 'invalid_probability' | 'missing_survival' | 'duplicate_survival' | 'invalid_rate'
  | 'missing_rate' | 'duplicate_rate' | 'invalid_price' | 'missing_area'
  | 'invalid_cost' | 'cost_mismatch' | 'analysis_site_mismatch'
  | 'mixed_planting' | 'no_trees' | 'wrong_horizon' | 'zero_expected_trees'
  | 'incomplete_cost' | 'incompatible_basis' | 'insufficient_variants'
  | 'missing_planting_date' | 'missing_forecast' | 'no_inspection'
  | 'unmatched_horizon' | 'incomplete_inspection' | 'cohort_mismatch';

export interface OutcomeIssue {
  code: OutcomeIssueCode;
  field?: string;
}

export interface OutcomeCost {
  basis: 'plan-cost-v1';
  scope: 'whole-tree-planting' | 'unallocated-mixed-planting';
  currency: 'KZT';
  careYears: number;
  complete: boolean;
  items: { key: string; amountKzt: number | null; dataClass: DataClass }[];
  totalKzt: number | null;
}

export interface OutcomeVariant {
  id: string;
  siteId: string;
  variant: ZoneAnalysis['options']['variant'];
  horizonYears: 3;
  treeCount: number | null;
  expectedTreesY3: number | null;
  cost: OutcomeCost;
  costPerExpectedTreeKzt: number | null;
  dataClass: 'estimate';
  isDemo: boolean;
  provenance: OutcomeProvenance;
  model: ZoneAnalysis['survivalModel'];
  /** Opaque equality key, not a security hash or a label for the UI. */
  comparisonKey: string;
  issues: OutcomeIssue[];
  assumptions: string[];
}

export interface OutcomeVariantInput {
  id: string;
  site: CandidateSite;
  analysis: ZoneAnalysis;
  catalog: Species[];
  rates: RateEntry[];
  provenance: OutcomeProvenance;
}

export interface OutcomeComparison {
  comparable: boolean;
  bestVariantIds: string[];
  eligibleVariantIds: string[];
  issues: OutcomeIssue[];
}

/** Persist the entire detached snapshot, never rebuild it using current prices/model. */
export type OutcomeForecastSnapshot = DeepReadonly<{
  schemaVersion: 1;
  analysis: ZoneAnalysis;
  catalog: Species[];
  rates: RateEntry[];
  provenance: OutcomeProvenance;
  outcome: OutcomeVariant;
}>;

export interface OutcomeCohort {
  id: string;
  siteId: string;
  plantedOn: string | null; // YYYY-MM-DD, local calendar date
  plants: { plantId: string; speciesId: string }[];
  forecast: OutcomeForecastSnapshot | null;
  provenance: OutcomeProvenance;
  version: number;
}

/** Backend resolves these from the existing registry and accepted planting/project links. */
export interface RegisteredOutcomePlant {
  plantId: string;
  speciesId: string;
  siteId: string;
  kind: 'tree' | 'shrub' | 'flower';
  plantedOn: string | null;
  isDemo: boolean;
}

export type OutcomeObservationState = 'alive' | 'dead' | 'unknown';
export interface OutcomeInspection {
  id: string;
  cohortId: string;
  observedOn: string; // one inspection campaign, not a merge of last-known states
  observations: {
    plantId: string;
    state: OutcomeObservationState;
    reportId: string | null;
    evidenceIds: string[];
  }[];
  provenance: OutcomeProvenance;
  version: number;
}

export interface OutcomeInspectionSummary {
  cohortId: string;
  inspectionId: string | null;
  total: number;
  inspected: number; // includes explicitly unknown observations
  assessed: number; // alive + dead
  alive: number;
  dead: number;
  unknown: number; // explicit unknown + no observation
  notInspected: number;
  inspectionCoveragePct: number | null;
  assessmentCoveragePct: number | null;
  survivalAmongAssessedPct: number | null;
  wholeCohortSurvivalPct: number | null; // only when every plant was assessed
  dataClass: DataClass;
  isDemo: boolean;
}

export interface OutcomeForecastComparison {
  comparable: boolean;
  horizonYears: 1 | 2 | 3 | null;
  expectedAlive: number | null;
  expectedSurvivalPct: number | null;
  observedSurvivalPct: number | null;
  differencePp: number | null; // observed - expected; not evidence of model accuracy
  issues: OutcomeIssue[];
}
