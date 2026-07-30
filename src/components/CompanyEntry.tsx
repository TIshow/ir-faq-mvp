'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCompanyById, companyShortName, type Company } from '@/config/companies';
import { readLastCompany } from '@/lib/last-company';

/**
 * トップ（`/`）の入口まわりで、ブラウザにしか無い情報だけを扱う小さなクライアント部品。
 *
 *  1. `?c=<id>` 付きで来たら `/c/<ticker>/` へ送り直す（旧いディープリンクの互換）
 *  2. 前回選んだ銘柄を「続きから」として出す
 *
 * 銘柄一覧そのものはサーバーで描画する（クローラーが全銘柄URLをたどれるようにするため）。
 */
export function CompanyEntry() {
  const router = useRouter();
  const [last, setLast] = useState<Company | null>(null);

  useEffect(() => {
    try {
      // 旧: `/?c=harux` は「トップでその銘柄を選んだ状態」だった。
      // いまは対話が銘柄URLで起きるので、そのURLへ送り直す。
      const fromUrl = getCompanyById(new URLSearchParams(window.location.search).get('c') ?? '');
      if (fromUrl?.isActive && fromUrl.ticker) {
        router.replace(`/c/${fromUrl.ticker}/`);
        return;
      }
      const saved = readLastCompany();
      if (saved?.ticker) setLast(saved);
    } catch {
      /* private mode 等は無視（「続きから」が出ないだけ） */
    }
  }, [router]);

  if (!last?.ticker) return null;

  return (
    <Link
      href={`/c/${last.ticker}/`}
      className="animate-pop-in mt-5 inline-flex items-center gap-2 self-start rounded-full bg-ink px-4 py-2 text-[12.5px] font-bold text-cream shadow-e2 transition hover:-translate-y-px"
    >
      {`続きから：${companyShortName(last.name)} →`}
    </Link>
  );
}
