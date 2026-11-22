import React from 'react';
import type {
  CertificateOverallResult,
  PlantStatus,
  StandardStatus,
} from '../types/calibration';

export const StandardStatusLabel: React.FC<{ status: StandardStatus }> = ({
  status,
}) => {
  const styles: Record<StandardStatus, { glyph: string; cls: string }> = {
    Valid: { glyph: '●', cls: 'text-emerald-700' },
    'Due Soon': { glyph: '▲', cls: 'text-amber-700' },
    Overdue: { glyph: '✖', cls: 'text-rose-700' },
    'Out for Calibration': { glyph: '◆', cls: 'text-slate-600' },
    Retired: { glyph: '○', cls: 'text-slate-500' },
  };
  const cfg = styles[status] || styles.Valid;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${cfg.cls}`}>
      <span aria-hidden="true" className="text-[10px]">
        {cfg.glyph}
      </span>
      <span>{status}</span>
    </span>
  );
};

export const PlantStatusLabel: React.FC<{ status: PlantStatus }> = ({
  status,
}) => {
  const styles: Record<PlantStatus, { glyph: string; cls: string }> = {
    'In Tolerance': { glyph: '●', cls: 'text-emerald-700' },
    'Due Soon': { glyph: '▲', cls: 'text-amber-700' },
    Overdue: { glyph: '✖', cls: 'text-rose-700' },
    'Out of Tolerance': { glyph: '✖', cls: 'text-rose-700' },
    Scheduled: { glyph: '◆', cls: 'text-blue-700' },
  };
  const cfg = styles[status] || styles['In Tolerance'];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${cfg.cls}`}>
      <span aria-hidden="true" className="text-[10px]">
        {cfg.glyph}
      </span>
      <span>{status}</span>
    </span>
  );
};

export const CertificateResultLabel: React.FC<{
  result: CertificateOverallResult;
}> = ({ result }) => {
  const styles: Record<CertificateOverallResult, { glyph: string; cls: string }> = {
    PASS: { glyph: '✓', cls: 'text-emerald-700' },
    'PASS AFTER ADJUSTMENT': { glyph: '▲', cls: 'text-amber-700' },
    FAIL: { glyph: '✖', cls: 'text-rose-700' },
    LIMITED: { glyph: '◆', cls: 'text-slate-600' },
  };
  const cfg = styles[result] || styles.LIMITED;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${cfg.cls}`}>
      <span aria-hidden="true">{cfg.glyph}</span>
      <span>{result}</span>
    </span>
  );
};
