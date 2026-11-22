import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { CalibrationEquipment, PlantEquipment } from '../types/calibration';
import {
  computePlantStatus,
  computeStandardStatus,
  getPlantEquipmentType,
  getPlantEquipmentTypeLabel,
} from '../utils/calibrationMath';
import { PlantStatusLabel, StandardStatusLabel } from './StatusText';

interface PlantEquipmentDropdownProps {
  items: PlantEquipment[];
  selectedId: string;
  onSelect: (item: PlantEquipment) => void;
  label?: string;
}

export const PlantEquipmentDropdown: React.FC<PlantEquipmentDropdownProps> = ({
  items,
  selectedId,
  onSelect,
  label = 'Plant Equipment Under Calibration',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) || null,
    [items, selectedId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.assetId.toLowerCase().includes(q) ||
        i.tagName.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.plantArea.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q)
    );
  }, [items, query]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-1.5 block text-xs font-semibold text-slate-700">
        {label}
      </label>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-left transition-colors hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 cursor-pointer"
      >
        {selected ? (
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-mono text-sm font-semibold text-slate-900">
                {selected.assetId}
              </span>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <span
                className={`font-mono text-xs font-semibold ${
                  getPlantEquipmentType(selected) === 'switch'
                    ? 'text-indigo-700'
                    : 'text-slate-600'
                }`}
              >
                {getPlantEquipmentTypeLabel(getPlantEquipmentType(selected))}
              </span>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <span className="truncate text-sm font-medium text-slate-800">
                {selected.tagName}
              </span>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <PlantStatusLabel status={computePlantStatus(selected)} />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 font-mono tabular-nums">
              <span>Freq: {selected.frequencyLabel}</span>
              <span aria-hidden="true">·</span>
              <span>
                Range: {selected.rangeMin}–{selected.rangeMax} {selected.rangeUnit}
              </span>
              <span aria-hidden="true">·</span>
              {getPlantEquipmentType(selected) === 'switch' ? (
                <span>
                  1-Pt Trip:{' '}
                  {selected.switchSpec?.tripSetpoint ??
                    selected.setpoints[0]?.nominalInput ??
                    '—'}{' '}
                  {selected.switchSpec?.unit || selected.rangeUnit}
                </span>
              ) : (
                <span>{selected.setpoints.length} Setpoints</span>
              )}
            </div>
          </div>
        ) : (
          <span className="text-sm text-slate-500">
            Select plant asset by unique ID, frequency, range & setpoints...
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1.5 rounded-md border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-200 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by Asset ID, tag, area, or range..."
                className="w-full rounded border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-4 py-4 text-center text-xs text-slate-500">
                No plant equipment matches your search.
              </li>
            ) : (
              filtered.map((item) => {
                const isSelected = item.id === selectedId;
                const liveStatus = computePlantStatus(item);
                const eqType = getPlantEquipmentType(item);
                const isSwitch = eqType === 'switch';
                const setpointSummary = item.setpoints
                  .map((s) => `${s.nominalInput}`)
                  .join(', ');
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(item);
                        setOpen(false);
                      }}
                      className={`flex w-full items-start justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50 cursor-pointer ${
                        isSelected ? 'bg-blue-50/60' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <span className="font-mono text-xs font-semibold text-blue-700">
                            {item.assetId}
                          </span>
                          <span className="text-slate-300" aria-hidden="true">
                            ·
                          </span>
                          <span
                            className={`font-mono text-[11px] font-semibold ${
                              isSwitch ? 'text-indigo-700' : 'text-slate-600'
                            }`}
                          >
                            {getPlantEquipmentTypeLabel(eqType)}
                          </span>
                          <span className="text-slate-300" aria-hidden="true">
                            /
                          </span>
                          <span className="text-xs font-semibold text-slate-900">
                            {item.tagName}
                          </span>
                          <span className="text-slate-300" aria-hidden="true">
                            ·
                          </span>
                          <PlantStatusLabel status={liveStatus} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-600 font-mono tabular-nums">
                          <span>Freq: {item.frequencyLabel}</span>
                          <span aria-hidden="true">·</span>
                          {isSwitch ? (
                            <span>
                              Range: {item.rangeMin}–{item.rangeMax} {item.rangeUnit} ·{' '}
                              {item.switchSpec?.tripDirection || 'Rising (High)'}
                            </span>
                          ) : (
                            <span>
                              Range: {item.rangeMin}–{item.rangeMax} {item.rangeUnit} →{' '}
                              {item.outputRangeMin}–{item.outputRangeMax} {item.outputUnit}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-500 font-mono tabular-nums">
                          {isSwitch
                            ? `1-Pt Trip: ${
                                item.switchSpec?.tripSetpoint ??
                                item.setpoints[0]?.nominalInput ??
                                '—'
                              } ${item.switchSpec?.unit || item.rangeUnit} (±${
                                item.switchSpec?.tolerancePlusMinus ??
                                item.setpoints[0]?.tolerancePlusMinus ??
                                '—'
                              })`
                            : `Setpoints (${item.setpoints.length}): [${setpointSummary}] ${item.rangeUnit}`}
                          {' · '}Last Cal: {item.lastCalibrationDate || '—'}
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="mt-1 h-4 w-4 shrink-0 text-blue-700" />
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

interface CalibrationStandardDropdownProps {
  items: CalibrationEquipment[];
  selectedIds: string[];
  onToggleSelect: (item: CalibrationEquipment) => void;
  multiSelect?: boolean;
  label?: string;
}

export const CalibrationStandardDropdown: React.FC<
  CalibrationStandardDropdownProps
> = ({
  items,
  selectedIds,
  onToggleSelect,
  multiSelect = true,
  label = 'Calibration Reference Equipment (Status & Last Cal Dates)',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedItems = useMemo(
    () => items.filter((i) => selectedIds.includes(i.id)),
    [items, selectedIds]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.standardCode.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        i.manufacturer.toLowerCase().includes(q) ||
        i.model.toLowerCase().includes(q) ||
        i.serialNumber.toLowerCase().includes(q) ||
        computeStandardStatus(i).toLowerCase().includes(q)
    );
  }, [items, query]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-1.5 block text-xs font-semibold text-slate-700">
        {label}
      </label>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-left transition-colors hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 cursor-pointer"
      >
        {selectedItems.length > 0 ? (
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-mono text-sm font-semibold text-slate-900">
                {selectedItems.map((s) => s.standardCode).join(', ')}
              </span>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <span className="truncate text-sm text-slate-700">
                {selectedItems.length === 1
                  ? `${selectedItems[0].manufacturer} ${selectedItems[0].model}`
                  : `${selectedItems.length} reference standards linked`}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 font-mono tabular-nums">
              <StandardStatusLabel status={computeStandardStatus(selectedItems[0])} />
              <span aria-hidden="true">·</span>
              <span>Last Cal: {selectedItems[0].lastCalibrationDate}</span>
              <span aria-hidden="true">·</span>
              <span>Due: {selectedItems[0].nextDueDate}</span>
            </div>
          </div>
        ) : (
          <span className="text-sm text-slate-500">
            Select calibration standard(s) — view status & last calibration date...
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1.5 rounded-md border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-200 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search standards by code, model, serial, or status..."
                className="w-full rounded border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-4 py-4 text-center text-xs text-slate-500">
                No calibration equipment matches your search.
              </li>
            ) : (
              filtered.map((item) => {
                const isSelected = selectedIds.includes(item.id);
                const liveStatus = computeStandardStatus(item);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onToggleSelect(item);
                        if (!multiSelect) setOpen(false);
                      }}
                      className={`flex w-full items-start justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50 cursor-pointer ${
                        isSelected ? 'bg-blue-50/60' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <span className="font-mono text-xs font-semibold text-slate-900">
                            {item.standardCode}
                          </span>
                          <span className="text-slate-300" aria-hidden="true">
                            /
                          </span>
                          <span className="text-xs font-medium text-slate-800">
                            {item.manufacturer} {item.model} — {item.name}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 text-[11px] font-mono tabular-nums">
                          <StandardStatusLabel status={liveStatus} />
                          <span className="text-slate-300" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-slate-600">
                            Last Cal: {item.lastCalibrationDate || '—'}
                          </span>
                          <span className="text-slate-300" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-slate-600">
                            Due: {item.nextDueDate || '—'}
                          </span>
                          <span className="text-slate-300" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-slate-500">S/N: {item.serialNumber}</span>
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="mt-1 h-4 w-4 shrink-0 text-blue-700" />
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
