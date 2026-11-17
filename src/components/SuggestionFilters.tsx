import type { AxisOptions, FilterValue } from '@/lib/suggestions';
import { filterKey } from '@/lib/suggestions';
import {
  addFilter,
  addableAxes,
  closeAxisIfEmpty,
  removeFilter,
  valuesForAxis,
  visibleAxes,
} from '@/lib/filterState';

interface SuggestionFiltersProps {
  axes: AxisOptions[];
  appliedFilters: FilterValue[];
  onChange: (filters: FilterValue[], openAxes: string[]) => void;
  openAxes: string[];
  compact?: boolean;
}

// Filter columns for the suggestion list: one column per characteristic that has a chip or is open.
// Each column shows its selected values as removable chips, then a dropdown of the rest. A single
// "+ Χαρακτηριστικό" dropdown opens a column for a characteristic that has none yet.
// Controlled: the parent owns both the applied filters and the open columns.
export default function SuggestionFilters({ axes, appliedFilters, onChange, openAxes, compact = false }: SuggestionFiltersProps) {
  const visible = visibleAxes(axes, appliedFilters, openAxes);
  const addable = addableAxes(axes, visible);
  const btnSize = compact ? 'btn-xs' : 'btn-sm';

  function nameFor(axis: AxisOptions, f: FilterValue): string {
    const key = filterKey(f);
    const option = axis.options.find((o) => filterKey({ axisType: axis.axisType, refId: o.refId, yearValue: o.yearValue }) === key);
    return option?.name ?? '?';
  }

  return (
    <div className="flex flex-wrap items-start justify-center gap-3">
      {visible.map((axis) => {
        const chips = valuesForAxis(appliedFilters, axis.axisType);
        const selectedKeys = new Set(chips.map(filterKey));
        const remaining = axis.options.filter(
          (o) => !selectedKeys.has(filterKey({ axisType: axis.axisType, refId: o.refId, yearValue: o.yearValue }))
        );
        return (
          <div key={axis.axisType} className="flex min-w-[10rem] flex-col gap-1">
            <span className="text-xs font-semibold opacity-70">{axis.label}</span>
            <div className="flex flex-wrap gap-1">
              {chips.map((f) => {
                const next = removeFilter(appliedFilters, f);
                return (
                  <button
                    key={filterKey(f)}
                    type="button"
                    onClick={() => onChange(next, closeAxisIfEmpty(openAxes, next, axis.axisType))}
                    className={`btn ${btnSize} rounded-full btn-primary`}
                    aria-label={`Αφαίρεση ${axis.label}: ${nameFor(axis, f)}`}
                  >
                    {nameFor(axis, f)} <span aria-hidden="true">✕</span>
                  </button>
                );
              })}
            </div>
            {remaining.length > 0 && (
              <select
                className={`select ${btnSize} w-full`}
                value=""
                aria-label={`Προσθήκη τιμής: ${axis.label}`}
                onChange={(e) => {
                  const option = remaining[Number(e.target.value)];
                  if (!option) return;
                  const value: FilterValue = { axisType: axis.axisType, refId: option.refId, yearValue: option.yearValue };
                  onChange(addFilter(appliedFilters, value), openAxes);
                }}
              >
                <option value="" disabled>
                  Επιλογή…
                </option>
                {remaining.map((o, i) => (
                  <option key={filterKey({ axisType: axis.axisType, refId: o.refId, yearValue: o.yearValue })} value={i}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
      {addable.length > 0 && (
        <select
          className={`select ${btnSize}`}
          value=""
          aria-label="Προσθήκη χαρακτηριστικού"
          onChange={(e) => {
            const axis = addable.find((a) => a.axisType === e.target.value);
            if (!axis) return;
            onChange(appliedFilters, [...openAxes, axis.axisType]);
          }}
        >
          <option value="" disabled>
            + Χαρακτηριστικό
          </option>
          {addable.map((a) => (
            <option key={a.axisType} value={a.axisType}>
              {a.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
