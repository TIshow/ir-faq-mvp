'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useCompany } from '@/contexts/CompanyContext';
import { Company, companyShortName } from '@/config/companies';

// 銘柄ごとのモノグラム配色（ポップな塗りつぶしスクエア）
const MONO = [
  'bg-coral text-white',
  'bg-pop text-white',
  'bg-sun text-ink',
  'bg-ink text-cream',
  'bg-pop-soft text-ink',
];

export const CompanyPicker: React.FC = () => {
  const { selectedCompany, setSelectedCompany, companies } = useCompany();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  const colorOf = (c: Company) => {
    const i = companies.findIndex((x) => x.id === c.id);
    return MONO[(i < 0 ? 0 : i) % MONO.length];
  };

  const Monogram = ({ c, size }: { c: Company; size: string }) => (
    <span className={`font-round grid ${size} shrink-0 place-items-center rounded-lg font-black ${colorOf(c)}`}>
      {companyShortName(c.name).charAt(0)}
    </span>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="group flex items-center gap-2.5 rounded-full bg-paper py-1.5 pl-2 pr-3 text-left shadow-[0_4px_14px_rgba(38,35,29,0.08)] transition hover:shadow-[0_6px_20px_rgba(38,35,29,0.12)]"
      >
        {selectedCompany ? (
          <>
            <Monogram c={selectedCompany} size="h-7 w-7 text-xs" />
            <span className="min-w-0">
              <span className="block max-w-[9rem] truncate text-sm font-bold leading-tight text-ink">
                {companyShortName(selectedCompany.name)}
              </span>
              <span className="font-num block text-[11px] font-semibold leading-tight text-mute">
                {selectedCompany.ticker}
              </span>
            </span>
          </>
        ) : (
          <span className="px-1 text-sm font-bold text-ink-soft">銘柄を選択</span>
        )}
        <svg
          className={`h-4 w-4 text-mute transition group-hover:text-ink ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.73a.75.75 0 111.06 1.06l-4.24 4.26a.75.75 0 01-1.06 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[19rem] overflow-hidden rounded-3xl border border-line bg-paper shadow-[0_18px_48px_rgba(38,35,29,0.16)]">
          <div className="font-round px-4 pb-1.5 pt-3.5 text-[11px] font-black tracking-wider text-mute">
            銘柄を選択
          </div>
          <ul className="p-1.5" role="listbox">
            {companies.map((c) => {
              const sel = selectedCompany?.id === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={sel}
                    onClick={() => { setSelectedCompany(c); setOpen(false); }}
                    className={`flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition ${sel ? 'bg-cream' : 'hover:bg-cream/60'}`}
                  >
                    <Monogram c={c} size="h-9 w-9 text-sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink">{companyShortName(c.name)}</span>
                      <span className="block truncate text-xs text-mute">{c.sector}</span>
                    </span>
                    <span className="font-num rounded-md bg-cream px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft">
                      {c.ticker}
                    </span>
                    {sel && (
                      <svg className="h-4 w-4 text-pop" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
