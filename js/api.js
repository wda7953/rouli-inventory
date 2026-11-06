// 部署 Apps Script 後，把 Web App 網址填進來
const API_URL = 'https://script.google.com/macros/s/AKfycbxooYU3y5ogMBBGpoelXYWohPkTocmcrsvxMhWeLfysrQjP5B9Hr88Mjwi904IKBrI/exec';

// 共享密鑰：擋隨機機器人用（必須跟後端 apps-script.gs 的 API_TOKEN 一致）
// ⚠️ 真正的門鎖是下面的「使用者密碼」——存在後端 Script Properties，不在這份公開原始碼裡
const API_TOKEN = 'rouli7g3k9m2x5';
const PW_KEY = 'rouli_pw';

function getPw() { return localStorage.getItem(PW_KEY) || ''; }
function setPw(v) { localStorage.setItem(PW_KEY, v); }
function clearPw() { localStorage.removeItem(PW_KEY); }

async function apiGet(action, params = {}) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', API_TOKEN);
  url.searchParams.set('pw', getPw());
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetchWithTimeout(url.toString());
  const data = await res.json();
  if (data && (data.error === 'bad_password' || data.error === 'no_password_set')) { clearPw(); location.reload(); }
  return data;
}

async function apiPost(action, data) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', API_TOKEN);
  url.searchParams.set('pw', getPw());
  const res = await fetchWithTimeout(url.toString(), { method: 'POST', body: JSON.stringify(data) });
  return res.json();
}

// GAS 冷啟動常 1~3 秒，偶爾卡住；加逾時避免畫面乾等
async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// 向後端驗證密碼
async function verifyPw(pw) {
  const url = new URL(API_URL);
  url.searchParams.set('action', 'login');
  url.searchParams.set('token', API_TOKEN);
  url.searchParams.set('pw', pw);
  try {
    const r = await (await fetchWithTimeout(url.toString())).json();
    return r.ok ? { ok: true } : { ok: false, error: r.error || 'bad_password' };
  } catch (e) { return { ok: false, error: 'network' }; }
}

// 每頁載入資料前先呼叫：已存正確密碼→直接過；否則跳鎖畫面
function ensureAuth() {
  return new Promise(async (resolve) => {
    const pw = getPw();
    if (pw) { const r = await verifyPw(pw); if (r.ok) { resolve(); return; } }
    showLock(resolve);
  });
}

function showLock(resolve) {
  if (document.getElementById('lockScreen')) return;
  const box = document.createElement('div');
  box.id = 'lockScreen';
  box.className = 'lock';
  box.innerHTML = `
    <div class="lock-card">
      <div class="lock-brand">柔力 ROULI</div>
      <div class="lock-title">柔力進銷存</div>
      <div class="lock-sub">請輸入密碼</div>
      <input class="lock-input" id="lockPw" type="password" inputmode="text" autocomplete="off" placeholder="密碼">
      <button class="lock-btn" id="lockBtn">進入</button>
      <div class="lock-err" id="lockErr"></div>
    </div>`;
  document.body.appendChild(box);
  const input = box.querySelector('#lockPw');
  const btn = box.querySelector('#lockBtn');
  const err = box.querySelector('#lockErr');
  input.focus();
  async function tryLogin() {
    const pw = input.value.trim();
    if (!pw) return;
    btn.disabled = true; btn.textContent = '驗證中…'; err.textContent = '';
    const r = await verifyPw(pw);
    if (r.ok) { setPw(pw); box.remove(); resolve(); return; }
    btn.disabled = false; btn.textContent = '進入';
    err.textContent = r.error === 'no_password_set' ? '後端尚未設定密碼（請在 Apps Script 設 APP_PASSWORD）'
      : r.error === 'network' ? '連線逾時，請重試'
      : '密碼錯誤';
    input.select();
  }
  btn.addEventListener('click', tryLogin);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
}

function logout() { clearPw(); location.reload(); }

function genClientId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

const CACHE_PREFIX = 'rouli_cache_';
function cacheGet(key) {
  try { const v = localStorage.getItem(CACHE_PREFIX + key); return v ? JSON.parse(v) : null; }
  catch (e) { return null; }
}
function cacheSet(key, data) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data)); } catch (e) {}
}

function money(n) { return '$' + (Number(n) || 0).toLocaleString('en-US'); }

window.API = { apiGet, apiPost, ensureAuth, logout, genClientId, cacheGet, cacheSet, money, API_URL };
