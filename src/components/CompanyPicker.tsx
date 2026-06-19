'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useCompany } from '@/contexts/CompanyContext';
import { Company, companyShortName } from '@/config/companies';

// 銘柄ごとのモノグラム配色（株アプリ風のアバター）
const MONO = [
  'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  'bg-rose-500/15 text-rose-300 ring-rose-500/30',
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
    <span className={`grid ${size} shrink-0 place-items-center rounded-lg font-bold ring-1 ${colorOf(c)}`}>
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
        className="group flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/70 py-1.5 pl-2 pr-2.5 text-left transition hover:border-zinc-700 hover:bg-zinc-800/70"
      >
        {selectedCompany ? (
          <>
            <Monogram c={selectedCompany} size="h-7 w-7 text-xs" />
            <span className="min-w-0">
              <span className="block max-w-[9rem] truncate text-sm font-semibold leading-tight text-zinc-100">
                {companyShortName(selectedCompany.name)}
              </span>
              <span className="block font-mono text-[11px] leading-tight text-zinc-500">
                {selectedCompany.ticker}
              </span>
            </span>
          </>
        ) : (
          <span className="px-1 text-sm font-medium text-zinc-400">銘柄を選択</span>
        )}
        <svg
          className={`h-4 w-4 text-zinc-500 transition group-hover:text-zinc-300 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.73a.75.75 0 111.06 1.06l-4.24 4.26a.75.75 0 01-1.06 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[19rem] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/95 shadow-2xl shadow-black/60 backdrop-blur">
          <div className="px-3 pt-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
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
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${sel ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'}`}
                  >
                    <Monogram c={c} size="h-9 w-9 text-sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-zinc-100">{companyShortName(c.name)}</span>
                      <span className="block truncate text-xs text-zinc-500">{c.sector}</span>
                    </span>
                    <span className="rounded-md bg-zinc-950 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400 ring-1 ring-zinc-800">
                      {c.ticker}
                    </span>
                    {sel && (
                      <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
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
