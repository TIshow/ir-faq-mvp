'use client';

import { useEffect } from 'react';
import { rememberCompany } from '@/lib/last-company';

/**
 * 銘柄URL（`/c/<ticker>`）を開いたことを覚えるだけの部品。
 * トップの「続きから」がこれを読む。描画するものは無い。
 */
export function RememberCompany({ companyId }: { companyId: string }) {
  useEffect(() => {
    rememberCompany(companyId);
  }, [companyId]);
  return null;
}
