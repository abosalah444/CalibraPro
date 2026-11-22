import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  FileSpreadsheet,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { CalibrationUser } from '../types/calibration';
import { ExcelBulkUploadModal } from './ExcelBulkUploadModal';

interface PersonnelViewProps {
  users: CalibrationUser[];
  onCreate: (user: CalibrationUser) => Promise<void>;
  onUpdate: (user: CalibrationUser) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onBulkReplace: (users: CalibrationUser[]) => void;
}

const EMPTY_USER: Omit<CalibrationUser, 'id'> = {
  fullName: '',
  title: '',
  licenseId: '',
  department: '',
  email: '',
  active: true,
};

export const PersonnelView: React.FC<PersonnelViewProps> = ({
  users,
  onCreate,
  onUpdate,
  onDelete,
  onBulkReplace,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>(
    'ALL'
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<CalibrationUser, 'id'>>(EMPTY_USER);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter === 'ACTIVE' && !u.active) return false;
      if (statusFilter === 'INACTIVE' && u.active) return false;
      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.title.toLowerCase().includes(q) ||
        u.licenseId.toLowerCase().includes(q) ||
        (u.department || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
      );
    });
  }, [users, search, statusFilter]);

  const activeCount = useMemo(
    () => users.filter((u) => u.active).length,
    [users]
  );

  const openCreateModal = () => {
    setEditingId(null);
    setForm({ ...EMPTY_USER });
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openEditModal = (user: CalibrationUser) => {
    setEditingId(user.id);
    setForm({
      fullName: user.fullName,
      title: user.title,
      licenseId: user.licenseId,
      department: user.department || '',
      email: user.email || '',
      active: user.active,
    });
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim()) {
      setErrorMsg('Full Name is required.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      if (editingId) {
        await onUpdate({ ...form, id: editingId });
      } else {
        await onCreate({ ...form, id: `usr-${Date.now()}` });
      }
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save user.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Calibration & Approval Personnel Directory
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Shared personnel list available in both the Calibrated By and Approved By dropdown menus in Certificate Studio.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setBulkModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="h-4 w-4 text-blue-700" />
            Import Excel
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            Add User
          </button>
        </div>
      </div>

      {bulkNotice && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
            <span>{bulkNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setBulkNotice(null)}
            className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Summary Strip */}
      <div className="grid grid-cols-1 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-3">
          <div className="text-xs text-slate-500">Total Personnel</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {users.length}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-xs text-slate-500">Active Signers</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {activeCount}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-xs text-slate-500">Inactive Signers</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-600 tabular-nums">
            {users.length - activeCount}
          </div>
        </div>
      </div>

      {/* Table */}
      <section className="rounded-md border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
            {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st === 'ALL' ? 'All Users' : st === 'ACTIVE' ? 'Active' : 'Inactive'}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, role, ID, or department..."
              className="w-full rounded border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-50 text-[11px] text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-2.5 font-semibold">Full Name</th>
                <th className="px-4 py-2.5 font-semibold">Role / Title</th>
                <th className="px-4 py-2.5 font-semibold">License / Staff ID</th>
                <th className="px-4 py-2.5 font-semibold">Department</th>
                <th className="px-4 py-2.5 font-semibold">Email</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No personnel match your filter. Add a user or import from Excel.
                  </td>
                </tr>
              ) : (
                filtered.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2.5 font-semibold text-slate-900 whitespace-nowrap">
                      {user.fullName}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{user.title || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-800 whitespace-nowrap">
                      {user.licenseId || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {user.department || '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600">
                      {user.email || '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {user.active ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                          <span aria-hidden="true" className="text-[10px]">
                            ●
                          </span>
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-500">
                          <span aria-hidden="true" className="text-[10px]">
                            ○
                          </span>
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(user)}
                          aria-label={`Edit ${user.fullName}`}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-700 cursor-pointer"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(user.id)}
                          aria-label={`Delete ${user.fullName}`}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-rose-700 cursor-pointer"
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

      {/* Add/Edit User Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-md border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h2 className="font-display text-base font-bold text-slate-900">
                {editingId ? 'Edit User' : 'Add Calibration / Approval User'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-5 text-xs">
              {errorMsg && (
                <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
                  {errorMsg}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Full Name *
                  </label>
                  <input
                    required
                    type="text"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    placeholder="e.g. Omar Farouk"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    License / Staff ID
                  </label>
                  <input
                    type="text"
                    value={form.licenseId}
                    onChange={(e) => setForm({ ...form, licenseId: e.target.value })}
                    placeholder="e.g. MET-5120"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-medium text-slate-700">
                  Role / Title
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Instrumentation Engineer"
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Department
                  </label>
                  <input
                    type="text"
                    value={form.department}
                    onChange={(e) =>
                      setForm({ ...form, department: e.target.value })
                    }
                    placeholder="e.g. Calibration Lab"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    Email
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="user@company.com"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700"
                />
                <span>Active (available in Calibrated By & Approved By dropdowns)</span>
              </label>

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Saving...' : editingId ? 'Save User' : 'Add User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {bulkModalOpen && (
        <ExcelBulkUploadModal
          target="users"
          existingUsers={users}
          onClose={() => setBulkModalOpen(false)}
          onImportSuccess={(summary) => {
            if (summary.users) {
              onBulkReplace(summary.users);
            }
            setBulkNotice(
              `Excel import complete: ${summary.addedCount} added, ${summary.updatedCount} updated, ${summary.skippedCount} skipped.`
            );
            setBulkModalOpen(false);
          }}
        />
      )}
    </div>
  );
};
