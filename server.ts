import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import type {
  CalibrationCertificate,
  CalibrationDatabasePayload,
  CalibrationEquipment,
  CalibrationUser,
  LabSettings,
  PlantEquipment,
} from './src/types/calibration.ts';
import { initialSeedDatabase } from './server/seedData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'calibration_db.json');
const STANDARD_CERTS_DIR = path.join(DATA_DIR, 'standard_certificates');

const ALLOWED_CERT_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_CERT_FILE_BYTES = 15 * 1024 * 1024;

function ensureStandardCertsDir(): void {
  if (!fs.existsSync(STANDARD_CERTS_DIR)) {
    fs.mkdirSync(STANDARD_CERTS_DIR, { recursive: true });
  }
}

function removeStoredCertFile(storedName?: string | null): void {
  if (!storedName) return;
  const safeName = path.basename(storedName);
  const fullPath = path.join(STANDARD_CERTS_DIR, safeName);
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
    } catch {
      // Ignore cleanup errors if file was already removed
    }
  }
}

function ensureDbExists(): CalibrationDatabasePayload {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(initialSeedDatabase, null, 2), 'utf-8');
    return structuredClone(initialSeedDatabase);
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as CalibrationDatabasePayload;
    return {
      standards: Array.isArray(parsed.standards) ? parsed.standards : initialSeedDatabase.standards,
      plantEquipment: Array.isArray(parsed.plantEquipment) ? parsed.plantEquipment : initialSeedDatabase.plantEquipment,
      certificates: Array.isArray(parsed.certificates) ? parsed.certificates : initialSeedDatabase.certificates,
      users: Array.isArray(parsed.users) ? parsed.users : initialSeedDatabase.users,
      labSettings: parsed.labSettings || initialSeedDatabase.labSettings,
    };
  } catch {
    fs.writeFileSync(DB_FILE, JSON.stringify(initialSeedDatabase, null, 2), 'utf-8');
    return structuredClone(initialSeedDatabase);
  }
}

function saveDb(db: CalibrationDatabasePayload): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DB_FILE);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // Bootstrap full calibration database
  app.get('/api/bootstrap', (_req, res) => {
    const db = ensureDbExists();
    res.json(db);
  });

  // Update Lab Settings
  app.put('/api/lab-settings', (req, res) => {
    const db = ensureDbExists();
    const updated: LabSettings = {
      ...db.labSettings,
      ...req.body,
    };
    db.labSettings = updated;
    saveDb(db);
    res.json(updated);
  });

  // Calibration Standards CRUD
  app.post('/api/standards', (req, res) => {
    const db = ensureDbExists();
    const item = req.body as CalibrationEquipment;
    if (!item || !item.standardCode || !item.name) {
      res.status(400).json({ error: 'Standard code and name are required.' });
      return;
    }
    const newItem: CalibrationEquipment = {
      ...item,
      id: item.id || `std-${Date.now()}`,
    };
    db.standards.unshift(newItem);
    saveDb(db);
    res.status(201).json(newItem);
  });

  app.put('/api/standards/:id', (req, res) => {
    const db = ensureDbExists();
    const { id } = req.params;
    const idx = db.standards.findIndex((s) => s.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Calibration standard not found.' });
      return;
    }
    const updated: CalibrationEquipment = {
      ...db.standards[idx],
      ...req.body,
      id,
    };
    db.standards[idx] = updated;
    saveDb(db);
    res.json(updated);
  });

  app.delete('/api/standards/:id', (req, res) => {
    const db = ensureDbExists();
    const { id } = req.params;
    const existing = db.standards.find((s) => s.id === id);
    if (existing?.certificateFile?.storedName) {
      removeStoredCertFile(existing.certificateFile.storedName);
    }
    db.standards = db.standards.filter((s) => s.id !== id);
    saveDb(db);
    res.json({ ok: true });
  });

  app.post('/api/standards/:id/certificate-file', (req, res) => {
    const db = ensureDbExists();
    const { id } = req.params;
    const idx = db.standards.findIndex((s) => s.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Calibration standard not found.' });
      return;
    }

    const body = req.body as {
      fileName?: string;
      mimeType?: string;
      dataBase64?: string;
    };

    const rawMime = (body?.mimeType || '').toLowerCase().trim();
    const ext = ALLOWED_CERT_MIME_TYPES[rawMime];
    if (!ext) {
      res.status(400).json({
        error: 'Unsupported file type. Please upload a PDF or image file (PNG, JPG, WEBP, GIF).',
      });
      return;
    }

    const rawBase64 = (body?.dataBase64 || '').trim();
    if (!rawBase64) {
      res.status(400).json({ error: 'File content is empty.' });
      return;
    }

    const base64Payload = rawBase64.includes(',')
      ? rawBase64.slice(rawBase64.indexOf(',') + 1)
      : rawBase64;
    const buffer = Buffer.from(base64Payload, 'base64');

    if (buffer.length === 0) {
      res.status(400).json({ error: 'Uploaded file is empty or invalid.' });
      return;
    }
    if (buffer.length > MAX_CERT_FILE_BYTES) {
      res.status(413).json({ error: 'File exceeds the 15 MB maximum upload limit.' });
      return;
    }

    ensureStandardCertsDir();

    // Remove previous file on disk if replacing
    const prevFile = db.standards[idx].certificateFile;
    if (prevFile?.storedName) {
      removeStoredCertFile(prevFile.storedName);
    }

    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const storedName = `${safeId}-${Date.now()}.${ext}`;
    const targetPath = path.join(STANDARD_CERTS_DIR, storedName);
    fs.writeFileSync(targetPath, buffer);

    const originalName = path.basename(body?.fileName || `certificate.${ext}`);
    const normalizedMime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
    const uploadedAt = new Date().toISOString();

    const updatedStandard: CalibrationEquipment = {
      ...db.standards[idx],
      certificateFile: {
        fileName: originalName,
        storedName,
        mimeType: normalizedMime,
        sizeBytes: buffer.length,
        uploadedAt,
        url: `/api/standards/${encodeURIComponent(id)}/certificate-file?v=${Date.now()}`,
      },
    };

    db.standards[idx] = updatedStandard;
    saveDb(db);
    res.json(updatedStandard);
  });

  app.get('/api/standards/:id/certificate-file', (req, res) => {
    const db = ensureDbExists();
    const { id } = req.params;
    const std = db.standards.find((s) => s.id === id);
    if (!std || !std.certificateFile?.storedName) {
      res.status(404).json({ error: 'Certificate file not found for this standard.' });
      return;
    }

    const safeName = path.basename(std.certificateFile.storedName);
    const filePath = path.join(STANDARD_CERTS_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Stored certificate file is missing on disk.' });
      return;
    }

    const isDownload = req.query.download === '1';
    const safeDownloadName = (std.certificateFile.fileName || safeName).replace(/["\r\n]/g, '_');
    res.setHeader('Content-Type', std.certificateFile.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${isDownload ? 'attachment' : 'inline'}; filename="${safeDownloadName}"`
    );
    res.sendFile(filePath);
  });

  app.delete('/api/standards/:id/certificate-file', (req, res) => {
    const db = ensureDbExists();
    const { id } = req.params;
    const idx = db.standards.findIndex((s) => s.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Calibration standard not found.' });
      return;
    }

    if (db.standards[idx].certificateFile?.storedName) {
      removeStoredCertFile(db.standards[idx].certificateFile.storedName);
    }

    const updated: CalibrationEquipment = {
      ...db.standards[idx],
      certificateFile: null,
    };
    db.standards[idx] = updated;
    saveDb(db);
    res.json(updated);
  });

  app.post('/api/standards/bulk', (req, res) => {
    const db = ensureDbExists();
    const body = req.body as {
      items?: CalibrationEquipment[];
      mode?: 'skip' | 'upsert';
    };
    const items = Array.isArray(body?.items) ? body.items : [];
    const mode = body?.mode === 'skip' ? 'skip' : 'upsert';

    if (items.length === 0) {
      res.status(400).json({ error: 'No calibration equipment rows provided.' });
      return;
    }

    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    items.forEach((raw, idx) => {
      const code = (raw.standardCode || '').trim();
      const name = (raw.name || '').trim();
      if (!code || !name) {
        errors.push(`Row ${idx + 1}: Standard Code and Instrument Name are required.`);
        skippedCount += 1;
        return;
      }

      const existingIdx = db.standards.findIndex(
        (s) => s.standardCode.trim().toLowerCase() === code.toLowerCase()
      );

      if (existingIdx !== -1) {
        if (mode === 'upsert') {
          db.standards[existingIdx] = {
            ...db.standards[existingIdx],
            ...raw,
            id: db.standards[existingIdx].id,
            standardCode: code,
            name,
          };
          updatedCount += 1;
        } else {
          skippedCount += 1;
        }
      } else {
        db.standards.unshift({
          ...raw,
          id: raw.id || `std-${Date.now()}-${idx}`,
          standardCode: code,
          name,
        });
        addedCount += 1;
      }
    });

    saveDb(db);
    res.status(201).json({
      addedCount,
      updatedCount,
      skippedCount,
      errors,
      standards: db.standards,
    });
  });

  // Plant Equipment CRUD
  app.post('/api/plant-equipment', (req, res) => {
    const db = ensureDbExists();
    const item = req.body as PlantEquipment;
    if (!item || !item.assetId || !item.tagName) {
      res.status(400).json({ error: 'Unique Asset ID and Tag Name are required.' });
      return;
    }
    const duplicate = db.plantEquipment.some(
      (p) => p.assetId.toLowerCase() === item.assetId.trim().toLowerCase()
    );
    if (duplicate) {
      res.status(409).json({ error: `Asset ID "${item.assetId}" already exists.` });
      return;
    }
    const newItem: PlantEquipment = {
      ...item,
      id: item.id || `plt-${Date.now()}`,
    };
    db.plantEquipment.unshift(newItem);
    saveDb(db);
    res.status(201).json(newItem);
  });

  app.put('/api/plant-equipment/:id', (req, res) => {
    const db = ensureDbExists();
    const { id } = req.params;
    const idx = db.plantEquipment.findIndex((p) => p.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Plant equipment not found.' });
      return;
    }
    const updated: PlantEquipment = {
      ...db.plantEquipment[idx],
      ...req.body,
      id,
    };
    db.plantEquipment[idx] = updated;
    saveDb(db);
    res.json(updated);
  });

  app.delete('/api/plant-equipment/:id', (req, res) => {
    const db = ensureDbExists();
    const { id } = req.params;
    db.plantEquipment = db.plantEquipment.filter((p) => p.id !== id);
    saveDb(db);
    res.json({ ok: true });
  });

  app.post('/api/plant-equipment/bulk', (req, res) => {
    const db = ensureDbExists();
    const body = req.body as {
      items?: PlantEquipment[];
      mode?: 'skip' | 'upsert';
    };
    const items = Array.isArray(body?.items) ? body.items : [];
    const mode = body?.mode === 'skip' ? 'skip' : 'upsert';

    if (items.length === 0) {
      res.status(400).json({ error: 'No plant equipment rows provided.' });
      return;
    }

    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    items.forEach((raw, idx) => {
      const assetId = (raw.assetId || '').trim();
      const tagName = (raw.tagName || '').trim();
      if (!assetId || !tagName) {
        errors.push(`Row ${idx + 1}: Unique Asset ID and Tag Name are required.`);
        skippedCount += 1;
        return;
      }

      const existingIdx = db.plantEquipment.findIndex(
        (p) => p.assetId.trim().toLowerCase() === assetId.toLowerCase()
      );

      if (existingIdx !== -1) {
        if (mode === 'upsert') {
          db.plantEquipment[existingIdx] = {
            ...db.plantEquipment[existingIdx],
            ...raw,
            id: db.plantEquipment[existingIdx].id,
            assetId,
            tagName,
          };
          updatedCount += 1;
        } else {
          skippedCount += 1;
        }
      } else {
        db.plantEquipment.unshift({
          ...raw,
          id: raw.id || `plt-${Date.now()}-${idx}`,
          assetId,
          tagName,
        });
        addedCount += 1;
      }
    });

    saveDb(db);
    res.status(201).json({
      addedCount,
      updatedCount,
      skippedCount,
      errors,
      plantEquipment: db.plantEquipment,
    });
  });

  // Issue & Persist Calibration Certificate (automatically updates Plant Equipment calibration dates & status)
  app.post('/api/certificates', (req, res) => {
    const db = ensureDbExists();
    const cert = req.body as CalibrationCertificate;
    if (!cert || !cert.certificateNumber || !cert.assetId) {
      res.status(400).json({ error: 'Certificate number and Asset ID are required.' });
      return;
    }

    const newCert: CalibrationCertificate = {
      ...cert,
      id: cert.id || `cert-${Date.now()}`,
      createdAt: cert.createdAt || new Date().toISOString(),
    };

    db.certificates.unshift(newCert);

    // Sync calibration dates & status onto the calibrated plant equipment record
    const plantIdx = db.plantEquipment.findIndex(
      (p) => p.id === newCert.plantEquipmentId || p.assetId === newCert.assetId
    );
    if (plantIdx !== -1) {
      const targetPlant = db.plantEquipment[plantIdx];
      db.plantEquipment[plantIdx] = {
        ...targetPlant,
        lastCalibrationDate: newCert.calibrationDate,
        nextDueDate: newCert.nextDueDate,
        status: newCert.overallResult === 'FAIL' ? 'Out of Tolerance' : 'In Tolerance',
      };
    }

    saveDb(db);
    res.status(201).json({
      certificate: newCert,
      updatedPlantEquipment: plantIdx !== -1 ? db.plantEquipment[plantIdx] : null,
    });
  });

  app.delete('/api/certificates/:id', (req, res) => {
    const db = ensureDbExists();
    const { id } = req.params;
    db.certificates = db.certificates.filter((c) => c.id !== id);
    saveDb(db);
    res.json({ ok: true });
  });

  // Shared Personnel / Users CRUD & Bulk Upload
  app.post('/api/users', (req, res) => {
    const db = ensureDbExists();
    const item = req.body as CalibrationUser;
    if (!item || !item.fullName || !item.fullName.trim()) {
      res.status(400).json({ error: 'Full Name is required.' });
      return;
    }
    const newUser: CalibrationUser = {
      id: item.id || `usr-${Date.now()}`,
      fullName: item.fullName.trim(),
      title: (item.title || '').trim(),
      licenseId: (item.licenseId || '').trim(),
      department: (item.department || '').trim(),
      email: (item.email || '').trim(),
      active: item.active !== false,
    };
    db.users.unshift(newUser);
    saveDb(db);
    res.status(201).json(newUser);
  });

  app.put('/api/users/:id', (req, res) => {
    const db = ensureDbExists();
    const { id } = req.params;
    const idx = db.users.findIndex((u) => u.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    const updated: CalibrationUser = {
      ...db.users[idx],
      ...req.body,
      id,
    };
    db.users[idx] = updated;
    saveDb(db);
    res.json(updated);
  });

  app.delete('/api/users/:id', (req, res) => {
    const db = ensureDbExists();
    const { id } = req.params;
    db.users = db.users.filter((u) => u.id !== id);
    saveDb(db);
    res.json({ ok: true });
  });

  app.post('/api/users/bulk', (req, res) => {
    const db = ensureDbExists();
    const body = req.body as {
      items?: CalibrationUser[];
      mode?: 'skip' | 'upsert';
    };
    const items = Array.isArray(body?.items) ? body.items : [];
    const mode = body?.mode === 'skip' ? 'skip' : 'upsert';

    if (items.length === 0) {
      res.status(400).json({ error: 'No user rows provided.' });
      return;
    }

    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    items.forEach((raw, idx) => {
      const fullName = (raw.fullName || '').trim();
      const licenseId = (raw.licenseId || '').trim();
      if (!fullName) {
        errors.push(`Row ${idx + 1}: Full Name is required.`);
        skippedCount += 1;
        return;
      }

      const existingIdx = db.users.findIndex((u) => {
        if (licenseId && u.licenseId) {
          return u.licenseId.trim().toLowerCase() === licenseId.toLowerCase();
        }
        return u.fullName.trim().toLowerCase() === fullName.toLowerCase();
      });

      if (existingIdx !== -1) {
        if (mode === 'upsert') {
          db.users[existingIdx] = {
            ...db.users[existingIdx],
            ...raw,
            id: db.users[existingIdx].id,
            fullName,
            licenseId,
          };
          updatedCount += 1;
        } else {
          skippedCount += 1;
        }
      } else {
        db.users.unshift({
          id: raw.id || `usr-${Date.now()}-${idx}`,
          fullName,
          title: (raw.title || '').trim(),
          licenseId,
          department: (raw.department || '').trim(),
          email: (raw.email || '').trim(),
          active: raw.active !== false,
        });
        addedCount += 1;
      }
    });

    saveDb(db);
    res.status(201).json({
      addedCount,
      updatedCount,
      skippedCount,
      errors,
      users: db.users,
    });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`CalibraPro server running on http://0.0.0.0:${port}`);
  });
}

startServer();
