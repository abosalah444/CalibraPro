import React, { useMemo, useState } from 'react';
import { Download, Eye, Search, Trash2, X } from 'lucide-react';
import type { CalibrationCertificate } from '../types/calibration';
import { exportCertificateToPdf } from '../utils/pdfGenerator';
import { CertificatePreview } from './CertificatePreview';
import { CertificateResultLabel } from './StatusText';

interface CertificateArchiveViewProps {
  certificates: CalibrationCertificate[];
  onDelete: (id: string) => Promise<void>;
}

export const CertificateArchiveView: React.FC<CertificateArchiveViewProps> = ({
  certificates,
  onDelete,
}) => {
  const [search, setSearch] = useState('');
  const [previewCert, setPreviewCert] = useState<CalibrationCertificate | null>(
    null
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return certificates;
    return certificates.filter(
      (c) =>
        c.certificateNumber.toLowerCase().includes(q) ||
        c.assetId.toLowerCase().includes(q) ||
        c.assetSnapshot.tagName.toLowerCase().includes(q) ||
        c.technicianSignature.signerName.toLowerCase().includes(q) ||
        c.verificationHash.toLowerCase().includes(q)
    );
  }, [certificates, search]);

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Issued Certificate Archive
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Audit trail of all digitally signed calibration certificates, SHA-256 hashes, and downloadable A4 PDF reports.
          </p>
        </div>

        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cert #, Asset ID, signer, or hash..."
            className="w-full rounded border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
          />
        </div>
      </div>

      <section className="rounded-md border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-50 text-[11px] text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-2.5 font-semibold">Certificate #</th>
                <th className="px-4 py-2.5 font-semibold">Asset ID & Tag</th>
                <th className="px-4 py-2.5 font-semibold">Cal Date / Next Due</th>
                <th className="px-4 py-2.5 font-semibold">Standards Used</th>
                <th className="px-4 py-2.5 font-semibold">Digital Signers</th>
                <th className="px-4 py-2.5 font-semibold">Result</th>
                <th className="px-4 py-2.5 font-semibold">SHA-256 Digest</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    No issued certificates found. Generate and issue one from Certificate Studio.
                  </td>
                </tr>
              ) : (
                filtered.map((cert) => (
                  <tr key={cert.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {cert.certificateNumber}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 font-mono font-semibold text-blue-700">
                        <span>{cert.assetSnapshot.assetId}</span>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span
                          className={`text-[10px] font-semibold ${
                            cert.assetSnapshot.equipmentType === 'switch' ||
                            Boolean(cert.switchVerification)
                              ? 'text-indigo-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {cert.assetSnapshot.equipmentType === 'switch' ||
                          Boolean(cert.switchVerification)
                            ? 'Switch (1-Pt)'
                            : 'Transmitter'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {cert.assetSnapshot.tagName}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] tabular-nums whitespace-nowrap">
                      <div>{cert.calibrationDate}</div>
                      <div className="text-slate-500">Due: {cert.nextDueDate}</div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-700">
                      {cert.referenceStandardsSnapshot
                        .map((s) => s.standardCode)
                        .join(', ') || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-slate-700">
                      <div>Tech: {cert.technicianSignature.signerName}</div>
                      <div className="text-slate-500">
                        QA: {cert.approverSignature.signerName}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <CertificateResultLabel result={cert.overallResult} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {cert.verificationHash.slice(0, 14)}…
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPreviewCert(cert)}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                        >
                          <Eye className="h-3 w-3" />
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => exportCertificateToPdf(cert)}
                          className="inline-flex items-center gap-1 rounded bg-blue-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-800 cursor-pointer"
                        >
                          <Download className="h-3 w-3" />
                          PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(cert.id)}
                          aria-label={`Delete ${cert.certificateNumber}`}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-700 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {previewCert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-md border border-slate-200 bg-slate-100 shadow-2xl">
            <div className="no-print flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
              <div className="font-mono text-sm font-bold text-slate-900">
                {previewCert.certificateNumber} — {previewCert.assetSnapshot.assetId}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => exportCertificateToPdf(previewCert)}
                  className="inline-flex items-center gap-1.5 rounded bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download Signed PDF
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewCert(null)}
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-6">
              <CertificatePreview certificate={previewCert} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
