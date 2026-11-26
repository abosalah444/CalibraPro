import * as XLSX from 'xlsx';
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
import type { ParsedTxtCalibrationReport } from './txtCalibrationParser';

export interface ParsedExcelCalibrationReport extends ParsedTxtCalibrationReport {
  sheetName: string;
  workOrder?: string;
  calibrationLocation?: 'Field' | 'Laboratory' | '';
  systemName?: string;
  serviceName?: string;
  performedBy?: string;
  approvedBy?: string;
}

interface GridCell {
  raw: unknown;
  text: string;
  numFmt?: string;
}

interface DrawingAnchor {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
  isPic: boolean;
}

interface VmlCheckbox {
  row: number;
  col: number;
  checked: boolean;
}

function normalizeUnit(rawUnit: string, tag = ''): string {
  const u = rawUnit.trim();
  if (!u) return '';
  const lower = u.toLowerCase();
  if (lower === 'bar' || lower === 'bara' || lower === 'barg') return lower;
  if (lower === 'mbar') return 'mbar';
  if (lower === 'psi' || lower === 'psig' || lower === 'psia') return lower;
  if (lower === 'kpa') return 'kPa';
  if (lower === 'mpa') return 'MPa';
  if (lower === 'pa') return 'Pa';
  if (lower === 'ma') return 'mA';
  if (lower === 'c' || lower === 'deg c' || lower === 'degc' || lower === '°c') {
    return '°C';
  }
  if (lower === 'f' || lower === 'deg f' || lower === 'degf' || lower === '°f') {
    return '°F';
  }
  if (tag && /^t/i.test(tag.trim()) && lower === 'c') return '°C';
  return u;
}

function cleanNumString(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '';
  return Number(n.toFixed(4)).toString();
}

function parseNum(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  const str = String(raw).trim();
  if (!str || /^#+$/.test(str)) return null;
  const cleaned = str.replace(/,/g, '').replace(/[^0-9.+-]/g, '');
  if (!cleaned || cleaned === '+' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function cellText(cell?: GridCell): string {
  return cell ? cell.text.trim() : '';
}

function parseExcelReportDate(cell?: GridCell): { isoDate: string; displayRaw: string } {
  const fallbackToday = new Date().toISOString().slice(0, 10);
  if (!cell || cell.raw === undefined || cell.raw === null || cell.raw === '') {
    return { isoDate: fallbackToday, displayRaw: '' };
  }

  const raw = cell.raw;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const iso = raw.toISOString().slice(0, 10);
    return { isoDate: iso, displayRaw: iso };
  }

  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 10000 && raw < 90000) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      const iso = `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(
        2,
        '0'
      )}-${String(parsed.d).padStart(2, '0')}`;
      return { isoDate: iso, displayRaw: iso };
    }
  }

  const str = String(raw).trim();
  if (!str || /^#+$/.test(str)) {
    return { isoDate: fallbackToday, displayRaw: '' };
  }

  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const iso = `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    return { isoDate: iso, displayRaw: str };
  }

  const slashMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (slashMatch) {
    const p1 = Number(slashMatch[1]);
    const p2 = Number(slashMatch[2]);
    let yyyy = slashMatch[3];
    if (yyyy.length === 2) {
      yyyy = Number(yyyy) >= 70 ? `19${yyyy}` : `20${yyyy}`;
    }

    let day = p1;
    let month = p2;
    const fmt = (cell.numFmt || '').toLowerCase();
    if (p1 > 12 && p2 <= 12) {
      day = p1;
      month = p2;
    } else if (p2 > 12 && p1 <= 12) {
      month = p1;
      day = p2;
    } else if (fmt.includes('m/d') || fmt.includes('m-d')) {
      month = p1;
      day = p2;
    } else {
      day = p1;
      month = p2;
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const iso = `${yyyy}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { isoDate: iso, displayRaw: str };
    }
  }

  const dt = new Date(str);
  if (!Number.isNaN(dt.getTime())) {
    return { isoDate: dt.toISOString().slice(0, 10), displayRaw: str };
  }

  return { isoDate: fallbackToday, displayRaw: str };
}

function readZipEntryText(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as {
    asText?: () => string;
    data?: string;
    content?: Uint8Array | string;
    _data?: { getContent?: () => Uint8Array | string };
  };
  try {
    if (typeof e.asText === 'function') {
      return e.asText();
    }
    if (typeof e.data === 'string') {
      return e.data;
    }
    if (e._data && typeof e._data.getContent === 'function') {
      const c = e._data.getContent();
      if (typeof c === 'string') return c;
      if (c instanceof Uint8Array) return new TextDecoder('utf-8').decode(c);
    }
    if (typeof e.content === 'string') return e.content;
    if (e.content instanceof Uint8Array) {
      return new TextDecoder('utf-8').decode(e.content);
    }
  } catch {
    return null;
  }
  return null;
}

function parseDrawingAnchors(xml: string): DrawingAnchor[] {
  const anchors: DrawingAnchor[] = [];
  const blockRegex = /<xdr:(?:twoCellAnchor|oneCellAnchor)[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(xml)) !== null) {
    const block = match[0];
    const fromMatch = block.match(
      /<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:from>/
    );
    if (!fromMatch) continue;
    const fromCol = Number(fromMatch[1]);
    const fromRow = Number(fromMatch[2]);
    const toMatch = block.match(
      /<xdr:to>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:to>/
    );
    const toCol = toMatch ? Number(toMatch[1]) : fromCol;
    const toRow = toMatch ? Number(toMatch[2]) : fromRow;
    const isPic = /<xdr:pic\b/.test(block);

    // Ignore header logo / large decorative images
    if (isPic && fromRow <= 4) continue;
    if (toCol - fromCol >= 4 && toRow - fromRow >= 3) continue;

    anchors.push({
      minRow: Math.min(fromRow, toRow),
      maxRow: Math.max(fromRow, toRow),
      minCol: Math.min(fromCol, toCol),
      maxCol: Math.max(fromCol, toCol),
      isPic,
    });
  }
  return anchors;
}

function parseVmlCheckboxes(vml: string): VmlCheckbox[] {
  const boxes: VmlCheckbox[] = [];
  const shapeRegex = /<v:shape[\s\S]*?<\/v:shape>/gi;
  let match: RegExpExecArray | null;
  while ((match = shapeRegex.exec(vml)) !== null) {
    const block = match[0];
    if (!/ObjectType="Checkbox"/i.test(block)) continue;
    const rowMatch = block.match(/<x:Row>(\d+)<\/x:Row>/i);
    const colMatch = block.match(/<x:Column>(\d+)<\/x:Column>/i);
    if (!rowMatch || !colMatch) continue;
    const checked = /<x:Checked>\s*(?:1|true)?\s*<\/x:Checked>|<x:Checked\s*\/>/i.test(
      block
    );
    boxes.push({
      row: Number(rowMatch[1]),
      col: Number(colMatch[1]),
      checked,
    });
  }
  return boxes;
}

function extractSheetVisualMetadata(
  wb: XLSX.WorkBook,
  sheetIndex: number
): { anchors: DrawingAnchor[]; vmlCheckboxes: VmlCheckbox[] } {
  const files = (wb as unknown as { files?: Record<string, unknown> }).files;
  if (!files) return { anchors: [], vmlCheckboxes: [] };

  const normalizeZipPath = (p: string) => p.replace(/^\/+/, '').replace(/\\/g, '/');
  const findFile = (target: string): unknown => {
    const norm = normalizeZipPath(target).toLowerCase();
    for (const [k, v] of Object.entries(files)) {
      if (normalizeZipPath(k).toLowerCase() === norm) return v;
    }
    return null;
  };

  const relsPath = `xl/worksheets/_rels/sheet${sheetIndex + 1}.xml.rels`;
  const relsXml = readZipEntryText(findFile(relsPath));
  const drawingPaths: string[] = [];
  const vmlPaths: string[] = [];

  if (relsXml) {
    const targetRegex = /Target="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = targetRegex.exec(relsXml)) !== null) {
      const target = m[1].replace(/^\.\.\//, 'xl/');
      if (/drawings\/drawing\d*\.xml$/i.test(target)) {
        drawingPaths.push(target);
      } else if (/drawings\/vmlDrawing\d*\.vml$/i.test(target)) {
        vmlPaths.push(target);
      }
    }
  } else if (wb.SheetNames.length === 1) {
    drawingPaths.push('xl/drawings/drawing1.xml');
    vmlPaths.push('xl/drawings/vmlDrawing1.vml');
  }

  const anchors: DrawingAnchor[] = [];
  for (const dp of drawingPaths) {
    const xml = readZipEntryText(findFile(dp));
    if (xml) anchors.push(...parseDrawingAnchors(xml));
  }

  const vmlCheckboxes: VmlCheckbox[] = [];
  for (const vp of vmlPaths) {
    const vml = readZipEntryText(findFile(vp));
    if (vml) vmlCheckboxes.push(...parseVmlCheckboxes(vml));
  }

  return { anchors, vmlCheckboxes };
}

function buildSheetGrid(sheet: XLSX.WorkSheet): {
  grid: GridCell[][];
  merges: XLSX.Range[];
} {
  const ref = sheet['!ref'];
  if (!ref) return { grid: [], merges: [] };
  const range = XLSX.utils.decode_range(ref);
  const maxR = Math.min(range.e.r, 150);
  const maxC = Math.min(range.e.c, 40);
  const grid: GridCell[][] = [];

  for (let r = 0; r <= maxR; r += 1) {
    const rowArr: GridCell[] = [];
    for (let c = 0; c <= maxC; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr] as XLSX.CellObject | undefined;
      if (!cell) {
        rowArr.push({ raw: '', text: '' });
      } else {
        const rawVal = cell.v ?? cell.w ?? '';
        const txt =
          cell.v !== undefined && cell.v !== null
            ? String(cell.v).trim()
            : cell.w
              ? String(cell.w).trim()
              : '';
        rowArr.push({
          raw: rawVal,
          text: txt,
          numFmt: typeof cell.z === 'string' ? cell.z : undefined,
        });
      }
    }
    grid.push(rowArr);
  }

  return { grid, merges: sheet['!merges'] || [] };
}

function isCheckSymbol(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    t === '✓' ||
    t === '✔' ||
    t === '☑' ||
    t === '√' ||
    t === 'x' ||
    t === '×' ||
    t === 'true' ||
    t === 'ü' ||
    t === 'þ'
  );
}

function checkIndicatorNearCell(
  grid: GridCell[][],
  anchors: DrawingAnchor[],
  vmlCheckboxes: VmlCheckbox[],
  labelRow: number,
  labelCol: number,
  searchSide: 'left' | 'right' | 'both' = 'both'
): boolean {
  const rowCells = grid[labelRow] || [];
  const minC = searchSide === 'right' ? labelCol + 1 : Math.max(0, labelCol - 2);
  const maxC =
    searchSide === 'left'
      ? Math.max(0, labelCol - 1)
      : Math.min(rowCells.length - 1, labelCol + 3);

  for (let c = minC; c <= maxC; c += 1) {
    if (isCheckSymbol(cellText(rowCells[c]))) {
      return true;
    }
  }

  for (const box of vmlCheckboxes) {
    if (
      box.checked &&
      Math.abs(box.row - labelRow) <= 1 &&
      box.col >= minC &&
      box.col <= maxC
    ) {
      return true;
    }
  }

  for (const a of anchors) {
    const rowOverlap = a.maxRow >= labelRow - 1 && a.minRow <= labelRow + 1;
    const colOverlap = a.maxCol >= minC && a.minCol <= maxC;
    if (rowOverlap && colOverlap) {
      return true;
    }
  }

  return false;
}

function findCellMatching(
  grid: GridCell[][],
  regex: RegExp,
  startRow = 0,
  endRow = grid.length - 1
): { row: number; col: number; text: string } | null {
  for (let r = startRow; r <= Math.min(endRow, grid.length - 1); r += 1) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c += 1) {
      const t = cellText(row[c]);
      if (t && regex.test(t)) {
        return { row: r, col: c, text: t };
      }
    }
  }
  return null;
}

function getMergeEndCol(merges: XLSX.Range[], row: number, col: number): number {
  for (const m of merges) {
    if (row >= m.s.r && row <= m.e.r && col >= m.s.c && col <= m.e.c) {
      return m.e.c;
    }
  }
  return col;
}

function findValueRightOfCell(
  grid: GridCell[][],
  merges: XLSX.Range[],
  row: number,
  col: number
): GridCell | undefined {
  const rowCells = grid[row];
  if (!rowCells) return undefined;
  const startCol = getMergeEndCol(merges, row, col) + 1;
  for (let c = startCol; c < rowCells.length; c += 1) {
    const t = cellText(rowCells[c]);
    if (t && !/^[:.\-_]+$/.test(t)) {
      return rowCells[c];
    }
  }
  return undefined;
}

function inferCategory(
  tag: string,
  equipmentType: PlantEquipmentType,
  inputUnit: string,
  checkedPrefix?: string
): string {
  const prefix = (checkedPrefix || '').toUpperCase();
  if (prefix === 'PT' || prefix === 'DP') return 'Pressure Transmitter';
  if (prefix === 'TT') return 'Temperature Transmitter';
  if (prefix === 'LT') return 'Level Transmitter';
  if (prefix === 'FT') return 'Flow Transmitter';
  if (prefix === 'PS' || prefix === 'DPS') return 'Pressure Switch';
  if (prefix === 'TS') return 'Temperature Switch';
  if (prefix === 'LS') return 'Level Switch';
  if (prefix === 'FS') return 'Flow Switch';

  const upper = tag.toUpperCase();
  if (equipmentType === 'switch') {
    if (/PS|PDS/.test(upper)) return 'Pressure Switch';
    if (/TS/.test(upper)) return 'Temperature Switch';
    if (/LS/.test(upper)) return 'Level Switch';
    if (/FS/.test(upper)) return 'Flow Switch';
    return 'Process Switch';
  }
  if (/PDT|PIT|PT/.test(upper)) return 'Pressure Transmitter';
  if (/TT|TE/.test(upper)) return 'Temperature Transmitter';
  if (/FT|FIT/.test(upper)) return 'Flow Transmitter';
  if (/LT|LIT/.test(upper)) return 'Level Transmitter';
  if (/bar|psi|pa/i.test(inputUnit)) return 'Pressure Transmitter';
  if (/°c|°f|\bc\b/i.test(inputUnit)) return 'Temperature Transmitter';
  return 'Field Instrument';
}

function matchOrBuildStandards(
  manufacturer: string,
  modelRaw: string,
  serialOrServiceNo: string,
  calibrationDate: string,
  existingStandards: CalibrationEquipment[]
): {
  matchedStandardIds: string[];
  referenceStandardsSnapshot: ParsedTxtCalibrationReport['referenceStandardsSnapshot'];
} {
  if (!manufacturer && !modelRaw && !serialOrServiceNo) {
    return { matchedStandardIds: [], referenceStandardsSnapshot: [] };
  }

  const mfg = manufacturer || 'Fluke';
  const model = modelRaw || '—';
  const sn = serialOrServiceNo || '—';
  const modelTokens = model
    .split(/[,/&]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3);

  const matched =
    (sn !== '—'
      ? existingStandards.find(
          (s) => s.serialNumber.trim().toLowerCase() === sn.trim().toLowerCase()
        )
      : undefined) ||
    existingStandards.find((s) => {
      const sameMfg =
        !manufacturer ||
        s.manufacturer.trim().toLowerCase() === manufacturer.trim().toLowerCase();
      const sModel = s.model.trim().toLowerCase();
      return (
        sameMfg &&
        (sModel === model.trim().toLowerCase() ||
          modelTokens.some((tok) => sModel.includes(tok) || tok.includes(sModel)))
      );
    });

  if (matched) {
    return {
      matchedStandardIds: [matched.id],
      referenceStandardsSnapshot: [
        {
          id: matched.id,
          standardCode: matched.standardCode,
          name: matched.name,
          manufacturer: matched.manufacturer,
          model: matched.model,
          serialNumber: sn !== '—' ? sn : matched.serialNumber,
          certificateRef: matched.certificateRef || 'Excel Report Ref',
          lastCalibrationDate: matched.lastCalibrationDate,
          nextDueDate: matched.nextDueDate,
          status: computeStandardStatus(matched),
          accuracySpec: matched.accuracySpec,
        },
      ],
    };
  }

  return {
    matchedStandardIds: [],
    referenceStandardsSnapshot: [
      {
        id: `xlsx-std-1`,
        standardCode: 'REF-1',
        name: `${mfg} ${model}`.trim(),
        manufacturer: mfg,
        model,
        serialNumber: sn,
        certificateRef: 'Imported Excel Report',
        lastCalibrationDate: calibrationDate,
        nextDueDate: addDaysToDate(calibrationDate, 365),
        status: 'Valid',
        accuracySpec: 'Per Reference Calibrator Spec',
      },
    ],
  };
}

function extractCommonMetadata(
  grid: GridCell[][],
  merges: XLSX.Range[],
  anchors: DrawingAnchor[],
  vmlCheckboxes: VmlCheckbox[],
  fileName: string,
  sheetName: string
) {
  const dateLabel = findCellMatching(grid, /^date\s*:?$/i, 0, 18);
  const dateCell = dateLabel
    ? findValueRightOfCell(grid, merges, dateLabel.row, dateLabel.col)
    : undefined;
  const { isoDate: calibrationDate, displayRaw: calibrationTimestampRaw } =
    parseExcelReportDate(dateCell);

  const woLabel = findCellMatching(grid, /^work\s*order\s*:?$/i, 0, 20);
  const woCell = woLabel
    ? findValueRightOfCell(grid, merges, woLabel.row, woLabel.col)
    : undefined;
  const workOrder = cellText(woCell);

  // Reference Equipment Section
  let refMfg = '';
  let refModel = '';
  let refServiceNo = '';
  const refSection = findCellMatching(
    grid,
    /calibration\s*(reference|refrance|refrence)/i,
    0,
    25
  );
  const refSearchStart = refSection ? refSection.row + 1 : 6;
  const refHeader = findCellMatching(
    grid,
    /^manufacturer$/i,
    refSearchStart,
    refSearchStart + 5
  );
  if (refHeader) {
    const hdrRow = grid[refHeader.row] || [];
    let mfgCol = refHeader.col;
    let modelCol = -1;
    let snCol = -1;
    for (let c = 0; c < hdrRow.length; c += 1) {
      const t = cellText(hdrRow[c]).toLowerCase();
      if (t.includes('manufacturer')) mfgCol = c;
      else if (t.includes('model')) modelCol = c;
      else if (t.includes('service') || t.includes('serial')) snCol = c;
    }
    for (let r = refHeader.row + 1; r <= Math.min(refHeader.row + 3, grid.length - 1); r += 1) {
      const row = grid[r] || [];
      const mVal = cellText(row[mfgCol]);
      const modVal = modelCol >= 0 ? cellText(row[modelCol]) : '';
      const snVal = snCol >= 0 ? cellText(row[snCol]) : '';
      if (mVal || modVal || snVal) {
        refMfg = mVal;
        refModel = modVal;
        refServiceNo = snVal;
        break;
      }
    }
  }

  // Calibrated Instrument Section
  const instStart = refHeader ? refHeader.row + 2 : 10;
  const instEnd = Math.min(grid.length - 1, instStart + 18);
  const pickInstField = (regex: RegExp): string => {
    const lbl = findCellMatching(grid, regex, instStart, instEnd);
    if (!lbl) return '';
    return cellText(findValueRightOfCell(grid, merges, lbl.row, lbl.col));
  };

  const rawTag = pickInstField(/^(tag|tog)\s*(no\.?|number)?\s*:?$/i);
  const fallbackTag = fileName
    .replace(/\.(xlsx|xls|xlsm|csv)$/i, '')
    .split(/[_\s]+/)[0] || sheetName;
  const tag = rawTag || fallbackTag || 'IMPORTED';
  const systemName = pickInstField(/^system\s*:?$/i);
  const serviceName = pickInstField(/^service\s*:?$/i);
  const instManufacturer = pickInstField(/^manufacturer\s*:?$/i) || '—';
  const instModel = pickInstField(/^model\s*(number|no\.?)?\s*:?$/i) || '—';
  const instSerial = pickInstField(/^serial\s*(number|no\.?)?\s*:?$/i) || '—';

  // Calibration location checkboxes (Field vs Laboratory)
  let calibrationLocation: 'Field' | 'Laboratory' | '' = '';
  const fieldCell = findCellMatching(grid, /^field$/i, instStart, grid.length - 1);
  const labCell = findCellMatching(grid, /^laboratory$/i, instStart, grid.length - 1);
  const fieldChecked = fieldCell
    ? checkIndicatorNearCell(grid, anchors, vmlCheckboxes, fieldCell.row, fieldCell.col, 'left')
    : false;
  const labChecked = labCell
    ? checkIndicatorNearCell(grid, anchors, vmlCheckboxes, labCell.row, labCell.col, 'left')
    : false;
  if (fieldChecked && !labChecked) calibrationLocation = 'Field';
  else if (labChecked && !fieldChecked) calibrationLocation = 'Laboratory';

  // Performed By / Approved By
  const perfCell = findCellMatching(grid, /performed\s*by\s*:?/i, 15, grid.length - 1);
  const appCell = findCellMatching(grid, /approved\s*by\s*:?/i, 15, grid.length - 1);
  const extractSigner = (cellInfo: { row: number; col: number; text: string } | null): string => {
    if (!cellInfo) return '';
    const inline = cellInfo.text.replace(/^.*?(?:performed|approved)\s*by\s*:?\s*/i, '').trim();
    if (inline) return inline;
    const rightVal = cellText(findValueRightOfCell(grid, merges, cellInfo.row, cellInfo.col));
    if (rightVal && !/approved\s*by/i.test(rightVal)) return rightVal;
    const below = grid[cellInfo.row + 1]?.[cellInfo.col];
    return cellText(below);
  };

  const performedBy = extractSigner(perfCell);
  const approvedBy = extractSigner(appCell);

  // Checked type prefix (PT/DP/TT/LT/FT or PS/DPS/TS/LS/FS)
  let checkedPrefix = '';
  const typePrefixes = ['PT', 'DP', 'TT', 'LT', 'FT', 'PS', 'DPS', 'TS', 'LS', 'FS'];
  for (const pfx of typePrefixes) {
    const c = findCellMatching(grid, new RegExp(`^${pfx}$`, 'i'), 2, 10);
    if (c && checkIndicatorNearCell(grid, anchors, vmlCheckboxes, c.row, c.col, 'right')) {
      checkedPrefix = pfx;
      break;
    }
  }

  return {
    calibrationDate,
    calibrationTimestampRaw,
    workOrder,
    refMfg,
    refModel,
    refServiceNo,
    tag,
    systemName,
    serviceName,
    instManufacturer,
    instModel,
    instSerial,
    calibrationLocation,
    performedBy,
    approvedBy,
    checkedPrefix,
  };
}

function detectSheetEquipmentType(grid: GridCell[][]): PlantEquipmentType | null {
  const allText = grid
    .slice(0, 45)
    .map((r) => r.map((c) => c.text).join(' '))
    .join('\n')
    .toLowerCase();

  if (!allText.trim()) return null;

  if (allText.includes('switch calibration report')) return 'switch';
  if (allText.includes('transmitter calibration report')) return 'transmitter';

  const hasSwitchTable =
    (allText.includes('increasing') && allText.includes('decreasing')) ||
    allText.includes('dead band') ||
    allText.includes('pre-adjustment');
  if (hasSwitchTable) return 'switch';

  const hasTransmitterTable =
    allText.includes('applied value') ||
    allText.includes('pre-calibration') ||
    allText.includes('post-calibration') ||
    (allText.includes('urv') && allText.includes('lrv'));
  if (hasTransmitterTable) return 'transmitter';

  return null;
}

function parseExcelSheetReport(
  sheet: XLSX.WorkSheet,
  sheetIndex: number,
  sheetName: string,
  fileName: string,
  wb: XLSX.WorkBook,
  existingStandards: CalibrationEquipment[],
  existingPlantEquipment: PlantEquipment[]
): ParsedExcelCalibrationReport | null {
  const { grid, merges } = buildSheetGrid(sheet);
  if (grid.length === 0) return null;

  const equipmentType = detectSheetEquipmentType(grid);
  if (!equipmentType) return null;

  const { anchors, vmlCheckboxes } = extractSheetVisualMetadata(wb, sheetIndex);
  const meta = extractCommonMetadata(
    grid,
    merges,
    anchors,
    vmlCheckboxes,
    fileName,
    sheetName
  );
  const warnings: string[] = [];

  const existingAsset = existingPlantEquipment.find(
    (p) => p.assetId.trim().toLowerCase() === meta.tag.trim().toLowerCase()
  );

  const { matchedStandardIds, referenceStandardsSnapshot } = matchOrBuildStandards(
    meta.refMfg,
    meta.refModel,
    meta.refServiceNo,
    meta.calibrationDate,
    existingStandards
  );

  const testEquipment =
    meta.refMfg || meta.refModel || meta.refServiceNo
      ? [
          {
            manufacturer: meta.refMfg || '—',
            model: meta.refModel || '—',
            serialNumber: meta.refServiceNo || '—',
            matchedStandardId: matchedStandardIds[0],
          },
        ]
      : [];

  const displayLabel =
    [meta.serviceName, meta.systemName].filter(Boolean).join(' · ') ||
    existingAsset?.tagName ||
    `${meta.tag} ${equipmentType === 'switch' ? 'Process Switch' : 'Process Transmitter'}`;

  const plantArea =
    meta.systemName || existingAsset?.plantArea || 'Plant Process Unit';

  if (equipmentType === 'switch') {
    // Contact type: NO ( low ) vs NC ( high )
    const noCell = findCellMatching(grid, /\bno\s*\(\s*low\s*\)/i, 12, grid.length - 1);
    const ncCell = findCellMatching(grid, /\bnc\s*\(\s*high\s*\)/i, 12, grid.length - 1);
    const noChecked = noCell
      ? checkIndicatorNearCell(grid, anchors, vmlCheckboxes, noCell.row, noCell.col, 'left')
      : false;
    const ncChecked = ncCell
      ? checkIndicatorNearCell(grid, anchors, vmlCheckboxes, ncCell.row, ncCell.col, 'left')
      : false;

    // Locate switch data table header
    const spHeader = findCellMatching(
      grid,
      /set[\s-]*point/i,
      15,
      grid.length - 1
    );

    let setPointCol = spHeader ? spHeader.col : -1;
    let incCol = -1;
    let decCol = -1;
    let dbCol = -1;
    let unitCol = -1;
    let tableStartRow = spHeader ? spHeader.row + 1 : 20;

    if (spHeader) {
      const hdrRow = grid[spHeader.row] || [];
      for (let c = 0; c < hdrRow.length; c += 1) {
        const t = cellText(hdrRow[c]).toLowerCase();
        if (t.includes('set') && t.includes('point')) setPointCol = c;
        else if (t.includes('increas')) incCol = c;
        else if (t.includes('decreas')) decCol = c;
        else if (t.includes('dead')) dbCol = c;
        else if (t === 'unit' || t.includes('unit')) unitCol = c;
      }
    }

    let preRow: GridCell[] | undefined;
    let postRow: GridCell[] | undefined;
    for (let r = tableStartRow; r <= Math.min(tableStartRow + 6, grid.length - 1); r += 1) {
      const row = grid[r] || [];
      const rowLabel = row
        .slice(0, Math.max(2, setPointCol))
        .map((c) => c.text)
        .join(' ')
        .toLowerCase();
      if (rowLabel.includes('pre')) {
        preRow = row;
      } else if (rowLabel.includes('post') || rowLabel.includes('adjust')) {
        postRow = row;
      }
    }

    const preSp = preRow && setPointCol >= 0 ? parseNum(preRow[setPointCol]?.raw) : null;
    const postSp = postRow && setPointCol >= 0 ? parseNum(postRow[setPointCol]?.raw) : null;
    const preInc = preRow && incCol >= 0 ? parseNum(preRow[incCol]?.raw) : null;
    const postInc = postRow && incCol >= 0 ? parseNum(postRow[incCol]?.raw) : null;
    const preDec = preRow && decCol >= 0 ? parseNum(preRow[decCol]?.raw) : null;
    const postDec = postRow && decCol >= 0 ? parseNum(postRow[decCol]?.raw) : null;
    const postDb = postRow && dbCol >= 0 ? parseNum(postRow[dbCol]?.raw) : null;
    const preDb = preRow && dbCol >= 0 ? parseNum(preRow[dbCol]?.raw) : null;

    const rawUnit =
      (postRow && unitCol >= 0 ? cellText(postRow[unitCol]) : '') ||
      (preRow && unitCol >= 0 ? cellText(preRow[unitCol]) : '') ||
      existingAsset?.rangeUnit ||
      'bar';
    const unit = normalizeUnit(rawUnit, meta.tag);

    const tripSetpoint =
      postSp ?? preSp ?? existingAsset?.switchSpec?.tripSetpoint ?? 0;

    // Determine Rising (High) vs Falling (Low) + Normal Contact
    let tripDirection: SwitchTripDirection;
    let normalContact: SwitchNormalContact;

    if (ncChecked && !noChecked) {
      tripDirection = 'Rising (High)';
      normalContact = 'NC (Normally Closed)';
    } else if (noChecked && !ncChecked) {
      tripDirection = 'Falling (Low)';
      normalContact = 'NO (Normally Open)';
    } else if (/ll\b|low/i.test(meta.tag) || /psl|tsl|lsl|fsl/i.test(meta.tag)) {
      tripDirection = 'Falling (Low)';
      normalContact = existingAsset?.switchSpec?.normalContact || 'NO (Normally Open)';
    } else if (/hh\b|high/i.test(meta.tag) || /psh|tsh|lsh|fsh/i.test(meta.tag)) {
      tripDirection = 'Rising (High)';
      normalContact = existingAsset?.switchSpec?.normalContact || 'NC (Normally Closed)';
    } else if (
      postInc !== null &&
      postDec !== null &&
      Math.abs(postDec - tripSetpoint) < Math.abs(postInc - tripSetpoint)
    ) {
      tripDirection = 'Falling (Low)';
      normalContact = existingAsset?.switchSpec?.normalContact || 'NO (Normally Open)';
    } else {
      tripDirection = existingAsset?.switchSpec?.tripDirection || 'Rising (High)';
      normalContact =
        existingAsset?.switchSpec?.normalContact || 'NC (Normally Closed)';
    }

    const asFoundTrip = cleanNumString(
      tripDirection === 'Rising (High)' ? preInc : preDec
    );
    const asLeftTrip =
      cleanNumString(tripDirection === 'Rising (High)' ? postInc : postDec) ||
      asFoundTrip;
    const asFoundReset = cleanNumString(
      tripDirection === 'Rising (High)' ? preDec : preInc
    );
    const asLeftReset =
      cleanNumString(tripDirection === 'Rising (High)' ? postDec : postInc) ||
      asFoundReset;

    const tolPlusMinus =
      existingAsset?.switchSpec?.tolerancePlusMinus ??
      (Math.abs(tripSetpoint) >= 10
        ? Number((Math.abs(tripSetpoint) * 0.01).toFixed(2))
        : 0.3);

    const readings: TestReadingRow[] = [
      {
        id: `sp-xlsx-sw-1`,
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
      contactVerified: true,
    };

    const evaluated = evaluateReadings(readings);
    const overallResult = computeOverallCertificateResult(evaluated, true);
    const frequencyDays = existingAsset?.frequencyDays ?? 180;
    const frequencyLabel = existingAsset?.frequencyLabel || '180 Days (Semi-Annual)';
    const nextDueDate = addDaysToDate(meta.calibrationDate, frequencyDays);

    const observedMax = Math.max(
      tripSetpoint,
      preInc ?? 0,
      postInc ?? 0,
      preDec ?? 0,
      postDec ?? 0
    );
    const rangeMin = existingAsset?.rangeMin ?? 0;
    const rangeMax =
      existingAsset?.rangeMax ??
      (observedMax > 0 ? Math.ceil((observedMax * 1.2) / 10) * 10 : 100);
    const toleranceSpec = `±${tolPlusMinus} ${unit} (Single-Point Trip)`;

    const plantAssetCandidate: PlantEquipment = existingAsset
      ? {
          ...existingAsset,
          serialNumber:
            meta.instSerial !== '—' ? meta.instSerial : existingAsset.serialNumber,
          manufacturer:
            meta.instManufacturer !== '—'
              ? meta.instManufacturer
              : existingAsset.manufacturer,
          model:
            meta.instModel !== '—' ? meta.instModel : existingAsset.model,
          plantArea,
          equipmentType: 'switch',
          rangeMin,
          rangeMax,
          rangeUnit: unit,
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
          lastCalibrationDate: meta.calibrationDate,
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
          assetId: meta.tag,
          tagName: displayLabel,
          description: `${meta.serviceName || 'Process Switch'} (${tripDirection})`,
          manufacturer: meta.instManufacturer,
          model: meta.instModel,
          serialNumber: meta.instSerial,
          plantArea,
          category: inferCategory(meta.tag, 'switch', unit, meta.checkedPrefix),
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
          lastCalibrationDate: meta.calibrationDate,
          nextDueDate,
          status: computePlantStatus({
            nextDueDate,
            status: overallResult === 'FAIL' ? 'Out of Tolerance' : 'In Tolerance',
          }),
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

    if (!asFoundTrip && !asLeftTrip) {
      warnings.push('No switch Increasing/Decreasing readings were found in this sheet.');
    }

    const remarksParts = [
      `Imported from Excel report (${fileName}${
        wb.SheetNames.length > 1 ? ` · ${sheetName}` : ''
      }).`,
      meta.workOrder ? `Work Order: ${meta.workOrder}.` : '',
      meta.calibrationLocation
        ? `Calibration Location: ${meta.calibrationLocation}.`
        : '',
      `Single-point switch trip verification (${tripDirection}, ${normalContact}).`,
      asLeftReset
        ? `Reset point: ${asLeftReset} ${unit}${
            postDb !== null
              ? ` (Post-Adjustment Dead Band: ${postDb} ${unit}${
                  preDb !== null ? `, Pre-Adjustment: ${preDb} ${unit}` : ''
                }).`
              : '.'
          }`
        : '',
    ].filter(Boolean);

    return {
      fileName,
      sheetName,
      workOrder: meta.workOrder,
      calibrationLocation: meta.calibrationLocation,
      systemName: meta.systemName,
      serviceName: meta.serviceName,
      performedBy: meta.performedBy,
      approvedBy: meta.approvedBy,
      equipmentType: 'switch',
      tag: meta.tag,
      serialNumber: meta.instSerial,
      instrumentIdLabel: displayLabel,
      calibrationDate: meta.calibrationDate,
      calibrationTimestampRaw: meta.calibrationTimestampRaw,
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

  // Transmitter Report Parsing
  const urvCell = findCellMatching(grid, /^urv$/i, 12, grid.length - 1);
  const lrvCell = findCellMatching(grid, /^lrv$/i, 12, grid.length - 1);

  const readRangeNumberAndUnit = (
    cellInfo: { row: number; col: number } | null
  ): { val: number | null; unit: string } => {
    if (!cellInfo) return { val: null, unit: '' };
    const row = grid[cellInfo.row] || [];
    let val: number | null = null;
    let unit = '';
    for (let c = cellInfo.col + 1; c < Math.min(row.length, cellInfo.col + 6); c += 1) {
      const t = cellText(row[c]);
      if (!t) continue;
      const n = parseNum(row[c].raw);
      if (val === null && n !== null && !/[a-z]/i.test(t.replace(/e[+-]?\d+/i, ''))) {
        val = n;
      } else if (val === null && n !== null) {
        // e.g. "90 BAR" in a single cell
        val = n;
        unit = t.replace(/[0-9.,+\-\s]+/g, '').trim();
        break;
      } else if (!unit && /[a-z°%]/i.test(t) && !/field|lab/i.test(t)) {
        unit = t;
        break;
      }
    }
    return { val, unit };
  };

  const urvParsed = readRangeNumberAndUnit(urvCell);
  const lrvParsed = readRangeNumberAndUnit(lrvCell);
  const inLow = lrvParsed.val ?? existingAsset?.rangeMin ?? 0;
  const inHigh = urvParsed.val ?? existingAsset?.rangeMax ?? 100;
  const inType = normalizeUnit(
    urvParsed.unit || lrvParsed.unit || existingAsset?.rangeUnit || 'bar',
    meta.tag
  );

  // Locate data table header (`Steps` / `Applied Value` / `Pre-Calibration` / `Post-Calibration`)
  const appliedHeader = findCellMatching(grid, /applied\s*value/i, 14, grid.length - 1);
  let stepsCol = 0;
  let appliedCol = appliedHeader ? appliedHeader.col : 1;
  let preCol = -1;
  let postCol = -1;
  let tableHeaderEndRow = appliedHeader ? appliedHeader.row : 22;

  if (appliedHeader) {
    for (let r = appliedHeader.row; r <= Math.min(appliedHeader.row + 2, grid.length - 1); r += 1) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c += 1) {
        const t = cellText(row[c]).toLowerCase();
        if (t.includes('step')) stepsCol = c;
        else if (t.includes('applied')) appliedCol = c;
        else if (t.includes('pre-cal') || t.includes('pre cal') || t.includes('as found') || t.includes('as-found')) {
          preCol = c;
          tableHeaderEndRow = Math.max(tableHeaderEndRow, r);
        } else if (
          t.includes('post-cal') ||
          t.includes('post cal') ||
          t.includes('as left') ||
          t.includes('as-left')
        ) {
          postCol = c;
          tableHeaderEndRow = Math.max(tableHeaderEndRow, r);
        }
      }
    }
    if (preCol === -1) preCol = appliedCol + 1;
    if (postCol === -1) postCol = preCol + 1;
  }

  interface RawTxRow {
    stepLabel: string;
    applied: number;
    pre: number | null;
    post: number | null;
  }

  const rawTxRows: RawTxRow[] = [];
  let notesStartRow = tableHeaderEndRow + 1;

  for (let r = tableHeaderEndRow + 1; r < grid.length; r += 1) {
    const row = grid[r] || [];
    const rowJoined = row.map((c) => c.text).join(' ').toLowerCase();
    if (rowJoined.includes('performed by') || rowJoined.includes('approved by')) {
      break;
    }

    const appliedNum = parseNum(row[appliedCol]?.raw);
    const preNum = parseNum(row[preCol]?.raw);
    const postNum = parseNum(row[postCol]?.raw);
    const stepRaw = cellText(row[stepsCol]);

    if (appliedNum !== null && (preNum !== null || postNum !== null)) {
      let stepLabel = stepRaw;
      if (stepRaw && typeof row[stepsCol]?.raw === 'number') {
        const rawStepNum = row[stepsCol].raw as number;
        const pct = rawStepNum <= 1.05 ? Math.round(rawStepNum * 100) : Math.round(rawStepNum);
        stepLabel = `${pct}%`;
      }
      rawTxRows.push({
        stepLabel,
        applied: appliedNum,
        pre: preNum,
        post: postNum,
      });
      notesStartRow = r + 1;
    } else if (rawTxRows.length > 0 && rowJoined.replace(/[:.\-\s]/g, '').length > 5) {
      // Reached technician notes section below table
      break;
    }
  }

  // Extract technician remarks below the data table and above Performed By
  const noteLines: string[] = [];
  for (let r = notesStartRow; r < grid.length; r += 1) {
    const row = grid[r] || [];
    const rowJoined = row.map((c) => c.text).join(' ').trim();
    if (/performed\s*by|approved\s*by/i.test(rowJoined)) break;
    const cleanedLine = row
      .map((c) => c.text.trim())
      .filter((t) => t && !/^[:.\-_]+$/.test(t))
      .join(' ')
      .trim();
    if (cleanedLine.length > 3) {
      noteLines.push(cleanedLine);
    }
  }

  // Auto-detect whether Measured Values (Pre/Post) are in the same engineering unit as Applied Value (e.g. BAR)
  // vs a 4–20 mA signal.
  const inSpan = Math.abs(inHigh - inLow);
  const measuredValues = rawTxRows
    .map((r) => r.post ?? r.pre)
    .filter((v): v is number => v !== null);

  let isMaOutput = false;
  if (measuredValues.length >= 2 && inSpan > 0) {
    const allInMaBand = measuredValues.every((v) => v >= 3.2 && v <= 20.8);
    if (allInMaBand) {
      const maErrSum = rawTxRows.reduce((acc, r) => {
        const m = r.post ?? r.pre;
        if (m === null) return acc;
        const expectedMa = 4 + 16 * ((r.applied - inLow) / inSpan);
        return acc + Math.abs(m - expectedMa);
      }, 0);
      const unitErrSum = rawTxRows.reduce((acc, r) => {
        const m = r.post ?? r.pre;
        if (m === null) return acc;
        return acc + Math.abs(m - r.applied);
      }, 0);
      isMaOutput = maErrSum < unitErrSum * 0.5 && maErrSum / measuredValues.length < 1.5;
    }
  }

  const outLow = isMaOutput ? 4 : inLow;
  const outHigh = isMaOutput ? 20 : inHigh;
  const outType = isMaOutput ? 'mA' : inType;
  const outSpan = Math.abs(outHigh - outLow);
  const defaultTol = isMaOutput
    ? 0.08
    : Number(Math.max(0.01, (outSpan || 100) * 0.005).toFixed(3));
  const toleranceSpec = isMaOutput
    ? `±0.08 mA (±0.5% Span)`
    : `±${defaultTol} ${outType} (±0.5% Span)`;

  const readings: TestReadingRow[] = rawTxRows.map((row, idx) => {
    const pct =
      inSpan > 0
        ? Math.max(0, Math.min(100, Math.round(((row.applied - inLow) / inSpan) * 100)))
        : 0;
    const label = row.stepLabel
      ? `Pt ${idx + 1} (${row.stepLabel})`
      : `Pt ${idx + 1} (${pct}%)`;
    const expectedOutput = isMaOutput
      ? Number((4 + 16 * ((row.applied - inLow) / inSpan)).toFixed(3))
      : row.applied;
    const asFound = cleanNumString(row.pre);
    const asLeft = cleanNumString(row.post) || asFound;
    return {
      id: `sp-xlsx-${idx + 1}`,
      label,
      nominalInput: row.applied,
      inputUnit: inType,
      expectedOutput,
      outputUnit: outType,
      asFound,
      asLeft,
      tolerance: defaultTol,
    };
  });

  const setpoints: SetpointSpec[] = readings.map((r, idx) => ({
    id: `sp-${idx + 1}`,
    label: r.label,
    nominalInput: r.nominalInput,
    inputUnit: r.inputUnit,
    expectedOutput: r.expectedOutput,
    outputUnit: r.outputUnit,
    tolerancePlusMinus: r.tolerance,
  }));

  if (readings.length === 0) {
    warnings.push('No calibration measurement rows were found in this sheet.');
  }

  const evaluated = evaluateReadings(readings, outSpan > 0 ? outSpan : undefined);
  const overallResult: CertificateOverallResult =
    computeOverallCertificateResult(evaluated);

  const frequencyDays = existingAsset?.frequencyDays ?? 180;
  const frequencyLabel = existingAsset?.frequencyLabel || '180 Days (Semi-Annual)';
  const nextDueDate = addDaysToDate(meta.calibrationDate, frequencyDays);

  const plantAssetCandidate: PlantEquipment = existingAsset
    ? {
        ...existingAsset,
        serialNumber:
          meta.instSerial !== '—' ? meta.instSerial : existingAsset.serialNumber,
        manufacturer:
          meta.instManufacturer !== '—'
            ? meta.instManufacturer
            : existingAsset.manufacturer,
        model: meta.instModel !== '—' ? meta.instModel : existingAsset.model,
        plantArea,
        equipmentType: 'transmitter',
        rangeMin: inLow,
        rangeMax: inHigh,
        rangeUnit: inType,
        outputRangeMin: outLow,
        outputRangeMax: outHigh,
        outputUnit: outType,
        toleranceSpec,
        lastCalibrationDate: meta.calibrationDate,
        nextDueDate,
        status: overallResult === 'FAIL' ? 'Out of Tolerance' : 'In Tolerance',
        setpoints: setpoints.length > 0 ? setpoints : existingAsset.setpoints,
      }
    : {
        id: `plt-${Date.now()}`,
        assetId: meta.tag,
        tagName: displayLabel,
        description: `${meta.serviceName ? `${meta.serviceName} · ` : ''}Transmitter (${inLow}–${inHigh} ${inType})`,
        manufacturer: meta.instManufacturer,
        model: meta.instModel,
        serialNumber: meta.instSerial,
        plantArea,
        category: inferCategory(meta.tag, 'transmitter', inType, meta.checkedPrefix),
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
        lastCalibrationDate: meta.calibrationDate,
        nextDueDate,
        status: computePlantStatus({
          nextDueDate,
          status: overallResult === 'FAIL' ? 'Out of Tolerance' : 'In Tolerance',
        }),
        setpoints,
      };

  const remarks = [
    ...noteLines,
    `Imported from Excel report (${fileName}${
      wb.SheetNames.length > 1 ? ` · ${sheetName}` : ''
    }).`,
    meta.workOrder ? `Work Order: ${meta.workOrder}.` : '',
    meta.calibrationLocation
      ? `Calibration Location: ${meta.calibrationLocation}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    fileName,
    sheetName,
    workOrder: meta.workOrder,
    calibrationLocation: meta.calibrationLocation,
    systemName: meta.systemName,
    serviceName: meta.serviceName,
    performedBy: meta.performedBy,
    approvedBy: meta.approvedBy,
    equipmentType: 'transmitter',
    tag: meta.tag,
    serialNumber: meta.instSerial,
    instrumentIdLabel: displayLabel,
    calibrationDate: meta.calibrationDate,
    calibrationTimestampRaw: meta.calibrationTimestampRaw,
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
    },
    warnings,
  };
}

export async function parseCalibrationExcelReports(
  file: File,
  existingStandards: CalibrationEquipment[],
  existingPlantEquipment: PlantEquipment[]
): Promise<ParsedExcelCalibrationReport[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, {
    type: 'array',
    bookFiles: true,
    cellDates: false,
  });

  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new Error('The Excel workbook contains no worksheets.');
  }

  const results: ParsedExcelCalibrationReport[] = [];
  wb.SheetNames.forEach((sheetName, idx) => {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return;
    const parsed = parseExcelSheetReport(
      sheet,
      idx,
      sheetName,
      file.name,
      wb,
      existingStandards,
      existingPlantEquipment
    );
    if (parsed) {
      results.push(parsed);
    }
  });

  if (results.length === 0) {
    throw new Error(
      'Could not recognize a Transmitter or Switch Calibration Report layout in this workbook.'
    );
  }

  return results;
}
