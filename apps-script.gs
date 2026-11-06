// 柔力進銷存 PWA - Google Apps Script 後端
// 部署為 Web App（執行身分：我自己；存取權：任何人）。
// 安全靠共享密鑰 token 把關：前端每次呼叫都要帶正確 ?token=，不對就擋。
// ⚠️ 自己資料、低風險的輕量防護；token 寫在公開前端看得到，不放敏感個資。

// ── 共享密鑰（前端 js/api.js 的 API_TOKEN 必須一模一樣）──
const API_TOKEN = 'rouli7g3k9m2x5';

// ── 工作表名稱 ──────────────────────────────────
const SHEETS = {
  catalog: 'catalog',  // 器材目錄
  sales:   'sales'     // 銷售流水帳（一列一品項）
};

// ── 欄位定義（新增欄位一律加在最後，不動既有順序）──
const HEADERS = {
  // id 當主鍵；list=定價(訂價) cost=成本(報價) normal=一般售價 anxin=安信大家庭
  catalog: ['id', 'name', 'category', 'list', 'cost', 'normal', 'anxin', 'note'],
  // sale_id 把同一單的多個品項綁在一起；subtotal=qty*unit_price（實收以單價為準）
  sales:   ['sale_id', 'date', 'customer', 'item', 'qty', 'unit_price', 'subtotal', 'note', 'client_id']
};

// ── 驗證：token（擋機器人）＋ 使用者密碼（真正的門鎖，存 Script Properties，不在前端）──
// 回傳錯誤 response 代表未通過；回傳 null 代表通過。
function checkAuth_(e) {
  if (e.parameter.token !== API_TOKEN) return jsonErr('unauthorized');
  const stored = PropertiesService.getScriptProperties().getProperty('APP_PASSWORD');
  if (!stored) return jsonErr('no_password_set');      // 尚未設密碼 → 提醒去設
  if ((e.parameter.pw || '') !== stored) return jsonErr('bad_password');
  return null;
}

// ── 路由 ────────────────────────────────────────
function doGet(e) {
  const auth = checkAuth_(e); if (auth) return auth;
  try {
    switch (e.parameter.action) {
      case 'login':        return jsonOk({ ok: true });   // 密碼正確即回 ok（給鎖畫面驗證用）
      case 'getCatalog':   return jsonOk(getCatalog());
      case 'getSales':     return jsonOk(getSales(e));
      case 'getCustomers': return jsonOk(getCustomers());
      default: return jsonErr('unknown action');
    }
  } catch (err) { return jsonErr(err.message); }
}

function doPost(e) {
  const auth = checkAuth_(e); if (auth) return auth;
  const data = e.postData ? JSON.parse(e.postData.contents) : {};
  try {
    switch (e.parameter.action) {
      case 'addSale':    return jsonOk(addSale(data));
      case 'deleteSale': return jsonOk(deleteSale(data));
      case 'addItem':    return jsonOk(addItem(data));
      case 'updateItem': return jsonOk(updateItem(data));
      case 'deleteItem': return jsonOk(deleteItem(data));
      default: return jsonErr('unknown action');
    }
  } catch (err) { return jsonErr(err.message); }
}

// ── 器材目錄 ────────────────────────────────────
function getCatalog() {
  const sheet = getOrCreateSheet(SHEETS.catalog, HEADERS.catalog);
  return { items: rowsToObjects(sheet) };
}

function addItem(data) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sheet = getOrCreateSheet(SHEETS.catalog, HEADERS.catalog);
    if (!data.id) data.id = 'i-' + Date.now().toString(36);
    // 同 id 已存在就擋
    const items = rowsToObjects(sheet);
    if (items.some(it => String(it.id) === String(data.id))) throw new Error('id 已存在: ' + data.id);
    sheet.appendRow(HEADERS.catalog.map(h => data[h] !== undefined ? data[h] : ''));
    return { ok: true, id: data.id };
  } finally { lock.releaseLock(); }
}

function updateItem(data) {
  if (!data.id) throw new Error('缺 id');
  const sheet = getOrCreateSheet(SHEETS.catalog, HEADERS.catalog);
  const rows = sheet.getDataRange().getValues();
  const idCol = rows[0].indexOf('id');
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(data.id)) {
      const row = HEADERS.catalog.map((h, j) => data[h] !== undefined ? data[h] : rows[i][j]);
      sheet.getRange(i + 1, 1, 1, HEADERS.catalog.length).setValues([row]);
      return { ok: true };
    }
  }
  throw new Error('找不到 id: ' + data.id);
}

function deleteItem(data) {
  if (!data.id) throw new Error('缺 id');
  const sheet = getOrCreateSheet(SHEETS.catalog, HEADERS.catalog);
  const rows = sheet.getDataRange().getValues();
  const idCol = rows[0].indexOf('id');
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][idCol]) === String(data.id)) { sheet.deleteRow(i + 1); return { ok: true }; }
  }
  throw new Error('找不到 id: ' + data.id);
}

// ── 銷售 ────────────────────────────────────────
// 一張單可含多個品項：前端送 { sale_id, date, customer, note, client_id, lines:[{item,qty,unit_price}] }
function addSale(data) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sheet = getOrCreateSheet(SHEETS.sales, HEADERS.sales);
    // 防重複：client_id 存過就跳過（重試安全）
    if (data.client_id) {
      const rows = sheet.getDataRange().getValues();
      const idCol = rows[0].indexOf('client_id');
      if (idCol !== -1) {
        for (let i = 1; i < rows.length; i++) {
          if (rows[i][idCol] && String(rows[i][idCol]) === String(data.client_id)) return { ok: true, dedup: true };
        }
      }
    }
    const saleId = data.sale_id || ('s-' + Date.now().toString(36));
    const lines = data.lines || [];
    if (!lines.length) throw new Error('沒有品項');
    lines.forEach(ln => {
      const qty = Number(ln.qty) || 1;
      const up = Number(ln.unit_price) || 0;
      sheet.appendRow([saleId, data.date || '', data.customer || '', ln.item || '', qty, up, qty * up, data.note || '', data.client_id || '']);
    });
    return { ok: true, sale_id: saleId };
  } finally { lock.releaseLock(); }
}

// 刪整張單（同 sale_id 的所有列）
function deleteSale(data) {
  if (!data.sale_id) throw new Error('缺 sale_id');
  const sheet = getOrCreateSheet(SHEETS.sales, HEADERS.sales);
  const rows = sheet.getDataRange().getValues();
  const col = rows[0].indexOf('sale_id');
  let n = 0;
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][col]) === String(data.sale_id)) { sheet.deleteRow(i + 1); n++; }
  }
  return { ok: true, deleted: n };
}

function getSales(e) {
  const sheet = getOrCreateSheet(SHEETS.sales, HEADERS.sales);
  let rows = rowsToObjects(sheet);
  if (e.parameter.customer) rows = rows.filter(r => String(r.customer) === String(e.parameter.customer));
  rows.forEach(r => { if (r.date) r.date = fmtDate(toDateObj(r.date)); });
  return { lines: rows };
}

// 各客戶彙總：買幾單、幾項、共收多少、最後一筆日期
function getCustomers() {
  const sheet = getOrCreateSheet(SHEETS.sales, HEADERS.sales);
  const rows = rowsToObjects(sheet);
  const map = {};
  rows.forEach(r => {
    const c = String(r.customer || '').trim(); if (!c) return;
    if (!map[c]) map[c] = { customer: c, total: 0, items: 0, saleIds: {}, lastDate: '' };
    map[c].total += Number(r.subtotal) || 0;
    map[c].items += 1;
    if (r.sale_id) map[c].saleIds[r.sale_id] = 1;
    const d = r.date ? fmtDate(toDateObj(r.date)) : '';
    if (d && d > map[c].lastDate) map[c].lastDate = d;
  });
  const list = Object.values(map).map(m => ({
    customer: m.customer, total: m.total, items: m.items,
    orders: Object.keys(m.saleIds).length, lastDate: m.lastDate
  })).sort((a, b) => b.total - a.total);
  return { customers: list };
}

// ── 工具 ────────────────────────────────────────
function rowsToObjects(sheet) {
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const hdr = rows[0];
  return rows.slice(1).map((row, i) => {
    const obj = { _rowIndex: i + 2 };
    hdr.forEach((h, j) => { obj[h] = row[j]; });
    return obj;
  });
}

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    return sheet;
  }
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const missing = headers.filter(h => existing.indexOf(h) === -1);
  if (missing.length > 0) {
    const startCol = existing.length + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold');
  }
  return sheet;
}

function toDateObj(v) { return v instanceof Date ? v : new Date(v); }
function fmtDate(d) {
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function jsonOk(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function jsonErr(msg) { return ContentService.createTextOutput(JSON.stringify({ error: msg })).setMimeType(ContentService.MimeType.JSON); }

// ── seed（灌入 PDF 真實資料）在獨立的 seed.gs，含客戶名字與成本，不進 git。
//    部署時連 seed.gs 一起貼進 Apps Script，執行 seedCatalog / seedSales 即可。
