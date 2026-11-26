import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
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
  CalibrationUser,
  DigitalSignature,
  LabSettings,
  PlantEquipment,
} from '../types/calibration';
import {
  computeCertificateHash,
  evaluateReadings,
  formatSignedNumber,
  generateTypedSignatureDataUrl,
} from '../utils/calibrationMath';
import {
  type ParsedExcelCalibrationReport,
  parseCalibrationExcelReports,
} from '../utils/excelCalibrationParser';
import { exportCertificateToPdf } from '../utils/pdfGenerator';
import { CertificateResultLabel } from './StatusText';

interface ExcelCalibrationImportModalProps {
  standards: CalibrationEquipment[];
  plantEquipment: PlantEquipment[];
  users: CalibrationUser[];
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
    report: ParsedExcelCalibrationReport,
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

function resolveSignatureOverride(
  nameFromExcel: string | undefined,
  fallbackSig: DigitalSignature,
  users: CalibrationUser[],
  defaultTitle: string
): DigitalSignature {
  const cleanName = (nameFromExcel || '').trim();
  if (!cleanName) return fallbackSig;

  const matchedUser = users.find(
    (u) => u.fullName.trim().toLowerCase() === cleanName.toLowerCase()
  );
  if (matchedUser) {
    return {
      signerName: matchedUser.fullName,
      signerTitle: matchedUser.title || defaultTitle,
      licenseId: matchedUser.licenseId,
      signedAt: new Date().toISOString(),
      signatureDataUrl: generateTypedSignatureDataUrl(matchedUser.fullName),
      method: 'typed',
    };
  }

  return {
    signerName: cleanName,
    signerTitle: defaultTitle,
    licenseId: '',
    signedAt: new Date().toISOString(),
    signatureDataUrl: generateTypedSignatureDataUrl(cleanName),
    method: 'typed',
  };
}

export const ExcelCalibrationImportModal: React.FC<
  ExcelCalibrationImportModalProps
> = ({
  standards,
  plantEquipment,
  users,
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
  const [isParsing, setIsParsing] = useState(false);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parsedReports, setParsedReports] = useState<
    ParsedExcelCalibrationReport[]
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

  const isSingleReport = parsedReports.length === 1;
  const isMultiReport = parsedReports.length > 1;
  const activeReport =
    parsedReports[
      Math.min(inspectedIndex, Math.max(0, parsedReports.length - 1))
    ] || null;

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

    setIsParsing(true);
    setParseErrors([]);
    setIssuedBatchCerts([]);

    const nextReports: ParsedExcelCalibrationReport[] = [];
    const nextErrors: string[] = [];

    try {
      for (const file of incoming) {
        const lower = file.name.toLowerCase();
        const isExcel =
          lower.endsWith('.xlsx') ||
          lower.endsWith('.xls') ||
          lower.endsWith('.xlsm');
        if (!isExcel) {
          nextErrors.push(
            `${file.name}: Skipped — please upload .xlsx, .xls, or .xlsm Excel calibration reports.`
          );
          continue;
        }

        try {
          const parsedList = await parseCalibrationExcelReports(
            file,
            standards,
            plantEquipment
          );
          nextReports.push(...parsedList);
        } catch (err) {
          nextErrors.push(
            `${file.name}: ${
              err instanceof Error
                ? err.message
                : 'Unable to parse Excel calibration report.'
            }`
          );
        }
      }

      if (nextReports.length > 0) {
        setParsedReports((prev) => {
          const keyOf = (r: ParsedExcelCalibrationReport) =>
            `${r.fileName}::${r.sheetName}`;
          const existing = new Map(prev.map((r) => [keyOf(r), r]));
          nextReports.forEach((r) => existing.set(keyOf(r), r));
          const merged = Array.from(existing.values());
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
    } finally {
      setIsParsing(false);
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
    report: ParsedExcelCalibrationReport,
    certNum: string,
    resolvedPlantId: string,
    uniqueSuffix: string
  ): Promise<CalibrationCertificate> => {
    const asset = report.plantAssetCandidate;
    const effectiveTechSig = resolveSignatureOverride(
      report.performedBy,
      technicianSignature,
      users,
      'Instrumentation Technician'
    );
    const effectiveApproverSig = resolveSignatureOverride(
      report.approvedBy,
      approverSignature,
      users,
      'QA Calibration Approver'
    );

    const hash = await computeCertificateHash({
      certificateNumber: certNum,
      calibrationDate: report.calibrationDate,
      nextDueDate: asset.nextDueDate,
      assetId: asset.assetId,
      referenceStandardIds: report.referenceStandardsSnapshot.map((s) => s.id),
      readings: report.readings,
      switchVerification: report.switchVerification,
      overallResult: report.overallResult,
      technicianName: effectiveTechSig.signerName,
      approverName: effectiveApproverSig.signerName,
    });

    return {
      id: `cert-xlsx-${Date.now()}-${uniqueSuffix}`,
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
      technicianSignature: effectiveTechSig,
      approverSignature: effectiveApproverSig,
      verificationHash: hash,
    };
  };

  const handleLoadIntoStudio = async () => {
    if (!isSingleReport || !activeReport) return;
    setIsApplying(true);
    setParseErrors([]);
    try {
      await onApplyToStudio(activeReport, savePlantToDb);
      onClose();
    } catch (err) {
      setParseErrors([
        err instanceof Error
          ? err.message
          : 'Failed to load Excel report into Certificate Studio.',
      ]);
    } finally {
      setIsApplying(false);
    }
  };

  const handleConvertAndDownloadPdf = async () => {
    if (!isSingleReport || !activeReport) return;
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
          : 'Failed to generate PDF from the uploaded Excel report.',
      ]);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleBatchConvertAndIssue = async () => {
    if (!isMultiReport || parsedReports.length < 2) return;
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
            <FileSpreadsheet className="h-5 w-5 text-emerald-700" />
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900">
                Import Calibration Reports (.XLSX / .XLS Excel Converter)
              </h2>
              <p className="text-[11px] text-slate-500">
                Upload a single Excel report to load into Certificate Studio, or select multiple Excel reports to batch convert and issue directly to the Certificate Archive.
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
                  ? 'border-emerald-600 bg-emerald-50/70'
                  : 'border-slate-300 bg-slate-50/50 hover:border-slate-400'
              }`}
            >
              <Upload className="h-6 w-6 text-slate-400" />
              <p className="mt-2 text-xs font-medium text-slate-800">
                Drag &amp; drop one or multiple Excel{' '}
                <span className="font-mono font-semibold">.xlsx / .xls</span>{' '}
                calibration reports here, or{' '}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="font-semibold text-emerald-700 underline hover:text-emerald-800 cursor-pointer"
                >
                  browse files
                </button>
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Supports Transmitter Calibration Reports (URV/LRV, Applied Value, Pre/Post-Calibration) and Switch Calibration Reports (Increasing/Decreasing, Dead Band).
              </p>
              {isParsing && (
                <p className="mt-2 text-xs font-semibold text-emerald-700">
                  Reading Excel workbooks...
                </p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.xlsm"
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

          {/* Multi-Report Queue Table */}
          {isMultiReport && issuedBatchCerts.length === 0 && (
            <div className="rounded-md border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-emerald-700" />
                  <span className="text-xs font-bold tracking-wide text-slate-800 uppercase">
                    Batch Conversion Queue ({parsedReports.length} Reports)
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
                      <th className="px-3 py-2 font-semibold">Source File / Sheet</th>
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
                          key={`${report.fileName}-${report.sheetName}-${idx}`}
                          onClick={() => setInspectedIndex(idx)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-emerald-50/70'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="px-3 py-2 font-mono font-semibold text-emerald-800 tabular-nums">
                            {assignedNo}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-700">
                            {report.fileName}
                            {report.sheetName ? ` (${report.sheetName})` : ''}
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

          {/* Active Report Preview */}
          {activeReport && issuedBatchCerts.length === 0 && (
            <div className="space-y-4">
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
                      <Gauge className="h-4 w-4 text-emerald-700" />
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
                      {activeReport.fileName} ({activeReport.sheetName})
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
                    {activeReport.workOrder && (
                      <div className="text-[10px] text-slate-500">
                        WO: {activeReport.workOrder}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">
                      System / Service
                    </div>
                    <div className="mt-0.5 text-slate-900">
                      {[activeReport.systemName, activeReport.serviceName]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </div>
                    {activeReport.calibrationLocation && (
                      <div className="text-[10px] text-slate-500">
                        Location: {activeReport.calibrationLocation}
                      </div>
                    )}
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

              {/* Reference Equipment */}
              <div className="rounded-md border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-bold tracking-wide text-slate-700 uppercase">
                  Calibration Reference (
                  {activeReport.referenceStandardsSnapshot.length})
                </div>
                {activeReport.referenceStandardsSnapshot.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-slate-500">
                    No reference standard details detected in this Excel sheet.
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
                            Service / Serial No.
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
                                      Embedded from Excel Report
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

              {/* Readings Preview */}
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
                              Target Setpoint
                            </th>
                            <th className="px-3 py-1.5 text-right font-semibold">
                              Pre-Adj Trip
                            </th>
                            <th className="px-3 py-1.5 text-right font-semibold">
                              Found Err
                            </th>
                            <th className="px-3 py-1.5 text-right font-semibold">
                              Post-Adj Trip
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

                    <div className="grid grid-cols-2 gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs sm:grid-cols-3">
                      <div>
                        <div className="text-[10px] font-semibold text-slate-500 uppercase">
                          Direction / Contact
                        </div>
                        <div className="mt-0.5 font-medium text-slate-900">
                          {activeReport.switchVerification.tripDirection} ·{' '}
                          {activeReport.switchVerification.normalContact}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-slate-500 uppercase">
                          Pre-Adjustment Reset
                        </div>
                        <div className="mt-0.5 font-mono text-slate-900">
                          {activeReport.switchVerification.asFoundReset
                            ? `${activeReport.switchVerification.asFoundReset} ${activeReport.switchVerification.unit}`
                            : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-slate-500 uppercase">
                          Post-Adjustment Reset
                        </div>
                        <div className="mt-0.5 font-mono text-slate-900">
                          {activeReport.switchVerification.asLeftReset
                            ? `${activeReport.switchVerification.asLeftReset} ${activeReport.switchVerification.unit}`
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
                            Applied
                          </th>
                          <th className="px-3 py-1.5 text-right font-semibold">
                            Expected
                          </th>
                          <th className="px-3 py-1.5 text-right font-semibold">
                            Pre-Cal
                          </th>
                          <th className="px-3 py-1.5 text-right font-semibold">
                            Found Err
                          </th>
                          <th className="px-3 py-1.5 text-right font-semibold">
                            Post-Cal
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

                {activeReport.remarks && (
                  <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-700">Notes: </span>
                    {activeReport.remarks}
                  </div>
                )}
              </div>

              {/* Options */}
              <div className="flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2.5 rounded border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-800">
                  <input
                    type="checkbox"
                    checked={savePlantToDb}
                    onChange={(e) => setSavePlantToDb(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-700"
                  />
                  <span>
                    {isMultiReport ? (
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

                {isMultiReport && (
                  <label className="flex cursor-pointer items-center gap-2.5 rounded border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-800">
                    <input
                      type="checkbox"
                      checked={downloadBatchPdfs}
                      onChange={(e) => setDownloadBatchPdfs(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-700"
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
                className="rounded bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer whitespace-nowrap"
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
                {isMultiReport ? (
                  <button
                    type="button"
                    disabled={isBatchIssuing}
                    onClick={handleBatchConvertAndIssue}
                    className="inline-flex items-center gap-1.5 rounded bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
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
                      disabled={!isSingleReport || isApplying || isExportingPdf}
                      onClick={handleLoadIntoStudio}
                      className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                      {isApplying ? 'Loading...' : 'Load into Certificate Studio'}
                    </button>

                    <button
                      type="button"
                      disabled={!isSingleReport || isApplying || isExportingPdf}
                      onClick={handleConvertAndDownloadPdf}
                      className="inline-flex items-center gap-1.5 rounded bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
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
