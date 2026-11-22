import { useCallback, useEffect, useState } from 'react';
import { CalibrationStandardsView } from './components/CalibrationStandardsView';
import { CertificateArchiveView } from './components/CertificateArchiveView';
import { CertificateStudio } from './components/CertificateStudio';
import { PersonnelView } from './components/PersonnelView';
import { PlantEquipmentView } from './components/PlantEquipmentView';
import { type AppView, TopBar } from './components/TopBar';
import type {
  CalibrationCertificate,
  CalibrationDatabasePayload,
  CalibrationEquipment,
  CalibrationUser,
  LabSettings,
  PlantEquipment,
} from './types/calibration';

const DEFAULT_LAB_SETTINGS: LabSettings = {
  laboratoryName: 'Amerya LPG Instrumentation Calibration LAB',
  accreditationNumber: '',
  facilityAddress: '',
  defaultProcedure: 'SOP-CAL-INST-014 Rev 4.2',
  defaultAmbientTempC: '21.5',
  defaultHumidityPct: '44.0',
  defaultPressureHpa: '1013.2',
};

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('studio');
  const [standards, setStandards] = useState<CalibrationEquipment[]>([]);
  const [plantEquipment, setPlantEquipment] = useState<PlantEquipment[]>([]);
  const [certificates, setCertificates] = useState<CalibrationCertificate[]>([]);
  const [users, setUsers] = useState<CalibrationUser[]>([]);
  const [labSettings, setLabSettings] = useState<LabSettings>(DEFAULT_LAB_SETTINGS);
  const [selectedPlantId, setSelectedPlantId] = useState<string>('');
  const [studioKey, setStudioKey] = useState(0);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchBootstrap = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/bootstrap');
      if (!res.ok) {
        throw new Error(`Failed to load calibration database (${res.status})`);
      }
      const data = (await res.json()) as CalibrationDatabasePayload;
      setStandards(data.standards || []);
      setPlantEquipment(data.plantEquipment || []);
      setCertificates(data.certificates || []);
      setUsers(data.users || []);
      setLabSettings(data.labSettings || DEFAULT_LAB_SETTINGS);
      setSelectedPlantId((prev) => prev || data.plantEquipment?.[0]?.id || '');
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Unable to connect to calibration database.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBootstrap();
  }, [fetchBootstrap]);

  // Standards CRUD
  const handleCreateStandard = async (
    item: CalibrationEquipment
  ): Promise<CalibrationEquipment> => {
    const res = await fetch('/api/standards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to add calibration standard.');
    }
    const created = (await res.json()) as CalibrationEquipment;
    setStandards((prev) => [created, ...prev]);
    return created;
  };

  const handleUpdateStandard = async (item: CalibrationEquipment) => {
    const res = await fetch(`/api/standards/${encodeURIComponent(item.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update calibration standard.');
    }
    const updated = (await res.json()) as CalibrationEquipment;
    setStandards((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleDeleteStandard = async (id: string) => {
    const res = await fetch(`/api/standards/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setStandards((prev) => prev.filter((s) => s.id !== id));
    }
  };

  const handleUploadStandardCertFile = async (
    standardId: string,
    file: File
  ): Promise<CalibrationEquipment> => {
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to read selected file.'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read selected file.'));
      reader.readAsDataURL(file);
    });

    const res = await fetch(
      `/api/standards/${encodeURIComponent(standardId)}/certificate-file`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : ''),
          dataBase64,
        }),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to upload certificate file.');
    }
    const updated = (await res.json()) as CalibrationEquipment;
    setStandards((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    return updated;
  };

  const handleDeleteStandardCertFile = async (standardId: string): Promise<void> => {
    const res = await fetch(
      `/api/standards/${encodeURIComponent(standardId)}/certificate-file`,
      { method: 'DELETE' }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete certificate file.');
    }
    const updated = (await res.json()) as CalibrationEquipment;
    setStandards((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  // Plant Equipment CRUD
  const handleCreatePlant = async (item: PlantEquipment): Promise<PlantEquipment> => {
    const res = await fetch('/api/plant-equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to add plant equipment.');
    }
    const created = (await res.json()) as PlantEquipment;
    setPlantEquipment((prev) => [created, ...prev]);
    return created;
  };

  const handleUpdatePlant = async (item: PlantEquipment): Promise<PlantEquipment> => {
    const res = await fetch(`/api/plant-equipment/${encodeURIComponent(item.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update plant equipment.');
    }
    const updated = (await res.json()) as PlantEquipment;
    setPlantEquipment((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    return updated;
  };

  const handleSaveImportedPlant = async (
    candidate: PlantEquipment,
    existingId?: string
  ): Promise<PlantEquipment> => {
    if (existingId) {
      return handleUpdatePlant({ ...candidate, id: existingId });
    }
    return handleCreatePlant(candidate);
  };

  const handleDeletePlant = async (id: string) => {
    const res = await fetch(`/api/plant-equipment/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setPlantEquipment((prev) => prev.filter((p) => p.id !== id));
    }
  };

  // Certificates CRUD
  const handleIssueCertificate = async (cert: CalibrationCertificate) => {
    const res = await fetch('/api/certificates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cert),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to issue calibration certificate.');
    }
    const result = (await res.json()) as {
      certificate: CalibrationCertificate;
      updatedPlantEquipment: PlantEquipment | null;
    };
    setCertificates((prev) => [result.certificate, ...prev]);
    if (result.updatedPlantEquipment) {
      setPlantEquipment((prev) =>
        prev.map((p) =>
          p.id === result.updatedPlantEquipment!.id ? result.updatedPlantEquipment! : p
        )
      );
    }
  };

  const handleDeleteCertificate = async (id: string) => {
    const res = await fetch(`/api/certificates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setCertificates((prev) => prev.filter((c) => c.id !== id));
    }
  };

  // Shared Personnel / Users CRUD
  const handleCreateUser = async (user: CalibrationUser) => {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to add user.');
    }
    const created = (await res.json()) as CalibrationUser;
    setUsers((prev) => [created, ...prev]);
  };

  const handleUpdateUser = async (user: CalibrationUser) => {
    const res = await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update user.');
    }
    const updated = (await res.json()) as CalibrationUser;
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
  };

  const handleDeleteUser = async (id: string) => {
    const res = await fetch(`/api/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setUsers((prev) => prev.filter((u) => u.id !== id));
    }
  };

  const handleNewCertificate = () => {
    setStudioKey((k) => k + 1);
    setActiveView('studio');
  };

  const handleCalibrateAsset = (plantId: string) => {
    setSelectedPlantId(plantId);
    setStudioKey((k) => k + 1);
    setActiveView('studio');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <TopBar
        activeView={activeView}
        onSelectView={setActiveView}
        onNewCertificate={handleNewCertificate}
      />

      {loading ? (
        <main className="mx-auto max-w-[1440px] px-6 py-8">
          <div className="space-y-4">
            <div className="h-24 animate-pulse rounded-md border border-slate-200 bg-white" />
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div className="h-96 animate-pulse rounded-md border border-slate-200 bg-white" />
              <div className="h-96 animate-pulse rounded-md border border-slate-200 bg-white" />
            </div>
          </div>
        </main>
      ) : loadError ? (
        <main className="mx-auto max-w-[1440px] px-6 py-10">
          <div className="rounded-md border border-rose-200 bg-white p-6">
            <h2 className="font-display text-base font-bold text-rose-800">
              Database Connection Error
            </h2>
            <p className="mt-1 text-sm text-slate-600">{loadError}</p>
            <button
              type="button"
              onClick={fetchBootstrap}
              className="mt-4 rounded bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        </main>
      ) : (
        <main>
          {activeView === 'studio' && (
            <CertificateStudio
              key={studioKey}
              standards={standards}
              plantEquipment={plantEquipment}
              users={users}
              labSettings={labSettings}
              nextCertSeq={certificates.length}
              selectedPlantId={selectedPlantId}
              onSelectPlantId={setSelectedPlantId}
              onIssueCertificate={handleIssueCertificate}
              onCreateUser={handleCreateUser}
              onSaveImportedPlant={handleSaveImportedPlant}
              onOpenPlantView={() => setActiveView('plant')}
            />
          )}

          {activeView === 'standards' && (
            <CalibrationStandardsView
              standards={standards}
              onCreate={handleCreateStandard}
              onUpdate={handleUpdateStandard}
              onDelete={handleDeleteStandard}
              onBulkReplace={setStandards}
              onUploadCertFile={handleUploadStandardCertFile}
              onDeleteCertFile={handleDeleteStandardCertFile}
            />
          )}

          {activeView === 'plant' && (
            <PlantEquipmentView
              plantEquipment={plantEquipment}
              onCreate={async (item) => {
                await handleCreatePlant(item);
              }}
              onUpdate={async (item) => {
                await handleUpdatePlant(item);
              }}
              onDelete={handleDeletePlant}
              onBulkReplace={setPlantEquipment}
              onCalibrateAsset={handleCalibrateAsset}
            />
          )}

          {activeView === 'archive' && (
            <CertificateArchiveView
              certificates={certificates}
              onDelete={handleDeleteCertificate}
            />
          )}

          {activeView === 'users' && (
            <PersonnelView
              users={users}
              onCreate={handleCreateUser}
              onUpdate={handleUpdateUser}
              onDelete={handleDeleteUser}
              onBulkReplace={setUsers}
            />
          )}
        </main>
      )}
    </div>
  );
}
