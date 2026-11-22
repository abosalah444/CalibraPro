import type {
  CalibrationEquipment,
  CertificateOverallResult,
  PlantEquipment,
  PlantEquipmentType,
  SetpointSpec,
  SwitchNormalContact,
  SwitchTripDirection,
  SwitchVerificationData,
  TestReadingRow,
} from '../types/calibration';
import {
  addDaysToDate,
  computeOverallCertificateResult,
  computePlantStatus,
  computeStandardStatus,
  evaluateReadings,
} from './calibrationMath';

export interface ParsedTxtTestEquipment {
  manufacturer: string;
  model: string;
  serialNumber: string;
  matchedStandardId?: string;
}

export interface ParsedTxtCalibrationReport {
  fileName: string;
  equipmentType: PlantEquipmentType;
  tag: string;
  serialNumber: string;
  instrumentIdLabel: string;
  calibrationDate: string; // YYYY-MM-DD
  calibrationTimestampRaw: string;
  testEquipment: ParsedTxtTestEquipment[];
  matchedStandardIds: string[];
  referenceStandardsSnapshot: Array<{
    id: string;
    standardCode: string;
    name: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
    certificateRef: string;
    lastCalibrationDate: string;
    nextDueDate: string;
    status: CalibrationEquipment['status'];
    accuracySpec: string;
  }>;
  plantAssetCandidate: PlantEquipment;
  readings: TestReadingRow[];
  switchVerification?: SwitchVerificationData;
  overallResult: CertificateOverallResult;
  remarks: string;
  summary: {
    pointCount: number;
    rangeText: string;
    outputRangeText: string;
    toleranceSpec: string;
    fileAsFoundVerdict?: string;
    fileAsLeftVerdict?: string;
  };
  warnings: string[];
}

function cleanTxtText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/Â²/g, '²')
    .replace(/Â³/g, '³')
    .replace(/Â°/g, '°')
    .replace(/Â±/g, '±')
    .replace(/Âµ/g, 'µ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function splitCols(line: string): string[] {
  if (line.includes('\t')) {
    return line.split('\t').map((c) => c.trim());
  }
  return line.split(/\s{2,}/).map((c) => c.trim());
}

function parseSectionMap(text: string): Map<string, string[]> {
  const lines = text.split('\n');
  const sections = new Map<string, string[]>();
  let currentTitle = '__root__';
  sections.set(currentTitle, []);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trimEnd();
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';

    if (line.trim() && /^-{4,}$/.test(nextLine)) {
      currentTitle = line.trim().toLowerCase();
      if (!sections.has(currentTitle)) {
        sections.set(currentTitle, []);
      }
      i += 1; // Skip the dashed separator line
      continue;
    }

    const bucket = sections.get(currentTitle);
    if (bucket) {
      bucket.push(line);
    }
  }

  return sections;
}

function parseKeyValueSection(lines: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = splitCols(line);
    if (cols.length >= 1) {
      const key = cols[0].trim().toLowerCase();
      const value = cols.slice(1).join(' ').trim();
      if (key) {
        map[key] = value;
      }
    }
  }
  return map;
}

function parseTableSection(lines: string[]): Array<Record<string, string>> {
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length < 2) return [];
  const headers = splitCols(nonEmpty[0]).map((h) => h.trim().toLowerCase());
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < nonEmpty.length; i += 1) {
    const vals = splitCols(nonEmpty[i]);
    if (vals.every((v) => v === '')) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (vals[idx] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function parseCalibrationDate(rawDate: string, fileName: string): string {
  const fallbackToday = new Date().toISOString().slice(0, 10);
  const trimmed = rawDate.trim();
  if (!trimmed) return fallbackToday;

  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  // Fluke exports commonly use DD/MM/YYYY hh:mm:ss AM/PM (e.g. 22/06/2026 or 01/06/2026)
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const p1 = Number(slashMatch[1]);
    const p2 = Number(slashMatch[2]);
    const yyyy = slashMatch[3];

    let day = p1;
    let month = p2;

    if (p1 > 12 && p2 <= 12) {
      day = p1;
      month = p2;
    } else if (p2 > 12 && p1 <= 12) {
      month = p1;
      day = p2;
    } else {
      // Ambiguous (both <= 12): check filename hint like _MMDDYYYY_ (e.g. 06012026)
      const fnMatch = fileName.match(/_(\d{2})(\d{2})(20\d{2})_/);
      if (fnMatch) {
        const fn1 = Number(fnMatch[1]);
        const fn2 = Number(fnMatch[2]);
        if (fn1 === p2 && fn2 === p1) {
          day = p1;
          month = p2;
        }
      }
      // Default to DD/MM/YYYY per international/Fluke log format
      day = p1;
      month = p2;
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${yyyy}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const dt = new Date(trimmed);
  if (!Number.isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }
  return fallbackToday;
}

function toNumber(raw: string | undefined, fallback = 0): number {
  if (!raw) return fallback;
  const cleaned = raw.replace(/[^0-9.+-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function cleanNumString(raw: string | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return trimmed;
  // Clean IEEE-754 artifacts like -0.800000000000011 -> -0.8
  return Number(n.toFixed(4)).toString();
}

function inferCategory(tag: string, equipmentType: PlantEquipmentType, inputUnit: string): string {
  const upper = tag.toUpperCase();
  if (equipmentType === 'switch') {
    if (upper.startsWith('PS') || upper.startsWith('PDS')) return 'Pressure Switch';
    if (upper.startsWith('TS')) return 'Temperature Switch';
    if (upper.startsWith('LS')) return 'Level Switch';
    if (upper.startsWith('FS')) return 'Flow Switch';
    return 'Process Switch';
  }
  if (upper.startsWith('PT') || upper.startsWith('PDT') || upper.startsWith('PIT')) {
    return 'Pressure Transmitter';
  }
  if (upper.startsWith('TT') || upper.startsWith('TE')) {
    return 'Temperature Transmitter';
  }
  if (upper.startsWith('FT') || upper.startsWith('FIT')) {
    return 'Flow Transmitter';
  }
  if (upper.startsWith('LT') || upper.startsWith('LIT')) {
    return 'Level Transmitter';
  }
  if (/bar|psi|pa|cm2|cm²/i.test(inputUnit)) return 'Pressure Transmitter';
  if (/°c|°f|k\b/i.test(inputUnit)) return 'Temperature Transmitter';
  return 'Field Instrument';
}

export function parseCalibrationTxtReport(
  rawContent: string,
  fileName: string,
  existingStandards: CalibrationEquipment[],
  existingPlantEquipment: PlantEquipment[]
): ParsedTxtCalibrationReport {
  const text = cleanTxtText(rawContent);
  const sections = parseSectionMap(text);
  const warnings: string[] = [];

  const headerLines =
    sections.get('calibration result') || sections.get('__root__') || [];
  const headerKv = parseKeyValueSection(headerLines);

  const tagFromFilename = fileName.replace(/\.txt$/i, '').split('_')[0] || 'IMPORTED';
  const tag = headerKv['tag'] || tagFromFilename;
  const serialNumber = headerKv['serial number'] || '—';
  const rawId = headerKv['id'] || '';
  const instrumentIdLabel =
    rawId && rawId.toLowerCase() !== 'no name' ? rawId : '';
  const calibrationTimestampRaw = headerKv['calibration date'] || '';
  const calibrationDate = parseCalibrationDate(calibrationTimestampRaw, fileName);

  // Parse Test Equipment Used
  const testEqLines = sections.get('test equipment used') || [];
  const testEqRows = parseTableSection(testEqLines);
  const matchedStandardIds: string[] = [];
  const testEquipment: ParsedTxtTestEquipment[] = [];
  const referenceStandardsSnapshot: ParsedTxtCalibrationReport['referenceStandardsSnapshot'] = [];

  testEqRows.forEach((row, idx) => {
    const manufacturer = row['manufacturer'] || 'Fluke';
    const model = row['model number'] || row['model'] || '—';
    const sn = row['serial number'] || row['s/n'] || '—';

    // Match existing DB standard by exact serial number first, then model + manufacturer
    const match =
      existingStandards.find(
        (s) =>
          sn !== '—' &&
          s.serialNumber.trim().toLowerCase() === sn.trim().toLowerCase()
      ) ||
      existingStandards.find(
        (s) =>
          s.manufacturer.trim().toLowerCase() === manufacturer.trim().toLowerCase() &&
          s.model.trim().toLowerCase().includes(model.trim().toLowerCase())
      );

    if (match) {
      if (!matchedStandardIds.includes(match.id)) {
        matchedStandardIds.push(match.id);
      }
      testEquipment.push({
        manufacturer,
        model,
        serialNumber: sn,
        matchedStandardId: match.id,
      });
      referenceStandardsSnapshot.push({
        id: match.id,
        standardCode: match.standardCode,
        name: match.name,
        manufacturer: match.manufacturer,
        model: match.model,
        serialNumber: sn !== '—' ? sn : match.serialNumber,
        certificateRef: match.certificateRef || 'Field Log Ref',
        lastCalibrationDate: match.lastCalibrationDate,
        nextDueDate: match.nextDueDate,
        status: computeStandardStatus(match),
        accuracySpec: match.accuracySpec,
      });
    } else {
      const virtualId = `txt-std-${idx + 1}`;
      testEquipment.push({
        manufacturer,
        model,
        serialNumber: sn,
      });
      referenceStandardsSnapshot.push({
        id: virtualId,
        standardCode: `REF-${idx + 1}`,
        name: `${manufacturer} ${model}`,
        manufacturer,
        model,
        serialNumber: sn,
        certificateRef: 'Imported Test Log',
        lastCalibrationDate: calibrationDate,
        nextDueDate: addDaysToDate(calibrationDate, 365),
        status: 'Valid',
        accuracySpec: 'Per Calibrator Spec',
      });
    }
  });

  // Detect Transmitter vs Switch
  const hasSwitchSetup = sections.has('switch test setup');
  const asFoundLines = sections.get('as found results') || [];
  const asLeftLines = sections.get('as left results') || [];
  const asFoundRows = parseTableSection(asFoundLines);
  const asLeftRows = parseTableSection(asLeftLines);

  const firstFoundKeys = asFoundRows[0] ? Object.keys(asFoundRows[0]) : [];
  const looksLikeSwitchRows =
    firstFoundKeys.includes('set point') ||
    firstFoundKeys.includes('as found set') ||
    firstFoundKeys.includes('direction');

  const equipmentType: PlantEquipmentType =
    hasSwitchSetup || looksLikeSwitchRows ? 'switch' : 'transmitter';

  const existingAsset = existingPlantEquipment.find(
    (p) => p.assetId.trim().toLowerCase() === tag.trim().toLowerCase()
  );

  if (equipmentType === 'switch') {
    const swKv = parseKeyValueSection(sections.get('switch test setup') || []);
    const foundRow = asFoundRows[0] || {};
    const leftRow = asLeftRows[0] || {};

    const unit = swKv['in type'] || existingAsset?.rangeUnit || 'bar';
    const tripSetpoint = toNumber(
      leftRow['set point'] || foundRow['set point'],
      existingAsset?.switchSpec?.tripSetpoint ?? 0
    );
    const tolPlusMinus = toNumber(
      swKv['setpoint +/-'],
      existingAsset?.switchSpec?.tolerancePlusMinus ?? 0.3
    );
    const tripDetectionMode = swKv['trip detection mode'] || '';
    const deadbandMin =
      swKv['deadband min'] !== undefined ? toNumber(swKv['deadband min'], 0) : undefined;
    const deadbandMax =
      swKv['deadband max'] !== undefined ? toNumber(swKv['deadband max'], 0) : undefined;

    const rawDirection = (
      leftRow['direction'] ||
      foundRow['direction'] ||
      'High'
    ).toLowerCase();
    const tripDirection: SwitchTripDirection =
      rawDirection.includes('low') || rawDirection.includes('fall')
        ? 'Falling (Low)'
        : 'Rising (High)';

    const rawSetState = (
      leftRow['set state'] ||
      foundRow['set state'] ||
      ''
    ).toLowerCase();
    const normalContact: SwitchNormalContact =
      existingAsset?.switchSpec?.normalContact ||
      (rawSetState.includes('open') || rawSetState === 'high'
        ? 'NO (Normally Open)'
        : 'NC (Normally Closed)');

    const asFoundTrip = cleanNumString(foundRow['as found set']);
    const asLeftTrip = cleanNumString(leftRow['as left set']) || asFoundTrip;
    const asFoundReset = cleanNumString(foundRow['as found reset']);
    const asLeftReset = cleanNumString(leftRow['as left reset']) || asFoundReset;
    const deadbandError =
      leftRow['deadband error'] || foundRow['deadband error']
        ? Number(
            toNumber(
              leftRow['deadband error'] || foundRow['deadband error'],
              0
            ).toFixed(3)
          )
        : undefined;

    const readings: TestReadingRow[] = [
      {
        id: `sp-txt-sw-1`,
        label: 'Switch Trip Point',
        nominalInput: tripSetpoint,
        inputUnit: unit,
        expectedOutput: tripSetpoint,
        outputUnit: unit,
        asFound: asFoundTrip,
        asLeft: asLeftTrip,
        tolerance: tolPlusMinus,
      },
    ];

    const switchVerification: SwitchVerificationData = {
      tripDirection,
      normalContact,
      tripSetpoint,
      tolerancePlusMinus: tolPlusMinus,
      unit,
      asFoundTrip,
      asLeftTrip,
      ...(asFoundReset ? { asFoundReset } : {}),
      ...(asLeftReset ? { asLeftReset } : {}),
      ...(deadbandMin !== undefined ? { deadbandMin } : {}),
      ...(deadbandMax !== undefined ? { deadbandMax } : {}),
      ...(deadbandError !== undefined ? { deadbandError } : {}),
      ...(tripDetectionMode ? { tripDetectionMode } : {}),
      contactVerified: true,
    };

    const evaluated = evaluateReadings(readings);
    const overallResult = computeOverallCertificateResult(evaluated, true);

    const frequencyDays = existingAsset?.frequencyDays ?? 180;
    const frequencyLabel = existingAsset?.frequencyLabel || '180 Days (Semi-Annual)';
    const nextDueDate = addDaysToDate(calibrationDate, frequencyDays);
    const rangeMin = existingAsset?.rangeMin ?? 0;
    const rangeMax =
      existingAsset?.rangeMax ?? Math.max(tripSetpoint * 1.2, tripSetpoint + tolPlusMinus);
    const toleranceSpec = `±${tolPlusMinus} ${unit} (Single-Point Trip)`;

    const plantAssetCandidate: PlantEquipment = existingAsset
      ? {
          ...existingAsset,
          serialNumber:
            serialNumber !== '—' ? serialNumber : existingAsset.serialNumber,
          equipmentType: 'switch',
          switchSpec: {
            tripDirection,
            normalContact,
            tripSetpoint,
            ...(asLeftReset
              ? { resetPoint: Number(asLeftReset) }
              : existingAsset.switchSpec?.resetPoint !== undefined
                ? { resetPoint: existingAsset.switchSpec.resetPoint }
                : {}),
            tolerancePlusMinus: tolPlusMinus,
            unit,
          },
          lastCalibrationDate: calibrationDate,
          nextDueDate,
          status: overallResult === 'FAIL' ? 'Out of Tolerance' : 'In Tolerance',
          setpoints: [
            {
              id: 'sp-1',
              label: 'Switch Trip Point',
              nominalInput: tripSetpoint,
              inputUnit: unit,
              expectedOutput: tripSetpoint,
              outputUnit: unit,
              tolerancePlusMinus: tolPlusMinus,
            },
          ],
        }
      : {
          id: `plt-${Date.now()}`,
          assetId: tag,
          tagName: instrumentIdLabel || `${tag} Process Switch`,
          description: `Process Switch (${tripDetectionMode || 'Single-Point Trip'})`,
          manufacturer: '—',
          model: '—',
          serialNumber,
          plantArea: 'Plant Process Unit',
          category: inferCategory(tag, 'switch', unit),
          equipmentType: 'switch',
          switchSpec: {
            tripDirection,
            normalContact,
            tripSetpoint,
            ...(asLeftReset ? { resetPoint: Number(asLeftReset) } : {}),
            tolerancePlusMinus: tolPlusMinus,
            unit,
          },
          frequencyDays,
          frequencyLabel,
          rangeMin,
          rangeMax,
          rangeUnit: unit,
          outputRangeMin: 0,
          outputRangeMax: 1,
          outputUnit: 'Contact',
          toleranceSpec,
          lastCalibrationDate: calibrationDate,
          nextDueDate,
          status: computePlantStatus({ nextDueDate, status: overallResult === 'FAIL' ? 'Out of Tolerance' : 'In Tolerance' }),
          setpoints: [
            {
              id: 'sp-1',
              label: 'Switch Trip Point',
              nominalInput: tripSetpoint,
              inputUnit: unit,
              expectedOutput: tripSetpoint,
              outputUnit: unit,
              tolerancePlusMinus: tolPlusMinus,
            },
          ],
        };

    if (asFoundRows.length === 0 && asLeftRows.length === 0) {
      warnings.push('No switch test rows were found in As Found / As Left Results.');
    }

    const remarksParts = [
      `Imported from calibrator log (${fileName}${calibrationTimestampRaw ? `, ${calibrationTimestampRaw}` : ''}).`,
      `Single-point switch trip verification (${tripDirection}${tripDetectionMode ? `, ${tripDetectionMode}` : ''}).`,
    ];
    if (asLeftReset) {
      remarksParts.push(
        `Reset point measured at ${asLeftReset} ${unit}${
          deadbandMax !== undefined
            ? ` (Deadband limit: ${deadbandMin ?? 0}–${deadbandMax} ${unit}${
                deadbandError !== undefined ? `, deadband error: ${deadbandError}` : ''
              }).`
            : '.'
        }`
      );
    }

    return {
      fileName,
      equipmentType: 'switch',
      tag,
      serialNumber,
      instrumentIdLabel,
      calibrationDate,
      calibrationTimestampRaw,
      testEquipment,
      matchedStandardIds,
      referenceStandardsSnapshot,
      plantAssetCandidate,
      readings,
      switchVerification,
      overallResult,
      remarks: remarksParts.join(' '),
      summary: {
        pointCount: 1,
        rangeText: `${rangeMin} – ${rangeMax} ${unit}`,
        outputRangeText: `${tripDirection} · ${normalContact}`,
        toleranceSpec,
      },
      warnings,
    };
  }

  // Transmitter Calibration Parsing
  const setupKv = parseKeyValueSection(sections.get('test setup') || []);
  const inLow = toNumber(setupKv['in low range'], existingAsset?.rangeMin ?? 0);
  const inHigh = toNumber(setupKv['in high range'], existingAsset?.rangeMax ?? 100);
  const inType =
    setupKv['input type'] ||
    asFoundRows[0]?.['in type'] ||
    existingAsset?.rangeUnit ||
    'mbar';
  const outLow = toNumber(setupKv['out low range'], existingAsset?.outputRangeMin ?? 0);
  const outHigh = toNumber(setupKv['out high range'], existingAsset?.outputRangeMax ?? 100);
  const outType =
    setupKv['output type'] ||
    asFoundRows[0]?.['out type'] ||
    existingAsset?.outputUnit ||
    'mA';
  const correlation = setupKv['correlation to output'] || 'Linear';
  const rawTolerance = setupKv['tolerance'] || '2%';
  const fileAsFoundVerdict = setupKv['as found result'] || '';
  const fileAsLeftVerdict = setupKv['as left result'] || '';

  const inSpan = Math.abs(inHigh - inLow);
  const outSpan = Math.abs(outHigh - outLow);

  const computeTolValue = (tolStr: string): number => {
    const val = toNumber(tolStr, 0.08);
    if (tolStr.includes('%') && outSpan > 0) {
      return Number(((val / 100) * outSpan).toFixed(4));
    }
    return val;
  };

  const defaultTol = computeTolValue(rawTolerance);
  const toleranceSpec = rawTolerance.includes('%')
    ? `±${rawTolerance} Span (±${defaultTol.toFixed(2)} ${outType})`
    : `±${defaultTol} ${outType}`;

  const rowCount = Math.max(asFoundRows.length, asLeftRows.length);
  const readings: TestReadingRow[] = [];
  const setpoints: SetpointSpec[] = [];

  for (let i = 0; i < rowCount; i += 1) {
    const fRow = asFoundRows[i];
    const lRow = asLeftRows[i];
    const baseRow = lRow || fRow;
    if (!baseRow) continue;

    const nominalInput = toNumber(fRow?.['in val'] ?? lRow?.['in val'], 0);
    const inputUnit = fRow?.['in type'] || lRow?.['in type'] || inType;
    const expectedOutput = toNumber(fRow?.['out val'] ?? lRow?.['out val'], 0);
    const outputUnit = fRow?.['out type'] || lRow?.['out type'] || outType;
    const rowTolStr = baseRow['rng %'] || rawTolerance;
    const tol = computeTolValue(rowTolStr);

    const pct =
      inSpan > 0
        ? Math.max(0, Math.min(100, Math.round(((nominalInput - inLow) / inSpan) * 100)))
        : 0;
    const label = `Pt ${i + 1} (${pct}%)`;

    const asFoundVal = fRow ? cleanNumString(fRow['fnd as']) : '';
    const asLeftVal = lRow ? cleanNumString(lRow['lft as']) : asFoundVal;

    readings.push({
      id: `sp-txt-${i + 1}`,
      label,
      nominalInput,
      inputUnit,
      expectedOutput,
      outputUnit,
      asFound: asFoundVal,
      asLeft: asLeftVal,
      tolerance: tol,
    });

    setpoints.push({
      id: `sp-${i + 1}`,
      label,
      nominalInput,
      inputUnit,
      expectedOutput,
      outputUnit,
      tolerancePlusMinus: tol,
    });
  }

  if (readings.length === 0) {
    warnings.push('No As Found or As Left calibration rows found in this file.');
  }

  const evaluated = evaluateReadings(readings, outSpan > 0 ? outSpan : undefined);
  const overallResult = computeOverallCertificateResult(evaluated);

  const frequencyDays = existingAsset?.frequencyDays ?? 180;
  const frequencyLabel = existingAsset?.frequencyLabel || '180 Days (Semi-Annual)';
  const nextDueDate = addDaysToDate(calibrationDate, frequencyDays);

  const plantAssetCandidate: PlantEquipment = existingAsset
    ? {
        ...existingAsset,
        serialNumber:
          serialNumber !== '—' ? serialNumber : existingAsset.serialNumber,
        equipmentType: 'transmitter',
        rangeMin: inLow,
        rangeMax: inHigh,
        rangeUnit: inType,
        outputRangeMin: outLow,
        outputRangeMax: outHigh,
        outputUnit: outType,
        toleranceSpec,
        lastCalibrationDate: calibrationDate,
        nextDueDate,
        status: overallResult === 'FAIL' ? 'Out of Tolerance' : 'In Tolerance',
        setpoints: setpoints.length > 0 ? setpoints : existingAsset.setpoints,
      }
    : {
        id: `plt-${Date.now()}`,
        assetId: tag,
        tagName: instrumentIdLabel || `${tag} Process Transmitter`,
        description: `${correlation} Output Transmitter (${inLow}–${inHigh} ${inType})`,
        manufacturer: '—',
        model: '—',
        serialNumber,
        plantArea: 'Plant Process Unit',
        category: inferCategory(tag, 'transmitter', inType),
        equipmentType: 'transmitter',
        frequencyDays,
        frequencyLabel,
        rangeMin: inLow,
        rangeMax: inHigh,
        rangeUnit: inType,
        outputRangeMin: outLow,
        outputRangeMax: outHigh,
        outputUnit: outType,
        toleranceSpec,
        lastCalibrationDate: calibrationDate,
        nextDueDate,
        status: computePlantStatus({
          nextDueDate,
          status: overallResult === 'FAIL' ? 'Out of Tolerance' : 'In Tolerance',
        }),
        setpoints,
      };

  const remarks = [
    `Imported from calibrator log (${fileName}${calibrationTimestampRaw ? `, ${calibrationTimestampRaw}` : ''}).`,
    `${readings.length}-point ${correlation.toLowerCase()} calibration test within ${toleranceSpec}.`,
    fileAsFoundVerdict || fileAsLeftVerdict
      ? `Calibrator verdicts — As Found: ${fileAsFoundVerdict || 'N/A'}, As Left: ${fileAsLeftVerdict || 'N/A'}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    fileName,
    equipmentType: 'transmitter',
    tag,
    serialNumber,
    instrumentIdLabel,
    calibrationDate,
    calibrationTimestampRaw,
    testEquipment,
    matchedStandardIds,
    referenceStandardsSnapshot,
    plantAssetCandidate,
    readings,
    overallResult,
    remarks,
    summary: {
      pointCount: readings.length,
      rangeText: `${inLow} – ${inHigh} ${inType}`,
      outputRangeText: `${outLow} – ${outHigh} ${outType}`,
      toleranceSpec,
      fileAsFoundVerdict,
      fileAsLeftVerdict,
    },
    warnings,
  };
}
