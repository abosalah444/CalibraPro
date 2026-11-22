import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
  X,
} from 'lucide-react';
import type * as XLSXType from 'xlsx';
import type {
  CalibrationEquipment,
  CalibrationUser,
  PlantEquipment,
} from '../types/calibration';
import {
  downloadPlantExcelTemplate,
  downloadStandardsExcelTemplate,
  downloadUsersExcelTemplate,
  extractSheetRows,
  type ParsedRowResult,
  parsePlantEquipmentFromRows,
  parseStandardsFromRows,
  parseUsersFromRows,
  readExcelWorkbook,
} from '../utils/excelImport';

type ImportTarget = 'standards' | 'plant' | 'users';

interface ExcelBulkUploadModalProps {
  target: ImportTarget;
  existingStandards?: CalibrationEquipment[];
  existingPlant?: PlantEquipment[];
  existingUsers?: CalibrationUser[];
  onClose: () => void;
  onImportSuccess: (summary: {
    addedCount: number;
    updatedCount: number;
    skippedCount: number;
    standards?: CalibrationEquipment[];
    plantEquipment?: PlantEquipment[];
    users?: CalibrationUser[];
  }) => void;
}

export const ExcelBulkUploadModal: React.FC<ExcelBulkUploadModalProps> = ({
  target,
  existingStandards = [],
  existingPlant = [],
  existingUsers = [],
  onClose,
  onImportSuccess,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>('');
  const [workbook, setWorkbook] = useState<XLSXType.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [duplicateMode, setDuplicateMode] = useState<'upsert' | 'skip'>('upsert');
  const [isDragging, setIsDragging] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const parsedStandards: ParsedRowResult<CalibrationEquipment>[] = useMemo(() => {
    if (target !== 'standards' || rawRows.length === 0) return [];
    return parseStandardsFromRows(rawRows, existingStandards);
  }, [target, rawRows, existingStandards]);

  const parsedPlant: ParsedRowResult<PlantEquipment>[] = useMemo(() => {
    if (target !== 'plant' || rawRows.length === 0) return [];
    return parsePlantEquipmentFromRows(rawRows, existingPlant);
  }, [target, rawRows, existingPlant]);

  const parsedUsers: ParsedRowResult<CalibrationUser>[] = useMemo(() => {
    if (target !== 'users' || rawRows.length === 0) return [];
    return parseUsersFromRows(rawRows, existingUsers);
  }, [target, rawRows, existingUsers]);

  const activeResults =
    target === 'standards'
      ? parsedStandards
      : target === 'plant'
        ? parsedPlant
        : parsedUsers;

  const summaryStats = useMemo(() => {
    const validRows = activeResults.filter((r) => r.errors.length === 0);
    const errorRows = activeResults.filter((r) => r.errors.length > 0);
    const existingMatches = validRows.filter((r) => r.existsInDb).length;
    const newRecords = validRows.length - existingMatches;
    return {
      total: activeResults.length,
      valid: validRows.length,
      errors: errorRows.length,
      existingMatches,
      newRecords,
    };
  }, [activeResults]);

  const loadFile = async (file: File) => {
    setParseError(null);
    try {
      const { workbook: wb, sheetNames: names } = await readExcelWorkbook(file);
      if (names.length === 0) {
        setParseError('The uploaded workbook contains no sheets.');
        return;
      }
      setFileName(file.name);
      setWorkbook(wb);
      setSheetNames(names);
      const firstSheet = names[0];
      setSelectedSheet(firstSheet);
      const rows = extractSheetRows(wb, firstSheet);
      setRawRows(rows);
      if (rows.length === 0) {
        setParseError('The selected sheet has no data rows.');
      }
    } catch (err) {
      setParseError(
        err instanceof Error
          ? `Failed to read Excel file: ${err.message}`
          : 'Unable to parse uploaded file.'
      );
    }
  };

  const handleSheetChange = (sheet: string) => {
    setSelectedSheet(sheet);
    if (!workbook) return;
    const rows = extractSheetRows(workbook, sheet);
    setRawRows(rows);
    setParseError(rows.length === 0 ? 'The selected sheet has no data rows.' : null);
  };

  const handleCommitImport = async () => {
    const validItems = activeResults
      .filter((r) => r.errors.length === 0)
      .map((r) => r.item);

    if (validItems.length === 0) {
      setParseError('No valid rows available to import.');
      return;
    }

    setSubmitting(true);
    setParseError(null);
    try {
      const endpoint =
        target === 'standards'
          ? '/api/standards/bulk'
          : target === 'plant'
            ? '/api/plant-equipment/bulk'
            : '/api/users/bulk';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: validItems,
          mode: duplicateMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Bulk import failed.');
      }
      onImportSuccess(data);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Bulk import failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const isStandards = target === 'standards';
  const isUsers = target === 'users';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              {isStandards
                ? 'Mass Upload Calibration Equipment (Excel / CSV)'
                : isUsers
                  ? 'Mass Upload Calibration & Approval Personnel (Excel / CSV)'
                  : 'Mass Upload Plant Equipment Under Calibration (Excel / CSV)'}
            </h2>
            <p className="text-xs text-slate-500">
              {isStandards
                ? 'Upload an .xlsx, .xls, or .csv sheet with Standard Code, Instrument Name, Status, and Last Calibration Dates.'
                : isUsers
                  ? 'Upload an .xlsx, .xls, or .csv sheet with Full Name, Role / Title, License / Staff ID, Department, and Email.'
                  : 'Upload an .xlsx, .xls, or .csv sheet with Unique Asset IDs, Frequency Settings, Ranges, and Setpoints.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
          {/* Template & Upload Row */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 lg:col-span-5">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <FileSpreadsheet className="h-4 w-4 text-blue-700" />
                <span>1. Download Excel Template</span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
                {isStandards
                  ? 'Use the pre-formatted template with all required columns (Standard Code, Name, Serial, Accuracy, Last Calibration Date, Interval, Status).'
                  : isUsers
                    ? 'Use the pre-formatted template with Full Name, Role / Title, License / Staff ID, Department, Email, and Active columns.'
                    : 'Use the pre-formatted template. Setpoints accept "0:4 | 50:12 | 100:20" pairs or leave blank to auto-generate 5 linear points (0–100%).'}
              </p>
              <button
                type="button"
                onClick={() =>
                  isStandards
                    ? downloadStandardsExcelTemplate()
                    : isUsers
                      ? downloadUsersExcelTemplate()
                      : downloadPlantExcelTemplate()
                }
                className="mt-3 inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-blue-700" />
                Download .xlsx Template
              </button>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) loadFile(dropped);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-5 text-center transition-colors lg:col-span-7 ${
                isDragging
                  ? 'border-blue-600 bg-blue-50/70'
                  : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50/60'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  if (chosen) loadFile(chosen);
                }}
              />
              <Upload className="h-6 w-6 text-blue-700" />
              <p className="mt-2 font-semibold text-slate-900">
                {fileName
                  ? `Loaded: ${fileName}`
                  : '2. Drop your Excel (.xlsx, .xls, .csv) file here, or click to browse'}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Supports multi-sheet Excel workbooks and automatic date/setpoint parsing
              </p>
            </div>
          </div>

          {parseError && (
            <div className="flex items-center gap-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Sheet Selector, Duplicate Strategy & Preview Table */}
          {activeResults.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-4 font-mono text-xs tabular-nums">
                  <span>
                    Rows: <strong className="text-slate-900">{summaryStats.total}</strong>
                  </span>
                  <span className="text-emerald-700">
                    Valid: <strong>{summaryStats.valid}</strong>
                  </span>
                  <span className="text-blue-700">
                    New: <strong>{summaryStats.newRecords}</strong>
                  </span>
                  <span className="text-amber-700">
                    Matches Existing: <strong>{summaryStats.existingMatches}</strong>
                  </span>
                  {summaryStats.errors > 0 && (
                    <span className="text-rose-700">
                      Errors: <strong>{summaryStats.errors}</strong>
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {sheetNames.length > 1 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-slate-600">
                        Sheet:
                      </span>
                      <select
                        value={selectedSheet}
                        onChange={(e) => handleSheetChange(e.target.value)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        {sheetNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-slate-600">
                      Existing IDs:
                    </span>
                    <select
                      value={duplicateMode}
                      onChange={(e) =>
                        setDuplicateMode(e.target.value as 'upsert' | 'skip')
                      }
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      <option value="upsert">Update existing records</option>
                      <option value="skip">Skip existing duplicates</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="max-h-80 overflow-auto rounded-md border border-slate-200">
                <table className="w-full border-collapse text-left text-[11px]">
                  <thead className="sticky top-0 bg-slate-100 text-slate-700">
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2 font-semibold">Row</th>
                      <th className="px-3 py-2 font-semibold">
                        {isStandards
                          ? 'Standard Code'
                          : isUsers
                            ? 'License / Staff ID'
                            : 'Asset ID'}
                      </th>
                      <th className="px-3 py-2 font-semibold">
                        {isStandards
                          ? 'Instrument Name'
                          : isUsers
                            ? 'Full Name & Role'
                            : 'Tag Name'}
                      </th>
                      <th className="px-3 py-2 font-semibold">
                        {isStandards
                          ? 'Status / Last Cal'
                          : isUsers
                            ? 'Department / Email'
                            : 'Frequency / Range'}
                      </th>
                      <th className="px-3 py-2 font-semibold">
                        {isStandards
                          ? 'Due Date / Serial'
                          : isUsers
                            ? 'Active Status'
                            : 'Setpoints / Due Date'}
                      </th>
                      <th className="px-3 py-2 font-semibold">Validation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {isStandards
                      ? parsedStandards.map((r) => (
                          <tr
                            key={r.rowNumber}
                            className={
                              r.errors.length > 0 ? 'bg-rose-50/70' : 'hover:bg-slate-50'
                            }
                          >
                            <td className="px-3 py-2 font-mono text-slate-500">
                              #{r.rowNumber}
                            </td>
                            <td className="px-3 py-2 font-mono font-semibold text-slate-900">
                              {r.item.standardCode || '—'}
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-900">
                                {r.item.name || '—'}
                              </div>
                              <div className="text-slate-500">
                                {r.item.manufacturer} {r.item.model}
                              </div>
                            </td>
                            <td className="px-3 py-2 font-mono tabular-nums">
                              <div>{r.item.status}</div>
                              <div className="text-slate-500">
                                Last: {r.item.lastCalibrationDate}
                              </div>
                            </td>
                            <td className="px-3 py-2 font-mono tabular-nums">
                              <div>Due: {r.item.nextDueDate}</div>
                              <div className="text-slate-500">
                                S/N: {r.item.serialNumber}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              {r.errors.length > 0 ? (
                                <span className="font-medium text-rose-700">
                                  ✖ {r.errors.join(' ')}
                                </span>
                              ) : r.existsInDb ? (
                                <span className="font-medium text-amber-700">
                                  ▲ {duplicateMode === 'upsert' ? 'Will Update' : 'Will Skip'}
                                </span>
                              ) : (
                                <span className="font-medium text-emerald-700">
                                  ✓ Ready (New)
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      : isUsers
                        ? parsedUsers.map((r) => (
                            <tr
                              key={r.rowNumber}
                              className={
                                r.errors.length > 0 ? 'bg-rose-50/70' : 'hover:bg-slate-50'
                              }
                            >
                              <td className="px-3 py-2 font-mono text-slate-500">
                                #{r.rowNumber}
                              </td>
                              <td className="px-3 py-2 font-mono font-semibold text-slate-900">
                                {r.item.licenseId || '—'}
                              </td>
                              <td className="px-3 py-2">
                                <div className="font-medium text-slate-900">
                                  {r.item.fullName || '—'}
                                </div>
                                <div className="text-slate-500">{r.item.title}</div>
                              </td>
                              <td className="px-3 py-2 text-slate-700">
                                <div>{r.item.department || '—'}</div>
                                <div className="text-slate-500">{r.item.email || '—'}</div>
                              </td>
                              <td className="px-3 py-2 font-medium">
                                {r.item.active ? (
                                  <span className="text-emerald-700">● Active</span>
                                ) : (
                                  <span className="text-slate-500">○ Inactive</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {r.errors.length > 0 ? (
                                  <span className="font-medium text-rose-700">
                                    ✖ {r.errors.join(' ')}
                                  </span>
                                ) : r.existsInDb ? (
                                  <span className="font-medium text-amber-700">
                                    ▲ {duplicateMode === 'upsert' ? 'Will Update' : 'Will Skip'}
                                  </span>
                                ) : (
                                  <span className="font-medium text-emerald-700">
                                    ✓ Ready (New)
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))
                        : parsedPlant.map((r) => (
                            <tr
                              key={r.rowNumber}
                              className={
                                r.errors.length > 0 ? 'bg-rose-50/70' : 'hover:bg-slate-50'
                              }
                            >
                              <td className="px-3 py-2 font-mono text-slate-500">
                                #{r.rowNumber}
                              </td>
                              <td className="px-3 py-2 font-mono font-semibold text-blue-700">
                                <div>{r.item.assetId || '—'}</div>
                                <div className="text-[10px] font-medium text-slate-500">
                                  {r.item.equipmentType === 'switch' ? 'Switch' : 'Transmitter'}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="font-medium text-slate-900">
                                  {r.item.tagName || '—'}
                                </div>
                                <div className="text-slate-500">{r.item.plantArea}</div>
                              </td>
                              <td className="px-3 py-2 font-mono tabular-nums">
                                <div>{r.item.frequencyLabel}</div>
                                <div className="text-slate-500">
                                  {r.item.equipmentType === 'switch'
                                    ? `${r.item.rangeMin}–${r.item.rangeMax} ${r.item.rangeUnit} · Trip ${r.item.switchSpec?.tripSetpoint ?? r.item.setpoints[0]?.nominalInput ?? '—'} ${r.item.rangeUnit}`
                                    : `${r.item.rangeMin}–${r.item.rangeMax} ${r.item.rangeUnit} → ${r.item.outputRangeMin}–${r.item.outputRangeMax} ${r.item.outputUnit}`}
                                </div>
                              </td>
                              <td className="px-3 py-2 font-mono tabular-nums">
                                <div>
                                  {r.item.equipmentType === 'switch'
                                    ? '1-Pt Verification'
                                    : `${r.item.setpoints.length} Setpoints`}
                                </div>
                                <div className="text-slate-500">
                                  Due: {r.item.nextDueDate}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                {r.errors.length > 0 ? (
                                  <span className="font-medium text-rose-700">
                                    ✖ {r.errors.join(' ')}
                                  </span>
                                ) : r.existsInDb ? (
                                  <span className="font-medium text-amber-700">
                                    ▲ {duplicateMode === 'upsert' ? 'Will Update' : 'Will Skip'}
                                  </span>
                                ) : (
                                  <span className="font-medium text-emerald-700">
                                    ✓ Ready (New)
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <span className="text-[11px] text-slate-500">
            Rows with errors are automatically excluded from batch import.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || summaryStats.valid === 0}
              onClick={handleCommitImport}
              className="inline-flex items-center gap-1.5 rounded bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {submitting
                ? 'Importing...'
                : `Import ${summaryStats.valid} Valid ${
                    isStandards
                      ? 'Standards'
                      : isUsers
                        ? 'Personnel'
                        : 'Plant Assets'
                  }`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
