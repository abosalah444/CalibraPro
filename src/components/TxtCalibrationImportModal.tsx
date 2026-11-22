import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  FileUp,
  Gauge,
  ToggleLeft,
  Upload,
  X,
} from 'lucide-react';
import type {
  CalibrationCertificate,
  CalibrationEquipment,
  DigitalSignature,
  LabSettings,
  PlantEquipment,
} from '../types/calibration';
import {
  computeCertificateHash,
  evaluateReadings,
  formatSignedNumber,
} from '../utils/calibrationMath';
import { exportCertificateToPdf } from '../utils/pdfGenerator';
import {
  type ParsedTxtCalibrationReport,
  parseCalibrationTxtReport,
} from '../utils/txtCalibrationParser';
import { CertificateResultLabel } from './StatusText';

interface TxtCalibrationImportModalProps {
  standards: CalibrationEquipment[];
  plantEquipment: PlantEquipment[];
  labSettings: LabSettings;
  certificateNumber: string;
  procedureRef: string;
  ambientTempC: string;
  relativeHumidityPct: string;
  barometricPressureHpa: string;
  technicianSignature: DigitalSignature;
  approverSignature: DigitalSignature;
  onClose: () => void;
  onApplyToStudio: (
    report: ParsedTxtCalibrationReport,
    savePlantToDb: boolean
  ) => Promise<void>;
}

export const TxtCalibrationImportModal: React.FC<
  TxtCalibrationImportModalProps
> = ({
  standards,
  plantEquipment,
  labSettings,
  certificateNumber,
  procedureRef,
  ambientTempC,
  relativeHumidityPct,
  barometricPressureHpa,
  technicianSignature,
  approverSignature,
  onClose,
  onApplyToStudio,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedTxtCalibrationReport | null>(null);
  const [savePlantToDb, setSavePlantToDb] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const existingAssetMatch = useMemo(() => {
    if (!parsed) return undefined;
    return plantEquipment.find(
      (p) => p.assetId.trim().toLowerCase() === parsed.tag.trim().toLowerCase()
    );
  }, [parsed, plantEquipment]);

  const evaluatedRows = useMemo(() => {
    if (!parsed) return [];
    const outSpan =
      parsed.equipmentType === 'transmitter'
        ? Math.abs(
            parsed.plantAssetCandidate.outputRangeMax -
              parsed.plantAssetCandidate.outputRangeMin
          )
        : undefined;
    return evaluateReadings(parsed.readings, outSpan);
  }, [parsed]);

  const processFile = async (file: File) => {
    setParseError(null);
    const isTxt =
      file.name.toLowerCase().endsWith('.txt') ||
      file.type === 'text/plain' ||
      file.type === '';
    if (!isTxt) {
      setParseError('Please upload a valid .txt calibration data export file.');
      return;
    }

    try {
      const content = await file.text();
      if (!content.trim()) {
        setParseError('The selected .txt file is empty.');
        return;
      }
      const report = parseCalibrationTxtReport(
        content,
        file.name,
        standards,
        plantEquipment
      );
      setParsed(report);
      const alreadyExists = plantEquipment.some(
        (p) => p.assetId.trim().toLowerCase() === report.tag.trim().toLowerCase()
      );
      setSavePlantToDb(!alreadyExists);
    } catch (err) {
      setParseError(
        err instanceof Error
          ? err.message
          : 'Unable to parse the selected .txt calibration report.'
      );
    }
  };

  const handleLoadIntoStudio = async () => {
    if (!parsed) return;
    setIsApplying(true);
    setParseError(null);
    try {
      await onApplyToStudio(parsed, savePlantToDb);
      onClose();
    } catch (err) {
      setParseError(
        err instanceof Error
          ? err.message
          : 'Failed to load parsed report into Certificate Studio.'
      );
    } finally {
      setIsApplying(false);
    }
  };

  const handleConvertAndDownloadPdf = async () => {
    if (!parsed) return;
    setIsExportingPdf(true);
    setParseError(null);
    try {
      const asset = parsed.plantAssetCandidate;
      const hash = await computeCertificateHash({
        certificateNumber,
        calibrationDate: parsed.calibrationDate,
        nextDueDate: asset.nextDueDate,
        assetId: asset.assetId,
        referenceStandardIds: parsed.referenceStandardsSnapshot.map((s) => s.id),
        readings: parsed.readings,
        switchVerification: parsed.switchVerification,
        overallResult: parsed.overallResult,
        technicianName: technicianSignature.signerName,
        approverName: approverSignature.signerName,
      });

      const cert: CalibrationCertificate = {
        id: `cert-txt-${Date.now()}`,
        certificateNumber,
        createdAt: new Date().toISOString(),
        calibrationDate: parsed.calibrationDate,
        nextDueDate: asset.nextDueDate,
        plantEquipmentId: existingAssetMatch?.id || asset.id,
        assetId: asset.assetId,
        assetSnapshot: {
          assetId: asset.assetId,
          tagName: asset.tagName,
          description: asset.description,
          manufacturer: asset.manufacturer,
          model: asset.model,
          serialNumber: asset.serialNumber,
          plantArea: asset.plantArea,
          category: asset.category,
          equipmentType: parsed.equipmentType,
          frequencyLabel: asset.frequencyLabel,
          rangeText: parsed.summary.rangeText,
          outputRangeText: parsed.summary.outputRangeText,
          toleranceSpec: parsed.summary.toleranceSpec,
        },
        referenceStandardIds: parsed.referenceStandardsSnapshot.map((s) => s.id),
        referenceStandardsSnapshot: parsed.referenceStandardsSnapshot,
        laboratoryName: labSettings.laboratoryName,
        accreditationNumber: labSettings.accreditationNumber,
        facilityAddress: labSettings.facilityAddress,
        procedureRef,
        ambientTempC,
        relativeHumidityPct,
        barometricPressureHpa,
        readings: parsed.readings,
        ...(parsed.switchVerification
          ? { switchVerification: parsed.switchVerification }
          : {}),
        overallResult: parsed.overallResult,
        remarks: parsed.remarks,
        technicianSignature,
        approverSignature,
        verificationHash: hash,
      };

      await exportCertificateToPdf(cert);
      await onApplyToStudio(parsed, savePlantToDb);
      onClose();
    } catch (err) {
      setParseError(
        err instanceof Error
          ? err.message
          : 'Failed to generate PDF report from the uploaded .txt file.'
      );
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <FileUp className="h-5 w-5 text-blue-700" />
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900">
                Import Calibration Data (.TXT Report Converter)
              </h2>
              <p className="text-[11px] text-slate-500">
                Upload a calibrator .txt export (Transmitter multi-point or Switch single-point) to populate a certificate and export PDF.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) processFile(file);
            }}
            className={`flex flex-col items-center justify-center rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragOver
                ? 'border-blue-600 bg-blue-50/70'
                : 'border-slate-300 bg-slate-50/50 hover:border-slate-400'
            }`}
          >
            <Upload className="h-7 w-7 text-slate-400" />
            <p className="mt-2 text-xs font-medium text-slate-800">
              Drag &amp; drop a calibrator <span className="font-mono font-semibold">.txt</span> file here, or{' '}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="font-semibold text-blue-700 underline hover:text-blue-800 cursor-pointer"
              >
                browse file
              </button>
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Auto-detects Transmitter multi-point logs (Test Setup + As Found/Left) and Switch single-point trip/deadband logs (Switch Test Setup).
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) processFile(file);
                e.target.value = '';
              }}
            />
          </div>

          {parseError && (
            <div className="flex items-start gap-2 rounded border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <span>{parseError}</span>
            </div>
          )}

          {parsed && (
            <div className="space-y-4">
              {/* Warnings */}
              {parsed.warnings.length > 0 && (
                <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {parsed.warnings.map((w, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Parsed Overview Card */}
              <div className="rounded-md border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    {parsed.equipmentType === 'switch' ? (
                      <ToggleLeft className="h-4 w-4 text-indigo-700" />
                    ) : (
                      <Gauge className="h-4 w-4 text-blue-700" />
                    )}
                    <span className="font-mono text-sm font-bold text-slate-900">
                      {parsed.tag}
                    </span>
                    <span className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                      {parsed.equipmentType === 'switch'
                        ? 'Switch (Single-Point Verification)'
                        : `Transmitter (${parsed.summary.pointCount}-Point Cycle)`}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-slate-500">
                      <FileText className="h-3.5 w-3.5" />
                      {parsed.fileName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">Parsed Verdict:</span>
                    <CertificateResultLabel result={parsed.overallResult} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 px-4 py-3 text-xs sm:grid-cols-4">
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">
                      Calibration Date
                    </div>
                    <div className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                      {parsed.calibrationDate}
                    </div>
                    {parsed.calibrationTimestampRaw && (
                      <div className="text-[10px] text-slate-400">
                        {parsed.calibrationTimestampRaw}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">
                      Serial Number
                    </div>
                    <div className="mt-0.5 font-mono text-slate-900">
                      {parsed.serialNumber}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">
                      {parsed.equipmentType === 'switch' ? 'Trip Spec' : 'Input → Output'}
                    </div>
                    <div className="mt-0.5 font-mono text-slate-900">
                      {parsed.equipmentType === 'switch'
                        ? parsed.summary.outputRangeText
                        : `${parsed.summary.rangeText} → ${parsed.summary.outputRangeText}`}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">
                      Tolerance Limit
                    </div>
                    <div className="mt-0.5 font-mono font-medium text-slate-900">
                      {parsed.summary.toleranceSpec}
                    </div>
                  </div>
                </div>
              </div>

              {/* Parsed Test Equipment Used */}
              <div className="rounded-md border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-bold tracking-wide text-slate-700 uppercase">
                  Test Equipment Used ({parsed.referenceStandardsSnapshot.length})
                </div>
                {parsed.referenceStandardsSnapshot.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-slate-500">
                    No test equipment rows detected in this .txt file.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50/70 text-[10px] text-slate-500 uppercase">
                        <tr>
                          <th className="px-3 py-1.5 font-semibold">Code</th>
                          <th className="px-3 py-1.5 font-semibold">Manufacturer / Model</th>
                          <th className="px-3 py-1.5 font-semibold">Serial Number</th>
                          <th className="px-3 py-1.5 font-semibold">Source Match</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsed.referenceStandardsSnapshot.map((std, idx) => {
                          const isDbMatched = parsed.matchedStandardIds.includes(std.id);
                          return (
                            <tr key={`${std.id}-${idx}`}>
                              <td className="px-3 py-1.5 font-mono font-semibold text-slate-900">
                                {std.standardCode}
                              </td>
                              <td className="px-3 py-1.5 text-slate-800">
                                {std.manufacturer} {std.model}
                              </td>
                              <td className="px-3 py-1.5 font-mono text-slate-700">
                                {std.serialNumber}
                              </td>
                              <td className="px-3 py-1.5">
                                {isDbMatched ? (
                                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Matched in Reference Standards
                                  </span>
                                ) : (
                                  <span className="text-slate-600">
                                    Embedded from Test Log
                                  </span>
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

              {/* Parsed Readings Preview */}
              <div className="rounded-md border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-bold tracking-wide text-slate-700 uppercase">
                  {parsed.equipmentType === 'switch'
                    ? 'Single-Point Switch Verification Preview'
                    : `Measured Calibration Readings (${evaluatedRows.length} Points)`}
                </div>

                {parsed.equipmentType === 'switch' && parsed.switchVerification ? (
                  <div className="space-y-3 p-4">
                    <div className="overflow-x-auto rounded border border-slate-200">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead className="border-b border-slate-200 bg-slate-50 text-[10px] text-slate-600 uppercase">
                          <tr>
                            <th className="px-3 py-1.5 font-semibold">Point</th>
                            <th className="px-3 py-1.5 text-right font-semibold">Target Trip</th>
                            <th className="px-3 py-1.5 text-right font-semibold">As-Found Set</th>
                            <th className="px-3 py-1.5 text-right font-semibold">Found Err</th>
                            <th className="px-3 py-1.5 text-right font-semibold">As-Left Set</th>
                            <th className="px-3 py-1.5 text-right font-semibold">Left Err</th>
                            <th className="px-3 py-1.5 text-right font-semibold">Tol (±)</th>
                            <th className="px-3 py-1.5 text-right font-semibold">Result</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono tabular-nums">
                          {evaluatedRows.map((row) => {
                            const pass =
                              row.asLeftPass !== null
                                ? row.asLeftPass
                                : row.asFoundPass;
                            return (
                              <tr key={row.id}>
                                <td className="px-3 py-2 font-sans font-medium text-slate-800">
                                  {row.label}
                                </td>
                                <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                  {row.expectedOutput} {row.outputUnit}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-800">
                                  {row.asFound ? `${row.asFound} ${row.outputUnit}` : '—'}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-600">
                                  {formatSignedNumber(row.asFoundError, 3)}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-800">
                                  {row.asLeft ? `${row.asLeft} ${row.outputUnit}` : '—'}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-600">
                                  {formatSignedNumber(row.asLeftError, 3)}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-600">
                                  ±{row.tolerance}
                                </td>
                                <td className="px-3 py-2 text-right font-sans font-semibold">
                                  {pass === null ? (
                                    <span className="text-slate-400">N/A</span>
                                  ) : pass ? (
                                    <span className="text-emerald-700">✓ PASS</span>
                                  ) : (
                                    <span className="text-rose-700">✖ FAIL</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs sm:grid-cols-4">
                      <div>
                        <div className="text-[10px] font-semibold text-slate-500 uppercase">
                          Direction / Detection
                        </div>
                        <div className="mt-0.5 font-medium text-slate-900">
                          {parsed.switchVerification.tripDirection}
                          {parsed.switchVerification.tripDetectionMode
                            ? ` (${parsed.switchVerification.tripDetectionMode})`
                            : ''}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-slate-500 uppercase">
                          As-Found Reset
                        </div>
                        <div className="mt-0.5 font-mono text-slate-900">
                          {parsed.switchVerification.asFoundReset
                            ? `${parsed.switchVerification.asFoundReset} ${parsed.switchVerification.unit}`
                            : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-slate-500 uppercase">
                          As-Left Reset
                        </div>
                        <div className="mt-0.5 font-mono text-slate-900">
                          {parsed.switchVerification.asLeftReset
                            ? `${parsed.switchVerification.asLeftReset} ${parsed.switchVerification.unit}`
                            : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-slate-500 uppercase">
                          Deadband Limit
                        </div>
                        <div className="mt-0.5 font-mono text-slate-900">
                          {parsed.switchVerification.deadbandMax !== undefined
                            ? `${parsed.switchVerification.deadbandMin ?? 0}–${parsed.switchVerification.deadbandMax} ${parsed.switchVerification.unit}`
                            : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="max-h-60 overflow-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-[10px] text-slate-600 uppercase">
                        <tr>
                          <th className="px-3 py-1.5 font-semibold">Point</th>
                          <th className="px-3 py-1.5 text-right font-semibold">Input</th>
                          <th className="px-3 py-1.5 text-right font-semibold">Expected</th>
                          <th className="px-3 py-1.5 text-right font-semibold">As-Found</th>
                          <th className="px-3 py-1.5 text-right font-semibold">Found Err</th>
                          <th className="px-3 py-1.5 text-right font-semibold">As-Left</th>
                          <th className="px-3 py-1.5 text-right font-semibold">Left Err</th>
                          <th className="px-3 py-1.5 text-right font-semibold">Tol (±)</th>
                          <th className="px-3 py-1.5 text-right font-semibold">Result</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                        {evaluatedRows.map((row) => {
                          const pass =
                            row.asLeftPass !== null
                              ? row.asLeftPass
                              : row.asFoundPass;
                          return (
                            <tr key={row.id} className="hover:bg-slate-50/70">
                              <td className="px-3 py-1.5 font-sans font-medium text-slate-800">
                                {row.label}
                              </td>
                              <td className="px-3 py-1.5 text-right text-slate-700">
                                {row.nominalInput} {row.inputUnit}
                              </td>
                              <td className="px-3 py-1.5 text-right font-medium text-slate-900">
                                {row.expectedOutput} {row.outputUnit}
                              </td>
                              <td className="px-3 py-1.5 text-right text-slate-800">
                                {row.asFound || '—'}
                              </td>
                              <td
                                className={`px-3 py-1.5 text-right ${
                                  row.asFoundPass === false
                                    ? 'font-semibold text-rose-700'
                                    : 'text-slate-600'
                                }`}
                              >
                                {formatSignedNumber(row.asFoundError, 3)}
                              </td>
                              <td className="px-3 py-1.5 text-right text-slate-800">
                                {row.asLeft || '—'}
                              </td>
                              <td
                                className={`px-3 py-1.5 text-right ${
                                  row.asLeftPass === false
                                    ? 'font-semibold text-rose-700'
                                    : 'text-slate-600'
                                }`}
                              >
                                {formatSignedNumber(row.asLeftError, 3)}
                              </td>
                              <td className="px-3 py-1.5 text-right text-slate-600">
                                ±{row.tolerance}
                              </td>
                              <td className="px-3 py-1.5 text-right font-sans font-semibold">
                                {pass === null ? (
                                  <span className="text-slate-400">N/A</span>
                                ) : pass ? (
                                  <span className="text-emerald-700">✓ PASS</span>
                                ) : (
                                  <span className="text-rose-700">✖ FAIL</span>
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

              {/* Plant Assets DB Option */}
              <label className="flex cursor-pointer items-center gap-2.5 rounded border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-800">
                <input
                  type="checkbox"
                  checked={savePlantToDb}
                  onChange={(e) => setSavePlantToDb(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700"
                />
                <span>
                  {existingAssetMatch ? (
                    <>
                      Update existing Plant Asset{' '}
                      <span className="font-mono font-semibold text-slate-900">
                        {parsed.tag}
                      </span>{' '}
                      setpoints &amp; calibration schedule in database
                    </>
                  ) : (
                    <>
                      Register{' '}
                      <span className="font-mono font-semibold text-slate-900">
                        {parsed.tag}
                      </span>{' '}
                      ({parsed.equipmentType === 'switch' ? 'Switch' : 'Transmitter'}) as a new Plant Asset in database
                    </>
                  )}
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer whitespace-nowrap"
          >
            Cancel
          </button>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={!parsed || isApplying || isExportingPdf}
              onClick={handleLoadIntoStudio}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <CheckCircle2 className="h-4 w-4 text-blue-700" />
              {isApplying ? 'Loading...' : 'Load into Certificate Studio'}
            </button>

            <button
              type="button"
              disabled={!parsed || isApplying || isExportingPdf}
              onClick={handleConvertAndDownloadPdf}
              className="inline-flex items-center gap-1.5 rounded bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <Download className="h-4 w-4" />
              {isExportingPdf ? 'Generating PDF...' : 'Convert & Download PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
