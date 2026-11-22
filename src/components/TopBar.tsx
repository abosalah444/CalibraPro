import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  Check,
  ChevronDown,
  FileCheck2,
  Gauge,
  Scale,
  Users,
} from 'lucide-react';

export type AppView = 'studio' | 'standards' | 'plant' | 'archive' | 'users';

interface TopBarProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  onNewCertificate: () => void;
}

const NAV_ITEMS: Array<{
  id: AppView;
  label: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'studio',
    label: 'Certificate Studio',
    description: 'Create, import .txt logs & issue certificates',
    Icon: FileCheck2,
  },
  {
    id: 'standards',
    label: 'Calibration Standards',
    description: 'Reference instruments & traceable certificates',
    Icon: Scale,
  },
  {
    id: 'plant',
    label: 'Plant Assets',
    description: 'Transmitters, switches & calibration schedules',
    Icon: Gauge,
  },
  {
    id: 'archive',
    label: 'Certificate Archive',
    description: 'Issued certificates, audit log & PDF exports',
    Icon: Archive,
  },
  {
    id: 'users',
    label: 'Personnel',
    description: 'Calibrated By & Approved By staff directory',
    Icon: Users,
  },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeView,
  onSelectView,
  onNewCertificate,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeItem =
    NAV_ITEMS.find((item) => item.id === activeView) || NAV_ITEMS[0];
  const ActiveIcon = activeItem.Icon;

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-4 min-w-0">
          <button
            type="button"
            onClick={() => {
              onSelectView('studio');
              setMenuOpen(false);
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
          >
            CalibraPro
          </button>

          <span className="hidden h-5 w-px bg-slate-200 sm:inline-block" />

          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              aria-label="Select workspace section"
              onClick={() => setMenuOpen((prev) => !prev)}
              className="inline-flex items-center gap-2.5 rounded-md border border-slate-300 bg-slate-50 px-3.5 py-2 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <ActiveIcon className="h-4 w-4 text-blue-700 shrink-0" />
              <span>{activeItem.label}</span>
              <ChevronDown
                className={`h-4 w-4 text-slate-500 transition-transform ${
                  menuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {menuOpen && (
              <div
                role="listbox"
                aria-label="Workspace sections"
                className="absolute left-0 mt-1.5 w-80 rounded-md border border-slate-200 bg-white py-1.5 shadow-lg z-40"
              >
                {NAV_ITEMS.map((item) => {
                  const isActive = activeView === item.id;
                  const ItemIcon = item.Icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        onSelectView(item.id);
                        setMenuOpen(false);
                      }}
                      className={`flex w-full items-start justify-between gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-blue-50 text-blue-900'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <ItemIcon
                          className={`mt-0.5 h-4 w-4 shrink-0 ${
                            isActive ? 'text-blue-700' : 'text-slate-400'
                          }`}
                        />
                        <div className="min-w-0">
                          <div
                            className={`text-xs font-semibold ${
                              isActive ? 'text-blue-800' : 'text-slate-900'
                            }`}
                          >
                            {item.label}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {item.description}
                          </div>
                        </div>
                      </div>
                      {isActive && (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onNewCertificate();
            }}
            className="rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            New Certificate
          </button>
        </div>
      </div>
    </header>
  );
};
