import React from 'react';
import type { CalibrationCertificate } from '../types/calibration';
import { evaluateReadings, formatSignedNumber } from '../utils/calibrationMath';
import { CertificateResultLabel, StandardStatusLabel } from './StatusText';

interface CertificatePreviewProps {
  certificate: CalibrationCertificate;
}

export const CertificatePreview: React.FC<CertificatePreviewProps> = ({
  certificate,
}) => {
  const isSwitchCert =
    certificate.assetSnapshot.equipmentType === 'switch' ||
    Boolean(certificate.switchVerification);
  const effectiveReadings = isSwitchCert
    ? certificate.readings.slice(0, 1)
    : certificate.readings;
  const evaluated = evaluateReadings(effectiveReadings);
  const sw = certificate.switchVerification;

  return (
    <article className="print-only-sheet mx-auto w-full max-w-[794px] rounded-md border border-slate-200 bg-white text-slate-900 shadow-xs">
      {/* Slate Navy Certificate Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-800 px-6 py-5 text-white">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="shrink-0 rounded bg-white px-2.5 py-1.5">
            <img
              src="/assets/aistudio/image_98312608.png"
              alt="GASCO logo"
              className="h-10 w-auto object-contain"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-wider text-slate-200 uppercase">
              {isSwitchCert
                ? 'Calibration Certificate · Single-Point Switch Verification'
                : 'Calibration Certificate'}
            </p>
            <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-white">
              {certificate.laboratoryName}
            </h2>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="font-mono text-sm font-bold text-white tabular-nums">
            {certificate.certificateNumber}
          </div>
          <div className="mt-1.5 inline-block rounded bg-white px-2.5 py-0.5">
            <CertificateResultLabel result={certificate.overallResult} />
          </div>
        </div>
      </div>

      {/* Metadata Ribbon */}
      <div className="grid grid-cols-2 gap-4 border-b border-slate-200 bg-slate-50 px-6 py-3 sm:grid-cols-4">
        <div>
          <div className="text-[10px] font-semibold text-slate-500 uppercase">
            Calibration Date
          </div>
          <div className="mt-0.5 font-mono text-xs font-semibold text-slate-900 tabular-nums">
            {certificate.calibrationDate || '—'}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-slate-500 uppercase">
            Next Due Date
          </div>
          <div className="mt-0.5 font-mono text-xs font-semibold text-slate-900 tabular-nums">
            {certificate.nextDueDate || '—'}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-slate-500 uppercase">
            Procedure
          </div>
          <div className="mt-0.5 font-mono text-xs font-medium text-slate-900 truncate">
            {certificate.procedureRef || '—'}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-slate-500 uppercase">
            Environment
          </div>
          <div className="mt-0.5 font-mono text-xs font-medium text-slate-900 tabular-nums">
            {certificate.ambientTempC}°C / {certificate.relativeHumidityPct}%RH /{' '}
            {certificate.barometricPressureHpa} hPa
          </div>
        </div>
      </div>

      <div className="space-y-5 px-6 py-5">
        {/* 1. Plant Equipment Under Calibration */}
        <section>
          <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-800 uppercase">
            1. Equipment Under Calibration (Plant Asset)
          </h3>
          <div className="grid grid-cols-1 divide-y divide-slate-200 rounded border border-slate-200 text-xs sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <dl className="divide-y divide-slate-100">
              <div className="flex justify-between gap-3 px-3 py-1.5">
                <dt className="text-slate-500">Unique Asset ID</dt>
                <dd className="font-mono font-semibold text-slate-900">
                  {certificate.assetSnapshot.assetId}
                </dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-1.5">
                <dt className="text-slate-500">Tag / Service</dt>
                <dd className="text-right font-medium text-slate-900">
                  {certificate.assetSnapshot.tagName}
                </dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-1.5">
                <dt className="text-slate-500">Make / Model</dt>
                <dd className="text-right text-slate-800">
                  {certificate.assetSnapshot.manufacturer} {certificate.assetSnapshot.model}
                </dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-1.5">
                <dt className="text-slate-500">Serial Number</dt>
                <dd className="font-mono text-slate-800">
                  {certificate.assetSnapshot.serialNumber}
                </dd>
              </div>
            </dl>
            <dl className="divide-y divide-slate-100">
              <div className="flex justify-between gap-3 px-3 py-1.5">
                <dt className="text-slate-500">Equipment Type</dt>
                <dd className="font-mono font-semibold text-slate-900">
                  {isSwitchCert ? 'Switch (Single-Point)' : 'Transmitter'}
                </dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-1.5">
                <dt className="text-slate-500">Plant Area</dt>
                <dd className="text-right text-slate-800">
                  {certificate.assetSnapshot.plantArea}
                </dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-1.5">
                <dt className="text-slate-500">Cal Frequency</dt>
                <dd className="font-mono text-slate-800">
                  {certificate.assetSnapshot.frequencyLabel}
                </dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-1.5">
                <dt className="text-slate-500">
                  {isSwitchCert ? 'Operating Range' : 'Calibrated Range'}
                </dt>
                <dd className="font-mono text-slate-800">
                  {isSwitchCert
                    ? certificate.assetSnapshot.rangeText
                    : `${certificate.assetSnapshot.rangeText} → ${certificate.assetSnapshot.outputRangeText}`}
                </dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-1.5">
                <dt className="text-slate-500">Tolerance Spec</dt>
                <dd className="font-mono font-medium text-slate-900">
                  {certificate.assetSnapshot.toleranceSpec}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* 2. Reference Standards */}
        <section>
          <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-800 uppercase">
            2. Traceable Calibration Reference Standards
          </h3>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead className="bg-slate-50 text-slate-600">
                <tr className="border-b border-slate-200">
                  <th className="px-2.5 py-1.5 font-semibold">Code</th>
                  <th className="px-2.5 py-1.5 font-semibold">Instrument / Model</th>
                  <th className="px-2.5 py-1.5 font-semibold">Serial No.</th>
                  <th className="px-2.5 py-1.5 font-semibold">Cert Ref</th>
                  <th className="px-2.5 py-1.5 font-semibold">Last Cal</th>
                  <th className="px-2.5 py-1.5 font-semibold">Due Date</th>
                  <th className="px-2.5 py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {certificate.referenceStandardsSnapshot.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-3 text-center text-slate-400">
                      Select one or more reference standards to document traceability.
                    </td>
                  </tr>
                ) : (
                  certificate.referenceStandardsSnapshot.map((std) => (
                    <tr key={std.id}>
                      <td className="px-2.5 py-1.5 font-mono font-semibold text-slate-900">
                        {std.standardCode}
                      </td>
                      <td className="px-2.5 py-1.5 text-slate-800">
                        {std.manufacturer} {std.model}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono text-slate-700">
                        {std.serialNumber}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono text-slate-700">
                        {std.certificateRef}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums text-slate-700">
                        {std.lastCalibrationDate}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums text-slate-700">
                        {std.nextDueDate}
                      </td>
                      <td className="px-2.5 py-1.5">
                        <StandardStatusLabel status={std.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 3. Test Results Table (Single-Point Switch Verification vs Multi-Point Transmitter) */}
        {isSwitchCert ? (
          <section>
            <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-800 uppercase">
              3. Single-Point Switch Verification
            </h3>
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full border-collapse text-left text-[11px]">
                <thead className="bg-slate-50 text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="px-2.5 py-1.5 font-semibold">Verification Point</th>
                    <th className="px-2.5 py-1.5 font-semibold text-right">Target Setpoint</th>
                    <th className="px-2.5 py-1.5 font-semibold text-right">As-Found Trip</th>
                    <th className="px-2.5 py-1.5 font-semibold text-right">Found Dev</th>
                    <th className="px-2.5 py-1.5 font-semibold text-right">As-Left Trip</th>
                    <th className="px-2.5 py-1.5 font-semibold text-right">Left Dev</th>
                    <th className="px-2.5 py-1.5 font-semibold text-right">Tol (±)</th>
                    <th className="px-2.5 py-1.5 font-semibold text-right">Result</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {evaluated.map((row) => {
                    const pointPass =
                      sw?.contactVerified === false
                        ? false
                        : row.asLeftPass !== null
                          ? row.asLeftPass
                          : row.asFoundPass;
                    return (
                      <tr key={row.id}>
                        <td className="px-2.5 py-2 font-sans font-medium text-slate-800">
                          {row.label || 'Switch Trip Point'}
                        </td>
                        <td className="px-2.5 py-2 text-right font-semibold text-slate-900">
                          {row.expectedOutput} {row.outputUnit}
                        </td>
                        <td className="px-2.5 py-2 text-right text-slate-800">
                          {row.asFound ? `${row.asFound} ${row.outputUnit}` : '—'}
                        </td>
                        <td
                          className={`px-2.5 py-2 text-right ${
                            row.asFoundPass === false
                              ? 'font-semibold text-rose-700'
                              : 'text-slate-600'
                          }`}
                        >
                          {formatSignedNumber(row.asFoundError, 3)}
                        </td>
                        <td className="px-2.5 py-2 text-right text-slate-800">
                          {row.asLeft ? `${row.asLeft} ${row.outputUnit}` : '—'}
                        </td>
                        <td
                          className={`px-2.5 py-2 text-right ${
                            row.asLeftPass === false
                              ? 'font-semibold text-rose-700'
                              : 'text-slate-600'
                          }`}
                        >
                          {formatSignedNumber(row.asLeftError, 3)}
                        </td>
                        <td className="px-2.5 py-2 text-right text-slate-600">
                          ±{row.tolerance} {row.outputUnit}
                        </td>
                        <td className="px-2.5 py-2 text-right font-sans font-semibold">
                          {pointPass === null ? (
                            <span className="text-slate-400">N/A</span>
                          ) : pointPass ? (
                            <span className="text-emerald-700">✓ PASS</span>
                          ) : (
                            <span className="text-rose-700">✖ FAIL</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {sw && (
              <div className="mt-2 grid grid-cols-2 gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] sm:grid-cols-4">
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase">
                    Trip Action
                  </div>
                  <div className="mt-0.5 font-medium text-slate-900">
                    {sw.tripDirection}
                    {sw.tripDetectionMode ? (
                      <span className="block text-[10px] text-slate-500">
                        {sw.tripDetectionMode}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase">
                    Normal Contact
                  </div>
                  <div className="mt-0.5 font-medium text-slate-900">
                    {sw.normalContact}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase">
                    Reset / Deadband
                  </div>
                  <div className="mt-0.5 font-mono text-slate-800 tabular-nums">
                    {(() => {
                      const resetStr = sw.asLeftReset || sw.asFoundReset;
                      const tripStr = sw.asLeftTrip || sw.asFoundTrip;
                      if (!resetStr) return '—';
                      const rNum = Number(resetStr);
                      const tNum = Number(tripStr);
                      const limitSuffix =
                        sw.deadbandMax !== undefined
                          ? ` · Max ${sw.deadbandMax}`
                          : '';
                      if (
                        !Number.isNaN(rNum) &&
                        !Number.isNaN(tNum) &&
                        tripStr.trim() !== ''
                      ) {
                        return `${resetStr} ${sw.unit} (Δ ${Math.abs(tNum - rNum).toFixed(2)}${limitSuffix})`;
                      }
                      return `${resetStr} ${sw.unit}`;
                    })()}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase">
                    Contact State
                  </div>
                  <div className="mt-0.5 font-semibold">
                    {sw.contactVerified ? (
                      <span className="text-emerald-700">✓ Transition Verified</span>
                    ) : (
                      <span className="text-rose-700">✖ Not Verified</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        ) : (
          <section>
            <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-800 uppercase">
              3. As-Found & As-Left Calibration Readings
            </h3>
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full border-collapse text-left text-[11px]">
                <thead className="bg-slate-50 text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="px-2.5 py-1.5 font-semibold">Setpoint</th>
                    <th className="px-2.5 py-1.5 font-semibold text-right">Nominal Input</th>
                    <th className="px-2.5 py-1.5 font-semibold text-right">Expected Out</th>
                    <th className="px-2.5 py-1.5 font-semibold text-right">As-Found</th>
                    <th className="px-2.5 py-1.5 font-semibold text-right">Found Err</th>
                    <th className="px-2.5 py-1.5 font-semibold text-right">As-Left</th>
                    <th className="px-2.5 py-1.5 font-semibold text-right">Left Err</th>
                    <th className="px-2.5 py-1.5 font-semibold text-right">Tol (±)</th>
                    <th className="px-2.5 py-1.5 font-semibold text-right">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                  {evaluated.map((row, idx) => {
                    const pointPass =
                      row.asLeftPass !== null ? row.asLeftPass : row.asFoundPass;
                    return (
                      <tr key={row.id} className={idx % 2 === 1 ? 'bg-slate-50/50' : ''}>
                        <td className="px-2.5 py-1.5 font-sans font-medium text-slate-800">
                          {row.label}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-slate-700">
                          {row.nominalInput} {row.inputUnit}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-slate-900 font-medium">
                          {row.expectedOutput} {row.outputUnit}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-slate-800">
                          {row.asFound ? `${row.asFound} ${row.outputUnit}` : '—'}
                        </td>
                        <td
                          className={`px-2.5 py-1.5 text-right ${
                            row.asFoundPass === false ? 'font-semibold text-rose-700' : 'text-slate-600'
                          }`}
                        >
                          {formatSignedNumber(row.asFoundError, 3)}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-slate-800">
                          {row.asLeft ? `${row.asLeft} ${row.outputUnit}` : '—'}
                        </td>
                        <td
                          className={`px-2.5 py-1.5 text-right ${
                            row.asLeftPass === false ? 'font-semibold text-rose-700' : 'text-slate-600'
                          }`}
                        >
                          {formatSignedNumber(row.asLeftError, 3)}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-slate-600">
                          ±{row.tolerance}
                        </td>
                        <td className="px-2.5 py-1.5 text-right font-sans font-semibold">
                          {pointPass === null ? (
                            <span className="text-slate-400">N/A</span>
                          ) : pointPass ? (
                            <span className="text-emerald-700">✓ PASS</span>
                          ) : (
                            <span className="text-rose-700">✖ FAIL</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 4. Remarks */}
        {certificate.remarks.trim() && (
          <section>
            <h3 className="mb-1.5 text-xs font-bold tracking-wide text-slate-800 uppercase">
              4. Calibration Notes & Remarks
            </h3>
            <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
              {certificate.remarks}
            </p>
          </section>
        )}

        {/* 5. Digital Signatures */}
        <section>
          <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-800 uppercase">
            5. Digital Signatures & Verification Seal
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              {
                heading: 'Calibrated By (Metrology Technician)',
                sig: certificate.technicianSignature,
              },
              {
                heading: 'Reviewed & Approved By (QA Engineer)',
                sig: certificate.approverSignature,
              },
            ].map(({ heading, sig }) => (
              <div
                key={heading}
                className="rounded border border-slate-200 bg-white p-3"
              >
                <div className="text-[10px] font-semibold text-slate-500 uppercase">
                  {heading}
                </div>
                <div className="my-2 flex h-14 items-center border-b border-slate-200 pb-1">
                  {sig.signatureDataUrl ? (
                    <img
                      src={sig.signatureDataUrl}
                      alt={`${sig.signerName} signature`}
                      className="h-12 max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs italic text-slate-400">
                      Awaiting digital signature
                    </span>
                  )}
                </div>
                <div className="text-xs font-semibold text-slate-900">
                  {sig.signerName || 'Unsigned'}
                </div>
                <div className="text-[11px] text-slate-600">
                  {sig.signerTitle || '—'}
                  {sig.licenseId ? ` · ID: ${sig.licenseId}` : ''}
                </div>
                <div className="mt-1 font-mono text-[10px] text-slate-500 tabular-nums">
                  {sig.signedAt
                    ? `Signed (${sig.method}): ${sig.signedAt.replace('T', ' ').slice(0, 19)} UTC`
                    : 'Not signed'}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-[10px] font-semibold text-slate-500 uppercase">
              SHA-256 Verification Hash
            </span>
            <span className="font-mono text-[11px] font-semibold text-blue-700 break-all">
              {certificate.verificationHash || 'Computing digest...'}
            </span>
          </div>
        </section>
      </div>
    </article>
  );
};
