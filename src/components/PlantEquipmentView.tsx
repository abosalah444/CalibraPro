import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Edit3,
  FileSpreadsheet,
  Plus,
  Search,
  ToggleLeft,
  Trash2,
  X,
} from 'lucide-react';
import type {
  PlantEquipment,
  PlantEquipmentType,
  PlantStatus,
} from '../types/calibration';
import {
  computePlantStatus,
  getPlantEquipmentType,
  getPlantEquipmentTypeLabel,
} from '../utils/calibrationMath';
import { ExcelBulkUploadModal } from './ExcelBulkUploadModal';
import { PlantEquipmentModal } from './PlantEquipmentModal';
import { PlantEquipmentDropdown } from './RichEquipmentDropdown';
import { PlantStatusLabel } from './StatusText';

interface PlantEquipmentViewProps {
  plantEquipment: PlantEquipment[];
  onCreate: (item: PlantEquipment) => Promise<void>;
  onUpdate: (item: PlantEquipment) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onBulkReplace: (items: PlantEquipment[]) => void;
  onCalibrateAsset: (plantId: string) => void;
}

export const PlantEquipmentView: React.FC<PlantEquipmentViewProps> = ({
  plantEquipment,
  onCreate,
  onUpdate,
  onDelete,
  onBulkReplace,
  onCalibrateAsset,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | PlantStatus>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | PlantEquipmentType>('ALL');
  const [selectedId, setSelectedId] = useState<string>(plantEquipment[0]?.id || '');

  const [modalOpen, setModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<PlantEquipment | null>(null);

  const enriched = useMemo(
    () =>
      plantEquipment.map((p) => ({
        ...p,
        resolvedType: getPlantEquipmentType(p),
        computedStatus: computePlantStatus(p),
      })),
    [plantEquipment]
  );

  const typeCounts = useMemo(() => {
    const transmitters = enriched.filter((p) => p.resolvedType === 'transmitter').length;
    const switches = enriched.filter((p) => p.resolvedType === 'switch').length;
    return { total: enriched.length, transmitters, switches };
  }, [enriched]);

  const selectedAsset = useMemo(
    () => enriched.find((p) => p.id === selectedId) || null,
    [enriched, selectedId]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter((item) => {
      if (typeFilter !== 'ALL' && item.resolvedType !== typeFilter) {
        return false;
      }
      if (statusFilter !== 'ALL' && item.computedStatus !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.assetId.toLowerCase().includes(q) ||
        item.tagName.toLowerCase().includes(q) ||
        item.plantArea.toLowerCase().includes(q) ||
        item.serialNumber.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        getPlantEquipmentTypeLabel(item.resolvedType).toLowerCase().includes(q)
      );
    });
  }, [enriched, search, statusFilter, typeFilter]);

  const openCreateModal = () => {
    setEditingItem(null);
    setModalOpen(true);
  };

  const openEditModal = (item: PlantEquipment) => {
    setEditingItem(item);
    setModalOpen(true);
  };

  const handleSaveModal = async (
    payload: Omit<PlantEquipment, 'id'>,
    existingId?: string
  ) => {
    if (existingId) {
      await onUpdate({ ...payload, id: existingId });
    } else {
      await onCreate({ ...payload, id: `plt-${Date.now()}` });
    }
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Plant Equipment Under Calibration
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Periodic calibration database containing unique asset identifiers, calibration frequencies, operating ranges, and test setpoints.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setBulkModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="h-4 w-4 text-blue-700" />
            Import Excel
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            Add Plant Asset
          </button>
        </div>
      </div>

      {bulkNotice && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
            <span>{bulkNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setBulkNotice(null)}
            className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Interactive Dropdown Inspector */}
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <PlantEquipmentDropdown
              items={plantEquipment}
              selectedId={selectedId}
              onSelect={(item) => setSelectedId(item.id)}
              label="Plant Asset Dropdown (Unique Asset IDs, Frequency Settings, Ranges & Setpoints)"
            />
          </div>
          <div className="lg:col-span-5">
            {selectedAsset ? (
              <div className="flex flex-col justify-between gap-2.5 rounded border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-900">
                    {selectedAsset.assetId} ·{' '}
                    <span
                      className={
                        selectedAsset.resolvedType === 'switch'
                          ? 'text-indigo-700'
                          : 'text-slate-600'
                      }
                    >
                      {getPlantEquipmentTypeLabel(selectedAsset.resolvedType)}
                    </span>{' '}
                    · {selectedAsset.plantArea}
                  </span>
                  <PlantStatusLabel status={selectedAsset.computedStatus} />
                </div>
                <div className="font-mono text-[11px] text-slate-600 tabular-nums">
                  {selectedAsset.resolvedType === 'switch' ? (
                    <span>
                      Single-Point Trip:{' '}
                      {selectedAsset.switchSpec?.tripSetpoint ??
                        selectedAsset.setpoints[0]?.nominalInput ??
                        '—'}{' '}
                      {selectedAsset.switchSpec?.unit || selectedAsset.rangeUnit} (±
                      {selectedAsset.switchSpec?.tolerancePlusMinus ??
                        selectedAsset.setpoints[0]?.tolerancePlusMinus ??
                        0.3}
                      ) · {selectedAsset.switchSpec?.tripDirection || 'Rising (High)'} ·{' '}
                      {selectedAsset.switchSpec?.normalContact || 'NC (Normally Closed)'}
                    </span>
                  ) : (
                    <span>
                      Setpoints:{' '}
                      {selectedAsset.setpoints
                        .map(
                          (s) =>
                            `${s.nominalInput}${selectedAsset.rangeUnit || s.inputUnit}→${s.expectedOutput}${selectedAsset.outputUnit || s.outputUnit}`
                        )
                        .join(' | ')}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="font-mono text-[11px] text-slate-500">
                    Next Due: {selectedAsset.nextDueDate}
                  </span>
                  <button
                    type="button"
                    onClick={() => onCalibrateAsset(selectedAsset.id)}
                    className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                  >
                    Calibrate in Studio
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                Select a plant asset from the dropdown to inspect its range and setpoints.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Plant Assets Table */}
      <section className="rounded-md border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Transmitter vs Switch Identifier Filter */}
            <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
              {(
                [
                  { id: 'ALL', label: `All Types (${typeCounts.total})` },
                  { id: 'transmitter', label: `Transmitters (${typeCounts.transmitters})` },
                  { id: 'switch', label: `Switches (${typeCounts.switches})` },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTypeFilter(t.id)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    typeFilter === t.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1">
              {(
                ['ALL', 'In Tolerance', 'Due Soon', 'Overdue', 'Out of Tolerance'] as const
              ).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    statusFilter === st
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st === 'ALL' ? 'All Status' : st}
                </button>
              ))}
            </div>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by Asset ID, type, tag, serial..."
              className="w-full rounded border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-50 text-[11px] text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-2.5 font-semibold">Asset ID</th>
                <th className="px-4 py-2.5 font-semibold">Type</th>
                <th className="px-4 py-2.5 font-semibold">Tag & Instrument</th>
                <th className="px-4 py-2.5 font-semibold">Frequency</th>
                <th className="px-4 py-2.5 font-semibold">Calibrated Range</th>
                <th className="px-4 py-2.5 font-semibold">Verification Points</th>
                <th className="px-4 py-2.5 font-semibold">Last / Next Due</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No plant assets match your filter.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const isSwitch = item.resolvedType === 'switch';
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-2.5 font-mono font-semibold text-blue-700 whitespace-nowrap">
                        {item.assetId}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {isSwitch ? (
                          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-indigo-700">
                            <ToggleLeft className="h-3.5 w-3.5 shrink-0" />
                            Switch
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] font-semibold text-slate-700">
                            Transmitter
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-900">{item.tagName}</div>
                        <div className="text-[11px] text-slate-500">
                          {item.manufacturer} {item.model} · {item.plantArea}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                        {item.frequencyLabel}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                        <div>
                          {item.rangeMin}–{item.rangeMax} {item.rangeUnit}
                        </div>
                        <div className="text-slate-500">
                          {isSwitch
                            ? `${item.switchSpec?.tripDirection || 'Rising (High)'}`
                            : `→ ${item.outputRangeMin}–${item.outputRangeMax} ${item.outputUnit}`}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600 tabular-nums">
                        {isSwitch ? (
                          <div>
                            <span className="font-semibold text-slate-800">
                              1-Pt Trip:{' '}
                              {item.switchSpec?.tripSetpoint ??
                                item.setpoints[0]?.nominalInput ??
                                '—'}{' '}
                              {item.switchSpec?.unit || item.rangeUnit}
                            </span>
                            <div className="text-slate-500">
                              ±
                              {item.switchSpec?.tolerancePlusMinus ??
                                item.setpoints[0]?.tolerancePlusMinus ??
                                0.3}{' '}
                              {item.switchSpec?.unit || item.rangeUnit} ·{' '}
                              {item.switchSpec?.normalContact === 'NO (Normally Open)'
                                ? 'NO'
                                : 'NC'}
                            </div>
                          </div>
                        ) : (
                          <span>
                            {item.setpoints.length} pts (
                            {item.setpoints.map((s) => s.nominalInput).join(', ')}{' '}
                            {item.rangeUnit})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] tabular-nums whitespace-nowrap">
                        <div className="text-slate-700">{item.lastCalibrationDate}</div>
                        <div className="text-slate-500">Due: {item.nextDueDate}</div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <PlantStatusLabel status={item.computedStatus} />
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onCalibrateAsset(item.id)}
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            Calibrate
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            aria-label={`Edit ${item.assetId}`}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-700 cursor-pointer"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(item.id)}
                            aria-label={`Delete ${item.assetId}`}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-rose-700 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Add/Edit Plant Equipment Modal */}
      <PlantEquipmentModal
        isOpen={modalOpen}
        editingItem={editingItem}
        onClose={() => setModalOpen(false)}
        onSave={handleSaveModal}
      />

      {bulkModalOpen && (
        <ExcelBulkUploadModal
          target="plant"
          existingPlant={plantEquipment}
          onClose={() => setBulkModalOpen(false)}
          onImportSuccess={(summary) => {
            if (summary.plantEquipment) {
              onBulkReplace(summary.plantEquipment);
            }
            setBulkNotice(
              `Excel import complete: ${summary.addedCount} added, ${summary.updatedCount} updated, ${summary.skippedCount} skipped.`
            );
            setBulkModalOpen(false);
          }}
        />
      )}
    </div>
  );
};
