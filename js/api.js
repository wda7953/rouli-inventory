// 部署 Apps Script 後，把 Web App 網址填進來
const API_URL = 'PASTE_WEB_APP_URL_HERE';

// 共享密鑰：必須跟後端 apps-script.gs 的 API_TOKEN 一模一樣
const API_TOKEN = 'rouli7g3k9m2x5';

async function apiGet(action, params = {}) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', API_TOKEN);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetchWithTimeout(url.toString());
  return res.json();
}

async function apiPost(action, data) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', API_TOKEN);
  const res = await fetchWithTimeout(url.toString(), { method: 'POST', body: JSON.stringify(data) });
  return res.json();
}

// GAS 冷啟動常 1~3 秒，偶爾卡住；加逾時避免畫面乾等
async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally { clearTimeout(t); }
}

function genClientId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

// 讀取快取（stale-while-revalidate）：先秀上次資料，背景再抓最新
const CACHE_PREFIX = 'rouli_cache_';
function cacheGet(key) {
  try { const v = localStorage.getItem(CACHE_PREFIX + key); return v ? JSON.parse(v) : null; }
  catch (e) { return null; }
}
function cacheSet(key, data) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data)); } catch (e) {}
}

function money(n) {
  const v = Number(n) || 0;
  return '$' + v.toLocaleString('en-US');
}

window.API = { apiGet, apiPost, genClientId, cacheGet, cacheSet, money, API_URL };
