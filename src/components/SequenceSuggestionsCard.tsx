'use client';

import type { SuggestionsResponsePayload } from '@/lib/suggestions';

// The "second window" alongside a fixed program's "Λίστα σειράς" — shows songs sharing
// characteristics with the sequence's current song (same toggle-chip mechanism as Live
// sessions), without ever touching or duplicating "Λίστα σειράς" itself. Tapping a suggestion
// is the caller's job (`onPick`) — this component is purely presentational.
export default function SequenceSuggestionsCard({
  data,
  onToggleAxis,
  onPick,
}: {
  data: SuggestionsResponsePayload;
  onToggleAxis: (key: string) => void;
  onPick: (songId: number) => void;
}) {
  const items = data.mode === 'filtered' ? data.candidates : data.songs;
  const emptyLabel = data.mode === 'filtered' ? 'Καμία πρόταση' : 'Κανένα τραγούδι';

  return (
    <div className="card w-full bg-base-100 shadow lg:w-72 lg:shrink-0">
      <div className="card-body gap-2 p-4">
        <h2 className="text-sm font-semibold text-base-content/60">
          {data.mode === 'filtered' ? data.listTitle : 'Άλλα τραγούδια'}
        </h2>
        {data.availableAxisTypes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {data.availableAxisTypes.map((axis) => {
              const isActive = data.activeAxisTypes.includes(axis.key);
              return (
                <button
                  key={axis.key}
                  onClick={() => onToggleAxis(axis.key)}
                  className={`btn btn-xs rounded-full ${isActive ? 'btn-primary' : 'btn-outline'}`}
                >
                  {axis.label}: {axis.value}
                </button>
              );
            })}
          </div>
        )}
        <ul className="flex flex-col gap-1">
          {items.length === 0 ? (
            <li className="px-1 py-2 text-sm text-base-content/50">{emptyLabel}</li>
          ) : (
            items.map((s) => (
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
