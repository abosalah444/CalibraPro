import { jsPDF } from 'jspdf';
import type { CalibrationCertificate } from '../types/calibration';
import { evaluateReadings, formatSignedNumber } from './calibrationMath';

let cachedBannerLogoDataUrl: string | null | undefined;

async function getBannerLogoDataUrl(): Promise<string | null> {
  if (cachedBannerLogoDataUrl !== undefined) {
    return cachedBannerLogoDataUrl;
  }
  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    return null;
  }
  try {
    const res = await fetch('/assets/aistudio/image_98312608.png');
    if (!res.ok) {
      cachedBannerLogoDataUrl = null;
      return null;
    }
    const blob = await res.blob();
    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    cachedBannerLogoDataUrl = dataUrl;
    return dataUrl;
  } catch {
    cachedBannerLogoDataUrl = null;
    return null;
  }
}

export async function exportCertificateToPdf(
  cert: CalibrationCertificate
): Promise<void> {
  const bannerLogoDataUrl = await getBannerLogoDataUrl();

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageW = 210;
  const pageH = 297;
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 14;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > pageH - 18) {
      doc.addPage();
      y = 14;
      drawFooter();
    }
  };

  const drawFooter = () => {
    const pageNum = doc.getNumberOfPages();
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.line(margin, pageH - 13, pageW - margin, pageH - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Certificate ${cert.certificateNumber}  ·  Asset ${cert.assetSnapshot.assetId}  ·  SHA-256: ${cert.verificationHash.slice(0, 24)}...`,
      margin,
      pageH - 8.5
    );
    doc.text(`Page ${pageNum}`, pageW - margin, pageH - 8.5, { align: 'right' });
  };

  // Header Banner
  doc.setFillColor(30, 41, 59);
  doc.rect(margin, y, contentW, 22, 'F');

  let textStartX = margin + 5;
  if (bannerLogoDataUrl) {
    try {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin + 4, y + 3.5, 29, 15, 1.2, 1.2, 'F');
      doc.addImage(bannerLogoDataUrl, 'PNG', margin + 5.5, y + 4.75, 25.9, 12.5);
      textStartX = margin + 36.5;
    } catch {
      textStartX = margin + 5;
    }
  }

  const isSwitchCert =
    cert.assetSnapshot.equipmentType === 'switch' ||
    Boolean(cert.switchVerification);
  const sw = cert.switchVerification;

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('CALIBRATION CERTIFICATE', textStartX, y + 8.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(226, 232, 240);
  doc.text(cert.laboratoryName, textStartX, y + 16);

  // Certificate ID & Overall Result Box on Header Right
  doc.setTextColor(255, 255, 255);
  doc.setFont('courier', 'bold');
  doc.setFontSize(10.5);
  doc.text(cert.certificateNumber, pageW - margin - 5, y + 8.5, { align: 'right' });

  const resultColors: Record<string, [number, number, number]> = {
    PASS: [22, 163, 74],
    'PASS AFTER ADJUSTMENT': [217, 119, 6],
    FAIL: [220, 38, 38],
    LIMITED: [71, 85, 105],
  };
  const badgeRgb = resultColors[cert.overallResult] || [71, 85, 105];
  doc.setFillColor(badgeRgb[0], badgeRgb[1], badgeRgb[2]);
  const badgeW = 48;
  doc.rect(pageW - margin - badgeW - 5, y + 11.5, badgeW, 6.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(cert.overallResult, pageW - margin - badgeW / 2 - 5, y + 15.8, {
    align: 'center',
  });

  y += 27;

  // Section 1: Dates & Environmental Conditions Strip
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, y, contentW, 14, 'FD');

  const cols4 = contentW / 4;
  const metaItems = [
    ['CALIBRATION DATE', cert.calibrationDate || '—'],
    ['NEXT DUE DATE', cert.nextDueDate || '—'],
    ['PROCEDURE REF', cert.procedureRef || '—'],
    [
      'ENVIRONMENT',
      `${cert.ambientTempC}°C  /  ${cert.relativeHumidityPct}%RH  /  ${cert.barometricPressureHpa} hPa`,
    ],
  ];

  metaItems.forEach(([label, val], idx) => {
    const x = margin + idx * cols4 + 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(label, x, y + 4.8);
    doc.setFont('courier', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(15, 23, 42);
    doc.text(doc.splitTextToSize(val, cols4 - 5)[0] || '—', x, y + 10.5);
  });

  y += 19;

  // Section 2: Unit Under Calibration (Plant Equipment)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('1. EQUIPMENT UNDER CALIBRATION (PLANT ASSET)', margin, y);
  y += 2.5;

  doc.setDrawColor(203, 213, 225);
  doc.rect(margin, y, contentW, 28, 'S');
  doc.line(margin + contentW / 2, y, margin + contentW / 2, y + 28);

  const leftRows = [
    ['Unique Asset ID:', `${cert.assetSnapshot.assetId} (${cert.assetSnapshot.tagName})`],
    ['Equipment Type:', isSwitchCert ? 'Switch (Single-Point Verification)' : 'Transmitter'],
    ['Manufacturer / Model:', `${cert.assetSnapshot.manufacturer} / ${cert.assetSnapshot.model}`],
    ['Serial Number:', cert.assetSnapshot.serialNumber],
  ];
  const rightRows = [
    ['Plant Area / Unit:', cert.assetSnapshot.plantArea],
    ['Calibration Interval:', cert.assetSnapshot.frequencyLabel],
    [
      isSwitchCert ? 'Operating Range:' : 'Input / Output Range:',
      isSwitchCert
        ? cert.assetSnapshot.rangeText
        : `${cert.assetSnapshot.rangeText}  →  ${cert.assetSnapshot.outputRangeText}`,
    ],
    ['Tolerance Spec:', cert.assetSnapshot.toleranceSpec],
  ];

  leftRows.forEach(([k, v], i) => {
    const rowY = y + 5.5 + i * 6.2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(k, margin + 3, rowY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(doc.splitTextToSize(v || '—', contentW / 2 - 36)[0] || '—', margin + 34, rowY);
  });

  rightRows.forEach(([k, v], i) => {
    const rowY = y + 5.5 + i * 6.2;
    const xBase = margin + contentW / 2 + 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(k, xBase, rowY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(doc.splitTextToSize(v || '—', contentW / 2 - 37)[0] || '—', xBase + 34, rowY);
  });

  y += 34;

  // Section 3: Traceable Reference Standards
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('2. TRACEABLE CALIBRATION REFERENCE STANDARDS', margin, y);
  y += 3;

  const stdHeaders = [
    'Code',
    'Instrument / Model',
    'Serial No.',
    'Certificate Ref',
    'Last Cal Date',
    'Due Date',
    'Status',
  ];
  const stdWidths = [18, 52, 24, 28, 21, 21, 18];

  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.rect(margin, y, contentW, 6.5, 'FD');

  let cx = margin;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(51, 65, 85);
  stdHeaders.forEach((h, idx) => {
    doc.text(h, cx + 1.8, y + 4.4);
    cx += stdWidths[idx];
  });
  y += 6.5;

  if (cert.referenceStandardsSnapshot.length === 0) {
    doc.rect(margin, y, contentW, 7, 'S');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('No reference standards linked.', margin + 3, y + 4.6);
    y += 7;
  } else {
    cert.referenceStandardsSnapshot.forEach((std) => {
      ensureSpace(8);
      doc.setDrawColor(226, 232, 240);
      doc.rect(margin, y, contentW, 7, 'S');
      const cells = [
        std.standardCode,
        `${std.name} (${std.model})`,
        std.serialNumber,
        std.certificateRef,
        std.lastCalibrationDate,
        std.nextDueDate,
        std.status,
      ];
      let rx = margin;
      doc.setFont('courier', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(15, 23, 42);
      cells.forEach((val, idx) => {
        if (idx === 1) doc.setFont('helvetica', 'normal');
        else doc.setFont('courier', 'normal');
        const clipped = doc.splitTextToSize(val || '—', stdWidths[idx] - 3)[0] || '—';
        doc.text(clipped, rx + 1.8, y + 4.6);
        rx += stdWidths[idx];
      });
      y += 7;
    });
  }

  y += 6;

  // Section 4: Calibration Test Results Table (Single-Point Switch vs Multi-Point Transmitter)
  if (isSwitchCert) {
    ensureSpace(34);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('3. SINGLE-POINT SWITCH VERIFICATION', margin, y);
    y += 3;

    const evaluated = evaluateReadings(cert.readings.slice(0, 1));
    const swHeaders = [
      'Verification Point',
      'Target Setpoint',
      'As-Found Trip',
      'Found Dev',
      'As-Left Trip',
      'Left Dev',
      'Tol (±)',
      'Result',
    ];
    const swWidths = [30, 24, 24, 21, 24, 21, 20, 18];

    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.rect(margin, y, contentW, 7, 'FD');

    cx = margin;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(51, 65, 85);
    swHeaders.forEach((h, idx) => {
      doc.text(h, cx + 1.6, y + 4.6);
      cx += swWidths[idx];
    });
    y += 7;

    evaluated.forEach((row) => {
      doc.setDrawColor(226, 232, 240);
      doc.rect(margin, y, contentW, 7.5, 'S');

      const pointPass =
        sw?.contactVerified === false
          ? false
          : row.asLeftPass !== null
            ? row.asLeftPass
            : row.asFoundPass;
      const statusText =
        pointPass === null ? 'N/A' : pointPass ? 'PASS' : 'FAIL';

      const rowVals = [
        row.label || 'Switch Trip Point',
        `${row.expectedOutput} ${row.outputUnit}`,
        row.asFound ? `${row.asFound} ${row.outputUnit}` : '—',
        formatSignedNumber(row.asFoundError, 3),
        row.asLeft ? `${row.asLeft} ${row.outputUnit}` : '—',
        formatSignedNumber(row.asLeftError, 3),
        `±${row.tolerance} ${row.outputUnit}`,
        statusText,
      ];

      let rx = margin;
      rowVals.forEach((val, colIdx) => {
        doc.setFont(
          colIdx === 0 ? 'helvetica' : 'courier',
          colIdx === 7 ? 'bold' : 'normal'
        );
        doc.setFontSize(7.2);
        if (colIdx === 7) {
          if (statusText === 'PASS') doc.setTextColor(22, 163, 74);
          else if (statusText === 'FAIL') doc.setTextColor(220, 38, 38);
          else doc.setTextColor(100, 116, 139);
        } else {
          doc.setTextColor(15, 23, 42);
        }
        const clipped = doc.splitTextToSize(val, swWidths[colIdx] - 2.5)[0] || '—';
        doc.text(clipped, rx + 1.6, y + 5);
        rx += swWidths[colIdx];
      });
      y += 7.5;
    });

    if (sw) {
      y += 2.5;
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.rect(margin, y, contentW, 13, 'FD');

      const resetStr = sw.asLeftReset || sw.asFoundReset;
      const tripStr = sw.asLeftTrip || sw.asFoundTrip;
      let resetDisplay = '—';
      if (resetStr) {
        const rNum = Number(resetStr);
        const tNum = Number(tripStr);
        const limitSuffix =
          sw.deadbandMax !== undefined ? ` · Max ${sw.deadbandMax}` : '';
        resetDisplay =
          !Number.isNaN(rNum) && !Number.isNaN(tNum) && tripStr.trim() !== ''
            ? `${resetStr} ${sw.unit} (Δ ${Math.abs(tNum - rNum).toFixed(2)}${limitSuffix})`
            : `${resetStr} ${sw.unit}`;
      }

      const swCols = contentW / 4;
      const swMeta: Array<[string, string, [number, number, number]?]> = [
        [
          'TRIP ACTION',
          sw.tripDetectionMode
            ? `${sw.tripDirection} (${sw.tripDetectionMode})`
            : sw.tripDirection,
        ],
        ['NORMAL CONTACT', sw.normalContact],
        ['RESET / DEADBAND', resetDisplay],
        [
          'CONTACT STATE',
          sw.contactVerified ? 'Verified' : 'Not Verified',
          sw.contactVerified ? [22, 163, 74] : [220, 38, 38],
        ],
      ];

      swMeta.forEach(([lbl, val, rgb], idx) => {
        const x = margin + idx * swCols + 3;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(100, 116, 139);
        doc.text(lbl, x, y + 4.5);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.6);
        if (rgb) doc.setTextColor(rgb[0], rgb[1], rgb[2]);
        else doc.setTextColor(15, 23, 42);
        doc.text(doc.splitTextToSize(val, swCols - 5)[0] || '—', x, y + 9.8);
      });
      y += 13;
    }

    y += 6;
  } else {
    ensureSpace(28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('3. AS-FOUND & AS-LEFT CALIBRATION TEST RESULTS', margin, y);
    y += 3;

    const evaluated = evaluateReadings(cert.readings);
    const resHeaders = [
      'Setpoint',
      'Nominal Input',
      'Expected Out',
      'As-Found',
      'Found Err',
      'As-Left',
      'Left Err',
      'Tol (±)',
      'Result',
    ];
    const resWidths = [20, 23, 23, 21, 20, 21, 20, 17, 17];

    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.rect(margin, y, contentW, 7, 'FD');

    cx = margin;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(51, 65, 85);
    resHeaders.forEach((h, idx) => {
      doc.text(h, cx + 1.6, y + 4.6);
      cx += resWidths[idx];
    });
    y += 7;

    evaluated.forEach((row, idx) => {
      ensureSpace(8);
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, contentW, 7, 'F');
      }
      doc.setDrawColor(226, 232, 240);
      doc.rect(margin, y, contentW, 7, 'S');

      const pointPass =
        row.asLeftPass !== null ? row.asLeftPass : row.asFoundPass;
      const statusText =
        pointPass === null ? 'N/A' : pointPass ? 'PASS' : 'FAIL';

      const rowVals = [
        row.label || `Pt ${idx + 1}`,
        `${row.nominalInput} ${row.inputUnit}`,
        `${row.expectedOutput} ${row.outputUnit}`,
        row.asFound ? `${row.asFound} ${row.outputUnit}` : '—',
        formatSignedNumber(row.asFoundError, 3),
        row.asLeft ? `${row.asLeft} ${row.outputUnit}` : '—',
        formatSignedNumber(row.asLeftError, 3),
        `±${row.tolerance}`,
        statusText,
      ];

      let rx = margin;
      rowVals.forEach((val, colIdx) => {
        doc.setFont('courier', colIdx === 8 ? 'bold' : 'normal');
        doc.setFontSize(7);
        if (colIdx === 8) {
          if (statusText === 'PASS') doc.setTextColor(22, 163, 74);
          else if (statusText === 'FAIL') doc.setTextColor(220, 38, 38);
          else doc.setTextColor(100, 116, 139);
        } else {
          doc.setTextColor(15, 23, 42);
        }
        const clipped = doc.splitTextToSize(val, resWidths[colIdx] - 2.5)[0] || '—';
        doc.text(clipped, rx + 1.6, y + 4.6);
        rx += resWidths[colIdx];
      });
      y += 7;
    });

    y += 6;
  }

  // Section 5: Remarks
  if (cert.remarks && cert.remarks.trim()) {
    ensureSpace(22);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('4. TECHNICIAN OBSERVATIONS & CALIBRATION NOTES', margin, y);
    y += 3;
    const remarkLines = doc.splitTextToSize(cert.remarks.trim(), contentW - 6);
    const boxH = Math.max(12, remarkLines.length * 4.5 + 5);
    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y, contentW, boxH, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text(remarkLines, margin + 3, y + 5);
    y += boxH + 6;
  }

  // Section 6: Digital Signatures & Cryptographic Seal
  ensureSpace(48);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('5. DIGITAL SIGNATURES & CRYPTOGRAPHIC VERIFICATION', margin, y);
  y += 3;

  const sigBoxW = (contentW - 6) / 2;
  const sigBoxH = 34;

  const drawSignatureBox = (
    x: number,
    roleHeading: string,
    sig: CalibrationCertificate['technicianSignature']
  ) => {
    doc.setDrawColor(203, 213, 225);
    doc.rect(x, y, sigBoxW, sigBoxH, 'S');
    doc.setFillColor(241, 245, 249);
    doc.rect(x, y, sigBoxW, 6, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(51, 65, 85);
    doc.text(roleHeading, x + 3, y + 4.2);

    if (sig.signatureDataUrl && sig.signatureDataUrl.startsWith('data:image/')) {
      try {
        doc.addImage(sig.signatureDataUrl, 'PNG', x + 4, y + 7.5, 44, 13);
      } catch {
        // Ignore image decode error
      }
    }

    doc.setDrawColor(226, 232, 240);
    doc.line(x + 3, y + 21.5, x + sigBoxW - 3, y + 21.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(sig.signerName || 'Unsigned', x + 3, y + 25.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `${sig.signerTitle || '—'}${sig.licenseId ? `  ·  ID: ${sig.licenseId}` : ''}`,
      x + 3,
      y + 29.3
    );
    doc.setFont('courier', 'normal');
    doc.setFontSize(6.5);
    doc.text(
      `Digitally signed (${sig.method}): ${sig.signedAt ? sig.signedAt.replace('T', ' ').slice(0, 19) + ' UTC' : 'Pending'}`,
      x + 3,
      y + 32.5
    );
  };

  drawSignatureBox(margin, 'CALIBRATED BY (METROLOGY TECHNICIAN)', cert.technicianSignature);
  drawSignatureBox(
    margin + sigBoxW + 6,
    'REVIEWED & APPROVED BY (QUALITY ENGINEER)',
    cert.approverSignature
  );

  y += sigBoxH + 4;

  // Cryptographic SHA-256 Digest Bar
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(margin, y, contentW, 9.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(71, 85, 105);
  doc.text('SHA-256 CERTIFICATE INTEGRITY DIGEST:', margin + 3, y + 4);
  doc.setFont('courier', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(29, 78, 216);
  doc.text(cert.verificationHash || 'PENDING', margin + 3, y + 7.8);

  drawFooter();

  const safeFilename = `${cert.certificateNumber || 'Calibration-Certificate'}_${cert.assetSnapshot.assetId || 'Asset'}.pdf`.replace(
    /[^a-zA-Z0-9._-]/g,
    '_'
  );
  doc.save(safeFilename);
}
