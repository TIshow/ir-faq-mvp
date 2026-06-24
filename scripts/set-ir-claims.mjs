#!/usr/bin/env node
// IRダッシュボードのユーザー作成＋カスタムクレーム付与（#46 1-2d 運用）。
// ADC（gcloud auth application-default login / オーナー権限）で実行する。
//
// 使い方:
//   node scripts/set-ir-claims.mjs --email owner@example.com --password 'pw' --admin
//   node scripts/set-ir-claims.mjs --email ir@harux.co.jp  --password 'pw' --company 7561
//
// admin=true     … 全社アクセス（オーナー）
// company=<tic>  … その発行体のみ（IR担当）

import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const PROJECT = 'hallowed-trail-462613-v1';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(`--${name}`);

const email = arg('email');
const password = arg('password');
const company = arg('company');
const admin = has('admin');

if (!email || (!company && !admin)) {
  console.error('必須: --email と (--company <ticker> | --admin)');
  process.exit(1);
}

const app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT });
const auth = getAuth(app);

let user;
try {
  user = await auth.getUserByEmail(email);
  if (password) await auth.updateUser(user.uid, { password });
  console.log(`既存ユーザー: ${email} (${user.uid})`);
} catch {
  if (!password) {
    console.error('新規作成には --password が必要です');
    process.exit(1);
  }
  user = await auth.createUser({ email, password });
  console.log(`新規作成: ${email} (${user.uid})`);
}

const claims = admin ? { admin: true } : { company };
await auth.setCustomUserClaims(user.uid, claims);
console.log('クレーム付与:', JSON.stringify(claims));
console.log('完了。次回ログインのトークンから有効になります。');
