'use client';

import type { FilterValue, SuggestionsResponsePayload } from '@/lib/suggestions';
import SuggestionFilters from '@/components/SuggestionFilters';

// The "second window" alongside a fixed program's "Λίστα σειράς" — shows songs matching the
// filter columns (the same columns as Live sessions), without ever touching or duplicating
// "Λίστα σειράς" itself. Tapping a suggestion is the caller's job (`onPick`); the caller also owns
// the filter state (`appliedFilters`, `openAxes`) and reloads when `onFiltersChange` fires.
export default function SequenceSuggestionsCard({
  data,
  appliedFilters,
  openAxes,
  onFiltersChange,
  onPick,
}: {
  data: SuggestionsResponsePayload;
  appliedFilters: FilterValue[];
  openAxes: string[];
  onFiltersChange: (filters: FilterValue[], openAxes: string[]) => void;
  onPick: (songId: number) => void;
}) {
  const emptyLabel = data.mode === 'filtered' ? 'Καμία πρόταση' : 'Κανένα τραγούδι';

  return (
    <div className="card w-full bg-base-100 shadow lg:w-72 lg:shrink-0">
      <div className="card-body gap-2 p-4">
        <h2 className="text-sm font-semibold text-base-content/60">
          {data.mode === 'filtered' ? 'Προτάσεις' : 'Άλλα τραγούδια'}
        </h2>
        <SuggestionFilters
          axes={data.axes}
          appliedFilters={appliedFilters}
          openAxes={openAxes}
          onChange={onFiltersChange}
          compact
        />
        <ul className="flex flex-col gap-1">
          {data.candidates.length === 0 ? (
            <li className="px-1 py-2 text-sm text-base-content/50">{emptyLabel}</li>
          ) : (
            data.candidates.map((s) => (
              <li key={s.id}>
                <button onClick={() => onPick(s.id)} className="btn btn-ghost btn-sm w-full justify-start text-left">
                  {s.title}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
