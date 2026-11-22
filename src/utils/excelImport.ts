import * as XLSX from 'xlsx';
import type {
  CalibrationEquipment,
  CalibrationUser,
  PlantEquipment,
  PlantEquipmentType,
  PlantStatus,
  SetpointSpec,
  StandardStatus,
  SwitchNormalContact,
  SwitchSpec,
  SwitchTripDirection,
} from '../types/calibration';
import {
  addDaysToDate,
  computePlantStatus,
  computeStandardStatus,
} from './calibrationMath';

export interface ParsedRowResult<T> {
  rowNumber: number;
  item: T;
  errors: string[];
  warnings: string[];
  isDuplicateInFile: boolean;
  existsInDb: boolean;
}

function normalizeHeader(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.entries(row).forEach(([k, v]) => {
    out[normalizeHeader(k)] = v;
  });
  return out;
}

function pickField(
  normalizedRow: Record<string, unknown>,
  aliases: string[]
): string {
  for (const alias of aliases) {
    const val = normalizedRow[normalizeHeader(alias)];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return '';
}

function pickNumber(
  normalizedRow: Record<string, unknown>,
  aliases: string[],
  fallback: number
): number {
  for (const alias of aliases) {
    const val = normalizedRow[normalizeHeader(alias)];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      const cleaned = String(val).replace(/[^0-9.-]/g, '');
      const num = Number(cleaned);
      if (!Number.isNaN(num)) return num;
    }
  }
  return fallback;
}

function parseExcelDate(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      const yyyy = String(parsed.y).padStart(4, '0');
      const mm = String(parsed.m).padStart(2, '0');
      const dd = String(parsed.d).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  const str = String(raw).trim();
  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
  // MM/DD/YYYY or DD/MM/YYYY fallback via Date
  const dt = new Date(str);
  if (!Number.isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }
  return '';
}

function pickDateField(
  normalizedRow: Record<string, unknown>,
  aliases: string[]
): string {
  for (const alias of aliases) {
    const val = normalizedRow[normalizeHeader(alias)];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      const parsed = parseExcelDate(val);
      if (parsed) return parsed;
    }
  }
  return '';
}

function normalizeStandardStatus(raw: string): StandardStatus | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === 'valid' || s === 'active' || s === 'calibrated') return 'Valid';
  if (s.includes('due')) return 'Due Soon';
  if (s.includes('overdue') || s.includes('expired')) return 'Overdue';
  if (s.includes('out')) return 'Out for Calibration';
  if (s.includes('retire')) return 'Retired';
  return null;
}

function normalizePlantStatus(raw: string): PlantStatus | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s.includes('in tol') || s === 'pass' || s === 'valid' || s === 'ok') {
    return 'In Tolerance';
  }
  if (s.includes('due')) return 'Due Soon';
  if (s.includes('overdue') || s.includes('expired')) return 'Overdue';
  if (s.includes('out') || s === 'fail') return 'Out of Tolerance';
  if (s.includes('sched')) return 'Scheduled';
  return null;
}

function normalizeEquipmentType(rawType: string, category: string): PlantEquipmentType {
  const s = rawType.trim().toLowerCase();
  if (s.includes('switch')) return 'switch';
  if (s.includes('transmitter') || s.includes('analog')) return 'transmitter';
  if (!s && /\bswitch\b/i.test(category)) return 'switch';
  return 'transmitter';
}

function normalizeSwitchDirection(raw: string): SwitchTripDirection {
  return /fall|low|decr/i.test(raw) ? 'Falling (Low)' : 'Rising (High)';
}

function normalizeSwitchContact(raw: string): SwitchNormalContact {
  return /\bno\b|normally\s*open/i.test(raw)
    ? 'NO (Normally Open)'
    : 'NC (Normally Closed)';
}

function extractToleranceNumber(toleranceSpec: string, fallback = 0.08): number {
  const match = toleranceSpec.match(/(\d+(?:\.\d+)?)/);
  if (match) {
    const n = Number(match[1]);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return fallback;
}

function parseSetpointsField(
  rawSetpoints: string,
  rangeMin: number,
  rangeMax: number,
  rangeUnit: string,
  outMin: number,
  outMax: number,
  outUnit: string,
  toleranceNum: number
): SetpointSpec[] {
  const trimmed = rawSetpoints.trim();
  const buildLinear = (): SetpointSpec[] => {
    const fracs = [
      { pct: 0, label: '0% Zero' },
      { pct: 0.25, label: '25% Span' },
      { pct: 0.5, label: '50% Mid' },
      { pct: 0.75, label: '75% Span' },
      { pct: 1, label: '100% Full' },
    ];
    return fracs.map((f, idx) => ({
      id: `sp-imp-${Date.now()}-${idx}`,
      label: f.label,
      nominalInput: Number((rangeMin + (rangeMax - rangeMin) * f.pct).toFixed(3)),
      inputUnit: rangeUnit,
      expectedOutput: Number((outMin + (outMax - outMin) * f.pct).toFixed(3)),
      outputUnit: outUnit,
      tolerancePlusMinus: toleranceNum,
    }));
  };

  if (!trimmed) return buildLinear();

  // Try JSON array first
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed) as Array<Partial<SetpointSpec>>;
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((sp, idx) => ({
          id: sp.id || `sp-imp-${Date.now()}-${idx}`,
          label: sp.label || `Point ${idx + 1}`,
          nominalInput: Number(sp.nominalInput ?? 0),
          inputUnit: sp.inputUnit || rangeUnit,
          expectedOutput: Number(sp.expectedOutput ?? 0),
          outputUnit: sp.outputUnit || outUnit,
          tolerancePlusMinus: Number(sp.tolerancePlusMinus ?? toleranceNum),
        }));
      }
    } catch {
      // Fallback to delimited string parser
    }
  }

  // Delimited format: "0:4, 40:8, 80:12" or "0->4 | 50->12 | 100->20" or "0; 50; 100"
  const tokens = trimmed
    .split(/[|,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) return buildLinear();

  const spanIn = rangeMax - rangeMin;
  const spanOut = outMax - outMin;

  const parsed: SetpointSpec[] = [];
  tokens.forEach((tok, idx) => {
    const pairMatch = tok.match(
      /^(-?\d+(?:\.\d+)?)\s*(?::|->|=|\/)\s*(-?\d+(?:\.\d+)?)(?:\s*\(([^)]+)\))?$/
    );
    if (pairMatch) {
      const nomIn = Number(pairMatch[1]);
      const expOut = Number(pairMatch[2]);
      const lbl = pairMatch[3]?.trim() || `Pt ${idx + 1}`;
      parsed.push({
        id: `sp-imp-${Date.now()}-${idx}`,
        label: lbl,
        nominalInput: nomIn,
        inputUnit: rangeUnit,
        expectedOutput: expOut,
        outputUnit: outUnit,
        tolerancePlusMinus: toleranceNum,
      });
      return;
    }

    const singleNum = Number(tok.replace(/[^0-9.-]/g, ''));
    if (!Number.isNaN(singleNum)) {
      const ratio = spanIn !== 0 ? (singleNum - rangeMin) / spanIn : 0;
      const expOut = Number((outMin + ratio * spanOut).toFixed(3));
      parsed.push({
        id: `sp-imp-${Date.now()}-${idx}`,
        label: `${Math.round(ratio * 100)}%`,
        nominalInput: singleNum,
        inputUnit: rangeUnit,
        expectedOutput: expOut,
        outputUnit: outUnit,
        tolerancePlusMinus: toleranceNum,
      });
    }
  });

  return parsed.length > 0 ? parsed : buildLinear();
}

export async function readExcelWorkbook(file: File): Promise<{
  workbook: XLSX.WorkBook;
  sheetNames: string[];
}> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  return { workbook, sheetNames: workbook.SheetNames };
}

export function extractSheetRows(
  workbook: XLSX.WorkBook,
  sheetName: string
): Record<string, unknown>[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: true,
  });
}

export function parseStandardsFromRows(
  rawRows: Record<string, unknown>[],
  existingStandards: CalibrationEquipment[]
): ParsedRowResult<CalibrationEquipment>[] {
  const todayStr = new Date().toISOString().slice(0, 10);
  const existingCodes = new Set(
    existingStandards.map((s) => s.standardCode.trim().toLowerCase())
  );
  const seenCodes = new Set<string>();

  return rawRows.map((raw, index) => {
    const row = normalizeRowKeys(raw);
    const errors: string[] = [];
    const warnings: string[] = [];

    const standardCode = pickField(row, [
      'standardCode',
      'Standard Code',
      'Code',
      'Standard ID',
      'Equipment Code',
      'ID',
    ]);
    const name = pickField(row, [
      'name',
      'Instrument Name',
      'Equipment Name',
      'Description',
      'Title',
    ]);
    const manufacturer = pickField(row, ['manufacturer', 'Make', 'Brand', 'OEM']);
    const model = pickField(row, ['model', 'Model No', 'Model Number']);
    const serialNumber = pickField(row, [
      'serialNumber',
      'Serial Number',
      'Serial No',
      'S/N',
      'SN',
    ]);
    const category =
      pickField(row, ['category', 'Discipline', 'Type']) || 'Process';
    const accuracySpec =
      pickField(row, ['accuracySpec', 'Accuracy', 'Accuracy Spec', 'Uncertainty']) ||
      '±0.02% FS';
    const measurementRange =
      pickField(row, ['measurementRange', 'Range', 'Measurement Range']) ||
      'Standard Range';

    const intervalDays = pickNumber(
      row,
      [
        'calibrationIntervalDays',
        'Interval (Days)',
        'Interval Days',
        'Interval',
        'Frequency Days',
      ],
      365
    );

    let lastCalibrationDate = pickDateField(row, [
      'lastCalibrationDate',
      'Last Calibration Date',
      'Last Cal Date',
      'Last Cal',
      'Cal Date',
    ]);
    if (!lastCalibrationDate) {
      lastCalibrationDate = todayStr;
      warnings.push('Last Calibration Date missing; defaulted to today.');
    }

    let nextDueDate = pickDateField(row, [
      'nextDueDate',
      'Next Due Date',
      'Due Date',
      'Next Cal Date',
    ]);
    if (!nextDueDate) {
      nextDueDate = addDaysToDate(lastCalibrationDate, intervalDays);
    }

    const certificateRef = pickField(row, [
      'certificateRef',
      'Certificate Ref',
      'Certificate No',
      'Cert Ref',
      'Cert #',
    ]);
    const traceabilityLab = pickField(row, [
      'traceabilityLab',
      'Traceability Lab',
      'Calibrated By',
      'Lab',
    ]);
    const rawStatus = pickField(row, ['status', 'Status', 'State']);
    const explicitStatus = normalizeStandardStatus(rawStatus);
    const notes = pickField(row, ['notes', 'Notes', 'Remarks']);

    if (!standardCode) errors.push('Missing Standard Code.');
    if (!name) errors.push('Missing Instrument Name.');

    const lowerCode = standardCode.toLowerCase();
    const isDuplicateInFile = Boolean(lowerCode && seenCodes.has(lowerCode));
    if (lowerCode) seenCodes.add(lowerCode);
    const existsInDb = Boolean(lowerCode && existingCodes.has(lowerCode));

    const item: CalibrationEquipment = {
      id: `std-${Date.now()}-${index}`,
      standardCode,
      name,
      manufacturer: manufacturer || '—',
      model: model || '—',
      serialNumber: serialNumber || '—',
      category,
      accuracySpec,
      measurementRange,
      lastCalibrationDate,
      nextDueDate,
      calibrationIntervalDays: intervalDays,
      certificateRef,
      traceabilityLab,
      status:
        explicitStatus ||
        computeStandardStatus({ nextDueDate, status: 'Valid' }, todayStr),
      notes,
    };

    return {
      rowNumber: index + 2,
      item,
      errors,
      warnings,
      isDuplicateInFile,
      existsInDb,
    };
  });
}

export function parsePlantEquipmentFromRows(
  rawRows: Record<string, unknown>[],
  existingPlant: PlantEquipment[]
): ParsedRowResult<PlantEquipment>[] {
  const todayStr = new Date().toISOString().slice(0, 10);
  const existingIds = new Set(
    existingPlant.map((p) => p.assetId.trim().toLowerCase())
  );
  const seenIds = new Set<string>();

  return rawRows.map((raw, index) => {
    const row = normalizeRowKeys(raw);
    const errors: string[] = [];
    const warnings: string[] = [];

    const assetId = pickField(row, [
      'assetId',
      'Asset ID',
      'Unique Asset ID',
      'Unique Asset Identifier',
      'Tag ID',
      'Tag',
    ]);
    const tagName = pickField(row, [
      'tagName',
      'Tag Name',
      'Equipment Name',
      'Service',
      'Name',
    ]);
    const description =
      pickField(row, ['description', 'Description', 'Instrument Type']) ||
      tagName;
    const manufacturer = pickField(row, ['manufacturer', 'Make', 'Brand', 'OEM']);
    const model = pickField(row, ['model', 'Model']);
    const serialNumber = pickField(row, [
      'serialNumber',
      'Serial Number',
      'Serial No',
      'S/N',
      'SN',
    ]);
    const plantArea =
      pickField(row, ['plantArea', 'Plant Area', 'Area', 'Unit', 'Location']) ||
      'Plant Process Unit';
    const category =
      pickField(row, ['category', 'Category', 'Instrument Category']) ||
      'Field Instrument';
    const rawEquipmentType = pickField(row, [
      'equipmentType',
      'Equipment Type',
      'Asset Type',
      'Device Type',
      'Instrument Class',
      'Type',
    ]);
    const equipmentType = normalizeEquipmentType(rawEquipmentType, category);
    const isSwitch = equipmentType === 'switch';

    const frequencyDays = pickNumber(
      row,
      [
        'frequencyDays',
        'Frequency (Days)',
        'Frequency Days',
        'Calibration Frequency',
        'Interval Days',
        'Interval',
      ],
      180
    );
    const frequencyLabel =
      pickField(row, ['frequencyLabel', 'Frequency Label', 'Frequency Text']) ||
      `${frequencyDays} Days`;

    const rangeMin = pickNumber(row, ['rangeMin', 'Range Min', 'Input Min', 'LRV'], 0);
    const rangeMax = pickNumber(row, ['rangeMax', 'Range Max', 'Input Max', 'URV'], 100);
    const rangeUnit =
      pickField(row, ['rangeUnit', 'Range Unit', 'Input Unit', 'EU', 'Unit']) ||
      'bar';

    const outputRangeMin = pickNumber(
      row,
      ['outputRangeMin', 'Output Min', 'Out Min'],
      isSwitch ? 0 : 4
    );
    const outputRangeMax = pickNumber(
      row,
      ['outputRangeMax', 'Output Max', 'Out Max'],
      isSwitch ? 1 : 20
    );
    const outputUnit =
      pickField(row, ['outputUnit', 'Output Unit', 'Out Unit']) ||
      (isSwitch ? 'Contact' : 'mA');

    const toleranceSpec =
      pickField(row, ['toleranceSpec', 'Tolerance Spec', 'Tolerance']) ||
      (isSwitch ? `±0.30 ${rangeUnit} (Single-Point Trip)` : `±0.08 ${outputUnit}`);
    const explicitTolNum = pickNumber(
      row,
      ['toleranceValue', 'Tolerance Value', 'Tol'],
      extractToleranceNumber(toleranceSpec, isSwitch ? 0.3 : 0.08)
    );

    let lastCalibrationDate = pickDateField(row, [
      'lastCalibrationDate',
      'Last Calibration Date',
      'Last Cal Date',
      'Last Cal',
    ]);
    if (!lastCalibrationDate) {
      lastCalibrationDate = todayStr;
      warnings.push('Last Calibration Date missing; defaulted to today.');
    }

    let nextDueDate = pickDateField(row, [
      'nextDueDate',
      'Next Due Date',
      'Due Date',
      'Next Cal Date',
    ]);
    if (!nextDueDate) {
      nextDueDate = addDaysToDate(lastCalibrationDate, frequencyDays);
    }

    const rawStatus = pickField(row, ['status', 'Status']);
    const explicitStatus = normalizePlantStatus(rawStatus);

    const rawSetpoints = pickField(row, [
      'setpoints',
      'Setpoints',
      'Test Points',
      'Calibration Points',
    ]);

    let setpoints: SetpointSpec[];
    let switchSpec: SwitchSpec | undefined;

    if (isSwitch) {
      const tripSetpoint = pickNumber(
        row,
        ['tripSetpoint', 'Trip Setpoint', 'Trip Point', 'Setpoint'],
        Number(((rangeMin + rangeMax) / 2).toFixed(3))
      );
      const resetPointRaw = pickField(row, ['resetPoint', 'Reset Point']);
      const resetPointNum = resetPointRaw
        ? Number(resetPointRaw.replace(/[^0-9.-]/g, ''))
        : undefined;
      const tripDirection = normalizeSwitchDirection(
        pickField(row, ['tripDirection', 'Trip Action', 'Trip Direction'])
      );
      const normalContact = normalizeSwitchContact(
        pickField(row, ['normalContact', 'Normal Contact', 'Contact Type'])
      );

      if (rawSetpoints) {
        const parsedSp = parseSetpointsField(
          rawSetpoints,
          rangeMin,
          rangeMax,
          rangeUnit,
          tripSetpoint,
          tripSetpoint,
          rangeUnit,
          explicitTolNum
        );
        const firstSp = parsedSp[0];
        const effectiveTrip = firstSp ? firstSp.nominalInput : tripSetpoint;
        switchSpec = {
          tripDirection,
          normalContact,
          tripSetpoint: effectiveTrip,
          ...(resetPointNum !== undefined && !Number.isNaN(resetPointNum)
            ? { resetPoint: resetPointNum }
            : {}),
          tolerancePlusMinus: firstSp?.tolerancePlusMinus ?? explicitTolNum,
          unit: rangeUnit,
        };
        setpoints = [
          {
            id: `sp-imp-${Date.now()}-0`,
            label: 'Switch Trip Point',
            nominalInput: effectiveTrip,
            inputUnit: rangeUnit,
            expectedOutput: effectiveTrip,
            outputUnit: rangeUnit,
            tolerancePlusMinus: switchSpec.tolerancePlusMinus,
          },
        ];
      } else {
        switchSpec = {
          tripDirection,
          normalContact,
          tripSetpoint,
          ...(resetPointNum !== undefined && !Number.isNaN(resetPointNum)
            ? { resetPoint: resetPointNum }
            : {}),
          tolerancePlusMinus: explicitTolNum,
          unit: rangeUnit,
        };
        setpoints = [
          {
            id: `sp-imp-${Date.now()}-0`,
            label: 'Switch Trip Point',
            nominalInput: tripSetpoint,
            inputUnit: rangeUnit,
            expectedOutput: tripSetpoint,
            outputUnit: rangeUnit,
            tolerancePlusMinus: explicitTolNum,
          },
        ];
        warnings.push('Switch asset: configured 1-point trip verification.');
      }
    } else {
      setpoints = parseSetpointsField(
        rawSetpoints,
        rangeMin,
        rangeMax,
        rangeUnit,
        outputRangeMin,
        outputRangeMax,
        outputUnit,
        explicitTolNum
      );
      if (!rawSetpoints) {
        warnings.push('Setpoints empty; auto-generated 5 linear points (0–100%).');
      }
    }

    if (!assetId) errors.push('Missing Unique Asset ID.');
    if (!tagName) errors.push('Missing Tag Name.');

    const lowerAsset = assetId.toLowerCase();
    const isDuplicateInFile = Boolean(lowerAsset && seenIds.has(lowerAsset));
    if (lowerAsset) seenIds.add(lowerAsset);
    const existsInDb = Boolean(lowerAsset && existingIds.has(lowerAsset));

    const item: PlantEquipment = {
      id: `plt-${Date.now()}-${index}`,
      assetId,
      tagName,
      description,
      manufacturer: manufacturer || '—',
      model: model || '—',
      serialNumber: serialNumber || '—',
      plantArea,
      category,
      equipmentType,
      ...(switchSpec ? { switchSpec } : {}),
      frequencyDays,
      frequencyLabel,
      rangeMin,
      rangeMax,
      rangeUnit,
      outputRangeMin,
      outputRangeMax,
      outputUnit,
      toleranceSpec,
      lastCalibrationDate,
      nextDueDate,
      status:
        explicitStatus ||
        computePlantStatus({ nextDueDate, status: 'In Tolerance' }, todayStr),
      setpoints,
    };

    return {
      rowNumber: index + 2,
      item,
      errors,
      warnings,
      isDuplicateInFile,
      existsInDb,
    };
  });
}

export function downloadStandardsExcelTemplate(): void {
  const rows = [
    {
      'Standard Code': 'STD-P-010',
      'Instrument Name': 'Hydraulic Deadweight Tester (0 to 400 bar)',
      Manufacturer: 'Fluke',
      Model: 'P3125',
      'Serial Number': 'FLK-3125-7821',
      Category: 'Pressure',
      'Accuracy Spec': '±0.015% rdg',
      'Measurement Range': '1 to 400 bar',
      'Last Calibration Date': '2026-09-15',
      'Interval (Days)': 365,
      'Next Due Date': '2027-09-15',
      'Certificate Ref': 'UKAS-2026-5541',
      'Traceability Lab': 'Fluke Accredited Pressure Lab',
      Status: 'Valid',
      Notes: 'Includes calibrated brass mass set.',
    },
    {
      'Standard Code': 'STD-T-011',
      'Instrument Name': 'Standard Platinum Resistance Thermometer',
      Manufacturer: 'Isotech',
      Model: '909Q',
      'Serial Number': 'ISO-909-4420',
      Category: 'Temperature',
      'Accuracy Spec': '±0.012 °C',
      'Measurement Range': '-200 to +660 °C',
      'Last Calibration Date': '2026-06-01',
      'Interval (Days)': 365,
      'Next Due Date': '2027-06-01',
      'Certificate Ref': 'NVLAP-2026-8812',
      'Traceability Lab': 'Isotech Primary Lab',
      Status: 'Valid',
      Notes: 'Reference probe for dry-well verification.',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Calibration Standards');
  XLSX.writeFile(wb, 'CalibraPro_Standards_Template.xlsx');
}

export function downloadPlantExcelTemplate(): void {
  const rows = [
    {
      'Asset ID': 'PT-118C',
      'Tag Name': 'Compressor Discharge Pressure',
      'Equipment Type': 'Transmitter',
      Description: 'Smart Gauge Pressure Transmitter',
      Manufacturer: 'Rosemount',
      Model: '3051CG4',
      'Serial Number': 'RSM-3051-77102',
      'Plant Area': 'Unit 150 · Compression',
      Category: 'Pressure Transmitter',
      'Frequency (Days)': 180,
      'Frequency Label': '180 Days (Semi-Annual)',
      'Range Min': 0,
      'Range Max': 200,
      'Range Unit': 'bar',
      'Output Min': 4,
      'Output Max': 20,
      'Output Unit': 'mA',
      'Tolerance Spec': '±0.08 mA (±0.5% Span)',
      'Tolerance Value': 0.08,
      'Trip Setpoint': '',
      'Trip Action': '',
      'Normal Contact': '',
      'Last Calibration Date': '2026-08-10',
      'Next Due Date': '2027-02-06',
      Status: 'In Tolerance',
      Setpoints: '0:4 | 50:8 | 100:12 | 150:16 | 200:20',
    },
    {
      'Asset ID': 'PSH-204',
      'Tag Name': 'Knockout Drum High Pressure Trip',
      'Equipment Type': 'Switch',
      Description: 'Snap-Acting Process Pressure Switch (SPDT)',
      Manufacturer: 'SOR',
      Model: '6NN-K45',
      'Serial Number': 'SOR-6NN-88120',
      'Plant Area': 'Unit 200 · Gas Separation',
      Category: 'Pressure Switch',
      'Frequency (Days)': 180,
      'Frequency Label': '180 Days (Semi-Annual)',
      'Range Min': 0,
      'Range Max': 30,
      'Range Unit': 'bar',
      'Output Min': 0,
      'Output Max': 1,
      'Output Unit': 'Contact',
      'Tolerance Spec': '±0.30 bar (Single-Point Trip)',
      'Tolerance Value': 0.3,
      'Trip Setpoint': 22.0,
      'Trip Action': 'Rising (High)',
      'Normal Contact': 'NC (Normally Closed)',
      'Last Calibration Date': '2026-06-15',
      'Next Due Date': '2026-12-12',
      Status: 'In Tolerance',
      Setpoints: '',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Plant Equipment');
  XLSX.writeFile(wb, 'CalibraPro_Plant_Assets_Template.xlsx');
}

export function parseUsersFromRows(
  rawRows: Record<string, unknown>[],
  existingUsers: CalibrationUser[]
): ParsedRowResult<CalibrationUser>[] {
  const existingLicenses = new Set(
    existingUsers
      .map((u) => u.licenseId.trim().toLowerCase())
      .filter(Boolean)
  );
  const existingNames = new Set(
    existingUsers.map((u) => u.fullName.trim().toLowerCase())
  );
  const seenKeys = new Set<string>();

  return rawRows.map((raw, index) => {
    const row = normalizeRowKeys(raw);
    const errors: string[] = [];
    const warnings: string[] = [];

    const fullName = pickField(row, [
      'fullName',
      'Full Name',
      'Name',
      'User Name',
      'Personnel Name',
      'Employee Name',
      'Technician',
      'Approver',
    ]);
    const title = pickField(row, [
      'title',
      'Role / Title',
      'Role',
      'Title',
      'Position',
      'Job Title',
      'Designation',
    ]);
    const licenseId = pickField(row, [
      'licenseId',
      'License / Staff ID',
      'License ID',
      'Staff ID',
      'Employee ID',
      'Badge ID',
      'ID',
    ]);
    const department = pickField(row, [
      'department',
      'Department',
      'Unit',
      'Section',
      'Team',
    ]);
    const email = pickField(row, ['email', 'Email', 'E-mail']);
    const rawActive = pickField(row, ['active', 'Active', 'Status']);
    const active =
      rawActive === ''
        ? true
        : !['false', '0', 'no', 'inactive', 'disabled'].includes(
            rawActive.toLowerCase()
          );

    if (!fullName) errors.push('Missing Full Name.');
    if (!title) warnings.push('Role / Title is blank.');

    const key = (licenseId || fullName).toLowerCase();
    const isDuplicateInFile = Boolean(key && seenKeys.has(key));
    if (key) seenKeys.add(key);

    const existsInDb = licenseId
      ? existingLicenses.has(licenseId.toLowerCase())
      : Boolean(fullName && existingNames.has(fullName.toLowerCase()));

    const item: CalibrationUser = {
      id: `usr-${Date.now()}-${index}`,
      fullName,
      title: title || 'Instrumentation Personnel',
      licenseId,
      department,
      email,
      active,
    };

    return {
      rowNumber: index + 2,
      item,
      errors,
      warnings,
      isDuplicateInFile,
      existsInDb,
    };
  });
}

export function downloadUsersExcelTemplate(): void {
  const rows = [
    {
      'Full Name': 'Omar Farouk',
      'Role / Title': 'Lead Instrumentation Technician',
      'License / Staff ID': 'MET-5120',
      Department: 'Amerya LPG Calibration Lab',
      Email: 'o.farouk@ameryalpg.local',
      Active: 'Yes',
    },
    {
      'Full Name': 'Eng. Salma Nabil',
      'Role / Title': 'QA & Metrology Supervisor',
      'License / Staff ID': 'QA-2044',
      Department: 'Quality Assurance',
      Email: 's.nabil@ameryalpg.local',
      Active: 'Yes',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Calibration Personnel');
  XLSX.writeFile(wb, 'CalibraPro_Personnel_Template.xlsx');
}

