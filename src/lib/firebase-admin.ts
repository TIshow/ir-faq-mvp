// Firebase Admin（サーバ側のIDトークン検証 / #46 1-2d）。
// Cloud Run の ADC（実行SA）で自動初期化＝秘密鍵ファイル不要。
// トークンの company / admin カスタムクレームを読み、API側で会社スコープを強制する。
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const PROJECT = 'hallowed-trail-462613-v1';
const app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT });

export interface IrClaims {
  uid: string;
  email?: string;
  company?: string; // 担当発行体のティッカー（IR担当）
  admin?: boolean; // オーナー（全社アクセス）
}

/** Authorization: Bearer <idToken> を検証して claims を返す。失敗時は null。 */
export async function verifyIrToken(authHeader: string | null): Promise<IrClaims | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const d = await getAuth(app).verifyIdToken(authHeader.slice(7));
    return {
      uid: d.uid,
      email: d.email,
      company: typeof d.company === 'string' ? d.company : undefined,
      admin: d.admin === true,
    };
  } catch {
    return null;
  }
}
