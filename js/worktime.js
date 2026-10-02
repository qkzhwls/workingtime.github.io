// === js/worktime.js ===
// 🕘 출퇴근 기록표 — 팀 업무 기록과 완전히 분리된 외부 인원용 근무표.
//
// ⚠️ 이 화면은 팀 데이터에 손대지 않는다.
//    daily_data / history / partTimers / memberWages 어디에도 쓰지 않으며,
//    인건비·생산성·FTE·팀 결산 계산에도 들어가지 않는다.
//    (팀 알바는 기존 '알바 추가' 기능이 따로 있다. 그쪽과 섞이면
//     원가구조·결산 숫자가 흔들리므로 저장 경로부터 갈라 둔다.)
//
// 저장
//   persistent_data/worktime_people          명부 { people: [...] }
//   persistent_data/worktime_2026-09         그 달 기록 { records: { [personId]: { "01": {...} } } }
//   → 달마다 문서를 나눈다. 한 문서에 몇 년치를 쌓으면 화면을 열 때마다 전부 읽는다.

import { initializeFirebase } from './config.js?v=202610021122';
import { escapeHtml as esc } from './utils.js?v=202610021122';
import { doc, getDoc, setDoc, collection, getDocs, query, orderBy, startAt, endAt, documentId }
    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const { db, auth } = initializeFirebase();
const ROOT = ['artifacts', 'team-work-logger-v2', 'persistent_data'];
const peopleRef = () => doc(db, ...ROOT, 'worktime_people');
const monthRef = (ym) => doc(db, ...ROOT, `worktime_${ym}`);

const $ = (id) => document.getElementById(id);
const num = (v) => Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, '')) || 0;
const fmt = (v) => num(v).toLocaleString();
const uid = () => 'wt-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pad2 = (n) => String(n).padStart(2, '0');
const DAY_NAME = ['일', '월', '화', '수', '목', '금', '토'];

let people = [];          // [{ id, name, wage, memo, active }]
let records = {};         // { [personId]: { "01": { in, out, breakMin, memo } } }
let currentYm = '';       // 'YYYY-MM'
let currentPid = '';
let currentUser = '';
let editingPid = null;
let saveTimer = null;
let fx = { rate: 0, date: '' };   // 당일 위안 환율 (1 CNY = ? 원)
let selected = new Set();         // 일괄 처리 대상 날짜 키('01', '02' …)

// ── 시간 계산 ────────────────────────────────────────────────────
/** 'HH:MM' → 분. 형식이 아니면 null. */
const toMin = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
};

// 정규 근무(08:30~17:30) — 이 시간대로 꽉 채운 날만 휴게 60분이 자동으로 잡힌다.
const FULL_IN = '08:30', FULL_OUT = '17:30', FULL_BREAK = 60;

/** 휴게시간 기본값. 기본은 0이고, 정규 근무시간과 정확히 같은 날만 60분.
 *  (짧게 일한 날까지 자동으로 깎이면 실제와 어긋난다) */
const autoBreak = (rec) => {
    if (!rec) return 0;
    return (String(rec.in || '').trim() === FULL_IN && String(rec.out || '').trim() === FULL_OUT)
        ? FULL_BREAK : 0;
};

/** 하루치 계산. { gross, breakMin, worked } (분). 값이 없으면 null. */
const calcDay = (rec) => {
    if (!rec) return null;
    const i = toMin(rec.in), o = toMin(rec.out);
    if (i == null || o == null) return null;
    // 퇴근이 출근보다 이르면 자정을 넘긴 것으로 본다
    const gross = o >= i ? o - i : (24 * 60 - i) + o;
    const breakMin = (rec.breakMin === '' || rec.breakMin == null)
        ? autoBreak(rec) : Math.max(0, num(rec.breakMin));
    return { gross, breakMin, worked: Math.max(0, gross - breakMin) };
};

// ── 근무 확인 ────────────────────────────────────────────────────
// 한 달치 일정을 미리 넣어 두므로, 그날 정말 그대로 근무했는지 하루씩 확인해 표시한다.
// rec.ok = true 이면 확인됨(누가·언제 확인했는지도 함께 남긴다).
const isOk = (rec) => !!(rec && rec.ok);

/** 오늘(로컬) YYYY-MM-DD */
const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** 그날이 이미 지났는가(오늘은 아직 근무 중일 수 있으므로 제외) */
const isPastDay = (ym, day) => `${ym}-${pad2(day)}` < todayStr();

/** 확인이 필요한 날 — 지난 날짜인데 기록(일정)이 있고 아직 확인하지 않은 날 */
const needsCheck = (rec, ym, day) => {
    const c = calcDay(rec);
    return !!c && !isOk(rec) && isPastDay(ym, day);
};

const hoursText = (min) => {
    const v = Math.max(0, Math.round(min || 0));
    return `${Math.floor(v / 60)}:${pad2(v % 60)}`;
};
const hoursDecimal = (min) => (Math.max(0, min || 0) / 60);

// ── 날짜 ─────────────────────────────────────────────────────────
const thisYm = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const daysInMonth = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m, 0).getDate();
};
const weekdayOf = (ym, day) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, day).getDay();
};
const shiftYm = (ym, delta) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

// ── 저장·불러오기 ────────────────────────────────────────────────
const toast = (msg, bad = false) => {
    const el = $('toast');
    el.textContent = msg;
    el.className = `fixed bottom-6 left-1/2 -translate-x-1/2 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg z-[60] ${bad ? 'bg-red-600' : 'bg-slate-800'}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 2200);
    el.classList.remove('hidden');
};

async function loadPeople() {
    const snap = await getDoc(peopleRef());
    people = (snap.exists() ? (snap.data().people || []) : []).map(p => ({
        id: p.id || uid(), name: p.name || '', wage: num(p.wage),
        memo: p.memo || '', active: p.active !== false
    }));
}

async function savePeople() {
    await setDoc(peopleRef(), {
        people, updatedAt: new Date().toISOString(), updatedBy: currentUser
    });
}

async function loadMonth(ym) {
    const snap = await getDoc(monthRef(ym));
    records = snap.exists() ? (snap.data().records || {}) : {};
}

async function saveMonth() {
    await setDoc(monthRef(currentYm), {
        records, updatedAt: new Date().toISOString(), updatedBy: currentUser
    });
}

/** 칸을 고칠 때마다 저장하면 요청이 너무 잦다. 잠깐 모았다가 한 번에 보낸다. */
const queueSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        try { await saveMonth(); } catch (e) { console.error(e); toast('저장 실패: ' + (e.message || e), true); }
    }, 700);
};

// ── 환율 ─────────────────────────────────────────────────────────
// 앱이 매일 아침 history/{날짜}.management.cnyRate 에 그날 환율을 넣어 둔다.
// 여기서는 **읽기만** 한다 — 팀 데이터를 건드리지 않는다는 원칙 그대로다.
//
// 월 총액을 '당일 환율' 하나로 환산한다. 오늘 값이 없으면(주말·휴일 등)
// 며칠 거슬러 올라가 가장 가까운 기록을 쓴다.
const FX_CACHE_KEY = 'worktime_cny_today';

async function loadRate() {
    try {
        const c = JSON.parse(localStorage.getItem(FX_CACHE_KEY) || 'null');
        if (c && c.rate > 0 && Date.now() - c.at < 6 * 3600 * 1000) { fx = c; return; }
    } catch (e) { /* 캐시가 깨졌으면 새로 읽는다 */ }

    fx = { rate: 0, date: '', at: Date.now() };
    const d = new Date();
    // 오늘부터 최대 7일 거슬러 올라간다. 보통은 첫 번째(오늘)에서 찾는다.
    for (let i = 0; i < 7; i++) {
        const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        try {
            const snap = await getDoc(doc(db, 'artifacts', 'team-work-logger-v2', 'history', key));
            const r = snap.exists() ? num(snap.data()?.management?.cnyRate) : 0;
            if (r > 0) { fx = { rate: r, date: key, at: Date.now() }; break; }
        } catch (e) {
            console.warn('환율을 읽지 못했습니다:', e); break;
        }
        d.setDate(d.getDate() - 1);
    }
    try { localStorage.setItem(FX_CACHE_KEY, JSON.stringify(fx)); } catch (e) { }
}

// ── 그리기 ───────────────────────────────────────────────────────
const activePeople = () => people.filter(p => p.active);
const personById = (id) => people.find(p => p.id === id) || null;

function renderTabs() {
    const host = $('person-tabs');
    const list = activePeople();
    if (list.length === 0) {
        host.innerHTML = '<div class="text-[11px] text-slate-400 px-1 py-2">등록된 근무자가 없습니다.</div>';
        return;
    }
    host.innerHTML = list.map(p => {
        const t = monthTotals(p.id);
        return `<button class="p-card ${p.id === currentPid ? 'on' : ''}" data-pid="${esc(p.id)}">
            <div class="nm truncate">${esc(p.name || '이름없음')}</div>
            <div class="sub">${t.days}일 · ${hoursText(t.workedMin)}</div>
        </button>`;
    }).join('');
}

function renderSheet() {
    const body = $('sheet-body');
    const p = personById(currentPid);
    if (!p) { body.innerHTML = ''; renderBulkBar(); renderSummary(); return; }

    const rec = records[p.id] || {};
    const n = daysInMonth(currentYm);
    const rows = [];
    for (let d = 1; d <= n; d++) {
        const key = pad2(d);
        const r = rec[key] || {};
        const wd = weekdayOf(currentYm, d);
        const calc = calcDay(r);
        let cls = wd === 0 ? 'sun' : wd === 6 ? 'sat' : '';
        if (needsCheck(r, currentYm, d)) cls += ' todo';
        rows.push(`
            <tr class="${cls}" data-day="${key}">
                <td><input type="checkbox" class="chk" ${selected.has(key) ? 'checked' : ''}></td>
                <td><b>${d}</b> <span class="day-name">${DAY_NAME[wd]}</span></td>
                <td><input class="t-in" data-f="in"  type="time" value="${esc(r.in || '')}"></td>
                <td><input class="t-in" data-f="out" type="time" value="${esc(r.out || '')}"></td>
                <td><input class="t-in b-in" data-f="breakMin" inputmode="numeric"
                           placeholder="${calc ? autoBreak(r) : ''}"
                           value="${r.breakMin === '' || r.breakMin == null ? '' : esc(r.breakMin)}"></td>
                <td class="tabular-nums ${calc ? 'font-bold text-slate-800' : 'text-slate-300'}">
                    ${calc ? hoursText(calc.worked) : '-'}</td>
                <td>${okCellHtml(r, currentYm, d)}</td>
                <td><input class="t-in m-in" data-f="memo"
                           maxlength="30" value="${esc(r.memo || '')}"></td>
            </tr>`);
    }
    body.innerHTML = rows.join('');
    renderBulkBar();
    renderSummary();
}

/** 확인 칸 HTML — 기록이 없는 날은 체크할 것이 없으므로 비워 둔다 */
function okCellHtml(rec, ym, day) {
    const c = calcDay(rec);
    if (!c) return '<span class="text-slate-300">-</span>';
    const done = isOk(rec);
    const todo = needsCheck(rec, ym, day);
    const tip = done
        ? `확인함${rec.okBy ? ' · ' + rec.okBy : ''}${rec.okAt ? ' · ' + rec.okAt : ''}`
        : (todo ? '아직 확인하지 않은 날입니다' : '근무 후 확인해 주세요');
    return `<label class="ok-cell" title="${esc(tip)}">
        <input type="checkbox" class="ok-box" ${done ? 'checked' : ''}>
        <span class="ok-txt ${done ? 'ok-done' : (todo ? 'ok-todo' : 'text-slate-400')}">${done ? '확인' : (todo ? '미확인' : '')}</span>
    </label>`;
}

/** 확인 상태 기록/해제 */
function setDayOk(pid, key, on) {
    const rec = (records[pid] || {})[key];
    if (!rec) return false;
    if (on) {
        if (!calcDay(rec)) return false;          // 출퇴근 시간이 없으면 확인할 것이 없다
        rec.ok = true;
        rec.okBy = String(currentUser || '').split('@')[0];
        rec.okAt = todayStr();
    } else {
        delete rec.ok; delete rec.okBy; delete rec.okAt;
    }
    return true;
}

/** 그 사람의 그 달 확인 현황 { done, target, todo } */
function checkStats(pid) {
    const rec = records[pid] || {};
    const n = daysInMonth(currentYm);
    let done = 0, target = 0, todo = 0;
    for (let d = 1; d <= n; d++) {
        const r = rec[pad2(d)];
        if (!calcDay(r)) continue;
        target++;
        if (isOk(r)) done++;
        else if (isPastDay(currentYm, d)) todo++;
    }
    return { done, target, todo };
}

function monthTotals(pid) {
    const rec = records[pid] || {};
    let workedMin = 0, days = 0;
    Object.keys(rec).forEach(k => {
        const c = calcDay(rec[k]);
        if (c && c.worked > 0) { workedMin += c.worked; days++; }
    });
    return { workedMin, days };
}

function renderSummary() {
    const p = personById(currentPid);
    if (!p) {
        $('summary').innerHTML = ''; $('fx-note').textContent = '';
        const m = $('summary-mini'); if (m) m.textContent = '요약';
        return;
    }
    const { workedMin, days } = monthTotals(p.id);
    const hours = hoursDecimal(workedMin);
    // 총금액은 분 단위까지 그대로 곱한 뒤 원 단위에서 버린다
    const pay = Math.floor(hours * num(p.wage));

    // 왼쪽에 세로로 쌓이는 카드 — 좁은 화면에서는 2열로 접힌다
    const card = (label, value, sub = '', color = 'text-slate-800') => `
        <div class="bg-white rounded-xl border border-slate-200 px-3 py-2 text-center">
            <div class="text-[11px] text-slate-500 mb-0.5">${esc(label)}</div>
            <div class="text-lg font-extrabold ${color} tabular-nums leading-tight">${value}</div>
            ${sub ? `<div class="text-[10px] text-slate-400 mt-0.5 leading-tight">${esc(sub)}</div>` : ''}
        </div>`;

    // 월 총액을 당일 환율 하나로 환산한다
    const cny = fx.rate > 0 ? pay / fx.rate : 0;
    const cnyText = cny > 0 ? '¥ ' + cny.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-';

    const ck = checkStats(p.id);
    const ckColor = ck.todo > 0 ? 'text-amber-600' : (ck.target > 0 && ck.done === ck.target ? 'text-emerald-600' : 'text-slate-800');
    const ckSub = ck.todo > 0 ? `지난 날짜 중 ${ck.todo}일 미확인` : (ck.target === 0 ? '기록 없음' : '모두 확인함');

    const mini = $('summary-mini');
    if (mini) mini.textContent = `${days}일 · ${hoursText(workedMin)}${ck.todo > 0 ? ` · 미확인 ${ck.todo}` : ''}`;

    $('summary').innerHTML =
        card('근무 확인', `${ck.done} / ${ck.target}일`, ckSub, ckColor)
        + card('근무 일수', days + '일')
        + card('월 총 근무시간', hoursText(workedMin), hours.toFixed(2) + ' 시간')
        + card('월 총금액', fmt(pay) + '원', '연장·야간·주휴수당 미포함', 'text-indigo-700')
        + card('위안화 환산', cnyText, '당일 환율 기준', 'text-rose-600');

    // 어떤 환율이 쓰였는지 밝힌다. 숫자만 보여주면 근거를 알 수 없다.
    const note = $('fx-note');
    if (!note) return;
    if (fx.rate <= 0) {
        note.innerHTML = '<span class="text-amber-600">환율 기록을 찾지 못해 위안화로 환산하지 못했습니다.</span>';
        return;
    }
    const today = `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}-${pad2(new Date().getDate())}`;
    const stale = fx.date && fx.date !== today ? ` <span class="text-amber-600">(오늘 환율이 아직 없어 ${fx.date} 값을 씁니다)</span>` : '';
    note.innerHTML = `적용 환율 1위안 = ${fx.rate.toLocaleString()}원 · ${fx.date} 기준${stale}`;
}

function renderAll() {
    const list = activePeople();
    if (list.length === 0) {
        currentPid = '';
        $('empty-state').classList.remove('hidden');
    } else {
        if (!list.some(p => p.id === currentPid)) currentPid = list[0].id;
        $('empty-state').classList.add('hidden');
    }
    const [ly, lm] = currentYm.split('-');
    $('month-label').textContent = `${ly}년 ${Number(lm)}월`;
    const p = personById(currentPid);
    $('wage-input').value = p ? fmt(p.wage) : '';
    $('wage-input').disabled = !p;
    renderTabs();
    renderSheet();
}

// ── 입력 처리 ────────────────────────────────────────────────────
$('sheet-body').addEventListener('input', (e) => {
    const el = e.target.closest('[data-f]');
    if (!el || !currentPid) return;
    const tr = el.closest('tr');
    const day = tr?.dataset.day;
    if (!day) return;

    if (!records[currentPid]) records[currentPid] = {};
    const rec = records[currentPid][day] || (records[currentPid][day] = {});
    const f = el.dataset.f;
    rec[f] = f === 'breakMin' ? el.value.replace(/[^0-9]/g, '') : el.value;

    // 시간을 고치면 이전 확인은 무효 — 다시 확인하도록 해제한다
    if (f !== 'memo' && isOk(rec)) {
        setDayOk(currentPid, day, false);
        const box = tr.querySelector('.ok-box');
        if (box) box.checked = false;
        const txt = tr.querySelector('.ok-txt');
        if (txt) { txt.textContent = '미확인'; txt.className = 'ok-txt ok-todo'; }
        toast('시간이 바뀌어 확인 표시를 해제했습니다.');
    }

    // 아무 값도 없는 날은 저장하지 않는다(빈 칸이 문서에 쌓이지 않도록)
    if (!rec.in && !rec.out && !rec.memo && !rec.breakMin) delete records[currentPid][day];

    // 근무시간 칸과 합계만 다시 그린다 — 표 전체를 다시 그리면 입력 흐름이 끊긴다
    const calc = calcDay(records[currentPid][day]);
    const cell = tr.children[5];
    cell.textContent = calc ? hoursText(calc.worked) : '-';
    cell.className = `tabular-nums ${calc ? 'font-bold text-slate-800' : 'text-slate-300'}`;
    const bIn = tr.querySelector('[data-f="breakMin"]');
    if (bIn) bIn.placeholder = calc ? String(autoBreak(records[currentPid][day])) : '';

    renderSummary();
    queueSave();
});

// ── 일괄 입력·수정·삭제 ──────────────────────────────────────────
// 여러 날을 체크해 한 번에 넣거나 지운다.
// 비워 둔 칸은 건드리지 않는다 — '출근만 일괄 수정' 같은 쓰임을 막지 않기 위함.
function renderBulkBar() {
    const bar = $('bulk-bar');
    if (!bar) return;
    const n = selected.size;
    bar.classList.toggle('hidden', n === 0);
    const cnt = $('bulk-count');
    if (cnt) cnt.textContent = `${n}일 선택됨`;

    // 전체 선택 체크박스 상태(일부만 선택되면 중간 표시)
    const all = $('chk-all');
    if (all) {
        const total = daysInMonth(currentYm);
        all.checked = n > 0 && n === total;
        all.indeterminate = n > 0 && n < total;
    }
}

/** 체크 상태를 화면에 반영한다(표를 다시 그리지 않는다 — 입력 중인 칸이 날아가지 않도록) */
function syncCheckboxes() {
    document.querySelectorAll('#sheet-body tr').forEach(tr => {
        const box = tr.querySelector('.chk');
        if (box) box.checked = selected.has(tr.dataset.day);
    });
    renderBulkBar();
}

const dayHasData = (key) => {
    const r = (records[currentPid] || {})[key];
    return !!(r && (r.in || r.out || r.memo || r.breakMin));
};

document.querySelectorAll('.sel-btn').forEach(btn => btn.addEventListener('click', () => {
    if (!currentPid) return;
    const mode = btn.dataset.sel;
    selected = new Set();
    if (mode !== 'none') {
        const n = daysInMonth(currentYm);
        for (let d = 1; d <= n; d++) {
            const key = pad2(d), wd = weekdayOf(currentYm, d);
            const isWeekend = wd === 0 || wd === 6;
            if (mode === 'all'
                || (mode === 'weekday' && !isWeekend)
                || (mode === 'weekend' && isWeekend)
                || (mode === 'filled' && dayHasData(key))) selected.add(key);
        }
    }
    syncCheckboxes();
}));

$('chk-all')?.addEventListener('change', (e) => {
    if (!currentPid) return;
    selected = new Set();
    if (e.target.checked) {
        const n = daysInMonth(currentYm);
        for (let d = 1; d <= n; d++) selected.add(pad2(d));
    }
    syncCheckboxes();
});

$('sheet-body').addEventListener('change', (e) => {
    // 근무 확인 체크
    const okBox = e.target.closest('.ok-box');
    if (okBox) {
        const key = okBox.closest('tr')?.dataset.day;
        if (!key || !currentPid) return;
        if (!setDayOk(currentPid, key, okBox.checked)) { okBox.checked = false; return; }
        renderSheet();
        renderSummary();
        queueSave();
        return;
    }

    const box = e.target.closest('.chk');
    if (!box) return;
    const key = box.closest('tr')?.dataset.day;
    if (!key) return;
    if (box.checked) selected.add(key); else selected.delete(key);
    renderBulkBar();
});

$('btn-bulk-apply').addEventListener('click', async () => {
    if (!currentPid || selected.size === 0) return;
    const vIn = $('bulk-in').value.trim();
    const vOut = $('bulk-out').value.trim();
    const vBreak = $('bulk-break').value.replace(/[^0-9]/g, '');
    if (!vIn && !vOut && !vBreak) { toast('넣을 값을 하나 이상 입력해 주세요.', true); return; }

    if (!records[currentPid]) records[currentPid] = {};
    selected.forEach(key => {
        const rec = records[currentPid][key] || (records[currentPid][key] = {});
        if (vIn) rec.in = vIn;
        if (vOut) rec.out = vOut;
        if (vBreak !== '') rec.breakMin = vBreak;
        // 시간이 바뀌었으므로 이전 확인은 무효
        delete rec.ok; delete rec.okBy; delete rec.okAt;
    });

    renderSheet();
    try { await saveMonth(); toast(`${selected.size}일에 적용했습니다.`); }
    catch (e) { toast('저장 실패: ' + (e.message || e), true); }
});

// 선택한 날짜를 한 번에 확인 처리 / 해제
const bulkOk = async (on) => {
    if (!currentPid || selected.size === 0) return;
    let n = 0;
    selected.forEach(key => { if (setDayOk(currentPid, key, on)) n++; });
    if (n === 0) { toast(on ? '확인할 기록이 없습니다.' : '해제할 기록이 없습니다.'); return; }
    renderSheet();
    try { await saveMonth(); toast(`${n}일을 ${on ? '확인 처리' : '확인 해제'}했습니다.`); }
    catch (e) { toast('저장 실패: ' + (e.message || e), true); }
};
$('btn-bulk-ok')?.addEventListener('click', () => bulkOk(true));
$('btn-bulk-unok')?.addEventListener('click', () => bulkOk(false));

$('btn-bulk-clear').addEventListener('click', async () => {
    if (!currentPid || selected.size === 0) return;
    const withData = [...selected].filter(dayHasData).length;
    if (withData === 0) { toast('선택한 날에 지울 기록이 없습니다.'); return; }
    if (!confirm(`선택한 ${selected.size}일 중 기록이 있는 ${withData}일을 지웁니다.

되돌릴 수 없습니다. 계속할까요?`)) return;

    selected.forEach(key => { if (records[currentPid]) delete records[currentPid][key]; });
    renderSheet();
    try { await saveMonth(); toast(`${withData}일을 지웠습니다.`); }
    catch (e) { toast('저장 실패: ' + (e.message || e), true); }
});

// 📱 모바일에서 접어 둔 영역(요약 · 선택/시급 도구) 열고 닫기. PC 에서는 CSS 가 무시한다.
const bindMobileToggle = (btnId, panelIds) => {
    const btn = $(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
        panelIds.forEach(id => $(id)?.classList.toggle('m-collapsed', !open));
        const arrow = btn.lastChild;
        if (arrow && arrow.nodeType === Node.TEXT_NODE) arrow.textContent = arrow.textContent.replace(/[▾▴]\s*$/, open ? '▴' : '▾');
    });
};
bindMobileToggle('btn-m-summary', ['m-summary-panel']);
bindMobileToggle('btn-m-tools', ['m-tools-sel', 'm-tools-wage']);

$('person-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pid]');
    if (!btn) return;
    currentPid = btn.dataset.pid;
    selected = new Set();
    renderAll();
});

$('wage-input').addEventListener('input', (e) => {
    const p = personById(currentPid);
    if (!p) return;
    p.wage = num(e.target.value);
    renderSummary();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        try { await savePeople(); } catch (err) { toast('시급 저장 실패', true); }
    }, 700);
});
$('wage-input').addEventListener('blur', (e) => {
    const p = personById(currentPid);
    if (p) e.target.value = fmt(p.wage);
});

// ── 월 이동 ──────────────────────────────────────────────────────
const goMonth = async (ym) => {
    currentYm = ym;
    selected = new Set();
    try {
        await Promise.all([loadMonth(ym), loadRate()]);
    } catch (e) {
        console.error(e); toast('기록을 불러오지 못했습니다.', true); records = {};
    }
    renderAll();
};
$('btn-prev').addEventListener('click', () => goMonth(shiftYm(currentYm, -1)));
$('btn-next').addEventListener('click', () => goMonth(shiftYm(currentYm, 1)));
$('btn-this').addEventListener('click', () => goMonth(thisYm()));

// ── 인원 등록·수정 ───────────────────────────────────────────────
const openPersonModal = (pid) => {
    editingPid = pid || null;
    const p = pid ? personById(pid) : null;
    $('person-modal-title').textContent = p ? '인원 수정' : '인원 등록';
    $('p-name').value = p ? p.name : '';
    $('p-wage').value = p ? fmt(p.wage) : '';
    $('p-memo').value = p ? p.memo : '';
    $('p-active').checked = p ? p.active : true;
    $('btn-delete-person').classList.toggle('hidden', !p);
    $('person-modal').classList.remove('hidden');
    setTimeout(() => $('p-name').focus(), 30);
};
const closePersonModal = () => $('person-modal').classList.add('hidden');

$('btn-add-person').addEventListener('click', () => openPersonModal(null));
$('btn-add-person-side')?.addEventListener('click', () => openPersonModal(null));
$('btn-edit-person').addEventListener('click', () => { if (currentPid) openPersonModal(currentPid); });
document.querySelectorAll('[data-close-person]').forEach(b => b.addEventListener('click', closePersonModal));
$('person-modal').addEventListener('click', (e) => { if (e.target === $('person-modal')) closePersonModal(); });

$('btn-save-person').addEventListener('click', async () => {
    const name = $('p-name').value.trim();
    if (!name) { toast('이름을 입력해 주세요.', true); return; }
    const data = { name, wage: num($('p-wage').value), memo: $('p-memo').value.trim(), active: $('p-active').checked };

    if (editingPid) {
        const p = personById(editingPid);
        if (p) Object.assign(p, data);
    } else {
        const p = { id: uid(), ...data };
        people.push(p);
        currentPid = p.id;
    }
    try {
        await savePeople();
        closePersonModal();
        renderAll();
        toast('저장했습니다.');
    } catch (e) { toast('저장 실패: ' + (e.message || e), true); }
});

// 삭제는 기록까지 사라지므로 한 번 더 묻는다.
// 보통은 '사용 중' 을 꺼서 숨기는 편이 안전하다(기록 보존).
$('btn-delete-person').addEventListener('click', async () => {
    const p = personById(editingPid);
    if (!p) return;
    const { workedMin, days } = monthTotals(p.id);
    const warn = days > 0
        ? `\n\n이번 달에 ${days}일(${hoursText(workedMin)}) 기록이 있습니다.`
        : '';
    if (!confirm(`'${p.name}' 을(를) 명부에서 지울까요?${warn}\n\n지난달 기록은 그대로 남지만 화면에서 볼 수 없게 됩니다.\n숨기기만 하려면 '사용 중' 을 끄세요.`)) return;

    people = people.filter(x => x.id !== p.id);
    try {
        await savePeople();
        closePersonModal();
        renderAll();
        toast('삭제했습니다.');
    } catch (e) { toast('삭제 실패: ' + (e.message || e), true); }
});

// ── 엑셀 ─────────────────────────────────────────────────────────
$('btn-excel').addEventListener('click', () => {
    const p = personById(currentPid);
    if (!p) { toast('인원을 먼저 등록해 주세요.', true); return; }
    const rec = records[p.id] || {};
    const n = daysInMonth(currentYm);
    const rows = [];
    for (let d = 1; d <= n; d++) {
        const key = pad2(d), r = rec[key] || {}, c = calcDay(r);
        rows.push({
            '날짜': `${currentYm}-${key}`,
            '요일': DAY_NAME[weekdayOf(currentYm, d)],
            '출근': r.in || '', '퇴근': r.out || '',
            '휴게(분)': c ? c.breakMin : '',
            '근무시간': c ? hoursText(c.worked) : '',
            '확인': c ? (r.ok ? '확인' : '미확인') : '',
            '확인일': r.okAt || '',
            '근무시간(소수)': c ? Number(hoursDecimal(c.worked).toFixed(2)) : '',
            '금액(원)': c ? Math.floor(hoursDecimal(c.worked) * num(p.wage)) : '',
            '메모': r.memo || ''
        });
    }
    const { workedMin, days } = monthTotals(p.id);
    const hours = hoursDecimal(workedMin);
    const pay = Math.floor(hours * num(p.wage));
    rows.push({});
    rows.push({ '날짜': '합계', '요일': `${days}일`, '근무시간': hoursText(workedMin),
                '근무시간(소수)': Number(hours.toFixed(2)), '금액(원)': pay });
    rows.push({ '날짜': '시급(원)', '금액(원)': num(p.wage) });
    if (fx.rate > 0) {
        rows.push({ '날짜': `환율(${fx.date})`, '금액(원)': fx.rate });
        rows.push({ '날짜': '금액(위안)', '금액(원)': Number((pay / fx.rate).toFixed(2)) });
    }
    rows.push({ '날짜': '참고', '메모': '연장·야간·주휴수당 미포함 · 위안화는 당일 환율로 총액 환산' });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, currentYm);
    XLSX.writeFile(wb, `출퇴근기록표_${p.name}_${currentYm}.xlsx`);
});

$('btn-close').addEventListener('click', () => window.close());

// ── 시작 ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        $('auth-gate').classList.remove('hidden');
        $('main').classList.add('hidden');
        return;
    }
    currentUser = user.email || user.uid || '';
    $('auth-gate').classList.add('hidden');
    $('main').classList.remove('hidden');
    currentYm = thisYm();
    try {
        await loadPeople();
        await Promise.all([loadMonth(currentYm), loadRate()]);
    } catch (e) {
        console.error(e);
        toast('불러오지 못했습니다: ' + (e.message || e), true);
    }
    renderAll();
});
