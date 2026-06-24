// Firebase クライアント初期化（IRダッシュボード認証 / #46 1-2d）。
// firebaseConfig の値はすべて公開クライアント設定（apiKey はプロジェクト識別子であり
// 秘密ではない。アクセス制御は Firebase Auth とサーバ側のクレーム検証で行う）。
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyCA7L6pGMtNtVUi9PyQDbfhayusgGGZWw0',
  authDomain: 'hallowed-trail-462613-v1.firebaseapp.com',
  projectId: 'hallowed-trail-462613-v1',
  appId: '1:255752121803:web:1d12595dc3bc56555a1a4e',
  messagingSenderId: '255752121803',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
