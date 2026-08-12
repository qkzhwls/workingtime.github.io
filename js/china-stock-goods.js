// === js/china-stock-goods.js ===
// 중국제작 미발계산기 Ver 5.4 (적재량 개별/구역별 수정)

import { initializeFirebase } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, writeBatch, deleteDoc, onSnapshot, query } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { db } = initializeFirebase();
const CHINA_COLLECTION = 'ChinaStockGoods';
const CONFIG_DOC = 'CONFIG';

// 전역 상태
let orderDataOriginal = [];
let orderDataBuy = [];
let stockLogData = {};
let tableData = [];
let filteredData = [];
let editedCells = {};
let inboundMap = {}; 
let sortConfig = { key: '', direction: 'asc' };
let csvUrlOrder = '';
let csvUrlBuy = '';
let savedDates = []; 
let saveTimeout = null;

// 유틸리티
const cleanKey = (str) => (str || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, '');
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const hasValue = (v) => v !== '' && v !== undefined && v !== null && v !== 0 && v !== '0';

function getProductName(row) { return row['상품명'] || row['공급처상품명'] || ''; }
function formatExcelDate(excelDate) {
    if (!excelDate || excelDate.toString().trim() === '') return '';
    if (typeof excelDate === 'string' && (excelDate.includes('-') || excelDate.includes('.'))) return excelDate;
    const num = parseFloat(excelDate);
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
function normalizeDate(dateStr) {
    if (!dateStr) return '';
    let s = dateStr.toString().trim();
    if (/^\d{4,5}(\.\d+)?$/.test(s)) s = formatExcelDate(parseFloat(s));
    s = s.replace(/\./g, '-').replace(/\//g, '-');
    const parts = s.split('-');
    if (parts.length === 3) {
        let [y, m, d] = parts;
        if (y.length === 2) y = '20' + y;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return s;
}

function showLoading(text) {
    const el = document.getElementById('loading-text'); if (el) el.innerText = text;
    document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }
function showToast(msg) {
    const t = document.getElementById('toast'); if (!t) return;
    t.innerText = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}
// [Ver 5.2] 파일 저장: 지원 브라우저(크롬/엣지)면 저장 대화상자를 '바탕화면'에서 열어 한 번에 저장,
//   미지원(사파리/모바일)이면 기본 다운로드 폴더로 저장
async function downloadToDesktop(filename, blob) {
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                startIn: 'desktop',
                types: [{ description: 'Excel', accept: { 'application/vnd.ms-excel': ['.xls'] } }]
            });
            const w = await handle.createWritable();
            await w.write(blob); await w.close();
            showToast('✅ 저장 완료');
            return;
        } catch (e) {
            if (e && e.name === 'AbortError') return; // 사용자가 취소
            // 그 외 오류 → 기본 다운로드로 폴백
        }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
let zoneCapacity = {}; // [Ver 5.4] 구역(로케이션 앞 한 글자)별 적재량 일괄값 (Firebase 저장)
function getCapacityByLocation(locStr) {
    if (!locStr) return 0;
    if (locStr.includes('★')) return 90;
    const ch = locStr.toString().trim().toUpperCase().charAt(0);
    if (zoneCapacity[ch] !== undefined && zoneCapacity[ch] !== '') return parseInt(zoneCapacity[ch]) || 0; // 구역별 일괄값
    const map = { 'A':20,'B':20,'C':20,'D':20,'E':40,'F':40,'G':40,'H':15,'I':15,'Z':15,'L':15,'O':15,'P':15,'Q':15,'R':15,'S':15,'T':15 };
    return map[ch] || 0;
}

// ---------------------------------------------------------
// [Ver 4.7] 미발수량 공식 (설정에서 편집 가능, Firebase 저장)
//  - 변수: 총재고, 적재량, 부족수량, 직진배송
//  - 잘못된 수식이면 기본 공식으로 폴백 (앱이 깨지지 않음)
// ---------------------------------------------------------
const DEFAULT_MIBAL_FORMULA = '총재고===0 ? 적재량 : (부족수량+직진배송 > 총재고 ? 부족수량+직진배송-총재고 : 0)';
let mibalFormula = DEFAULT_MIBAL_FORMULA;
let mibalFn = null;

function defaultMibal(총재고, 적재량, 부족수량, 직진배송) {
    return (총재고 === 0) ? 적재량 : ((부족수량 + 직진배송 > 총재고) ? (부족수량 + 직진배송 - 총재고) : 0);
}

// 수식 문자열을 함수로 컴파일 (실패 시 null). 테스트 실행으로 숫자 반환 여부 확인.
function compileMibalFormula(expr) {
    try {
        const fn = new Function('총재고', '적재량', '부족수량', '직진배송', 'return (' + expr + ');');
        const t = fn(0, 20, 0, 0);
        if (typeof t !== 'number' || isNaN(t)) return null;
        return fn;
    } catch (e) { return null; }
}

// 실제 계산 (오류 시 기본 공식 폴백 + 0 이상 정수로 보정)
function evalMibal(총재고, 적재량, 부족수량, 직진배송) {
    let v;
    try { if (mibalFn) v = mibalFn(총재고, 적재량, 부족수량, 직진배송); } catch (e) { v = undefined; }
    if (typeof v !== 'number' || isNaN(v)) v = defaultMibal(총재고, 적재량, 부족수량, 직진배송);
    v = Math.round(v);
    return v < 0 ? 0 : v;
}
mibalFn = compileMibalFormula(mibalFormula);

// ---------------------------------------------------------
// UI 제어 함수 (모달 및 메뉴)
// ---------------------------------------------------------
function closeAllMenus() {
    const menu = document.getElementById('main-tools-menu'); if (menu) menu.style.display = 'none';
    const popup = document.getElementById('date-dropdown-popup');
    if (popup && popup.style.display === 'block') {
        popup.style.display = 'none';
        onDatePopupClosed(); // [Ver 3.1] 팝업이 닫히는 시점에 변경된 선택을 한 번만 적용
    }
}

function openSheetSettingsModal() {
    closeAllMenus();
    document.getElementById('modal-csv-order').value = csvUrlOrder;
    document.getElementById('modal-csv-buy').value = csvUrlBuy;
    document.getElementById('sheet-settings-modal').style.display = 'flex';
}

function closeSheetSettingsModal() {
    document.getElementById('sheet-settings-modal').style.display = 'none';
}

// ---------------------------------------------------------
// [Ver 5.1] 미발수량 규칙 설정 모달 (예시 / 규칙 조립 / 직접 입력 3모드)
// ---------------------------------------------------------
let formulaMode = 'example';

function openMibalFormulaModal() {
    closeAllMenus();
    document.getElementById('mibal-formula-input').value = mibalFormula;
    setFormulaMode('example');
    document.getElementById('mibal-formula-modal').style.display = 'flex';
}
function closeMibalFormulaModal() {
    document.getElementById('mibal-formula-modal').style.display = 'none';
}
function setFormulaMode(mode) {
    formulaMode = mode;
    ['example','builder','advanced'].forEach(m => {
        const sec = document.getElementById('fmode-' + m);
        if (sec) sec.style.display = (m === mode) ? 'block' : 'none';
    });
    document.querySelectorAll('.fmode-tab').forEach(t => {
        const on = t.dataset.mode === mode;
        t.style.borderColor = on ? '#1976d2' : '#ccc';
        t.style.background = on ? '#e3f2fd' : '#fff';
        t.style.color = on ? '#0d47a1' : '#555';
    });
    if (mode === 'example') buildExampleRows();
    else if (mode === 'builder') renderRuleRows();
    else if (mode === 'advanced') document.getElementById('mibal-formula-input').value = mibalFormula;
}

// 공통: 규칙(수식) 검증 → Firebase 저장 → 표 즉시 재계산
async function applyAndSaveFormula(expr, okMsg) {
    if (!expr || !compileMibalFormula(expr)) { alert('규칙이 올바르지 않습니다. 다시 확인해 주세요.'); return; }
    mibalFormula = expr;
    mibalFn = compileMibalFormula(expr);
    try {
        await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { mibalFormula, updatedAt: new Date() }, { merge: true });
        closeMibalFormulaModal();
        showToast(okMsg || '✅ 미발수량 규칙 저장됨');
        if (savedDates.length > 0) applyDates();
    } catch (e) { alert('저장 실패: ' + e.message); }
}

// ===== ① 예시 모드 =====
let exampleRows = [
    { s:0, c:20, sh:0, d:0, want:'' },
    { s:5, c:20, sh:0, d:0, want:'' },
    { s:10, c:20, sh:8, d:5, want:'' }
];
function buildExampleRows() {
    const tb = document.getElementById('ex-tbody');
    if (!tb) return;
    const cell = (i,k,v) => `<td><input type="number" class="exi" data-i="${i}" data-k="${k}" value="${v}" style="width:46px; padding:3px;"></td>`;
    tb.innerHTML = exampleRows.map((r,i) => `<tr>
        ${cell(i,'s',r.s)}${cell(i,'c',r.c)}${cell(i,'sh',r.sh)}${cell(i,'d',r.d)}
        <td><input type="number" class="exi" data-i="${i}" data-k="want" value="${r.want}" placeholder="?" style="width:56px; padding:3px; background:#fff3e0; font-weight:bold;"></td>
        <td id="ex-cur-${i}" style="color:#888; font-weight:bold;">-</td>
        <td><button class="exdel" data-i="${i}" style="border:none; background:none; color:#d32f2f; cursor:pointer; font-size:14px;">✕</button></td>
    </tr>`).join('');
    tb.querySelectorAll('input.exi').forEach(inp => inp.oninput = () => {
        const i = +inp.dataset.i, k = inp.dataset.k;
        exampleRows[i][k] = (k === 'want') ? inp.value : (parseInt(inp.value) || 0);
        if (k !== 'want') updateExampleCurrent();
    });
    tb.querySelectorAll('button.exdel').forEach(b => b.onclick = () => { exampleRows.splice(+b.dataset.i, 1); buildExampleRows(); });
    updateExampleCurrent();
}
function updateExampleCurrent() {
    // '지금 결과' = 현재 저장된 규칙(mibalFn)이 내는 값
    exampleRows.forEach((r,i) => {
        const td = document.getElementById('ex-cur-' + i);
        if (td) td.textContent = evalMibal(r.s, r.c, r.sh, r.d);
    });
}
function copyExamples() {
    const lines = exampleRows.map(r => `총재고 ${r.s}, 적재량 ${r.c}, 부족 ${r.sh}, 직진 ${r.d} → 미발수량 ${r.want || '?'}`);
    const text = '[미발수량 예시]\n' + lines.join('\n');
    navigator.clipboard.writeText(text).then(() => showToast('📋 예시 복사됨 (Claude에게 붙여넣으세요)'), () => showToast('복사 실패'));
}
// 예시 → 수식 자동 생성 후 바로 적용
const MIBAL_SUBEXPRS = [
    '0', '적재량', '총재고', '부족수량', '직진배송',
    '부족수량+직진배송', '적재량+부족수량', '적재량+직진배송',
    '적재량-총재고', '부족수량-총재고', '직진배송-총재고', '부족수량+직진배송-총재고',
    'Math.max(적재량-총재고,0)', 'Math.max(부족수량+직진배송-총재고,0)', 'Math.max(부족수량-총재고,0)', 'Math.max(적재량-부족수량,0)'
];
function matchExprAll(expr, pts) {
    const fn = compileMibalFormula(expr);
    if (!fn) return false;
    return pts.every(p => { let v = Math.round(fn(p.s, p.c, p.sh, p.d)); if (v < 0) v = 0; return v === p.y; });
}
function synthMibalFormula(pts) {
    for (const e of MIBAL_SUBEXPRS) if (matchExprAll(e, pts)) return e;
    const g0 = pts.filter(p => p.s === 0), g1 = pts.filter(p => p.s !== 0);
    if (g0.length && g1.length) {
        let A = null, B = null;
        for (const e of MIBAL_SUBEXPRS) if (matchExprAll(e, g0)) { A = e; break; }
        for (const e of MIBAL_SUBEXPRS) if (matchExprAll(e, g1)) { B = e; break; }
        if (A && B) { const f = `총재고===0 ? (${A}) : (${B})`; if (matchExprAll(f, pts)) return f; }
    }
    return null;
}
function applyFromExamples() {
    const pts = exampleRows
        .filter(r => r.want !== '' && r.want !== null && r.want !== undefined && !isNaN(parseInt(r.want)))
        .map(r => ({ s: r.s, c: r.c, sh: r.sh, d: r.d, y: parseInt(r.want) }));
    if (pts.length < 1) { alert('먼저 [원하는 미발수량] 칸을 채워주세요.'); return; }
    const f = synthMibalFormula(pts);
    if (!f) {
        alert('입력한 예시만으로는 규칙을 자동으로 만들지 못했어요.\n\n· 상황이 다른 예시를 더 넣어보세요 (재고 0일 때 / 있을 때 등)\n· 그래도 안 되면 [📋 예시 복사] 후 Claude에게 요청하세요.');
        return;
    }
    const coversBoth = pts.some(p => p.s === 0) && pts.some(p => p.s !== 0);
    applyAndSaveFormula(f, '✨ 예시로 규칙 적용됨' + (coversBoth ? '' : ' (일부 상황 예시 부족)'));
}

// ===== ② 규칙 조립 모드 =====
const RULE_VARS = ['총재고','적재량','부족수량','직진배송','부족수량+직진배송'];
const RULE_OPS = [['=','==='],['≠','!=='],['>','>'],['≥','>='],['<','<'],['≤','<=']];
const RULE_RIGHT = ['0','총재고','적재량','부족수량','직진배송'];
const RULE_RESULTS = [
    ['0 (없음)','0'],['적재량','적재량'],['총재고','총재고'],['부족수량','부족수량'],['직진배송','직진배송'],
    ['부족수량+직진배송','부족수량+직진배송'],['적재량−총재고','적재량-총재고'],['부족수량+직진배송−총재고','부족수량+직진배송-총재고']
];
let ruleRows2 = [
    { L:'총재고', op:'===', R:'0', result:'적재량' },
    { L:'부족수량+직진배송', op:'>', R:'총재고', result:'부족수량+직진배송-총재고' }
];
let ruleElse = '0';
function ruleSelect(cls, i, options, selected) {
    const opts = options.map(o => {
        const label = Array.isArray(o) ? o[0] : o, val = Array.isArray(o) ? o[1] : o;
        return `<option value="${val}" ${val === selected ? 'selected' : ''}>${label}</option>`;
    }).join('');
    return `<select class="${cls}" data-i="${i}" style="padding:5px; border:1px solid #ccc; border-radius:4px; font-size:12px;">${opts}</select>`;
}
function renderRuleRows() {
    const box = document.getElementById('rule-rows');
    if (!box) return;
    box.innerHTML = ruleRows2.map((r,i) => `
      <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap; background:#f5f5f5; padding:8px; border-radius:6px; margin-bottom:6px; font-size:13px; font-weight:bold;">
        <span>만약</span>
        ${ruleSelect('rl-L', i, RULE_VARS, r.L)}
        ${ruleSelect('rl-op', i, RULE_OPS, r.op)}
        ${ruleSelect('rl-R', i, RULE_RIGHT, r.R)}
        <span>이면 → =</span>
        ${ruleSelect('rl-res', i, RULE_RESULTS, r.result)}
        <button class="rl-del" data-i="${i}" style="border:none; background:none; color:#d32f2f; cursor:pointer; font-size:15px; margin-left:auto;">✕</button>
      </div>`).join('');
    const elseSel = document.getElementById('rule-else');
    if (elseSel) elseSel.innerHTML = RULE_RESULTS.map(([label,val]) => `<option value="${val}" ${val === ruleElse ? 'selected' : ''}>${label}</option>`).join('');
    box.querySelectorAll('select').forEach(sel => sel.onchange = () => {
        const i = +sel.dataset.i;
        if (sel.classList.contains('rl-L')) ruleRows2[i].L = sel.value;
        else if (sel.classList.contains('rl-op')) ruleRows2[i].op = sel.value;
        else if (sel.classList.contains('rl-R')) ruleRows2[i].R = sel.value;
        else if (sel.classList.contains('rl-res')) ruleRows2[i].result = sel.value;
        updateRuleCheck();
    });
    box.querySelectorAll('.rl-del').forEach(b => b.onclick = () => { ruleRows2.splice(+b.dataset.i, 1); renderRuleRows(); });
    if (elseSel) elseSel.onchange = () => { ruleElse = elseSel.value; updateRuleCheck(); };
    updateRuleCheck();
}
function buildRuleFormula() {
    let expr = `(${ruleElse})`;
    for (let i = ruleRows2.length - 1; i >= 0; i--) {
        const r = ruleRows2[i];
        expr = `(${r.L} ${r.op} ${r.R}) ? (${r.result}) : ${expr}`;
    }
    return expr;
}
function updateRuleCheck() {
    const el = document.getElementById('rule-check');
    if (!el) return;
    const fn = compileMibalFormula(buildRuleFormula());
    if (!fn) { el.innerHTML = '⚠️ 규칙이 올바르지 않습니다.'; el.style.color = '#d32f2f'; return; }
    const samples = [[0,20,0,0],[10,20,8,5],[50,40,0,0]];
    const parts = samples.map(([s,c,sh,d]) => {
        let v = Math.round(fn(s,c,sh,d)); if (v < 0) v = 0;
        return `재고${s}·적${c}${sh?'·부'+sh:''}${d?'·직'+d:''} → <b style="color:#e65100;">${v}</b>`;
    });
    el.style.color = '#555';
    el.innerHTML = '확인(예시): ' + parts.join(' &nbsp;/&nbsp; ');
}
function applyFromBuilder() { applyAndSaveFormula(buildRuleFormula(), '✔ 규칙 적용됨'); }

// ---------------------------------------------------------
// [Ver 5.4] 적재량 구역별 일괄 설정 모달
// ---------------------------------------------------------
function openZoneCapModal() {
    closeAllMenus();
    buildZoneCapRows();
    document.getElementById('zone-cap-modal').style.display = 'flex';
}
function closeZoneCapModal() { document.getElementById('zone-cap-modal').style.display = 'none'; }
function buildZoneCapRows() {
    const tb = document.getElementById('zone-cap-tbody');
    if (!tb) return;
    const counts = {};
    tableData.forEach(d => { const ch = (d.location || '').trim().charAt(0).toUpperCase(); if (ch) counts[ch] = (counts[ch] || 0) + 1; });
    const zones = new Set(Object.keys(counts));
    Object.keys(zoneCapacity).forEach(z => zones.add(z));
    const list = [...zones].sort();
    if (!list.length) {
        tb.innerHTML = '<tr><td colspan="3" style="padding:20px; color:#888;">표시할 구역이 없습니다.<br>출고일 선택 + 재고로그 업로드 후 이용하세요.</td></tr>';
        return;
    }
    tb.innerHTML = list.map(z => `<tr>
        <td style="font-weight:800; font-size:15px;">${z}</td>
        <td style="color:#888;">${counts[z] || 0}</td>
        <td><input type="number" class="zcap" data-z="${z}" value="${getCapacityByLocation(z)}" style="width:74px; padding:6px; text-align:center;"></td>
    </tr>`).join('');
}
async function saveZoneCap() {
    document.querySelectorAll('.zcap').forEach(inp => {
        const z = inp.dataset.z, v = inp.value.trim();
        if (v === '') delete zoneCapacity[z];
        else zoneCapacity[z] = parseInt(v) || 0;
    });
    try {
        await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { zoneCapacity, updatedAt: new Date() }, { merge: true });
        closeZoneCapModal();
        showToast('✅ 구역별 적재량 저장됨');
        if (savedDates.length > 0) applyDates(); // 표 재계산
    } catch (e) { alert('저장 실패: ' + e.message); }
}

// ===== ③ 직접 입력 모드 =====
function applyFromAdvanced() {
    const expr = document.getElementById('mibal-formula-input').value.trim();
    if (!expr) { alert('수식을 입력하세요.'); return; }
    applyAndSaveFormula(expr, '✅ 미발수량 규칙 저장됨');
}
function resetMibalFormulaInput() {
    document.getElementById('mibal-formula-input').value = DEFAULT_MIBAL_FORMULA;
}

async function saveSheetSettings() {
    csvUrlOrder = document.getElementById('modal-csv-order').value.trim();
    csvUrlBuy = document.getElementById('modal-csv-buy').value.trim();
    await saveConfig();
    closeSheetSettingsModal();
    showToast('✅ CSV 링크 저장 완료');
    syncOrderData();
}

// ---------------------------------------------------------
// 데이터 통신 로직 (Firebase & CSV)
// ---------------------------------------------------------
function loadInboundHistory() {
    const q = query(collection(db, 'ChinaStockGoods_InboundHistory'));
    onSnapshot(q, (snapshot) => {
        inboundMap = {}; 
        snapshot.forEach((doc) => {
            const data = doc.data();
            const code = data.barcode;
            const qty = parseInt(data.qty) || 0;
            if (code) inboundMap[code] = (inboundMap[code] || 0) + qty;
        });
        if (tableData.length > 0) applyDates({ skipSync: true });
    });
}

async function syncOrderData(silent = false) {
    if (!csvUrlOrder && !csvUrlBuy) return;
    if(!silent) showLoading('🔄 오더리스트 동기화 중...');
    try {
        const [dataOrder, dataBuy] = await Promise.all([fetchCSV(csvUrlOrder), fetchCSV(csvUrlBuy)]);
        orderDataOriginal = dataOrder; orderDataBuy = dataBuy;
        extractShipDates(); 
        if(!silent) { hideLoading(); showToast('✅ 동기화 완료'); }
    } catch (e) { if(!silent) hideLoading(); }
}

async function fetchCSV(url) {
    if(!url) return [];
    let textData = '';
    try { const res = await fetch(url); textData = await res.text(); }
    catch (e) { const res2 = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`); textData = await res2.text(); }
    const wb = XLSX.read(textData, { type: 'string' });
    const rawData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    let headerIdx = -1, headers = [];
    for (let i = 0; i < Math.min(20, rawData.length); i++) {
        const cl = rawData[i].map(h => cleanKey(h));
        // ★ 상품코드 또는 어드민상품코드 둘 다 인식
        if (cl.includes('상품코드') || cl.includes('어드민상품코드')) { 
            headerIdx = i; 
            headers = cl; 
            break; 
        }
    }
    const result = [];
    for (let i = headerIdx + 1; i < rawData.length; i++) {
        let obj = {}, empty = true;
        for (let j = 0; j < headers.length; j++) { if (headers[j]) { obj[headers[j]] = rawData[i][j]; if (rawData[i][j] !== '') empty = false; } }
        if (!empty) result.push(obj);
    }
    return result;
}

// ---------------------------------------------------------
// [복구] 청크 압축 저장 (방식 A: 기존 데이터 삭제 후 최신본만 저장)
//  - rows를 200개씩 묶어 'CHUNK_n' 문서의 dataStr 필드에 JSON으로 저장
//  - loadStockLogFromFirebase()가 동일한 dataStr 구조를 읽어 복원함
// ---------------------------------------------------------
async function saveChunkedData(rows, collectionSuffix, onProgress) {
    const collectionName = CHINA_COLLECTION + '_' + collectionSuffix;

    // 1. 기존 문서 전체 삭제 → '다음 업로드 전까지 최신 1개'만 유지
    if (onProgress) onProgress('🗑️ 기존 데이터 정리 중...');
    const existing = await getDocs(collection(db, collectionName));
    if (existing.size > 0) {
        const delBatch = writeBatch(db);
        existing.docs.forEach(d => delBatch.delete(d.ref));
        await delBatch.commit();
    }

    // 2. 상품코드 있는 행만 추려 200개씩 청크로 압축 저장
    const validRows = rows.filter(r => (r['상품코드'] || '').toString().trim());
    const CHUNK_SIZE = 200;
    const batch = writeBatch(db);
    let chunkCount = 0;
    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
        const chunk = validRows.slice(i, i + CHUNK_SIZE);
        const docRef = doc(db, collectionName, `CHUNK_${chunkCount}`);
        batch.set(docRef, { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
        chunkCount++;
        if (onProgress) onProgress(`💾 저장 중... (${Math.min(i + CHUNK_SIZE, validRows.length)}/${validRows.length})`);
    }
    if (chunkCount > 0) await batch.commit();
}

function handleStockLogUpload(e) {
    const file = e.target.files[0]; 
    if (!file) return;
    showLoading('📂 미발재고로그 처리 중...');
    
    const reader = new FileReader();
    reader.onload = async function(evt) {
        try {
            const text = evt.target.result;
            let rows = [];
            
            if (text.includes('<table') || text.includes('<TABLE')) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, 'text/html');
                const table = doc.querySelector('table');
                
                if (table) {
                    const trs = table.querySelectorAll('tr');
                    let headers = [];
                    trs.forEach((tr, rowIndex) => {
                        const tds = tr.querySelectorAll('th, td');
                        if (rowIndex === 0) {
                            tds.forEach(td => headers.push(cleanKey(td.innerText)));
                        } else {
                            let obj = {};
                            let empty = true;
                            tds.forEach((td, colIndex) => {
                                if (headers[colIndex]) {
                                    const val = td.innerText.trim();
                                    obj[headers[colIndex]] = val;
                                    if (val) empty = false;
                                }
                            });
                            if (!empty && obj['상품코드']) rows.push(obj);
                        }
                    });
                }
            } else {
                const wb = XLSX.read(text, { type: 'binary' });
                rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).filter(r => r['상품코드']);
            }

            stockLogData = {}; 
            rows.forEach(row => { 
                const code = (row['상품코드'] || '').toString().trim(); 
                if (code) stockLogData[code] = row; 
            });
            
            await saveChunkedData(rows, 'StockLog', (msg) => showLoading(msg));
            hideLoading(); 
            showToast('✅ 미발재고 저장 완료');
            if (tableData.length > 0) applyDates();
            
        } catch (err) { 
            hideLoading(); 
            alert('파일 처리 실패: ' + err.message); 
        }
        e.target.value = '';
    };
    reader.readAsText(file, 'UTF-8');
}

// [Ver 2.8] 스캔DB 동기화 공용 코어
//  - 도착수량은 (도착예정 - 이미 입고된 수량)으로 차감해 업로드
//    → 자동 동기화가 여러 번 돌아도 앱에서 처리한 입고 차감분이 유지됨
async function syncScanDBCore() {
    const SCAN_DB_COLL = 'ChinaStockGoods_ScanDB';
    const existing = await getDocs(collection(db, SCAN_DB_COLL));
    if (existing.size > 0) {
        const delBatch = writeBatch(db);
        existing.docs.forEach(d => delBatch.delete(d.ref));
        await delBatch.commit();
    }
    const CHUNK_SIZE = 500;
    for (let i = 0; i < tableData.length; i += CHUNK_SIZE) {
        const batch = writeBatch(db);
        const chunk = tableData.slice(i, i + CHUNK_SIZE);
        chunk.forEach(item => {
            const docRef = doc(db, SCAN_DB_COLL, item.code);
            batch.set(docRef, {
                code: item.code, name: item.name, option: item.option,
                arrivalQty: Math.max(item.arrivalQty - (inboundMap[item.code] || 0), 0),
                mibalQty: item.mibalQty,
                totalStock: item.totalStock, location: item.location,
                capacity: item.capacity, updatedAt: new Date()
            });
        });
        await batch.commit();
    }
}

// [Ver 2.8] 자동 동기화 스케줄러 (연속 호출 병합 + 동시 실행 방지)
let scanDbSyncTimer = null;
let scanDbSyncing = false;
let scanDbSyncPending = false;

function scheduleScanDBSync() {
    if (!tableData || tableData.length === 0) return;
    clearTimeout(scanDbSyncTimer);
    scanDbSyncTimer = setTimeout(runScanDBSync, 1500);
}

async function runScanDBSync() {
    if (scanDbSyncing) { scanDbSyncPending = true; return; }
    scanDbSyncing = true;
    try {
        await syncScanDBCore();
        showToast('🔄 앱용 스캔DB 자동 동기화 완료');
    } catch (e) { console.error('스캔DB 자동 동기화 실패:', e); }
    scanDbSyncing = false;
    if (scanDbSyncPending) { scanDbSyncPending = false; scheduleScanDBSync(); }
}

async function clearAllData() {
    if (!confirm("모든 데이터를 초기화하시겠습니까?\n(수동편집, 미발재고로그, 앱 입고이력이 모두 삭제됩니다.)")) return;
    showLoading('🗑️ 전체 데이터 초기화 중...');
    try {
        await deleteDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS'));
        
        const stockSnap = await getDocs(collection(db, CHINA_COLLECTION + '_StockLog'));
        if (stockSnap.size > 0) {
            const b1 = writeBatch(db);
            stockSnap.forEach(d => b1.delete(d.ref));
            await b1.commit();
        }
        
        const inboundSnap = await getDocs(collection(db, 'ChinaStockGoods_InboundHistory'));
        if (inboundSnap.size > 0) {
            const b2 = writeBatch(db);
            inboundSnap.forEach(d => b2.delete(d.ref));
            await b2.commit();
        }

        orderDataOriginal = [];
        orderDataBuy = [];
        stockLogData = {};
        editedCells = {};
        inboundMap = {};
        tableData = [];
        filteredData = [];
        savedDates = [];
        
        updateSavedDatesFromCheckboxes();
        renderSelectedTags();
        renderTable();
        updateSummary();
        document.getElementById('date-checklist-container').innerHTML = '';
        await saveConfig(); // 선택 출고일 비운 상태 저장
        await syncOrderData(true); // [Ver 4.4] 초기화 후 출고일 목록 다시 로드 (빈 화면 방지)

        hideLoading();
        showToast('✅ 전체 초기화 완료');
    } catch (e) {
        hideLoading();
        alert('초기화 실패: ' + e.message);
    }
}

// ---------------------------------------------------------
// 비즈니스 로직 (매칭 및 렌더링)
// ---------------------------------------------------------
function extractShipDates() {
    const checklistContainer = document.getElementById('date-checklist-container');
    if (!checklistContainer) return;
    const dateMap = {};
    const dCols = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qCols = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    const iQCols = ['1차실입고수량','2차실입고수량','3차실입고수량','4차실입고수량','5차실입고수량','6차실입고수량'];
    const iACols = ['1차실입고금액','2차실입고금액','3차실입고금액','4차실입고금액','5차실입고금액','6차실입고금액'];
    
    const process = (rows) => {
        rows.forEach(row => {
            dCols.forEach((dc, idx) => {
                if (hasValue(row[iQCols[idx]]) || hasValue(row[iACols[idx]])) return;
                const norm = normalizeDate(row[dc]);
                if (!norm || norm.length < 10) return;
                if (!dateMap[norm]) dateMap[norm] = { qty: 0, skus: new Set() };
                dateMap[norm].qty += (parseInt(row[qCols[idx]]) || 0);
                dateMap[norm].skus.add(row['상품코드'] || row['어드민상품코드']);
            });
        });
    };
    process(orderDataOriginal); process(orderDataBuy);
    const sorted = Object.entries(dateMap).sort((a, b) => b[0].localeCompare(a[0]));
    if (sorted.length === 0) { checklistContainer.innerHTML = '미입고 데이터 없음'; return; }
    let html = '';
    sorted.forEach(([date, info]) => {
        const isChecked = savedDates.includes(date) ? 'checked' : '';
        html += `<label class="date-item"><input type="checkbox" class="date-check" value="${date}" ${isChecked}><span>${date} (${info.skus.size}종 / ${info.qty.toLocaleString()}장)</span></label>`;
    });
    checklistContainer.innerHTML = html;
    // [Ver 3.1] 팝업 안에서는 선택만 반영(태그 갱신), 적용은 팝업이 닫힐 때
    checklistContainer.querySelectorAll('.date-check').forEach(ck => { ck.addEventListener('change', () => { updateSavedDatesFromCheckboxes(); renderSelectedTags(); }); });
}

function updateSavedDatesFromCheckboxes() {
    savedDates = Array.from(document.querySelectorAll('.date-check:checked')).map(c => c.value);
    const btn = document.getElementById('btn-date-dropdown');
    btn.innerText = savedDates.length > 0 ? `▼ ${savedDates.length}개 선택됨` : `▼ 출고일 선택`;
}

function renderSelectedTags() {
    const container = document.getElementById('date-tags-container');
    if (savedDates.length === 0) { container.innerHTML = '선택된 출고일 없음'; return; }
    let html = '';
    [...savedDates].sort((a,b)=>b.localeCompare(a)).forEach(d => {
        html += `<div class="date-tag">${d} <span class="remove-btn" data-date="${d}">✕</span></div>`;
    });
    container.innerHTML = html;
    container.querySelectorAll('.remove-btn').forEach(b => b.addEventListener('click', () => {
        const d = b.dataset.date; savedDates = savedDates.filter(x => x !== d);
        const ck = document.querySelector(`.date-check[value="${d}"]`); if(ck) ck.checked = false;
        updateSavedDatesFromCheckboxes(); renderSelectedTags(); autoApplyDates();
    }));
}

// [Ver 3.1] 출고일 팝업이 열려있는 동안은 적용을 미루고, 닫힐 때 한 번만 적용
let dateSelectionSnapshot = null; // 팝업 열 때의 선택 상태 (null = 팝업 닫힘)

function snapshotDateSelection() {
    dateSelectionSnapshot = JSON.stringify([...savedDates].sort());
}

function onDatePopupClosed() {
    const now = JSON.stringify([...savedDates].sort());
    if (dateSelectionSnapshot !== null && now !== dateSelectionSnapshot) autoApplyDates();
    dateSelectionSnapshot = null;
}

// [Ver 2.9] 출고일 선택/해제 시 적용 (전체 해제 시 표 비우기 포함)
function autoApplyDates() {
    // 팝업 열림 상태에서 직접 적용된 경우(태그 ✕ 등) 닫힐 때 중복 적용 방지
    if (dateSelectionSnapshot !== null) snapshotDateSelection();
    if (savedDates.length === 0) {
        tableData = []; filteredData = [];
        renderTable(); updateSummary();
        saveConfig();
        return;
    }
    applyDates();
}

function applyDates(opts) {
    if (savedDates.length === 0) return;
    saveConfig();
    const dCols = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qCols = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    const iQCols = ['1차실입고수량','2차실입고수량','3차실입고수량','4차실입고수량','5차실입고수량','6차실입고수량'];
    const iACols = ['1차실입고금액','2차실입고금액','3차실입고금액','4차실입고금액','5차실입고금액','6차실입고금액'];
    
    let resultMap = {};
    const match = (rows) => {
        rows.forEach(row => {
            const code = (row['어드민상품코드'] || row['상품코드'] || '').toString().trim(); if (!code) return;
            let matched = false, totalQty = 0;
            dCols.forEach((dc, idx) => {
                if (hasValue(row[iQCols[idx]]) || hasValue(row[iACols[idx]])) return;
                const rd = normalizeDate(row[dc]);
                if (rd && savedDates.includes(rd)) { matched = true; totalQty += (parseInt(row[qCols[idx]]) || 0); }
            });
            if (matched) {
                if (!resultMap[code]) resultMap[code] = { code, name: getProductName(row), option: row['옵션']||'', arrivalQty: 0, bigoY: row['비고']||'' };
                resultMap[code].arrivalQty += totalQty;
            }
        });
    };
    match(orderDataOriginal); match(orderDataBuy);
    
    tableData = Object.values(resultMap).map(item => {
        const log = stockLogData[item.code] || {}; const ed = editedCells[item.code] || {};
        const loc = (log['로케이션'] || '').split('/')[0].trim();
        const totalStock = parseInt(log['정상재고']) || 0;   // 총재고
        // [Ver 5.4] 적재량: 개별 수정값 > 구역별/기본값
        const capacity = (ed.capacity !== undefined && ed.capacity !== '') ? (parseInt(ed.capacity) || 0) : getCapacityByLocation(loc);
        // [Ver 5.3] 부족수량 = 미발재고로그의 '부족수량' 값 (수동 편집이 있으면 그 값 우선)
        const logShort = (log['부족수량'] !== undefined && log['부족수량'] !== null && log['부족수량'] !== '') ? String(log['부족수량']).trim() : '';
        const shortageVal = (ed.shortage !== undefined) ? ed.shortage : logShort; // 부족수량(열)
        const directShipVal = ed.directShip || '';            // 직진배송(열)
        // [Ver 4.7] 미발수량 = 설정된 공식으로 계산 (변수: 총재고/적재량/부족수량/직진배송)
        const _short = parseInt(shortageVal) || 0;            // 부족수량
        const _direct = parseInt(directShipVal) || 0;         // 직진배송수량
        const mibalQty = evalMibal(totalStock, capacity, _short, _direct);
        return {
            code: item.code, name: item.name, option: item.option, arrivalQty: item.arrivalQty,
            mibalQty, totalStock,
            location: loc, capacity,
            confirmed: inboundMap[item.code] || ed.confirmed || '', 
            shortage: shortageVal, directShip: directShipVal, memo: item.bigoY || ed.memo || ''
        };
    }).filter(d => d.arrivalQty > 0);
    filteredData = [...tableData]; renderTable(); updateSummary();
    // [Ver 2.8] 표 갱신 시 앱용 스캔DB 자동 동기화
    // (앱 입고 이벤트로 인한 갱신은 앱이 이미 차감했으므로 skipSync로 생략)
    if (!(opts && opts.skipSync)) scheduleScanDBSync();
}

// [Ver 5.4] 셀 편집 시 해당 상품 한 줄만 미발수량 재계산 + 화면 갱신
function recomputeRow(code) {
    const row = tableData.find(d => d.code === code);
    if (!row) return;
    const ed = editedCells[code] || {};
    const loc = row.location;
    const cap = (ed.capacity !== undefined && ed.capacity !== '') ? (parseInt(ed.capacity) || 0) : getCapacityByLocation(loc);
    const short = parseInt((ed.shortage !== undefined) ? ed.shortage : row.shortage) || 0;
    const direct = parseInt((ed.directShip !== undefined) ? ed.directShip : row.directShip) || 0;
    row.capacity = cap;
    if (ed.shortage !== undefined) row.shortage = ed.shortage;
    if (ed.directShip !== undefined) row.directShip = ed.directShip;
    row.mibalQty = evalMibal(row.totalStock, cap, short, direct);
    renderTable(); updateSummary();
    scheduleScanDBSync(); // 편집 결과를 앱 스캔DB에도 반영
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    if (!filteredData.length) { tbody.innerHTML = '<tr><td colspan="13" style="text-align:center; padding:50px; color:#888;">출고일을 선택하세요.</td></tr>'; return; }
    let html = '';
    filteredData.forEach((row, idx) => {
        const isFromApp = inboundMap[row.code] !== undefined;
        const confirmStyle = isFromApp ? 'color: #1976d2; font-weight: 900;' : '';
        html += `<tr><td>${idx+1}</td><td class="code-cell" data-code="${row.code}">${row.code}</td><td>${row.name}</td><td>${row.option}</td><td>${row.arrivalQty}</td><td>${row.mibalQty}</td><td>${row.totalStock}</td><td>${row.location}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="capacity" style="background:#e3f2fd;">${row.capacity}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="confirmed" style="${confirmStyle}">${row.confirmed}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="shortage">${row.shortage}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="directShip">${row.directShip}</td><td class="editable-cell" contenteditable="true" data-code="${row.code}" data-field="memo">${row.memo}</td></tr>`;
    });
    tbody.innerHTML = html;
}

function updateSummary() {
    document.getElementById('sum-sku').textContent = filteredData.length;
    document.getElementById('sum-arrival').textContent = filteredData.reduce((s,d)=>s+d.arrivalQty,0);
    // [Ver 2.9] 총 미발수량 카드가 갱신되지 않던 버그 수정
    document.getElementById('sum-mibal').textContent = filteredData.reduce((s,d)=>s+(d.mibalQty||0),0);
}

function applySearch() {
    const k = document.getElementById('search-input')?.value.trim().toUpperCase();
    filteredData = k ? tableData.filter(d => d.code.includes(k) || d.name.includes(k)) : [...tableData];
    renderTable(); updateSummary();
}

function sortTable(key) {
    if (sortConfig.key === key) sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    else { sortConfig.key = key; sortConfig.direction = 'asc'; }
    filteredData.sort((a, b) => {
        let va = a[key], vb = b[key];
        if (typeof va === 'number' && typeof vb === 'number') return sortConfig.direction === 'asc' ? va - vb : vb - va;
        return sortConfig.direction === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    renderTable();
}

// ---------------------------------------------------------
// 스캐너 앱 연동 (입고앱실행 / 설치 안내)
//  - scan.html은 같은 저장소의 config.js를 쓰므로 서버가 자동으로 일치함
//    → 관리자 페이지에서는 config.js만 바꾸면 자동으로 관리자 서버로 연결됨
// ---------------------------------------------------------
const INSTALL_PAGE = new URL('app-install.html', location.href).href;

// [Ver 3.4] 입고앱실행 = 웹 스캐너 페이지 열기 (아이폰/안드로이드 공용, 설치 불필요)
function openInScannerApp() {
    closeAllMenus();
    window.open(new URL('scan.html', location.href).href, '_blank');
}

// ---------------------------------------------------------
// [Ver 3.3] 버전 체크
//  - version.json이 배포의 기준 버전 (web: 페이지, app: 스캐너 앱)
//  - 웹: 열려있는 탭이 구버전이면 새로고침 배너 표시
//  - 앱: 최신 앱 버전을 APP_META 문서로 게시 → 앱이 시작 시 확인해 업데이트 유도
// ---------------------------------------------------------
const WEB_VERSION = '5.4';
let lastVersionCheck = 0;

async function fetchVersionInfo() {
    try {
        const res = await fetch(new URL('version.json', location.href).href, { cache: 'no-store' });
        return await res.json();
    } catch (e) { return null; }
}

function showUpdateBanner(newVer) {
    if (document.getElementById('update-banner')) return;
    const div = document.createElement('div');
    div.id = 'update-banner';
    div.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:#e65100;color:#fff;z-index:999998;padding:12px;text-align:center;font-weight:bold;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
    div.textContent = `🔄 새 버전(Ver ${newVer})이 배포되었습니다. `;
    const btn = document.createElement('button');
    btn.textContent = '지금 새로고침';
    btn.style.cssText = 'margin-left:10px;padding:6px 16px;border:none;border-radius:5px;background:#fff;color:#e65100;font-weight:bold;cursor:pointer;';
    btn.onclick = () => location.reload();
    div.appendChild(btn);
    document.body.appendChild(div);
}

async function checkVersion(publishAppMeta = false) {
    const now = Date.now();
    if (now - lastVersionCheck < 60000) return; // 최소 1분 간격
    lastVersionCheck = now;
    const info = await fetchVersionInfo();
    if (!info) return;
    if (info.web && info.web !== WEB_VERSION) showUpdateBanner(info.web);
    if (publishAppMeta && info.app) {
        try {
            await setDoc(doc(db, CHINA_COLLECTION, 'APP_META'), {
                latestVersion: info.app,
                installUrl: INSTALL_PAGE,
                updatedAt: new Date()
            }, { merge: true });
        } catch (e) { console.error('APP_META 게시 실패:', e); }
    }
}

// ---------------------------------------------------------
// Firebase 설정 로직
// ---------------------------------------------------------
async function loadConfig() { const snap = await getDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC)); if (snap.exists()) { const c = snap.data(); csvUrlOrder = c.csvUrlOrder || ''; csvUrlBuy = c.csvUrlBuy || ''; savedDates = c.savedDates || []; mibalFormula = c.mibalFormula || DEFAULT_MIBAL_FORMULA; mibalFn = compileMibalFormula(mibalFormula) || compileMibalFormula(DEFAULT_MIBAL_FORMULA); zoneCapacity = c.zoneCapacity || {}; } }
async function saveConfig() { await setDoc(doc(db, CHINA_COLLECTION, CONFIG_DOC), { csvUrlOrder, csvUrlBuy, savedDates, updatedAt: new Date() }, { merge: true }); }
async function loadEditedCells() { const snap = await getDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS')); if (snap.exists()) editedCells = snap.data().cells || {}; }
async function saveEditedCells() { await setDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS'), { cells: editedCells }); }
async function loadStockLogFromFirebase() { const snap = await getDocs(collection(db, CHINA_COLLECTION + '_StockLog')); snap.forEach(d => { if(d.data().dataStr) JSON.parse(d.data().dataStr).forEach(r => { const c = (r['상품코드']||'').trim(); if(c) stockLogData[c] = r; }); }); }

// ---------------------------------------------------------
// 이벤트 바인딩 (체크리스트 기반 완전 복원)
// ---------------------------------------------------------
function setupEventListeners() {
    // 1. #btn-toggle-menu (작업 메뉴 토글)
    document.getElementById('btn-toggle-menu')?.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        const m = document.getElementById('main-tools-menu'); 
        m.style.display = m.style.display === 'block' ? 'none' : 'block'; 
    });

    // 2. #main-tools-menu (메뉴 내부 클릭 전파 방지)
    document.getElementById('main-tools-menu')?.addEventListener('click', (e) => e.stopPropagation());

    // 3. document click (메뉴 닫기)
    document.addEventListener('click', () => closeAllMenus());

    // 5. #btn-open-sheet-settings (CSV 링크 설정 모달 열기)
    document.getElementById('btn-open-sheet-settings')?.addEventListener('click', () => openSheetSettingsModal());


    // 7. #upload-stock-log (미발재고로그 업로드)
    document.getElementById('upload-stock-log')?.addEventListener('change', (e) => handleStockLogUpload(e));


    // 9. #btn-date-clear (전체 초기화 - 입고이력/전체데이터 초기화 통합, Ver 4.4)
    document.getElementById('btn-date-clear')?.addEventListener('click', clearAllData);

    // 10. #btn-excel-download (입고용파일다운로드: 상품코드 + 수량)
    document.getElementById('btn-excel-download')?.addEventListener('click', async () => {
        if (!filteredData.length) return;
        let html = '<table><tr><th>상품코드</th><th>수량</th></tr>';
        filteredData.forEach(r => html += `<tr><td>${r.code}</td><td>${r.arrivalQty}</td></tr>`);
        html += '</table>';
        const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel' });
        await downloadToDesktop('입고용파일.xls', blob);
    });

    // 10-2. #btn-mibal-download (미발확인파일다운로드: 상품코드 1열, 진짜 .xls 바이너리)
    //  - 이지어드민 업로드용. HTML 위장(.xls)이 아니라 SheetJS로 실제 BIFF8(OLE2) 파일 생성
    //  - 통합 문서1.xls 와 동일 형식(시트명 worksheet, 헤더 '상품코드')
    document.getElementById('btn-mibal-download')?.addEventListener('click', async () => {
        if (!filteredData.length) return;
        const aoa = [['상품코드']];
        filteredData.forEach(r => aoa.push([r.code]));
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'worksheet');
        const wbout = XLSX.write(wb, { bookType: 'biff8', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.ms-excel' });
        await downloadToDesktop('미발확인파일.xls', blob);
    });

    // 11. #search-input (검색)
    document.getElementById('search-input')?.addEventListener('input', applySearch);

    // 12. .th-sortable (정렬)
    document.querySelectorAll('.th-sortable').forEach(th => th.addEventListener('click', () => sortTable(th.dataset.sort)));

    // 13. #table-body focusout (셀 편집)
    document.getElementById('table-body')?.addEventListener('focusout', (e) => { 
        if (e.target.classList.contains('editable-cell')) {
            const code = e.target.dataset.code; const field = e.target.dataset.field; const value = e.target.textContent.trim();
            if (!editedCells[code]) editedCells[code] = {}; editedCells[code][field] = value;
            clearTimeout(saveTimeout); saveTimeout = setTimeout(() => { saveEditedCells(); showToast('💾 자동 저장됨'); }, 1000);
            // [Ver 5.4] 미발수량에 영향 주는 값(적재량/부족수량/직진배송)은 즉시 재계산
            if (['capacity','shortage','directShip'].includes(field)) recomputeRow(code);
        }
    });

    // 14. #table-body click (코드 복사)
    document.getElementById('table-body')?.addEventListener('click', (e) => { 
        if (e.target.classList.contains('code-cell')) {
            const code = e.target.dataset.code; 
            if (code) navigator.clipboard.writeText(code).then(() => showToast(`📋 ${code} 복사됨`));
        }
    });

    // 15. #btn-sheet-cancel (모달 취소)
    document.getElementById('btn-sheet-cancel')?.addEventListener('click', () => closeSheetSettingsModal());

    // 16. #btn-sheet-save (모달 저장)
    document.getElementById('btn-sheet-save')?.addEventListener('click', () => saveSheetSettings());

    // 17. #sheet-settings-modal (모달 바깥 클릭 닫기)
    document.getElementById('sheet-settings-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'sheet-settings-modal') closeSheetSettingsModal();
    });

    // 18. #sheet-settings-modal .modal-content (전파 방지)
    document.querySelector('#sheet-settings-modal .modal-content')?.addEventListener('click', (e) => e.stopPropagation());

    // [Ver 5.1] 미발수량 규칙 설정 모달 (예시 / 규칙 조립 / 직접 입력)
    document.getElementById('btn-open-mibal-formula')?.addEventListener('click', () => openMibalFormulaModal());
    document.getElementById('btn-mibal-cancel')?.addEventListener('click', () => closeMibalFormulaModal());
    document.querySelectorAll('.fmode-tab').forEach(t => t.addEventListener('click', () => setFormulaMode(t.dataset.mode)));
    // 예시 모드
    document.getElementById('btn-ex-add')?.addEventListener('click', () => { exampleRows.push({ s:0, c:20, sh:0, d:0, want:'' }); buildExampleRows(); });
    document.getElementById('btn-ex-copy')?.addEventListener('click', () => copyExamples());
    document.getElementById('btn-example-apply')?.addEventListener('click', () => applyFromExamples());
    // 규칙 조립 모드
    document.getElementById('btn-rule-add')?.addEventListener('click', () => { ruleRows2.push({ L:'총재고', op:'===', R:'0', result:'0' }); renderRuleRows(); });
    document.getElementById('btn-builder-apply')?.addEventListener('click', () => applyFromBuilder());
    // 직접 입력 모드
    document.getElementById('btn-advanced-apply')?.addEventListener('click', () => applyFromAdvanced());
    document.getElementById('btn-mibal-reset')?.addEventListener('click', () => resetMibalFormulaInput());
    document.getElementById('mibal-formula-modal')?.addEventListener('click', (e) => { if (e.target.id === 'mibal-formula-modal') closeMibalFormulaModal(); });
    document.querySelector('#mibal-formula-modal .modal-content')?.addEventListener('click', (e) => e.stopPropagation());

    // [Ver 5.4] 적재량 구역별 일괄 설정 모달
    document.getElementById('btn-open-zone-cap')?.addEventListener('click', () => openZoneCapModal());
    document.getElementById('btn-zone-cancel')?.addEventListener('click', () => closeZoneCapModal());
    document.getElementById('btn-zone-save')?.addEventListener('click', () => saveZoneCap());
    document.getElementById('zone-cap-modal')?.addEventListener('click', (e) => { if (e.target.id === 'zone-cap-modal') closeZoneCapModal(); });
    document.querySelector('#zone-cap-modal .modal-content')?.addEventListener('click', (e) => e.stopPropagation());



    // 21. 출고일 드롭다운 관련 바인딩
    document.getElementById('btn-date-dropdown')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = document.getElementById('date-dropdown-popup');
        if (p.style.display === 'block') {
            p.style.display = 'none';
            onDatePopupClosed(); // [Ver 3.1] 버튼으로 닫아도 적용
        } else {
            snapshotDateSelection(); // 열 때의 선택 상태 기억
            p.style.display = 'block';
        }
    });
    // [Ver 3.1] 팝업 내부 클릭이 문서 클릭(메뉴 닫기)으로 전파되지 않게 차단
    document.getElementById('date-dropdown-popup')?.addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('btn-date-all')?.addEventListener('click', () => {
        document.querySelectorAll('.date-check').forEach(ck => ck.checked = true);
        updateSavedDatesFromCheckboxes(); renderSelectedTags();
    });
    document.getElementById('btn-date-none')?.addEventListener('click', () => {
        document.querySelectorAll('.date-check').forEach(ck => ck.checked = false);
        updateSavedDatesFromCheckboxes(); renderSelectedTags();
    });

    // 22. 스캐너 앱 연동 (입고앱실행 / 설치 안내)
    document.getElementById('btn-open-app')?.addEventListener('click', openInScannerApp);
    document.getElementById('btn-install-guide')?.addEventListener('click', () => { closeAllMenus(); window.open(INSTALL_PAGE, '_blank'); });

    // ========= 바인딩 체크리스트 =========
    // 1. #btn-toggle-menu [OK]
    // 2. #main-tools-menu [OK]
    // 3. document click [OK]
    // 5. #btn-open-sheet-settings [OK]
    // 7. #upload-stock-log [OK]
    // 9. #btn-date-clear [OK] → 전체 초기화(clearAllData)로 통합
    // 10. #btn-excel-download [OK]
    // 11. #search-input [OK]
    // 12. .th-sortable [OK]
    // 13. #table-body focusout [OK]
    // 14. #table-body click [OK]
    // 15. #btn-sheet-cancel [OK]
    // 16. #btn-sheet-save [OK]
    // 17. #sheet-settings-modal [OK]
    // 18. #sheet-settings-modal .modal-content [OK]
    // 21. 출고일 드롭다운 관련 [OK]
    // =====================================
}

async function init() {
    setupEventListeners();
    loadInboundHistory();
    // [Ver 3.3] 버전 체크: 로드 시 1회(앱 최신버전 게시 포함) + 10분 간격 + 창 복귀 시
    checkVersion(true);
    setInterval(() => checkVersion(false), 10 * 60 * 1000);
    window.addEventListener('focus', () => checkVersion(false));
    try {
        await loadConfig();
        await Promise.all([loadEditedCells(), loadStockLogFromFirebase(), syncOrderData(true)]);
        if(savedDates.length > 0) {
            updateSavedDatesFromCheckboxes(); 
            renderSelectedTags();
            applyDates();
        }
    } catch(e) { console.error(e); }
}
init();

// 전역 스코프 노출
window.handleStockLogUpload = handleStockLogUpload;
