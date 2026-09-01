// src/lib/axisEditorData.ts
import type { ReferenceData } from './referenceData';

export interface AxisType {
  id: number;
  key: string;
  label: string;
  lookupTable: string | null;
  hierarchical: boolean;
}

export interface Option {
  id: number;
  name: string;
}

export interface AxisValueEntry {
  axisType: string;
  refId: number | null;
  yearValue: number | null;
}

// The five lookup tables an axis type can point at — same set SongAxisEditor's web
// branch fetches individually (see LOOKUP_ENDPOINTS there), and, not by coincidence,
// exactly the field names ReferenceData already carries them under.
const LOOKUP_FIELDS = ['regions', 'genres', 'rhythms', 'dromoi', 'composers'] as const;
type LookupField = (typeof LOOKUP_FIELDS)[number];

function isLookupField(value: string): value is LookupField {
  return (LOOKUP_FIELDS as readonly string[]).includes(value);
}

// Pure — no I/O, no fetch. Turns a cached ReferenceData blob into exactly the shape
// SongAxisEditor's native branch needs to render: every axis type, and for each one that
// has a lookupTable, that table's already-owner-scoped options straight from the cache
// (src/app/api/reference-data/route.ts already filters regions/genres/rhythms/dromoi/
// composers to what this user can see — no re-filtering needed here). Total on its input:
// an axis type whose lookupTable isn't one of the five known fields is still included in
// axisTypes with no entry in optionsByAxis — SongAxisEditor's `optionsByAxis[key] ?? []`
// already treats a missing entry as no options, so this never needs to throw.
export function resolveAxisEditorData(referenceData: ReferenceData): { axisTypes: AxisType[]; optionsByAxis: Record<string, Option[]> } {
  const optionsByAxis: Record<string, Option[]> = {};
  for (const type of referenceData.axisTypes) {
    if (type.lookupTable && isLookupField(type.lookupTable)) {
      optionsByAxis[type.key] = referenceData[type.lookupTable];
    }
  }
  return { axisTypes: referenceData.axisTypes, optionsByAxis };
}
