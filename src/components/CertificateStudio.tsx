import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  Plus,
  Printer,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CalibrationCertificate,
  CalibrationEquipment,
  CalibrationUser,
  DigitalSignature,
  LabSettings,
  PlantEquipment,
  SwitchNormalContact,
  SwitchTripDirection,
  SwitchVerificationData,
  TestReadingRow,
} from '../types/calibration';
import {
  addDaysToDate,
  computeCertificateHash,
  computeOverallCertificateResult,
  computeStandardStatus,
  evaluateReadings,
  formatSignedNumber,
  generateTypedSignatureDataUrl,
  getPlantEquipmentType,
  isStaleZeroToHundredSetpoints,
} from '../utils/calibrationMath';
import { exportCertificateToPdf } from '../utils/pdfGenerator';
import type { ParsedExcelCalibrationReport } from '../utils/excelCalibrationParser';
import type { ParsedTxtCalibrationReport } from '../utils/txtCalibrationParser';
import { CertificatePreview } from './CertificatePreview';
import { ExcelCalibrationImportModal } from './ExcelCalibrationImportModal';
import { PlantDeadlinesWidget } from './PlantDeadlinesWidget';
import { PlantEquipmentModal } from './PlantEquipmentModal';
import {
  CalibrationStandardDropdown,
  PlantEquipmentDropdown,
} from './RichEquipmentDropdown';
import { SignaturePad } from './SignaturePad';
import { CertificateResultLabel } from './StatusText';
import { TxtCalibrationImportModal } from './TxtCalibrationImportModal';

interface CertificateStudioProps {
  standards: CalibrationEquipment[];
  plantEquipment: PlantEquipment[];
  users: CalibrationUser[];
  labSettings: LabSettings;
  nextCertSeq: number;
  selectedPlantId: string;
  onSelectPlantId: (id: string) => void;
  onIssueCertificate: (cert: CalibrationCertificate) => Promise<void>;
  onCreateUser: (user: CalibrationUser) => Promise<void>;
  onCreatePlant?: (item: PlantEquipment) => Promise<PlantEquipment>;
  onUpdatePlant?: (item: PlantEquipment) => Promise<PlantEquipment>;
  onSaveImportedPlant?: (
    candidate: PlantEquipment,
    existingId?: string
  ) => Promise<PlantEquipment>;
  onOpenPlantView?: () => void;
}

const DEFAULT_TRANSMITTER_REMARKS =
  'Instrument tested across 5-point ascending calibration cycle. Zero and span verified within manufacturer limits.';
const DEFAULT_SWITCH_REMARKS =
  'Single-point switch trip verification performed. Actuation setpoint and contact continuity verified within tolerance.';

const UNIT_PRESETS = [
  'bar',
  'mbar',
  'barg',
  'bara',
  'psi',
  'psig',
  'kPa',
  'MPa',
  'Pa',
  '°C',
  '°F',
  'mA',
  'V',
  '%',
  'mmH2O',
  'inH2O',
  'm³/h',
  'kg/h',
  'Hz',
  'Ω',
];

interface PendingUnitPrompt {
  plant: PlantEquipment;
  changes: Array<{
    label: string;
    oldUnit: string;
    newUnit: string;
  }>;
  nextInputUnit: string;
  nextOutputUnit: string;
}

function resolvePlantUnits(plant: PlantEquipment | null): {
  inUnit: string;
  outUnit: string;
} {
  const inUnit =
    plant?.rangeUnit?.trim() || plant?.switchSpec?.unit?.trim() || 'bar';
  const plantIsSwitch = getPlantEquipmentType(plant) === 'switch';
  const outUnit = plantIsSwitch
    ? inUnit
    : plant?.outputUnit?.trim() || 'mA';
  return { inUnit, outUnit };
}

function escapeRegExp(val: string): string {
  return val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceUnitToken(spec: string, oldUnit: string, newUnit: string): string {
  const prev = oldUnit.trim();
  const next = newUnit.trim();
  if (!spec || !prev || !next || prev === next) return spec;
  const pattern = new RegExp(
    `(^|[\\s\\d±/\\-(])${escapeRegExp(prev)}(?=$|[\\s.,;)/])`,
    'g'
  );
  return spec.replace(pattern, `$1${next}`);
}

function buildInitialReadings(plant: PlantEquipment | null): TestReadingRow[] {
  if (!plant) return [];
  const primaryInUnit =
    plant.rangeUnit?.trim() || plant.switchSpec?.unit?.trim() || 'bar';

  if (getPlantEquipmentType(plant) === 'switch') {
    const unit = primaryInUnit;
    const trip =
      plant.switchSpec?.tripSetpoint ??
      plant.setpoints[0]?.nominalInput ??
      plant.rangeMax;
    const tol =
      plant.switchSpec?.tolerancePlusMinus ??
      plant.setpoints[0]?.tolerancePlusMinus ??
      0.3;
    const formatted = Number.isFinite(trip) ? trip.toFixed(2) : '';
    return [
      {
        id: plant.setpoints[0]?.id || `sp-switch-${Date.now()}`,
        label: 'Switch Trip Point',
        nominalInput: trip,
        inputUnit: unit,
        expectedOutput: trip,
        outputUnit: unit,
        asFound: formatted,
        asLeft: formatted,
        tolerance: tol,
      },
    ];
  }

  const primaryOutUnit = plant.outputUnit?.trim() || 'mA';
  if (isStaleZeroToHundredSetpoints(plant)) {
    const fractions = [
      { pct: 0, label: '0% Zero' },
      { pct: 0.25, label: '25% Span' },
      { pct: 0.5, label: '50% Mid' },
      { pct: 0.75, label: '75% Span' },
      { pct: 1, label: '100% Full' },
    ];
    const tol = plant.setpoints?.[0]?.tolerancePlusMinus ?? 0.08;
    return fractions.map((f, idx) => {
      const nomIn = Number(
        (plant.rangeMin + (plant.rangeMax - plant.rangeMin) * f.pct).toFixed(3)
      );
      const expOut = Number(
        (
          plant.outputRangeMin +
          (plant.outputRangeMax - plant.outputRangeMin) * f.pct
        ).toFixed(3)
      );
      return {
        id: `sp-${Date.now()}-${idx}`,
        label: f.label,
        nominalInput: nomIn,
        inputUnit: primaryInUnit,
        expectedOutput: expOut,
        outputUnit: primaryOutUnit,
        asFound: expOut.toFixed(2),
        asLeft: expOut.toFixed(2),
        tolerance: tol,
      };
    });
  }

  return plant.setpoints.map((sp) => ({
    id: `${sp.id}-${Date.now().toString().slice(-4)}`,
    label: sp.label,
    nominalInput: sp.nominalInput,
    inputUnit: plant.rangeUnit?.trim() || sp.inputUnit || 'bar',
    expectedOutput: sp.expectedOutput,
    outputUnit: plant.outputUnit?.trim() || sp.outputUnit || 'mA',
    asFound: sp.expectedOutput.toFixed(2),
    asLeft: sp.expectedOutput.toFixed(2),
    tolerance: sp.tolerancePlusMinus,
  }));
}

export const CertificateStudio: React.FC<CertificateStudioProps> = ({
  standards,
  plantEquipment,
  users,
  labSettings,
  nextCertSeq,
  selectedPlantId,
  onSelectPlantId,
  onIssueCertificate,
  onCreateUser,
  onCreatePlant,
  onUpdatePlant,
  onSaveImportedPlant,
  onOpenPlantView,
}) => {
  const [importedPlantOverride, setImportedPlantOverride] =
    useState<PlantEquipment | null>(null);
  const [importedStandardsSnapshot, setImportedStandardsSnapshot] =
    useState<CalibrationCertificate['referenceStandardsSnapshot'] | null>(null);
  const [switchDeadbandMeta, setSwitchDeadbandMeta] = useState<{
    deadbandMin?: number;
    deadbandMax?: number;
    deadbandError?: number;
    tripDetectionMode?: string;
  } | null>(null);
  const [txtModalOpen, setTxtModalOpen] = useState(false);
  const [excelModalOpen, setExcelModalOpen] = useState(false);
  const [addPlantModalOpen, setAddPlantModalOpen] = useState(false);

  const persistedPlant = useMemo(
    () =>
      importedPlantOverride
        ? plantEquipment.find(
            (p) =>
              p.id === importedPlantOverride.id ||
              p.assetId.trim().toLowerCase() ===
                importedPlantOverride.assetId.trim().toLowerCase()
          ) || null
        : plantEquipment.find((p) => p.id === selectedPlantId) ||
          plantEquipment[0] ||
          null,
    [importedPlantOverride, plantEquipment, selectedPlantId]
  );

  const activePlant = useMemo(
    () => importedPlantOverride || persistedPlant,
    [importedPlantOverride, persistedPlant]
  );

  const isSwitch = getPlantEquipmentType(activePlant) === 'switch';
  const todayStr = new Date().toISOString().slice(0, 10);

  const initialUnits = resolvePlantUnits(activePlant);
  const [studioInputUnit, setStudioInputUnit] = useState(initialUnits.inUnit);
  const [studioOutputUnit, setStudioOutputUnit] = useState(initialUnits.outUnit);
  const [inputUnitDraft, setInputUnitDraft] = useState(initialUnits.inUnit);
  const [outputUnitDraft, setOutputUnitDraft] = useState(initialUnits.outUnit);
  const committedInputUnitRef = useRef(initialUnits.inUnit);
  const committedOutputUnitRef = useRef(initialUnits.outUnit);
  const [pendingUnitPrompt, setPendingUnitPrompt] =
    useState<PendingUnitPrompt | null>(null);
  const [updatingPlantUnit, setUpdatingPlantUnit] = useState(false);

  const syncStudioUnits = (nextIn: string, nextOut: string) => {
    committedInputUnitRef.current = nextIn;
    committedOutputUnitRef.current = nextOut;
    setStudioInputUnit(nextIn);
    setStudioOutputUnit(nextOut);
    setInputUnitDraft(nextIn);
    setOutputUnitDraft(nextOut);
  };

  const [certificateNumber, setCertificateNumber] = useState(
    `CERT-2026-${1041 + nextCertSeq}`
  );
  const [calibrationDate, setCalibrationDate] = useState(todayStr);
  const [nextDueDate, setNextDueDate] = useState(
    activePlant ? addDaysToDate(todayStr, activePlant.frequencyDays) : addDaysToDate(todayStr, 365)
  );
  const [selectedStandardIds, setSelectedStandardIds] = useState<string[]>(() => {
    const validFirst = standards.find((s) => computeStandardStatus(s) === 'Valid');
    return validFirst ? [validFirst.id] : standards[0] ? [standards[0].id] : [];
  });
  const [procedureRef, setProcedureRef] = useState(labSettings.defaultProcedure);
  const [ambientTempC, setAmbientTempC] = useState(labSettings.defaultAmbientTempC);
  const [relativeHumidityPct, setRelativeHumidityPct] = useState(
    labSettings.defaultHumidityPct
  );
  const [barometricPressureHpa, setBarometricPressureHpa] = useState(
    labSettings.defaultPressureHpa
  );
  const [remarks, setRemarks] = useState(() =>
    getPlantEquipmentType(activePlant) === 'switch'
      ? DEFAULT_SWITCH_REMARKS
      : DEFAULT_TRANSMITTER_REMARKS
  );

  const [readings, setReadings] = useState<TestReadingRow[]>(() =>
    buildInitialReadings(activePlant)
  );

  const [switchTripDirection, setSwitchTripDirection] = useState<SwitchTripDirection>(
    () => activePlant?.switchSpec?.tripDirection || 'Rising (High)'
  );
  const [switchNormalContact, setSwitchNormalContact] = useState<SwitchNormalContact>(
    () => activePlant?.switchSpec?.normalContact || 'NC (Normally Closed)'
  );
  const [switchAsFoundReset, setSwitchAsFoundReset] = useState<string>(() =>
    activePlant?.switchSpec?.resetPoint !== undefined
      ? activePlant.switchSpec.resetPoint.toFixed(2)
      : ''
  );
  const [switchAsLeftReset, setSwitchAsLeftReset] = useState<string>(() =>
    activePlant?.switchSpec?.resetPoint !== undefined
      ? activePlant.switchSpec.resetPoint.toFixed(2)
      : ''
  );
  const [switchContactVerified, setSwitchContactVerified] = useState<boolean>(true);

  const [techSignature, setTechSignature] = useState<DigitalSignature>(() => ({
    signerName: 'Marcus Vance',
    signerTitle: 'Senior Metrology Technician',
    licenseId: 'MET-4491',
    signedAt: new Date().toISOString(),
    signatureDataUrl: generateTypedSignatureDataUrl('Marcus Vance'),
    method: 'typed',
  }));

  const [approverSignature, setApproverSignature] = useState<DigitalSignature>(
    () => ({
      signerName: 'Dr. Elena Rostova',
      signerTitle: 'QA Calibration Lead',
      licenseId: 'QA-1082',
      signedAt: new Date().toISOString(),
      signatureDataUrl: generateTypedSignatureDataUrl('Dr. Elena Rostova'),
      method: 'typed',
    })
  );

  const [verificationHash, setVerificationHash] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // When selected plant changes, hydrate setpoints / single-point switch config & nextDueDate
  const handleSelectPlant = (plant: PlantEquipment) => {
    const nextUnits = resolvePlantUnits(plant);
    syncStudioUnits(nextUnits.inUnit, nextUnits.outUnit);
    setPendingUnitPrompt(null);
    setImportedPlantOverride(null);
    setSwitchDeadbandMeta(null);
    onSelectPlantId(plant.id);
    setNextDueDate(addDaysToDate(calibrationDate, plant.frequencyDays));
    setReadings(buildInitialReadings(plant));
    const plantIsSwitch = getPlantEquipmentType(plant) === 'switch';
    if (plantIsSwitch) {
      setSwitchTripDirection(plant.switchSpec?.tripDirection || 'Rising (High)');
      setSwitchNormalContact(plant.switchSpec?.normalContact || 'NC (Normally Closed)');
      const resetStr =
        plant.switchSpec?.resetPoint !== undefined
          ? plant.switchSpec.resetPoint.toFixed(2)
          : '';
      setSwitchAsFoundReset(resetStr);
      setSwitchAsLeftReset(resetStr);
      setSwitchContactVerified(true);
      if (remarks === DEFAULT_TRANSMITTER_REMARKS) {
        setRemarks(DEFAULT_SWITCH_REMARKS);
      }
    } else if (remarks === DEFAULT_SWITCH_REMARKS) {
      setRemarks(DEFAULT_TRANSMITTER_REMARKS);
    }
    setSaveNotice(null);
  };

  // Apply parsed .TXT or Excel calibration report into Certificate Studio
  const handleApplyImportedReport = async (
    report: ParsedTxtCalibrationReport | ParsedExcelCalibrationReport,
    savePlantToDb: boolean
  ) => {
    const existingAsset = plantEquipment.find(
      (p) => p.assetId.trim().toLowerCase() === report.tag.trim().toLowerCase()
    );

    if (savePlantToDb && onSaveImportedPlant) {
      const saved = await onSaveImportedPlant(
        report.plantAssetCandidate,
        existingAsset?.id
      );
      setImportedPlantOverride(null);
      onSelectPlantId(saved.id);
    } else {
      setImportedPlantOverride(report.plantAssetCandidate);
    }

    setCalibrationDate(report.calibrationDate);
    setNextDueDate(report.plantAssetCandidate.nextDueDate);

    if (report.matchedStandardIds.length > 0) {
      setSelectedStandardIds(report.matchedStandardIds);
    } else if (report.referenceStandardsSnapshot.length > 0) {
      setSelectedStandardIds([]);
    }

    const unmatchedSnapshots = report.referenceStandardsSnapshot.filter(
      (s) => !report.matchedStandardIds.includes(s.id)
    );
    setImportedStandardsSnapshot(
      unmatchedSnapshots.length > 0 ? unmatchedSnapshots : null
    );

    setReadings(report.readings);
    setRemarks(report.remarks);

    const firstRow = report.readings[0];
    const reportInUnit =
      firstRow?.inputUnit?.trim() ||
      report.plantAssetCandidate.rangeUnit?.trim() ||
      'bar';
    const reportOutUnit =
      report.equipmentType === 'switch'
        ? report.switchVerification?.unit?.trim() || reportInUnit
        : firstRow?.outputUnit?.trim() ||
          report.plantAssetCandidate.outputUnit?.trim() ||
          'mA';
    syncStudioUnits(reportInUnit, reportOutUnit);
    setPendingUnitPrompt(null);

    if (report.equipmentType === 'switch' && report.switchVerification) {
      const sw = report.switchVerification;
      setSwitchTripDirection(sw.tripDirection);
      setSwitchNormalContact(sw.normalContact);
      setSwitchAsFoundReset(sw.asFoundReset || '');
      setSwitchAsLeftReset(sw.asLeftReset || '');
      setSwitchContactVerified(sw.contactVerified);
      setSwitchDeadbandMeta({
        ...(sw.deadbandMin !== undefined ? { deadbandMin: sw.deadbandMin } : {}),
        ...(sw.deadbandMax !== undefined ? { deadbandMax: sw.deadbandMax } : {}),
        ...(sw.deadbandError !== undefined ? { deadbandError: sw.deadbandError } : {}),
        ...(sw.tripDetectionMode ? { tripDetectionMode: sw.tripDetectionMode } : {}),
      });
    } else {
      setSwitchDeadbandMeta(null);
    }

    if ('performedBy' in report && report.performedBy) {
      const matchedTech = users.find(
        (u) => u.fullName.trim().toLowerCase() === report.performedBy!.trim().toLowerCase()
      );
      if (matchedTech) {
        setTechSignature({
          signerName: matchedTech.fullName,
          signerTitle: matchedTech.title,
          licenseId: matchedTech.licenseId,
          signedAt: new Date().toISOString(),
          signatureDataUrl: generateTypedSignatureDataUrl(matchedTech.fullName),
          method: 'typed',
        });
      } else {
        setTechSignature((prev) => ({
          ...prev,
          signerName: report.performedBy!,
          signedAt: new Date().toISOString(),
          signatureDataUrl: generateTypedSignatureDataUrl(report.performedBy!),
          method: 'typed',
        }));
      }
    }

    if ('approvedBy' in report && report.approvedBy) {
      const matchedApprover = users.find(
        (u) => u.fullName.trim().toLowerCase() === report.approvedBy!.trim().toLowerCase()
      );
      if (matchedApprover) {
        setApproverSignature({
          signerName: matchedApprover.fullName,
          signerTitle: matchedApprover.title,
          licenseId: matchedApprover.licenseId,
          signedAt: new Date().toISOString(),
          signatureDataUrl: generateTypedSignatureDataUrl(matchedApprover.fullName),
          method: 'typed',
        });
      } else {
        setApproverSignature((prev) => ({
          ...prev,
          signerName: report.approvedBy!,
          signedAt: new Date().toISOString(),
          signatureDataUrl: generateTypedSignatureDataUrl(report.approvedBy!),
          method: 'typed',
        }));
      }
    }

    setSaveError(null);
    setSaveNotice(
      `Loaded ${report.equipmentType === 'switch' ? 'Single-Point Switch' : `${report.readings.length}-Point Transmitter`} data from ${report.fileName} (${report.tag}).`
    );
  };

  // Recompute nextDueDate when calibrationDate changes
  const handleCalibrationDateChange = (newDate: string) => {
    setCalibrationDate(newDate);
    if (activePlant && newDate) {
      setNextDueDate(addDaysToDate(newDate, activePlant.frequencyDays));
    }
  };

  const handleToggleStandard = (std: CalibrationEquipment) => {
    setSelectedStandardIds((prev) =>
      prev.includes(std.id)
        ? prev.filter((id) => id !== std.id)
        : [...prev, std.id]
    );
  };

  const selectedStandards = useMemo(
    () => standards.filter((s) => selectedStandardIds.includes(s.id)),
    [standards, selectedStandardIds]
  );

  const effectiveStandardsSnapshot = useMemo(() => {
    const dbSnaps = selectedStandards.map((s) => ({
      id: s.id,
      standardCode: s.standardCode,
      name: s.name,
      manufacturer: s.manufacturer,
      model: s.model,
      serialNumber: s.serialNumber,
      certificateRef: s.certificateRef,
      lastCalibrationDate: s.lastCalibrationDate,
      nextDueDate: s.nextDueDate,
      status: computeStandardStatus(s),
      accuracySpec: s.accuracySpec,
    }));
    const logSnaps = (importedStandardsSnapshot || []).filter(
      (s) => !selectedStandardIds.includes(s.id)
    );
    return [...dbSnaps, ...logSnaps];
  }, [selectedStandards, importedStandardsSnapshot, selectedStandardIds]);

  const hasOutOfDateStandard = useMemo(
    () =>
      selectedStandards.some((s) => {
        const st = computeStandardStatus(s);
        return st === 'Overdue' || st === 'Out for Calibration' || st === 'Retired';
      }),
    [selectedStandards]
  );

  const outputSpan =
    activePlant && !isSwitch
      ? Math.abs(activePlant.outputRangeMax - activePlant.outputRangeMin)
      : undefined;

  const activeReadings = useMemo(
    () => (isSwitch ? readings.slice(0, 1) : readings),
    [isSwitch, readings]
  );

  const evaluatedReadings = useMemo(
    () => evaluateReadings(activeReadings, outputSpan),
    [activeReadings, outputSpan]
  );

  const overallResult = useMemo(
    () =>
      computeOverallCertificateResult(
        evaluatedReadings,
        isSwitch ? switchContactVerified : undefined
      ),
    [evaluatedReadings, isSwitch, switchContactVerified]
  );

  const switchVerification: SwitchVerificationData | undefined = useMemo(() => {
    if (!isSwitch) return undefined;
    const pt = activeReadings[0];
    return {
      tripDirection: switchTripDirection,
      normalContact: switchNormalContact,
      tripSetpoint: pt?.expectedOutput ?? activePlant?.switchSpec?.tripSetpoint ?? 0,
      tolerancePlusMinus:
        pt?.tolerance ?? activePlant?.switchSpec?.tolerancePlusMinus ?? 0.3,
      unit: pt?.outputUnit || studioInputUnit || activePlant?.rangeUnit || 'bar',
      asFoundTrip: pt?.asFound || '',
      asLeftTrip: pt?.asLeft || '',
      ...(switchAsFoundReset.trim() ? { asFoundReset: switchAsFoundReset.trim() } : {}),
      ...(switchAsLeftReset.trim() ? { asLeftReset: switchAsLeftReset.trim() } : {}),
      ...(switchDeadbandMeta?.deadbandMin !== undefined
        ? { deadbandMin: switchDeadbandMeta.deadbandMin }
        : {}),
      ...(switchDeadbandMeta?.deadbandMax !== undefined
        ? { deadbandMax: switchDeadbandMeta.deadbandMax }
        : {}),
      ...(switchDeadbandMeta?.deadbandError !== undefined
        ? { deadbandError: switchDeadbandMeta.deadbandError }
        : {}),
      ...(switchDeadbandMeta?.tripDetectionMode
        ? { tripDetectionMode: switchDeadbandMeta.tripDetectionMode }
        : {}),
      contactVerified: switchContactVerified,
    };
  }, [
    isSwitch,
    activeReadings,
    activePlant,
    switchTripDirection,
    switchNormalContact,
    switchAsFoundReset,
    switchAsLeftReset,
    switchDeadbandMeta,
    switchContactVerified,
  ]);

  // Keep SHA-256 verification digest live
  useEffect(() => {
    let active = true;
    computeCertificateHash({
      certificateNumber,
      calibrationDate,
      nextDueDate,
      assetId: activePlant?.assetId || 'UNASSIGNED',
      referenceStandardIds: effectiveStandardsSnapshot.map((s) => s.id),
      readings: activeReadings,
      switchVerification,
      overallResult,
      technicianName: techSignature.signerName,
      approverName: approverSignature.signerName,
    }).then((hash) => {
      if (active) setVerificationHash(hash);
    });
    return () => {
      active = false;
    };
  }, [
    certificateNumber,
    calibrationDate,
    nextDueDate,
    activePlant?.assetId,
    effectiveStandardsSnapshot,
    activeReadings,
    switchVerification,
    overallResult,
    techSignature.signerName,
    approverSignature.signerName,
  ]);

  const effectiveToleranceSpec = useMemo(() => {
    if (!activePlant) return '—';
    let spec = replaceUnitToken(
      activePlant.toleranceSpec,
      activePlant.rangeUnit,
      studioInputUnit
    );
    if (!isSwitch) {
      spec = replaceUnitToken(spec, activePlant.outputUnit, studioOutputUnit);
    }
    return spec;
  }, [activePlant, isSwitch, studioInputUnit, studioOutputUnit]);

  const draftCertificate: CalibrationCertificate = useMemo(
    () => ({
      id: `cert-draft`,
      certificateNumber,
      createdAt: new Date().toISOString(),
      calibrationDate,
      nextDueDate,
      plantEquipmentId: activePlant?.id || '',
      assetId: activePlant?.assetId || 'N/A',
      assetSnapshot: activePlant
        ? {
            assetId: activePlant.assetId,
            tagName: activePlant.tagName,
            description: activePlant.description,
            manufacturer: activePlant.manufacturer,
            model: activePlant.model,
            serialNumber: activePlant.serialNumber,
            plantArea: activePlant.plantArea,
            category: activePlant.category,
            equipmentType: isSwitch ? 'switch' : 'transmitter',
            frequencyLabel: activePlant.frequencyLabel,
            rangeText: `${activePlant.rangeMin} – ${activePlant.rangeMax} ${studioInputUnit}`,
            outputRangeText: isSwitch
              ? `${switchTripDirection} · ${switchNormalContact}`
              : `${activePlant.outputRangeMin} – ${activePlant.outputRangeMax} ${studioOutputUnit}`,
            toleranceSpec: effectiveToleranceSpec,
          }
        : {
            assetId: 'N/A',
            tagName: 'No Plant Equipment Selected',
            description: 'Select an asset from the dropdown',
            manufacturer: '—',
            model: '—',
            serialNumber: '—',
            plantArea: '—',
            category: '—',
            equipmentType: 'transmitter',
            frequencyLabel: '—',
            rangeText: '—',
            outputRangeText: '—',
            toleranceSpec: '—',
          },
      referenceStandardIds: effectiveStandardsSnapshot.map((s) => s.id),
      referenceStandardsSnapshot: effectiveStandardsSnapshot,
      laboratoryName: labSettings.laboratoryName,
      accreditationNumber: labSettings.accreditationNumber,
      facilityAddress: labSettings.facilityAddress,
      procedureRef,
      ambientTempC,
      relativeHumidityPct,
      barometricPressureHpa,
      readings: activeReadings,
      ...(switchVerification ? { switchVerification } : {}),
      overallResult,
      remarks,
      technicianSignature: techSignature,
      approverSignature,
      verificationHash,
    }),
    [
      certificateNumber,
      calibrationDate,
      nextDueDate,
      activePlant,
      isSwitch,
      studioInputUnit,
      studioOutputUnit,
      effectiveToleranceSpec,
      switchTripDirection,
      switchNormalContact,
      effectiveStandardsSnapshot,
      labSettings,
      procedureRef,
      ambientTempC,
      relativeHumidityPct,
      barometricPressureHpa,
      activeReadings,
      switchVerification,
      overallResult,
      remarks,
      techSignature,
      approverSignature,
      verificationHash,
    ]
  );

  const updateReadingField = (
    rowId: string,
    field: keyof TestReadingRow,
    val: string | number
  ) => {
    setReadings((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, [field]: val } : row))
    );
  };

  const addSetpointRow = () => {
    const last = readings[readings.length - 1];
    setReadings((prev) => [
      ...prev,
      {
        id: `row-${Date.now()}`,
        label: `Point ${prev.length + 1}`,
        nominalInput: last ? last.nominalInput : activePlant?.rangeMin ?? 0,
        inputUnit: studioInputUnit || last?.inputUnit || 'bar',
        expectedOutput: last ? last.expectedOutput : activePlant?.outputRangeMin ?? 4,
        outputUnit: studioOutputUnit || last?.outputUnit || 'mA',
        asFound: '',
        asLeft: '',
        tolerance: last ? last.tolerance : 0.08,
      },
    ]);
  };

  const buildUnitChangesList = (
    plant: PlantEquipment,
    nextIn: string,
    nextOut: string
  ): PendingUnitPrompt['changes'] => {
    const plantIsSwitch = getPlantEquipmentType(plant) === 'switch';
    const dbUnits = resolvePlantUnits(plant);
    const changes: PendingUnitPrompt['changes'] = [];
    if (plantIsSwitch) {
      if (nextIn !== dbUnits.inUnit) {
        changes.push({
          label: 'Engineering Unit',
          oldUnit: dbUnits.inUnit,
          newUnit: nextIn,
        });
      }
    } else {
      if (nextIn !== dbUnits.inUnit) {
        changes.push({
          label: 'Input Range Unit',
          oldUnit: dbUnits.inUnit,
          newUnit: nextIn,
        });
      }
      if (nextOut !== dbUnits.outUnit) {
        changes.push({
          label: 'Output Signal Unit',
          oldUnit: dbUnits.outUnit,
          newUnit: nextOut,
        });
      }
    }
    return changes;
  };

  const commitUnitChanges = (scope: 'switch' | 'input' | 'output' | 'both') => {
    if (scope === 'switch' || isSwitch) {
      const nextUnit = inputUnitDraft.trim();
      if (!nextUnit) {
        setInputUnitDraft(committedInputUnitRef.current);
        return;
      }
      if (nextUnit === committedInputUnitRef.current) {
        return;
      }
      syncStudioUnits(nextUnit, nextUnit);
      setReadings((prev) =>
        prev.map((row) => ({
          ...row,
          inputUnit: nextUnit,
          outputUnit: nextUnit,
        }))
      );
      if (importedPlantOverride) {
        setImportedPlantOverride((prev) =>
          prev
            ? {
                ...prev,
                rangeUnit: nextUnit,
                toleranceSpec: replaceUnitToken(
                  prev.toleranceSpec,
                  prev.rangeUnit,
                  nextUnit
                ),
                switchSpec: prev.switchSpec
                  ? { ...prev.switchSpec, unit: nextUnit }
                  : undefined,
                setpoints: prev.setpoints.map((sp) => ({
                  ...sp,
                  inputUnit: nextUnit,
                  outputUnit: nextUnit,
                })),
              }
            : null
        );
      }

      if (persistedPlant && onUpdatePlant) {
        const changes = buildUnitChangesList(persistedPlant, nextUnit, nextUnit);
        if (changes.length > 0) {
          setPendingUnitPrompt({
            plant: persistedPlant,
            changes,
            nextInputUnit: nextUnit,
            nextOutputUnit: nextUnit,
          });
        }
      }
      return;
    }

    const rawIn = inputUnitDraft.trim();
    const rawOut = outputUnitDraft.trim();
    if (!rawIn) setInputUnitDraft(committedInputUnitRef.current);
    if (!rawOut) setOutputUnitDraft(committedOutputUnitRef.current);

    const nextIn =
      scope === 'output'
        ? committedInputUnitRef.current
        : rawIn || committedInputUnitRef.current;
    const nextOut =
      scope === 'input'
        ? committedOutputUnitRef.current
        : rawOut || committedOutputUnitRef.current;

    const inChanged = nextIn !== committedInputUnitRef.current;
    const outChanged = nextOut !== committedOutputUnitRef.current;
    if (!inChanged && !outChanged) {
      return;
    }

    syncStudioUnits(nextIn, nextOut);
    setReadings((prev) =>
      prev.map((row) => ({
        ...row,
        inputUnit: nextIn,
        outputUnit: nextOut,
      }))
    );

    if (importedPlantOverride) {
      setImportedPlantOverride((prev) =>
        prev
          ? {
              ...prev,
              rangeUnit: nextIn,
              outputUnit: nextOut,
              toleranceSpec: replaceUnitToken(
                replaceUnitToken(prev.toleranceSpec, prev.rangeUnit, nextIn),
                prev.outputUnit,
                nextOut
              ),
              setpoints: prev.setpoints.map((sp) => ({
                ...sp,
                inputUnit: nextIn,
                outputUnit: nextOut,
              })),
            }
          : null
      );
    }

    if (persistedPlant && onUpdatePlant) {
      const changes = buildUnitChangesList(persistedPlant, nextIn, nextOut);
      if (changes.length > 0) {
        setPendingUnitPrompt({
          plant: persistedPlant,
          changes,
          nextInputUnit: nextIn,
          nextOutputUnit: nextOut,
        });
      }
    }
  };

  const handleOpenSyncUnitPrompt = () => {
    if (!persistedPlant || !onUpdatePlant) return;
    const changes = buildUnitChangesList(
      persistedPlant,
      studioInputUnit,
      studioOutputUnit
    );
    if (changes.length === 0) return;
    setPendingUnitPrompt({
      plant: persistedPlant,
      changes,
      nextInputUnit: studioInputUnit,
      nextOutputUnit: studioOutputUnit,
    });
  };

  const handleConfirmUpdatePlantUnit = async () => {
    if (!pendingUnitPrompt || !onUpdatePlant) return;
    const { plant, nextInputUnit, nextOutputUnit } = pendingUnitPrompt;
    const plantIsSwitch = getPlantEquipmentType(plant) === 'switch';
    setUpdatingPlantUnit(true);
    try {
      let nextToleranceSpec = replaceUnitToken(
        plant.toleranceSpec,
        plant.rangeUnit,
        nextInputUnit
      );
      if (!plantIsSwitch) {
        nextToleranceSpec = replaceUnitToken(
          nextToleranceSpec,
          plant.outputUnit,
          nextOutputUnit
        );
      }

      const updatedPayload: PlantEquipment = {
        ...plant,
        rangeUnit: nextInputUnit,
        outputUnit: plantIsSwitch ? plant.outputUnit || 'Contact' : nextOutputUnit,
        toleranceSpec: nextToleranceSpec,
        ...(plantIsSwitch
          ? {
              switchSpec: {
                tripDirection: plant.switchSpec?.tripDirection || switchTripDirection,
                normalContact: plant.switchSpec?.normalContact || switchNormalContact,
                tripSetpoint:
                  plant.switchSpec?.tripSetpoint ??
                  activeReadings[0]?.expectedOutput ??
                  plant.rangeMax,
                ...(plant.switchSpec?.resetPoint !== undefined
                  ? { resetPoint: plant.switchSpec.resetPoint }
                  : {}),
                tolerancePlusMinus:
                  plant.switchSpec?.tolerancePlusMinus ??
                  activeReadings[0]?.tolerance ??
                  0.3,
                unit: nextInputUnit,
              },
            }
          : {}),
        setpoints: plant.setpoints.map((sp) => ({
          ...sp,
          inputUnit: nextInputUnit,
          outputUnit: plantIsSwitch ? nextInputUnit : nextOutputUnit,
        })),
      };

      const saved = await onUpdatePlant(updatedPayload);
      if (
        importedPlantOverride &&
        importedPlantOverride.assetId.trim().toLowerCase() ===
          saved.assetId.trim().toLowerCase()
      ) {
        setImportedPlantOverride((prev) =>
          prev
            ? {
                ...prev,
                rangeUnit: saved.rangeUnit,
                outputUnit: saved.outputUnit,
                toleranceSpec: saved.toleranceSpec,
                switchSpec: saved.switchSpec,
              }
            : null
        );
      }
      setPendingUnitPrompt(null);
      setSaveError(null);
      setSaveNotice(
        plantIsSwitch
          ? `Updated unit of measure to "${nextInputUnit}" in Certificate Studio and saved to plant asset ${saved.assetId}.`
          : `Updated units (${nextInputUnit} / ${nextOutputUnit}) in Certificate Studio and saved to plant asset ${saved.assetId}.`
      );
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : 'Failed to update unit of measure in plant asset.'
      );
      setPendingUnitPrompt(null);
    } finally {
      setUpdatingPlantUnit(false);
    }
  };

  const handleKeepCertificateUnitOnly = () => {
    if (!pendingUnitPrompt) return;
    const { plant, nextInputUnit, nextOutputUnit } = pendingUnitPrompt;
    const plantIsSwitch = getPlantEquipmentType(plant) === 'switch';
    setPendingUnitPrompt(null);
    setSaveError(null);
    setSaveNotice(
      plantIsSwitch
        ? `Changed unit to "${nextInputUnit}" for this certificate only. Plant asset ${plant.assetId} remains "${plant.rangeUnit}".`
        : `Changed units (${nextInputUnit} / ${nextOutputUnit}) for this certificate only. Plant asset ${plant.assetId} remains unchanged.`
    );
  };

  const removeReadingRow = (rowId: string) => {
    setReadings((prev) => prev.filter((r) => r.id !== rowId));
  };

  const autoFillNominal = () => {
    setReadings((prev) =>
      prev.map((row) => ({
        ...row,
        asFound: row.expectedOutput.toFixed(3).replace(/\.?0+$/, (m) => (m.includes('.') ? '.00' : m)),
        asLeft: row.expectedOutput.toFixed(3).replace(/\.?0+$/, (m) => (m.includes('.') ? '.00' : m)),
      }))
    );
  };

  const handleSaveAndDownloadPdf = async (downloadAfterSave: boolean) => {
    if (!activePlant) {
      setSaveError('Please select a Plant Asset under calibration first.');
      return;
    }
    if (!techSignature.signatureDataUrl || !approverSignature.signatureDataUrl) {
      setSaveError(
        'Both Technician and Quality Approver digital signatures are required before issuing a certificate.'
      );
      return;
    }
    setSaveError(null);
    setSaveNotice(null);
    setIsSaving(true);
    try {
      const issuedCert: CalibrationCertificate = {
        ...draftCertificate,
        id: `cert-${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
      await onIssueCertificate(issuedCert);
      if (downloadAfterSave) {
        await exportCertificateToPdf(issuedCert);
      }
      setSaveNotice(
        `Certificate ${issuedCert.certificateNumber} archived and ${issuedCert.assetSnapshot.assetId} schedule updated.`
      );
      // Increment next certificate number
      const match = certificateNumber.match(/^(.*?)(\d+)$/);
      if (match) {
        const nextNum = Number(match[2]) + 1;
        setCertificateNumber(`${match[1]}${nextNum}`);
      }
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Failed to save certificate.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      {/* Upcoming Calibration Deadlines Dashboard Widget */}
      <PlantDeadlinesWidget
        plantEquipment={plantEquipment}
        selectedPlantId={activePlant?.id || ''}
        onSelectPlant={handleSelectPlant}
        onOpenPlantView={onOpenPlantView}
      />

      {/* Top Equipment Selection Bar (Two Required Dropdowns) */}
      <section className="no-print mb-6 rounded-md border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-display text-lg font-bold text-slate-900">
              Calibration Certificate Studio
            </h1>
            <p className="text-xs text-slate-500">
              Select a plant asset and traceable reference standards to auto-calculate deviations and generate a digitally signed PDF certificate.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setAddPlantModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              Add new plant asset
            </button>
            <button
              type="button"
              onClick={() => setExcelModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded border border-emerald-700 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 cursor-pointer whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Import Excel Report
            </button>
            <button
              type="button"
              onClick={() => setTxtModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded border border-blue-700 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 transition-colors hover:bg-blue-100 cursor-pointer whitespace-nowrap shrink-0"
            >
              <FileUp className="h-3.5 w-3.5" />
              Import .TXT Report
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Overall Determination:</span>
              <CertificateResultLabel result={overallResult} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PlantEquipmentDropdown
            items={plantEquipment}
            selectedId={importedPlantOverride ? '' : activePlant?.id || ''}
            onSelect={handleSelectPlant}
          />
          <CalibrationStandardDropdown
            items={standards}
            selectedIds={selectedStandardIds}
            onToggleSelect={handleToggleStandard}
            multiSelect
          />
        </div>

        {(importedPlantOverride || (importedStandardsSnapshot && importedStandardsSnapshot.length > 0)) && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            <span>
              {importedPlantOverride && (
                <>
                  Loaded standalone asset{' '}
                  <span className="font-mono font-semibold">{importedPlantOverride.assetId}</span>{' '}
                  from imported .txt log.{' '}
                </>
              )}
              {importedStandardsSnapshot && importedStandardsSnapshot.length > 0 && (
                <>
                  Including {importedStandardsSnapshot.length} test equipment item
                  {importedStandardsSnapshot.length > 1 ? 's' : ''} from imported .txt log in Section 2.
                </>
              )}
            </span>
            {importedStandardsSnapshot && importedStandardsSnapshot.length > 0 && (
              <button
                type="button"
                onClick={() => setImportedStandardsSnapshot(null)}
                className="font-semibold text-blue-800 underline hover:text-blue-950 cursor-pointer whitespace-nowrap"
              >
                Clear log standards
              </button>
            )}
          </div>
        )}

        {hasOutOfDateStandard && (
          <div className="mt-3 flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
            <span>
              One or more selected calibration reference standards are marked Overdue, Out for Calibration, or Retired. Verify traceability before issuing.
            </span>
          </div>
        )}
      </section>

      {/* Main Split Workspace: Left Entry Form / Right Live A4 Certificate */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
        {/* Left Control Column */}
        <div className="no-print space-y-5 xl:col-span-6">
          {/* Certificate & Environmental Metadata */}
          <section className="rounded-md border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-xs font-bold tracking-wide text-slate-800 uppercase">
              01. Certificate Metadata & Ambient Conditions
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">
                  Certificate Number
                </label>
                <input
                  type="text"
                  value={certificateNumber}
                  onChange={(e) => setCertificateNumber(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">
                  Calibration Date
                </label>
                <input
                  type="date"
                  value={calibrationDate}
                  onChange={(e) => handleCalibrationDateChange(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">
                  Next Due Date ({activePlant?.frequencyDays || 365}d)
                </label>
                <input
                  type="date"
                  value={nextDueDate}
                  onChange={(e) => setNextDueDate(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="sm:col-span-1">
                <label className="mb-1 block text-[11px] font-medium text-slate-600">
                  Ambient (°C)
                </label>
                <input
                  type="text"
                  value={ambientTempC}
                  onChange={(e) => setAmbientTempC(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-1">
                <label className="mb-1 block text-[11px] font-medium text-slate-600">
                  Humidity (%RH)
                </label>
                <input
                  type="text"
                  value={relativeHumidityPct}
                  onChange={(e) => setRelativeHumidityPct(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-1">
                <label className="mb-1 block text-[11px] font-medium text-slate-600">
                  Pressure (hPa)
                </label>
                <input
                  type="text"
                  value={barometricPressureHpa}
                  onChange={(e) => setBarometricPressureHpa(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-1">
                <label className="mb-1 block text-[11px] font-medium text-slate-600">
                  Procedure Ref
                </label>
                <input
                  type="text"
                  value={procedureRef}
                  onChange={(e) => setProcedureRef(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>
          </section>

          {/* Calibration Setpoints OR Single-Point Switch Verification */}
          <section className="rounded-md border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-bold tracking-wide text-slate-800 uppercase">
                  {isSwitch
                    ? '02. Single-Point Switch Verification'
                    : '02. Setpoints & Measured Readings'}
                </h2>
                <p className="text-[11px] text-slate-500">
                  {isSwitch
                    ? 'Single-point trip verification against target actuation setpoint and ± tolerance.'
                    : 'Errors and pass/fail verdicts compute automatically against ± tolerance.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={autoFillNominal}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  <Sparkles className="h-3.5 w-3.5 text-blue-700" />
                  {isSwitch ? 'Fill Target Trip' : 'Fill Nominal'}
                </button>
                {!isSwitch && (
                  <button
                    type="button"
                    onClick={addSetpointRow}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Point
                  </button>
                )}
              </div>
            </div>

            {activePlant && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2">
                <datalist id="studio-unit-presets">
                  {UNIT_PRESETS.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>

                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[11px] font-semibold text-slate-700">
                    Unit of Measure:
                  </span>
                  {isSwitch ? (
                    <div className="flex items-center gap-1.5">
                      <label
                        htmlFor="studio-switch-unit"
                        className="text-[11px] text-slate-500"
                      >
                        Eng. Unit
                      </label>
                      <input
                        id="studio-switch-unit"
                        type="text"
                        list="studio-unit-presets"
                        value={inputUnitDraft}
                        onChange={(e) => setInputUnitDraft(e.target.value)}
                        onBlur={() => commitUnitChanges('switch')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitUnitChanges('switch');
                            e.currentTarget.blur();
                          }
                        }}
                        className="w-24 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => commitUnitChanges('switch')}
                        disabled={
                          !inputUnitDraft.trim() ||
                          inputUnitDraft.trim() === studioInputUnit
                        }
                        className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
                      >
                        Apply
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2.5">
                      <div className="flex items-center gap-1.5">
                        <label
                          htmlFor="studio-input-unit"
                          className="text-[11px] text-slate-500"
                        >
                          Input
                        </label>
                        <input
                          id="studio-input-unit"
                          type="text"
                          list="studio-unit-presets"
                          value={inputUnitDraft}
                          onChange={(e) => setInputUnitDraft(e.target.value)}
                          onBlur={() => commitUnitChanges('input')}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitUnitChanges('input');
                              e.currentTarget.blur();
                            }
                          }}
                          className="w-20 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label
                          htmlFor="studio-output-unit"
                          className="text-[11px] text-slate-500"
                        >
                          Output
                        </label>
                        <input
                          id="studio-output-unit"
                          type="text"
                          list="studio-unit-presets"
                          value={outputUnitDraft}
                          onChange={(e) => setOutputUnitDraft(e.target.value)}
                          onBlur={() => commitUnitChanges('output')}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitUnitChanges('output');
                              e.currentTarget.blur();
                            }
                          }}
                          className="w-20 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => commitUnitChanges('both')}
                        disabled={
                          (!inputUnitDraft.trim() ||
                            inputUnitDraft.trim() === studioInputUnit) &&
                          (!outputUnitDraft.trim() ||
                            outputUnitDraft.trim() === studioOutputUnit)
                        }
                        className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
                      >
                        Apply
                      </button>
                    </div>
                  )}
                </div>

                {persistedPlant &&
                  onUpdatePlant &&
                  buildUnitChangesList(
                    persistedPlant,
                    studioInputUnit,
                    studioOutputUnit
                  ).length > 0 && (
                    <div className="flex items-center gap-2 text-[11px] text-amber-800">
                      <span>
                        Certificate only (Asset:{' '}
                        <span className="font-mono font-semibold">
                          {isSwitch
                            ? resolvePlantUnits(persistedPlant).inUnit
                            : `${resolvePlantUnits(persistedPlant).inUnit} / ${resolvePlantUnits(persistedPlant).outUnit}`}
                        </span>
                        )
                      </span>
                      <button
                        type="button"
                        onClick={handleOpenSyncUnitPrompt}
                        className="font-semibold text-blue-700 underline hover:text-blue-900 cursor-pointer whitespace-nowrap"
                      >
                        Update Plant Asset
                      </button>
                    </div>
                  )}
              </div>
            )}

            {isSwitch && evaluatedReadings[0] ? (
              (() => {
                const row = evaluatedReadings[0];
                const activePass =
                  row.asLeftPass !== null ? row.asLeftPass : row.asFoundPass;
                const foundTripNum = Number(row.asFound);
                const leftTripNum = Number(row.asLeft);
                const foundResetNum = Number(switchAsFoundReset);
                const leftResetNum = Number(switchAsLeftReset);
                const deadbandText =
                  switchAsLeftReset.trim() !== '' &&
                  !Number.isNaN(leftResetNum) &&
                  row.asLeft.trim() !== '' &&
                  !Number.isNaN(leftTripNum)
                    ? `${Math.abs(leftTripNum - leftResetNum).toFixed(2)} ${row.outputUnit}`
                    : switchAsFoundReset.trim() !== '' &&
                        !Number.isNaN(foundResetNum) &&
                        row.asFound.trim() !== '' &&
                        !Number.isNaN(foundTripNum)
                      ? `${Math.abs(foundTripNum - foundResetNum).toFixed(2)} ${row.outputUnit}`
                      : '—';

                return (
                  <div className="space-y-3">
                    <div className="rounded border border-indigo-200 bg-indigo-50/35 p-3">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-600">
                            Target Trip ({row.outputUnit})
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={row.expectedOutput}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setReadings((prev) =>
                                prev.map((r, idx) =>
                                  idx === 0
                                    ? { ...r, nominalInput: val, expectedOutput: val }
                                    : r
                                )
                              );
                            }}
                            className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold text-slate-900 focus:border-blue-600 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-600">
                            As-Found Trip ({row.outputUnit})
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={row.asFound}
                            onChange={(e) =>
                              updateReadingField(row.id, 'asFound', e.target.value)
                            }
                            placeholder="—"
                            className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                          />
                          <div
                            className={`mt-1 font-mono text-[10px] tabular-nums ${
                              row.asFoundPass === false
                                ? 'font-semibold text-rose-700'
                                : 'text-slate-500'
                            }`}
                          >
                            Dev: {formatSignedNumber(row.asFoundError, 3)}
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-600">
                            As-Left Trip ({row.outputUnit})
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={row.asLeft}
                            onChange={(e) =>
                              updateReadingField(row.id, 'asLeft', e.target.value)
                            }
                            placeholder="—"
                            className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                          />
                          <div
                            className={`mt-1 font-mono text-[10px] tabular-nums ${
                              row.asLeftPass === false
                                ? 'font-semibold text-rose-700'
                                : 'text-slate-500'
                            }`}
                          >
                            Dev: {formatSignedNumber(row.asLeftError, 3)}
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-600">
                            Tol (± {row.outputUnit})
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={row.tolerance}
                            onChange={(e) =>
                              updateReadingField(
                                row.id,
                                'tolerance',
                                Number(e.target.value)
                              )
                            }
                            className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                          />
                        </div>
                        <div className="flex flex-col justify-center rounded border border-slate-200 bg-white px-2.5 py-1.5 text-right">
                          <div className="text-[10px] font-semibold text-slate-500 uppercase">
                            1-Pt Verdict
                          </div>
                          <div className="mt-0.5 text-xs font-bold">
                            {!switchContactVerified ? (
                              <span className="text-rose-700">✖ CONTACT FAIL</span>
                            ) : activePass === null ? (
                              <span className="text-slate-400">Pending</span>
                            ) : activePass ? (
                              <span className="text-emerald-700">✓ PASS</span>
                            ) : (
                              <span className="text-rose-700">✖ FAIL</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600">
                          Trip Action
                        </label>
                        <select
                          value={switchTripDirection}
                          onChange={(e) =>
                            setSwitchTripDirection(e.target.value as SwitchTripDirection)
                          }
                          className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                        >
                          <option value="Rising (High)">Rising (High)</option>
                          <option value="Falling (Low)">Falling (Low)</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600">
                          Normal Contact
                        </label>
                        <select
                          value={switchNormalContact}
                          onChange={(e) =>
                            setSwitchNormalContact(e.target.value as SwitchNormalContact)
                          }
                          className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                        >
                          <option value="NC (Normally Closed)">NC (Normally Closed)</option>
                          <option value="NO (Normally Open)">NO (Normally Open)</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600">
                          As-Found Reset (Opt.)
                        </label>
                        <input
                          type="number"
                          step="any"
                          value={switchAsFoundReset}
                          onChange={(e) => setSwitchAsFoundReset(e.target.value)}
                          placeholder="—"
                          className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600">
                          As-Left Reset (Deadband: {deadbandText})
                        </label>
                        <input
                          type="number"
                          step="any"
                          value={switchAsLeftReset}
                          onChange={(e) => setSwitchAsLeftReset(e.target.value)}
                          placeholder="—"
                          className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                        />
                      </div>
                    </div>

                    <label className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
                      <input
                        type="checkbox"
                        checked={switchContactVerified}
                        onChange={(e) => setSwitchContactVerified(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700"
                      />
                      <span className="font-medium">
                        Contact continuity & state change ({switchNormalContact} actuation) verified
                      </span>
                    </label>
                  </div>
                );
              })()
            ) : (
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] text-slate-600">
                    <tr className="border-b border-slate-200">
                      <th className="px-2 py-2 font-semibold">Point</th>
                      <th className="px-2 py-2 font-semibold">Input</th>
                      <th className="px-2 py-2 font-semibold">Expected</th>
                      <th className="px-2 py-2 font-semibold">As-Found</th>
                      <th className="px-2 py-2 font-semibold">As-Left</th>
                      <th className="px-2 py-2 font-semibold">Tol (±)</th>
                      <th className="px-2 py-2 font-semibold text-right">Dev / Status</th>
                      <th className="px-1.5 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {evaluatedReadings.map((row) => {
                      const activePass =
                        row.asLeftPass !== null ? row.asLeftPass : row.asFoundPass;
                      const activeErr =
                        row.asLeftError !== null ? row.asLeftError : row.asFoundError;
                      return (
                        <tr key={row.id} className="hover:bg-slate-50/70">
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={row.label}
                              onChange={(e) =>
                                updateReadingField(row.id, 'label', e.target.value)
                              }
                              className="w-20 rounded border border-slate-200 px-1.5 py-1 font-sans text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="any"
                                value={row.nominalInput}
                                onChange={(e) =>
                                  updateReadingField(
                                    row.id,
                                    'nominalInput',
                                    Number(e.target.value)
                                  )
                                }
                                className="w-16 rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                              />
                              <span className="text-[10px] text-slate-400">
                                {row.inputUnit}
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="any"
                                value={row.expectedOutput}
                                onChange={(e) =>
                                  updateReadingField(
                                    row.id,
                                    'expectedOutput',
                                    Number(e.target.value)
                                  )
                                }
                                className="w-16 rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                              />
                              <span className="text-[10px] text-slate-400">
                                {row.outputUnit}
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              step="any"
                              value={row.asFound}
                              onChange={(e) =>
                                updateReadingField(row.id, 'asFound', e.target.value)
                              }
                              placeholder="—"
                              className="w-20 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              step="any"
                              value={row.asLeft}
                              onChange={(e) =>
                                updateReadingField(row.id, 'asLeft', e.target.value)
                              }
                              placeholder="—"
                              className="w-20 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              step="any"
                              value={row.tolerance}
                              onChange={(e) =>
                                updateReadingField(
                                  row.id,
                                  'tolerance',
                                  Number(e.target.value)
                                )
                              }
                              className="w-14 rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap">
                            <div className="text-[11px] text-slate-600">
                              {formatSignedNumber(activeErr, 3)}
                            </div>
                            <div className="font-sans text-[11px] font-semibold">
                              {activePass === null ? (
                                <span className="text-slate-400">Pending</span>
                              ) : activePass ? (
                                <span className="text-emerald-700">✓ PASS</span>
                              ) : (
                                <span className="text-rose-700">✖ FAIL</span>
                              )}
                            </div>
                          </td>
                          <td className="px-1.5 py-1.5 text-right">
                            <button
                              type="button"
                              onClick={() => removeReadingRow(row.id)}
                              aria-label="Remove setpoint row"
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-3">
              <label className="mb-1 block text-[11px] font-medium text-slate-600">
                Technician Observations & Adjustment Notes
              </label>
              <textarea
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </section>

          {/* Digital Signatures */}
          <section className="space-y-3">
            <h2 className="text-xs font-bold tracking-wide text-slate-800 uppercase">
              03. Digital Signatures
            </h2>
            <SignaturePad
              roleLabel="Calibrated By (Metrology Technician)"
              value={techSignature}
              onChange={setTechSignature}
              users={users}
              onCreateUser={onCreateUser}
            />
            <SignaturePad
              roleLabel="Reviewed & Approved By (Quality Engineer)"
              value={approverSignature}
              onChange={setApproverSignature}
              users={users}
              onCreateUser={onCreateUser}
            />
          </section>

          {/* Action Bar */}
          <section className="rounded-md border border-slate-200 bg-white p-4">
            {saveError && (
              <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {saveError}
              </div>
            )}
            {saveNotice && (
              <div className="mb-3 flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                <span>{saveNotice}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => handleSaveAndDownloadPdf(false)}
                className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                <CheckCircle2 className="h-4 w-4" />
                {isSaving ? 'Issuing Certificate...' : 'Issue Certificate'}
              </button>

              <button
                type="button"
                onClick={() => exportCertificateToPdf(draftCertificate)}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer whitespace-nowrap"
              >
                <Download className="h-4 w-4" />
                Download Draft PDF
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer whitespace-nowrap"
              >
                <Printer className="h-4 w-4" />
                Print A4
              </button>
            </div>
          </section>
        </div>

        {/* Right Live A4 Preview Column */}
        <div className="xl:col-span-6">
          <div className="no-print mb-2 flex items-center justify-between text-xs text-slate-500">
            <span className="font-semibold text-slate-700">
              Live A4 Certificate Preview
            </span>
            <span className="font-mono tabular-nums">
              {draftCertificate.certificateNumber} ·{' '}
              {isSwitch
                ? 'Single-Point Switch Verification'
                : `${draftCertificate.readings.length} Test Points`}
            </span>
          </div>
          <CertificatePreview certificate={draftCertificate} />
        </div>
      </div>

      {txtModalOpen && (
        <TxtCalibrationImportModal
          standards={standards}
          plantEquipment={plantEquipment}
          labSettings={labSettings}
          certificateNumber={certificateNumber}
          procedureRef={procedureRef}
          ambientTempC={ambientTempC}
          relativeHumidityPct={relativeHumidityPct}
          barometricPressureHpa={barometricPressureHpa}
          technicianSignature={techSignature}
          approverSignature={approverSignature}
          onClose={() => setTxtModalOpen(false)}
          onApplyToStudio={handleApplyImportedReport}
          onIssueCertificate={onIssueCertificate}
          onSaveImportedPlant={onSaveImportedPlant}
          onBatchIssueComplete={(issuedCerts) => {
            if (issuedCerts.length === 0) return;
            const match = certificateNumber.match(/^(.*?)(\d+)$/);
            if (match) {
              const nextNum = String(
                Number(match[2]) + issuedCerts.length
              ).padStart(match[2].length, '0');
              setCertificateNumber(`${match[1]}${nextNum}`);
            }
            const firstNo = issuedCerts[0].certificateNumber;
            const lastNo =
              issuedCerts[issuedCerts.length - 1].certificateNumber;
            setSaveError(null);
            setSaveNotice(
              `Batch converted & issued ${issuedCerts.length} certificates (${firstNo} – ${lastNo}) to the Certificate Archive.`
            );
          }}
        />
      )}
      {excelModalOpen && (
        <ExcelCalibrationImportModal
          standards={standards}
          plantEquipment={plantEquipment}
          users={users}
          labSettings={labSettings}
          certificateNumber={certificateNumber}
          procedureRef={procedureRef}
          ambientTempC={ambientTempC}
          relativeHumidityPct={relativeHumidityPct}
          barometricPressureHpa={barometricPressureHpa}
          technicianSignature={techSignature}
          approverSignature={approverSignature}
          onClose={() => setExcelModalOpen(false)}
          onApplyToStudio={handleApplyImportedReport}
          onIssueCertificate={onIssueCertificate}
          onSaveImportedPlant={onSaveImportedPlant}
          onBatchIssueComplete={(issuedCerts) => {
            if (issuedCerts.length === 0) return;
            const match = certificateNumber.match(/^(.*?)(\d+)$/);
            if (match) {
              const nextNum = String(
                Number(match[2]) + issuedCerts.length
              ).padStart(match[2].length, '0');
              setCertificateNumber(`${match[1]}${nextNum}`);
            }
            const firstNo = issuedCerts[0].certificateNumber;
            const lastNo =
              issuedCerts[issuedCerts.length - 1].certificateNumber;
            setSaveError(null);
            setSaveNotice(
              `Batch converted & issued ${issuedCerts.length} Excel reports as certificates (${firstNo} – ${lastNo}) to the Certificate Archive.`
            );
          }}
        />
      )}
      <PlantEquipmentModal
        isOpen={addPlantModalOpen}
        onClose={() => setAddPlantModalOpen(false)}
        onSave={async (payload) => {
          const candidate: PlantEquipment = {
            ...payload,
            id: `plt-${Date.now()}`,
          };
          const created = onCreatePlant
            ? await onCreatePlant(candidate)
            : onSaveImportedPlant
              ? await onSaveImportedPlant(candidate)
              : candidate;
          handleSelectPlant(created);
          setSaveError(null);
          setSaveNotice(
            `Added new plant asset ${created.assetId} (${created.tagName}) and loaded it into Certificate Studio.`
          );
        }}
      />

      {pendingUnitPrompt && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-md rounded-md border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Update Unit in Plant Asset?
              </h3>
              <button
                type="button"
                disabled={updatingPlantUnit}
                onClick={handleKeepCertificateUnitOnly}
                aria-label="Close prompt"
                className="rounded p-1 text-slate-500 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 p-5 text-xs text-slate-700">
              <p>
                You changed the unit of measure in Certificate Studio for{' '}
                <span className="font-mono font-semibold text-slate-900">
                  {pendingUnitPrompt.plant.assetId}
                </span>{' '}
                ({pendingUnitPrompt.plant.tagName}). Do you want to update this unit in the saved Plant Asset record as well?
              </p>

              <div className="divide-y divide-slate-200 rounded border border-slate-200 bg-slate-50">
                {pendingUnitPrompt.changes.map((ch) => (
                  <div
                    key={ch.label}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <span className="font-medium text-slate-600">{ch.label}</span>
                    <span className="font-mono font-semibold text-slate-900">
                      <span className="text-slate-500">{ch.oldUnit}</span> →{' '}
                      <span className="text-blue-700">{ch.newUnit}</span>
                    </span>
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-slate-500">
                Choosing &ldquo;Certificate Only&rdquo; applies the change to this certificate without modifying the Plant Assets database.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                type="button"
                disabled={updatingPlantUnit}
                onClick={handleKeepCertificateUnitOnly}
                className="rounded border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
              >
                No, This Certificate Only
              </button>
              <button
                type="button"
                disabled={updatingPlantUnit}
                onClick={handleConfirmUpdatePlantUnit}
                className="rounded bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer disabled:opacity-50"
              >
                {updatingPlantUnit ? 'Updating Plant Asset...' : 'Yes, Update Plant Asset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
