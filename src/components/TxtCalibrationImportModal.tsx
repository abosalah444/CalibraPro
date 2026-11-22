import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  FileUp,
  Gauge,
  Layers,
  ToggleLeft,
  Trash2,
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
  onIssueCertificate: (cert: CalibrationCertificate) => Promise<void>;
  onSaveImportedPlant?: (
    candidate: PlantEquipment,
    existingId?: string
  ) => Promise<PlantEquipment>;
  onBatchIssueComplete?: (issuedCerts: CalibrationCertificate[]) => void;
}

function incrementCertNumber(base: string, offset: number): string {
  if (offset === 0) return base;
  const match = base.match(/^(.*?)(\d+)$/);
  if (match) {
    const prefix = match[1];
    const numStr = match[2];
    const nextNum = String(Number(numStr) + offset).padStart(
      numStr.length,
      '0'
    );
    return `${prefix}${nextNum}`;
  }
  return `${base}-${offset + 1}`;
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
  onIssueCertificate,
  onSaveImportedPlant,
  onBatchIssueComplete,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parsedReports, setParsedReports] = useState<
    ParsedTxtCalibrationReport[]
  >([]);
  const [inspectedIndex, setInspectedIndex] = useState<number>(0);
  const [savePlantToDb, setSavePlantToDb] = useState(true);
  const [downloadBatchPdfs, setDownloadBatchPdfs] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isBatchIssuing, setIsBatchIssuing] = useState(false);
  const [issuedBatchCerts, setIssuedBatchCerts] = useState<
    CalibrationCertificate[]
  >([]);

  const isSingleFile = parsedReports.length === 1;
  const isMultiFile = parsedReports.length > 1;
  const activeReport =
    parsedReports[Math.min(inspectedIndex, Math.max(0, parsedReports.length - 1))] ||
    null;

  const existingAssetMatch = useMemo(() => {
    if (!activeReport) return undefined;
    return plantEquipment.find(
      (p) =>
        p.assetId.trim().toLowerCase() === activeReport.tag.trim().toLowerCase()
    );
  }, [activeReport, plantEquipment]);

  const evaluatedRows = useMemo(() => {
    if (!activeReport) return [];
    const outSpan =
      activeReport.equipmentType === 'transmitter'
        ? Math.abs(
            activeReport.plantAssetCandidate.outputRangeMax -
              activeReport.plantAssetCandidate.outputRangeMin
          )
        : undefined;
    return evaluateReadings(activeReport.readings, outSpan);
  }, [activeReport]);

  const processFiles = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    setParseErrors([]);
    setIssuedBatchCerts([]);

    const nextReports: ParsedTxtCalibrationReport[] = [];
    const nextErrors: string[] = [];

    for (const file of incoming) {
      const isTxt =
        file.name.toLowerCase().endsWith('.txt') ||
        file.type === 'text/plain' ||
        file.type === '';
      if (!isTxt) {
        nextErrors.push(
          `${file.name}: Skipped — only .txt calibration data export files are supported.`
        );
        continue;
      }

      try {
        const content = await file.text();
        if (!content.trim()) {
          nextErrors.push(`${file.name}: The selected .txt file is empty.`);
          continue;
        }
        const report = parseCalibrationTxtReport(
          content,
          file.name,
          standards,
          plantEquipment
        );
        nextReports.push(report);
      } catch (err) {
        nextErrors.push(
          `${file.name}: ${
            err instanceof Error
              ? err.message
              : 'Unable to parse calibration report.'
          }`
        );
      }
    }

    if (nextReports.length > 0) {
      setParsedReports((prev) => {
        // Merge if user adds more files; replace duplicate filenames cleanly
        const existingByName = new Map(prev.map((r) => [r.fileName, r]));
        nextReports.forEach((r) => existingByName.set(r.fileName, r));
        const merged = Array.from(existingByName.values());
        if (merged.length === 1) {
          const alreadyExists = plantEquipment.some(
            (p) =>
              p.assetId.trim().toLowerCase() ===
              merged[0].tag.trim().toLowerCase()
          );
          setSavePlantToDb(!alreadyExists);
        } else {
          setSavePlantToDb(true);
        }
        return merged;
      });
      setInspectedIndex(0);
    }

    if (nextErrors.length > 0) {
      setParseErrors(nextErrors);
    }
  };

  const removeReportAt = (idx: number) => {
    setParsedReports((prev) => {
      const updated = prev.filter((_, i) => i !== idx);
      setInspectedIndex((cur) =>
        Math.max(0, Math.min(cur, updated.length - 1))
      );
      return updated;
    });
    setIssuedBatchCerts([]);
  };

  const buildCertificateFromReport = async (
    report: ParsedTxtCalibrationReport,
    certNum: string,
    resolvedPlantId: string,
    uniqueSuffix: string
  ): Promise<CalibrationCertificate> => {
    const asset = report.plantAssetCandidate;
    const hash = await computeCertificateHash({
      certificateNumber: certNum,
      calibrationDate: report.calibrationDate,
      nextDueDate: asset.nextDueDate,
      assetId: asset.assetId,
      referenceStandardIds: report.referenceStandardsSnapshot.map((s) => s.id),
      readings: report.readings,
      switchVerification: report.switchVerification,
      overallResult: report.overallResult,
      technicianName: technicianSignature.signerName,
      approverName: approverSignature.signerName,
    });

    return {
      id: `cert-txt-${Date.now()}-${uniqueSuffix}`,
      certificateNumber: certNum,
      createdAt: new Date().toISOString(),
      calibrationDate: report.calibrationDate,
      nextDueDate: asset.nextDueDate,
      plantEquipmentId: resolvedPlantId,
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
        equipmentType: report.equipmentType,
        frequencyLabel: asset.frequencyLabel,
        rangeText: report.summary.rangeText,
        outputRangeText: report.summary.outputRangeText,
        toleranceSpec: report.summary.toleranceSpec,
      },
      referenceStandardIds: report.referenceStandardsSnapshot.map((s) => s.id),
      referenceStandardsSnapshot: report.referenceStandardsSnapshot,
      laboratoryName: labSettings.laboratoryName,
      accreditationNumber: labSettings.accreditationNumber,
      facilityAddress: labSettings.facilityAddress,
      procedureRef,
      ambientTempC,
      relativeHumidityPct,
      barometricPressureHpa,
      readings: report.readings,
      ...(report.switchVerification
        ? { switchVerification: report.switchVerification }
        : {}),
      overallResult: report.overallResult,
      remarks: report.remarks,
      technicianSignature,
      approverSignature,
      verificationHash: hash,
    };
  };

  const handleLoadIntoStudio = async () => {
    if (!isSingleFile || !activeReport) return;
    setIsApplying(true);
    setParseErrors([]);
    try {
      await onApplyToStudio(activeReport, savePlantToDb);
      onClose();
    } catch (err) {
      setParseErrors([
        err instanceof Error
          ? err.message
          : 'Failed to load parsed report into Certificate Studio.',
      ]);
    } finally {
      setIsApplying(false);
    }
  };

  const handleConvertAndDownloadPdf = async () => {
    if (!isSingleFile || !activeReport) return;
    setIsExportingPdf(true);
    setParseErrors([]);
    try {
      const cert = await buildCertificateFromReport(
        activeReport,
        certificateNumber,
        existingAssetMatch?.id || activeReport.plantAssetCandidate.id,
        'single'
      );
      await exportCertificateToPdf(cert);
      await onApplyToStudio(activeReport, savePlantToDb);
      onClose();
    } catch (err) {
      setParseErrors([
        err instanceof Error
          ? err.message
          : 'Failed to generate PDF report from the uploaded .txt file.',
      ]);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleBatchConvertAndIssue = async () => {
    if (!isMultiFile || parsedReports.length < 2) return;
    if (
      !technicianSignature.signatureDataUrl ||
      !approverSignature.signatureDataUrl
    ) {
      setParseErrors([
        'Both Technician and Quality Approver digital signatures are required before issuing certificates.',
      ]);
      return;
    }

    setIsBatchIssuing(true);
    setParseErrors([]);

    const knownPlantsByTag = new Map<string, PlantEquipment>();
    plantEquipment.forEach((p) => {
      knownPlantsByTag.set(p.assetId.trim().toLowerCase(), p);
    });

    const issued: CalibrationCertificate[] = [];
    const batchErrors: string[] = [];

    try {
      for (let i = 0; i < parsedReports.length; i += 1) {
        const report = parsedReports[i];
        const tagKey = report.tag.trim().toLowerCase();
        let resolvedPlant = knownPlantsByTag.get(tagKey);

        try {
          if (savePlantToDb && onSaveImportedPlant) {
            const savedPlant = await onSaveImportedPlant(
              report.plantAssetCandidate,
              resolvedPlant?.id
            );
            resolvedPlant = savedPlant;
            knownPlantsByTag.set(tagKey, savedPlant);
          }

          const assignedNumber = incrementCertNumber(certificateNumber, i);
          const cert = await buildCertificateFromReport(
            report,
            assignedNumber,
            resolvedPlant?.id || report.plantAssetCandidate.id,
            String(i + 1)
          );

          await onIssueCertificate(cert);
          if (downloadBatchPdfs) {
            await exportCertificateToPdf(cert);
          }
          issued.push(cert);
        } catch (err) {
          batchErrors.push(
            `${report.fileName} (${report.tag}): ${
              err instanceof Error ? err.message : 'Failed to issue certificate.'
            }`
          );
        }
      }

      if (issued.length > 0) {
        setIssuedBatchCerts(issued);
        onBatchIssueComplete?.(issued);
      }
      if (batchErrors.length > 0) {
        setParseErrors(batchErrors);
      }
    } finally {
      setIsBatchIssuing(false);
    }
  };

  const handleDownloadAllIssuedPdfs = async () => {
    for (const cert of issuedBatchCerts) {
      await exportCertificateToPdf(cert);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <FileUp className="h-5 w-5 text-blue-700" />
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900">
                Import Calibration Data (.TXT Report Converter)
              </h2>
              <p className="text-[11px] text-slate-500">
                Upload one .txt file to load into Certificate Studio, or select multiple .txt files simultaneously to batch convert and issue certificates.
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
          {/* Dropzone (hidden after batch issue success so completion summary is clear) */}
          {issuedBatchCerts.length === 0 && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files?.length) {
                  processFiles(e.dataTransfer.files);
                }
              }}
              className={`flex flex-col items-center justify-center rounded-md border-2 border-dashed px-4 py-5 text-center transition-colors ${
                dragOver
                  ? 'border-blue-600 bg-blue-50/70'
                  : 'border-slate-300 bg-slate-50/50 hover:border-slate-400'
              }`}
            >
              <Upload className="h-6 w-6 text-slate-400" />
              <p className="mt-2 text-xs font-medium text-slate-800">
                Drag &amp; drop one or multiple calibrator{' '}
                <span className="font-mono font-semibold">.txt</span> files here,
                or{' '}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="font-semibold text-blue-700 underline hover:text-blue-800 cursor-pointer"
                >
                  browse files
                </button>
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Single file: load into Studio or export PDF. Multiple files: batch convert and issue sequential certificates directly to the Archive.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,text/plain"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    processFiles(e.target.files);
                  }
                  e.target.value = '';
                }}
              />
            </div>
          )}

          {parseErrors.length > 0 && (
            <div className="space-y-1 rounded border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
              {parseErrors.map((errMsg, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <span>{errMsg}</span>
                </div>
              ))}
            </div>
          )}

          {/* Batch Completion Summary */}
          {issuedBatchCerts.length > 0 && (
            <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-900">
                  <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                  <span>
                    Converted &amp; Issued {issuedBatchCerts.length} Certificates
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadAllIssuedPdfs}
                  className="inline-flex items-center gap-1.5 rounded border border-emerald-700 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 cursor-pointer whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download All {issuedBatchCerts.length} PDFs
                </button>
              </div>

              <div className="overflow-x-auto rounded border border-emerald-200 bg-white">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[10px] text-slate-600 uppercase">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Certificate #</th>
                      <th className="px-3 py-2 font-semibold">Asset Tag</th>
                      <th className="px-3 py-2 font-semibold">Type</th>
                      <th className="px-3 py-2 font-semibold">Cal Date</th>
                      <th className="px-3 py-2 font-semibold">Result</th>
                      <th className="px-3 py-2 text-right font-semibold">PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {issuedBatchCerts.map((cert) => (
                      <tr key={cert.id}>
                        <td className="px-3 py-2 font-mono font-semibold text-slate-900">
                          {cert.certificateNumber}
                        </td>
                        <td className="px-3 py-2 font-mono font-semibold text-slate-800">
                          {cert.assetId}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {cert.assetSnapshot.equipmentType === 'switch'
                            ? 'Switch (1-Point)'
                            : `Transmitter (${cert.readings.length}-Pt)`}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-700 tabular-nums">
                          {cert.calibrationDate}
                        </td>
                        <td className="px-3 py-2">
                          <CertificateResultLabel result={cert.overallResult} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => exportCertificateToPdf(cert)}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                          >
                            <Download className="h-3 w-3" />
                            PDF
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Multi-File Queue Table (when 2+ files are selected and not yet issued) */}
          {isMultiFile && issuedBatchCerts.length === 0 && (
            <div className="rounded-md border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-blue-700" />
                  <span className="text-xs font-bold tracking-wide text-slate-800 uppercase">
                    Batch Conversion Queue ({parsedReports.length} Files)
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-slate-500">
                    Click a row to inspect parsed readings
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setParsedReports([]);
                      setInspectedIndex(0);
                    }}
                    className="text-[11px] font-semibold text-rose-700 hover:text-rose-800 cursor-pointer"
                  >
                    Clear All
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50/70 text-[10px] text-slate-600 uppercase">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Assigned Cert #</th>
                      <th className="px-3 py-2 font-semibold">Source File</th>
                      <th className="px-3 py-2 font-semibold">Asset Tag</th>
                      <th className="px-3 py-2 font-semibold">Type</th>
                      <th className="px-3 py-2 font-semibold">Cal Date</th>
                      <th className="px-3 py-2 font-semibold">Verdict</th>
                      <th className="px-3 py-2 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedReports.map((report, idx) => {
                      const assignedNo = incrementCertNumber(
                        certificateNumber,
                        idx
                      );
                      const isSelected = idx === inspectedIndex;
                      return (
                        <tr
                          key={`${report.fileName}-${idx}`}
                          onClick={() => setInspectedIndex(idx)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-blue-50/70'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="px-3 py-2 font-mono font-semibold text-blue-800 tabular-nums">
                            {assignedNo}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-700">
                            {report.fileName}
                          </td>
                          <td className="px-3 py-2 font-mono font-bold text-slate-900">
                            {report.tag}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {report.equipmentType === 'switch'
                              ? 'Switch (1-Point)'
                              : `Transmitter (${report.summary.pointCount}-Pt)`}
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-700 tabular-nums">
                            {report.calibrationDate}
                          </td>
                          <td className="px-3 py-2">
                            <CertificateResultLabel
                              result={report.overallResult}
                            />
                          </td>
                          <td
                            className="px-3 py-2 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setInspectedIndex(idx)}
                                title="Inspect parsed data"
                                className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800 cursor-pointer"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeReportAt(idx)}
                                title="Remove from queue"
                                className="rounded p-1 text-slate-400 hover:bg-rose-100 hover:text-rose-700 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Active File Detailed Preview (shown for single file OR currently inspected file in multi-file queue) */}
          {activeReport && issuedBatchCerts.length === 0 && (
            <div className="space-y-4">
              {/* Warnings */}
              {activeReport.warnings.length > 0 && (
                <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {activeReport.warnings.map((w, idx) => (
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
                  <div className="flex flex-wrap items-center gap-2.5">
                    {activeReport.equipmentType === 'switch' ? (
                      <ToggleLeft className="h-4 w-4 text-indigo-700" />
                    ) : (
                      <Gauge className="h-4 w-4 text-blue-700" />
                    )}
                    <span className="font-mono text-sm font-bold text-slate-900">
                      {activeReport.tag}
                    </span>
                    <span className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                      {activeReport.equipmentType === 'switch'
                        ? 'Switch (Single-Point Verification)'
                        : `Transmitter (${activeReport.summary.pointCount}-Point Cycle)`}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-slate-500">
                      <FileText className="h-3.5 w-3.5" />
                      {activeReport.fileName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">
                      Parsed Verdict:
                    </span>
                    <CertificateResultLabel
                      result={activeReport.overallResult}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 px-4 py-3 text-xs sm:grid-cols-4">
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">
                      Calibration Date
                    </div>
                    <div className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                      {activeReport.calibrationDate}
                    </div>
                    {activeReport.calibrationTimestampRaw && (
                      <div className="text-[10px] text-slate-400">
                        {activeReport.calibrationTimestampRaw}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">
                      Serial Number
                    </div>
                    <div className="mt-0.5 font-mono text-slate-900">
                      {activeReport.serialNumber}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">
                      {activeReport.equipmentType === 'switch'
                        ? 'Trip Spec'
                        : 'Input → Output'}
                    </div>
                    <div className="mt-0.5 font-mono text-slate-900">
                      {activeReport.equipmentType === 'switch'
                        ? activeReport.summary.outputRangeText
                        : `${activeReport.summary.rangeText} → ${activeReport.summary.outputRangeText}`}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">
                      Tolerance Limit
                    </div>
                    <div className="mt-0.5 font-mono font-medium text-slate-900">
                      {activeReport.summary.toleranceSpec}
                    </div>
                  </div>
                </div>
              </div>

              {/* Parsed Test Equipment Used */}
              <div className="rounded-md border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-bold tracking-wide text-slate-700 uppercase">
                  Test Equipment Used (
                  {activeReport.referenceStandardsSnapshot.length})
                </div>
                {activeReport.referenceStandardsSnapshot.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-slate-500">
                    No test equipment rows detected in this .txt file.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50/70 text-[10px] text-slate-500 uppercase">
                        <tr>
                          <th className="px-3 py-1.5 font-semibold">Code</th>
                          <th className="px-3 py-1.5 font-semibold">
                            Manufacturer / Model
                          </th>
                          <th className="px-3 py-1.5 font-semibold">
                            Serial Number
                          </th>
                          <th className="px-3 py-1.5 font-semibold">
                            Source Match
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeReport.referenceStandardsSnapshot.map(
                          (std, idx) => {
                            const isDbMatched =
                              activeReport.matchedStandardIds.includes(std.id);
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
                          }
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Parsed Readings Preview */}
              <div className="rounded-md border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-bold tracking-wide text-slate-700 uppercase">
                  {activeReport.equipmentType === 'switch'
                    ? 'Single-Point Switch Verification Preview'
                    : `Measured Calibration Readings (${evaluatedRows.length} Points)`}
                </div>

                {activeReport.equipmentType === 'switch' &&
                activeReport.switchVerification ? (
                  <div className="space-y-3 p-4">
                    <div className="overflow-x-auto rounded border border-slate-200">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead className="border-b border-slate-200 bg-slate-50 text-[10px] text-slate-600 uppercase">
                          <tr>
                            <th className="px-3 py-1.5 font-semibold">Point</th>
                            <th className="px-3 py-1.5 text-right font-semibold">
                              Target Trip
                            </th>
                            <th className="px-3 py-1.5 text-right font-semibold">
                              As-Found Set
                            </th>
                            <th className="px-3 py-1.5 text-right font-semibold">
                              Found Err
                            </th>
                            <th className="px-3 py-1.5 text-right font-semibold">
                              As-Left Set
                            </th>
                            <th className="px-3 py-1.5 text-right font-semibold">
                              Left Err
                            </th>
                            <th className="px-3 py-1.5 text-right font-semibold">
                              Tol (±)
                            </th>
                            <th className="px-3 py-1.5 text-right font-semibold">
                              Result
                            </th>
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
                                  {row.asFound
                                    ? `${row.asFound} ${row.outputUnit}`
                                    : '—'}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-600">
                                  {formatSignedNumber(row.asFoundError, 3)}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-800">
                                  {row.asLeft
                                    ? `${row.asLeft} ${row.outputUnit}`
                                    : '—'}
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
                                    <span className="text-emerald-700">
                                      ✓ PASS
                                    </span>
                                  ) : (
                                    <span className="text-rose-700">
                                      ✖ FAIL
                                    </span>
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
                          {activeReport.switchVerification.tripDirection}
                          {activeReport.switchVerification.tripDetectionMode
                            ? ` (${activeReport.switchVerification.tripDetectionMode})`
                            : ''}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-slate-500 uppercase">
                          As-Found Reset
                        </div>
                        <div className="mt-0.5 font-mono text-slate-900">
                          {activeReport.switchVerification.asFoundReset
                            ? `${activeReport.switchVerification.asFoundReset} ${activeReport.switchVerification.unit}`
                            : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-slate-500 uppercase">
                          As-Left Reset
                        </div>
                        <div className="mt-0.5 font-mono text-slate-900">
                          {activeReport.switchVerification.asLeftReset
                            ? `${activeReport.switchVerification.asLeftReset} ${activeReport.switchVerification.unit}`
                            : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-slate-500 uppercase">
                          Deadband Limit
                        </div>
                        <div className="mt-0.5 font-mono text-slate-900">
                          {activeReport.switchVerification.deadbandMax !==
                          undefined
                            ? `${activeReport.switchVerification.deadbandMin ?? 0}–${activeReport.switchVerification.deadbandMax} ${activeReport.switchVerification.unit}`
                            : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="max-h-56 overflow-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-[10px] text-slate-600 uppercase">
                        <tr>
                          <th className="px-3 py-1.5 font-semibold">Point</th>
                          <th className="px-3 py-1.5 text-right font-semibold">
                            Input
                          </th>
                          <th className="px-3 py-1.5 text-right font-semibold">
                            Expected
                          </th>
                          <th className="px-3 py-1.5 text-right font-semibold">
                            As-Found
                          </th>
                          <th className="px-3 py-1.5 text-right font-semibold">
                            Found Err
                          </th>
                          <th className="px-3 py-1.5 text-right font-semibold">
                            As-Left
                          </th>
                          <th className="px-3 py-1.5 text-right font-semibold">
                            Left Err
                          </th>
                          <th className="px-3 py-1.5 text-right font-semibold">
                            Tol (±)
                          </th>
                          <th className="px-3 py-1.5 text-right font-semibold">
                            Result
                          </th>
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
                                  <span className="text-emerald-700">
                                    ✓ PASS
                                  </span>
                                ) : (
                                  <span className="text-rose-700">
                                    ✖ FAIL
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

              {/* Options Bar */}
              <div className="flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2.5 rounded border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-800">
                  <input
                    type="checkbox"
                    checked={savePlantToDb}
                    onChange={(e) => setSavePlantToDb(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700"
                  />
                  <span>
                    {isMultiFile ? (
                      <>
                        Save or update all {parsedReports.length} imported
                        instruments &amp; calibration schedules in Plant Assets
                        database
                      </>
                    ) : existingAssetMatch ? (
                      <>
                        Update existing Plant Asset{' '}
                        <span className="font-mono font-semibold text-slate-900">
                          {activeReport.tag}
                        </span>{' '}
                        setpoints &amp; calibration schedule in database
                      </>
                    ) : (
                      <>
                        Register{' '}
                        <span className="font-mono font-semibold text-slate-900">
                          {activeReport.tag}
                        </span>{' '}
                        (
                        {activeReport.equipmentType === 'switch'
                          ? 'Switch'
                          : 'Transmitter'}
                        ) as a new Plant Asset in database
                      </>
                    )}
                  </span>
                </label>

                {isMultiFile && (
                  <label className="flex cursor-pointer items-center gap-2.5 rounded border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-800">
                    <input
                      type="checkbox"
                      checked={downloadBatchPdfs}
                      onChange={(e) => setDownloadBatchPdfs(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700"
                    />
                    <span>
                      Also download A4 PDF files automatically while issuing
                      certificates
                    </span>
                  </label>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
          {issuedBatchCerts.length > 0 ? (
            <>
              <span className="text-xs text-slate-600">
                All issued certificates are available in the{' '}
                <span className="font-semibold text-slate-900">
                  Certificate Archive
                </span>
                .
              </span>
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer whitespace-nowrap"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer whitespace-nowrap"
              >
                Cancel
              </button>

              <div className="flex flex-wrap items-center gap-2.5">
                {isMultiFile ? (
                  <button
                    type="button"
                    disabled={isBatchIssuing}
                    onClick={handleBatchConvertAndIssue}
                    className="inline-flex items-center gap-1.5 rounded bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {isBatchIssuing
                      ? `Converting & Issuing (${parsedReports.length})...`
                      : `Convert & Issue ${parsedReports.length} Certificates`}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={!isSingleFile || isApplying || isExportingPdf}
                      onClick={handleLoadIntoStudio}
                      className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      <CheckCircle2 className="h-4 w-4 text-blue-700" />
                      {isApplying ? 'Loading...' : 'Load into Certificate Studio'}
                    </button>

                    <button
                      type="button"
                      disabled={!isSingleFile || isApplying || isExportingPdf}
                      onClick={handleConvertAndDownloadPdf}
                      className="inline-flex items-center gap-1.5 rounded bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      <Download className="h-4 w-4" />
                      {isExportingPdf
                        ? 'Generating PDF...'
                        : 'Convert & Download PDF'}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
