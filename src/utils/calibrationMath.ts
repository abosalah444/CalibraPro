import type {
  CalibrationEquipment,
  CertificateOverallResult,
  EvaluatedReadingRow,
  PlantEquipment,
  PlantEquipmentType,
  PlantStatus,
  StandardStatus,
  SwitchVerificationData,
  TestReadingRow,
} from '../types/calibration';

export function getPlantEquipmentType(
  item?: { equipmentType?: PlantEquipmentType; category?: string } | null
): PlantEquipmentType {
  if (item?.equipmentType === 'switch') return 'switch';
  if (item?.equipmentType === 'transmitter') return 'transmitter';
  if (item?.category && /\bswitch\b/i.test(item.category)) return 'switch';
  return 'transmitter';
}

export function getPlantEquipmentTypeLabel(type?: PlantEquipmentType): string {
  return type === 'switch' ? 'Switch' : 'Transmitter';
}

export function addDaysToDate(isoDate: string, days: number): string {
  if (!isoDate) return '';
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setUTCDate(parsed.getUTCDate() + Math.max(1, Math.round(days)));
  return parsed.toISOString().slice(0, 10);
}

export function daysUntilDate(isoDate: string, referenceDate?: string): number | null {
  if (!isoDate) return null;
  const target = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;
  const nowStr = referenceDate || new Date().toISOString().slice(0, 10);
  const now = new Date(`${nowStr}T00:00:00Z`);
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function computeStandardStatus(
  item: Pick<CalibrationEquipment, 'nextDueDate' | 'status'>,
  todayStr?: string
): StandardStatus {
  if (item.status === 'Out for Calibration' || item.status === 'Retired') {
    return item.status;
  }
  const delta = daysUntilDate(item.nextDueDate, todayStr);
  if (delta === null) return item.status;
  if (delta < 0) return 'Overdue';
  if (delta <= 30) return 'Due Soon';
  return 'Valid';
}

export function computePlantStatus(
  item: Pick<PlantEquipment, 'nextDueDate' | 'status'>,
  todayStr?: string
): PlantStatus {
  if (item.status === 'Out of Tolerance' || item.status === 'Scheduled') {
    return item.status;
  }
  const delta = daysUntilDate(item.nextDueDate, todayStr);
  if (delta === null) return item.status;
  if (delta < 0) return 'Overdue';
  if (delta <= 30) return 'Due Soon';
  return 'In Tolerance';
}

export function evaluateReadings(
  readings: TestReadingRow[],
  outputSpan?: number
): EvaluatedReadingRow[] {
  const effectiveSpan =
    outputSpan && outputSpan > 0
      ? outputSpan
      : (() => {
          if (readings.length < 2) return 0;
          const values = readings.map((r) => r.expectedOutput);
          return Math.abs(Math.max(...values) - Math.min(...values));
        })();

  return readings.map((row) => {
    const asFoundTrimmed = row.asFound.trim();
    const asLeftTrimmed = row.asLeft.trim();
    const asFoundNum = asFoundTrimmed === '' ? null : Number(asFoundTrimmed);
    const asLeftNum = asLeftTrimmed === '' ? null : Number(asLeftTrimmed);

    const validFound = asFoundNum !== null && !Number.isNaN(asFoundNum);
    const validLeft = asLeftNum !== null && !Number.isNaN(asLeftNum);

    const asFoundError = validFound
      ? Number((asFoundNum - row.expectedOutput).toFixed(4))
      : null;
    const asLeftError = validLeft
      ? Number((asLeftNum - row.expectedOutput).toFixed(4))
      : null;

    const tol = Math.abs(row.tolerance);
    const asFoundPass =
      asFoundError !== null ? Math.abs(asFoundError) <= tol + 1e-9 : null;
    const asLeftPass =
      asLeftError !== null ? Math.abs(asLeftError) <= tol + 1e-9 : null;

    const activeError = asLeftError !== null ? asLeftError : asFoundError;
    const spanPctError =
      activeError !== null && effectiveSpan > 0
        ? Number(((activeError / effectiveSpan) * 100).toFixed(3))
        : null;

    return {
      ...row,
      asFoundNum: validFound ? asFoundNum : null,
      asLeftNum: validLeft ? asLeftNum : null,
      asFoundError,
      asLeftError,
      asFoundPass,
      asLeftPass,
      spanPctError,
    };
  });
}

export function computeOverallCertificateResult(
  evaluated: EvaluatedReadingRow[],
  switchContactVerified?: boolean
): CertificateOverallResult {
  if (switchContactVerified === false) {
    return 'FAIL';
  }

  const rowsWithFound = evaluated.filter((r) => r.asFoundPass !== null);
  const rowsWithLeft = evaluated.filter((r) => r.asLeftPass !== null);

  if (rowsWithLeft.length > 0) {
    const anyLeftFail = rowsWithLeft.some((r) => r.asLeftPass === false);
    if (anyLeftFail) return 'FAIL';
    const anyFoundFail = rowsWithFound.some((r) => r.asFoundPass === false);
    if (anyFoundFail) return 'PASS AFTER ADJUSTMENT';
    return 'PASS';
  }

  if (rowsWithFound.length > 0) {
    const anyFoundFail = rowsWithFound.some((r) => r.asFoundPass === false);
    return anyFoundFail ? 'FAIL' : 'PASS';
  }

  return 'LIMITED';
}

export function formatSignedNumber(val: number | null, decimals = 3): string {
  if (val === null || Number.isNaN(val)) return '—';
  const fixed = val.toFixed(decimals);
  return val > 0 ? `+${fixed}` : fixed;
}

export async function computeCertificateHash(payload: {
  certificateNumber: string;
  calibrationDate: string;
  nextDueDate: string;
  assetId: string;
  referenceStandardIds: string[];
  readings: TestReadingRow[];
  switchVerification?: SwitchVerificationData;
  overallResult: CertificateOverallResult;
  technicianName: string;
  approverName: string;
}): Promise<string> {
  const canonical = JSON.stringify({
    certificateNumber: payload.certificateNumber,
    calibrationDate: payload.calibrationDate,
    nextDueDate: payload.nextDueDate,
    assetId: payload.assetId,
    referenceStandardIds: [...payload.referenceStandardIds].sort(),
    readings: payload.readings.map((r) => ({
      nominalInput: r.nominalInput,
      expectedOutput: r.expectedOutput,
      asFound: r.asFound,
      asLeft: r.asLeft,
      tolerance: r.tolerance,
    })),
    ...(payload.switchVerification
      ? { switchVerification: payload.switchVerification }
      : {}),
    overallResult: payload.overallResult,
    technicianName: payload.technicianName,
    approverName: payload.approverName,
  });

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(canonical);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }

  // Deterministic fallback if Web Crypto is unavailable
  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `FNV-${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

export function generateTypedSignatureDataUrl(name: string): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 140;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0f172a';
  ctx.font = 'italic 44px "Georgia", "Times New Roman", serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.trim() || 'Authorized Signer', 22, 68);

  // Subtle signature baseline stroke
  ctx.strokeStyle = '#1d4ed8';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(20, 102);
  ctx.bezierCurveTo(130, 95, 250, 108, Math.min(440, 40 + name.length * 18), 96);
  ctx.stroke();

  return canvas.toDataURL('image/png');
}
