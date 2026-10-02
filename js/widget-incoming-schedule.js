// === js/widget-incoming-schedule.js ===
import { escapeHtml } from './utils.js?v=202610021122';
// 🚚 메인 대시보드 "주요 일정 및 알림" 위젯의 입고 예정 섹션.
// Apps Script Web App에서 JSON을 받아 도착일이 당일 이후인 행을 표시.

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw8ZaiYF8McexD_ZWXWoOZ0F4UQKgQVBH3w8XLiTxW3bPSMoOcptXnb2N-gW_hRJW4-Xw/exec';

// 컬럼은 '헤더 이름'으로 찾는다. 시트에 열이 추가·이동돼도 따라가도록.
// 이름을 못 찾은 항목만 예전 고정 위치로 폴백한다.
// (0-based) A=0 ... B=1 ... Q=16 ... R=17 ... AC=28
const COL_PACK_DATE = 1;   // B열 — 패킹 일자
const COL_BOXES = 16;      // Q열 — 박스 수
const COL_QTY = 17;        // R열 — 수량
const COL_ARRIVAL = 28;    // AC열 — 도착일

// 헤더 글자 정규화: 공백 제거 + 소문자 (줄바꿈이 든 두 줄 헤더도 한 덩어리로)
const normHeader = (v) => String(v ?? '').replace(/\s+/g, '').toLowerCase();

// 항목별 헤더 판별 규칙 — 시트마다 표기가 조금씩 달라 '포함' 기준으로 본다.
const HEADER_RULES = {
    arrival: { label: '도착일', fallback: COL_ARRIVAL,
               test: (h) => /도착/.test(h) || /입고(예정)?일/.test(h) },
    qty:     { label: '수량',   fallback: COL_QTY,
               test: (h) => (/수량/.test(h) || /pcs/.test(h)) && !/박스|box|ctn|금액/.test(h) },
    boxes:   { label: '박스',   fallback: COL_BOXES,
               test: (h) => /박스|box|ctn/.test(h) },
    pack:    { label: '패킹일', fallback: COL_PACK_DATE,
               test: (h) => /패킹|포장/.test(h) }
};

// 머리글을 찾기 위해 위에서 몇 줄까지 훑을지.
// 시트 상단에 요약 블록(총 미결제 잔액·오늘 입고 패킹 등)이 붙으면서 머리글이 11행까지
// 밀린 적이 있어 넉넉히 잡는다. 요약 블록이 더 늘어도 견디도록.
const HEADER_SCAN_ROWS = 20;
// 머리글로 인정할 최소 매칭 항목 수. 1개는 우연히 걸린 것으로 보고 고정 위치 폴백을 쓴다.
const HEADER_MIN_SCORE = 2;
// 이 개수 이상 이름으로 찾았을 때만 캐시에 저장한다.
// 캐시는 캘린더·업무 예상·인력 수급이 함께 읽으므로, 열을 잘못 잡은 값이 새어나가면 안 된다.
const CACHE_MIN_MATCHED = 3;

/** 헤더 줄을 찾아 각 항목의 열 번호를 정한다.
 *  - 위에서 HEADER_SCAN_ROWS 줄까지 훑어 '가장 많이 맞아떨어지는 줄'을 헤더로 본다(제목 줄이 위에 있어도 안전).
 *  - 못 찾은 항목은 예전 고정 위치를 그대로 쓴다.
 *  반환 { cols, startRow, missing, headerRow }
 */
function resolveColumns(rows) {
    let best = { score: -1, idx: 0, cols: {} };
    const scan = Math.min(HEADER_SCAN_ROWS, rows.length);
    for (let r = 0; r < scan; r++) {
        const row = Array.isArray(rows[r]) ? rows[r] : [];
        const cols = {};
        const used = new Set();   // 한 셀이 두 규칙에 걸려 같은 열을 두 항목이 쓰는 걸 막는다
        let score = 0;
        Object.entries(HEADER_RULES).forEach(([key, rule]) => {
            const i = row.findIndex((cell, idx) => {
                if (used.has(idx)) return false;
                const h = normHeader(cell);
                return h.length > 0 && rule.test(h);
            });
            if (i > -1) { cols[key] = i; used.add(i); score++; }
        });
        if (score > best.score) best = { score, idx: r, cols };
        // 확실한 머리글(2항목 이상)을 만나면 멈춘다. 그 아래는 데이터 행이고,
        // 비고·상태 칸에 '도착지연' '박스 재포장' 같은 값이 들어가면 머리글로 오인될 수 있다.
        if (best.score >= HEADER_MIN_SCORE) break;
    }

    // 1항목만 우연히 걸린 줄은 머리글로 인정하지 않는다.
    // (요약 블록의 '오늘 입고 패킹' 같은 셀이 패킹일 헤더로 잡히던 사고가 있었다)
    const accepted = best.score >= HEADER_MIN_SCORE;

    const cols = {};
    const missing = [];
    Object.entries(HEADER_RULES).forEach(([key, rule]) => {
        if (accepted && best.cols[key] != null) cols[key] = best.cols[key];
        else { cols[key] = rule.fallback; missing.push(rule.label); }
    });

    // 헤더를 못 찾으면 예전처럼 '첫 줄은 헤더'로 보고 고정 위치를 쓴다
    const headerRow = accepted ? best.idx : 0;
    return { cols, startRow: headerRow + 1, missing, headerRow, matched: accepted ? best.score : 0 };
}

const REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2시간
const CACHE_KEY = 'incoming_schedule_cache_v1';
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3시간 (오프라인 fallback)

let _refreshTimer = null;
let _lastFetchAt = 0;

// ────────────────────────────────────────
// 날짜 파서 — "6/15", "06/15", "2026-06-15", "6/15(월)" 등 다양한 형식 처리
// 반환: Date | null
// ────────────────────────────────────────
function parseDateCell(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const now = new Date();
    const thisYear = now.getFullYear();

    // 패턴 1: YYYY.M.D / YYYY-M-D / YYYY/M/D (+ 뒤에 요일/공백 등 무시)
    // 패턴 2: YY.M.D / YY-M-D (2자리 연도 — 첫 그룹이 > 12 라야 연도로 인정)
    const three = s.match(/^(\d{2,4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})/);
    if (three) {
        const first = Number(three[1]);
        const firstLen = three[1].length;
        // 4자리면 무조건 연도. 2자리이고 12보다 크면 연도(YY).
        if (firstLen === 4 || first > 12) {
            const year = firstLen === 4 ? first : 2000 + first;
            const month = Number(three[2]);
            const day = Number(three[3]);
            const d = new Date(year, month - 1, day);
            if (!isNaN(d.getTime())) return d;
        }
        // 그 외(첫 그룹이 1~12)는 M/D/YY 가능성도 있으나 본 시트엔 없음 → 패스
    }
    // 패턴 3: M/D 또는 MM/DD (연도 없음) — 올해 기준, 너무 과거면 다음해
    const md = s.match(/^(\d{1,2})[-/.](\d{1,2})(?!\d)/);
    if (md) {
        const m = Number(md[1]); const dd = Number(md[2]);
        if (m >= 1 && m <= 12 && dd >= 1 && dd <= 31) {
            const d = new Date(thisYear, m - 1, dd);
            const diffMonths = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
            if (diffMonths > 6) d.setFullYear(thisYear + 1);
            return d;
        }
    }
    // 마지막 fallback: Date 직접 시도
    const fb = new Date(s);
    if (!isNaN(fb.getTime())) return fb;
    return null;
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 도착일 라벨: "오늘" / "내일" / "모레" / "M/D"
function formatArrivalLabel(arrivalDate) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const arr = new Date(arrivalDate); arr.setHours(0, 0, 0, 0);
    const diffDays = Math.round((arr - now) / (24 * 60 * 60 * 1000));
    if (diffDays === 0) return '오늘';
    if (diffDays === 1) return '내일';
    if (diffDays === 2) return '모레';
    return `${arr.getMonth() + 1}/${arr.getDate()}일`;
}

function normalizePackDateText(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    // "2024.11.4.월" / "24.11.4" / "11/4" / "11-4" 모두 → "11/4일자"
    const ymdMatch = s.match(/^(\d{2,4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})/);
    if (ymdMatch) {
        const first = Number(ymdMatch[1]);
        if (ymdMatch[1].length === 4 || first > 12) {
            return `${Number(ymdMatch[2])}/${Number(ymdMatch[3])}일자`;
        }
    }
    const md = s.match(/^(\d{1,2})[-/.](\d{1,2})(?!\d)/);
    if (md) return `${Number(md[1])}/${Number(md[2])}일자`;
    return s;
}

const numFmt = (n) => Number(n || 0).toLocaleString();

// ────────────────────────────────────────
// 메인: fetch → 파싱 → 필터 → 렌더
// ────────────────────────────────────────
async function fetchIncomingSchedule() {
    const listEl = document.getElementById('widget-incoming-list');
    const statusEl = document.getElementById('widget-incoming-status');
    if (!listEl) return;

    try {
        if (statusEl) statusEl.textContent = '조회 중...';
        const res = await fetch(SCRIPT_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json && json.error) throw new Error(json.error);
        // Apps Script가 { data: [[...]] } 또는 직접 [[...]] 둘 다 처리
        const rows = Array.isArray(json) ? json : json.data;
        const today = new Date(); today.setHours(0, 0, 0, 0);

        // 헤더 이름으로 열 위치를 잡는다(못 찾은 항목만 고정 위치 폴백)
        const { cols, startRow, missing, headerRow, matched } = resolveColumns(rows || []);
        if (missing.length > 0) {
            console.warn(`[widget-incoming] 헤더를 못 찾은 항목: ${missing.join(', ')} → 기존 열 위치로 읽습니다.`,
                         { headerRow, cols });
        }

        const items = [];
        for (let i = startRow; i < rows.length; i++) {
            const r = rows[i];
            if (!r || r.length < 3) continue;
            const arrivalRaw = r[cols.arrival];
            const arrival = parseDateCell(arrivalRaw);
            if (!arrival) continue;
            const arr = new Date(arrival); arr.setHours(0, 0, 0, 0);
            if (arr < today) continue; // 과거는 제외

            const packDate = r[cols.pack];
            const boxes = Number(String(r[cols.boxes] || '').replace(/[^0-9.-]/g, '')) || 0;
            const qty = Number(String(r[cols.qty] || '').replace(/[^0-9.-]/g, '')) || 0;
            if (boxes === 0 && qty === 0) continue; // 빈 행 제외

            items.push({
                arrivalDate: arr,
                arrivalLabel: formatArrivalLabel(arr),
                packDateText: normalizePackDateText(packDate),
                boxes, qty
            });
        }

        // 도착일 가까운 순 정렬
        items.sort((a, b) => a.arrivalDate - b.arrivalDate);

        // 캐시 저장 (오프라인 fallback). 열을 이름으로 제대로 잡았을 때만 저장한다 —
        // 이 캐시는 캘린더·업무 예상·인력 수급도 함께 읽으므로 잘못 읽은 값을 남기면 안 된다.
        if (matched >= CACHE_MIN_MATCHED) {
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), items: items.map(it => ({ ...it, arrivalDate: it.arrivalDate.toISOString() })) }));
            } catch (_) {}
        } else {
            console.warn('[widget-incoming] 열을 이름으로 충분히 찾지 못해 캐시를 갱신하지 않습니다.', { matched, cols });
        }

        renderItems(items);
        // 🗓️ 업무 캘린더가 입고 표시를 다시 그릴 수 있도록 알림
        try { document.dispatchEvent(new CustomEvent('incoming-schedule-updated')); } catch (_) {}
        const now = new Date();
        if (statusEl) {
            statusEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} 갱신`
                                 + (missing.length > 0 ? ' ⚠️' : '');
            statusEl.title = missing.length > 0
                ? `시트에서 ${missing.join(', ')} 헤더를 찾지 못해 기존 열 위치로 읽었습니다. 시트 머리글을 확인하세요.`
                : `${headerRow + 1}행을 머리글로 보고 열 이름으로 읽었습니다.`;
        }
        _lastFetchAt = Date.now();
    } catch (e) {
        console.warn('[widget-incoming] fetch 실패:', e);
        // 캐시 폴백
        try {
            const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
            if (cached && Date.now() - cached.at < CACHE_TTL_MS && Array.isArray(cached.items)) {
                const items = cached.items.map(it => ({ ...it, arrivalDate: new Date(it.arrivalDate) }))
                    .filter(it => {
                        const d = new Date(it.arrivalDate); d.setHours(0, 0, 0, 0);
                        const today = new Date(); today.setHours(0, 0, 0, 0);
                        return d >= today;
                    });
                renderItems(items);
                if (statusEl) statusEl.textContent = '⚠️ 오프라인 (캐시)';
                return;
            }
        } catch (_) {}
        setIncomingCount(0);
        listEl.innerHTML = `<li class="px-3 py-2 text-[10px] text-red-500">⚠️ 입고 데이터 조회 실패. Apps Script URL 또는 권한을 확인하세요.</li>`;
        if (statusEl) statusEl.textContent = '오류';
    }
}

function setIncomingCount(n) {
    const countEl = document.getElementById('widget-incoming-count');
    if (countEl) countEl.textContent = n;
}

/** 도착일이 같은 항목끼리 묶는다. items는 도착일 오름차순 정렬 상태로 들어온다. */
function groupByArrivalDate(items) {
    const groups = [];
    const byKey = new Map();
    items.forEach(it => {
        const key = ymd(it.arrivalDate);
        let g = byKey.get(key);
        if (!g) {
            g = { key, arrivalLabel: it.arrivalLabel, entries: [], totalBoxes: 0, totalQty: 0 };
            byKey.set(key, g);
            groups.push(g);
        }
        g.entries.push(it);
        g.totalBoxes += Number(it.boxes) || 0;
        g.totalQty += Number(it.qty) || 0;
    });
    return groups;
}

const qtyPartsText = (boxes, qty) => {
    const parts = [];
    if (boxes > 0) parts.push(`${numFmt(boxes)}박스`);
    if (qty > 0) parts.push(`${numFmt(qty)}개`);
    return parts.join(', ');
};

function renderItems(items) {
    const listEl = document.getElementById('widget-incoming-list');
    if (!listEl) return;
    if (items.length === 0) {
        setIncomingCount(0);
        listEl.innerHTML = `<li class="px-3 py-2 text-[10px] text-gray-400 italic">표시할 입고 예정이 없습니다.</li>`;
        return;
    }

    // ★ 같은 도착일은 한 칸으로 묶어 표시 (날짜 1회 + 총합, 그 아래 패킹건별 줄)
    const groups = groupByArrivalDate(items);
    setIncomingCount(groups.length);

    listEl.innerHTML = groups.map(g => {
        const arrTone = g.arrivalLabel === '오늘' ? 'text-red-600 dark:text-red-400'
            : (g.arrivalLabel === '내일' ? 'text-orange-600 dark:text-orange-400'
            : 'text-amber-700 dark:text-amber-300');
        const totalText = qtyPartsText(g.totalBoxes, g.totalQty);
        const lines = g.entries.map(it => {
            const detail = qtyPartsText(it.boxes, it.qty);
            return `<div class="text-[12.5px] leading-snug"><span class="font-bold">${escapeHtml(it.packDateText)} 패킹</span>${detail ? ` · <span class="opacity-90">${escapeHtml(detail)}</span>` : ''}</div>`;
        }).join('');

        // 날짜 라벨은 고정 폭(w-14) + gap-2 → 아래 패킹 줄은 같은 offset(pl-16)으로 들여써서 날짜 칸을 침범하지 않게 함
        return `
            <li class="px-3 py-2">
                <div class="flex items-baseline gap-2">
                    <span class="w-14 shrink-0 text-[12.5px] font-extrabold ${arrTone} whitespace-nowrap">${g.arrivalLabel}</span>
                    ${totalText ? `<span class="text-[12.5px] font-bold min-w-0">총 ${escapeHtml(totalText)} 입고예정</span>` : ''}
                </div>
                <div class="mt-1 pl-16 space-y-0.5 opacity-90">${lines}</div>
            </li>
        `;
    }).join('');
}


// ────────────────────────────────────────
// 입고일정 캐시 조회 (업무 예상 시뮬레이션의 '중국제작' 자동입력용)
//  - 대시보드 위젯이 저장해 둔 캐시에서 도착일(YYYY-MM-DD)별 입고 수량 합계를 반환.
//  - 반환: { 'YYYY-MM-DD': totalQty, ... }  (데이터 없으면 빈 객체)
// ────────────────────────────────────────
/** 입고일정 캐시가 **오늘 갱신된 데다 묵지 않았는지**. 자동 계획 스냅샷이 이 판정을 쓴다.
 *  어제 캐시로 계획을 얼리면 오늘 아침 시트에서 빠진 선적이 그대로 계획에 들어간다.
 *  날짜만 보면 공용 PC 를 켠 채 둔 경우 00:30 갱신분이 06:00 에도 통과하므로 경과시간도 본다.
 *  캐시 키를 이 파일 밖으로 내보내지 않기 위해 판정을 여기 둔다 — 키가 바뀌어도 같이 따라간다. */
const INCOMING_FRESH_MAX_AGE_MS = 3 * 60 * 60 * 1000;   // 갱신 주기가 2시간이라 3시간
export function isIncomingCacheFreshToday() {
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (!cached || !Array.isArray(cached.items)) return false;
        const at = Number(cached.at);
        if (!Number.isFinite(at)) return false;
        if (ymd(new Date(at)) !== ymd(new Date())) return false;
        return (Date.now() - at) < INCOMING_FRESH_MAX_AGE_MS;
    } catch (_) { return false; }
}

export function getIncomingQtyByDateFromCache() {
    const out = {};
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (!cached || !Array.isArray(cached.items)) return out;
        cached.items.forEach(it => {
            const d = new Date(it.arrivalDate);
            if (isNaN(d.getTime())) return;
            const key = ymd(d);
            out[key] = (out[key] || 0) + (Number(it.qty) || 0);
        });
    } catch (_) {}
    return out;
}

// 캘린더 위젯용: 도착일(YYYY-MM-DD)별 입고 상세.
// 반환: { 'YYYY-MM-DD': { qty, boxes, entries:[{packDateText, qty, boxes}] } }
export function getIncomingDetailsByDateFromCache() {
    const out = {};
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (!cached || !Array.isArray(cached.items)) return out;
        cached.items.forEach(it => {
            const d = new Date(it.arrivalDate);
            if (isNaN(d.getTime())) return;
            const key = ymd(d);
            if (!out[key]) out[key] = { qty: 0, boxes: 0, entries: [] };
            out[key].qty += Number(it.qty) || 0;
            out[key].boxes += Number(it.boxes) || 0;
            out[key].entries.push({ packDateText: it.packDateText, qty: Number(it.qty) || 0, boxes: Number(it.boxes) || 0 });
        });
    } catch (_) {}
    return out;
}

// ────────────────────────────────────────
// 초기화 / 자동 갱신
// ────────────────────────────────────────
export function initIncomingScheduleWidget() {
    fetchIncomingSchedule(); // 즉시 1회
    if (_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(fetchIncomingSchedule, REFRESH_INTERVAL_MS);

    const refreshBtn = document.getElementById('refresh-incoming-btn');
    if (refreshBtn && !refreshBtn.__bound) {
        refreshBtn.__bound = true;
        refreshBtn.addEventListener('click', () => {
            // 짧은 쿨다운 — 30초 내 재요청 방지
            if (Date.now() - _lastFetchAt < 30_000) return;
            fetchIncomingSchedule();
        });
    }
}
