'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { NaruhodoMark } from '@/components/BrandLogo';

/** IRダッシュボードのログイン（#46 1-2d・最小: メール＋パスワード）。 */
export default function IrLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.replace('/ir/');
    } catch {
      setError('メールアドレスまたはパスワードが正しくありません。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 text-ink">
      <div className="rounded-3xl bg-paper p-8 shadow-e3">
        <div className="flex items-center gap-3">
          <NaruhodoMark height={34} />
          <h1 className="font-round text-lg font-black leading-tight text-ink">IRダッシュボード</h1>
        </div>
        <p className="mt-2 text-sm font-medium text-ink-soft">
          IR担当者向け。メールアドレスでログインしてください。
        </p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="メールアドレス"
            className="w-full rounded-xl bg-cream px-4 py-2.5 text-sm font-medium text-ink placeholder:text-mute focus:outline-none focus:ring-2 focus:ring-pop/40"
          />
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="パスワード"
            className="w-full rounded-xl bg-cream px-4 py-2.5 text-sm font-medium text-ink placeholder:text-mute focus:outline-none focus:ring-2 focus:ring-pop/40"
          />
          {error && <p className="text-xs font-bold text-coral-deep">{error}</p>}
          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full rounded-full bg-pop px-4 py-2.5 text-sm font-bold text-white transition hover:bg-pop-deep disabled:cursor-not-allowed disabled:bg-line disabled:text-mute"
          >
            {loading ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  );
}
