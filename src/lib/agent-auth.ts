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
// Promise をメモ化（同時リクエストでもクライアント生成は一度だけ）
let idClient: Promise<IdTokenClient> | null = null;

export async function agentAuthHeader(agentUrl: string): Promise<string | null> {
  if (!agentUrl.startsWith('https://')) return null; // ローカル開発（http://localhost:8080）
  try {
    idClient ??= auth.getIdTokenClient(agentUrl);
    // IdTokenClient はトークンをキャッシュし期限前に自動更新する（毎回の発行コスト無し）
    const headers = await (await idClient).getRequestHeaders();
    return headers.get('authorization');
  } catch (e) {
    idClient = null; // 失敗した Promise を掴み続けない（次回リクエストで再試行）
    console.warn('agent-auth: IDトークン取得に失敗（未認証で続行）:', e instanceof Error ? e.message : e);
    return null;
  }
}
