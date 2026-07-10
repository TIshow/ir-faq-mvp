/**
 * ir-agent（Cloud Run・非公開）呼び出し用のIDトークン取得。（#88）
 *
 * - 本番（Cloud Run）: メタデータサーバ経由で audience=AGENT_URL のIDトークンを取得し、
 *   Authorization: Bearer を返す。エージェント側は IAM（run.invoker）で検証する。
 * - ローカル開発（AGENT_URL が localhost 等 http://）: 認証不要なのでスキップ（null）。
 * - 取得失敗時も null を返して呼び出しは続行する（エージェントが公開中の移行期間や
 *   ローカルADCの差異でチャット全体を落とさない。非公開化後は 403 になり 502 として表面化）。
 */
import { GoogleAuth, IdTokenClient } from 'google-auth-library';

const auth = new GoogleAuth();
let idClient: IdTokenClient | null = null;

export async function agentAuthHeader(agentUrl: string): Promise<string | null> {
  if (!agentUrl.startsWith('https://')) return null; // ローカル開発（http://localhost:8080）
  try {
    // IdTokenClient はトークンをキャッシュし期限前に自動更新する（毎回の発行コスト無し）
    idClient ??= await auth.getIdTokenClient(agentUrl);
    const headers = await idClient.getRequestHeaders();
    // google-auth-library のバージョン差異（v9=plain object / v10=Headers）を吸収
    if (headers instanceof Headers) return headers.get('authorization');
    const h = headers as Record<string, string>;
    return h.Authorization ?? h.authorization ?? null;
  } catch (e) {
    console.warn('agent-auth: IDトークン取得に失敗（未認証で続行）:', e instanceof Error ? e.message : e);
    return null;
  }
}
