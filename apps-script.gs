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

// ── 路由 ────────────────────────────────────────
function doGet(e) {
  if (e.parameter.token !== API_TOKEN) return jsonErr('unauthorized');
  try {
    switch (e.parameter.action) {
      case 'getCatalog':   return jsonOk(getCatalog());
      case 'getSales':     return jsonOk(getSales(e));
      case 'getCustomers': return jsonOk(getCustomers());
      default: return jsonErr('unknown action');
    }
  } catch (err) { return jsonErr(err.message); }
}

function doPost(e) {
  if (e.parameter.token !== API_TOKEN) return jsonErr('unauthorized');
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

// ══════════════════════════════════════════════════
//  一次性 seed：把器材報價單.pdf 的資料灌進表
//  在 Apps Script 編輯器選函式手動執行。可重跑（會先清空再寫）。
// ══════════════════════════════════════════════════

// 器材目錄（第1頁 + 第5頁月熊那份完整品項）
// 欄位：id, 品名, 分類, 定價(訂價), 成本(報價), 一般售價, 安信大家庭, 備註
function seedCatalog() {
  const data = [
    ['mat-nbr10-black','10mm加厚輕量NBR瑜伽墊(送收納袋+背帶)-黑','瑜伽墊',299,260,270,260,''],
    ['ball-cork85','軟木8.5cm 筋膜球','按摩放鬆',399,265,350,280,''],
    ['ball-cork-peanut','特殊錐形軟木花生球','按摩放鬆',399,295,350,300,''],
    ['ball-silicone62','紓壓按摩球 矽膠6.2cm','按摩放鬆',299,190,260,200,''],
    ['ball-suction','吸附式按摩球-圓形 藍','按摩放鬆',299,195,260,240,''],
    ['roller-yoga','瑜珈柱按摩滾筒(贈收納帆布袋)','按摩放鬆',599,445,530,490,''],
    ['wheel-foot','鑽石款腳底按摩輪','按摩放鬆',389,285,340,300,''],
    ['brick-eva50','高密度EVA瑜珈磚 50D 7.5cm','瑜珈磚',180,135,150,150,'顏色:百搭灰/湖綠/迷霧'],
    ['brick-cork70','軟木高密度瑜珈磚 70D','瑜珈磚',399,290,350,300,''],
    ['kb-4','軟式壺鈴4kg','壺鈴/藥球',599,450,499,470,''],
    ['kb-5','軟式壺鈴5kg','壺鈴/藥球',699,490,599,550,''],
    ['kb-6','軟式壺鈴6kg','壺鈴/藥球',799,590,699,650,''],
    ['kb-8','軟式壺鈴8kg','壺鈴/藥球',899,688,799,750,''],
    ['kb-10','軟式壺鈴10kg','壺鈴/藥球',999,790,899,850,''],
    ['medball-2','軟式藥球2kg','壺鈴/藥球',790,660,690,680,''],
    ['pad-balance','平衡墊(充氣)','配件',439,320,380,350,'顏色:湖水綠'],
    ['board-haipis','Haipis/輕量斜板3件組','配件',399,299,350,300,''],
    ['stand-phone','懸臂懶人伸縮平板/手機支架','配件',699,525,600,550,''],
    ['ball-yoga-m','防爆瑜珈球-M','球類',649,480,570,520,''],
    ['ring-latex5','乳膠彈力圈5入','配件',399,295,350,300,''],
    ['ball-25','25cm小球','球類',149,105,130,120,''],
    ['plate-10','拉力片10lb','配件',99,75,90,90,''],
    ['plate-15','拉力片15lb','配件',139,105,130,120,''],
    ['plate-20','拉力片20lb','配件',169,129,150,140,''],
    ['plate-25','拉力片25lb','配件',199,149,170,160,''],
    ['step-rhythm','韻律踏板','踏板',1880,1500,1700,1600,''],
    ['step-nbr90','NBR 90*1cm 踏板','踏板','',600,800,700,'定價待補'],
    ['mat-lotus80','【LOTUS】台灣製雙面壓紋NBR瑜珈墊15mm 加寬80cm','瑜伽墊',1790,1380,1550,1430,''],
    ['mat-lotus61','【LOTUS】台灣製雙面壓紋NBR瑜珈墊15mm 61cm','瑜伽墊',1479,1030,1290,1180,''],
    ['mat-decathlon','迪卡儂-軟墊','其他','','',499,'','外購轉售']
  ];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.catalog);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(SHEETS.catalog);
  sheet.appendRow(HEADERS.catalog);
  sheet.getRange(1, 1, 1, HEADERS.catalog.length).setFontWeight('bold');
  sheet.getRange(2, 1, data.length, HEADERS.catalog.length).setValues(data);
  return '已灌入 ' + data.length + ' 項器材';
}

// 歷史銷售（已核對金額對得起來的 7 位客戶；月熊/順哥/Chris 待你確認後再補）
// 每筆：[sale_id, customer, note, [品名, 數量, 單價]...]
function seedSales() {
  const sales = [
    ['s-jiakai','家愷','安信大家庭價，整單收$3,890',[
      ['軟式壺鈴6kg',1,650],['軟式壺鈴8kg',1,750],['吸附式按摩球-圓形 藍',1,240],
      ['平衡墊(充氣)',1,350],['高密度EVA瑜珈磚 50D 7.5cm',2,150],['韻律踏板',1,1600]]],
    ['s-erge','二哥','',[['特殊錐形軟木花生球',1,300]]],
    ['s-sophy','Sophy','一般售價，整單收$1,798',[
      ['高密度EVA瑜珈磚 50D 7.5cm',2,150],['軟式壺鈴5kg',1,599],['軟式壺鈴10kg',1,899]]],
    ['s-sophy1','Sophy','',[['Haipis/輕量斜板3件組',1,350]]],
    ['s-chris1','Chris','特價',[['防爆瑜珈球-M',1,510]]],
    ['s-jessica','Jessica','小計$1,069，實收$1,060',[['防爆瑜珈球-M',1,570],['迪卡儂-軟墊',1,499]]],
    ['s-jiefu','姐夫','小計$1,069，實收$1,060',[['防爆瑜珈球-M',1,570],['軟式壺鈴4kg',1,499]]]
  ];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.sales);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(SHEETS.sales);
  sheet.appendRow(HEADERS.sales);
  sheet.getRange(1, 1, 1, HEADERS.sales.length).setFontWeight('bold');
  const out = [];
  sales.forEach(s => {
    const [saleId, customer, note, lines] = s;
    lines.forEach(ln => {
      const [item, qty, up] = ln;
      out.push([saleId, '', customer, item, qty, up, qty * up, note, '']);
    });
  });
  sheet.getRange(2, 1, out.length, HEADERS.sales.length).setValues(out);
  return '已灌入 ' + out.length + ' 列（7 位客戶）';
}

function seedAll() { return seedCatalog() + ' / ' + seedSales(); }
