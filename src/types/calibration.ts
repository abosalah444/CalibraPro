export type StandardStatus =
  | 'Valid'
  | 'Due Soon'
  | 'Overdue'
  | 'Out for Calibration'
  | 'Retired';

export type PlantStatus =
  | 'In Tolerance'
  | 'Due Soon'
  | 'Overdue'
  | 'Out of Tolerance'
  | 'Scheduled';

export type CertificateOverallResult =
  | 'PASS'
  | 'PASS AFTER ADJUSTMENT'
  | 'FAIL'
  | 'LIMITED';

export interface StandardCertificateFile {
  fileName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  url: string;
}

export interface CalibrationEquipment {
  id: string;
  standardCode: string;
  name: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  category: string;
  accuracySpec: string;
  measurementRange: string;
  lastCalibrationDate: string; // YYYY-MM-DD
  nextDueDate: string; // YYYY-MM-DD
  calibrationIntervalDays: number;
  certificateRef: string;
  traceabilityLab: string;
  status: StandardStatus;
  notes?: string;
  certificateFile?: StandardCertificateFile | null;
}

export type PlantEquipmentType = 'transmitter' | 'switch';

export type SwitchTripDirection = 'Rising (High)' | 'Falling (Low)';

export type SwitchNormalContact = 'NO (Normally Open)' | 'NC (Normally Closed)';

export interface SwitchSpec {
  tripDirection: SwitchTripDirection;
  normalContact: SwitchNormalContact;
  tripSetpoint: number;
  resetPoint?: number;
  tolerancePlusMinus: number;
  unit: string;
}

export interface SwitchVerificationData {
  tripDirection: SwitchTripDirection;
  normalContact: SwitchNormalContact;
  tripSetpoint: number;
  tolerancePlusMinus: number;
  unit: string;
  asFoundTrip: string;
  asLeftTrip: string;
  asFoundReset?: string;
  asLeftReset?: string;
  deadbandMin?: number;
  deadbandMax?: number;
  deadbandError?: number;
  tripDetectionMode?: string;
  contactVerified: boolean;
}

export interface SetpointSpec {
  id: string;
  label: string;
  nominalInput: number;
  inputUnit: string;
  expectedOutput: number;
  outputUnit: string;
  tolerancePlusMinus: number;
}

export interface PlantEquipment {
  id: string;
  assetId: string; // Unique Asset Identifier e.g. PT-104A
  tagName: string;
  description: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  plantArea: string;
  category: string;
  equipmentType?: PlantEquipmentType;
  switchSpec?: SwitchSpec;
  frequencyDays: number;
  frequencyLabel: string;
  rangeMin: number;
  rangeMax: number;
  rangeUnit: string;
  outputRangeMin: number;
  outputRangeMax: number;
  outputUnit: string;
  toleranceSpec: string;
  lastCalibrationDate: string; // YYYY-MM-DD
  nextDueDate: string; // YYYY-MM-DD
  status: PlantStatus;
  setpoints: SetpointSpec[];
}

export interface TestReadingRow {
  id: string;
  label: string;
  nominalInput: number;
  inputUnit: string;
  expectedOutput: number;
  outputUnit: string;
  asFound: string;
  asLeft: string;
  tolerance: number;
}

export interface EvaluatedReadingRow extends TestReadingRow {
  asFoundNum: number | null;
  asLeftNum: number | null;
  asFoundError: number | null;
  asLeftError: number | null;
  asFoundPass: boolean | null;
  asLeftPass: boolean | null;
  spanPctError: number | null;
}

export interface DigitalSignature {
  signerName: string;
  signerTitle: string;
  licenseId: string;
  signedAt: string; // ISO string
  signatureDataUrl: string; // PNG data URL
  method: 'drawn' | 'typed';
}

export interface CalibrationUser {
  id: string;
  fullName: string;
  title: string;
  licenseId: string;
  department?: string;
  email?: string;
  active: boolean;
}

export interface LabSettings {
  laboratoryName: string;
  accreditationNumber: string;
  facilityAddress: string;
  defaultProcedure: string;
  defaultAmbientTempC: string;
  defaultHumidityPct: string;
  defaultPressureHpa: string;
}

export interface CalibrationCertificate {
  id: string;
  certificateNumber: string;
  createdAt: string;
  calibrationDate: string;
  nextDueDate: string;
  plantEquipmentId: string;
  assetId: string;
  assetSnapshot: {
    assetId: string;
    tagName: string;
    description: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
    plantArea: string;
    category: string;
    equipmentType?: PlantEquipmentType;
    frequencyLabel: string;
    rangeText: string;
    outputRangeText: string;
    toleranceSpec: string;
  };
  referenceStandardIds: string[];
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
    status: StandardStatus;
    accuracySpec: string;
  }>;
  laboratoryName: string;
  accreditationNumber: string;
  facilityAddress: string;
  procedureRef: string;
  ambientTempC: string;
  relativeHumidityPct: string;
  barometricPressureHpa: string;
  readings: TestReadingRow[];
  switchVerification?: SwitchVerificationData;
  overallResult: CertificateOverallResult;
  remarks: string;
  technicianSignature: DigitalSignature;
  approverSignature: DigitalSignature;
  verificationHash: string;
}

export interface CalibrationDatabasePayload {
  standards: CalibrationEquipment[];
  plantEquipment: PlantEquipment[];
  certificates: CalibrationCertificate[];
  users: CalibrationUser[];
  labSettings: LabSettings;
}
