// === js/widget-calendar.js ===
// 🗓️ 대시보드 업무 캘린더
//  - 예정 근태(persistent_data/leaveSchedule), 예정 입고일정(구글시트 캐시),
//    그리고 직접 등록한 업무 일정을 한 달력에 모아 보여준다.
//  - 업무 일정과 근태는 이 달력에서 바로 등록·수정·삭제할 수 있다.
//  - 입고일정은 외부(구글시트)가 원본이라 읽기 전용으로만 표시한다.
//
// 저장 위치: artifacts/team-work-logger-v2/calendarEvents/{YYYY-MM-DD__rand}
//   문서 ID 앞에 날짜를 넣어, 보이는 달만 documentId 범위 조회로 읽는다(읽기 비용 절감).

import * as State from './state.js?v=202610021228';
import { leaveTypeLabel, OTHER_LEAVE_TYPE, PERSISTENT_LEAVE_TYPES, LEGACY_LEAVE_TYPES } from './state.js?v=202610021228';
import { showToast, getTodayDateString, getRegularMembersForCount, escapeHtml as esc } from './utils.js?v=202610021228';
import { getIncomingDetailsByDateFromCache } from './widget-incoming-schedule.js?v=202610021228';
import { notifyLeaveScheduleChanged, onLeaveScheduleChanged } from './leave-schedule-sync.js?v=202610021228';
import {
    collection, doc, setDoc, deleteDoc, getDocs, getDoc,
    query, where, documentId
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const APP_PATH = ['artifacts', 'team-work-logger-v2'];
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

// 업무 일정 분류 — 색상은 달력 점/배지에 그대로 쓰인다.
export const EVENT_TYPES = [
    { id: 'general',   label: '일반',     color: '#3b82f6' },
    { id: 'inbound',   label: '입고',     color: '#f59e0b' },
    { id: 'outbound',  label: '출고',     color: '#a855f7' },
    { id: 'inventory', label: '재고조사', color: '#14b8a6' },
    { id: 'meeting',   label: '회의',     color: '#6366f1' },
    { id: 'etc',       label: '기타',     color: '#6b7280' }
];
const typeOf = (id) => EVENT_TYPES.find(t => t.id === id) || EVENT_TYPES[0];

// 캘린더에서 고를 수 있는 근태 종류.
// 기간형 종류(state.js)를 그대로 쓰되, 캘린더에만 있던 '반차'는 앞쪽에 유지한다.
const CAL_LEAVE_TYPES = ['연차', '반차', ...PERSISTENT_LEAVE_TYPES.filter(t => t !== '연차' && !LEGACY_LEAVE_TYPES.includes(t))];
const LEAVE_COLOR = '#ef4444';
const INCOMING_COLOR = '#f97316';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addMonths = (d, n) => { const x = new Date(d); x.setDate(1); x.setMonth(x.getMonth() + n); return x; };

// ────────────────────────────────────────
// 상태
// ────────────────────────────────────────
let viewMonth = null;          // 보고 있는 달의 1일 Date
let eventsByDate = new Map();  // 'YYYY-MM-DD' → [event]  (날짜 조회용)
let eventList = [];            // 일정 원본 평면 목록 (기간 바 계산용)
let loadedRange = null;        // { from, to } — 현재 메모리에 올라온 범위
let selectedDate = null;
// 보기 모드: 'month' | 'list' — 모바일에서는 목록 보기가 기본
let viewMode = null;
const isNarrow = () => window.matchMedia('(max-width: 767px)').matches;
let userPickedView = false;  // 사용자가 직접 보기를 고르면 화면 폭 변화로 되돌리지 않는다
let isBound = false;

const eventsColRef = () => collection(State.db, ...APP_PATH, 'calendarEvents');
const isAdmin = () => (State.appState?.currentUserRole === 'admin');

// ────────────────────────────────────────
// 데이터 로드 / 저장
// ────────────────────────────────────────
/** 보이는 달 ±1개월 범위의 일정을 읽어온다. 같은 범위면 다시 읽지 않는다. */
async function loadEvents(monthDate, { force = false } = {}) {
    if (!State.db || !State.auth?.currentUser) return;

    const from = ymd(addMonths(monthDate, -1));
    const to = ymd(new Date(addMonths(monthDate, 2).getTime() - 86400000));
    if (!force && loadedRange && from >= loadedRange.from && to <= loadedRange.to) return;

    try {
        const q = query(eventsColRef(), where(documentId(), '>=', from), where(documentId(), '<=', to + ''));
        const snap = await getDocs(q);
        const map = new Map();
        snap.forEach(d => {
            const ev = { id: d.id, ...d.data() };
            if (!ev.date) return;
            // 기간 일정은 시작~종료 사이 모든 날짜에 걸어둔다.
            const end = ev.endDate && ev.endDate >= ev.date ? ev.endDate : ev.date;
            for (let dt = new Date(ev.date + 'T00:00:00'); ymd(dt) <= end; dt.setDate(dt.getDate() + 1)) {
                const key = ymd(dt);
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(ev);
            }
        });
        eventsByDate = map;
        eventList = [];
        snap.forEach(d => {
            const ev = { id: d.id, ...d.data() };
            if (ev.date) eventList.push(ev);
        });
        loadedRange = { from, to };
    } catch (e) {
        console.warn('[calendar] 일정 로드 실패:', e);
    }
}

async function saveEvent(ev) {
    const id = ev.id || `${ev.date}__${Math.random().toString(36).slice(2, 9)}`;
    const payload = {
        date: ev.date,
        endDate: ev.endDate || ev.date,
        title: ev.title,
        type: ev.type || 'general',
        time: ev.time || '',
        memo: ev.memo || '',
        updatedBy: State.appState?.currentUser || 'unknown',
        updatedAt: new Date().toISOString()
    };
    // 시작일이 바뀌면 문서 ID(날짜 프리픽스)도 바뀌어야 하므로 새로 만들고 옛 문서를 지운다.
    const idPrefix = id.split('__')[0];
    if (ev.id && idPrefix !== ev.date) {
        await deleteDoc(doc(eventsColRef(), ev.id));
        await setDoc(doc(eventsColRef(), `${ev.date}__${Math.random().toString(36).slice(2, 9)}`), payload);
    } else {
        await setDoc(doc(eventsColRef(), id), payload);
    }
    await loadEvents(viewMonth, { force: true });
}

async function removeEvent(id) {
    await deleteDoc(doc(eventsColRef(), id));
    await loadEvents(viewMonth, { force: true });
}

// ── 근태(persistent_data/leaveSchedule) 읽기/쓰기 ──
const leaveDocRef = () => doc(State.db, ...APP_PATH, 'persistent_data', 'leaveSchedule');

function leavesForDate(dateStr) {
    return (State.persistentLeaveSchedule?.onLeaveMembers || []).filter(l => {
        if (!l || !l.startDate) return false;
        const end = l.endDate || l.startDate;
        return dateStr >= l.startDate && dateStr <= end;
    });
}

async function saveLeaveEntry(entry) {
    const snap = await getDoc(leaveDocRef());
    const list = (snap.exists() && Array.isArray(snap.data().onLeaveMembers)) ? snap.data().onLeaveMembers : [];
    const idx = entry.id ? list.findIndex(l => l.id === entry.id) : -1;
    if (idx > -1) list[idx] = { ...list[idx], ...entry };
    else list.push({ ...entry, id: entry.id || `leave-${Date.now()}` });

    await setDoc(leaveDocRef(), { onLeaveMembers: list }, { merge: true });
    State.persistentLeaveSchedule.onLeaveMembers = list;
    notifyLeaveScheduleChanged('calendar-save');
}

async function removeLeaveEntry(id) {
    const snap = await getDoc(leaveDocRef());
    const list = (snap.exists() && Array.isArray(snap.data().onLeaveMembers)) ? snap.data().onLeaveMembers : [];
    const next = list.filter(l => l.id !== id);
    await setDoc(leaveDocRef(), { onLeaveMembers: next }, { merge: true });
    State.persistentLeaveSchedule.onLeaveMembers = next;
    notifyLeaveScheduleChanged('calendar-delete');
}

// ────────────────────────────────────────
// 렌더
// ────────────────────────────────────────
/** 한 날짜의 모든 항목을 한 줄짜리 데이터로 모은다. (일정 → 근태 → 입고 순) */
// ────────────────────────────────────────
// 기간(start~end) 단위 아이템 — 노션식 기간 바를 그리기 위해 날짜별이 아니라 '구간'으로 다룬다.
// ────────────────────────────────────────
const KIND_TONE = {
    leave:    { bg: '#fee2e2', fg: '#b91c1c', bar: '#ef4444', darkBg: 'rgba(239,68,68,.22)',  darkFg: '#fca5a5' },
    incoming: { bg: '#ffedd5', fg: '#c2410c', bar: '#f97316', darkBg: 'rgba(249,115,22,.22)', darkFg: '#fdba74' }
};

/** 업무 일정은 분류 색에서 톤을 만든다(배경은 옅게, 글자는 진하게). */
const hexToRgba = (hex, a) => {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

function toneOf(item) {
    if (item.kind === 'leave') return KIND_TONE.leave;
    if (item.kind === 'incoming') return KIND_TONE.incoming;
    return {
        bg: hexToRgba(item.color, 0.14), fg: item.color, bar: item.color,
        darkBg: hexToRgba(item.color, 0.26), darkFg: item.color
    };
}

/** 달력에 그릴 모든 구간을 모은다. (일정 → 근태 → 입고) */
function allRanges() {
    const out = [];

    eventList.forEach(ev => {
        const t = typeOf(ev.type);
        out.push({
            kind: 'event', id: ev.id, color: t.color,
            label: `${ev.time ? ev.time + ' ' : ''}${ev.title}`,
            sub: `${t.label}${ev.memo ? ' · ' + ev.memo : ''}`,
            start: ev.date,
            end: (ev.endDate && ev.endDate >= ev.date) ? ev.endDate : ev.date,
            editable: true
        });
    });

    (State.persistentLeaveSchedule?.onLeaveMembers || []).forEach(l => {
        if (!l || !l.startDate) return;
        out.push({
            kind: 'leave', id: l.id, color: LEAVE_COLOR,
            label: `${l.member} ${leaveTypeLabel(l)}`,
            sub: '근태 예정',
            start: l.startDate,
            end: l.endDate && l.endDate >= l.startDate ? l.endDate : l.startDate,
            editable: true
        });
    });

    const incoming = getIncomingDetailsByDateFromCache();
    Object.keys(incoming).forEach(date => {
        const inc = incoming[date];
        out.push({
            kind: 'incoming', id: 'inc-' + date, color: INCOMING_COLOR,
            label: `입고 ${inc.qty.toLocaleString()}개`,
            sub: `${inc.entries.map(e => e.packDateText + ' 패킹').join(', ')}`
                 + (inc.boxes > 0 ? ` · ${inc.boxes.toLocaleString()}박스` : '')
                 + ' — 입고 시트 연동(읽기 전용)',
            start: date, end: date, editable: false
        });
    });

    // 기간 긴 것 → 시작 이른 것 순으로 두면 레인 배치가 안정적이다.
    return out.sort((a, b) =>
        a.start.localeCompare(b.start) ||
        (dayDiff(a.start, a.end) < dayDiff(b.start, b.end) ? 1 : -1)
    );
}

const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const mdLabel = (ds) => { const p = String(ds).split('-'); return `${Number(p[1])}/${Number(p[2])}`; };

/** 특정 날짜에 걸치는 항목들 (날짜 팝업·목록 보기에서 사용) */
function itemsForDate(dateStr) {
    return allRanges().filter(r => dateStr >= r.start && dateStr <= r.end);
}

// ────────────────────────────────────────
// 월간 보기 — 주 단위로 잘라 기간 바를 배치
// ────────────────────────────────────────
const BAR_H = 18, BAR_GAP = 2, HEAD_H = 22, WEEK_PAD = 6;
// 일정이 없는 주도 달력 칸이 납작해지지 않도록 최소 높이를 둔다.
// (좁은 화면에서는 월간 격자가 더 촘촘해도 되므로 조금 낮게)
const MIN_WEEK_H_DESKTOP = 96, MIN_WEEK_H_NARROW = 68;

/** 한 주(7일)에 놓일 바들을 레인(겹치지 않는 줄)에 배치 */
function layoutWeek(ranges, weekStart, weekEnd) {
    const segs = [];
    ranges.forEach(r => {
        if (r.end < weekStart || r.start > weekEnd) return;
        const c1 = Math.max(0, dayDiff(weekStart, r.start));
        const c2 = Math.min(6, dayDiff(weekStart, r.end));
        segs.push({
            ref: r, c1, c2,
            cutLeft: r.start < weekStart,
            cutRight: r.end > weekEnd
        });
    });

    const lanes = [];
    segs.forEach(seg => {
        let li = lanes.findIndex(lane => lane.every(x => seg.c2 < x.c1 || seg.c1 > x.c2));
        if (li === -1) { lanes.push([]); li = lanes.length - 1; }
        lanes[li].push(seg);
        seg.lane = li;
    });

    return { segs, laneCount: lanes.length };
}

function barHtml(seg) {
    const r = seg.ref;
    const t = toneOf(r);
    const multi = r.start !== r.end;
    const rangeTxt = multi ? ` (${mdLabel(r.start)}~${mdLabel(r.end)})` : '';
    const radius = `${seg.cutLeft ? '0' : '5px'} ${seg.cutRight ? '0' : '5px'} ${seg.cutRight ? '0' : '5px'} ${seg.cutLeft ? '0' : '5px'}`;

    return `<div class="cal-bar ${r.editable ? '' : 'cal-bar-ro'}"
        data-cal-item-kind="${r.kind}" data-cal-item-id="${esc(r.id)}" data-cal-item-start="${r.start}"
        style="grid-column: ${seg.c1 + 1} / span ${seg.c2 - seg.c1 + 1}; grid-row: ${seg.lane + 1};
               --bg:${t.bg}; --fg:${t.fg}; --bar:${t.bar}; --dbg:${t.darkBg}; --dfg:${t.darkFg};
               border-radius:${radius};
               ${seg.cutLeft ? 'border-left:0;' : ''}"
        title="${esc(r.label)}${rangeTxt} — ${esc(r.sub)}">
        <span class="cal-bar-text">${seg.cutLeft ? '↪ ' : ''}${esc(r.label)}${rangeTxt}</span>
    </div>`;
}

function renderMonthView(root, today) {
    const ranges = allRanges();
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const gridStart = new Date(first);
    gridStart.setDate(gridStart.getDate() - first.getDay());

    const weekCount = (() => {
        const last = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0);
        return Math.ceil((first.getDay() + last.getDate()) / 7);
    })();

    const weeks = [];
    for (let w = 0; w < weekCount; w++) {
        const wStart = new Date(gridStart);
        wStart.setDate(wStart.getDate() + w * 7);
        const wEnd = new Date(wStart);
        wEnd.setDate(wEnd.getDate() + 6);
        const wsKey = ymd(wStart), weKey = ymd(wEnd);

        const { segs, laneCount } = layoutWeek(ranges, wsKey, weKey);
        const minH = isNarrow() ? MIN_WEEK_H_NARROW : MIN_WEEK_H_DESKTOP;
        const height = Math.max(minH, HEAD_H + laneCount * (BAR_H + BAR_GAP) + WEEK_PAD);

        const cells = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(wStart);
            d.setDate(d.getDate() + i);
            const key = ymd(d);
            const inMonth = d.getMonth() === viewMonth.getMonth();
            const isToday = key === today;
            const dow = d.getDay();
            const tone = !inMonth ? 'text-gray-300 dark:text-gray-600'
                : (dow === 0 ? 'text-red-500' : (dow === 6 ? 'text-blue-500' : 'text-gray-700 dark:text-gray-200'));

            cells.push(`
                <div class="cal-daycell ${inMonth ? '' : 'cal-daycell-out'} ${isToday ? 'cal-daycell-today' : ''}"
                     data-cal-date="${key}" role="button" tabindex="0"
                     title="${key} — 클릭하면 일정을 등록·수정·삭제할 수 있습니다">
                    <span class="cal-daynum ${tone} ${isToday ? 'cal-today' : ''}">${d.getDate()}</span>
                    <span class="cal-add" data-cal-add="${key}" title="이 날짜에 일정 추가">＋</span>
                </div>`);
        }

        weeks.push(`
            <div class="cal-week" style="height:${height}px">
                <div class="cal-week-days">${cells.join('')}</div>
                <div class="cal-bars" style="grid-auto-rows:${BAR_H}px; row-gap:${BAR_GAP}px; padding-top:${HEAD_H}px">
                    ${segs.map(barHtml).join('')}
                </div>
            </div>`);
    }

    root.innerHTML = `
        <div class="cal-dowrow">${DOW.map((w, i) => `<div class="${i === 0 ? 'text-red-400' : (i === 6 ? 'text-blue-400' : 'text-gray-400')}">${w}</div>`).join('')}</div>
        <div class="cal-monthgrid">${weeks.join('')}</div>`;
}

// ────────────────────────────────────────
// 목록 보기 (모바일 기본) — 날짜별로 묶어서 세로로 나열
// ────────────────────────────────────────
function renderListView(root, today) {
    const ranges = allRanges();
    const monthStart = ymd(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1));
    const monthEnd = ymd(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0));

    // 이 달에 걸치는 날짜만, 항목이 있는 날짜만 추린다.
    const byDate = new Map();
    ranges.forEach(r => {
        const from = r.start > monthStart ? r.start : monthStart;
        const to = r.end < monthEnd ? r.end : monthEnd;
        if (from > to) return;
        for (let d = new Date(from + 'T00:00:00'); ymd(d) <= to; d.setDate(d.getDate() + 1)) {
            const key = ymd(d);
            if (!byDate.has(key)) byDate.set(key, []);
            byDate.get(key).push(r);
        }
    });

    const dates = [...byDate.keys()].sort();
    if (dates.length === 0) {
        root.innerHTML = `<div class="py-10 text-center text-xs text-gray-400 italic">
            이 달에 등록된 일정이 없습니다.<br>날짜를 눌러 추가하세요.</div>
            ${listAddBarHtml(today)}`;
        return;
    }

    const rows = dates.map(key => {
        const d = new Date(key + 'T00:00:00');
        const isToday = key === today;
        const items = byDate.get(key).map(r => {
            const t = toneOf(r);
            const multi = r.start !== r.end;
            const rangeTxt = multi ? ` (${mdLabel(r.start)}~${mdLabel(r.end)})` : '';
            return `<span class="cal-listchip" data-cal-item-kind="${r.kind}" data-cal-item-id="${esc(r.id)}"
                style="--bg:${t.bg}; --fg:${t.fg}; --bar:${t.bar}; --dbg:${t.darkBg}; --dfg:${t.darkFg}">
                ${esc(r.label)}${rangeTxt}
            </span>`;
        }).join('');

        return `<div class="cal-listrow ${isToday ? 'cal-listrow-today' : ''}" data-cal-date="${key}" role="button" tabindex="0">
            <div class="cal-listdate">
                <span class="cal-listdd ${isToday ? 'cal-today' : ''}">${d.getDate()}</span>
                <span class="cal-listdow">${DOW[d.getDay()]}</span>
            </div>
            <div class="cal-listitems">${items}</div>
        </div>`;
    }).join('');

    root.innerHTML = `<div class="cal-list">${rows}</div>${listAddBarHtml(today)}`;
}

const listAddBarHtml = (today) => `
    <div class="pt-3 mt-2 border-t border-gray-100 dark:border-gray-700 flex gap-2">
        <button type="button" data-cal-add="${today}"
            class="flex-1 py-2 text-xs font-bold rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">＋ 오늘 일정 추가</button>
        <button type="button" id="cal-list-pick"
            class="flex-1 py-2 text-xs font-bold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">날짜 선택</button>
    </div>`;

/** 헤더의 [월간|목록] 버튼 상태를 현재 모드에 맞춘다. */
function syncViewToggle() {
    document.querySelectorAll('[data-cal-view]').forEach(b => {
        const on = b.dataset.calView === viewMode;
        b.className = `cal-viewbtn ${on ? 'cal-viewbtn-on' : ''}`;
    });
}

// ────────────────────────────────────────
function renderCalendar() {
    const root = document.getElementById('work-calendar-body');
    const label = document.getElementById('work-calendar-label');
    if (!root || !viewMonth) return;

    const today = getTodayDateString();
    if (label) label.textContent = `${viewMonth.getFullYear()}년 ${viewMonth.getMonth() + 1}월`;

    syncViewToggle();
    if (viewMode === 'list') renderListView(root, today);
    else renderMonthView(root, today);

    // 날짜 관리 팝업이 열려 있으면 목록도 같이 갱신
    if (isDayModalOpen() && selectedDate) renderDayModalList(selectedDate);
}

const requireAdmin = () => {
    if (isAdmin()) return true;
    showToast('일정 등록·수정·삭제는 관리자만 가능합니다.', true);
    return false;
};

// ────────────────────────────────────────
// 날짜 클릭 → 그 날짜의 일정 관리 팝업 (목록 + 추가/수정/삭제)
// ────────────────────────────────────────
function ensureDayModal() {
    if (document.getElementById('cal-day-modal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div id="cal-day-modal" class="fixed inset-0 bg-gray-900/70 hidden items-center justify-center z-[68] p-4">
        <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
            <div class="p-4 md:p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center gap-2">
                <h3 id="cal-day-title" class="text-base font-bold text-gray-900 dark:text-white"></h3>
                <button type="button" id="cal-day-close" class="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div id="cal-day-list" class="p-4 md:p-5 overflow-y-auto flex-1"></div>
            <div class="p-4 bg-gray-50 dark:bg-gray-900/40 rounded-b-2xl flex flex-wrap gap-2 justify-end">
                <button type="button" id="cal-day-add-event" class="px-3 py-2 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white">＋ 업무 일정</button>
                <button type="button" id="cal-day-add-leave" class="px-3 py-2 text-xs font-bold rounded-lg bg-red-600 hover:bg-red-700 text-white">＋ 근태</button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(wrap.firstElementChild);

    document.getElementById('cal-day-close').addEventListener('click', closeDayModal);
    document.getElementById('cal-day-modal').addEventListener('click', (e) => {
        if (e.target.id === 'cal-day-modal') closeDayModal();
    });
    document.getElementById('cal-day-add-event').addEventListener('click', () => {
        if (!requireAdmin()) return;
        openModal('event', selectedDate || getTodayDateString());
    });
    document.getElementById('cal-day-add-leave').addEventListener('click', () => {
        if (!requireAdmin()) return;
        openModal('leave', selectedDate || getTodayDateString());
    });
}

function closeDayModal() {
    const m = document.getElementById('cal-day-modal');
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
}

function isDayModalOpen() {
    const m = document.getElementById('cal-day-modal');
    return !!m && !m.classList.contains('hidden');
}

function openDayModal(dateStr) {
    ensureDayModal();
    selectedDate = dateStr;

    const d = new Date(dateStr + 'T00:00:00');
    document.getElementById('cal-day-title').textContent =
        `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`;

    renderDayModalList(dateStr);

    const m = document.getElementById('cal-day-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
}

function renderDayModalList(dateStr) {
    const host = document.getElementById('cal-day-list');
    if (!host) return;

    const items = itemsForDate(dateStr);
    if (items.length === 0) {
        host.innerHTML = `<div class="py-8 text-center text-xs text-gray-400 italic">
            등록된 일정이 없습니다.<br>아래 버튼으로 추가하세요.</div>`;
        return;
    }

    host.innerHTML = `<ul class="space-y-1">${items.map(it => {
        const btns = it.editable
            ? `<div class="flex gap-1 shrink-0">
                   <button type="button" data-day-edit-kind="${it.kind}" data-day-edit-id="${esc(it.id)}"
                       class="text-[11px] px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200">수정</button>
                   <button type="button" data-day-del-kind="${it.kind}" data-day-del-id="${esc(it.id)}"
                       class="text-[11px] px-2 py-1 rounded bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100">삭제</button>
               </div>`
            : `<span class="text-[10px] text-gray-400 shrink-0">읽기전용</span>`;
        return `
        <li class="flex items-start gap-2 py-2 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
            <span class="mt-1.5 w-2 h-2 rounded-full shrink-0" style="background:${it.color}"></span>
            <div class="min-w-0 flex-1">
                <div class="text-[13px] font-bold text-gray-800 dark:text-gray-100 break-words">${esc(it.label)}</div>
                <div class="text-[11px] text-gray-500 dark:text-gray-400 break-words">
                    ${esc(it.sub)}${it.span ? ` <span class="text-gray-400">(${esc(it.span)})</span>` : ''}
                </div>
            </div>
            ${btns}
        </li>`;
    }).join('')}</ul>`;
}

// ────────────────────────────────────────
// 등록/수정 모달
// ────────────────────────────────────────
function ensureModal() {
    if (document.getElementById('cal-event-modal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div id="cal-event-modal" class="fixed inset-0 bg-gray-900/70 hidden items-center justify-center z-[70] p-4">
        <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                <h3 id="cal-modal-title" class="text-lg font-bold text-gray-900 dark:text-white">일정 등록</h3>
                <button type="button" id="cal-modal-close" class="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div class="p-5 space-y-3">
                <div id="cal-form-event" class="space-y-3">
                    <div>
                        <label class="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">제목</label>
                        <input type="text" id="cal-f-title" class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" placeholder="예: 재고조사, 설비 점검">
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">분류</label>
                            <select id="cal-f-type" class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
                                ${EVENT_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">시간 (선택)</label>
                            <input type="time" id="cal-f-time" class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">메모 (선택)</label>
                        <input type="text" id="cal-f-memo" class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
                    </div>
                </div>

                <div id="cal-form-leave" class="space-y-3 hidden">
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">대상자</label>
                            <select id="cal-f-member" class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"></select>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">근태 유형</label>
                            <select id="cal-f-leavetype" class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
                                ${CAL_LEAVE_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div id="cal-f-other-wrap" class="hidden">
                        <label class="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">항목명 직접 입력 <span class="text-red-500">*</span></label>
                        <input type="text" id="cal-f-otherlabel" maxlength="20" placeholder="예: 교육, 예비군, 경조사"
                            class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">시작일</label>
                        <input type="date" id="cal-f-start" class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">종료일</label>
                        <input type="date" id="cal-f-end" class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
                    </div>
                </div>
                <p id="cal-modal-error" class="hidden text-xs text-red-600 font-bold"></p>
            </div>
            <div class="p-4 bg-gray-50 dark:bg-gray-900/40 rounded-b-2xl flex justify-end gap-2">
                <button type="button" id="cal-modal-cancel" class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 font-bold">취소</button>
                <button type="button" id="cal-modal-save" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold">저장</button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(wrap.firstElementChild);

    // '기타' 선택 시 항목명 입력칸 노출
    const typeSel = document.getElementById('cal-f-leavetype');
    const toggleOther = () => {
        const wrap = document.getElementById('cal-f-other-wrap');
        if (wrap) wrap.classList.toggle('hidden', typeSel.value !== OTHER_LEAVE_TYPE);
    };
    if (typeSel) typeSel.addEventListener('change', toggleOther);

    document.getElementById('cal-modal-close').addEventListener('click', closeModal);
    document.getElementById('cal-modal-cancel').addEventListener('click', closeModal);
    document.getElementById('cal-modal-save').addEventListener('click', submitModal);
}

let modalMode = 'event';   // 'event' | 'leave'
let editingId = null;

function closeModal() {
    const m = document.getElementById('cal-event-modal');
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
    editingId = null;
}

function showModalError(msg) {
    const el = document.getElementById('cal-modal-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
}

function openModal(mode, dateStr, existing = null) {
    ensureModal();
    modalMode = mode;
    editingId = existing ? existing.id : null;
    showModalError('');

    document.getElementById('cal-modal-title').textContent =
        `${mode === 'leave' ? '근태' : '업무 일정'} ${existing ? '수정' : '등록'}`;
    document.getElementById('cal-form-event').classList.toggle('hidden', mode !== 'event');
    document.getElementById('cal-form-leave').classList.toggle('hidden', mode !== 'leave');

    const start = document.getElementById('cal-f-start');
    const end = document.getElementById('cal-f-end');

    if (mode === 'event') {
        document.getElementById('cal-f-title').value = existing?.title || '';
        document.getElementById('cal-f-type').value = existing?.type || 'general';
        document.getElementById('cal-f-time').value = existing?.time || '';
        document.getElementById('cal-f-memo').value = existing?.memo || '';
        start.value = existing?.date || dateStr;
        end.value = existing?.endDate || existing?.date || dateStr;
    } else {
        const sel = document.getElementById('cal-f-member');
        const members = Array.from(getRegularMembersForCount(State.appConfig, dateStr) || []).sort();
        sel.innerHTML = members.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
        if (existing?.member) sel.value = existing.member;
        document.getElementById('cal-f-leavetype').value = existing?.type || '연차';
        const otherInput = document.getElementById('cal-f-otherlabel');
        const otherWrap = document.getElementById('cal-f-other-wrap');
        if (otherInput) otherInput.value = existing?.customLabel || '';
        if (otherWrap) otherWrap.classList.toggle('hidden', (existing?.type || '연차') !== OTHER_LEAVE_TYPE);
        start.value = existing?.startDate || dateStr;
        end.value = existing?.endDate || existing?.startDate || dateStr;
    }

    const m = document.getElementById('cal-event-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
    setTimeout(() => document.getElementById(mode === 'event' ? 'cal-f-title' : 'cal-f-member')?.focus(), 30);
}

async function submitModal() {
    const btn = document.getElementById('cal-modal-save');
    const startDate = document.getElementById('cal-f-start').value;
    const endDate = document.getElementById('cal-f-end').value || startDate;

    if (!startDate) return showModalError('시작일을 선택해주세요.');
    if (endDate < startDate) return showModalError('종료일은 시작일보다 빠를 수 없습니다.');

    let payload;
    if (modalMode === 'event') {
        const title = document.getElementById('cal-f-title').value.trim();
        if (!title) return showModalError('제목을 입력해주세요.');
        payload = {
            id: editingId,
            date: startDate,
            endDate,
            title,
            type: document.getElementById('cal-f-type').value,
            time: document.getElementById('cal-f-time').value,
            memo: document.getElementById('cal-f-memo').value.trim()
        };
    } else {
        const member = document.getElementById('cal-f-member').value;
        if (!member) return showModalError('대상자를 선택해주세요.');
        const leaveType = document.getElementById('cal-f-leavetype').value;
        if (leaveType === OTHER_LEAVE_TYPE && !(document.getElementById('cal-f-otherlabel')?.value || '').trim()) {
            return showModalError('기타 항목명을 입력해주세요.');
        }
        payload = {
            id: editingId,
            member,
            type: document.getElementById('cal-f-leavetype').value,
            customLabel: (document.getElementById('cal-f-otherlabel')?.value || '').trim(),
            startDate,
            endDate
        };
    }

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '저장 중...';
    try {
        if (modalMode === 'event') await saveEvent(payload);
        else await saveLeaveEntry(payload);

        selectedDate = startDate;
        // 저장한 일정이 다른 달이면 그 달로 이동
        const target = new Date(startDate + 'T00:00:00');
        if (target.getMonth() !== viewMonth.getMonth() || target.getFullYear() !== viewMonth.getFullYear()) {
            viewMonth = new Date(target.getFullYear(), target.getMonth(), 1);
            await loadEvents(viewMonth, { force: true });
        }
        renderCalendar();
        closeModal();
        showToast(`${modalMode === 'leave' ? '근태' : '일정'}이 저장되었습니다.`);
    } catch (e) {
        console.error('[calendar] 저장 실패:', e);
        showModalError('저장 중 오류가 발생했습니다: ' + (e.message || e));
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

// ────────────────────────────────────────
// 이벤트 바인딩
// ────────────────────────────────────────
function bind() {
    if (isBound) return;
    const host = document.getElementById('work-calendar-widget');
    if (!host) return;
    isBound = true;

    // 항목(일정/근태) 편집 — 날짜칸 안의 줄, 또는 날짜 팝업의 [수정] 버튼에서 공통으로 쓴다.
    const editItem = (kind, id) => {
        if (kind === 'event') {
            let target = null;
            eventsByDate.forEach(list => {
                const hit = list.find(x => x.id === id);
                if (hit) target = hit;
            });
            if (target) openModal('event', target.date, target);
            return;
        }
        if (kind === 'leave') {
            const l = (State.persistentLeaveSchedule?.onLeaveMembers || []).find(x => x.id === id);
            if (l) openModal('leave', l.startDate, l);
        }
    };

    const deleteItem = async (kind, id) => {
        if (kind === 'event') {
            if (!confirm('이 일정을 삭제할까요?')) return;
            try {
                await removeEvent(id);
                renderCalendar();
                showToast('일정이 삭제되었습니다.');
            } catch (err) { showToast('삭제 실패: ' + (err.message || err), true); }
            return;
        }
        if (kind === 'leave') {
            if (!confirm('이 근태 예정을 삭제할까요?')) return;
            try {
                await removeLeaveEntry(id);
                renderCalendar();
                showToast('근태 예정이 삭제되었습니다.');
            } catch (err) { showToast('삭제 실패: ' + (err.message || err), true); }
        }
    };

    host.addEventListener('click', async (e) => {
        // 보기 전환 (월간 / 목록)
        const viewBtn = e.target.closest('[data-cal-view]');
        if (viewBtn) {
            viewMode = viewBtn.dataset.calView;
            userPickedView = true;
            renderCalendar();
            return;
        }

        // 목록 보기의 [날짜 선택] → 날짜를 골라 그 날짜 팝업 열기
        if (e.target.closest('#cal-list-pick')) {
            const picked = prompt('일정을 추가할 날짜를 입력하세요 (YYYY-MM-DD)', getTodayDateString());
            if (picked && /^\d{4}-\d{2}-\d{2}$/.test(picked)) openDayModal(picked);
            else if (picked) showToast('날짜 형식이 올바르지 않습니다. (예: 2026-08-01)', true);
            return;
        }

        // 월 이동 / 오늘
        const prev = e.target.closest('#work-calendar-prev');
        const next = e.target.closest('#work-calendar-next');
        const todayBtn = e.target.closest('#work-calendar-today');
        if (prev || next || todayBtn) {
            if (todayBtn) {
                const t = new Date();
                viewMonth = new Date(t.getFullYear(), t.getMonth(), 1);
                selectedDate = getTodayDateString();
            } else {
                viewMonth = addMonths(viewMonth, prev ? -1 : 1);
            }
            await loadEvents(viewMonth);
            renderCalendar();
            return;
        }

        // 날짜칸의 ＋ 버튼 → 바로 일정 추가
        const addBtn = e.target.closest('[data-cal-add]');
        if (addBtn) {
            e.stopPropagation();
            if (!requireAdmin()) return;
            selectedDate = addBtn.dataset.calAdd;
            openModal('event', selectedDate);
            return;
        }

        // 기간 바 / 목록 칩 클릭 → 그 항목 바로 수정 (입고는 읽기전용이라 날짜 팝업으로)
        const itemEl = e.target.closest('[data-cal-item-id]');
        if (itemEl) {
            e.stopPropagation();
            const kind = itemEl.dataset.calItemKind;
            const cellEl = itemEl.closest('[data-cal-date]');
            selectedDate = itemEl.dataset.calItemStart
                || (cellEl ? cellEl.dataset.calDate : getTodayDateString());
            if (kind === 'incoming') { openDayModal(selectedDate); return; }
            if (!requireAdmin()) return;
            editItem(kind, itemEl.dataset.calItemId);
            return;
        }

        // 날짜칸 클릭 → 그 날짜 일정 관리 팝업
        const cell = e.target.closest('[data-cal-date]');
        if (cell) {
            openDayModal(cell.dataset.calDate);
            return;
        }
    });

    // 키보드 접근성: 날짜칸에서 Enter/Space → 팝업 열기
    host.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const cell = e.target.closest('[data-cal-date]');
        if (!cell) return;
        e.preventDefault();
        openDayModal(cell.dataset.calDate);
    });

    // 날짜 관리 팝업의 [수정]/[삭제] — 팝업은 body 직속이라 별도 위임
    document.addEventListener('click', async (e) => {
        const ed = e.target.closest('[data-day-edit-id]');
        if (ed) {
            if (!requireAdmin()) return;
            editItem(ed.dataset.dayEditKind, ed.dataset.dayEditId);
            return;
        }
        const dl = e.target.closest('[data-day-del-id]');
        if (dl) {
            if (!requireAdmin()) return;
            await deleteItem(dl.dataset.dayDelKind, dl.dataset.dayDelId);
        }
    });
}

// ────────────────────────────────────────
// 초기화
// ────────────────────────────────────────
export async function initWorkCalendarWidget() {
    const host = document.getElementById('work-calendar-widget');
    if (!host) return;

    const t = new Date();
    viewMonth = new Date(t.getFullYear(), t.getMonth(), 1);
    selectedDate = getTodayDateString();
    if (viewMode === null) viewMode = isNarrow() ? 'list' : 'month';

    bind();

    // 화면 폭이 바뀌면(회전 등) 사용자가 직접 고르지 않은 경우에만 기본 보기를 따라간다.
    if (!window.__calResizeBound) {
        window.__calResizeBound = true;
        let lastNarrow = isNarrow();
        window.addEventListener('resize', () => {
            const now = isNarrow();
            if (now === lastNarrow) return;
            lastNarrow = now;
            if (!userPickedView) { viewMode = now ? 'list' : 'month'; renderCalendar(); }
        });
    }

    // 입고일정은 구글시트에서 비동기로 들어오므로, 도착하면 달력을 다시 그린다.
    if (!document.__calIncomingBound) {
        document.__calIncomingBound = true;
        document.addEventListener('incoming-schedule-updated', () => refreshWorkCalendar());
    }

    // 🔗 근태가 다른 화면에서 바뀌어도 달력에 즉시 반영
    onLeaveScheduleChanged('calendar', () => refreshWorkCalendar());

    await loadEvents(viewMonth);
    renderCalendar();
}

/** 외부(근태 저장 등)에서 달력을 다시 그리고 싶을 때 */
export function refreshWorkCalendar() {
    if (viewMonth) renderCalendar();
}
