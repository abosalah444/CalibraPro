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
  SetpointSpec,
  SwitchNormalContact,
  SwitchSpec,
  SwitchTripDirection,
} from '../types/calibration';
import {
  addDaysToDate,
  computePlantStatus,
  getPlantEquipmentType,
  getPlantEquipmentTypeLabel,
  isStaleZeroToHundredSetpoints,
  isStandardLinearSetpoints,
} from '../utils/calibrationMath';
import { ExcelBulkUploadModal } from './ExcelBulkUploadModal';
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

const FREQUENCY_PRESETS = [
  { days: 30, label: '30 Days (Monthly)' },
  { days: 90, label: '90 Days (Quarterly)' },
  { days: 180, label: '180 Days (Semi-Annual)' },
  { days: 365, label: '365 Days (Annual)' },
  { days: 730, label: '730 Days (Biennial)' },
];

const buildDefaultSetpoints = (
  minIn: number,
  maxIn: number,
  inUnit: string,
  minOut: number,
  maxOut: number,
  outUnit: string,
  tol = 0.08
): SetpointSpec[] => {
  const fractions = [
    { pct: 0, label: '0% Zero' },
    { pct: 0.25, label: '25% Span' },
    { pct: 0.5, label: '50% Mid' },
    { pct: 0.75, label: '75% Span' },
    { pct: 1, label: '100% Full' },
  ];
  return fractions.map((f, idx) => ({
    id: `sp-${Date.now()}-${idx}`,
    label: f.label,
    nominalInput: Number((minIn + (maxIn - minIn) * f.pct).toFixed(3)),
    inputUnit: inUnit,
    expectedOutput: Number((minOut + (maxOut - minOut) * f.pct).toFixed(3)),
    outputUnit: outUnit,
    tolerancePlusMinus: tol,
  }));
};

const buildSingleSwitchSetpoint = (
  tripSetpoint: number,
  unit: string,
  tol = 0.3
): SetpointSpec[] => [
  {
    id: `sp-${Date.now()}-0`,
    label: 'Switch Trip Point',
    nominalInput: tripSetpoint,
    inputUnit: unit,
    expectedOutput: tripSetpoint,
    outputUnit: unit,
    tolerancePlusMinus: tol,
  },
];

const EMPTY_PLANT: Omit<PlantEquipment, 'id'> = {
  assetId: '',
  tagName: '',
  description: '',
  manufacturer: '',
  model: '',
  serialNumber: '',
  plantArea: '',
  category: 'Pressure Transmitter',
  equipmentType: 'transmitter',
  switchSpec: undefined,
  frequencyDays: 180,
  frequencyLabel: '180 Days (Semi-Annual)',
  rangeMin: 0,
  rangeMax: 100,
  rangeUnit: 'bar',
  outputRangeMin: 4,
  outputRangeMax: 20,
  outputUnit: 'mA',
  toleranceSpec: '±0.08 mA (±0.5% Span)',
  lastCalibrationDate: new Date().toISOString().slice(0, 10),
  nextDueDate: addDaysToDate(new Date().toISOString().slice(0, 10), 180),
  status: 'In Tolerance',
  setpoints: buildDefaultSetpoints(0, 100, 'bar', 4, 20, 'mA', 0.08),
};

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<PlantEquipment, 'id'>>(EMPTY_PLANT);
  const [setpointsTouched, setSetpointsTouched] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    setEditingId(null);
    setSetpointsTouched(false);
    const today = new Date().toISOString().slice(0, 10);
    setForm({
      ...EMPTY_PLANT,
      equipmentType: 'transmitter',
      switchSpec: undefined,
      lastCalibrationDate: today,
      nextDueDate: addDaysToDate(today, 180),
      setpoints: buildDefaultSetpoints(0, 100, 'bar', 4, 20, 'mA', 0.08),
    });
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openEditModal = (item: PlantEquipment) => {
    const resolvedType = getPlantEquipmentType(item);
    const fallbackTrip = item.setpoints[0]?.nominalInput ?? Number(((item.rangeMin + item.rangeMax) / 2).toFixed(2));
    const fallbackTol = item.setpoints[0]?.tolerancePlusMinus ?? 0.3;
    const isLinearOrStale =
      resolvedType === 'transmitter' &&
      (isStaleZeroToHundredSetpoints(item) ||
        isStandardLinearSetpoints(
          item.setpoints,
          item.rangeMin,
          item.rangeMax,
          item.outputRangeMin,
          item.outputRangeMax
        ));
    const hydratedSetpoints =
      resolvedType === 'transmitter' && isStaleZeroToHundredSetpoints(item)
        ? buildDefaultSetpoints(
            item.rangeMin,
            item.rangeMax,
            item.rangeUnit || 'bar',
            item.outputRangeMin,
            item.outputRangeMax,
            item.outputUnit || 'mA',
            item.setpoints[0]?.tolerancePlusMinus ?? 0.08
          )
        : item.setpoints.map((s) => ({
            ...s,
            inputUnit: item.rangeUnit || s.inputUnit,
            outputUnit:
              resolvedType === 'switch'
                ? item.rangeUnit || s.outputUnit
                : item.outputUnit || s.outputUnit,
          }));

    setEditingId(item.id);
    setSetpointsTouched(!isLinearOrStale);
    setForm({
      assetId: item.assetId,
      tagName: item.tagName,
      description: item.description,
      manufacturer: item.manufacturer,
      model: item.model,
      serialNumber: item.serialNumber,
      plantArea: item.plantArea,
      category: item.category,
      equipmentType: resolvedType,
      switchSpec:
        resolvedType === 'switch'
          ? item.switchSpec || {
              tripDirection: 'Rising (High)',
              normalContact: 'NC (Normally Closed)',
              tripSetpoint: fallbackTrip,
              tolerancePlusMinus: fallbackTol,
              unit: item.rangeUnit,
            }
          : undefined,
      frequencyDays: item.frequencyDays,
      frequencyLabel: item.frequencyLabel,
      rangeMin: item.rangeMin,
      rangeMax: item.rangeMax,
      rangeUnit: item.rangeUnit,
      outputRangeMin: item.outputRangeMin,
      outputRangeMax: item.outputRangeMax,
      outputUnit: item.outputUnit,
      toleranceSpec: item.toleranceSpec,
      lastCalibrationDate: item.lastCalibrationDate,
      nextDueDate: item.nextDueDate,
      status: item.status,
      setpoints: hydratedSetpoints,
    });
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleSwitchEquipmentType = (nextType: PlantEquipmentType) => {
    if (nextType === 'switch') {
      const trip =
        form.switchSpec?.tripSetpoint ??
        Number(((form.rangeMin + form.rangeMax) / 2).toFixed(2));
      const tol = form.switchSpec?.tolerancePlusMinus ?? 0.3;
      const unit = form.rangeUnit || 'bar';
      const nextSwitchSpec: SwitchSpec = {
        tripDirection: form.switchSpec?.tripDirection || 'Rising (High)',
        normalContact: form.switchSpec?.normalContact || 'NC (Normally Closed)',
        tripSetpoint: trip,
        resetPoint: form.switchSpec?.resetPoint,
        tolerancePlusMinus: tol,
        unit,
      };
      setForm({
        ...form,
        equipmentType: 'switch',
        category:
          form.category === 'Pressure Transmitter'
            ? 'Pressure Switch'
            : form.category,
        outputRangeMin: 0,
        outputRangeMax: 1,
        outputUnit: 'Contact',
        toleranceSpec: `±${tol} ${unit} (Single-Point Trip)`,
        switchSpec: nextSwitchSpec,
        setpoints: buildSingleSwitchSetpoint(trip, unit, tol),
      });
    } else {
      const nextOutMin = form.outputUnit === 'Contact' ? 4 : form.outputRangeMin;
      const nextOutMax = form.outputUnit === 'Contact' ? 20 : form.outputRangeMax;
      const nextOutUnit = form.outputUnit === 'Contact' ? 'mA' : form.outputUnit;
      if (form.setpoints.length <= 1) {
        setSetpointsTouched(false);
      }
      setForm({
        ...form,
        equipmentType: 'transmitter',
        switchSpec: undefined,
        category:
          form.category === 'Pressure Switch'
            ? 'Pressure Transmitter'
            : form.category,
        outputRangeMin: nextOutMin,
        outputRangeMax: nextOutMax,
        outputUnit: nextOutUnit,
        toleranceSpec:
          form.toleranceSpec.includes('Single-Point')
            ? `±0.08 ${nextOutUnit} (±0.5% Span)`
            : form.toleranceSpec,
        setpoints:
          form.setpoints.length <= 1
            ? buildDefaultSetpoints(
                form.rangeMin,
                form.rangeMax,
                form.rangeUnit,
                nextOutMin,
                nextOutMax,
                nextOutUnit,
                0.08
              )
            : form.setpoints,
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.assetId.trim() || !form.tagName.trim()) {
      setErrorMsg('Unique Asset Identifier and Tag Name are required.');
      return;
    }

    const isSwitch = form.equipmentType === 'switch';
    const normalizedRangeMin = Number.isFinite(form.rangeMin) ? form.rangeMin : 0;
    const normalizedRangeMax = Number.isFinite(form.rangeMax) ? form.rangeMax : 100;
    const normalizedOutMin = Number.isFinite(form.outputRangeMin)
      ? form.outputRangeMin
      : 4;
    const normalizedOutMax = Number.isFinite(form.outputRangeMax)
      ? form.outputRangeMax
      : 20;
    const normalizedRangeUnit = form.rangeUnit.trim() || 'bar';
    const normalizedOutputUnit = isSwitch
      ? normalizedRangeUnit
      : form.outputUnit.trim() || 'mA';

    const activeSwitchSpec: SwitchSpec | undefined = isSwitch
      ? {
          tripDirection: form.switchSpec?.tripDirection || 'Rising (High)',
          normalContact: form.switchSpec?.normalContact || 'NC (Normally Closed)',
          tripSetpoint: form.switchSpec?.tripSetpoint ?? normalizedRangeMax,
          ...(form.switchSpec?.resetPoint !== undefined &&
          !Number.isNaN(form.switchSpec.resetPoint)
            ? { resetPoint: form.switchSpec.resetPoint }
            : {}),
          tolerancePlusMinus: form.switchSpec?.tolerancePlusMinus ?? 0.3,
          unit: normalizedRangeUnit,
        }
      : undefined;

    const needsRangeRegen =
      !isSwitch &&
      (!setpointsTouched ||
        isStaleZeroToHundredSetpoints({
          rangeMin: normalizedRangeMin,
          rangeMax: normalizedRangeMax,
          outputRangeMin: normalizedOutMin,
          outputRangeMax: normalizedOutMax,
          setpoints: form.setpoints,
        }));

    const syncedTransmitterSetpoints = needsRangeRegen
      ? buildDefaultSetpoints(
          normalizedRangeMin,
          normalizedRangeMax,
          normalizedRangeUnit,
          normalizedOutMin,
          normalizedOutMax,
          normalizedOutputUnit,
          form.setpoints[0]?.tolerancePlusMinus ?? 0.08
        )
      : form.setpoints.map((sp) => ({
          ...sp,
          inputUnit: normalizedRangeUnit,
          outputUnit: normalizedOutputUnit,
        }));

    const payload: Omit<PlantEquipment, 'id'> = {
      ...form,
      rangeMin: normalizedRangeMin,
      rangeMax: normalizedRangeMax,
      outputRangeMin: isSwitch ? 0 : normalizedOutMin,
      outputRangeMax: isSwitch ? 1 : normalizedOutMax,
      rangeUnit: normalizedRangeUnit,
      outputUnit: isSwitch ? 'Contact' : normalizedOutputUnit,
      equipmentType: isSwitch ? 'switch' : 'transmitter',
      switchSpec: activeSwitchSpec,
      setpoints:
        isSwitch && activeSwitchSpec
          ? buildSingleSwitchSetpoint(
              activeSwitchSpec.tripSetpoint,
              activeSwitchSpec.unit,
              activeSwitchSpec.tolerancePlusMinus
            )
          : syncedTransmitterSetpoints,
    };

    setSaving(true);
    setErrorMsg(null);
    try {
      if (editingId) {
        await onUpdate({ ...payload, id: editingId });
      } else {
        await onCreate({ ...payload, id: `plt-${Date.now()}` });
      }
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
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
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-md border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h2 className="font-display text-base font-bold text-slate-900">
                {editingId
                  ? `Edit Plant Equipment (${form.assetId})`
                  : 'Add Plant Equipment Under Calibration'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-5 text-xs">
              {errorMsg && (
                <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
                  {errorMsg}
                </div>
              )}

              {/* Asset Type Identifier Selector */}
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">
                      Instrument Type Identifier *
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Transmitters generate multi-point calibration certificates; Switches use single-point trip verification certificates.
                    </div>
                  </div>
                  <div className="flex items-center gap-1 rounded-md bg-slate-200/80 p-1">
                    <button
                      type="button"
                      onClick={() => handleSwitchEquipmentType('transmitter')}
                      className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        form.equipmentType !== 'switch'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Transmitter (Multi-Point)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSwitchEquipmentType('switch')}
                      className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        form.equipmentType === 'switch'
                          ? 'bg-white text-indigo-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Switch (Single-Point)
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Unique Asset ID *
                  </label>
                  <input
                    required
                    type="text"
                    placeholder={
                      form.equipmentType === 'switch' ? 'e.g. PSH-108' : 'e.g. PT-108C'
                    }
                    value={form.assetId}
                    onChange={(e) => setForm({ ...form, assetId: e.target.value })}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block font-medium text-slate-700">
                    Tag Name / Process Service *
                  </label>
                  <input
                    required
                    type="text"
                    value={form.tagName}
                    onChange={(e) => setForm({ ...form, tagName: e.target.value })}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Manufacturer
                  </label>
                  <input
                    type="text"
                    value={form.manufacturer}
                    onChange={(e) =>
                      setForm({ ...form, manufacturer: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Model
                  </label>
                  <input
                    type="text"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Serial Number
                  </label>
                  <input
                    type="text"
                    value={form.serialNumber}
                    onChange={(e) =>
                      setForm({ ...form, serialNumber: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Plant Area / Unit
                  </label>
                  <input
                    type="text"
                    value={form.plantArea}
                    onChange={(e) =>
                      setForm({ ...form, plantArea: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
              </div>

              {/* Frequency & Dates */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Calibration Frequency
                  </label>
                  <select
                    value={form.frequencyDays}
                    onChange={(e) => {
                      const days = Number(e.target.value);
                      const preset = FREQUENCY_PRESETS.find((p) => p.days === days);
                      setForm({
                        ...form,
                        frequencyDays: days,
                        frequencyLabel: preset ? preset.label : `${days} Days`,
                        nextDueDate: addDaysToDate(form.lastCalibrationDate, days),
                      });
                    }}
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    {FREQUENCY_PRESETS.map((p) => (
                      <option key={p.days} value={p.days}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Last Cal Date
                  </label>
                  <input
                    type="date"
                    value={form.lastCalibrationDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm({
                        ...form,
                        lastCalibrationDate: val,
                        nextDueDate: addDaysToDate(val, form.frequencyDays),
                      });
                    }}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Next Due Date
                  </label>
                  <input
                    type="date"
                    value={form.nextDueDate}
                    onChange={(e) =>
                      setForm({ ...form, nextDueDate: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Tolerance Spec
                  </label>
                  <input
                    type="text"
                    value={form.toleranceSpec}
                    onChange={(e) =>
                      setForm({ ...form, toleranceSpec: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
              </div>

              {/* Input / Output Ranges OR Single-Point Switch Configuration */}
              {form.equipmentType === 'switch' ? (
                <div className="space-y-3 rounded border border-indigo-200 bg-indigo-50/40 p-3.5">
                  <div className="font-semibold text-indigo-950">
                    Single-Point Switch Verification Configuration
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        Range Min
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={form.rangeMin}
                        onChange={(e) =>
                          setForm({ ...form, rangeMin: Number(e.target.value) })
                        }
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        Range Max
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={form.rangeMax}
                        onChange={(e) =>
                          setForm({ ...form, rangeMax: Number(e.target.value) })
                        }
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        Eng. Unit
                      </label>
                      <input
                        type="text"
                        value={form.rangeUnit}
                        onChange={(e) => {
                          const unit = e.target.value;
                          const trip = form.switchSpec?.tripSetpoint ?? form.rangeMax;
                          const tol = form.switchSpec?.tolerancePlusMinus ?? 0.3;
                          setForm({
                            ...form,
                            rangeUnit: unit,
                            toleranceSpec: `±${tol} ${unit} (Single-Point Trip)`,
                            switchSpec: {
                              tripDirection: form.switchSpec?.tripDirection || 'Rising (High)',
                              normalContact: form.switchSpec?.normalContact || 'NC (Normally Closed)',
                              tripSetpoint: trip,
                              resetPoint: form.switchSpec?.resetPoint,
                              tolerancePlusMinus: tol,
                              unit,
                            },
                            setpoints: buildSingleSwitchSetpoint(trip, unit, tol),
                          });
                        }}
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        Trip Setpoint *
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={form.switchSpec?.tripSetpoint ?? form.rangeMax}
                        onChange={(e) => {
                          const trip = Number(e.target.value);
                          const unit = form.rangeUnit || 'bar';
                          const tol = form.switchSpec?.tolerancePlusMinus ?? 0.3;
                          setForm({
                            ...form,
                            switchSpec: {
                              tripDirection: form.switchSpec?.tripDirection || 'Rising (High)',
                              normalContact: form.switchSpec?.normalContact || 'NC (Normally Closed)',
                              tripSetpoint: trip,
                              resetPoint: form.switchSpec?.resetPoint,
                              tolerancePlusMinus: tol,
                              unit,
                            },
                            setpoints: buildSingleSwitchSetpoint(trip, unit, tol),
                          });
                        }}
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono font-semibold"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        Reset Point (Opt.)
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={form.switchSpec?.resetPoint ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const resetPoint = raw === '' ? undefined : Number(raw);
                          setForm({
                            ...form,
                            switchSpec: {
                              tripDirection: form.switchSpec?.tripDirection || 'Rising (High)',
                              normalContact: form.switchSpec?.normalContact || 'NC (Normally Closed)',
                              tripSetpoint: form.switchSpec?.tripSetpoint ?? form.rangeMax,
                              resetPoint,
                              tolerancePlusMinus: form.switchSpec?.tolerancePlusMinus ?? 0.3,
                              unit: form.rangeUnit || 'bar',
                            },
                          });
                        }}
                        placeholder="Optional"
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        Tol (± {form.rangeUnit})
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={form.switchSpec?.tolerancePlusMinus ?? 0.3}
                        onChange={(e) => {
                          const tol = Number(e.target.value);
                          const unit = form.rangeUnit || 'bar';
                          const trip = form.switchSpec?.tripSetpoint ?? form.rangeMax;
                          setForm({
                            ...form,
                            toleranceSpec: `±${tol} ${unit} (Single-Point Trip)`,
                            switchSpec: {
                              tripDirection: form.switchSpec?.tripDirection || 'Rising (High)',
                              normalContact: form.switchSpec?.normalContact || 'NC (Normally Closed)',
                              tripSetpoint: trip,
                              resetPoint: form.switchSpec?.resetPoint,
                              tolerancePlusMinus: tol,
                              unit,
                            },
                            setpoints: buildSingleSwitchSetpoint(trip, unit, tol),
                          });
                        }}
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        Trip Action Direction
                      </label>
                      <select
                        value={form.switchSpec?.tripDirection || 'Rising (High)'}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            switchSpec: {
                              tripDirection: e.target.value as SwitchTripDirection,
                              normalContact: form.switchSpec?.normalContact || 'NC (Normally Closed)',
                              tripSetpoint: form.switchSpec?.tripSetpoint ?? form.rangeMax,
                              resetPoint: form.switchSpec?.resetPoint,
                              tolerancePlusMinus: form.switchSpec?.tolerancePlusMinus ?? 0.3,
                              unit: form.rangeUnit || 'bar',
                            },
                          })
                        }
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                      >
                        <option value="Rising (High)">Rising (High)</option>
                        <option value="Falling (Low)">Falling (Low)</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        Normal Contact State
                      </label>
                      <select
                        value={form.switchSpec?.normalContact || 'NC (Normally Closed)'}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            switchSpec: {
                              tripDirection: form.switchSpec?.tripDirection || 'Rising (High)',
                              normalContact: e.target.value as SwitchNormalContact,
                              tripSetpoint: form.switchSpec?.tripSetpoint ?? form.rangeMax,
                              resetPoint: form.switchSpec?.resetPoint,
                              tolerancePlusMinus: form.switchSpec?.tolerancePlusMinus ?? 0.3,
                              unit: form.rangeUnit || 'bar',
                            },
                          })
                        }
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                      >
                        <option value="NC (Normally Closed)">NC (Normally Closed)</option>
                        <option value="NO (Normally Open)">NO (Normally Open)</option>
                      </select>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Input / Output Ranges */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        In Min
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={form.rangeMin}
                        onChange={(e) => {
                          const rangeMin = Number(e.target.value);
                          setForm((prev) => {
                            const shouldSync =
                              !setpointsTouched ||
                              isStandardLinearSetpoints(
                                prev.setpoints,
                                prev.rangeMin,
                                prev.rangeMax,
                                prev.outputRangeMin,
                                prev.outputRangeMax
                              );
                            return {
                              ...prev,
                              rangeMin,
                              setpoints: shouldSync
                                ? buildDefaultSetpoints(
                                    rangeMin,
                                    prev.rangeMax,
                                    prev.rangeUnit,
                                    prev.outputRangeMin,
                                    prev.outputRangeMax,
                                    prev.outputUnit,
                                    prev.setpoints[0]?.tolerancePlusMinus ?? 0.08
                                  )
                                : prev.setpoints,
                            };
                          });
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        In Max
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={form.rangeMax}
                        onChange={(e) => {
                          const rangeMax = Number(e.target.value);
                          setForm((prev) => {
                            const shouldSync =
                              !setpointsTouched ||
                              isStandardLinearSetpoints(
                                prev.setpoints,
                                prev.rangeMin,
                                prev.rangeMax,
                                prev.outputRangeMin,
                                prev.outputRangeMax
                              );
                            return {
                              ...prev,
                              rangeMax,
                              setpoints: shouldSync
                                ? buildDefaultSetpoints(
                                    prev.rangeMin,
                                    rangeMax,
                                    prev.rangeUnit,
                                    prev.outputRangeMin,
                                    prev.outputRangeMax,
                                    prev.outputUnit,
                                    prev.setpoints[0]?.tolerancePlusMinus ?? 0.08
                                  )
                                : prev.setpoints,
                            };
                          });
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        In Unit
                      </label>
                      <input
                        type="text"
                        value={form.rangeUnit}
                        onChange={(e) => {
                          const rangeUnit = e.target.value;
                          setForm((prev) => ({
                            ...prev,
                            rangeUnit,
                            setpoints: prev.setpoints.map((sp) => ({
                              ...sp,
                              inputUnit: rangeUnit,
                            })),
                          }));
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        Out Min
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={form.outputRangeMin}
                        onChange={(e) => {
                          const outputRangeMin = Number(e.target.value);
                          setForm((prev) => {
                            const shouldSync =
                              !setpointsTouched ||
                              isStandardLinearSetpoints(
                                prev.setpoints,
                                prev.rangeMin,
                                prev.rangeMax,
                                prev.outputRangeMin,
                                prev.outputRangeMax
                              );
                            return {
                              ...prev,
                              outputRangeMin,
                              setpoints: shouldSync
                                ? buildDefaultSetpoints(
                                    prev.rangeMin,
                                    prev.rangeMax,
                                    prev.rangeUnit,
                                    outputRangeMin,
                                    prev.outputRangeMax,
                                    prev.outputUnit,
                                    prev.setpoints[0]?.tolerancePlusMinus ?? 0.08
                                  )
                                : prev.setpoints,
                            };
                          });
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        Out Max
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={form.outputRangeMax}
                        onChange={(e) => {
                          const outputRangeMax = Number(e.target.value);
                          setForm((prev) => {
                            const shouldSync =
                              !setpointsTouched ||
                              isStandardLinearSetpoints(
                                prev.setpoints,
                                prev.rangeMin,
                                prev.rangeMax,
                                prev.outputRangeMin,
                                prev.outputRangeMax
                              );
                            return {
                              ...prev,
                              outputRangeMax,
                              setpoints: shouldSync
                                ? buildDefaultSetpoints(
                                    prev.rangeMin,
                                    prev.rangeMax,
                                    prev.rangeUnit,
                                    prev.outputRangeMin,
                                    outputRangeMax,
                                    prev.outputUnit,
                                    prev.setpoints[0]?.tolerancePlusMinus ?? 0.08
                                  )
                                : prev.setpoints,
                            };
                          });
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        Out Unit
                      </label>
                      <input
                        type="text"
                        value={form.outputUnit}
                        onChange={(e) => {
                          const outputUnit = e.target.value;
                          setForm((prev) => ({
                            ...prev,
                            outputUnit,
                            setpoints: prev.setpoints.map((sp) => ({
                              ...sp,
                              outputUnit,
                            })),
                          }));
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono"
                      />
                    </div>
                  </div>

                  {/* Setpoints Builder */}
                  <div className="rounded border border-slate-200 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">
                        Configured Calibration Setpoints ({form.setpoints.length})
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSetpointsTouched(false);
                            setForm({
                              ...form,
                              setpoints: buildDefaultSetpoints(
                                form.rangeMin,
                                form.rangeMax,
                                form.rangeUnit,
                                form.outputRangeMin,
                                form.outputRangeMax,
                                form.outputUnit
                              ),
                            });
                          }}
                          className="rounded border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          Auto-Generate 5-Point (0–100%)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSetpointsTouched(true);
                            setForm({
                              ...form,
                              setpoints: [
                                ...form.setpoints,
                                {
                                  id: `sp-${Date.now()}`,
                                  label: `Pt ${form.setpoints.length + 1}`,
                                  nominalInput: form.rangeMax,
                                  inputUnit: form.rangeUnit,
                                  expectedOutput: form.outputRangeMax,
                                  outputUnit: form.outputUnit,
                                  tolerancePlusMinus: 0.08,
                                },
                              ],
                            });
                          }}
                          className="rounded border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          + Add Setpoint
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {form.setpoints.map((sp, idx) => (
                        <div
                          key={sp.id}
                          className="grid grid-cols-12 items-center gap-2 font-mono"
                        >
                          <input
                            type="text"
                            value={sp.label}
                            onChange={(e) => {
                              setSetpointsTouched(true);
                              const next = [...form.setpoints];
                              next[idx] = { ...sp, label: e.target.value };
                              setForm({ ...form, setpoints: next });
                            }}
                            className="col-span-3 rounded border border-slate-200 px-2 py-1 font-sans"
                          />
                          <div className="col-span-3 flex items-center gap-1">
                            <input
                              type="number"
                              step="any"
                              value={sp.nominalInput}
                              onChange={(e) => {
                                setSetpointsTouched(true);
                                const next = [...form.setpoints];
                                next[idx] = {
                                  ...sp,
                                  nominalInput: Number(e.target.value),
                                };
                                setForm({ ...form, setpoints: next });
                              }}
                              className="w-full rounded border border-slate-200 px-2 py-1"
                              title="Nominal Input"
                            />
                            <span className="shrink-0 text-[10px] text-slate-400">
                              {form.rangeUnit || sp.inputUnit}
                            </span>
                          </div>
                          <div className="col-span-3 flex items-center gap-1">
                            <input
                              type="number"
                              step="any"
                              value={sp.expectedOutput}
                              onChange={(e) => {
                                setSetpointsTouched(true);
                                const next = [...form.setpoints];
                                next[idx] = {
                                  ...sp,
                                  expectedOutput: Number(e.target.value),
                                };
                                setForm({ ...form, setpoints: next });
                              }}
                              className="w-full rounded border border-slate-200 px-2 py-1"
                              title="Expected Output"
                            />
                            <span className="shrink-0 text-[10px] text-slate-400">
                              {form.outputUnit || sp.outputUnit}
                            </span>
                          </div>
                          <input
                            type="number"
                            step="any"
                            value={sp.tolerancePlusMinus}
                            onChange={(e) => {
                              setSetpointsTouched(true);
                              const next = [...form.setpoints];
                              next[idx] = {
                                ...sp,
                                tolerancePlusMinus: Number(e.target.value),
                              };
                              setForm({ ...form, setpoints: next });
                            }}
                            className="col-span-2 rounded border border-slate-200 px-2 py-1"
                            title="± Tolerance"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setSetpointsTouched(true);
                              setForm({
                                ...form,
                                setpoints: form.setpoints.filter((_, i) => i !== idx),
                              });
                            }}
                            className="col-span-1 flex justify-center p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Saving...' : editingId ? 'Save Asset' : 'Create Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
