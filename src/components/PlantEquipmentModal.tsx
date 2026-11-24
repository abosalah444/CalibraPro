import React, { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type {
  PlantEquipment,
  PlantEquipmentType,
  SetpointSpec,
  SwitchNormalContact,
  SwitchSpec,
  SwitchTripDirection,
} from '../types/calibration';
import {
  addDaysToDate,
  getPlantEquipmentType,
  isStaleZeroToHundredSetpoints,
  isStandardLinearSetpoints,
} from '../utils/calibrationMath';

export const FREQUENCY_PRESETS = [
  { days: 30, label: '30 Days (Monthly)' },
  { days: 90, label: '90 Days (Quarterly)' },
  { days: 180, label: '180 Days (Semi-Annual)' },
  { days: 365, label: '365 Days (Annual)' },
  { days: 730, label: '730 Days (Biennial)' },
];

export const buildDefaultSetpoints = (
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

export const buildSingleSwitchSetpoint = (
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

function createEmptyPlant(): Omit<PlantEquipment, 'id'> {
  const today = new Date().toISOString().slice(0, 10);
  return {
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
    lastCalibrationDate: today,
    nextDueDate: addDaysToDate(today, 180),
    status: 'In Tolerance',
    setpoints: buildDefaultSetpoints(0, 100, 'bar', 4, 20, 'mA', 0.08),
  };
}

interface PlantEquipmentModalProps {
  isOpen: boolean;
  editingItem?: PlantEquipment | null;
  onClose: () => void;
  onSave: (payload: Omit<PlantEquipment, 'id'>, existingId?: string) => Promise<void>;
}

export const PlantEquipmentModal: React.FC<PlantEquipmentModalProps> = ({
  isOpen,
  editingItem = null,
  onClose,
  onSave,
}) => {
  const [form, setForm] = useState<Omit<PlantEquipment, 'id'>>(createEmptyPlant);
  const [setpointsTouched, setSetpointsTouched] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    if (editingItem) {
      const resolvedType = getPlantEquipmentType(editingItem);
      const fallbackTrip =
        editingItem.setpoints[0]?.nominalInput ??
        Number(((editingItem.rangeMin + editingItem.rangeMax) / 2).toFixed(2));
      const fallbackTol = editingItem.setpoints[0]?.tolerancePlusMinus ?? 0.3;
      const isLinearOrStale =
        resolvedType === 'transmitter' &&
        (isStaleZeroToHundredSetpoints(editingItem) ||
          isStandardLinearSetpoints(
            editingItem.setpoints,
            editingItem.rangeMin,
            editingItem.rangeMax,
            editingItem.outputRangeMin,
            editingItem.outputRangeMax
          ));
      const hydratedSetpoints =
        resolvedType === 'transmitter' && isStaleZeroToHundredSetpoints(editingItem)
          ? buildDefaultSetpoints(
              editingItem.rangeMin,
              editingItem.rangeMax,
              editingItem.rangeUnit || 'bar',
              editingItem.outputRangeMin,
              editingItem.outputRangeMax,
              editingItem.outputUnit || 'mA',
              editingItem.setpoints[0]?.tolerancePlusMinus ?? 0.08
            )
          : editingItem.setpoints.map((s) => ({
              ...s,
              inputUnit: editingItem.rangeUnit || s.inputUnit,
              outputUnit:
                resolvedType === 'switch'
                  ? editingItem.rangeUnit || s.outputUnit
                  : editingItem.outputUnit || s.outputUnit,
            }));

      setSetpointsTouched(!isLinearOrStale);
      setForm({
        assetId: editingItem.assetId,
        tagName: editingItem.tagName,
        description: editingItem.description,
        manufacturer: editingItem.manufacturer,
        model: editingItem.model,
        serialNumber: editingItem.serialNumber,
        plantArea: editingItem.plantArea,
        category: editingItem.category,
        equipmentType: resolvedType,
        switchSpec:
          resolvedType === 'switch'
            ? editingItem.switchSpec || {
                tripDirection: 'Rising (High)',
                normalContact: 'NC (Normally Closed)',
                tripSetpoint: fallbackTrip,
                tolerancePlusMinus: fallbackTol,
                unit: editingItem.rangeUnit,
              }
            : undefined,
        frequencyDays: editingItem.frequencyDays,
        frequencyLabel: editingItem.frequencyLabel,
        rangeMin: editingItem.rangeMin,
        rangeMax: editingItem.rangeMax,
        rangeUnit: editingItem.rangeUnit,
        outputRangeMin: editingItem.outputRangeMin,
        outputRangeMax: editingItem.outputRangeMax,
        outputUnit: editingItem.outputUnit,
        toleranceSpec: editingItem.toleranceSpec,
        lastCalibrationDate: editingItem.lastCalibrationDate,
        nextDueDate: editingItem.nextDueDate,
        status: editingItem.status,
        setpoints: hydratedSetpoints,
      });
    } else {
      setSetpointsTouched(false);
      setForm(createEmptyPlant());
    }

    setErrorMsg(null);
    setSaving(false);
  }, [isOpen, editingItem]);

  if (!isOpen) return null;

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
        toleranceSpec: form.toleranceSpec.includes('Single-Point')
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
      await onSave(payload, editingItem?.id);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-md border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="font-display text-base font-bold text-slate-900">
            {editingItem
              ? `Edit Plant Equipment (${form.assetId})`
              : 'Add Plant Equipment Under Calibration'}
          </h2>
          <button
            type="button"
            onClick={onClose}
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
              onClick={onClose}
              className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : editingItem ? 'Save Asset' : 'Create Asset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
