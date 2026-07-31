'use client';

import { useEffect, useState } from 'react';

interface AxisType {
  id: number;
  key: string;
  label: string;
  lookupTable: string | null;
  hierarchical: boolean;
}

interface Option {
  id: number;
  name: string;
}

export interface AxisValueEntry {
  axisType: string;
  refId: number | null;
  yearValue: number | null;
}

const LOOKUP_ENDPOINTS: Record<string, string> = {
  regions: '/api/regions',
  rhythms: '/api/rhythms',
  dromoi: '/api/dromoi',
  composers: '/api/composers',
};

export default function SongAxisEditor({
  value,
  onChange,
}: {
  value: AxisValueEntry[];
  onChange: (value: AxisValueEntry[]) => void;
}) {
  const [axisTypes, setAxisTypes] = useState<AxisType[]>([]);
  const [optionsByAxis, setOptionsByAxis] = useState<Record<string, Option[]>>({});
  const [newAxisType, setNewAxisType] = useState('');
  const [newRefId, setNewRefId] = useState('');
  const [newYear, setNewYear] = useState('');

  useEffect(() => {
    fetch('/api/axis-types')
      .then((r) => r.json())
      .then(async (types: AxisType[]) => {
        setAxisTypes(types);
        const entries = await Promise.all(
          types
            .filter((t) => t.lookupTable)
            .map(async (t) => {
              const res = await fetch(LOOKUP_ENDPOINTS[t.lookupTable as string]);
              const options: Option[] = await res.json();
              return [t.key, options] as const;
            })
        );
        setOptionsByAxis(Object.fromEntries(entries));
      });
  }, []);

  const usedAxisTypes = new Set(value.map((v) => v.axisType));
  const availableAxisTypes = axisTypes.filter((t) => !usedAxisTypes.has(t.key));
  const selectedType = axisTypes.find((t) => t.key === newAxisType);

  function labelFor(entry: AxisValueEntry): string {
    const axisType = axisTypes.find((t) => t.key === entry.axisType);
    if (!axisType) return entry.axisType;
    if (axisType.key === 'year') return `${axisType.label}: ${entry.yearValue}`;
    const options = optionsByAxis[axisType.key] ?? [];
    const option = options.find((o) => o.id === entry.refId);
    return `${axisType.label}: ${option?.name ?? entry.refId}`;
  }

  function handleAdd() {
    if (!selectedType) return;
    if (selectedType.key === 'year') {
      if (!newYear) return;
      onChange([...value, { axisType: selectedType.key, refId: null, yearValue: Number(newYear) }]);
    } else {
      if (!newRefId) return;
      onChange([...value, { axisType: selectedType.key, refId: Number(newRefId), yearValue: null }]);
    }
    setNewAxisType('');
    setNewRefId('');
    setNewYear('');
  }

  function handleRemove(axisType: string) {
    onChange(value.filter((v) => v.axisType !== axisType));
  }

  return (
    <div className="card border border-base-300 bg-base-100">
      <div className="card-body gap-2 p-4">
        <span className="text-sm font-semibold text-base-content/70">Άξονες / Tags</span>
        <div className="flex flex-wrap gap-2">
          {value.map((entry) => (
            <span key={entry.axisType} className="badge badge-lg badge-outline gap-2">
              {labelFor(entry)}
              <button
                type="button"
                onClick={() => handleRemove(entry.axisType)}
                aria-label="Αφαίρεση"
                className="cursor-pointer text-error"
              >
                ✕
              </button>
            </span>
          ))}
          {value.length === 0 && <span className="text-sm text-base-content/40">Κανένας άξονας ακόμη</span>}
        </div>
        {availableAxisTypes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <select
              value={newAxisType}
              onChange={(e) => {
                setNewAxisType(e.target.value);
                setNewRefId('');
                setNewYear('');
              }}
              className="select select-bordered select-sm"
            >
              <option value="">+ Πρόσθεσε άξονα...</option>
              {availableAxisTypes.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
            {selectedType?.key === 'year' && (
              <input
                type="number"
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
                placeholder="Έτος"
                className="input input-bordered input-sm w-28"
              />
            )}
            {selectedType && selectedType.key !== 'year' && (
              <select value={newRefId} onChange={(e) => setNewRefId(e.target.value)} className="select select-bordered select-sm">
                <option value="">Τιμή...</option>
                {(optionsByAxis[selectedType.key] ?? []).map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            )}
            {selectedType && (
              <button type="button" onClick={handleAdd} className="btn btn-primary btn-sm">
                Προσθήκη
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
