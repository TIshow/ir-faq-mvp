/**
 * 「前回みていた銘柄」の記憶（ブラウザのみ）。
 *
 * トップ（`/`）の「続きから」だけに使う。**保存するのは企業IDだけ**で、
 * 会話の本文や質問は一切保存しない（CLAUDE.md のプライバシー設計）。
 *
 * キーの文字列をここ1箇所に閉じ込める。以前は Context と入口の2箇所に散っており、
 * 書く側が消えたことに気づけず「続きから」が出なくなっていた。
 */
import { getCompanyById, type Company } from '@/config/companies';

const KEY = 'selectedCompanyId';

/** 銘柄URLを開いたときに覚える。private mode 等で失敗しても無視してよい。 */
export function rememberCompany(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* 保存できないだけ。「続きから」が出なくなるが機能に影響はない */
  }
}

/** 前回みていた有効な企業。無い/無効なら null。 */
export function readLastCompany(): Company | null {
  try {
    const found = getCompanyById(localStorage.getItem(KEY) ?? '');
    return found?.isActive ? found : null;
  } catch {
    return null;
  }
}
