import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  CalibrationEquipment,
  StandardStatus,
} from '../types/calibration';
import { addDaysToDate, computeStandardStatus } from '../utils/calibrationMath';
import { ExcelBulkUploadModal } from './ExcelBulkUploadModal';
import { CalibrationStandardDropdown } from './RichEquipmentDropdown';
import { StandardStatusLabel } from './StatusText';

interface CalibrationStandardsViewProps {
  standards: CalibrationEquipment[];
  onCreate: (item: CalibrationEquipment) => Promise<CalibrationEquipment>;
  onUpdate: (item: CalibrationEquipment) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onBulkReplace: (items: CalibrationEquipment[]) => void;
  onUploadCertFile: (standardId: string, file: File) => Promise<CalibrationEquipment>;
  onDeleteCertFile: (standardId: string) => Promise<void>;
}

const ACCEPTED_CERT_TYPES =
  '.pdf,application/pdf,image/png,image/jpeg,image/webp,image/gif';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function validateCertFile(file: File): string | null {
  const allowed = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
  ];
  const extOk = /\.(pdf|png|jpe?g|webp|gif)$/i.test(file.name);
  if (!allowed.includes(file.type.toLowerCase()) && !extOk) {
    return 'Unsupported file format. Please select a PDF or image (PNG, JPG, WEBP, GIF).';
  }
  if (file.size > 15 * 1024 * 1024) {
    return 'File exceeds the 15 MB size limit.';
  }
  return null;
}

const EMPTY_STANDARD: Omit<CalibrationEquipment, 'id'> = {
  standardCode: '',
  name: '',
  manufacturer: '',
  model: '',
  serialNumber: '',
  category: 'Pressure',
  accuracySpec: '±0.02% FS',
  measurementRange: '0 to 100 bar',
  lastCalibrationDate: new Date().toISOString().slice(0, 10),
  nextDueDate: addDaysToDate(new Date().toISOString().slice(0, 10), 365),
  calibrationIntervalDays: 365,
  certificateRef: '',
  traceabilityLab: '',
  status: 'Valid',
  notes: '',
};

export const CalibrationStandardsView: React.FC<
  CalibrationStandardsViewProps
> = ({
  standards,
  onCreate,
  onUpdate,
  onDelete,
  onBulkReplace,
  onUploadCertFile,
  onDeleteCertFile,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | StandardStatus>('ALL');
  const [inspectedId, setInspectedId] = useState<string>(standards[0]?.id || '');

  const [modalOpen, setModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<CalibrationEquipment, 'id'>>(EMPTY_STANDARD);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [removeExistingFileOnSave, setRemoveExistingFileOnSave] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [viewerStandardId, setViewerStandardId] = useState<string | null>(null);
  const [fileBusyId, setFileBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const quickUploadInputRef = useRef<HTMLInputElement | null>(null);
  const quickUploadTargetIdRef = useRef<string | null>(null);
  const modalFileInputRef = useRef<HTMLInputElement | null>(null);
  const viewerReplaceInputRef = useRef<HTMLInputElement | null>(null);

  const enriched = useMemo(
    () =>
      standards.map((s) => ({
        ...s,
        computedStatus: computeStandardStatus(s),
      })),
    [standards]
  );

  const counts = useMemo(() => {
    const valid = enriched.filter((s) => s.computedStatus === 'Valid').length;
    const dueSoon = enriched.filter((s) => s.computedStatus === 'Due Soon').length;
    const overdue = enriched.filter(
      (s) =>
        s.computedStatus === 'Overdue' ||
        s.computedStatus === 'Out for Calibration'
    ).length;
    return { total: enriched.length, valid, dueSoon, overdue };
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter((item) => {
      if (statusFilter !== 'ALL' && item.computedStatus !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.standardCode.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.manufacturer.toLowerCase().includes(q) ||
        item.model.toLowerCase().includes(q) ||
        item.serialNumber.toLowerCase().includes(q) ||
        item.certificateRef.toLowerCase().includes(q)
      );
    });
  }, [enriched, search, statusFilter]);

  const inspectedItem = useMemo(
    () => enriched.find((s) => s.id === inspectedId) || null,
    [enriched, inspectedId]
  );

  const editingStandard = useMemo(
    () => (editingId ? standards.find((s) => s.id === editingId) || null : null),
    [standards, editingId]
  );

  const viewerStandard = useMemo(
    () =>
      viewerStandardId
        ? standards.find((s) => s.id === viewerStandardId) || null
        : null,
    [standards, viewerStandardId]
  );

  const openCreateModal = () => {
    setEditingId(null);
    const today = new Date().toISOString().slice(0, 10);
    setForm({
      ...EMPTY_STANDARD,
      standardCode: `STD-${String(standards.length + 1).padStart(3, '0')}`,
      lastCalibrationDate: today,
      nextDueDate: addDaysToDate(today, 365),
    });
    setPendingFile(null);
    setRemoveExistingFileOnSave(false);
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openEditModal = (item: CalibrationEquipment) => {
    setEditingId(item.id);
    setForm({
      standardCode: item.standardCode,
      name: item.name,
      manufacturer: item.manufacturer,
      model: item.model,
      serialNumber: item.serialNumber,
      category: item.category,
      accuracySpec: item.accuracySpec,
      measurementRange: item.measurementRange,
      lastCalibrationDate: item.lastCalibrationDate,
      nextDueDate: item.nextDueDate,
      calibrationIntervalDays: item.calibrationIntervalDays,
      certificateRef: item.certificateRef,
      traceabilityLab: item.traceabilityLab,
      status: item.status,
      notes: item.notes || '',
      certificateFile: item.certificateFile ?? null,
    });
    setPendingFile(null);
    setRemoveExistingFileOnSave(false);
    setErrorMsg(null);
    setModalOpen(true);
  };

  const triggerQuickUpload = (standardId: string) => {
    quickUploadTargetIdRef.current = standardId;
    setActionError(null);
    if (quickUploadInputRef.current) {
      quickUploadInputRef.current.value = '';
      quickUploadInputRef.current.click();
    }
  };

  const handleDirectFileUpload = async (standardId: string, file: File) => {
    const validationErr = validateCertFile(file);
    if (validationErr) {
      setActionError(validationErr);
      return;
    }
    setFileBusyId(standardId);
    setActionError(null);
    try {
      await onUploadCertFile(standardId, file);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to upload certificate file.'
      );
    } finally {
      setFileBusyId(null);
    }
  };

  const handleQuickUploadInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    const targetId = quickUploadTargetIdRef.current;
    if (!file || !targetId) return;
    await handleDirectFileUpload(targetId, file);
  };

  const handleDeleteAttachedFile = async (standardId: string) => {
    setFileBusyId(standardId);
    setActionError(null);
    try {
      await onDeleteCertFile(standardId);
      if (viewerStandardId === standardId) {
        setViewerStandardId(null);
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to remove certificate file.'
      );
    } finally {
      setFileBusyId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.standardCode.trim() || !form.name.trim()) {
      setErrorMsg('Standard Code and Instrument Name are required.');
      return;
    }
    if (pendingFile) {
      const validationErr = validateCertFile(pendingFile);
      if (validationErr) {
        setErrorMsg(validationErr);
        return;
      }
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      if (editingId) {
        await onUpdate({ ...form, id: editingId });
        if (pendingFile) {
          await onUploadCertFile(editingId, pendingFile);
        } else if (removeExistingFileOnSave && editingStandard?.certificateFile) {
          await onDeleteCertFile(editingId);
        }
      } else {
        const created = await onCreate({ ...form, id: `std-${Date.now()}` });
        if (pendingFile) {
          await onUploadCertFile(created.id, pendingFile);
        }
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
            Calibration Equipment Database
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Complete registry of traceable reference standards, calibration statuses, and last calibration dates.
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
            Add Calibration Standard
          </button>
        </div>
      </div>

      <input
        ref={quickUploadInputRef}
        type="file"
        accept={ACCEPTED_CERT_TYPES}
        onChange={handleQuickUploadInputChange}
        className="hidden"
      />

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

      {actionError && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-900">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-700 hover:text-rose-900 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 4-column Summary Strip */}
      <div className="grid grid-cols-2 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-3">
          <div className="text-xs text-slate-500">Total Standards</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {counts.total}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-xs text-slate-500">Valid & Active</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {counts.valid}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-xs text-slate-500">Due Within 30 Days</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
            {counts.dueSoon}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-xs text-slate-500">Overdue / Out of Lab</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-rose-700 tabular-nums">
            {counts.overdue}
          </div>
        </div>
      </div>

      {/* Quick-Track Dropdown Selector */}
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <CalibrationStandardDropdown
              items={standards}
              selectedIds={inspectedId ? [inspectedId] : []}
              onToggleSelect={(item) => setInspectedId(item.id)}
              multiSelect={false}
              label="Quick-Track Calibration Equipment Dropdown (Status & Last Calibration Date)"
            />
          </div>
          <div className="lg:col-span-5">
            {inspectedItem ? (
              <div className="rounded border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-900">
                    {inspectedItem.standardCode} · {inspectedItem.serialNumber}
                  </span>
                  <StandardStatusLabel status={inspectedItem.computedStatus} />
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-2 font-mono text-[11px] text-slate-600 tabular-nums">
                  <span>Last Cal: {inspectedItem.lastCalibrationDate}</span>
                  <span>Next Due: {inspectedItem.nextDueDate}</span>
                  <span>Cert: {inspectedItem.certificateRef || '—'}</span>
                  <span>Acc: {inspectedItem.accuracySpec}</span>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-slate-200/80 pt-2">
                  {inspectedItem.certificateFile ? (
                    <button
                      type="button"
                      onClick={() => setViewerStandardId(inspectedItem.id)}
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium text-blue-700 hover:text-blue-900 cursor-pointer"
                    >
                      {inspectedItem.certificateFile.mimeType === 'application/pdf' ? (
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="truncate max-w-[200px]">
                        {inspectedItem.certificateFile.fileName}
                      </span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-500">
                      No certificate file attached
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={fileBusyId === inspectedItem.id}
                    onClick={() => triggerQuickUpload(inspectedItem.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 hover:text-blue-700 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                  >
                    <Upload className="h-3 w-3" />
                    {fileBusyId === inspectedItem.id
                      ? 'Uploading...'
                      : inspectedItem.certificateFile
                        ? 'Replace'
                        : 'Upload PDF / Image'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded border border-slate-200 bg-slate-50 px-3.5 py-4 text-xs text-slate-500">
                Select a standard from the dropdown to inspect its traceability summary.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Filter Toolbar & Full Database Grid */}
      <section className="rounded-md border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1">
            {(
              ['ALL', 'Valid', 'Due Soon', 'Overdue', 'Out for Calibration'] as const
            ).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st === 'ALL' ? 'All Standards' : st}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, model, serial, cert..."
              className="w-full rounded border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-50 text-[11px] text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-2.5 font-semibold">Code</th>
                <th className="px-4 py-2.5 font-semibold">Equipment / Model</th>
                <th className="px-4 py-2.5 font-semibold">Serial No.</th>
                <th className="px-4 py-2.5 font-semibold">Range & Accuracy</th>
                <th className="px-4 py-2.5 font-semibold">Last Calibration</th>
                <th className="px-4 py-2.5 font-semibold">Next Due</th>
                <th className="px-4 py-2.5 font-semibold">Cert Ref & File</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No calibration equipment records match your filter.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {item.standardCode}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">{item.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {item.manufacturer} {item.model} · {item.category}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-700 whitespace-nowrap">
                      {item.serialNumber}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-slate-700">
                      <div className="font-mono">{item.measurementRange}</div>
                      <div className="font-mono text-slate-500">{item.accuracySpec}</div>
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-800 whitespace-nowrap">
                      {item.lastCalibrationDate}
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-800 whitespace-nowrap">
                      {item.nextDueDate}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] whitespace-nowrap">
                      <div className="font-mono text-slate-600">
                        {item.certificateRef || '—'}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        {item.certificateFile ? (
                          <button
                            type="button"
                            onClick={() => setViewerStandardId(item.id)}
                            className="inline-flex items-center gap-1 font-medium text-blue-700 hover:text-blue-900 cursor-pointer"
                          >
                            {item.certificateFile.mimeType === 'application/pdf' ? (
                              <FileText className="h-3 w-3" />
                            ) : (
                              <ImageIcon className="h-3 w-3" />
                            )}
                            <span>
                              {item.certificateFile.mimeType === 'application/pdf'
                                ? 'View PDF'
                                : 'View Image'}
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={fileBusyId === item.id}
                            onClick={() => triggerQuickUpload(item.id)}
                            className="inline-flex items-center gap-1 font-medium text-slate-500 hover:text-blue-700 disabled:opacity-50 cursor-pointer"
                          >
                            <Upload className="h-3 w-3" />
                            <span>
                              {fileBusyId === item.id ? 'Uploading...' : 'Upload File'}
                            </span>
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <StandardStatusLabel status={item.computedStatus} />
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          aria-label={`Edit ${item.standardCode}`}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-700 cursor-pointer"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(item.id)}
                          aria-label={`Delete ${item.standardCode}`}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-rose-700 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h2 className="font-display text-base font-bold text-slate-900">
                {editingId
                  ? 'Edit Calibration Standard'
                  : 'Add Calibration Reference Standard'}
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Standard Code *
                  </label>
                  <input
                    required
                    type="text"
                    value={form.standardCode}
                    onChange={(e) =>
                      setForm({ ...form, standardCode: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block font-medium text-slate-700">
                    Instrument Name *
                  </label>
                  <input
                    required
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Category
                  </label>
                  <input
                    type="text"
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Measurement Range
                  </label>
                  <input
                    type="text"
                    value={form.measurementRange}
                    onChange={(e) =>
                      setForm({ ...form, measurementRange: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Accuracy Spec
                  </label>
                  <input
                    type="text"
                    value={form.accuracySpec}
                    onChange={(e) =>
                      setForm({ ...form, accuracySpec: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
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
                        nextDueDate: addDaysToDate(
                          val,
                          form.calibrationIntervalDays
                        ),
                      });
                    }}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Interval (Days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={form.calibrationIntervalDays}
                    onChange={(e) => {
                      const days = Number(e.target.value) || 365;
                      setForm({
                        ...form,
                        calibrationIntervalDays: days,
                        nextDueDate: addDaysToDate(form.lastCalibrationDate, days),
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
                    Operational Status
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        status: e.target.value as StandardStatus,
                      })
                    }
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="Valid">Valid</option>
                    <option value="Due Soon">Due Soon</option>
                    <option value="Overdue">Overdue</option>
                    <option value="Out for Calibration">Out for Calibration</option>
                    <option value="Retired">Retired</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Traceable Certificate Ref
                  </label>
                  <input
                    type="text"
                    value={form.certificateRef}
                    onChange={(e) =>
                      setForm({ ...form, certificateRef: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Traceability Lab
                  </label>
                  <input
                    type="text"
                    value={form.traceabilityLab}
                    onChange={(e) =>
                      setForm({ ...form, traceabilityLab: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
              </div>

              {/* Calibration Certificate Attachment (PDF or Image) */}
              <div className="rounded border border-slate-200 bg-slate-50 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-800">
                      Calibration Certificate Attachment (PDF or Image)
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Upload a scanned certificate or official PDF for this calibration standard (max 15 MB).
                    </div>
                  </div>
                  <input
                    ref={modalFileInputRef}
                    type="file"
                    accept={ACCEPTED_CERT_TYPES}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const validationErr = validateCertFile(file);
                      if (validationErr) {
                        setErrorMsg(validationErr);
                        return;
                      }
                      setErrorMsg(null);
                      setPendingFile(file);
                      setRemoveExistingFileOnSave(false);
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (modalFileInputRef.current) {
                        modalFileInputRef.current.value = '';
                        modalFileInputRef.current.click();
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                  >
                    <Upload className="h-3.5 w-3.5 text-blue-700" />
                    {pendingFile || (editingStandard?.certificateFile && !removeExistingFileOnSave)
                      ? 'Change File'
                      : 'Select PDF / Image'}
                  </button>
                </div>

                {pendingFile ? (
                  <div className="mt-2.5 flex items-center justify-between gap-2 rounded border border-blue-200 bg-blue-50/70 px-3 py-2 text-[11px]">
                    <div className="flex items-center gap-2 min-w-0">
                      {pendingFile.type === 'application/pdf' ? (
                        <FileText className="h-4 w-4 shrink-0 text-blue-700" />
                      ) : (
                        <ImageIcon className="h-4 w-4 shrink-0 text-blue-700" />
                      )}
                      <span className="truncate font-medium text-slate-900">
                        {pendingFile.name}
                      </span>
                      <span className="font-mono text-slate-500 shrink-0">
                        ({formatFileSize(pendingFile.size)}) · Ready to upload on save
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingFile(null)}
                      className="text-slate-500 hover:text-rose-700 cursor-pointer shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ) : editingStandard?.certificateFile && !removeExistingFileOnSave ? (
                  <div className="mt-2.5 flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-[11px]">
                    <div className="flex items-center gap-2 min-w-0">
                      {editingStandard.certificateFile.mimeType === 'application/pdf' ? (
                        <FileText className="h-4 w-4 shrink-0 text-blue-700" />
                      ) : (
                        <ImageIcon className="h-4 w-4 shrink-0 text-blue-700" />
                      )}
                      <span className="truncate font-medium text-slate-900">
                        {editingStandard.certificateFile.fileName}
                      </span>
                      <span className="font-mono text-slate-500 shrink-0">
                        ({formatFileSize(editingStandard.certificateFile.sizeBytes)})
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => setViewerStandardId(editingStandard.id)}
                        className="inline-flex items-center gap-1 font-medium text-blue-700 hover:text-blue-900 cursor-pointer"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => setRemoveExistingFileOnSave(true)}
                        className="font-medium text-rose-700 hover:text-rose-900 cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : removeExistingFileOnSave ? (
                  <div className="mt-2.5 flex items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                    <span>Existing certificate file will be removed when you save.</span>
                    <button
                      type="button"
                      onClick={() => setRemoveExistingFileOnSave(false)}
                      className="font-medium text-amber-900 underline cursor-pointer"
                    >
                      Undo
                    </button>
                  </div>
                ) : null}
              </div>

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
                  {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Standard'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Certificate File Viewer Modal */}
      {viewerStandard && viewerStandard.certificateFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-900">
                    {viewerStandard.standardCode}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="truncate text-sm font-semibold text-slate-900">
                    {viewerStandard.name}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-slate-500">
                  <span className="truncate max-w-[320px]">
                    {viewerStandard.certificateFile.fileName}
                  </span>
                  <span>·</span>
                  <span>{formatFileSize(viewerStandard.certificateFile.sizeBytes)}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input
                  ref={viewerReplaceInputRef}
                  type="file"
                  accept={ACCEPTED_CERT_TYPES}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      await handleDirectFileUpload(viewerStandard.id, file);
                    }
                  }}
                  className="hidden"
                />
                <a
                  href={`${viewerStandard.certificateFile.url}${
                    viewerStandard.certificateFile.url.includes('?') ? '&' : '?'
                  }download=1`}
                  download={viewerStandard.certificateFile.fileName}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
                <button
                  type="button"
                  disabled={fileBusyId === viewerStandard.id}
                  onClick={() => {
                    if (viewerReplaceInputRef.current) {
                      viewerReplaceInputRef.current.value = '';
                      viewerReplaceInputRef.current.click();
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {fileBusyId === viewerStandard.id ? 'Uploading...' : 'Replace'}
                </button>
                <button
                  type="button"
                  disabled={fileBusyId === viewerStandard.id}
                  onClick={() => handleDeleteAttachedFile(viewerStandard.id)}
                  className="inline-flex items-center gap-1.5 rounded border border-rose-200 bg-rose-50 px-3 py-1.5 font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => setViewerStandardId(null)}
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100 cursor-pointer"
                  aria-label="Close certificate viewer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-slate-100 p-4">
              {viewerStandard.certificateFile.mimeType === 'application/pdf' ? (
                <iframe
                  title={`${viewerStandard.standardCode} Calibration Certificate`}
                  src={viewerStandard.certificateFile.url}
                  className="h-full w-full rounded border border-slate-200 bg-white"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <img
                    src={viewerStandard.certificateFile.url}
                    alt={`${viewerStandard.standardCode} Calibration Certificate`}
                    className="max-h-full max-w-full rounded border border-slate-200 bg-white object-contain shadow-sm"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {bulkModalOpen && (
        <ExcelBulkUploadModal
          target="standards"
          existingStandards={standards}
          onClose={() => setBulkModalOpen(false)}
          onImportSuccess={(summary) => {
            if (summary.standards) {
              onBulkReplace(summary.standards);
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
