import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
} from 'lucide-react';
import type { PlantEquipment } from '../types/calibration';
import {
  computePlantStatus,
  daysUntilDate,
  getPlantEquipmentType,
  getPlantEquipmentTypeLabel,
} from '../utils/calibrationMath';
import { PlantStatusLabel } from './StatusText';

interface PlantDeadlinesWidgetProps {
  plantEquipment: PlantEquipment[];
  selectedPlantId: string;
  onSelectPlant: (plant: PlantEquipment) => void;
  onOpenPlantView?: () => void;
}

type DeadlineFilter = 'all' | 'due30' | 'overdue';

export const PlantDeadlinesWidget: React.FC<PlantDeadlinesWidgetProps> = ({
  plantEquipment,
  selectedPlantId,
  onSelectPlant,
  onOpenPlantView,
}) => {
  const [filter, setFilter] = useState<DeadlineFilter>('all');
  const [collapsed, setCollapsed] = useState(false);

  const enrichedSorted = useMemo(() => {
    return plantEquipment
      .map((item) => {
        const daysLeft = daysUntilDate(item.nextDueDate);
        const computedStatus = computePlantStatus(item);
        const isDueWithin30 =
          daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;
        const isOverdue =
          (daysLeft !== null && daysLeft < 0) ||
          computedStatus === 'Overdue' ||
          computedStatus === 'Out of Tolerance';
        return {
          ...item,
          daysLeft,
          computedStatus,
          isDueWithin30,
          isOverdue,
        };
      })
      .sort((a, b) => {
        if (a.daysLeft === null && b.daysLeft === null) return 0;
        if (a.daysLeft === null) return 1;
        if (b.daysLeft === null) return -1;
        return a.daysLeft - b.daysLeft;
      });
  }, [plantEquipment]);

  const counts = useMemo(() => {
    const due30 = enrichedSorted.filter((item) => item.isDueWithin30).length;
    const overdue = enrichedSorted.filter((item) => item.isOverdue).length;
    return {
      total: enrichedSorted.length,
      due30,
      overdue,
    };
  }, [enrichedSorted]);

  const visibleRows = useMemo(() => {
    if (filter === 'due30') {
      return enrichedSorted.filter((item) => item.isDueWithin30);
    }
    if (filter === 'overdue') {
      return enrichedSorted.filter((item) => item.isOverdue);
    }
    return enrichedSorted;
  }, [enrichedSorted, filter]);

  const formatCountdown = (daysLeft: number | null): string => {
    if (daysLeft === null) return 'No due date';
    if (daysLeft < 0) {
      const abs = Math.abs(daysLeft);
      return `${abs}d overdue`;
    }
    if (daysLeft === 0) return 'Due today';
    if (daysLeft === 1) return 'Due in 1d';
    return `Due in ${daysLeft}d`;
  };

  return (
    <section
      aria-label="Upcoming Plant Calibration Deadlines"
      className="no-print mb-6 rounded-md border border-slate-200 bg-white"
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarClock className="h-4 w-4 shrink-0 text-slate-700" />
            <h2 className="font-display text-sm font-bold text-slate-900">
              Upcoming Plant Calibration Deadlines
            </h2>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
            <span
              className={
                counts.due30 > 0 ? 'font-semibold text-amber-700' : 'text-slate-600'
              }
            >
              {counts.due30} due within 30 days
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span
              className={
                counts.overdue > 0 ? 'font-semibold text-rose-700' : 'text-slate-600'
              }
            >
              {counts.overdue} overdue
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>{counts.total} total plant assets</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!collapsed && (
            <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({counts.total})
              </button>
              <button
                type="button"
                onClick={() => setFilter('due30')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === 'due30'
                    ? 'bg-white text-amber-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Next 30 Days ({counts.due30})
              </button>
              <button
                type="button"
                onClick={() => setFilter('overdue')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === 'overdue'
                    ? 'bg-white text-rose-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Overdue ({counts.overdue})
              </button>
            </div>
          )}

          {onOpenPlantView && (
            <button
              type="button"
              onClick={onOpenPlantView}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Manage Plant Assets
            </button>
          )}

          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {collapsed ? (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                Show Schedule
              </>
            ) : (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                Collapse
              </>
            )}
          </button>
        </div>
      </div>

      {/* Table Body */}
      {!collapsed && (
        <div className="border-t border-slate-200">
          {visibleRows.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-slate-500">
              <span>
                {counts.total === 0
                  ? 'No plant equipment records found in the database.'
                  : filter === 'due30'
                    ? 'No plant equipment is due within the next 30 days.'
                    : 'No overdue plant equipment found.'}
              </span>
              {filter !== 'all' && counts.total > 0 && (
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className="font-medium text-blue-700 hover:underline cursor-pointer whitespace-nowrap"
                >
                  Show all deadlines
                </button>
              )}
            </div>
          ) : (
            <div className="max-h-64 overflow-x-auto overflow-y-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-2 font-semibold">Asset ID</th>
                    <th className="px-4 py-2 font-semibold">Instrument & Area</th>
                    <th className="px-4 py-2 font-semibold">Frequency</th>
                    <th className="px-4 py-2 font-semibold">Next Due Date</th>
                    <th className="px-4 py-2 font-semibold">Window</th>
                    <th className="px-4 py-2 font-semibold">Status</th>
                    <th className="px-4 py-2 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.map((item) => {
                    const isSelected = item.id === selectedPlantId;
                    const rowBg = item.isDueWithin30
                      ? 'bg-amber-50/75 hover:bg-amber-50'
                      : item.isOverdue
                        ? 'bg-rose-50/45 hover:bg-rose-50/70'
                        : 'hover:bg-slate-50/80';

                    return (
                      <tr key={item.id} className={rowBg}>
                        <td className="px-4 py-2 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          {item.assetId}
                        </td>
                        <td className="px-4 py-2">
                          <div className="font-medium text-slate-900">
                            {item.tagName}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            <span
                              className={`font-mono font-semibold ${
                                getPlantEquipmentType(item) === 'switch'
                                  ? 'text-indigo-700'
                                  : 'text-slate-700'
                              }`}
                            >
                              {getPlantEquipmentTypeLabel(getPlantEquipmentType(item))}
                            </span>
                            {' · '}
                            {item.plantArea} · {item.category}
                          </div>
                        </td>
                        <td className="px-4 py-2 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                          {item.frequencyLabel}
                        </td>
                        <td className="px-4 py-2 font-mono tabular-nums text-slate-800 whitespace-nowrap">
                          {item.nextDueDate || '—'}
                        </td>
                        <td className="px-4 py-2 font-mono tabular-nums whitespace-nowrap">
                          {item.isDueWithin30 ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
                              <span aria-hidden="true" className="text-[10px]">
                                ▲
                              </span>
                              <span>{formatCountdown(item.daysLeft)}</span>
                              <span className="font-sans text-[11px] font-normal text-amber-700">
                                (≤ 30d)
                              </span>
                            </span>
                          ) : item.isOverdue ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
                              <span aria-hidden="true" className="text-[10px]">
                                ✖
                              </span>
                              <span>{formatCountdown(item.daysLeft)}</span>
                            </span>
                          ) : (
                            <span className="text-slate-600">
                              {formatCountdown(item.daysLeft)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <PlantStatusLabel status={item.computedStatus} />
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {isSelected ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Loaded in Studio
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onSelectPlant(item)}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-800 transition-colors hover:border-blue-600 hover:text-blue-700 cursor-pointer whitespace-nowrap"
                            >
                              Calibrate
                              <ArrowRight className="h-3 w-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
