import React from 'react';

export type AppView = 'studio' | 'standards' | 'plant' | 'archive' | 'users';

interface TopBarProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  onNewCertificate: () => void;
}

const NAV_ITEMS: Array<{ id: AppView; label: string }> = [
  { id: 'studio', label: 'Certificate Studio' },
  { id: 'standards', label: 'Calibration Standards' },
  { id: 'plant', label: 'Plant Assets' },
  { id: 'archive', label: 'Certificate Archive' },
  { id: 'users', label: 'Personnel' },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeView,
  onSelectView,
  onNewCertificate,
}) => {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-6 py-3.5">
        <button
          type="button"
          onClick={() => onSelectView('studio')}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
        >
          CalibraPro
        </button>

        <nav
          aria-label="Primary"
          className="flex items-center gap-6 overflow-x-auto"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                className={`relative py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 ${
                  isActive
                    ? 'text-blue-700'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[15px] h-0.5 bg-blue-700"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={onNewCertificate}
            className="rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            New Certificate
          </button>
        </div>
      </div>
    </header>
  );
};
