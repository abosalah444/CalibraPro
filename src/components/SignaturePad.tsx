import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Eraser, PenTool, Type, UserPlus } from 'lucide-react';
import type { CalibrationUser, DigitalSignature } from '../types/calibration';
import { generateTypedSignatureDataUrl } from '../utils/calibrationMath';

interface SignaturePadProps {
  roleLabel: string;
  value: DigitalSignature;
  onChange: (next: DigitalSignature) => void;
  users?: CalibrationUser[];
  onCreateUser?: (user: CalibrationUser) => Promise<void>;
}

export const SignaturePad: React.FC<SignaturePadProps> = ({
  roleLabel,
  value,
  onChange,
  users = [],
  onCreateUser,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newLicense, setNewLicense] = useState('');
  const [addingUser, setAddingUser] = useState(false);

  const activeUsers = useMemo(
    () => users.filter((u) => u.active !== false),
    [users]
  );

  const selectedUserId = useMemo(() => {
    const match = activeUsers.find(
      (u) =>
        u.fullName.trim().toLowerCase() === value.signerName.trim().toLowerCase() &&
        (u.licenseId || '').trim().toLowerCase() ===
          (value.licenseId || '').trim().toLowerCase()
    );
    return match ? match.id : '';
  }, [activeUsers, value.signerName, value.licenseId]);

  const applyUserToSignature = (user: CalibrationUser) => {
    const nextUrl =
      value.method === 'typed'
        ? generateTypedSignatureDataUrl(user.fullName)
        : value.signatureDataUrl;
    onChange({
      ...value,
      signerName: user.fullName,
      signerTitle: user.title,
      licenseId: user.licenseId,
      signatureDataUrl: nextUrl,
      signedAt: new Date().toISOString(),
    });
  };

  const handleQuickAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !onCreateUser) return;
    setAddingUser(true);
    try {
      const created: CalibrationUser = {
        id: `usr-${Date.now()}`,
        fullName: newName.trim(),
        title: newTitle.trim() || 'Instrumentation Personnel',
        licenseId: newLicense.trim(),
        department: '',
        email: '',
        active: true,
      };
      await onCreateUser(created);
      applyUserToSignature(created);
      setNewName('');
      setNewTitle('');
      setNewLicense('');
      setQuickAddOpen(false);
    } finally {
      setAddingUser(false);
    }
  };

  // Sync typed signature preview if method is 'typed' and name changes
  useEffect(() => {
    if (value.method === 'typed' && value.signerName.trim()) {
      const dataUrl = generateTypedSignatureDataUrl(value.signerName);
      if (dataUrl && dataUrl !== value.signatureDataUrl) {
        onChange({
          ...value,
          signatureDataUrl: dataUrl,
          signedAt: value.signedAt || new Date().toISOString(),
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.method, value.signerName]);

  const getPointerCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (value.method !== 'drawn') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.setPointerCapture(e.pointerId);
    const { x, y } = getPointerCoords(e);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || value.method !== 'drawn') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPointerCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    if (!isDrawing || value.method !== 'drawn') return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange({
      ...value,
      signatureDataUrl: canvas.toDataURL('image/png'),
      signedAt: new Date().toISOString(),
    });
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    onChange({
      ...value,
      signatureDataUrl: '',
      signedAt: '',
    });
  };

  const switchMethod = (method: 'drawn' | 'typed') => {
    if (method === 'typed') {
      const url = value.signerName.trim()
        ? generateTypedSignatureDataUrl(value.signerName)
        : '';
      onChange({
        ...value,
        method: 'typed',
        signatureDataUrl: url,
        signedAt: url ? new Date().toISOString() : '',
      });
    } else {
      onChange({
        ...value,
        method: 'drawn',
        signatureDataUrl: '',
        signedAt: '',
      });
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-900">{roleLabel}</span>
        <div className="flex items-center gap-1 rounded border border-slate-200 bg-slate-50 p-0.5">
          <button
            type="button"
            onClick={() => switchMethod('drawn')}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
              value.method === 'drawn'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <PenTool className="h-3 w-3" />
            Draw
          </button>
          <button
            type="button"
            onClick={() => switchMethod('typed')}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
              value.method === 'typed'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Type className="h-3 w-3" />
            Type
          </button>
        </div>
      </div>

      {/* Shared Personnel Dropdown & Quick Add */}
      <div className="mb-3 rounded border border-slate-200 bg-slate-50/70 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-[11px] font-semibold text-slate-700">
            Select User from Directory
          </label>
          {onCreateUser && (
            <button
              type="button"
              onClick={() => setQuickAddOpen((prev) => !prev)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-800 cursor-pointer"
            >
              <UserPlus className="h-3 w-3" />
              {quickAddOpen ? 'Close' : 'Add New User'}
            </button>
          )}
        </div>
        <select
          value={selectedUserId}
          onChange={(e) => {
            const chosen = activeUsers.find((u) => u.id === e.target.value);
            if (chosen) applyUserToSignature(chosen);
          }}
          className="mt-1.5 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
        >
          <option value="">
            {activeUsers.length === 0
              ? 'No users in directory — add one below'
              : '— Select personnel (or enter manually below) —'}
          </option>
          {activeUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
              {u.title ? ` — ${u.title}` : ''}
              {u.licenseId ? ` (${u.licenseId})` : ''}
            </option>
          ))}
        </select>

        {quickAddOpen && onCreateUser && (
          <form
            onSubmit={handleQuickAddSubmit}
            className="mt-2.5 grid grid-cols-1 gap-2 border-t border-slate-200 pt-2.5 sm:grid-cols-12"
          >
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Full Name *"
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs sm:col-span-4"
            />
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Role / Title"
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs sm:col-span-4"
            />
            <input
              type="text"
              value={newLicense}
              onChange={(e) => setNewLicense(e.target.value)}
              placeholder="Staff / ID"
              className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs sm:col-span-2"
            />
            <button
              type="submit"
              disabled={addingUser}
              className="rounded bg-blue-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer sm:col-span-2"
            >
              {addingUser ? '...' : 'Save'}
            </button>
          </form>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-600">
            Full Name
          </label>
          <input
            type="text"
            value={value.signerName}
            onChange={(e) =>
              onChange({
                ...value,
                signerName: e.target.value,
                signedAt: new Date().toISOString(),
              })
            }
            placeholder="e.g. Marcus Vance"
            className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-600">
            Role / Title
          </label>
          <input
            type="text"
            value={value.signerTitle}
            onChange={(e) => onChange({ ...value, signerTitle: e.target.value })}
            placeholder="e.g. Metrology Engineer"
            className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-600">
            License / Staff ID
          </label>
          <input
            type="text"
            value={value.licenseId}
            onChange={(e) => onChange({ ...value, licenseId: e.target.value })}
            placeholder="e.g. MET-4491"
            className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
          <span>
            {value.method === 'drawn'
              ? 'Sign inside the pad below with mouse or touch'
              : 'Auto-generated cryptographic cursive signature'}
          </span>
          {value.method === 'drawn' && (
            <button
              type="button"
              onClick={clearCanvas}
              className="inline-flex items-center gap-1 text-slate-600 hover:text-rose-700 cursor-pointer"
            >
              <Eraser className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>

        {value.method === 'drawn' ? (
          <div className="relative overflow-hidden rounded border border-dashed border-slate-300 bg-slate-50">
            <canvas
              ref={canvasRef}
              width={480}
              height={140}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className="h-24 w-full touch-none cursor-crosshair"
            />
            {!value.signatureDataUrl && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400">
                Draw digital signature here
              </span>
            )}
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50 px-3">
            {value.signatureDataUrl ? (
              <img
                src={value.signatureDataUrl}
                alt={`${value.signerName} digital signature`}
                className="h-20 max-w-full object-contain"
              />
            ) : (
              <span className="text-xs text-slate-400">
                Enter full name above to generate digital signature
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
        <span>
          Timestamp:{' '}
          {value.signedAt
            ? `${value.signedAt.replace('T', ' ').slice(0, 19)} UTC`
            : 'Unsigned'}
        </span>
        <span>
          {value.signatureDataUrl ? '● Signed' : '○ Pending'}
        </span>
      </div>
    </div>
  );
};
