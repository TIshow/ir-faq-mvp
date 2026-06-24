// GCP プロジェクトID の単一の出所（env で上書き可能）。
// サーバ側コードはこの定数を参照し、プロジェクトIDの直書き分散を防ぐ。
export const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID ?? 'hallowed-trail-462613-v1';
