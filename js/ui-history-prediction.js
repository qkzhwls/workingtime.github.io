// === js/ui-history-prediction.js ===
// 설명: '실적 예측' 탭(매출/배송 AI 차트) + '업무 예상' 탭(오늘·내일 자동 예측 + 업무량 시뮬레이션).
//  - renderPredictionTab: 실적 예측 탭 (차트/KPI)
//  - renderForecastTab: 업무 예상 탭 (시뮬레이션·요약 카드)

import { predictFutureTrends } from './analysis-logic.js?v=202610021228';
import { DELIVERY_CHANNELS, channelScope } from './revenue-channels.js?v=202610021228';
import * as State from './state.js?v=202610021228';
import { getTodayDateString, getRegularMembersForCount, showToast, getHolidayName, formatHM, getAllTaskKeys, escapeHtml } from './utils.js?v=202610021228';
import { getIncomingQtyByDateFromCache, getIncomingDetailsByDateFromCache,
         isIncomingCacheFreshToday } from './widget-incoming-schedule.js?v=202610021228';
import { getPlannedQuantitiesForDate, getPlannedTimeTasksForDate, getPlannedExcludeMinutesForDate,
         fetchPlannedData, savePlannedQuantities,
         saveForecastSnapshot, saveForecastSnapshotIfAbsent, deleteForecastSnapshot, fetchForecastSnapshots,
         getForecastSnapshotForDate } from './history-data-manager.js?v=202610021228';
import { decomposeAccuracy, summarizeAccuracyRows, aggregateByTask } from './forecast-accuracy.js?v=202610021228';
import { computeDayProgress, buildProgressRows, projectFinish,
         nowTimeString, hhmmToMin, minToHhmm } from './forecast-progress.js?v=202610021228';
import { LUNCH_END_MIN } from './lib/calc.js?v=202610021228';
import { taskUph, recentDays } from './task-throughput.js?v=202610021228';
import { foldReasonFor, FOLD_REASON_TEXT, shouldSaveQty, shouldSaveTime,
         normalizeTimeEntry } from './lib/sim-fold.js?v=202610021228';

/** 해당 날짜·작업의 예정 물량(수동 입력값). 없으면 null → 자동 추정값으로 폴백.
 *  0도 '0으로 하기로 한 값'이므로 그대로 인정한다(키가 아예 없을 때만 자동값). */
const getPlanned = (dateStr, taskKey) => {
    const p = getPlannedQuantitiesForDate(dateStr) || {};
    if (!Object.prototype.hasOwnProperty.call(p, taskKey)) return null;
    const v = Number(p[taskKey]);
    return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
};

/** 대상일(YYYY-MM-DD)에 도착 예정인 입고 수량 = 중국제작 자동값. 캐시에 없으면 0. */
const getIncomingChinaForDate = (dateStr) => {
    if (!dateStr) return 0;
    const map = getIncomingQtyByDateFromCache();
    return Math.round(Number(map[dateStr]) || 0);
};

/** 대상일에 도착 예정인 입고 '박스 수' = 상.하차 자동값의 재료. 캐시에 없으면 0.
 *  (대시보드 입고일정 위젯이 시트를 읽어 캐시에 넣어 둔다 — 위젯을 한 번도 안 열었으면 0) */
const getIncomingBoxesForDate = (dateStr) => {
    if (!dateStr) return 0;
    const map = getIncomingDetailsByDateFromCache();
    // 시트에 정정행(-5 박스 등)이 있으면 합계가 음수가 될 수 있다 — 음수는 0으로 본다
    return Math.max(0, Math.round(Number(map[dateStr]?.boxes) || 0));
};

// ───────────────────────────────────────────────────────────
// 시뮬레이션 상수/헬퍼
// ───────────────────────────────────────────────────────────
// 모든 업무를 기본 등록으로 둔다('+ 추가 선택' 폐지).
// 자동값 규칙: ai=국내배송 예측 / incoming=입고일정 / china-linked=중국제작 입고량×검수비율
//              last7=지난 7회 업무량 평균
// 어느 경우든 '예정 물량'에 수기 입력값이 있으면 그 값이 최우선이다.
const LEGACY_SIM_TASKS = [
    { id: 'domestic', key: '국내배송', label: '국내배송', auto: 'ai' },
    { id: 'china',    key: '중국제작', label: '중국제작', auto: 'incoming' },
    { id: 'sample',   key: '샘플검수', label: '샘플검수', auto: 'china-linked' },
    { id: 'direct',   key: '직진배송', label: '직진배송', auto: 'cadence' },
    { id: 'ably',     key: '에이블리배송', label: '에이블리배송', auto: 'cadence' },
    // 채우기도 빈도형으로 본다 — 요일 하나로는 안 잡히지만(월·화·수 중심),
    // '마지막 진행 후 며칠째'를 함께 보면 잡힌다(어제 했으면 75%, 이틀 쉬면 10%, 사흘 쉬면 86%).
    { id: 'fill',     key: '채우기',   label: '채우기',   auto: 'cadence' },
    // 아래 넷도 매일 하는 업무가 아니다 — 빈도형으로 본다(표본이 모자라면 안에서 지난 7회 평균으로 물러난다)
    { id: 'return',   key: '교환반품', label: '교환반품', auto: 'cadence' },
    { id: 'full',     key: '전량검수', label: '전량검수', auto: 'cadence' },
    { id: 'other',    key: '국내기타', label: '국내기타', auto: 'cadence' },
    { id: 'localprod',key: '국내제작', label: '국내제작', auto: 'cadence' }
];
// 입력 칸을 성격별로 묶어 보여준다(10개를 한 덩어리로 늘어놓으면 읽기 어렵다).
const BASE_SIM_GROUPS = [
    { label: '출고',      ids: ['domestic', 'direct', 'ably'] },
    { label: '입고 · 제작', ids: ['china', 'sample', 'localprod'] },
    { label: '그 외 작업',  ids: ['fill', 'return', 'full', 'other'] }
];

// 위 10개는 '늘 하는 업무'라 코드에 두지만, 그 밖에도 실제로 처리량을 세는 업무가 계속 늘어난다.
// 목록에 없으면 계획 칸이 아예 안 생기고 나중에 전부 '계획 외'로 찍히므로,
// 관리자에 등록돼 있고 최근에 실제로 물량이 잡힌 업무는 자동으로 뒤에 붙인다.
// ⚠️ 저장 키는 id 가 아니라 업무명(key)이다 — 기존 10개의 key 를 바꾸면 저장된 계획이 깨진다.
let SIM_TASKS = LEGACY_SIM_TASKS.slice();
let SIM_GROUPS = BASE_SIM_GROUPS.map(g => ({ ...g, ids: g.ids.slice() }));

// ⏳ '시간으로 잡는 업무' — 처리량(개수)이 없고 얼마나 오래 붙어 있었나로만 남는 업무.
//    UPH를 낼 수 없으므로 수량 대신 '투입시간(분)'으로 넣고, 그 시간을 총 소요시간에 더한다.
//    목록을 코드에 박지 않고, 실제 업무 기록에서 '자주·오래 하는 순서'로 뽑는다.
//    (관리자 설정에 simTimeTasks 배열이 있으면 그 목록을 그대로 쓴다)
let SIM_TIME_TASKS = [];

const TIME_TASK_MAX = 12;             // 화면에 세울 최대 항목 수
const TIME_TASK_MIN_AVG_MIN = 3;      // 근무일 1일 평균 3분 미만이면 뺀다(잡음 제거)
const TIME_TASK_MIN_DAYS = 3;         // 한 번 크게 한 일회성 업무를 거른다(진행일 3일 이상)
const TIME_TASK_RARE_RATIO = 0.3;     // 진행일이 근무일의 30% 미만이면 '가끔 하는 업무'로 따로 묶는다
// 근태로 이미 가용 인원에서 빠지는 항목 · 시뮬레이션 대상이 아닌 항목
const TIME_TASK_EXCLUDE = new Set(['매장근무', '출장', '연차', '휴직', '결근', '교육']);
// 🙋 기본 0명으로 두는 업무 — 목록에는 두되, 자동 추정은 0명·0분으로 잡는다.
//    매일 하는 일이 아니거나 그날 붙을 사람이 정해져 있어서, 평균으로 미리 깔아 두면
//    계획 시간만 부풀린다. 필요한 날에 인원을 올리면 '1인 기준 시간 × 인원'으로 살아난다.
//    설정값 simTimeTasksZero(업무명 배열)로 바꿀 수 있다 — []로 두면 자동 추정으로 돌아간다.
//    ⚠️ 연동 물량이 있는 업무('직진배송 사전작업' 등)는 이 목록에 넣지 말 것 — dep 추정이
//       통째로 무력화되고, 0명 저장값이 선행 신호(precursorStateFor)까지 '안 했음'으로 뒤틀어
//       다음 근무일 출고가 0으로 잡힌다. 아래 분기에서 한 번 더 막는다.
// 📌 늘 보여야 하는 주요 업무 — 자동값 그대로여도 접지 않는다.
//    매일 눈으로 확인하는 숫자라, 접히면 '고칠 것이 없다' 가 아니라 '안 보인다' 로 느껴진다.
//    관리자 설정 simAlwaysShowTasks 로 덮을 수 있다.
const DEFAULT_SIM_ALWAYS_TASKS = ['국내배송', '직진배송', '에이블리배송', '중국제작'];
let warnedAlwaysCfg = false;
const simAlwaysTasks = () => {
    const cfg = State.appConfig?.simAlwaysShowTasks;
    if (cfg != null && !Array.isArray(cfg)) {
        if (!warnedAlwaysCfg) {
            warnedAlwaysCfg = true;
            console.warn('simAlwaysShowTasks 는 업무명 배열이어야 합니다. 기본값을 씁니다:', cfg);
        }
    }
    const list = Array.isArray(cfg) ? cfg : DEFAULT_SIM_ALWAYS_TASKS;
    return new Set(list.map(k => String(k == null ? '' : k).trim()).filter(Boolean));
};

const DEFAULT_SIM_ZERO_TASKS = ['청소', '앵글정리'];
let warnedZeroCfg = false;
const simZeroTasks = () => {
    const cfg = State.appConfig?.simTimeTasksZero;
    if (cfg != null && !Array.isArray(cfg)) {
        if (!warnedZeroCfg) { warnedZeroCfg = true; console.warn('simTimeTasksZero 는 업무명 배열이어야 합니다. 기본값을 씁니다:', cfg); }
    }
    const list = Array.isArray(cfg) ? cfg : DEFAULT_SIM_ZERO_TASKS;
    // 업무명은 저장할 때 trim 되므로 설정값도 같이 다듬는다(끝 공백 하나로 조용히 안 맞는 걸 막는다)
    return new Set(list.map(k => String(k == null ? '' : k).trim()).filter(Boolean));
};

// ───────────────────────────────────────────────────────────
// 수량형 업무 목록 자동 구성
// ───────────────────────────────────────────────────────────
const SIM_WINDOW_DAYS = 56;           // '최근에 실제로 한 업무' 판정 구간

// 이력은 배열 길이를 바꾸지 않고 제자리 갱신된다(과거 날짜 물량 정정 등).
// 길이만 시그니처로 쓰면 캐시가 세션 내내 굳으므로 내용까지 훑는다.
// 경로마다 다시 세지 않도록 ensureSimTasks 에서 한 번만 갱신해 공유한다.
let historySigValue = '0';
const refreshHistorySig = () => {
    const data = State.allHistoryData;
    const today = getTodayDateString();
    // 합으로 누르면 '직진배송 100 → 에이블리 100' 처럼 총량이 같은 정정을 못 잡는다.
    // 업무명·물량·근무기록(업무·시간)을 순서대로 섞는다.
    let h = 7;
    const mix = (v) => {
        const str = String(v == null ? '' : v);
        for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
        h = (h * 31 + 1) | 0;
    };
    let n = 0;
    (Array.isArray(data) ? data : []).forEach(d => {
        if (typeof d?.id !== 'string' || d.id > today) return;
        n++;
        mix(d.id);
        (d.workRecords || []).forEach(r => { mix(r?.task); mix(r?.duration); });
        Object.entries(d.taskQuantities || {}).forEach(([k, v]) => { mix(k); mix(v); });
    });
    historySigValue = `${n}:${h}:${today}`;
    return historySigValue;
};
const LEGACY_SIM_KEYS = new Set(LEGACY_SIM_TASKS.map(t => t.key));

/** 업무명 → DOM/맵에 쓸 id. 한글은 살리고 나머지 기호는 뗀다('상.하차' → 'k상하차').
 *  ⚠️ 이 id 는 getElementById 로만 쓸 것 — querySelector('#...') 는 한글 id 에서 깨진다. */
const safeTaskId = (key, used) => {
    let base = 'k' + String(key).replace(/[^0-9A-Za-z가-힣]/g, '');
    if (base === 'k') {
        let h = 7;
        for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) | 0;
        base = 'k' + Math.abs(h);
    }
    let id = base, n = 2;
    while (used.has(id)) id = `${base}_${n++}`;
    used.add(id);
    return id;
};

/** 최근 구간의 업무별 처리량 합계 */
const recentQtyTotals = (historyData) => {
    const out = new Map();
    const today = getTodayDateString();
    recentDays(historyData, SIM_WINDOW_DAYS, today).forEach(d => {
        if (typeof d?.id !== 'string' || d.id > today) return;   // 미래 날짜 문서는 실적이 아니다
        Object.entries(d?.taskQuantities || {}).forEach(([k, v]) => {
            const q = Number(v) || 0;
            if (q > 0) out.set(k, (out.get(k) || 0) + q);
        });
    });
    return out;
};

/** 📦 자동으로 목록에 붙는 물량 업무의 추정 방식 지정.
 *  기본은 'cadence'(빈도형)인데, 입고 박스 수처럼 확실한 근거가 있으면 그것을 쓴다.
 *  'incoming-boxes:중국제작' 처럼 콜론 뒤에 '어느 입고에 연동할지'를 함께 적는다
 *  — 연동 업무명을 코드에 숨겨 두면, 다른 업무를 이 모드로 지정했을 때 엉뚱한 입고에 붙는다.
 *  설정값 simAutoModes({업무명: 모드}) 로 바꿀 수 있다. */
const DEFAULT_SIM_AUTO_MODES = { '상.하차': 'incoming-boxes:중국제작' };
const AUTO_MODES = new Set(['ai', 'incoming', 'china-linked', 'incoming-boxes', 'cadence', 'last7']);
/** 📦 '다음날 상차'를 만드는 출고 업무 — 설정값 simLoadoutSources 로 바꿀 수 있다. */
const DEFAULT_LOADOUT_SOURCES = ['직진배송', '에이블리배송'];
const loadoutSourceTasks = () => {
    const cfg = State.appConfig?.simLoadoutSources;
    const list = Array.isArray(cfg) ? cfg : DEFAULT_LOADOUT_SOURCES;
    return list.map(k => String(k == null ? '' : k).trim()).filter(Boolean);
};
let warnedAutoMode = false;
/** 'incoming-boxes:중국제작' → { mode:'incoming-boxes', arg:'중국제작' } */
const parseAutoMode = (raw) => {
    const str = String(raw == null ? '' : raw).trim();
    const i = str.indexOf(':');
    const mode = (i < 0 ? str : str.slice(0, i)).trim();
    const arg = i < 0 ? '' : str.slice(i + 1).trim();
    if (!AUTO_MODES.has(mode)) {
        // 오타 하나가 조용히 'last7'(매일 하는 날 물량)로 떨어지면 계획이 몇 배로 부푼다
        if (mode && !warnedAutoMode) {
            warnedAutoMode = true;
            console.warn(`simAutoModes 에 모르는 추정 방식이 있습니다: '${mode}'. 'cadence' 로 대신합니다.`,
                         [...AUTO_MODES]);
        }
        return { mode: 'cadence', arg: '' };
    }
    return { mode, arg };
};
const autoModeFor = (taskKey) => {
    const key = String(taskKey == null ? '' : taskKey).trim();
    const cfg = State.appConfig?.simAutoModes;
    if (cfg && typeof cfg === 'object' && typeof cfg[key] === 'string') return cfg[key];
    return DEFAULT_SIM_AUTO_MODES[key] || 'cadence';
};

/** 기존 10개 + (관리자에 '처리량 업무'로 등록됐고 최근 물량이 잡힌 업무).
 *  등록만 되고 최근 실적이 없는 업무는 넣지 않는다 — 빈 칸만 늘면 더 읽기 어렵다. */
const buildSimTasks = (historyData, appConfig) => {
    const list = LEGACY_SIM_TASKS.slice();
    const used = new Set(LEGACY_SIM_TASKS.map(t => t.id));
    const totals = recentQtyTotals(historyData);
    const registered = new Set(appConfig?.quantityTaskTypes || []);
    getAllTaskKeys(appConfig).forEach(key => {
        if (LEGACY_SIM_KEYS.has(key) || TIME_TASK_EXCLUDE.has(key)) return;
        if (!registered.has(key)) return;
        if (!((totals.get(key) || 0) > 0)) return;
        // 새 업무의 기본 추정은 'cadence' — 안 하는 날은 0으로 잡혀 화면에서 접힌다.
        // 표본이 적으면 cadenceValueFor 가 알아서 지난 7회 평균으로 떨어진다.
        // 확실한 근거가 있는 업무(상.하차 ← 입고 박스 수)는 그 방식을 쓴다.
        list.push({ id: safeTaskId(key, used), key, label: key, auto: autoModeFor(key) });
    });
    return list;
};

let simTasksSig = null;

/** 수량형 목록 갱신. 목록이 바뀌면 true (입력칸을 다시 그려야 한다).
 *  ⚠️ appConfig·업무이력이 늦게 도착하므로 모듈 최상위에서 한 번 만들면 안 된다. */
const ensureSimTasks = () => {
    const cfg = State.appConfig;
    const data = State.allHistoryData;
    // auto 모드가 설정 의존값이 됐으므로 시그니처·비교에 모두 넣는다.
    // (id 목록만 비교하면 '상.하차를 cadence로 되돌리기' 같은 설정 변경이 새로고침 전까지 안 먹는다)
    const sig = [(cfg?.quantityTaskTypes || []).join('|'),
                 JSON.stringify(cfg?.simAutoModes || null),
                 refreshHistorySig()].join('#');
    if (sig === simTasksSig) return false;
    simTasksSig = sig;

    const next = buildSimTasks(data, cfg);
    const shape = (arr) => arr.map(t => `${t.id}:${t.auto}`).join('|');
    if (shape(next) === shape(SIM_TASKS)) return false;
    SIM_TASKS = next;

    // 어느 구획에도 안 들어간 업무는 조용히 화면에서 사라진다 → 남는 건 뒤에 모아 붙인다
    SIM_GROUPS = BASE_SIM_GROUPS.map(g => ({ ...g, ids: g.ids.slice() }));
    // 입고에 연동되는 업무는 '가끔 하는 업무'가 아니다 — 입고·제작 구획에 붙인다
    const incomingGroup = SIM_GROUPS.find(g => g.label === '입고 · 제작');
    SIM_TASKS.forEach(t => {
        if (parseAutoMode(t.auto).mode !== 'incoming-boxes') return;
        if (!incomingGroup || incomingGroup.ids.includes(t.id)) return;
        if (BASE_SIM_GROUPS.some(g => g.ids.includes(t.id))) return;
        incomingGroup.ids.push(t.id);
    });
    const placed = new Set(SIM_GROUPS.flatMap(g => g.ids));
    const extras = SIM_TASKS.filter(t => !placed.has(t.id)).map(t => t.id);
    if (extras.length > 0) SIM_GROUPS.push({ label: '가끔 하는 업무', ids: extras });
    return true;
};

/** 업무 기록에서 시간형 업무 후보를 뽑는다 — 수량으로 잡히는 업무는 제외(그쪽은 UPH로 계산). */
const buildTimeTaskList = (historyData, appConfig, windowDays = 56) => {
    const manual = appConfig?.simTimeTasks;
    // 수량형으로 확정된 업무만 뺀다.
    // (quantityTaskTypes 전체를 빼면, 등록만 돼 있고 물량 기록이 없어 수량형에도 못 들어간 업무가
    //  양쪽에서 모두 빠져 계획 시간이 통째로 사라진다)
    const qtyKeys = new Set(SIM_TASKS.map(t => t.key));

    const used = new Set();
    const toEntry = (key, rare = false) => ({ id: safeTaskId(key, used), key, label: key, rare });
    if (Array.isArray(manual) && manual.length > 0) {
        return manual.filter(k => k && !qtyKeys.has(k)).slice(0, TIME_TASK_MAX).map(k => toEntry(k));
    }

    const today = getTodayDateString();
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - windowDays);
    const cutoffStr = ymd(cutoff);
    const days = (historyData || [])
        .filter(d => d && typeof d.id === 'string' && d.id >= cutoffStr && d.id <= today)
        .filter(d => (d.workRecords || []).length > 0);
    if (days.length === 0) return [];

    // 업무별 총 투입시간 · 진행 일수
    const agg = new Map();
    days.forEach(d => {
        const seen = new Set();
        (d.workRecords || []).forEach(r => {
            const key = r && r.task;
            if (!key || qtyKeys.has(key) || TIME_TASK_EXCLUDE.has(key)) return;
            const cur = agg.get(key) || { minutes: 0, days: 0 };
            cur.minutes += Number(r.duration) || 0;
            if (!seen.has(key)) { cur.days += 1; seen.add(key); }
            agg.set(key, cur);
        });
    });

    return [...agg.entries()]
        .map(([key, v]) => ({ key, avg: v.minutes / days.length, days: v.days, minutes: v.minutes }))
        .filter(x => x.avg >= TIME_TASK_MIN_AVG_MIN && x.days >= TIME_TASK_MIN_DAYS)
        .sort((a, b) => b.minutes - a.minutes)      // 오래 걸리는 업무부터
        .slice(0, TIME_TASK_MAX)
        .map(x => toEntry(x.key, x.days < days.length * TIME_TASK_RARE_RATIO));
};

const timeTaskSig = (arr) => arr.map(t => t.key + (t.rare ? '*' : '')).join('|');

/** 시간형 업무 목록 갱신. 목록이 바뀌면 true (입력칸을 다시 그려야 한다) */
const refreshTimeTasks = () => {
    const next = buildTimeTaskList(State.allHistoryData, State.appConfig);
    if (timeTaskSig(next) === timeTaskSig(SIM_TIME_TASKS)) return false;
    SIM_TIME_TASKS = next;
    return true;
};

/** 계산에 쓸 시간형 업무 — 수량형에 이미 들어간 업무는 뺀다.
 *  목록은 만들어진 시점의 SIM_TASKS 로만 걸러지므로, 나중에 수량형이 늘어나면
 *  같은 업무가 양쪽에 남아 시간이 두 번 더해진다. 여기서 한 번 더 막는다. */
const activeTimeTasks = () => {
    const qty = new Set(SIM_TASKS.map(t => t.key));
    return SIM_TIME_TASKS.filter(t => !qty.has(t.key));
};

let timeListSig = null;
let timeListBuilt = false;
let simInputsStale = false;   // 목록이 바뀌었는데 입력칸은 아직 옛 세대

/** 수량형 → 시간형 순으로 목록을 맞춘다(시간형은 수량형 키를 빼고 뽑으므로 순서가 중요).
 *  ⚠️ '비어 있을 때만 다시 뽑기'로 두면, 관리자가 simTimeTasks 를 고치거나 날이 바뀌어도
 *     목록이 옛것으로 굳어 화면마다 계획 총시간이 달라진다. 자체 시그니처로 판단한다.
 *  반환: 목록이 바뀌었는가 (입력칸을 다시 그려야 하는지) */
const ensureSimLists = (force = false) => {
    const qtyChanged = ensureSimTasks();
    const cfg = State.appConfig;
    const sig = [
        historySigValue,
        Array.isArray(cfg?.simTimeTasks) ? cfg.simTimeTasks.join('|') : ''
        // ※ simTimeTasksZero 는 여기 넣지 않는다 — 목록 구성(buildTimeTaskList)에는 쓰이지 않고,
        //    값은 autoTimeValueFor 가 매번 State.appConfig 에서 직접 읽으므로 화면 간 차이가 없다.
    ].join('#');
    const stale = force || qtyChanged || sig !== timeListSig || !timeListBuilt;
    timeListSig = sig;
    let timeChanged = false;
    if (stale) { timeChanged = refreshTimeTasks(); timeListBuilt = true; }
    const changed = timeChanged || qtyChanged;
    // 계획 화면을 안 거치는 경로(대시보드 띠·인력 운영·정확도)에서 목록이 바뀌면
    // 입력칸은 옛 세대 그대로다 — 계획 화면으로 돌아올 때 다시 그리도록 표시해 둔다.
    if (changed && document.getElementById('sim-task-list')?.dataset.built === 'true') simInputsStale = true;
    return changed;
};

/** 저장해 둔 시간형 업무 값(수기). 없으면 null → 실적 평균으로 폴백 */
const getPlannedTime = (dateStr, taskKey) => {
    const m = getPlannedTimeTasksForDate(dateStr) || {};
    if (!Object.prototype.hasOwnProperty.call(m, taskKey)) return null;
    const e = m[taskKey] || {};
    const minutes = Math.round(Number(e.minutes));
    if (!Number.isFinite(minutes) || minutes < 0) return null;
    return { minutes, workers: Math.max(0, Math.round(Number(e.workers) || 0)) };
};

const LEAVE_OFF_TYPES = new Set(['연차', '결근', '휴직', '출장', '매장근무']);
const UTILIZATION = 0.8;
// 업무 제외시간 입력 단위(분)
const EXCLUDE_STEP_MIN = 10;

// 로컬 컴포넌트 기반 YYYY-MM-DD (toISOString은 UTC라 KST에서 하루씩 밀림)
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const addDays = (dateStr, n) => {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return ymd(d);
};
const isWeekendDate = (dateStr) => {
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    return dow === 0 || dow === 6;
};
/** 법정 공휴일인가 */
const isHolidayDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return false;
    return !!getHolidayName(d.getFullYear(), d.getMonth() + 1, d.getDate());
};
/** 쉬는 날(주말·공휴일) */
const isOffDay = (dateStr) => isWeekendDate(dateStr) || isHolidayDate(dateStr);
/** 기준일 다음의 첫 근무일 — 주말·공휴일은 건너뛴다(연휴가 길어도 최대 14일까지 찾는다) */
const nextWorkingDay = (fromDateStr, maxSteps = 14) => {
    let d = addDays(fromDateStr, 1);
    for (let i = 0; i < maxSteps && isOffDay(d); i++) d = addDays(d, 1);
    return d;
};
/** 기준일 직전의 첫 근무일 — 주말·공휴일은 건너뛴다 */
const prevWorkingDay = (fromDateStr, maxSteps = 14) => {
    let d = addDays(fromDateStr, -1);
    for (let i = 0; i < maxSteps && isOffDay(d); i++) d = addDays(d, -1);
    return d;
};
const dayLabel = (dateStr) => {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const d = new Date(dateStr + 'T00:00:00');
    return isNaN(d.getTime()) ? dateStr : `${dateStr} (${days[d.getDay()]})`;
};

/** 🧊 오늘 실적을 비운 기록으로 fn 을 한 번 돌린다 — **자동 계획 스냅샷 전용**.
 *
 *  왜 이렇게 하는가
 *    계획 스냅샷은 '그날 아침의 예상치'여야 한다. 그런데 자동 추정값은 오늘 실적을 여러 경로로
 *    끌어온다 — autoValueFor 의 1순위 실측, analyzeCadence 의 '하는 날 물량'과 마지막 진행일,
 *    국내배송 AI 의 오늘 실측 우선, 시간형 업무의 최근 평균, 샘플검수 비율까지.
 *    실적을 계획으로 얼리면 계획 = 실적이 되어 정확도가 늘 100% 로 나온다(측정이 무의미해진다).
 *
 *  왜 함수마다 플래그를 넘기지 않는가
 *    경로가 8곳이 넘고, 하나만 빠뜨려도 조용히 왜곡된 계획이 **영구 저장**된다(그날이 지나면
 *    되돌릴 수 없다). 들어오는 자료를 한 곳에서 비우면 모든 경로가 동시에 막힌다.
 *
 *  ⚠️ State.allHistoryData 를 잠깐 바꿔치기한다. 이유: analyzeCadence·workDayMap·weekPlanFor 등의
 *     캐시 키가 historySigValue 이고, 그 값은 인자가 아니라 State.allHistoryData 에서 나온다.
 *     인자만 바꿔 넘기면 **비운 결과가 평소 서명으로 캐시돼 화면 전체를 오염시킨다.**
 *     그래서 바꿔치기 + refreshHistorySig() 로 서명까지 함께 바꾼다.
 *  ⚠️ fn 은 **반드시 동기 함수**여야 한다. await 가 끼면 그 사이 다른 코드가 비워진 기록을 본다.
 *     (비동기를 넘기면 던진다 — 조용히 틀리는 것보다 낫다)
 *  ⚠️ fn 안에서 ensureSimTasks()·ensureSimLists() 를 부르지 않는다. 그 함수들이 목록 서명을
 *     저장하므로, 비워진 기록으로 만든 업무 목록이 그대로 굳는다(오늘만 물량이 있는 신규
 *     업무가 목록에서 빠진다). 업무 목록은 비우기 **전에** 맞춰 둔다.
 */
const 오늘실적_없이 = (fn) => {
    const arr = State.allHistoryData;
    if (!Array.isArray(arr)) return fn();
    const today = getTodayDateString();
    const 바꾼곳 = [];
    try {
        // state.js 의 allHistoryData 는 const 배열(제자리 수정)이라 재할당할 수 없다.
        // 오늘 항목 하나만 바꿔 끼우고 끝나면 되돌린다 — 길이는 건드리지 않는다.
        for (let i = 0; i < arr.length; i++) {
            const d = arr[i];
            if (!d || d.id !== today) continue;
            바꾼곳.push([i, d]);
            arr[i] = {
                ...d,
                taskQuantities: {}, workRecords: [],
                // '0 으로 확정' 표시도 오늘의 실적이다. 남겨 두면 qtyZeroConfirmed 가 true 가 되고,
                // weekPlanFor 가 오늘을 '이미 끝난 날'로 보아 빈도형 업무가 계획 0 으로 얼려진다
                // (isQuantityVerified 가 켜져 있으면 전 업무가 한꺼번에 0 이 된다).
                confirmedZeroTasks: [], isQuantityVerified: false
            };
        }
        refreshHistorySig();
        const r = fn();
        // 비동기 fn 이면 finally 가 먼저 돌아 평소 데이터로 계산된다 — 조용히 틀리는 대신 터뜨린다
        if (r && typeof r.then === 'function') throw new Error('오늘실적_없이: fn 은 동기 함수여야 합니다');
        return r;
    } finally {
        바꾼곳.forEach(([i, d]) => { arr[i] = d; });
        refreshHistorySig();
    }
};

/** 작업별 최근 4주 UPH(개/시) = Σ 처리량 ÷ Σ 그 작업 투입시간.
 *  계산 자체는 js/task-throughput.js 한 곳에 모여 있다(화면마다 다른 답이 나오지 않도록). */
const UPH_MIN_MINUTES_NEW = 60;   // 새로 편입된 업무의 최소 표본(최근 4주 총 투입시간)

// 빈도형 업무 판정 기준 — '그날 진행할 확률'을 요일 + 연속성으로 추정한다.
//   과거 데이터 검증: 날짜 적중은 정밀도 66% / 재현율 61%가 한계다(주간 횟수는 잘 맞는다).
//   그래서 확실한 날만 물량을 넣고, 애매한 날은 0으로 두되 '진행 시' 결과를 따로 보여준다.
const HAZARD_MAX_GAP = 5;         // 마지막 진행 후 5근무일 이상은 한 칸으로 묶어 본다
const CADENCE_ON_P = 0.6;         // 이 확률 이상이면 '하는 날'로 보고 물량을 넣는다
const CADENCE_OFF_P = 0.3;        // 이 확률 이하면 '안 하는 날'
const CADENCE_MIN_HITS = 4;       // 판정에 필요한 최소 진행 횟수
// 창 길이: 패턴(요일·연속성)은 최근 40근무일, '하는 날 물량'은 최근 5회 진행분.
// 빈도보다 물량이 먼저 변한다(예: 채우기는 최근 한 달 하는 날 물량이 437 → 68로 줄었다).
const CADENCE_PATTERN_DAYS = 40;
const CADENCE_QTY_HITS = 5;       // '하는 날 물량'은 최근 5회 진행분으로 낸다
// 🔁 선행 업무(사전작업) 신호 — 전 근무일에 준비를 했는지로 그날 진행 여부를 가른다.
//    실측(최근 60근무일, 직진배송): 전날 사전작업 O → 98% 진행 / X → 30%. 에이블리도 67% / 20%.
const PRECURSOR_MIN_TOTAL = 3;    // 배율 보정에 필요한 최소 표본(3·4·2 비교 결과 3이 가장 나았다)
// '준비만 하고 출고 없던 날' 다음을 확정으로 보려면 표본이 이만큼 있어야 한다.
// 2로 두면 진행률 67% 업무도 0.67²≈45% 확률로 우연히 '반례 0'이 되어 확정 판정이 오작동한다.
const PRECURSOR_SURE_MIN = 4;

const computeTaskUPHs = (historyData) => {
    const today = getTodayDateString();
    const days = recentDays(historyData, 28, today);
    // ⚠️ 합계(Σ물량÷Σ시간)가 아니라 '하루 속도의 가운데값'을 쓴다.
    //    기록을 시작하고 '종료'를 안 누른 건이 쌓여 있어(전체 830건·2,374시간),
    //    그런 날은 그 업무 시간이 하루 끝까지 잡혀 분모가 통째로 부푼다.
    //    합계는 그 하루에 그대로 끌려간다 — 실측: 에이블리배송 49.8 (실제 100 안팎),
    //    상.하차 62.9 (실제 92), 반대로 시간 기록이 빠진 날 때문에 직진배송은 143 (실제 123).
    //    검증(최근 30근무일): 물량을 시간으로 바꿀 때의 오차 23.96h → 20.77h,
    //    '종료된 기록만'을 실제로 보면 17.86h → 13.74h.
    //    minMinutes 10 — 몇 분짜리 기록 하나가 극단적인 속도를 만드는 것을 막는다.
    //    skipDate — 오늘은 물량이 덜 차 있어 속도가 튄다.
    //    minSamples 3 — 표본 1~2개짜리 중앙값은 이상치 저항이 0 이라, 그럴 땐 합계로 돌아간다
    //    (실측: 로케이션 동선관리는 표본 2일뿐이라 중앙값이 합계의 절반으로 튀었다)
    const uph = taskUph(days, {
        mode: 'dailyMedian', minMinutes: 10, skipDate: today, minSamples: 3,
        tasks: new Set(SIM_TASKS.map(t => t.key))
    });

    // 새로 편입된 업무는 표본이 몇 분뿐이면 속도가 수십 배로 튀어, 계획 시간이
    // 비현실적으로 짧게 잡힌다. 표본이 모자라면 '기준 없음'(0)으로 둔다.
    // 기존 10개는 지금까지의 값을 그대로 유지한다(회귀 방지).
    const minutes = {};
    days.forEach(d => {
        // UPH 표본과 같은 기준으로 센다 — 오늘은 물량이 덜 차 있어 표본에서 뺐다.
        // 여기만 오늘을 세면 '오늘 진행 중인 시간'으로 최소표본을 통과해 보호가 헐거워진다.
        if (!d || d.id === today) return;
        (d.workRecords || []).forEach(r => {
            const m = Number(r?.duration) || 0;
            if (r?.task && m > 0) minutes[r.task] = (minutes[r.task] || 0) + m;
        });
    });
    Object.keys(uph).forEach(k => {
        if (LEGACY_SIM_KEYS.has(k)) return;
        if ((minutes[k] || 0) < UPH_MIN_MINUTES_NEW) uph[k] = 0;
    });
    return uph;
};

/** 샘플검수 비율 = 최근 4주에서 중국제작 > 0 인 날들의 (Σ샘플검수 ÷ Σ중국제작).
 *  중국제작 입고가 있는 날에만 샘플검수가 생기므로, 그 비율로 입고량에서 역산한다. */
const computeSampleRatio = (historyData) => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 28);
    const cutoffStr = ymd(cutoff);
    const recent = (historyData || []).filter(d => typeof d.id === 'string' && d.id >= cutoffStr);
    let chinaSum = 0, sampleSum = 0;
    recent.forEach(d => {
        const china = Number(d.taskQuantities?.['중국제작']) || 0;
        if (china > 0) {
            chinaSum += china;
            sampleSum += Number(d.taskQuantities?.['샘플검수']) || 0;
        }
    });
    return chinaSum > 0 ? sampleSum / chinaSum : 0;
};

/** ⏳ 시간형 업무의 실적 통계 — 최근 4주(근무 기록이 있는 날)의 실제 투입시간.
 *   avgMinutes : 근무일 1일 평균 투입시간(인분). 일이 없던 날의 0도 포함해 평균낸다
 *                — 매일 하는 일이 아니어도 기간 총량이 맞도록.
 *   workers    : 그 업무를 한 날의 평균 투입 인원(동시에 몇 명이 붙는지)
 *   maxMinutes : 가장 많이 쓴 날 (편차를 알려주기 위한 참고값)
 */
const computeTimeTaskStats = (historyData, taskKey, windowDays = 28, dayFilter = null) => {
    const today = getTodayDateString();
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - windowDays);
    const cutoffStr = ymd(cutoff);
    let days = (historyData || [])
        .filter(d => d && typeof d.id === 'string' && d.id >= cutoffStr && d.id <= today)
        .filter(d => (d.workRecords || []).length > 0);
    // 연동 업무가 있는 날에만 생기는 업무는 그런 날만 모아 평균을 낸다
    // (전체 근무일로 나누면 '입고 있는 날'의 실제 소요보다 훨씬 작게 나온다)
    if (typeof dayFilter === 'function') days = days.filter(dayFilter);
    if (days.length === 0) return null;

    let sumMin = 0, hitDays = 0, maxMin = 0, workerSum = 0, perPersonSum = 0;
    days.forEach(d => {
        let m = 0;
        const members = new Set();
        (d.workRecords || []).forEach(r => {
            if (!r || r.task !== taskKey) return;
            m += Number(r.duration) || 0;
            if (r.member) members.add(r.member);
        });
        sumMin += m;
        if (m > 0) {
            const n = Math.max(1, members.size);
            hitDays++; maxMin = Math.max(maxMin, m / n); workerSum += n;
            perPersonSum += m / n;               // 그날 '1인이 쓴 시간'
        }
    });

    if (hitDays === 0) return { avgMinutes: 0, hitAvgMinutes: 0, teamMinutes: 0, workers: 1, hitDays: 0, sampleDays: days.length, maxMinutes: 0 };
    const r10 = (x) => Math.round(x / 10) * 10;
    return {
        // 입력 단위는 '1인 기준' — 여러 명이 나눠 한 날도 한 사람이 쓴 시간으로 환산한다
        avgMinutes: r10(perPersonSum / days.length),
        // '그 업무를 한 날'만 모은 1인 평균. 기본 0명인 업무에 인원을 올릴 때 쓴다
        // (전체 근무일로 나눈 평균을 쓰면 '오늘 한다'고 정한 날의 실제 소요보다 훨씬 작다)
        hitAvgMinutes: r10(perPersonSum / hitDays),
        teamMinutes: r10(sumMin / days.length),       // 참고: 팀 전체 합계(인분)
        workers: Math.max(1, Math.round(workerSum / hitDays)),
        hitDays, sampleDays: days.length,
        maxMinutes: Math.round(maxMin)
    };
};

/** 대상일의 시간형 업무 값 — 저장한 수기값 › 실적 평균 */
/** 🔗 물량 업무와 묶인 담당 업무 — 그 물량이 있는 날에만 생긴다.
 *  (중국제작 입고가 없으면 '중국제작(담당)'도 없고, 직진·에이블리 출고가 없으면 사전작업도 없다)
 *  관리자 설정 simTimeTaskDeps 로 덮어쓸 수 있고, 없으면 업무명에 물량 업무명이 들어간 경우를 자동으로 잇는다.
 */
const DEFAULT_TIME_TASK_DEPS = {
    '중국제작(담당)': ['중국제작'],
    '직진배송 사전작업': ['직진배송', '에이블리배송']
};

const timeTaskDeps = (taskKey) => {
    const cfg = State.appConfig?.simTimeTaskDeps;
    if (cfg && Array.isArray(cfg[taskKey])) return cfg[taskKey];
    if (DEFAULT_TIME_TASK_DEPS[taskKey]) return DEFAULT_TIME_TASK_DEPS[taskKey];
    // 이름에 물량 업무명이 들어 있으면 그 업무와 묶는다 (예: 'OO 사전작업', 'OO(담당)')
    // ⚠️ 기존 10개로만 판단한다. 목록 전체를 대상으로 하면 새로 편입된 업무에 우연히 이름이
    //    걸려, 그 업무 물량이 0인 날 시간이 통째로 사라진다(조용히 틀리는 유형).
    const hit = LEGACY_SIM_TASKS.find(t => taskKey !== t.key && taskKey.includes(t.key));
    return hit ? [hit.key] : [];
};

/** 🔁 '전날 준비 → 다음 근무일 출고' 인 담당 업무.
 *  직진배송 사전작업은 그날 나갈 물건이 아니라 '다음 근무일에 나갈 물건'을 준비한다.
 *  (실측 최근 40근무일: 다음날 물량 기준이 정밀 94%/재현 100%, 같은날 기준은 79%/87%.
 *   같은날 기준으로만 보면 준비만 하고 출고가 없는 날의 시간이 통째로 빠진다 — 최근 18%)
 *  관리자 설정 simTimeTaskDepsNextDay(업무명 배열)로 바꿀 수 있다. */
const DEFAULT_TIME_TASK_DEPS_NEXTDAY = ['직진배송 사전작업'];
let warnedNextDayCfg = false;
const isNextDayDep = (taskKey) => {
    const cfg = State.appConfig?.simTimeTaskDepsNextDay;
    if (cfg != null && !Array.isArray(cfg)) {
        // 형식이 어긋난 설정은 조용히 기본값으로 되돌아간다 — 바꿨다고 오해하지 않도록 알린다
        if (!warnedNextDayCfg) { warnedNextDayCfg = true; console.warn('simTimeTaskDepsNextDay 는 업무명 배열이어야 합니다. 기본값을 씁니다:', cfg); }
    }
    const list = Array.isArray(cfg) ? cfg : DEFAULT_TIME_TASK_DEPS_NEXTDAY;
    return list.includes(taskKey);
};

/** 🔁 선행 업무 → 다음 근무일에 생기는 물량 업무 (위 관계의 반대 방향).
 *  전 근무일에 사전작업을 했으면 그날 출고가 나간다 — 특히 '사전작업만 하고 출고가 없던 날'
 *  다음은 실측 4/4로 반드시 나갔다. 관리자 설정 simPrecursorTasks 로 덮어쓸 수 있다. */
const DEFAULT_SIM_PRECURSORS = {
    '직진배송': ['직진배송 사전작업'],
    '에이블리배송': ['직진배송 사전작업']
};
const precursorMap = () => {
    const cfg = State.appConfig?.simPrecursorTasks;
    return (cfg && typeof cfg === 'object') ? { ...DEFAULT_SIM_PRECURSORS, ...cfg } : DEFAULT_SIM_PRECURSORS;
};
const precursorTasks = (taskKey) => {
    const v = precursorMap()[taskKey];
    return Array.isArray(v) ? v : [];
};
/** 그 선행 업무가 준비하는 물량 업무들 — 선행관계의 역방향에서 구한다.
 *  simTimeTaskDeps(사전작업 시간 계산용)와 엮으면 한쪽을 바꿀 때 다른 쪽 판정이 같이 뒤틀린다.
 *  ⚠️ 설정으로 한 업무의 선행관계를 지우면(예: {'직진배송': []}) 같은 사전작업을 공유하는
 *     다른 업무('에이블리배송')의 ready/with 판정 기준도 함께 바뀐다. 전체를 끄려면 두 키 모두 [] 로. */
const precursorOutputs = (preKeys) => {
    const map = precursorMap();
    return Object.keys(map).filter(qk => Array.isArray(map[qk]) && map[qk].some(k => preKeys.includes(k)));
};

/** 내용이 들어 있는 날 → 그 날의 문서. 이력이 바뀔 때만 다시 만든다.
 *  ⚠️ 캐시 키가 historySigValue 다 — 이 함수를 부르는 새 경로를 만들 때는 앞단에서
 *     ensureSimTasks()(또는 ensureSimLists())를 먼저 태울 것. 안 그러면 빈 맵이 굳어
 *     사전작업이 조용히 '0분 · 기록 없음'이 된다(에러가 안 난다). */
let workDayMapCache = null, workDayMapSig = '';
const workDayMap = (historyData) => {
    const today = getTodayDateString();
    const sig = `${historySigValue}#${today}`;
    if (workDayMapCache && workDayMapSig === sig) return workDayMapCache;
    const m = new Map();
    (historyData || []).forEach(d => {
        // 미래 날짜 문서가 섞이면 '오늘의 다음날'이 그 문서로 잡혀 오늘이 표본에서 빠진다
        if (!d || typeof d.id !== 'string' || d.id > today) return;
        // 판정 대상이 '물량'이므로 물량만 들어간 날(근무기록 입력 누락)도 아는 날로 본다.
        // 근무기록만 보면 그런 날 앞의 표본이 통째로 빠져 평균이 소수의 완전기록일로 계산된다.
        if ((d.workRecords || []).length > 0 || Object.keys(d.taskQuantities || {}).length > 0) m.set(d.id, d);
    });
    // 이력 서명이 아직 안 잡힌 상태(초기값)면 캐시하지 않는다 — 빈 맵이 굳는 것을 막는다
    if (historySigValue) { workDayMapCache = m; workDayMapSig = sig; }
    return m;
};

/** 연동 물량이 있는 날인지 판단하는 필터. nextDay 면 '그 날의 다음 근무일' 물량을 본다.
 *  다음 근무일 기준은 추론 쪽(autoTimeValueFor)과 같은 nextWorkingDay 정의를 쓴다 —
 *  '다음 기록일'로 세면 기록이 빠진 날이 끼었을 때 학습과 추론이 다른 날을 본다. */
const depDayFilter = (historyData, deps, nextDay) => {
    const has = (d) => deps.some(k => (Number(d?.taskQuantities?.[k]) || 0) > 0);
    if (!nextDay) return has;
    const map = workDayMap(historyData);
    return (d) => {
        if (!d || typeof d.id !== 'string') return false;
        const nx = map.get(nextWorkingDay(d.id));
        // 다음 근무일 기록이 없으면 판단할 수 없다 → 표본에서 뺀다(분모에서도 빠지므로 평균은 안 낮아진다)
        return nx ? has(nx) : false;
    };
};

/** 대상일의 담당 업무 값 — 저장값 › (연동 물량이 있을 때만) 실적 평균
 *  qtyLookup: 연동 물량을 어디서 볼지. 기본은 자동 추정값, 화면에서는 지금 입력된 값. */
const autoTimeValueFor = (dateStr, t, historyData, qtyLookup = null) => {
    const deps = timeTaskDeps(t.key);
    // '전날 준비 → 다음날 출고' 업무는 그날이 아니라 다음 근무일의 물량을 본다
    const nextDay = isNextDayDep(t.key);
    const depDate = nextDay ? nextWorkingDay(dateStr) : dateStr;
    const depWord = nextDay ? '다음 근무일 ' : '';
    const saved = getPlannedTime(dateStr, t.key);
    if (saved) {
        // 인원을 올렸을 때 시간을 다시 잡으려면 '1인 기준 시간'이 있어야 한다.
        if (saved.workers > 0) {
            return { ...saved, unitMinutes: Math.round(saved.minutes / saved.workers), source: 'planned-time' };
        }
        // 0명으로 저장해 둔 날 = 그날은 안 하는 업무. 계산도 0분이므로 화면도 0분으로 맞춘다.
        // 인원을 올렸을 때 쓸 기준은 실적 평균에서 가져오되, 연동 업무가 있으면 그 업무를 한 날만 본다
        // (전체 근무일로 나누면 실제 소요보다 훨씬 작게 나온다).
        const st = computeTimeTaskStats(historyData, t.key, 28,
            deps.length > 0 ? depDayFilter(historyData, deps, nextDay) : null);
        // {minutes>0, workers:0} 인 옛 저장값은 '여러 명이 합쳐 쓴 시간'일 수 있어 1인 기준으로 쓰면 인원배만큼 부푼다
        const unit = (st && st.avgMinutes > 0) ? st.avgMinutes : saved.minutes;
        return { minutes: 0, workers: 0, unitMinutes: unit, source: 'planned-time' };
    }

    // 다음날 물량은 화면에 입력칸이 없으므로, 그 경우엔 화면값 대신 항상 추정값을 본다
    // 🙋 기본 0명으로 두는 업무 — 저장해 둔 값이 없으면 자동 추정은 0명·0분이다.
    //    실적 평균을 깔아 두지 않는다(그만큼 계획 시간이 부푼다). 대신 '1인 기준 시간'은
    //    실적에서 가져와, 그날 인원을 올리면 바로 현실적인 시간이 잡히게 한다.
    if (simZeroTasks().has(t.key) && !nextDay) {
        const st = computeTimeTaskStats(historyData, t.key, 28,
            deps.length > 0 ? depDayFilter(historyData, deps, nextDay) : null);
        // 인원을 올린다 = '오늘 이 업무를 한다'는 뜻이므로, 기준은 '하는 날 1인 평균'이다
        const unit = (st && st.hitAvgMinutes > 0) ? st.hitAvgMinutes : 0;
        return { minutes: 0, workers: 0, unitMinutes: unit, source: 'zero-default',
                 detail: '기본 0명으로 두는 업무입니다 — 하는 날에 인원을 올리면 계획에 들어갑니다.'
                       + (unit > 0 ? ` (하는 날 1인 ${unit}분 기준)` : ' (최근 4주 기록이 없어 기준 시간 없음)')
                       + (st && st.hitDays > 0 ? ` · 최근 4주 실적은 ${st.sampleDays}일 중 ${st.hitDays}일 진행` : '') };
    }

    const lookup = (!nextDay && qtyLookup) ? qtyLookup : ((key) => {
        const task = SIM_TASKS.find(x => x.key === key);
        return task ? autoQtyFor(depDate, task, historyData) : 0;
    });

    let dayFilter = null;
    if (deps.length > 0) {
        const hasDep = deps.some(k => (Number(lookup(k)) || 0) > 0);
        if (!hasDep) {
            // 물량이 없는 날 → 인원 0명(그날은 안 함). 인원을 올리면 이 기준 시간으로 살아난다.
            const base = computeTimeTaskStats(historyData, t.key, 28, depDayFilter(historyData, deps, nextDay));
            const unit = base ? base.avgMinutes : 0;
            return { minutes: 0, workers: 0, unitMinutes: unit, source: 'record-avg',
                     detail: `${depWord}${deps.join(' · ')} 물량이 없는 날이라 인원 0명으로 둡니다.`
                           + (unit > 0 ? ` (인원을 올리면 1인 ${unit}분으로 잡힙니다)` : '') };
        }
        dayFilter = depDayFilter(historyData, deps, nextDay);
    }

    const st = computeTimeTaskStats(historyData, t.key, 28, dayFilter);
    if (!st) return { minutes: 0, workers: 0, unitMinutes: 0, source: 'record-avg', detail: '최근 4주 기록 없음' };
    // 시간·인원 모두 1명 기준 — 여러 명이 붙는 업무는 화면에서 동시 인원을 올린다
    return {
        minutes: st.avgMinutes, workers: st.avgMinutes > 0 ? 1 : 0, unitMinutes: st.avgMinutes, source: 'record-avg',
        detail: (deps.length > 0 ? `${depWord}${deps.join(' · ')} 있는 날 기준 · ` : '')
              + `${st.sampleDays}일 중 ${st.hitDays}일 진행 · 1인 기준 평균 ${st.avgMinutes}분`
              + ` (가장 많은 날 ${Math.round(st.maxMinutes)}분)`
              + ` · 실적은 평균 ${st.workers}명이 하루 ${st.teamMinutes}분(팀 합계)`
              + ` — 인원을 올리면 1인 시간만큼 총 시간이 더해집니다`
    };
};

/** 지난 7회 업무량 평균 — 그 업무가 실제로 발생한 최근 7일(물량 > 0)의 평균.
 *  달력 기준 7일이 아니라 '발생 횟수' 기준이라, 매일 잡히지 않는 업무
 *  (전량검수·국내제작·교환반품 등)도 항상 대표값을 얻을 수 있다.
 *  오늘 이후(미래) 날짜는 실적이 아니므로 제외한다. */
const computeLast7Avg = (historyData, taskKey, occurrences = 7) => {
    const today = getTodayDateString();
    const valued = (historyData || [])
        .filter(d => d && typeof d.id === 'string' && d.id <= today)
        .filter(d => Number(d.taskQuantities?.[taskKey]) > 0)
        .sort((a, b) => b.id.localeCompare(a.id))   // 최신순
        .slice(0, occurrences);

    if (valued.length === 0) return 0;
    const sum = valued.reduce((s, d) => s + (Number(d.taskQuantities[taskKey]) || 0), 0);
    return Math.round(sum / valued.length);
};


/** 🗓️ '언제 하는 업무인가' 분석 — 매일 하지 않는 업무의 예상치를 바로잡는다.
 *
 *  기존 방식(지난 7회 평균)은 '발생한 날'만 골라 평균을 낸 뒤 그 값을 매일 넣었다.
 *  3일에 한 번 하는 업무라면 예상 총량이 3배가 된다.
 *  그래서 얼마나 자주·어느 요일에 했는지를 같이 본다.
 *
 *  모집단은 '근무 기록이 있는 날'만 쓴다. 휴무일을 미발생으로 세면 빈도가 낮게 나온다.
 */
// 대상 날짜와 무관한 계산이라 업무별로 한 번만 하면 된다.
// (인원 전망은 10일치 × 업무 수만큼 부르므로, 캐시가 없으면 전체 이력을 수백 번 훑는다)
const cadenceCache = new Map();
let cadenceCacheSig = '';

// ⚠️ 캐시 키가 ensureSimTasks() 가 갱신하는 historySigValue 다 — 이 함수를 부르는 새 경로를 만들 때는
//    앞단에서 ensureSimTasks()(또는 ensureSimLists())를 먼저 태울 것. 안 그러면 캐시가 옛 값으로 굳는다.
const analyzeCadence = (historyData, taskKey, windowWorkDays = CADENCE_PATTERN_DAYS) => {
    const today = getTodayDateString();
    // 선행관계 설정도 키에 넣는다 — 설정만 바꿨을 때 옛 통계가 굳어 보정이 안 걸린다
    // simTimeTaskDeps 는 지금 이 계산에 쓰이지 않지만(precursorOutputs 로 분리),
    // 다시 엮일 때 캐시가 굳는 쪽이 더 위험하므로 방어적으로 남겨 둔다.
    const cfgSig = JSON.stringify([State.appConfig?.simPrecursorTasks || 0,
                                   State.appConfig?.simTimeTaskDeps || 0]);
    const sig = `${historySigValue}#${windowWorkDays}#${cfgSig}`;
    if (sig !== cadenceCacheSig) { cadenceCache.clear(); cadenceCacheSig = sig; }
    if (cadenceCache.has(taskKey)) return cadenceCache.get(taskKey);
    const result = analyzeCadenceUncached(historyData, taskKey, windowWorkDays, today);
    cadenceCache.set(taskKey, result);
    return result;
};

const analyzeCadenceUncached = (historyData, taskKey, windowWorkDays, today) => {
    const days = (historyData || [])
        .filter(d => d && typeof d.id === 'string' && d.id <= today)
        .filter(d => (d.workRecords || []).length > 0)
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, windowWorkDays)
        .sort((a, b) => a.id.localeCompare(b.id));      // 오래된 → 최신

    const byWd = Array.from({ length: 7 }, () => ({ total: 0, hit: 0, sum: 0 }));
    const hitDates = [];
    let hits = 0, sum = 0;

    days.forEach(d => {
        const wd = new Date(d.id + 'T00:00:00').getDay();
        if (isNaN(wd)) return;
        byWd[wd].total++;
        const q = Number(d.taskQuantities?.[taskKey]) || 0;
        if (q > 0) {
            byWd[wd].hit++; byWd[wd].sum += q;
            hits++; sum += q;
            hitDates.push(d.id);
        }
    });

    if (hits === 0) return null;
    const avgQty = Math.round(sum / hits);
    const overallP = days.length > 0 ? hits / days.length : 0;

    // 발생 간격은 '근무일' 기준으로 센다.
    // 달력 날짜로 세면 주말이 낀 구간만 2일씩 길어져, 규칙적으로 하는 업무도
    // 불규칙해 보인다(3근무일 주기가 3·3·5일로 흩어진다).
    const hitIdx = [];
    days.forEach((d, i) => { if ((Number(d.taskQuantities?.[taskKey]) || 0) > 0) hitIdx.push(i); });
    const gaps = [];
    for (let i = 1; i < hitIdx.length; i++) gaps.push(hitIdx[i] - hitIdx[i - 1]);
    const sorted = [...gaps].sort((x, y) => x - y);
    const medianGap = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    // 간격이 고른가 — 절반 이상이 가운데값 ±1 안에 들면 규칙적으로 본다
    const nearMedian = gaps.filter(g => Math.abs(g - medianGap) <= 1).length;
    const regular = gaps.length >= 3 && nearMedian / gaps.length >= 0.6 && medianGap >= 2;

    // 하는 날 기준 물량 — 평균은 한 번 크게 한 날에 끌려간다. 중앙값을 기준으로 쓴다.
    const med = (arr) => {
        const v = arr.filter(x => x > 0).sort((x, y) => x - y);
        return v.length ? Math.round(v[Math.floor(v.length / 2)]) : 0;
    };
    const hitQtys = days.map(d => Number(d.taskQuantities?.[taskKey]) || 0).filter(q => q > 0);
    // 하는 날 물량 — '최근 5회 평균'. 한 번 크게 한 날은 그 5회 중앙값의 2배로 눌러서 넣는다.
    //   · 중앙값만 쓰면 물량이 오르는 추세를 못 따라가 계획이 꾸준히 12% 적게 잡혔다(실측).
    //   · 평균만 쓰면 하루 튄 날에 끌려간다 → 상한을 씌워 둘을 절충(검증: 편향 -12% → -5%).
    const lastHits = hitQtys.slice(-CADENCE_QTY_HITS);
    const capBase = med(lastHits);
    const dayQty = (lastHits.length >= 3
        ? Math.round(lastHits.reduce((a, q) => a + Math.min(q, capBase > 0 ? capBase * 2 : q), 0) / lastHits.length)
        : 0) || med(hitQtys) || avgQty;

    // 연속성(해저드) — '마지막 진행 후 n 근무일째'에 다시 할 확률.
    // 실측: 채우기는 어제 했으면 75%, 이틀 쉬면 10%, 사흘 쉬면 86% — 며칠 몰아서 하고 쉬는 모양이라
    // 요일이나 고정 주기만으로는 잡히지 않는다.
    const hazard = {};
    let since = null;
    days.forEach(d => {
        const q = Number(d.taskQuantities?.[taskKey]) || 0;
        if (since != null) {
            const k = Math.min(since, HAZARD_MAX_GAP);
            if (!hazard[k]) hazard[k] = { hit: 0, total: 0 };
            hazard[k].total++;
            if (q > 0) hazard[k].hit++;
        }
        if (q > 0) since = 1;
        else if (since != null) since++;
    });

    // 🔁 선행 업무 신호 — 전 근무일의 사전작업 상태별 진행률.
    //    'ready' = 사전작업만 하고 그날 출고가 없던 날(준비해 둔 물건이 다음날 나간다)
    //    'with'  = 사전작업도 하고 출고도 있던 날 / 'none' = 사전작업이 없던 날
    const preKeys = precursorTasks(taskKey);
    const precursor = {};
    if (preKeys.length > 0) {
        const outKeys = precursorOutputs(preKeys);
        for (let i = 1; i < days.length; i++) {
            const st = precursorStateOfDay(days[i - 1], preKeys, outKeys);
            if (!precursor[st]) precursor[st] = { hit: 0, total: 0 };
            precursor[st].total++;
            if ((Number(days[i].taskQuantities?.[taskKey]) || 0) > 0) precursor[st].hit++;
        }
    }

    // 주당 진행 횟수 — 주간 총량(= 며칠에 몰아넣을지)의 기준
    const perWeek = {};
    days.forEach(d => {
        const wk = isoWeekKey(d.id);
        if (!wk) return;
        if (!perWeek[wk]) perWeek[wk] = 0;
        if ((Number(d.taskQuantities?.[taskKey]) || 0) > 0) perWeek[wk]++;
    });
    const weekCounts = Object.values(perWeek).sort((x, y) => x - y);
    const weeklyCount = weekCounts.length ? weekCounts[Math.floor(weekCounts.length / 2)] : 0;

    return {
        taskKey, precursor,
        days, hits, avgQty, dayQty, overallP, byWd, hitDates, hitIdx, hazard, weeklyCount,
        lastDate: hitDates[hitDates.length - 1] || null,
        medianGap, regular, sampleDays: days.length
    };
};

/** 하루의 선행 업무 상태 — 'ready' | 'with' | 'none' */
const precursorStateOfDay = (day, preKeys, outKeys) => {
    // 소요시간을 안 적은 날도 '한 날'이다 — 기록이 있는지만 본다
    const done = (day?.workRecords || []).some(r => r && preKeys.includes(r.task));
    if (!done) return 'none';
    let out = 0;
    outKeys.forEach(k => { out += Number(day?.taskQuantities?.[k]) || 0; });
    return out > 0 ? 'with' : 'ready';
};

/** 그 날 기록이 대개 다 적혔는가 — '오늘'은 아직 입력 중일 수 있어서,
 *  사전작업 기록이 없다는 것만으로 '안 했다'고 단정하기 전에 확인한다.
 *  최근 근무일 기록 건수 중앙값의 절반을 넘으면 다 적힌 날로 본다. */
const dayLooksRecorded = (day, c) => {
    const n = (day?.workRecords || []).length;
    if (n === 0) return false;
    const counts = (c?.days || []).filter(d => d.id < day.id).slice(-10)
        .map(d => (d.workRecords || []).length).sort((a, b) => a - b);
    if (counts.length < 3) return false;
    return n >= counts[Math.floor(counts.length / 2)] * 0.5;
};

/** 대상일의 선행 업무 상태 — 전 근무일 기록(또는 저장해 둔 예정 시간)으로 판단.
 *  모르면 null 을 돌려 보정하지 않는다. 계산된 예상 사전작업 시간은 쓰지 않는다
 *  (사전작업 예상이 다음날 물량에서 나오므로, 그걸 되먹이면 자기 예상을 근거로 삼게 된다). */
const precursorStateFor = (c, dateStr) => {
    const preKeys = precursorTasks(c?.taskKey);
    if (preKeys.length === 0 || !Array.isArray(c?.days)) return null;
    const outKeys = precursorOutputs(preKeys);
    const today = getTodayDateString();

    // 창 안의 날짜는 학습과 같은 정의(이력상 직전 기록일)를 쓴다.
    // 두 정의가 갈리면(예: 토요일 근무 기록) 배운 것과 다른 날을 보고 조용히 틀린다.
    const i = c.days.findIndex(d => d.id === dateStr);
    const prev = (i > 0) ? c.days[i - 1] : c.days.find(d => d.id === prevWorkingDay(dateStr));
    if (prev) {
        const st = precursorStateOfDay(prev, preKeys, outKeys);
        // 오늘은 아직 안 끝난 날일 수 있다 — 기록이 덜 쌓였으면 '안 했다'로 단정하지 않는다.
        // (오전에 단정하면 내일 출고가 0이 되고, 그 0 때문에 오늘 사전작업도 0분이 된다)
        if (st === 'none' && prev.id >= today && !dayLooksRecorded(prev, c)) return null;
        // 'ready'(준비만 하고 출고 없음)는 '출고 물량이 0' 을 근거로 한다.
        // 오늘 물량이 아직 안 들어왔으면 'ready' 인지 'with' 인지 가를 수 없다 —
        // 여기서 'ready' 로 단정하면 내일이 '출고 확정'이 되어, 오늘과 내일에 이중으로 배정된다.
        if (st === 'ready' && prev.id >= today
            && !outKeys.every(k => qtyZeroConfirmed(prev, k))) return null;
        return st;
    }

    // 기록이 없는 미래 날짜 — 저장해 둔 예정 시간이 있으면 그것으로 판단한다
    const pw = prevWorkingDay(dateStr);
    let saved = null;
    preKeys.forEach(k => {
        const v = getPlannedTime(pw, k);
        // workers 0 으로 저장한 값은 '그날은 안 함'이다(같은 파일 autoTimeValueFor 의 정의)
        if (v) saved = (saved || 0) + (v.workers > 0 ? v.minutes : 0);
    });
    if (saved == null) return null;
    if (!(saved > 0)) return 'none';
    // 물량 예정값이 하나라도 비어 있으면 'ready'(= 출고 확정 신호)와 'with' 를 가를 수 없다.
    // 안 넣은 날을 'ready' 로 읽으면 '준비만 한 날'로 오해해 다음날을 강제 배정한다.
    let out = 0, known = true;
    outKeys.forEach(k => { const pl = getPlanned(pw, k); if (pl == null) known = false; else out += Number(pl) || 0; });
    if (!known) return null;
    return out > 0 ? 'with' : 'ready';
};

/** 'YYYY-Www' — 주당 진행 횟수를 세기 위한 주 구분(월요일 시작) */
const isoWeekKey = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    const day = (d.getDay() + 6) % 7;                 // 월=0
    d.setDate(d.getDate() - day);
    return ymd(d);
};

/** 마지막 진행일부터 대상일까지 '근무일'이 몇 번 지났는지.
 *  과거 구간은 실제 근무 기록으로 세고, 오늘 이후는 평일(월~금)로 어림한다.
 *  (앞으로의 휴무일은 알 수 없으므로) */
const workdaysBetween = (c, dateStr) => {
    const idx = c.days.findIndex(d => d.id === c.lastDate);
    if (idx < 0) return null;

    const inList = c.days.findIndex(d => d.id === dateStr);
    if (inList >= 0) return inList - idx;               // 대상일이 과거 근무일이면 그대로

    const lastKnown = c.days[c.days.length - 1];
    if (!lastKnown || dateStr <= lastKnown.id) return null;

    let n = (c.days.length - 1) - idx;                  // 마지막 진행일 → 마지막 기록일
    const cur = new Date(lastKnown.id + 'T00:00:00');
    const end = new Date(dateStr + 'T00:00:00');
    if (isNaN(cur.getTime()) || isNaN(end.getTime())) return null;
    while (cur < end) {
        cur.setDate(cur.getDate() + 1);
        if (!isOffDay(ymd(cur))) n++;                   // 주말·공휴일은 세지 않는다
    }
    return n;
};

/** 위 분석을 바탕으로 대상일의 예상 물량을 낸다.
 *  반환 { value, source, detail } — source 는 배지 문구에 그대로 쓰인다.
 */
/** 그날 이 업무를 진행할 확률 — 요일 성향 × 연속성(마지막 진행 후 며칠째).
 *  표본이 적은 쪽은 전체 빈도로 부드럽게 눌러(스무딩) 튀지 않게 한다. */
const cadenceProbFor = (c, dateStr) => {
    const base = c.overallP || 0;
    const wd = new Date(dateStr + 'T00:00:00').getDay();
    const w = (!isNaN(wd) && c.byWd[wd]) ? c.byWd[wd] : null;

    // 요일 성향 (표본 3일 이상일 때만, 전체 빈도 쪽으로 2일치 스무딩)
    let p = (w && w.total >= 3) ? (w.hit + base * 2) / (w.total + 2) : base;

    // 연속성 보정 — 같은 기간의 기본 빈도 대비 몇 배인지로 반영
    const elapsed = workdaysBetween(c, dateStr);
    if (elapsed != null && elapsed > 0 && base > 0) {
        const h = c.hazard[Math.min(elapsed, HAZARD_MAX_GAP)];
        // 표본 기준을 창 길이에 맞춘다(40근무일이면 10일) + 스무딩을 키워 1건 차이로 판정이 뒤집히지 않게
        if (h && h.total >= Math.max(8, Math.round(c.sampleDays / 4))) {
            const hp = (h.hit + base * 3) / (h.total + 3);
            p = p * (hp / base);
        }
    }

    // 🔁 선행 업무 보정 — 전 근무일에 사전작업을 했는지. 연속성과 같은 방식(기본 빈도 대비 배율).
    const pre = precursorStateFor(c, dateStr);
    let sure = false;
    if (pre && base > 0) {
        const ps = c.precursor?.[pre];
        if (ps && ps.total >= PRECURSOR_MIN_TOTAL) {
            const pp = (ps.hit + base * 3) / (ps.total + 3);
            p = p * (pp / base);
        }
        // 준비만 하고 출고가 없던 날 다음은 반례 없이 항상 나갔다 → 확정으로 본다
        if (pre === 'ready' && ps && ps.total >= PRECURSOR_SURE_MIN && ps.hit === ps.total) {
            sure = true;
            p = Math.max(p, 0.95);
        }
    }
    return { p: Math.max(0, Math.min(1, p)), raw: p, pre, sure };
};

/** 위 분석을 바탕으로 대상일의 예상 물량을 낸다.
 *  매일 조금씩 나눠 담지 않는다 — 하는 날엔 '하는 날 물량', 안 하는 날엔 0.
 *  애매한 날(확률 30~60%)은 0으로 두고, 결과 화면이 '진행 시' 값을 따로 보여준다.
 *  반환 { value, source, detail, dayValue, prob, uncertain }
 */
const cadenceValueFor = (historyData, taskKey, dateStr) => {
    const c = analyzeCadence(historyData, taskKey);
    // 표본이 적으면 예전 방식이 그나마 안전하다
    if (!c || c.hits < CADENCE_MIN_HITS) {
        return { value: computeLast7Avg(historyData, taskKey), source: 'last7' };
    }

    const WD_NAME = ['일', '월', '화', '수', '목', '금', '토'];
    const wd = new Date(dateStr + 'T00:00:00').getDay();
    const w = (!isNaN(wd) && c.byWd[wd]) ? c.byWd[wd] : null;
    const dayQty = c.dayQty;
    const pr = cadenceProbFor(c, dateStr);
    const p = pr.p;

    // 그 주에 '몇 번 하는 업무인지'를 지켜 고른 날인가 (설명 문구에도 쓴다)
    const plan = weekPlanFor(historyData, taskKey, dateStr);
    const picked = (plan && Object.prototype.hasOwnProperty.call(plan, dateStr))
        ? plan[dateStr] > 0 : (p >= CADENCE_ON_P);

    const elapsed = workdaysBetween(c, dateStr);
    // 확정(sure)이고 실제로 배정된 날만 '확정'이라고 쓴다.
    // 확정 신호라도 주간 배정 한도(+1회)에 걸려 잘릴 수 있어, 그 경우는 잘렸다고 밝힌다.
    const sureNote = !pr.sure ? ''
        : (picked ? ' → 이 날 출고 확정' : ' → 확정 신호이지만 주간 배정 한도로 이 날은 미배정');
    const PRE_NOTE = {
        ready: '전 근무일에 사전작업만 하고 출고가 없었음' + sureNote,
        with:  '전 근무일에 사전작업 있었음',
        none:  '전 근무일에 사전작업 없었음'
    };
    const why = [
        `최근 근무일 ${c.sampleDays}일 중 ${c.hits}일 진행` + (c.weeklyCount > 0 ? ` (주 ${c.weeklyCount}회꼴)` : ''),
        (w && w.total >= 3) ? `${WD_NAME[wd]}요일은 ${w.hit}/${w.total}회` : null,
        (c.lastDate && elapsed != null) ? `마지막 진행 ${c.lastDate} (그 뒤 ${elapsed}근무일째)` : null,
        `하는 날은 ${dayQty.toLocaleString()}개`,
        pr.pre ? PRE_NOTE[pr.pre] : null
    ].filter(Boolean).join(' · ');
    const planNote = plan
        ? `이번 주 ${plan.__quota}회 배정 기준 · ${picked ? '이 날 배정됨' : '이 날은 미배정'}`
        : `진행 확률 ${Math.round(p * 100)}%`;
    const detail = `${planNote} (이 날 진행 확률 ${Math.round(p * 100)}%)
${why}`;

    if (picked) {
        return { value: dayQty, source: 'cadence-on', prob: p, dayValue: dayQty, detail };
    }
    if (p <= CADENCE_OFF_P) {
        return { value: 0, source: 'cadence-off', prob: p, dayValue: dayQty, detail };
    }
    // 고르진 않았지만 가능성이 남은 날 — 0 으로 두되 '진행 시' 계산에 쓰도록 표시해 둔다
    return { value: 0, source: 'cadence-maybe', prob: p, dayValue: dayQty, uncertain: true, detail };
};

/** 📅 그 주에 '몇 번 하는 업무인지'를 지켜, 유력한 날에만 물량을 넣는다.
 *  하루만 떼어 확률로 보면 빈도 70~85% 업무가 거의 매일 잡혀 주간 총량이 부풀려진다.
 *  이미 진행했거나(지난 날 실적) 예정 물량이 저장된 날은 그 횟수를 빼고 남은 만큼만 배치한다.
 *  반환: { 날짜: 물량 } — 후보가 아닌 날(주말·공휴일 등)도 0 으로 채워 키는 항상 있다. */
const cadenceWeekPlan = (historyData, taskKey, dates, fixedInfo = null) => {
    const c = analyzeCadence(historyData, taskKey);
    if (!c || c.hits < CADENCE_MIN_HITS) return null;

    // 후보 = 쉬는 날(주말·공휴일)이 아닌 날. 그 요일에 실제로 한 적이 있으면 주말도 후보.
    const isCand = (d) => {
        const wd = new Date(d + 'T00:00:00').getDay();
        return !isOffDay(d) || !!(c.byWd[wd] && c.byWd[wd].hit > 0);
    };
    const cand = dates.filter(isCand);
    if (cand.length === 0) return null;

    const fixed = fixedInfo || { dates: new Set(), done: 0 };
    // 이번 기간에 몇 번 할 업무인가 → 이미 확정된 횟수를 뺀 나머지만 배치
    const quota = Math.round(c.overallP * cand.length);
    const remain = Math.max(0, Math.min(cand.length, quota - fixed.done));

    const open = cand.filter(d => !fixed.dates.has(d))
        .map(d => ({ date: d, ...cadenceProbFor(c, d) }))
        .sort((a, b) => (b.raw - a.raw) || a.date.localeCompare(b.date));

    // 🔁 전 근무일에 사전작업만 하고 출고가 없던 날은 먼저 배정한다.
    //    다만 주간 총량이 무너지지 않게, 주 배정 횟수를 최대 1회까지만 넘긴다
    //    (이 함수가 있는 이유가 '확률로만 보면 주간 총량이 부푼다'는 것이므로).
    const sure = open.filter(x => x.sure);
    const sureLimit = Math.min(sure.length, remain + 1);
    const sureOn = sure.slice(0, sureLimit);
    const on = new Set(sureOn.map(x => x.date));
    const slots = Math.max(0, remain - sureOn.length);
    open.filter(x => !x.sure).slice(0, slots).forEach(x => on.add(x.date));

    const out = {};
    dates.forEach(d => { out[d] = on.has(d) ? c.dayQty : 0; });
    out.__quota = quota;          // 화면 설명용(배지 문구)
    out.__remain = remain;
    return out;
};

/** 대상일이 속한 주(월~일)의 배치표. 모든 화면이 이 한 곳을 거쳐 같은 답을 쓴다.
 *  같은 주는 한 번만 계산한다(이력·예정 물량이 바뀌면 자동으로 다시 계산). */
const weekPlanMemo = new Map();
const weekPlanFor = (historyData, taskKey, dateStr) => {
    const wk = isoWeekKey(dateStr);
    if (!wk) return null;

    // 그 주 7일을 통째로 본다(대상일이 주말이어도 키가 빠지지 않게)
    const dates = Array.from({ length: 7 }, (_, i) => addDays(wk, i));

    // 이미 값이 정해진 날 — 지난 날의 실적, 오늘 실측, 저장해 둔 예정 물량
    // ⚠️ '오늘'은 문서가 생겼다는 것만으로 정해진 날이 아니다. 근무 기록이 들어오면 문서가 만들어지는데,
    //    물량은 보통 한참 뒤에 넣는다. 그 사이 0 을 '정해진 값'으로 보면 오늘이 주 배정에서 아예
    //    빠져 아침 계획이 통째로 0 이 된다(실측: 빈도형 7개 합계 하루 약 1,600개가 사라졌다).
    //    그래서 오늘은 '물량이 들어왔거나 0 으로 확정된 경우'에만 정해진 날로 본다.
    const today = getTodayDateString();
    const fixedDates = new Set();
    let done = 0;
    const fixedKey = dates.map(d => {
        let v = null;
        if (d <= today) {
            const day = (historyData || []).find(x => x.id === d);
            if (day) {
                const q = Math.round(Number(day.taskQuantities?.[taskKey]) || 0);
                if (d < today || q > 0 || qtyZeroConfirmed(day, taskKey)) v = q;
            }
        }
        if (v == null) { const pl = getPlanned(d, taskKey); if (pl != null) v = Math.round(pl); }
        if (v != null) { fixedDates.add(d); if (v > 0) done++; }
        return v == null ? '' : String(v);
    }).join(',');

    // 전 근무일의 사전작업 상태도 키에 넣는다 — 그 값이 바뀌면 배치가 달라진다
    const c0 = analyzeCadence(historyData, taskKey);
    const preKey = c0 ? dates.map(d => (precursorStateFor(c0, d) || '-')[0]).join('') : '';
    const memoKey = `${historySigValue}#${taskKey}#${wk}#${fixedKey}#${preKey}`;
    if (weekPlanMemo.has(memoKey)) return weekPlanMemo.get(memoKey);
    if (weekPlanMemo.size > 400) weekPlanMemo.clear();

    const plan = cadenceWeekPlan(historyData, taskKey, dates, { dates: fixedDates, done });
    weekPlanMemo.set(memoKey, plan);
    return plan;
};

/** 미래 날짜의 국내배송 AI 예측값. 과거이면 실측치 사용. */
const getAIPredictedDomestic = (historyData, dateStr) => {
    const today = getTodayDateString();
    const tD = new Date(today + 'T00:00:00');
    const xD = new Date(dateStr + 'T00:00:00');
    if (isNaN(xD.getTime()) || isNaN(tD.getTime())) return 0;
    const diff = Math.round((xD - tD) / 86400000);

    // 과거: 실측값 그대로
    if (diff < 0) {
        const day = (historyData || []).find(d => d.id === dateStr);
        return Number(day?.taskQuantities?.['국내배송']) || 0;
    }
    if (diff > 30) return 0; // 너무 먼 미래는 신뢰도 낮음

    // ⚠️ 반드시 일반배송(카페24) 스코프로 예측해야 delivery가 '국내배송' 물량이 된다.
    //    스코프를 생략하면 전 채널 물량 합계가 나와 시뮬레이션 값이 부풀려진다.
    const result = predictFutureTrends(historyData, Math.max(14, diff || 1), channelScope('cafe24'));

    if (diff === 0) {
        // 오늘: 이미 입력된 실측이 있으면 그 값, 없으면 실적 예측의 '오늘 예측값'.
        // (예전엔 실측만 봐서, 물량 입력 전인 오전에는 항상 0 → 칸이 비어 있었다)
        const day = (historyData || []).find(d => d.id === dateStr);
        const actual = Number(day?.taskQuantities?.['국내배송']) || 0;
        if (actual > 0) return actual;
        const todayPred = result?.prediction?.today?.predictedDel;
        if (todayPred > 0) return Math.round(todayPred);
        return computeLast7Avg(historyData, '국내배송');
    }

    const predicted = result?.prediction?.delivery?.[diff - 1];
    if (predicted > 0) return Math.round(predicted);

    // 예측 불가(이력 7일 미만 등) → 최근 실적 평균으로라도 채운다
    return computeLast7Avg(historyData, '국내배송');
};

/** 가용 인원 = 전체 정직원 − 해당일 휴무자(persistentLeave + 그날 onLeaveMembers)
 *  - 중복 멤버 제거(Set)
 *  - 프로그램 전용 ID 등 인원 산정 제외 명단(headcountExcludedMembers) 빼고 계산
 */
const computeAvailableStaff = (dateStr, appConfig, persistentLeave, historyData) => {
    // 대상일 기준 재직 인원만 (그 날짜 이전에 퇴사 예정인 사람은 총원에서 제외)
    const allStaff = getRegularMembersForCount(appConfig, dateStr); // Set
    const onLeave = new Map();

    (persistentLeave?.onLeaveMembers || []).forEach(e => {
        if (!e || !e.member || !e.startDate || !LEAVE_OFF_TYPES.has(e.type)) return;
        const end = e.endDate || e.startDate;
        if (dateStr >= e.startDate && dateStr <= end) onLeave.set(e.member, e.type);
    });

    const dayData = (historyData || []).find(d => d.id === dateStr);
    if (dayData && Array.isArray(dayData.onLeaveMembers)) {
        dayData.onLeaveMembers.forEach(e => {
            if (e && e.member && LEAVE_OFF_TYPES.has(e.type) && !onLeave.has(e.member)) {
                onLeave.set(e.member, e.type);
            }
        });
    }

    // 휴무 명단 중 정직원 카운트 대상에 들어있는 사람만 유효
    const onLeaveList = Array.from(onLeave.entries())
        .filter(([m]) => allStaff.has(m))
        .map(([m, t]) => ({ member: m, type: t }));
    let available = 0;
    allStaff.forEach(m => { if (!onLeave.has(m)) available++; });
    return { available, total: allStaff.size, onLeaveList };
};

// ───────────────────────────────────────────────────────────
// 시뮬레이션 UI 헬퍼
// ───────────────────────────────────────────────────────────
const setQty = (id, val) => {
    const el = document.getElementById(`sim-qty-${id}`);
    if (!el) return;
    el.value = (val == null || val === 0 || val === '') ? '' : val;
};

/** 대상일이 오늘일 때, '오늘 처리량 입력'에 이미 들어간 실측값. 없으면 null.
 *  오늘 데이터는 daily_data가 allHistoryData의 오늘 항목으로 합쳐져 있다. */
const todayActualQty = (historyData, dateStr, taskKey) => {
    if (dateStr !== getTodayDateString()) return null;
    const day = (historyData || []).find(d => d.id === dateStr);
    const v = Number(day?.taskQuantities?.[taskKey]) || 0;
    return v > 0 ? Math.round(v) : null;
};

/** 한 업무의 대상일 값과 그 출처.
 *  ⭐ 우선순위
 *    1. 오늘 처리량 입력(실측)     — 대상일이 오늘일 때만. 실제로 처리한 값이므로 예정보다 우선.
 *    2. 예정 물량(수기 입력)      — 업무 기록 및 관리 > 예정 물량 / 이 화면의 '작업량 저장'
 *    3. 업무별 자동 추정값         — AI 예측 / 입고일정 / 중국제작 연동 / 지난 7회 평균
 *  반환: { value, source }  (source는 배지 표시에 그대로 쓴다)
 *
 *  ⚠️ '오늘 실측을 계획으로 쓰지 않아야 하는' 자동 계획 스냅샷은 이 함수에 플래그를 주지 않는다.
 *     대신 computeAutoInputsForDate 가 **오늘 실적을 비운 기록**을 건넨다(아래 그 함수의 주석).
 *     그래야 cadence·AI·시간형 통계까지 한 번에 막힌다.
 */
const autoValueFor = (dateStr, task, historyData) => {
    // 실측이 잡히면 예정 물량을 저장해 뒀더라도 실측이 이긴다
    const actual = todayActualQty(historyData, dateStr, task.key);
    if (actual != null) return { value: actual, source: 'actual' };

    const planned = getPlanned(dateStr, task.key);
    if (planned != null) return { value: planned, source: 'planned' };

    return estimatedValueFor(dateStr, task, historyData);
};

/** 📦 상.하차 비율 학습 — 상.하차는 두 가지 일이 겹친다.
 *    ① 하차: 중국제작 입고가 예정된 날, 그 날 도착하는 박스를 내린다
 *    ② 상차: 전 근무일에 직진배송·에이블리배송을 한 만큼 다음날 실어 보낸다
 *  실측(최근 60근무일): 전날 출고가 있으면 상.하차 진행률 97%(38/39일), 없으면 20%(1/5일).
 *  전날 출고량과 상.하차 물량의 상관계수 0.89 — 고정 평균보다 훨씬 잘 맞는다.
 *  (검증 40근무일: 고정 기준선 방식 오차 19.4개 → 이 방식 6.5개, 전날 출고 없는 날은 0으로 정확)
 *
 *  ① 먼저 '순수 상차일'(입고 없고 전날 출고 있는 날)로 상차 단위를 배운다 — 표본이 많다.
 *  ② 그 상차분을 뺀 나머지로 '박스당 개수'를 배운다 — 순수 하차일만 쓰면 표본이 2~3일뿐이다.
 */
let loadUnloadCache = new Map(), loadUnloadSig = '';
const loadUnloadRatios = (historyData, taskKey, incomingKey, shipKeys, windowWorkDays = 40) => {
    const today = getTodayDateString();
    // 10일 전망·키 입력마다 불리므로 캐시한다(이력 전체를 filter+sort 하는 비용이 반복된다)
    const sig = `${historySigValue}#${today}#${windowWorkDays}`;
    if (sig !== loadUnloadSig) { loadUnloadCache = new Map(); loadUnloadSig = sig; }
    const ck = `${taskKey}#${incomingKey}#${shipKeys.join(',')}`;
    if (loadUnloadCache.has(ck)) return loadUnloadCache.get(ck);

    const days = (historyData || [])
        .filter(d => d && typeof d.id === 'string' && d.id < today)
        .filter(d => (d.workRecords || []).length > 0)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(-windowWorkDays);
    const byId = new Map(days.map(d => [d.id, d]));
    const num = (d, k) => Number(d?.taskQuantities?.[k]) || 0;
    const shipOf = (d) => shipKeys.reduce((a, k) => a + num(d, k), 0);
    // ⚠️ 추론은 prevWorkingDay(달력 기준)를 쓴다 — 학습도 같은 정의를 써야 한다.
    //    '이력상 직전 기록일'로 배우면 연휴·기록 누락이 끼었을 때 관계가 없는 쌍이 표본에 섞인다.
    const prevOf = (d) => byId.get(prevWorkingDay(d.id)) || null;
    const med = (arr) => {
        if (arr.length === 0) return 0;
        const v = [...arr].sort((x, y) => x - y);
        const m = Math.floor(v.length / 2);
        // 짝수 표본에서 위쪽 값만 고르면 비율이 한 방향으로 치우친다
        return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    };

    // ① 상차 단위 — '전날 출고 몇 개당 상.하차 1개'
    const a = [];
    days.forEach(cur => {
        const prev = prevOf(cur);
        if (!prev) return;
        const t = num(cur, taskKey), sp = shipOf(prev);
        if (num(cur, incomingKey) === 0 && sp > 0 && t > 0) a.push(sp / t);
    });
    const perShip = a.length >= 3 ? med(a) : 0;

    // ② 박스당 개수 — 입고일에서 상차분을 뺀 나머지 기준
    const b = [];
    days.forEach(cur => {
        const inq = num(cur, incomingKey), t = num(cur, taskKey);
        if (inq <= 0 || t <= 0) return;
        const prev = prevOf(cur);
        const sp = prev ? shipOf(prev) : 0;
        const boxPart = t - (perShip > 0 ? sp / perShip : 0);
        if (boxPart > 0) b.push(inq / boxPart);
    });
    let perBox = b.length >= 3 ? med(b) : 0;
    if (perBox <= 0) {
        // 표본이 모자라면 상차분을 빼지 않은 전체 비율로 어림한다
        const c = [];
        days.forEach(d => {
            const inq = num(d, incomingKey), t = num(d, taskKey);
            if (inq > 0 && t > 0) c.push(inq / t);
        });
        perBox = c.length >= 3 ? med(c) : 0;
    }
    const out = { perShip, perBox, sampleShip: a.length, sampleBox: b.length };
    loadUnloadCache.set(ck, out);
    return out;
};

/** 그 날 그 업무의 '0' 이 진짜 0 인가 — 아직 입력 안 된 0 과 구분한다.
 *  ① 그 업무를 지금 하고 있으면 0 은 아직 확정이 아니다(끝나고 물량이 들어온다).
 *  ② '0으로 확정' 목록에 있거나 물량 검수가 끝났으면 확실히 0.
 *  ③ 처리량 입력 모달은 저장할 때 <b>모든 업무를 0 까지 함께</b> 쓴다
 *     (listeners-form-quantity.js: newQuantities[taskName] = Number(input.value) || 0).
 *     그래서 그 업무의 '키가 있는지' 가 곧 '입력을 거쳤는지' 다.
 *     ⚠️ '0 아닌 값이 몇 개인가'로 세면 입력 순서에 좌우된다 — 직진·에이블리를 마지막에 넣는
 *        습관이면 중간에 그 업무들이 '0 확정'으로 오판된다. 그래서 키 유무로 판단한다. */
const qtyZeroConfirmed = (dayRec, taskKey) => {
    if (!dayRec) return false;
    const working = (dayRec.workRecords || [])
        .some(r => r && r.task === taskKey && (Number(r.duration) || 0) > 0);
    if (working) return false;
    const list = dayRec.confirmedZeroTasks;
    if (Array.isArray(list) && list.includes(taskKey)) return true;
    if (dayRec.isQuantityVerified) return true;
    return Object.prototype.hasOwnProperty.call(dayRec.taskQuantities || {}, taskKey);
};

/** 📦 상.하차 예상 = 하차분(입고 박스) + 상차분(전 근무일 출고량).
 *  inQtyOverride: 화면에서 입고 수량을 직접 고친 경우 그 값(선적 지연으로 0 으로 고치는 등).
 */
const incomingBoxesValueFor = (dateStr, task, historyData, incomingKey = '중국제작', inQtyOverride = null) => {
    const inKey = incomingKey || '중국제작';
    const shipKeys = loadoutSourceTasks();
    const { perShip, perBox } = loadUnloadRatios(historyData, task.key, inKey, shipKeys);

    // ── 하차분: 그날 도착 예정 박스 수
    const savedIn = getPlanned(dateStr, inKey);
    const byHand = (inQtyOverride != null) || (savedIn != null);
    const inQty = (inQtyOverride != null)
        ? Math.max(0, Math.round(Number(inQtyOverride) || 0))
        : (savedIn ?? getIncomingChinaForDate(dateStr));
    // '입고가 있나'는 박스가 아니라 입고 수량으로 판단한다 — 시트에 박스 열이 비고 수량만
    // 있는 행도 있어서, 박스 0 을 '입고 없음'으로 읽으면 값도 틀리고 근거 문구도 거짓이 된다.
    const sheetBoxes = inQty > 0 ? getIncomingBoxesForDate(dateStr) : 0;
    let unload = sheetBoxes, unloadNote = '';
    if (inQty > 0 && sheetBoxes <= 0) {
        unload = perBox > 0 ? Math.round(inQty / perBox) : 0;
        unloadNote = perBox > 0
            ? `${inKey} 입고 ${inQty.toLocaleString()}개 (박스 수를 못 읽어 박스당 ${Math.round(perBox)}개로 나눈 ${unload.toLocaleString()}박스)`
            : `${inKey} 입고 ${inQty.toLocaleString()}개 (박스 수도 박스당 개수도 알 수 없어 하차분을 못 냈습니다)`;
    } else if (sheetBoxes > 0) {
        unloadNote = `입고 ${sheetBoxes.toLocaleString()}박스 하차`;
    }

    // ── 상차분: 전 근무일에 직진배송·에이블리배송을 한 만큼 다음날 실어 보낸다
    //    ⚠️ 지난 날은 실적을 '직접' 읽어야 한다. autoQtyFor 는 지난 날에 0 을 돌려준다
    //       (todayActualQty 는 오늘만 보고, plannedData 는 오늘 이후만 읽고,
    //        cadenceWeekPlan 은 이미 지난 날을 '확정된 날'로 보고 0 을 넣는다).
    //       이걸 놓치면 '오늘·내일' 계획에서 상차분이 통째로 0 이 된다 — 가장 흔한 경우다.
    const prev = prevWorkingDay(dateStr);
    const prevRec = (historyData || []).find(d => d && d.id === prev);
    const prevClosed = prev < getTodayDateString();
    let shipQty = 0, shipFromRecord = false, shipGuessed = false, shipMissing = [];
    shipKeys.forEach(k => {
        const act = prevRec ? (Number(prevRec.taskQuantities?.[k]) || 0) : 0;
        if (act > 0) { shipQty += act; shipFromRecord = true; return; }
        // 마감된 날에 기록이 없으면 진짜로 안 한 것이다
        if (prevClosed) return;
        const t = SIM_TASKS.find(x => x.key === k);
        if (!t) { shipMissing.push(k); return; }
        // 스스로를 다시 부르는 경로는 막는다(설정으로 출고 업무에 이 모드를 걸어 둔 경우)
        if (parseAutoMode(t.auto).mode === 'incoming-boxes') return;
        const info = autoValueFor(prev, t, historyData) || {};
        let v = Math.max(0, Number(info.value) || 0);
        // ⚠️ '오늘'은 이력 문서가 이미 있어 빈도형 판정이 '확정된 날'로 보고 0 을 돌려준다.
        //    오전에 오늘 출고량을 아직 안 넣었으면 그 0 때문에 내일 상차분이 통째로 사라진다.
        //    단 '0으로 확정'했거나 물량 검수가 끝난 날이면 그 0 은 진짜다 — 그때는 그대로 둔다.
        if (v === 0 && Number(info.dayValue) > 0 && !qtyZeroConfirmed(prevRec, k)) {
            v = Math.round(Number(info.dayValue));
            shipGuessed = true;
        }
        shipQty += v;
    });
    const loadOut = (shipQty > 0 && perShip > 0) ? Math.round(shipQty / perShip) : 0;
    const src = shipFromRecord ? '실적' : (shipGuessed ? '하는 날 기준' : '예상');
    const loadNote = shipQty > 0
        ? (perShip > 0
            ? `전 근무일(${prev}) 출고 ${shipQty.toLocaleString()}개(${src}) 상차 (${Math.round(perShip)}개당 1)`
            : `전 근무일 출고 ${shipQty.toLocaleString()}개가 있지만 상차 비율을 배울 표본이 모자랍니다`)
        : `전 근무일(${prev})에 ${shipKeys.join(' · ')} 출고가 없어 상차분은 없습니다`;
    // 설정에 적은 출고 업무를 목록에서 못 찾으면 그 몫이 조용히 빠진다 — 알려 준다
    const missNote = shipMissing.length > 0
        ? ` ⚠️ 출고 업무 ${shipMissing.join(' · ')} 를 목록에서 찾지 못해 그 몫은 빠졌습니다`
        : '';

    const parts = [unloadNote, loadNote].filter(Boolean);
    const zeroNote = (unload <= 0 && loadOut <= 0 && byHand)
        ? `${inKey} 물량을 0 으로 정해 두셨고 전날 출고도 없어 0 으로 둡니다`
        : '';
    return {
        value: Math.max(0, unload + loadOut),
        source: 'incoming-boxes',
        detail: (zeroNote || parts.join(' + ')) + missNote
              + `\n= 하차 ${unload.toLocaleString()} + 상차 ${loadOut.toLocaleString()}`
    };
};

/** 수기값(실측·예정)을 뺀 순수 자동 추정값만. 예정 물량 입력 화면의 프리필이 쓴다. */
const estimatedValueFor = (dateStr, task, historyData) => {
    const { mode, arg } = parseAutoMode(task.auto);
    switch (mode) {
        case 'ai':       return { value: getAIPredictedDomestic(historyData, dateStr), source: 'ai' };
        case 'incoming': return { value: getIncomingChinaForDate(dateStr), source: 'incoming' };
        case 'china-linked': {
            // 샘플검수는 중국제작 입고가 있는 날에만 발생한다.
            // 그 날의 중국제작 수량(예정 물량 > 입고일정)에 최근 검수비율을 곱해 산출.
            const china = getPlanned(dateStr, '중국제작') ?? getIncomingChinaForDate(dateStr);
            const v = (china > 0) ? Math.round(computeSampleRatio(historyData) * china) : 0;
            return { value: v, source: 'china-linked' };   // 입고 없는 날은 0(빈칸)
        }
        case 'incoming-boxes':
            return incomingBoxesValueFor(dateStr, task, historyData, arg);
        case 'cadence':  return cadenceValueFor(historyData, task.key, dateStr);
        default:         return { value: computeLast7Avg(historyData, task.key), source: 'last7' };
    }
};

/** 값만 필요한 곳에서 쓰는 짧은 형태 */
const autoQtyFor = (dateStr, task, historyData) => autoValueFor(dateStr, task, historyData).value;

// 사람이 직접 넣은 값(예정물량·오늘 실측)만 색 배지로 눈에 띄게 하고,
// 자동으로 채워진 값은 조용한 회색 글씨로 둔다 — 10칸이 배지로 뒤덮이지 않도록.
const SOURCE_BADGE = {
    planned:  { text: '예정물량', muted: false, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
                tip: '예정 물량(또는 이 화면의 작업량 저장)에 직접 넣은 값입니다. 오늘 실측이 없을 때 적용됩니다.' },
    actual:   { text: '오늘 실측', muted: false, cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
                tip: '오늘 처리량 입력에 들어간 실제 값입니다. 저장해 둔 예정 물량이 있어도 이 값이 먼저 적용됩니다.' },
    ai:       { text: 'AI 예측',    muted: true, tip: '국내배송 AI 추세 예측값' },
    incoming: { text: '입고일정',    muted: true, tip: '대시보드 입고일정에서 도착일 기준 자동 반영' },
    last7:    { text: '지난 7회 평균', muted: true, tip: '이 업무가 발생한 최근 7일의 업무량 평균' },
    'cadence-on':    { text: '하는 날', muted: true,
                tip: '매일 하는 업무가 아니어서, 최근 기록 기준 이번 주에 몇 번 하는지를 세고'
                   + ' 요일 성향·마지막 진행일로 가장 유력한 날에 배정했습니다. 실제로 안 한다면 0으로 고치세요.' },
    'cadence-off':   { text: '안 하는 날', muted: true,
                tip: '이번 주 배정에서 빠졌고 진행 가능성도 낮은 날입니다.'
                   + ' 진행한다면 옆의 [하는 날] 값을 눌러 넣으세요.' },
    'cadence-maybe': { text: '진행 불확실', muted: true,
                tip: '이번 주 배정에서는 빠졌지만 진행할 수도 있는 날입니다. 기본은 0으로 두고,'
                   + ' 결과 화면에 이 업무를 진행할 때의 시간·인원을 함께 보여줍니다.' },
    'incoming-boxes': { text: '입고·상차', muted: true,
                tip: '하차분 + 상차분입니다. 하차분은 그날 도착 예정 박스 수,'
                   + ' 상차분은 전 근무일에 직진배송·에이블리배송을 한 물량을 상차 단위로 나눈 값입니다.'
                   + ' 둘 다 없는 날은 0 입니다.' },
    'china-linked': { text: '중국제작 연동', muted: true,
                tip: '중국제작 입고가 있는 날만 자동 입력됩니다. (그 날 입고량 × 최근 4주 검수비율)' }
};

/** '하는 날 기준값' 버튼 — 0으로 둔 칸 옆에 실제 진행일 기준 물량을 띄운다.
 *  자동값은 기간 총량이 맞는 값이라 하루치로는 작게 나온다. 그 날 이 업무를 한다는 걸
 *  아는 사람이 눌러서 제 값으로 바꿔 넣을 수 있게 한다. (누를 값이 없으면 자리만 비워 둔다) */
const paintDayApply = (task, dayValue) => {
    const b = document.getElementById(`sim-day-${task.id}`);
    if (!b) return;
    const v = Number(dayValue);
    const cur = Number(document.getElementById(`sim-qty-${task.id}`)?.value) || 0;
    // 이미 그 값이 들어 있으면 누를 이유가 없다
    if (!v || v <= 0 || v === cur) {
        // invisible 이 아니라 hidden — invisible 은 58px 을 계속 먹어 업무명이 잘린다
        b.className = 'pred-day-apply shrink-0 text-center text-[11px] leading-tight tabular-nums hidden';
        b.textContent = '';
        b.dataset.value = '';
        return;
    }
    b.className = `pred-day-apply w-[58px] shrink-0 text-center text-[11px] leading-tight tabular-nums
                   rounded border border-dashed border-indigo-300 dark:border-indigo-700 px-1 py-0.5
                   font-bold text-indigo-500 dark:text-indigo-300
                   hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition`;
    b.textContent = v.toLocaleString();
    b.dataset.value = String(v);
    b.title = `하는 날 기준 ${v.toLocaleString()}개\n\n`
            + '이 날은 진행하지 않는 것으로 봐서 0으로 두었습니다.\n'
            + '실제로 이 업무를 한다면 눌러서 이 값을 넣으세요.';
};

/** 값의 출처를 항목 아래에 표시 */
const markSourceBadge = (task, source, detail = '', dayValue = null) => {
    paintDayApply(task, dayValue);
    const el = document.getElementById(`sim-src-${task.id}`);
    if (!el) return;
    const b = SOURCE_BADGE[source] || SOURCE_BADGE.last7;
    const base = 'w-[64px] sm:w-[84px] shrink-0 text-center text-[11px] truncate';   // 줄 레이아웃 유지
    el.className = b.muted
        ? `${base} font-medium text-gray-400 dark:text-gray-500`
        : `${base} font-bold rounded-md ${b.cls}`;
    el.textContent = b.text;
    // 접기 판정이 이 자리에 '펼친 사유' 를 쓸 때 원래 글씨를 보관해 둔다.
    // 새로 쓸 때 보관값을 버리지 않으면, 사유가 사라질 때 **옛 출처**가 되살아난다.
    delete el.dataset.srcText;
    delete el.dataset.warn;
    // 왜 그 값이 나왔는지(예: '월요일엔 7/8회 진행')를 함께 보여준다.
    // 0 이 들어간 칸을 보고 고장으로 오해하지 않도록 근거가 필요하다.
    el.title = detail ? `${b.tip}

${detail}` : b.tip;
};

/** 작업량 입력 칸을 SIM_TASKS로부터 만든다.
 *  성격별(출고 / 입고·제작 / 그 외)로 구획을 나눠 한눈에 구분되게 한다. */
/** 작업량 입력 목록 — 카드 대신 '한 줄에 한 업무'인 표 형태로 촘촘하게 세운다.
 *  (카드 10여 개가 격자로 흩어져 있으면 어느 업무가 얼마인지 훑기 어렵다)
 *  줄 구성:  업무명 ........ [입력] 개 · 값 출처
 */
/** @returns {boolean} 실제로 입력칸을 다시 그렸는가(= DOM 의 값이 날아갔는가) */
const renderSimTaskInputs = () => {
    const host = document.getElementById('sim-task-list');
    if (!host) return false;
    const sig = timeTaskSig(SIM_TIME_TASKS);
    const qtySig = SIM_TASKS.map(t => t.id).join('|');
    // 이미 지금 목록대로 그려져 있으면 옛 세대가 아니다
    if (host.dataset.built === 'true' && host.dataset.timeSig === sig && host.dataset.qtySig === qtySig) {
        simInputsStale = false;
        return false;
    }
    host.dataset.built = 'true';
    host.dataset.timeSig = sig;
    host.dataset.qtySig = qtySig;
    simInputsStale = false;

    const ROW = `flex items-center gap-2.5 px-3 py-2 border-b border-gray-100 dark:border-gray-700/60 last:border-b-0
                 transition hover:bg-gray-50 dark:hover:bg-gray-900/30
                 focus-within:bg-indigo-50/50 dark:focus-within:bg-indigo-900/20`;
    // w-20 → sm 부터 w-24. 모바일에서 입력칸이 96px 를 고정으로 먹으면 행이 넘친다.
    const NUM = `w-20 sm:w-24 bg-transparent border-0 border-b border-transparent p-0 text-right text-[17px] leading-tight font-extrabold tabular-nums
                 text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600
                 focus:outline-none focus:ring-0 focus:border-indigo-400`;

    // 업무명은 관리자 설정에서 오는 임의 문자열이다 — 따옴표 하나에 줄 전체가 깨진다
    const row = (t) => `
        <div id="sim-row-${t.id}" data-row-id="${t.id}" class="pred-sim-row ${ROW}">
            <span class="flex-1 min-w-0 sm:min-w-[5.5rem] truncate text-sm font-bold text-gray-700 dark:text-gray-200" title="${escapeHtml(t.label)}">${escapeHtml(t.label)}</span>
            <input id="sim-qty-${t.id}" type="number" min="0" placeholder="0" inputmode="numeric" class="${NUM}">
            <span class="w-4 text-[11px] text-gray-400 dark:text-gray-500">개</span>
            <span id="sim-src-${t.id}" class="w-[64px] sm:w-[84px] shrink-0 text-center text-[11px] font-semibold text-gray-400 dark:text-gray-500 truncate">지난 7회 평균</span>
            <button type="button" id="sim-day-${t.id}" data-task-id="${t.id}" tabindex="-1"
                    class="pred-day-apply shrink-0 text-center text-[11px] leading-tight tabular-nums hidden"></button>
        </div>`;

    const timeRow = (t) => `
        <div id="sim-row-t-${t.id}" data-row-id="t-${t.id}" class="pred-sim-row ${ROW}">
            <span class="flex-1 min-w-0 sm:min-w-[5.5rem] truncate text-sm font-bold text-gray-700 dark:text-gray-200" title="${escapeHtml(t.label)} — 인원이 늘면 그만큼 시간이 더해집니다">${escapeHtml(t.label)}</span>
            <label class="shrink-0 text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap"
                   title="이 업무를 하는 인원. 인원을 올리면 1인 시간만큼 총 시간이 자동으로 더해집니다(1명 340분 → 2명 680분). 0명으로 두면 그날은 하지 않는 업무로 보고 시간도 0이 됩니다.">동시
                <input id="sim-workers-${t.id}" type="number" min="0" step="1" value="1"
                       class="w-8 bg-transparent border-0 border-b border-gray-200 dark:border-gray-600 p-0 text-center tabular-nums
                              text-[12px] font-bold text-gray-600 dark:text-gray-200 focus:outline-none focus:ring-0">명</label>
            <input id="sim-time-${t.id}" type="number" min="0" step="10" placeholder="0" inputmode="numeric" class="${NUM}">
            <span class="w-4 text-[11px] text-gray-400 dark:text-gray-500">분</span>
            <span id="sim-src-t-${t.id}" class="w-[64px] sm:w-[84px] shrink-0 text-center text-[11px] font-semibold text-gray-400 dark:text-gray-500 truncate">지난 4주 평균</span>
        </div>`;

    const block = (title, sub, rowsHtml, tone = '') => `
        <div class="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800/40">
            <div class="flex items-baseline gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
                <span class="text-[11px] font-extrabold tracking-wider ${tone || 'text-gray-500 dark:text-gray-400'}">${title}</span>
                ${sub ? `<span class="text-[11px] text-gray-400 dark:text-gray-500 truncate">${sub}</span>` : ''}
            </div>
            ${rowsHtml}
        </div>`;

    const qtyBlocks = SIM_GROUPS.map(g => {
        const rows = g.ids.map(id => SIM_TASKS.find(t => t.id === id)).filter(Boolean);
        return rows.length > 0 ? block(g.label, '', rows.map(row).join('')) : '';
    }).join('');

    // 자주 하는 업무와 가끔 하는 업무를 나눈다 — 목록이 길어져도 위쪽은 평소 모습 그대로 남는다
    const shown = activeTimeTasks();
    const freqTime = shown.filter(t => !t.rare);
    const rareTime = shown.filter(t => t.rare);
    const timeBlock =
        (freqTime.length > 0
            ? block('담당 · 시간 업무', '처리량이 없는 업무 — 총 투입시간(분)', freqTime.map(timeRow).join(''),
                    'text-indigo-500 dark:text-indigo-300')
            : '')
        + (rareTime.length > 0
            ? block('가끔 하는 시간 업무', '진행 빈도가 낮은 업무', rareTime.map(timeRow).join(''),
                    'text-indigo-400 dark:text-indigo-300/80')
            : '');

    // 예전에는 '항목이 많아 한 줄씩이면 화면을 넘친다' 는 이유로 lg 부터 2열이었다.
    // 지금은 자동값 그대로인 업무가 접혀 평소 3~6줄이라 그 이유가 없어졌고, 2열에서는
    // 한 칸이 ~320px 라 고정폭(입력·단위·출처배지·'하는 날' 버튼)에 밀려 업무명이
    // 0px 까지 눌려 잘렸다(실측: 직진배송·관리자 개별업무 등 6개). 아주 넓을 때만 2열로 둔다.
    // 2열은 **아주 넓을 때만**. 1536px(2xl)에서 켜면 바깥 레이아웃(1.35fr) 때문에
    // 한 칸이 ~394px 뿐이라, 1열에서 없앤 잘림이 그 구간으로 그대로 옮겨간다.
    host.className = 'grid grid-cols-1 min-[1800px]:grid-cols-2 gap-3 items-start';
    host.innerHTML = qtyBlocks + timeBlock;
    return true;
};

// 🧮 담당 업무의 '1인 기준 시간(분)'. 인원을 바꾸면 이 값 × 인원으로 총 투입시간을 다시 잡는다.
const timeTaskUnit = new Map();   // 업무명 → 1인 시간(분). id 는 목록 재구성 때 바뀌므로 키로 쓰지 않는다

const setTimeUnit = (t, minutes, workers) => {
    const w = Math.max(0, Math.round(Number(workers) || 0));
    if (w <= 0) return;              // 0명일 때는 1인 기준을 덮지 않는다(그대로 보존)
    // 분을 비웠을 때도 기준을 덮지 않는다. 덮으면 기준이 0 이 되어, 그 뒤 인원을 올려도
    // 분이 0 으로 남고 '기준 없음' 안내까지 떠서 사용자가 영문을 모른 채 막힌다.
    if (!(Number(minutes) > 0)) return;
    timeTaskUnit.set(t.key, Math.max(0, Math.round((Number(minutes) || 0) / w)));
};

/** 시간형 업무 입력칸 채우기 */
const setTimeInputs = (t, { minutes, workers }) => {
    const mEl = document.getElementById(`sim-time-${t.id}`);
    if (mEl) mEl.value = (minutes == null || minutes === 0) ? '' : Math.round(minutes);
    const wEl = document.getElementById(`sim-workers-${t.id}`);
    if (wEl) wEl.value = Math.max(0, Math.round(Number(workers) || 0));
};

const markTimeSourceBadge = (t, source, detail = '') => {
    const el = document.getElementById(`sim-src-t-${t.id}`);
    if (!el) return;
    const saved = source === 'planned-time';
    const zero = source === 'zero-default';
    const base = 'w-[64px] sm:w-[84px] shrink-0 text-center text-[11px] truncate';
    el.className = saved
        ? `${base} font-bold rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300`
        : `${base} font-medium text-gray-400 dark:text-gray-500`;
    el.textContent = saved ? '저장값' : (zero ? '기본 0명' : '지난 4주 평균');
    delete el.dataset.srcText;   // 보관해 둔 옛 글씨를 버린다(markSourceBadge 와 같은 이유)
    delete el.dataset.warn;
    const tip = saved
        ? '이 날짜에 직접 저장해 둔 투입시간입니다. 실적 평균보다 먼저 적용됩니다.'
        : (zero
            ? '기본 0명으로 두는 업무입니다. 평균을 미리 깔지 않으니 계획 시간이 부풀지 않고, 하는 날에 인원만 올리면 계획에 들어갑니다.'
            : '최근 4주 업무 기록의 실제 투입시간을 근무일 1일 평균으로 낸 값입니다.');
    el.title = detail ? `${tip}

${detail}` : tip;
};

/** 📉 오늘 값이 없는 업무는 접어 둔다.
 *  업무가 열댓 개인데 대부분 0인 날이 많아, 0인 줄이 화면 절반을 먹는다.
 *  숨긴 개수를 버튼으로 보여 주고, 누르면 모두 펼친다(값을 넣으려면 펼쳐야 하므로). */
let showEmptySimRows = false;

const isEmptyRowValue = (el) => {
    if (!el) return true;
    const v = String(el.value ?? '').trim();
    return v === '' || Number(v) === 0;
};

// ───────────────────────────────────────────────────────────
// 작업량 입력의 상태 — 접기 판정과 저장 범위를 가른다
// ───────────────────────────────────────────────────────────
/** 행별 접기 판정 재료. 키는 수량형=업무명, 시간형='t:'+업무명.
 *  autoFillSimInputs 가 화면을 채울 때 같이 채운다 — 그래야 화면에 실제로 들어간 값과 같다. */
const simRowMeta = new Map();

/** ✍️ 사람이 직접 고친 물량 칸(업무명).
 *
 *  저장이 '손댄 칸만' 으로 바뀐 뒤로 이 집합이 **유일한 판단축**이다. 오염되면
 *  사용자가 넣지 않은 값이 수기값으로 굳고, 비면 사용자 입력이 저장되지 않는다.
 *  채우는 곳은 입력 이벤트 2곳뿐이고, 비우는 곳은 autoFillSimInputs(화면을 덮는 모든 경로)·
 *  저장 완료·자동값·날짜 변경·전체 초기화다.
 *
 *  원래 목적은 '사람이 일부러 넣은 0' 과 '자동 추정이 넣은 0' 의 구분이었다 —
 *  자동으로 들어간 0 을 저장하면 그 0 이 다음부터 자동 추정을 이겨 그 날은 영구히 0 이 된다
 *  (실제로 교환반품이 9/15·16·17·22·28 에 0 으로 굳어 있었다). */
let simDirtyQty = new Set();
/** 시간형(분·인원)도 따로 센다 — 예전에는 수량형만 추적했다. */
let simDirtyTime = new Set();

/** 코드가 값을 다시 계산해 넣었을 때 접기 판정 재료도 같이 고친다.
 *  안 고치면 접힘 버튼 title 이 화면에 없는 옛 숫자를 보여 주고, outlier 판정도 옛 값으로 내려진다. */
const 덮어쓴meta = (metaKey, value, source) => {
    const m = simRowMeta.get(metaKey);
    if (!m) return;
    simRowMeta.set(metaKey, { ...m, value: Number(value) || 0, source: source ?? m.source });
};

const applyEmptyRowFolding = () => {
    const host = document.getElementById('sim-task-list');
    const wrap = document.getElementById('sim-empty-wrap');
    if (!host) return;

    // ⚠️ 숨기는 방법은 절대 바꾸지 않는다 — class 토글이라 DOM 에 그대로 남는다.
    //    행을 지우면 readSimInputs 가 '입력칸이 없는 업무는 건너뛴다' 로 되어 있어
    //    📌 계획 확정이 빈 계획을 찍고, 그 업무가 전부 '계획 외' 로 집계돼 정확도가 망가진다.
    let hidden = 0;
    const 접힌것 = [];
    const markRow = (rowId, fold, label, value) => {
        const row = document.getElementById(`sim-row-${rowId}`);
        if (!row) return;
        const hide = fold && !showEmptySimRows;
        row.classList.toggle('hidden', hide);
        if (hide) {
            hidden++;
            // 시간형은 분이다 — 단위 없이 수량과 나란히 쓰면 개수로 읽힌다
            const 단위 = String(rowId).startsWith('t-') ? '분' : '';
            접힌것.push(`${label} ${value > 0 ? value.toLocaleString() : 0}${단위}`);
        }
    };

    // 왜 펼쳐져 있는지를 **출처 배지 자리에** 쓴다(칸을 더 만들지 않는다 — 업무명이 잘린다).
    // 출처는 title 에 남으므로 마우스를 올리면 확인할 수 있다.
    const 사유표시 = (id, reason) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.dataset.warn === '1') return;   // 방금 띄운 경고를 덮지 않는다
        const 글 = (reason && reason !== 'saved') ? (FOLD_REASON_TEXT[reason] || '') : '';
        if (!글) {
            // 사유가 없거나 '내가 넣은 값' 이면 출처 배지를 그대로 둔다(이미 색으로 구분된다)
            if (el.dataset.srcText) { el.textContent = el.dataset.srcText; delete el.dataset.srcText; }
            return;
        }
        if (!el.dataset.srcText) el.dataset.srcText = el.textContent;
        el.textContent = 글;
    };

    const alwaysKeys = simAlwaysTasks();
    SIM_TASKS.forEach(t => {
        const meta = simRowMeta.get(t.key);
        const el = document.getElementById(`sim-qty-${t.id}`);
        // meta 가 아직 없으면(첫 렌더 등) 예전 기준으로 폴백한다
        // 폴백에서도 '손댄 칸은 접지 않는다' 는 규칙이 먼저다.
        // (preserveDirty 로 meta 를 못 채운 칸이 여기로 온다 — 방금 넣은 0 이 사라지면 안 된다)
        const always = alwaysKeys.has(t.key);
        const reason = simDirtyQty.has(t.key) ? 'edited'
            : (meta ? foldReasonFor({ ...meta, dirty: false, always })
                    : (always ? 'core' : (isEmptyRowValue(el) ? null : 'edited')));
        사유표시(`sim-src-${t.id}`, reason);
        markRow(t.id, reason === null, t.label, meta ? meta.value : (Number(el?.value) || 0));
    });
    SIM_TIME_TASKS.forEach(t => {
        const meta = simRowMeta.get('t:' + t.key);
        const noTime = isEmptyRowValue(document.getElementById(`sim-time-${t.id}`));
        const noOne  = (Number(document.getElementById(`sim-workers-${t.id}`)?.value) || 0) <= 0;
        const always = alwaysKeys.has(t.key);
        const reason = simDirtyTime.has(t.key) ? 'edited'
            : (meta ? foldReasonFor({ ...meta, dirty: false, always })
                    : (simZeroTasks().has(t.key) ? 'zero-default'
                       : (always ? 'core' : (!(noTime || noOne) ? 'edited' : null))));
        사유표시(`sim-src-t-${t.id}`, reason);
        markRow(`t-${t.id}`, reason === null, t.label, meta ? meta.value : 0);
    });

    // 구획 안이 전부 숨겨졌으면 구획째로 숨긴다(빈 제목만 남지 않도록)
    host.querySelectorAll(':scope > div').forEach(block => {
        const rows = block.querySelectorAll('.pred-sim-row');
        if (rows.length === 0) return;
        const allHidden = [...rows].every(r => r.classList.contains('hidden'));
        block.classList.toggle('hidden', allHidden);
    });

    if (!wrap) return;
    if (hidden === 0 && !showEmptySimRows) { wrap.innerHTML = ''; return; }
    // 접힌 업무의 이름·값을 title 에 전부 담는다 — 숫자가 사라진 게 아님을 확인할 수 있게.
    const 목록 = 접힌것.join(' · ');
    wrap.innerHTML = `
        <button type="button" id="sim-empty-toggle"
                title="${escapeHtml(목록 || '')}"
                class="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg
                       text-gray-500 dark:text-gray-400 bg-gray-100/70 dark:bg-gray-700/50
                       hover:bg-gray-200 dark:hover:bg-gray-600 transition">
            ${showEmptySimRows ? '▴ 자동값 그대로인 업무 접기' : `▾ 자동값 그대로 ${hidden}개 보기`}
        </button>`;
};

// ───────────────────────────────────────────────────────────
// 시뮬레이션 UI 핸들러
// ───────────────────────────────────────────────────────────
/** 화면을 자동값·저장값으로 채운다.
 *  @param {boolean} opts.preserveDirty 사람이 고친 칸은 건드리지 않는다(늦게 도착한 데이터용). */
const autoFillSimInputs = (dateStr, opts = {}) => {
    if (!dateStr) return;
    let preserveDirty = !!opts.preserveDirty;
    // 펼침은 '보기 상태' 라 함부로 되돌리지 않는다 — 새로고침·탭 전환마다 접히면
    // 사용자가 방금 펼친 것이 사라진다. 다른 날짜로 넘어갈 때와 자동값으로 되돌릴 때만 끈다
    // (전체 초기화가 켜 둔 펼침이 세션 내내 남는 것도 그 두 경로에서 정리된다).
    if (opts.resetFoldView) showEmptySimRows = false;
    const data = State.allHistoryData;
    const config = State.appConfig;

    // 업무 이력·설정이 늦게 도착하면 업무 목록도 그때 정해진다 — 바뀌었으면 입력칸을 다시 그린다
    // (시간형은 수량형 키를 빼고 뽑으므로 항상 수량형이 먼저다)
    // ⚠️ 다시 그리면 innerHTML 교체로 **타이핑한 값이 이미 사라진다.** 그 상태에서
    //    preserveDirty 로 그 칸을 건너뛰면 빈 칸 + dirty 가 남아 저장 때 0 으로 굳는다.
    //    지킬 값이 없으므로 그때는 전체를 다시 채운다.
    // ⚠️ '목록이 바뀌었다' 가 아니라 '실제로 다시 그렸다' 로 판정한다.
    //    업무 id 는 그대로인데 auto 모드만 바뀌면 ensureSimLists 는 true 지만 DOM 은 그대로다.
    //    그때까지 preserveDirty 를 끄면, 멀쩡히 살아 있는 사용자의 입력을 자동값으로 덮는다.
    if (ensureSimLists(true) && renderSimTaskInputs()) preserveDirty = false;

    // 접기 판정에 쓸 재료를 같이 모은다. 여기서 모아야 화면에 실제로 들어간 값과 같다
    //  — 나중에 따로 계산하면 화면 숫자와 판정이 어긋난다.
    simRowMeta.clear();
    const uphMap = computeTaskUPHs(data);      // 루프 밖에서 1회

    // 모든 업무가 기본 등록 — 예정 물량이 있으면 그 값, 없으면 업무별 자동값
    SIM_TASKS.forEach(t => {
        if (preserveDirty && simDirtyQty.has(t.key)) return;   // 사람이 고친 칸은 그대로 둔다
        const { value, source, detail, dayValue } = autoValueFor(dateStr, t, data);
        setQty(t.id, value);
        markSourceBadge(t, source, detail, dayValue);
        simRowMeta.set(t.key, {
            kind: 'qty',
            value: Number(value) || 0,
            source,
            uph: uphMap[t.key] || 0,
            // '평소' 는 배지 '지난 7회 평균' 과 같은 숫자를 쓴다(화면과 어긋나지 않게)
            base: computeLast7Avg(data, t.key),
            sample: analyzeCadence(data, t.key)?.hits || 0
        });
    });

    // 시간으로 잡는 업무(개인담당업무 등) — 저장값 › 실적 평균
    const zeroKeysForFold = simZeroTasks();
    SIM_TIME_TASKS.forEach(t => {
        if (preserveDirty && simDirtyTime.has(t.key)) return;
        const v = autoTimeValueFor(dateStr, t, data);
        setTimeInputs(t, v);
        timeTaskUnit.set(t.key, Math.max(0, Math.round(Number(v.unitMinutes ?? v.minutes) || 0)));
        markTimeSourceBadge(t, v.source, v.detail);
        simRowMeta.set('t:' + t.key, {
            kind: 'time',
            value: Number(v.minutes) || 0,
            source: v.source,
            zeroDefault: zeroKeysForFold.has(t.key)
        });
    });

    // 가용 인원
    const staffInfo = computeAvailableStaff(dateStr, config, State.persistentLeaveSchedule, data);
    const elStaff = document.getElementById('sim-staff-fulltime');
    if (elStaff) elStaff.value = staffInfo.available;
    // 이 날짜에 저장해 둔 업무 제외시간이 있으면 그 값으로 (없으면 비운다)
    const exEl = document.getElementById('sim-exclude-min');
    if (exEl) {
        const savedEx = getPlannedExcludeMinutesForDate(dateStr);
        exEl.value = (savedEx != null && savedEx > 0) ? savedEx : '';
    }
    paintExcludeHint();

    renderLeaveInfo(staffInfo);
    paintStaffTotal();
    // 🔑 이 함수는 '화면을 자동값·저장값으로 덮는다' 는 뜻이다. 그러니 여기서 '손댐' 기록을
    //    비운다. 안 비우면 가장 위험한 경로가 열린다 — fetchPlannedData().then 이 사용자가
    //    타이핑한 직후 늦게 도착해 화면을 덮는데 dirty 는 남아, 저장을 누르면 **사용자가
    //    넣지 않은 값이 '수기값' 으로 저장된다.** 새로고침 버튼·탭 진입·설정 저장 후
    //    재채움까지 네 경로가 여기서 한 번에 막힌다.
    //    ⚠️ 그래서 이 함수 안에서는 setQty/setTimeInputs 같은 '코드가 값을 넣는' 경로만
    //       써야 한다(그 함수들은 input 이벤트를 발생시키지 않아 dirty 를 오염시키지 않는다).
    if (!preserveDirty) { simDirtyQty = new Set(); simDirtyTime = new Set(); }
    applyEmptyRowFolding();
};

/** 제외시간 옆 안내 문구 ('1시간 20분 차감') */
const paintExcludeHint = () => {
    const hint = document.getElementById('sim-exclude-hint');
    if (!hint) return;
    const m = readExcludeMinutes();
    const saved = getPlannedExcludeMinutesForDate(document.getElementById('sim-target-date')?.value);
    hint.textContent = m > 0 ? `${fmtMin(m)} 차감${saved != null && saved === m ? ' · 저장됨' : ''}` : '10분 단위';
    paintStaffChip();
};

/** 휴무자 명단 — 이름과 종류를 한 덩어리(칩)로 묶어 줄바꿈이 이름 사이를 끊지 않게 한다.
 *  (예전에는 "이승운(휴직)"이 "이 / 승운 / (휴직)"처럼 글자 단위로 쪼개져 읽을 수 없었다) */
const renderLeaveInfo = (staffInfo) => {
    const el = document.getElementById('sim-on-leave-info');
    if (!el) return;
    const tail = `<span class="whitespace-nowrap">총 ${staffInfo.total}명 중 <strong class="text-gray-700 dark:text-gray-200">${staffInfo.available}명 가용</strong></span>`;

    if (!staffInfo.onLeaveList || staffInfo.onLeaveList.length === 0) {
        el.innerHTML = `<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="whitespace-nowrap text-[11px] font-bold text-gray-600 dark:text-gray-300">📅 등록된 휴무 없음</span>
            ${tail}
        </div>`;
        return;
    }

    const chips = staffInfo.onLeaveList.map(e => `
        <span class="inline-flex items-center gap-1 whitespace-nowrap px-1.5 py-0.5 rounded-md
                     bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <span class="font-bold text-gray-600 dark:text-gray-300">${escapeHtml(e.member)}</span>
            <span class="text-gray-400 dark:text-gray-500">${escapeHtml(e.type)}</span>
        </span>`).join('');

    el.innerHTML = `<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="whitespace-nowrap text-[11px] font-bold text-gray-600 dark:text-gray-300">📅 휴무 ${staffInfo.onLeaveList.length}명</span>
        ${chips}
        ${tail}
    </div>`;
};

/** 정직원 + 알바 합계 표시 */
const paintStaffTotal = () => {
    const f = Number(document.getElementById('sim-staff-fulltime')?.value) || 0;
    const p = Number(document.getElementById('sim-staff-parttimer')?.value) || 0;
    const el = document.getElementById('sim-staff-total');
    if (el) el.textContent = Math.round(f + p).toLocaleString();
    paintStaffChip();
};

/** 접어 둔 '인원' 칸의 요약 칩 — 열지 않아도 현재 값이 보이도록 한다. */
const paintStaffChip = () => {
    const chip = document.getElementById('sim-staff-chip');
    if (!chip) return;
    const f = Number(document.getElementById('sim-staff-fulltime')?.value) || 0;
    const p = Number(document.getElementById('sim-staff-parttimer')?.value) || 0;
    const ex = readExcludeMinutes();
    const parts = [`가용 ${Math.round(f + p)}명`];
    if (p > 0) parts.push(`알바 ${p}명 포함`);
    if (ex > 0) parts.push(`제외 ${fmtMin(ex)}`);
    chip.textContent = parts.join(' · ');
};

const readSimInputs = () => {
    // ⚠️ 입력칸이 없는 업무는 건너뛴다. 0 으로 읽으면, 목록이 늘어난 직후처럼 아직 칸이
    //    안 그려진 업무를 '작업량 저장'이 0 으로 덮어써 예정 물량이 조용히 사라진다.
    const tasks = {};
    SIM_TASKS.forEach(t => {
        const el = document.getElementById(`sim-qty-${t.id}`);
        if (!el) return;
        tasks[t.key] = Number(el.value) || 0;
    });
    const timeTasks = {};
    activeTimeTasks().forEach(t => {
        const mEl = document.getElementById(`sim-time-${t.id}`);
        const wEl = document.getElementById(`sim-workers-${t.id}`);
        if (!mEl && !wEl) return;
        timeTasks[t.key] = {
            minutes: Math.max(0, Math.round(Number(mEl?.value) || 0)),
            workers: Math.max(0, Math.round(Number(wEl?.value) || 0))
        };
    });
    const staffFulltime = Number(document.getElementById('sim-staff-fulltime')?.value) || 0;
    const staffPart = Number(document.getElementById('sim-staff-parttimer')?.value) || 0;
    return { tasks, timeTasks, staffFulltime, staffPart, excludeMinutes: readExcludeMinutes() };
};

/** ⏱ 업무 제외시간 — 그날 업무 외의 일(회의·행사·정리 등)로 빠지는 시간(1인 기준, 10분 단위) */
const readExcludeMinutes = () => {
    const raw = Number(document.getElementById('sim-exclude-min')?.value) || 0;
    if (raw <= 0) return 0;
    return Math.round(raw / EXCLUDE_STEP_MIN) * EXCLUDE_STEP_MIN;   // 10분 단위로 맞춤
};

const simulateOneDay = (dateStr, inputs, taskUPH, config) => {
    const stdHours = config?.standardDailyWorkHours || { weekday: 8, weekend: 4 };
    const weekend = isWeekendDate(dateStr);
    const dailyHours = weekend ? (Number(stdHours.weekend) || 4) : (Number(stdHours.weekday) || 8);

    // 업무 제외시간을 빼고 남는 '실제 업무에 쓸 수 있는 시간'(1인 기준)
    // 제외시간이 하루 업무시간을 다 먹으면 필요 인원이 0으로 나와 오히려 오해를 부른다.
    // 최소 30분은 남겨 두고 계산한다(그만큼 인원이 폭증하는 결과로 보이도록).
    const excludeMinutes = Math.min(
        Math.max(0, Math.round(Number(inputs.excludeMinutes) || 0)),
        Math.max(0, Math.round((dailyHours - 0.5) * 60))
    );
    const excludeHours = excludeMinutes / 60;
    const netDailyHours = Math.max(0.5, dailyHours - excludeHours);

    const availableTotal = Math.round(inputs.staffFulltime + inputs.staffPart);

    // ① 수량으로 잡는 업무 — 물량 ÷ UPH = 인시
    const taskTimes = {};
    let qtyHours = 0;
    SIM_TASKS.forEach(t => {
        const qty = inputs.tasks[t.key] || 0;
        const uph = taskUPH[t.key] || 0;
        const hours = (qty > 0 && uph > 0) ? qty / uph : 0;
        taskTimes[t.key] = { qty, uph, hours, elapsed: 0 };
        qtyHours += hours;
    });

    // ② 시간으로 잡는 업무 — 실적에서 온 '실제로 붙어 있던 시간'이라 가동률로 다시 깎지 않는다
    const timeTaskTimes = {};
    let timeElapsedFloor = 0, timeHours = 0;
    activeTimeTasks().forEach(t => {
        const e = (inputs.timeTasks || {})[t.key] || {};
        const workers = Math.max(0, Math.round(Number(e.workers) || 0));
        // 인원 0명 = 그날은 하지 않는 업무 → 시간도 0으로 본다
        const minutes = workers > 0 ? Math.max(0, Math.round(Number(e.minutes) || 0)) : 0;
        // 입력칸은 '총 투입시간(인분)'. 인원이 늘면 그만큼 총시간이 커지고(각자 자기 몫),
        // 각자 붙어 있는 시간은 총시간을 인원으로 나눈 값이다.
        const hours = minutes / 60;               // 인시(사람×시간)
        const elapsed = workers > 0 ? hours / workers : 0;   // 담당자 한 사람이 붙어 있는 시간
        timeTaskTimes[t.key] = { minutes, workers, hours, elapsed };
        timeHours += hours;
        timeElapsedFloor = Math.max(timeElapsedFloor, elapsed);
    });

    const totalHours = qtyHours + timeHours;

    // ③ 담당 업무에 묶이는 인력 — 그 시간 동안 이 사람들은 다른 업무를 할 수 없다.
    //    묶이는 양을 인원(FTE)으로 환산해 가용 인원에서 뺀 뒤, 나머지로 물량 업무를 계산한다.
    //    (예전에는 담당 업무 시간에도 전체 인원이 물량 업무를 하는 것으로 계산돼 시간이 짧게 나왔다)
    const tiedFTE = netDailyHours > 0 ? timeHours / netDailyHours : 0;
    const qtyStaff = Math.max(0, availableTotal - tiedFTE);
    const qtyRate = qtyStaff * UTILIZATION;                 // 물량 업무에 붙는 팀의 시간당 처리 인시
    const staffShortForQty = qtyHours > 0 && qtyRate <= 0;  // 담당 업무가 인원을 다 먹은 경우
    const qtyElapsed = qtyRate > 0 ? qtyHours / qtyRate : 0;
    Object.keys(taskTimes).forEach(k => {
        taskTimes[k].elapsed = qtyRate > 0 ? taskTimes[k].hours / qtyRate : 0;
    });

    // ④ 필요 인원 — 물량 업무는 가동률을 감안하고, 담당 업무는 실제 시간 그대로 더한다
    const rawRequiredFTE = netDailyHours > 0
        ? (qtyHours / UTILIZATION + timeHours) / netDailyHours
        : 0;
    const requiredFTE = Math.round(rawRequiredFTE);
    const gap = availableTotal - requiredFTE;

    // ⑤ 시간 관점
    //  - totalHours   : 총 소요시간 = 모든 업무의 인시 합계
    //  - elapsedHours : 실 소요시간 = 물량 업무를 남은 인원으로 끝내는 시간과,
    //                   담당자가 담당 업무에 붙어 있는 시간 중 더 긴 쪽
    //  - slackHours   : 다 끝내고 남는 시간(+) / 정규 시간을 넘기는 시간(-)
    const elapsedHours = Math.max(qtyElapsed, timeElapsedFloor);
    const elapsedCappedByTimeTask = timeElapsedFloor > qtyElapsed && timeElapsedFloor > 0;
    const capacityHours = availableTotal * netDailyHours * UTILIZATION;   // 그날 처리 가능한 인시
    const slackHours = netDailyHours - elapsedHours;

    return {
        date: dateStr, weekend, dailyHours, netDailyHours, excludeMinutes,
        taskTimes, timeTaskTimes, qtyHours, timeHours, totalHours,
        tiedFTE, qtyStaff, staffShortForQty, qtyElapsed,
        elapsedHours, elapsedCappedByTimeTask, capacityHours, slackHours,
        rawRequiredFTE, requiredFTE, availableTotal, gap
    };
};

const runSimulation = ({ silent = false } = {}) => {
    const dateEl = document.getElementById('sim-target-date');
    const modeEl = document.getElementById('sim-mode');
    if (!dateEl?.value) {
        if (!silent) alert('대상일을 선택해주세요.');
        else showResultPlaceholder();
        return;
    }
    const baseDate = dateEl.value;
    const mode = modeEl?.value || 'single';

    const baseInputs = readSimInputs();
    const taskUPH = computeTaskUPHs(State.allHistoryData);
    const cfg = State.appConfig;

    const dates = mode === 'batch7'
        ? Array.from({ length: 7 }, (_, i) => addDays(baseDate, i))
        : [baseDate];

    // 🔀 진행이 애매한 빈도형 업무 — 기본값은 0이지만, '진행할 때'의 결과도 함께 낸다.
    //    (사람이 직접 숫자를 넣어 둔 칸은 건드리지 않는다)
    const maybeTasks = [];
    if (mode === 'single') {
        SIM_TASKS.forEach(t => {
            if (t.auto !== 'cadence') return;
            if ((baseInputs.tasks[t.key] || 0) > 0) return;
            // 사람이 직접 0 을 넣었으면 '안 한다'고 정한 것이다 — 빈칸일 때만 애매하다고 본다
            if ((document.getElementById(`sim-qty-${t.id}`)?.value ?? '') !== '' && !baseInputs.tasks[t.key]) {
                const auto = cadenceValueFor(State.allHistoryData, t.key, baseDate);
                if (!auto.uncertain || auto.dayValue <= 0) return;
            }
            if (todayActualQty(State.allHistoryData, baseDate, t.key) != null) return;
            // 예정 물량에 0 이 저장돼 있어도 '안 하기로 정했다'로 보진 않는다(자동 0 이 그대로 저장된 경우가 많다)
            if ((getPlanned(baseDate, t.key) || 0) > 0) return;
            // 기준 속도가 없으면 물량을 넣어도 시간이 0 이라 '진행 시' 결과가 같게 나온다 — 혼란만 준다
            if (!(taskUPH[t.key] > 0)) return;
            const info = cadenceValueFor(State.allHistoryData, t.key, baseDate);
            if (info.uncertain && info.dayValue > 0) {
                maybeTasks.push({ key: t.key, label: t.label, qty: info.dayValue, prob: info.prob });
            }
        });
    }

    const results = dates.map((d, i) => {
        if (mode === 'single' || i === 0) {
            return simulateOneDay(d, baseInputs, taskUPH, cfg);
        }
        // batch 모드의 2일차 이후: 날짜별 자동값(예정 물량 우선) 사용
        const autoTasks = {};
        // 빈도형 업무는 autoQtyFor 안에서 그 주 배치표를 거친다(화면마다 같은 값)
        SIM_TASKS.forEach(t => { autoTasks[t.key] = autoQtyFor(d, t, State.allHistoryData); });
        const autoTimeTasks = {};
        activeTimeTasks().forEach(t => {
            const v = autoTimeValueFor(d, t, State.allHistoryData);
            autoTimeTasks[t.key] = { minutes: v.minutes, workers: v.workers };
        });
        const staffInfo = computeAvailableStaff(d, cfg, State.persistentLeaveSchedule, State.allHistoryData);
        const dayInputs = { tasks: autoTasks, timeTasks: autoTimeTasks,
                            staffFulltime: staffInfo.available, staffPart: baseInputs.staffPart,
                            excludeMinutes: getPlannedExcludeMinutesForDate(d) ?? baseInputs.excludeMinutes };
        return simulateOneDay(d, dayInputs, taskUPH, cfg);
    });

    // '진행 시' 시나리오 — 애매한 업무에 하는 날 물량을 넣고 한 번 더 계산
    let altResult = null;
    if (maybeTasks.length > 0) {
        const altTasks = { ...baseInputs.tasks };
        maybeTasks.forEach(m => { altTasks[m.key] = m.qty; });
        altResult = simulateOneDay(baseDate, { ...baseInputs, tasks: altTasks }, taskUPH, cfg);
    }

    renderSimResult(results, taskUPH, mode, { maybeTasks, altResult });
};

// ───────────────────────────────────────────────────────────
// 결과 렌더
// ───────────────────────────────────────────────────────────
// 과부족 표현은 색 배지(GAP_TONE)로 통일했다. 아이콘/글자색 헬퍼는 더 쓰지 않는다.
const gapText  = g => g > 1 ? `${Math.round(g)}명 여유` : (g < -1 ? `${Math.abs(Math.round(g))}명 부족` : '적정');
const fmtH     = h => `${(h || 0).toFixed(1)}h`;
/** 2.5 → '2시간 30분' (시간은 분 단위까지 봐야 감이 온다) */
const fmtHM = formatHM;   // 정의는 utils.js 한 곳에
/** 제외시간 표기: 90 → '1시간 30분' */
const fmtMin = (m) => fmtHM((Number(m) || 0) / 60);

/** 결과칸이 비어 있을 때 자리 안내 (오른쪽 칸이 휑하지 않도록) */
const resultPlaceholder = () => `
    <section class="rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 bg-white/60 dark:bg-gray-800/30
                    p-8 text-center text-gray-400 dark:text-gray-500">
        <div class="text-2xl mb-2">📊</div>
        <p class="text-[11px] leading-relaxed">왼쪽에서 값을 고친 뒤 <b>시뮬레이션 실행</b>을 누르면<br>여기에 결과가 나옵니다.</p>
    </section>`;

const showResultPlaceholder = () => {
    const el = document.getElementById('sim-result-container');
    if (el) el.innerHTML = resultPlaceholder();
};

const renderSimResult = (results, taskUPH, mode, scenario = {}) => {
    const container = document.getElementById('sim-result-container');
    if (!container) return;

    const cardOpen = (title, sub) => `
        <section class="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <header class="px-4 md:px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 flex flex-col md:flex-row md:items-center justify-between gap-1.5">
                <h4 class="text-sm font-extrabold text-gray-800 dark:text-white">${title}</h4>
                <div class="text-[11px] text-gray-400 dark:text-gray-500">${sub}</div>
            </header>`;

    if (mode === 'single') {
        const r = results[0];
        const tone = GAP_TONE(r.gap);
        const rows = SIM_TASKS.map(t => {
            const v = r.taskTimes[t.key];
            if (!v || v.qty <= 0) return '';
            // 소요시간이 긴 업무가 눈에 띄도록 막대를 함께 그린다.
            const w = r.totalHours > 0 ? Math.max(2, Math.round(v.hours / r.totalHours * 100)) : 0;
            return `<tr class="border-t border-gray-100 dark:border-gray-700/60">
                <td class="py-2 px-3 font-medium text-gray-700 dark:text-gray-200">${escapeHtml(t.label)}</td>
                <td class="py-2 px-3 text-right tabular-nums">${v.qty.toLocaleString()}</td>
                <td class="py-2 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400">${v.uph > 0 ? v.uph.toFixed(1) : '<span class="text-gray-300 dark:text-gray-600">기준 없음</span>'}</td>
                <td class="py-2 px-3 text-right">
                    <div class="flex items-center justify-end gap-2">
                        <div class="hidden sm:block w-16 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                            <div class="h-full bg-indigo-400 dark:bg-indigo-500 rounded-full" style="width:${w}%"></div>
                        </div>
                        <span class="font-bold tabular-nums text-gray-800 dark:text-gray-100">${v.uph > 0 ? fmtH(v.hours) : '—'}</span>
                    </div>
                </td>
                <td class="py-2 px-3 text-right tabular-nums font-bold text-indigo-600 dark:text-indigo-300"
                    title="물량 업무에 투입되는 ${r.qtyStaff.toFixed(1)}명이 이 업무에만 붙었을 때 걸리는 시간${r.timeHours > 0 ? ` (가용 ${r.availableTotal}명 − 담당 업무에 묶인 ${r.tiedFTE.toFixed(1)}명)` : ''}">${(v.uph > 0 && r.qtyStaff > 0) ? fmtHM(v.elapsed) : '—'}</td>
            </tr>`;
        }).filter(Boolean).join('');

        // ⏳ 시간으로 잡는 업무 — 수량·UPH 칸은 비우고 시간만 보여준다
        const timeRows = activeTimeTasks().map(t => {
            const v = r.timeTaskTimes?.[t.key];
            if (!v || v.minutes <= 0) return '';
            const w = r.totalHours > 0 ? Math.max(2, Math.round(v.hours / r.totalHours * 100)) : 0;
            return `<tr class="border-t border-gray-100 dark:border-gray-700/60 bg-indigo-50/30 dark:bg-indigo-900/10">
                <td class="py-2 px-3 font-medium text-gray-700 dark:text-gray-200">${escapeHtml(t.label)}
                    <span class="ml-1 text-[10px] font-bold text-indigo-500 dark:text-indigo-300">시간형</span></td>
                <td class="py-2 px-3 text-right tabular-nums text-gray-400 dark:text-gray-600">${v.minutes}분</td>
                <td class="py-2 px-3 text-right tabular-nums text-gray-400 dark:text-gray-600">담당 ${v.workers}명</td>
                <td class="py-2 px-3 text-right">
                    <div class="flex items-center justify-end gap-2">
                        <div class="hidden sm:block w-16 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                            <div class="h-full bg-indigo-300 dark:bg-indigo-600 rounded-full" style="width:${w}%"></div>
                        </div>
                        <span class="font-bold tabular-nums text-gray-800 dark:text-gray-100">${fmtH(v.hours)}</span>
                    </div>
                </td>
                <td class="py-2 px-3 text-right tabular-nums font-bold text-indigo-600 dark:text-indigo-300"
                    title="총 ${v.minutes}분을 ${v.workers}명이 각자 ${Math.round(v.minutes / v.workers)}분씩 (인시 합계 ${fmtH(v.hours)})">${fmtHM(v.elapsed)}</td>
            </tr>`;
        }).filter(Boolean).join('');

        const stat = (label, value, sub, cls) => `
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/30 p-3">
                <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500 tracking-wide">${label}</div>
                <div class="text-2xl font-black mt-1 ${cls || 'text-gray-900 dark:text-white'}">${value}</div>
                <div class="text-[10px] text-gray-400 dark:text-gray-500 mt-1">${sub}</div>
            </div>`;

        // ⏱ 시간 결과 — 다 끝내고 남는 시간(+) / 정규 시간을 넘기는 시간(-)
        const slackPositive = r.slackHours >= 0;
        const slackCls = r.availableTotal <= 0 ? 'text-gray-400'
            : (slackPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400');
        const slackLabel = r.availableTotal <= 0 ? '—'
            : (slackPositive ? `${fmtHM(r.slackHours)} 남음` : `${fmtHM(Math.abs(r.slackHours))} 초과`);

        // 🔀 진행이 애매한 업무 — '안 할 때(위 숫자)'와 '할 때'를 나란히 보여준다.
        //    실측: 그날 하는지 맞히는 정확도는 2/3 정도라, 한쪽만 보여주면 어느 쪽이든 틀린 계획이 된다.
        const { maybeTasks = [], altResult = null } = scenario;
        const maybePanel = (maybeTasks.length > 0 && altResult) ? `
                <div class="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-900/15 p-3 space-y-2">
                    <div class="text-[11px] font-extrabold text-amber-800 dark:text-amber-300">
                        진행할지 애매한 업무 ${maybeTasks.length}건 — 위 숫자는 <b>안 할 때</b> 기준입니다
                    </div>
                    <div class="flex flex-wrap gap-1.5">
                        ${maybeTasks.map(m => `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/70 dark:bg-gray-800/60 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/60">
                            ${escapeHtml(m.label)} ${m.qty.toLocaleString()}개 · 확률 ${Math.round((m.prob || 0) * 100)}%</span>`).join('')}
                    </div>
                    <div class="grid grid-cols-3 gap-2 text-center">
                        <div class="rounded-lg bg-white/70 dark:bg-gray-800/60 py-2">
                            <div class="text-[10px] font-bold text-gray-400">진행 시 필요 인원</div>
                            <div class="text-lg font-black text-amber-700 dark:text-amber-300">${altResult.requiredFTE}명</div>
                        </div>
                        <div class="rounded-lg bg-white/70 dark:bg-gray-800/60 py-2">
                            <div class="text-[10px] font-bold text-gray-400">진행 시 실 소요시간</div>
                            <div class="text-lg font-black text-amber-700 dark:text-amber-300">${altResult.availableTotal > 0 ? fmtHM(altResult.elapsedHours) : '—'}</div>
                        </div>
                        <div class="rounded-lg bg-white/70 dark:bg-gray-800/60 py-2">
                            <div class="text-[10px] font-bold text-gray-400">진행 시 과부족</div>
                            <div class="text-lg font-black text-amber-700 dark:text-amber-300">${gapText(altResult.gap)}</div>
                        </div>
                    </div>
                    <div class="text-[10px] text-amber-700/80 dark:text-amber-300/70">
                        진행하기로 정해졌다면 왼쪽 입력칸의 <b>[하는 날]</b> 값을 눌러 넣고 다시 실행하세요.
                    </div>
                </div>` : '';

        container.innerHTML = `
        ${cardOpen(`${dayLabel(r.date)}${r.weekend ? ' <span class="text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-0.5 rounded ml-1">주말</span>' : ''}`,
                   `기준 UPH 최근 4주 평균 · 1일 ${r.dailyHours}h${r.excludeMinutes > 0 ? ` − 제외 ${fmtMin(r.excludeMinutes)} = ${fmtHM(r.netDailyHours)}` : ''} · 가동률 ${(UTILIZATION*100)|0}%`)}
            <div class="p-4 md:p-5 space-y-4">
                <!-- 판단에 필요한 숫자 셋만 크게. 나머지 근거는 아래 '업무별 상세'에 접어 둔다. -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    ${stat('필요 인원', `${r.requiredFTE}<span class="text-sm font-bold text-gray-400 ml-0.5">명</span>`,
                           `가용 ${r.availableTotal}명`)}
                    ${stat('실 소요시간', r.availableTotal > 0 ? fmtHM(r.elapsedHours) : '—',
                           r.availableTotal <= 0 ? '가용 인원을 입력하세요'
                             : (r.elapsedCappedByTimeTask
                                 ? `담당 업무가 끝나는 시간에 걸림`
                                 : `투입 ${r.qtyStaff.toFixed(1)}명이 함께 할 때`),
                           'text-indigo-600 dark:text-indigo-300')}
                    ${stat(slackPositive ? '남는 시간' : '초과 시간', slackLabel,
                           `업무시간 ${fmtHM(r.netDailyHours)} 기준`,
                           slackCls)}
                </div>

                ${maybePanel}

                <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span class="text-sm font-extrabold px-3 py-1 rounded-full ${tone.chip}">${gapText(r.gap)}</span>
                    <span class="text-[11px] text-gray-400 dark:text-gray-500">
                        총 소요시간 <b class="text-gray-600 dark:text-gray-300">${fmtHM(r.totalHours)}</b> (인시 합계)
                        ${r.excludeMinutes > 0 ? ` · 제외 ${fmtMin(r.excludeMinutes)} 반영` : ''}
                    </span>
                </div>

                <details class="group">
                    <summary class="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none inline-flex items-center gap-1
                                    text-[11px] font-bold text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-300 transition">
                        <span class="transition-transform group-open:rotate-90">▸</span>업무별 상세
                    </summary>
                    <div class="mt-3 space-y-3">

                ${r.timeHours > 0 ? `<p class="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    ⏳ 담당 업무 ${fmtHM(r.timeHours)}에 <b>${r.tiedFTE.toFixed(1)}명</b>이 묶여,
                    물량 업무에는 <b>${r.qtyStaff.toFixed(1)}명</b>이 투입되는 것으로 계산했습니다
                    (물량 업무 ${r.staffShortForQty ? '계산 불가' : fmtHM(r.qtyElapsed)}).
                    ${r.elapsedCappedByTimeTask ? '실 소요시간은 <b>담당 업무 시간</b>에 걸려 있습니다 — 인원을 더 넣어도 그보다 빨리 끝나지 않습니다.' : ''}
                    ${r.staffShortForQty ? '<span class="text-rose-600 dark:text-rose-400 font-bold">담당 업무가 가용 인원을 모두 차지해 물량 업무를 할 사람이 없습니다.</span>' : ''}
                </p>` : ''}

                <div class="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead class="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                                <tr>
                                    <th class="py-2.5 px-3 text-left font-bold">작업</th>
                                    <th class="py-2.5 px-3 text-right font-bold">수량 (개)</th>
                                    <th class="py-2.5 px-3 text-right font-bold">기준 UPH</th>
                                    <th class="py-2.5 px-3 text-right font-bold" title="이 업무에 들어가는 인시(사람×시간) 합계입니다.">총 소요시간</th>
                                    <th class="py-2.5 px-3 text-right font-bold" title="실제로 흘러가는 시간입니다. 물량 업무는 담당 업무에 묶인 인원을 뺀 '투입 인원' 기준, 담당 업무는 그 업무의 동시 인원 기준입니다.">실 소요시간</th>
                                </tr>
                            </thead>
                            <tbody>${(rows + timeRows) || '<tr><td colspan="5" class="py-6 text-center text-gray-400">입력된 작업량이 없습니다.</td></tr>'}</tbody>
                            <tfoot class="bg-gray-50 dark:bg-gray-900/40 font-extrabold text-gray-800 dark:text-gray-100">
                                <tr class="border-t border-gray-200 dark:border-gray-700">
                                    <td class="py-2.5 px-3" colspan="3">합계</td>
                                    <td class="py-2.5 px-3 text-right tabular-nums">${fmtH(r.totalHours)}</td>
                                    <td class="py-2.5 px-3 text-right tabular-nums text-indigo-600 dark:text-indigo-300">${r.availableTotal > 0 ? fmtHM(r.elapsedHours) : '—'}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>

                    </div>
                </details>
            </div>
        </section>`;
    } else {
        const trows = results.map(r => {
            const tone = GAP_TONE(r.gap);
            return `
            <tr class="border-t border-gray-100 dark:border-gray-700/60 ${r.weekend ? 'bg-amber-50/40 dark:bg-amber-900/10' : ''}">
                <td class="py-2.5 px-3 font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">${dayLabel(r.date)}${r.weekend ? ' <span class="text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1 rounded">주말</span>' : ''}</td>
                <td class="py-2.5 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400">${fmtH(r.totalHours)}</td>
                <td class="py-2.5 px-3 text-right tabular-nums font-bold text-indigo-600 dark:text-indigo-300">${r.availableTotal > 0 ? fmtHM(r.elapsedHours) : '—'}</td>
                <td class="py-2.5 px-3 text-right tabular-nums font-bold ${r.availableTotal <= 0 ? 'text-gray-400' : (r.slackHours >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}">${r.availableTotal > 0 ? (r.slackHours >= 0 ? `+${fmtHM(r.slackHours)}` : `-${fmtHM(Math.abs(r.slackHours))}`) : '—'}</td>
                <td class="py-2.5 px-3 text-right tabular-nums font-bold">${r.requiredFTE}</td>
                <td class="py-2.5 px-3 text-right tabular-nums font-bold">${r.availableTotal}</td>
                <td class="py-2.5 px-3 text-right"><span class="text-[11px] font-extrabold px-2 py-1 rounded-full ${tone.chip}">${gapText(r.gap)}</span></td>
            </tr>`;
        }).join('');
        const sumRequired = results.reduce((s, r) => s + r.requiredFTE, 0);
        const sumAvail    = results.reduce((s, r) => s + r.availableTotal, 0);
        const shortageDays = results.filter(r => r.gap < -1).length;
        const surplusDays  = results.filter(r => r.gap > 1).length;
        const partN = Number(document.getElementById('sim-staff-parttimer')?.value) || 0;
        const exclM = results[0]?.excludeMinutes || 0;
        const sumHours = results.reduce((s, r) => s + r.totalHours, 0);

        const mini = (label, value, cls) => `
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/30 p-2.5 text-center">
                <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500">${label}</div>
                <div class="text-base font-black mt-0.5 ${cls || 'text-gray-900 dark:text-white'}">${value}</div>
            </div>`;

        container.innerHTML = `
        ${cardOpen('7일치 일괄 시뮬레이션', `대상일 외 6일은 자동값 사용 · 알바 ${partN}명 동일 적용${exclM > 0 ? ` · 업무 제외시간 ${fmtMin(exclM)} 반영` : ''}`)}
            <div class="p-4 md:p-5 space-y-4">
                <div class="grid grid-cols-[repeat(2,minmax(0,1fr))] md:grid-cols-[repeat(4,minmax(0,1fr))] gap-2.5">
                    ${mini('합계 필요', `${sumRequired}<span class="text-[11px] font-bold text-gray-400 ml-0.5">명·일</span>`)}
                    ${mini('합계 가용', `${sumAvail}<span class="text-[11px] font-bold text-gray-400 ml-0.5">명·일</span>`)}
                    ${mini('부족 일수', `${shortageDays}<span class="text-[11px] font-bold text-gray-400 ml-0.5">일</span>`, 'text-rose-600 dark:text-rose-400')}
                    ${mini('여유 일수', `${surplusDays}<span class="text-[11px] font-bold text-gray-400 ml-0.5">일</span>`, 'text-emerald-600 dark:text-emerald-400')}
                    ${mini('합계 총 소요시간', fmtHM(sumHours))}
                    ${mini('초과 예상 일수', `${results.filter(r => r.availableTotal > 0 && r.slackHours < 0).length}<span class="text-[11px] font-bold text-gray-400 ml-0.5">일</span>`, 'text-rose-600 dark:text-rose-400')}
                </div>
                <div class="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead class="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                                <tr>
                                    <th class="py-2.5 px-3 text-left font-bold">일자</th>
                                    <th class="py-2.5 px-3 text-right font-bold" title="인시(사람×시간) 합계">총 소요시간</th>
                                    <th class="py-2.5 px-3 text-right font-bold" title="실제로 흘러가는 시간 — 담당 업무에 묶인 인원을 뺀 인원으로 물량 업무를 끝내는 시간과, 담당 업무가 끝나는 시간 중 더 긴 쪽">실 소요시간</th>
                                    <th class="py-2.5 px-3 text-right font-bold" title="정규 업무시간 대비 남는(+) / 초과(-) 시간">남는 시간</th>
                                    <th class="py-2.5 px-3 text-right font-bold">필요</th>
                                    <th class="py-2.5 px-3 text-right font-bold">가용</th>
                                    <th class="py-2.5 px-3 text-right font-bold">결과</th>
                                </tr>
                            </thead>
                            <tbody>${trows}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        </section>`;
    }
};

// ───────────────────────────────────────────────────────────
// 업무 예상 — 오늘·내일 자동 요약 예측
// ───────────────────────────────────────────────────────────
/** 대상일의 자동 추정 입력값(DOM 미의존). AI 국내배송 + 7일평균 + 입고일정 중국제작 + 휴무 반영 가용인원. */
const computeAutoInputsForDate = (dateStr, excludeMinutes = 0, { ignoreActual = false } = {}) => {
    const cfg = State.appConfig;
    // 그 날짜에 저장해 둔 제외시간이 있으면 그 값이 우선
    const savedEx = getPlannedExcludeMinutesForDate(dateStr);
    if (savedEx != null) excludeMinutes = savedEx;

    // 가용 인원은 **실제 기록**으로 센다 — 오늘 출근·휴무 입력이 반영돼야 맞다.
    const staffInfo = computeAvailableStaff(dateStr, cfg, State.persistentLeaveSchedule, State.allHistoryData);

    const 물량계산 = (data) => {
        // 우선순위: 예정 물량(수기 입력) > 업무별 자동값
        const tasks = {};
        SIM_TASKS.forEach(t => { tasks[t.key] = autoQtyFor(dateStr, t, data); });
        const timeTasks = {};
        activeTimeTasks().forEach(t => {
            const v = autoTimeValueFor(dateStr, t, data);
            timeTasks[t.key] = { minutes: v.minutes, workers: v.workers };
        });
        return { tasks, timeTasks };
    };

    const { tasks, timeTasks } = ignoreActual
        ? 오늘실적_없이(() => 물량계산(State.allHistoryData))
        : 물량계산(State.allHistoryData);

    return { tasks, timeTasks, staffFulltime: staffInfo.available, staffPart: 0, excludeMinutes, staffInfo };
};

/** 👥 앞으로 N근무일의 인원 수급 전망 — 인력 운영 탭이 쓴다.
 *
 *  인력 운영 탭은 지금까지 '지나간 기간의 평균'만 보여줘서, 정작 필요한
 *  "앞으로 어느 날 사람이 모자라는가"를 알려주지 못했다. 예정 물량은 이미
 *  저장되고 있으니(업무 예상의 작업량 저장·예정 물량 입력), 그대로 먹이면 된다.
 *
 *  계산은 업무 예상과 완전히 같은 경로를 쓴다 — 두 화면이 다른 답을 내지 않도록.
 *  주말·공휴일은 건너뛴다.
 */
export const getStaffingOutlook = (workDays = 10) => {
    // 대시보드처럼 '업무 예상' 탭을 거치지 않고 부르면 업무 목록이 비어 있거나 옛 목록이다.
    // 여기서 맞추지 않으면 화면마다 계획 총시간이 다르게 나온다.
    try { ensureSimLists(); } catch (e) {}

    const taskUPH = computeTaskUPHs(State.allHistoryData);
    const cfg = State.appConfig;
    const out = [];

    let date = getTodayDateString();
    if (isOffDay(date)) date = nextWorkingDay(date);


    for (let i = 0; i < workDays && date; i++) {
        let row;
        try {
            const inputs = computeAutoInputsForDate(date, 0);
            const r = simulateOneDay(date, inputs, taskUPH, cfg);
            const planned = getPlannedQuantitiesForDate(date) || {};
            row = {
                date,
                requiredFTE: r.requiredFTE,
                available: r.availableTotal,
                gap: r.gap,
                totalHours: r.totalHours,
                onLeave: (inputs.staffInfo && inputs.staffInfo.onLeaveList) ? inputs.staffInfo.onLeaveList.length : 0,
                // 수기로 저장해 둔 예정 물량이 있는 날인지 — 없으면 자동 추정값이라 신뢰도가 낮다
                hasPlanned: Object.keys(planned).length > 0
            };
        } catch (e) {
            console.warn('[staffing-outlook] 계산 실패:', date, e);
            row = { date, requiredFTE: 0, available: 0, gap: 0, totalHours: 0, onLeave: 0, hasPlanned: false, failed: true };
        }
        out.push(row);
        date = nextWorkingDay(date);
    }
    return out;
};

// ───────────────────────────────────────────────────────────
// 🔌 업무예상 슬랙 알림용 디버그 훅 — window.__forecastForDate(dateStr?)
//
//  앱\업무예상알림 이 헤드리스 브라우저로 이 함수를 불러 '다음 업무일' 예상치를 읽어 간다.
//  계산을 파이썬으로 옮기면 조용히 어긋나므로, 여기서 결과만 꺼내 준다.
//  window.__peekDay / __runFxBackfill(js/listeners-history.js) 과 같은 디버그 훅 방식이다.
//
//  계산 순서는 위 getStaffingOutlook 과 똑같이 맞춘다 — 화면과 다른 답을 내면 안 된다.
//  다만 세 가지를 더한다:
//    ① 준비 확인   — State 는 ES 모듈이라 브라우저 밖에서 볼 수 없다. 여기서 알려 준다.
//    ② fetchPlannedData() — 탭을 거치지 않고 불리므로 수기 '예정 물량'을 직접 실어야 한다.
//    ③ 예외를 삼키지 않음 — 0 을 채워 넣으면 '필요 0명' 이라는 거짓말이 슬랙으로 나간다.
//
//  ⚠️ 부르지 않으면 아무것도 실행되지 않는다. DOM 을 읽거나 쓰지 않는다.
//     Firestore 쓰기 경로 없음(fetchPlannedData / getForecastSnapshotForDate 는 읽기).
// ───────────────────────────────────────────────────────────
window.__forecastForDate = async (dateStr) => {
    try {
        const n = (v, d = 2) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : 0);

        // ⓪ 대상일 형식 검사 — '2026-9-29'(0 패딩 누락)는 사람 눈에 맞아 보이지만
        //    getPlannedQuantitiesForDate 의 id 비교가 어긋나 예정 물량이 전부 빠진다.
        if (dateStr != null && dateStr !== '') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))
                || Number.isNaN(new Date(String(dateStr) + 'T00:00:00').getTime())) {
                return { ok: false, reason: 'calc-failed', message: '대상일 형식 오류: ' + dateStr };
            }
        }

        // ① 준비 확인.
        //    appState.currentUser 까지 본다 — app.js 의 startAppAfterLogin 이
        //    appConfig → 휴무일정 → (미등록·퇴사 차단) → currentUser 순으로 세팅하므로,
        //    이 값이 있으면 휴무일정이 실렸고 계정 관문도 통과했다는 뜻이다.
        //    appConfig 만 보면 휴무자를 아무도 빼지 않은 '가용 인원'이 나갈 수 있다.
        const configKeys = Object.keys(State.appConfig || {}).length;
        const appUser = (State.appState && State.appState.currentUser) || null;
        if ((State.allHistoryData || []).length === 0 || configKeys === 0 || !appUser) {
            return { ok: false, reason: 'not-ready',
                     historyRows: (State.allHistoryData || []).length, configKeys, appUser };
        }

        // ② 수기 예정 물량 — 빼면 자동 추정값만 나온다(조용히 틀린 숫자).
        //    ⚠️ fetchPlannedData 는 실패해도 throw 하지 않고 빈 값을 돌려준다.
        //       그래서 catch 로는 못 잡는다 — 위 ①의 로그인 확인이 실질적인 방어선이고,
        //       읽어온 뒤 건수를 비교해 한 번 더 본다.
        let plannedLoaded = true;
        try { await fetchPlannedData(); } catch (e) { plannedLoaded = false; }
        if (!(State.plannedData || []).length) plannedLoaded = false;

        // ③ 업무 목록 확정 — 빼면 시간형 업무가 누락돼 총시간이 화면과 달라진다
        let simListsOk = true;
        try { ensureSimLists(); } catch (e) { simListsOk = false; }

        // ④ 대상일 — 인자가 없으면 '다음 업무일', 휴무면 그 이후 첫 업무일.
        //    nextWorkingDay 는 14일까지만 밀어내고 그 뒤엔 휴일 날짜를 그대로 돌려준다.
        //    그걸 걸러내지 않으면 아무도 출근 안 하는 날의 예상치가 발송된다.
        let date = dateStr || nextWorkingDay(getTodayDateString());
        if (date && isOffDay(date)) date = nextWorkingDay(date);
        if (!date || isOffDay(date)) return { ok: false, reason: 'no-working-day' };

        const taskUPH = computeTaskUPHs(State.allHistoryData);
        const inputs = computeAutoInputsForDate(date, 0);
        const r = simulateOneDay(date, inputs, taskUPH, State.appConfig);
        const planned = getPlannedQuantitiesForDate(date) || {};

        // JS 산술은 예외를 던지지 않고 NaN/Infinity 를 낸다. 그걸 0 으로 바꿔 내보내면
        // '필요 0명' 이라는 거짓말이 그대로 발송된다 — 여기서 막는다.
        if (![r.rawRequiredFTE, r.elapsedHours, r.availableTotal, r.dailyHours].every(Number.isFinite)) {
            return { ok: false, reason: 'calc-failed',
                     message: '비정상 수치(NaN/Infinity): required=' + r.rawRequiredFTE
                              + ' elapsed=' + r.elapsedHours + ' avail=' + r.availableTotal };
        }

        const labelOf = (key) => {
            const t = SIM_TASKS.find(x => x.key === key)
                   || activeTimeTasks().find(x => x.key === key);
            return (t && t.label) || key;
        };

        // 물량 0 만 뺀다. UPH 실적이 없어 hours=0 인 업무는 남긴다 —
        // 빼면 물량이 소리 없이 사라져 필요 인원을 낮게 보게 된다(알림이 '시간 미정'으로 찍는다).
        const tasks = Object.entries(r.taskTimes || {})
            .filter(([, v]) => (Number(v && v.qty) || 0) > 0)
            .map(([key, v]) => ({ key, label: labelOf(key),
                                  qty: Math.round(Number(v.qty) || 0),
                                  uph: n(v.uph), hours: n(v.hours) }));
        const timeTasks = Object.entries(r.timeTaskTimes || {})
            .filter(([, v]) => (Number(v && v.hours) || 0) > 0)
            .map(([key, v]) => ({ key, label: labelOf(key),
                                  minutes: Math.round(Number(v.minutes) || 0),
                                  workers: Math.round(Number(v.workers) || 0),
                                  hours: n(v.hours) }));

        const leave = (inputs.staffInfo && inputs.staffInfo.onLeaveList) || [];

        // 🔀 '진행할지 애매한' 빈도형 업무 — 화면(runSimulation)은 0 으로 두되 '진행 시' 결과를
        //    함께 보여준다. 훅이 이걸 빼면 슬랙에는 그 업무가 아예 없는 채로
        //    '딱 맞음' 이 나가고, 다음 날 실제로 진행하면 물량이 그대로 밀린다.
        //    판정 조건·계산은 runSimulation 과 같은 함수를 그대로 쓴다(DOM 검사만 제외).
        const maybeTasks = [];
        SIM_TASKS.forEach(t => {
            if (t.auto !== 'cadence') return;
            if ((inputs.tasks[t.key] || 0) > 0) return;
            if (todayActualQty(State.allHistoryData, date, t.key) != null) return;
            if ((getPlanned(date, t.key) || 0) > 0) return;
            if (!(taskUPH[t.key] > 0)) return;   // 기준 속도가 없으면 '진행 시'도 같은 값이라 혼란만 준다
            const info = cadenceValueFor(State.allHistoryData, t.key, date);
            if (info && info.uncertain && info.dayValue > 0) {
                maybeTasks.push({ key: t.key, label: t.label,
                                  qty: Math.round(Number(info.dayValue) || 0),
                                  prob: n(info.prob) });
            }
        });
        let maybeAlt = null;
        if (maybeTasks.length > 0) {
            const altTasks = { ...inputs.tasks };
            maybeTasks.forEach(m => { altTasks[m.key] = m.qty; });
            const ar = simulateOneDay(date, { ...inputs, tasks: altTasks }, taskUPH, State.appConfig);
            maybeAlt = { rawRequiredFTE: n(ar.rawRequiredFTE), requiredFTE: ar.requiredFTE,
                         elapsedHours: n(ar.elapsedHours, 3), slackHours: n(ar.slackHours, 3) };
        }

        // 예정 물량 중 '실제로 계산에 반영된' 키만 가려낸다.
        // 물량 0(= 안 하기로 정함)이나 업무 목록에서 빠진 옛 업무명을 그대로 찍으면
        // 받는 사람은 그게 반영된 숫자라고 믿는다.
        const qtyKeys = new Set(SIM_TASKS.map(t => t.key));
        const plannedKeys = Object.keys(planned)
            .filter(k => qtyKeys.has(k) && (Number(planned[k]) || 0) > 0);
        const droppedPlannedKeys = Object.keys(planned).filter(k => !qtyKeys.has(k));

        return {
            ok: true, hookVersion: 1,
            date, todayDate: getTodayDateString(), weekend: !!r.weekend,
            // 알림은 requiredFTE(정수)를 쓴다 — 화면 표시값과 같아야 대조 검증이 된다.
            // rawRequiredFTE(소수)는 근거·되돌리기용으로 같이 준다.
            requiredFTE: r.requiredFTE, rawRequiredFTE: n(r.rawRequiredFTE),
            availableTotal: r.availableTotal, gap: r.gap,
            totalHours: n(r.totalHours, 3), qtyHours: n(r.qtyHours, 3), timeHours: n(r.timeHours, 3),
            elapsedHours: n(r.elapsedHours, 3), slackHours: n(r.slackHours, 3),
            dailyHours: r.dailyHours, netDailyHours: n(r.netDailyHours, 3),
            excludeMinutes: r.excludeMinutes,      // simulateOneDay 가 클램프한 값
            staffShortForQty: !!r.staffShortForQty,
            elapsedCappedByTimeTask: !!r.elapsedCappedByTimeTask,
            tasks, timeTasks, maybeTasks, maybeAlt,
            hasPlanned: plannedKeys.length > 0,
            plannedKeys, droppedPlannedKeys,
            // 저장된 원본 그대로 — 알림이 '작업량이 저장됐는지' 를 판정하는 근거다.
            // ⚠️ plannedKeys(값>0 만) 로는 판정할 수 없다. 앱은 keepZeros:true 로 0 도 저장하고
            //    getPlanned 가 0 을 '0으로 하기로 한 값' 으로 인정해 자동 추정값을 이긴다.
            //    즉 '중국제작 0 저장' 은 계산을 크게 바꾸는데 plannedKeys 에는 안 나타난다.
            plannedRaw: planned,
            plannedTimeRaw: getPlannedTimeTasksForDate(date) || {},
            plannedExcludeRaw: getPlannedExcludeMinutesForDate(date),
            onLeave: leave.length,
            onLeaveNames: leave.map(e => (e && e.member) || '').filter(Boolean),
            // 로그인 판정용. appUser 는 미등록·퇴사 관문을 통과한 뒤에만 채워진다
            // (State.auth.currentUser 는 그 관문 '전에' 이미 true 라서 판정에 쓸 수 없다).
            appUser,
            // ⚠️ 스냅샷 본문은 내주지 않는다. buildForecastSnapshot 의 스키마는
            //    tasks 가 배열이 아니라 맵이고 rawRequiredFTE·weekend 가 없어서
            //    메시지.build() 에 그대로 먹이면 '필요 0.0명' 이 나간다.
            //    폴백을 구현할 땐 전용 변환기를 따로 만들 것. (확정한 사람 실명도 들어 있다)
            hasSnapshot: !!getForecastSnapshotForDate(date),
            // historyRows 는 await 뒤에 다시 읽는다 — 그 사이 Firestore 응답으로 갱신될 수 있다
            flags: { plannedLoaded, simListsOk, historyRows: (State.allHistoryData || []).length }
        };
    } catch (e) {
        return { ok: false, reason: 'calc-failed',
                 message: String((e && e.stack) || e).slice(0, 500) };
    }
};

/** 📅 예정 물량 입력 화면 프리필용 — 해당 날짜의 자동 추정 물량(예정 수기값은 제외).
 *  시뮬레이션이 쓰는 것과 완전히 같은 계산(지난 7회 평균 등)을 사용하므로,
 *  예정 물량 화면과 시뮬레이션의 기본값이 항상 일치한다.
 */
export const getAutoQuantitiesForDate = (dateStr) => {
    try { ensureSimTasks(); } catch (e) {}
    const data = State.allHistoryData;
    const out = {};
    SIM_TASKS.forEach(t => {
        // 시뮬레이션과 같은 추정기를 쓴다(예전엔 여기만 지난 7회 평균이라 값이 어긋났다)
        const v = Number(estimatedValueFor(dateStr, t, data).value) || 0;
        if (v > 0) out[t.key] = Math.round(v);
    });
    return out;
};

// 인원 과부족 톤 — 색은 상태 배지와 막대에만 쓴다.
// 카드 테두리까지 물들이면 화면 전체가 색으로 뒤덮여 오히려 읽기 어렵다.
const GAP_TONE = (g) => g > 1
    ? { chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', bar: 'bg-emerald-500' }
    : (g < -1
        ? { chip: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', bar: 'bg-rose-500' }
        : { chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', bar: 'bg-amber-500' });

const forecastCardHtml = (label, r, inputs, simLinked = false) => {
    const gap = r.gap;
    const tone = GAP_TONE(gap);
    const china = inputs.tasks['중국제작'] || 0;
    const staffN = Math.round(inputs.staffInfo ? inputs.staffInfo.available : r.availableTotal);
    // 필요 대비 가용을 막대로 — 숫자만 보는 것보다 한눈에 들어온다.
    const pct = r.requiredFTE > 0 ? Math.min(100, Math.round(staffN / r.requiredFTE * 100)) : 100;

    return `
    <div class="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 md:p-5 shadow-sm">
        <div class="flex items-start justify-between gap-2 mb-4">
            <div class="min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-base font-extrabold text-gray-900 dark:text-white">${label}</span>
                    ${r.weekend ? '<span class="text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-0.5 rounded">주말</span>' : ''}
                    ${simLinked ? '<span class="text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 px-1.5 py-0.5 rounded" title="아래 상세 시뮬레이션에 입력한 값이 그대로 반영된 결과입니다.">시뮬레이션 반영</span>' : ''}
                </div>
                <div class="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">${dayLabel(r.date)}</div>
            </div>
            <span class="text-[11px] font-extrabold px-2.5 py-1 rounded-full shrink-0 ${tone.chip}">${gapText(gap)}</span>
        </div>

        <div class="flex items-end gap-4 mb-3">
            <div>
                <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500 tracking-wide">필요</div>
                <div class="text-3xl font-black leading-none text-gray-900 dark:text-white mt-1">${r.requiredFTE}<span class="text-sm font-bold text-gray-400 ml-0.5">명</span></div>
            </div>
            <div class="text-gray-200 dark:text-gray-700 text-2xl font-light leading-none pb-1">/</div>
            <div>
                <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500 tracking-wide">가용</div>
                <div class="text-3xl font-black leading-none text-gray-900 dark:text-white mt-1">${staffN}<span class="text-sm font-bold text-gray-400 ml-0.5">명</span></div>
            </div>
        </div>

        <div class="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden mb-3">
            <div class="h-full ${tone.bar} rounded-full transition-all" style="width:${pct}%"></div>
        </div>

        <div class="grid grid-cols-3 gap-2 mb-3">
            <div class="rounded-lg bg-gray-50 dark:bg-gray-900/30 border border-gray-100 dark:border-gray-700 px-2 py-1.5">
                <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500">총 소요시간</div>
                <div class="text-[14px] font-extrabold text-gray-800 dark:text-gray-100 mt-0.5 tabular-nums">${fmtHM(r.totalHours)}</div>
            </div>
            <div class="rounded-lg bg-gray-50 dark:bg-gray-900/30 border border-gray-100 dark:border-gray-700 px-2 py-1.5"
                 title="실제로 흘러가는 시간 — 물량 업무는 담당 업무에 묶인 인원(${r.tiedFTE.toFixed(1)}명)을 뺀 ${r.qtyStaff.toFixed(1)}명 기준이고, 담당 업무가 더 오래 걸리면 그 시간을 씁니다">
                <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500">실 소요시간</div>
                <div class="text-[14px] font-extrabold text-indigo-600 dark:text-indigo-300 mt-0.5 tabular-nums">${r.availableTotal > 0 ? fmtHM(r.elapsedHours) : '—'}</div>
            </div>
            <div class="rounded-lg bg-gray-50 dark:bg-gray-900/30 border border-gray-100 dark:border-gray-700 px-2 py-1.5"
                 title="업무시간 ${fmtHM(r.netDailyHours)} 안에서 다 끝내고 남는 시간(초과면 −)">
                <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500">${r.slackHours >= 0 ? '남는 시간' : '초과 시간'}</div>
                <div class="text-[14px] font-extrabold mt-0.5 tabular-nums ${r.availableTotal <= 0 ? 'text-gray-400' : (r.slackHours >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}">${r.availableTotal > 0 ? fmtHM(Math.abs(r.slackHours)) : '—'}</div>
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
            <span>1일 ${r.dailyHours}h${r.excludeMinutes > 0 ? ` − 제외 ${fmtMin(r.excludeMinutes)}` : ''} · 가동률 ${(UTILIZATION*100)|0}%</span>
            ${r.timeHours > 0 ? `<span class="text-gray-300 dark:text-gray-600">·</span><span title="처리량이 없는 담당 업무의 예상 투입시간(실적 평균)">🗂 담당 업무 ${fmtHM(r.timeHours)}</span>` : ''}
            ${china > 0 ? `<span class="w-full"></span><span class="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">🚚 중국제작 입고 ${china.toLocaleString()}개</span>` : ''}
        </div>
    </div>`;
};

/** 🔗 상세 시뮬레이션에서 지금 입력해 둔 값. 대상일이 오늘/내일이면 위 요약 카드도 이 값으로 계산한다.
 *  (상세에서 숫자를 바꿨는데 상단 카드가 자동값 그대로면 두 숫자가 어긋나 보인다) */
let simOverride = null;   // { date, tasks, staffFulltime, staffPart, excludeMinutes }

const captureSimOverride = () => {
    const dateStr = document.getElementById('sim-target-date')?.value;
    if (!dateStr) { simOverride = null; return; }
    const { tasks, timeTasks, staffFulltime, staffPart, excludeMinutes } = readSimInputs();
    simOverride = { date: dateStr, tasks, timeTasks, staffFulltime, staffPart, excludeMinutes };
};

/** 요약 카드 한 장에 쓸 입력값 — 시뮬레이션 대상일과 같은 날이면 그 입력을 그대로 쓴다. */
const inputsForSummaryDate = (dateStr) => {
    const excl = simOverride ? simOverride.excludeMinutes : readExcludeMinutes();
    if (!simOverride || simOverride.date !== dateStr) {
        return { inputs: computeAutoInputsForDate(dateStr, excl || 0), linked: false };
    }
    const staffInfo = computeAvailableStaff(dateStr, State.appConfig, State.persistentLeaveSchedule, State.allHistoryData);
    const total = Math.round(simOverride.staffFulltime + simOverride.staffPart);
    return {
        inputs: {
            tasks: simOverride.tasks,
            timeTasks: simOverride.timeTasks,
            staffFulltime: simOverride.staffFulltime,
            staffPart: simOverride.staffPart,
            excludeMinutes: simOverride.excludeMinutes,
            staffInfo: { ...staffInfo, available: total }
        },
        linked: true
    };
};

/** 오늘·내일 예측 2개 카드 렌더 (상세 시뮬레이션 입력이 있으면 그 값 반영) */
const renderForecastSummary = () => {
    const el = document.getElementById('forecast-summary-cards');
    if (!el) return;
    const taskUPH = computeTaskUPHs(State.allHistoryData);
    const cfg = State.appConfig;
    const today = getTodayDateString();
    // 두 번째 카드는 '다음 근무일' — 내일이 주말·공휴일이면 건너뛴다
    const nextDay = nextWorkingDay(today);
    const nextLabel = nextDay === addDays(today, 1) ? '내일' : '다음 근무일';
    const days = [{ label: '오늘', date: today }, { label: nextLabel, date: nextDay }];
    el.innerHTML = days.map(({ label, date }) => {
        const { inputs, linked } = inputsForSummaryDate(date);
        const r = simulateOneDay(date, inputs, taskUPH, cfg);
        return forecastCardHtml(label, r, inputs, linked);
    }).join('');

    // 대상일이 오늘·내일이 아니면 안내 (카드는 자동값 그대로임을 알 수 있게)
    const note = document.getElementById('forecast-summary-note');
    if (note) {
        const d = simOverride?.date;
        note.textContent = (d && d !== today && d !== addDays(today, 1))
            ? `상세 시뮬레이션 대상일(${d})은 오늘·내일이 아니어서 위 카드에는 반영되지 않습니다.`
            : '';
    }
};

// ───────────────────────────────────────────────────────────
// 💾 작업량 수기 저장 — 예정 물량(plannedData)에 그대로 저장한다.
//    저장한 값은 우선순위 1순위라, '자동값'으로 지우기 전까지 계속 유지된다.
// ───────────────────────────────────────────────────────────
/** 이 날짜에 저장돼 있는(수기) 작업량 목록 */
const savedSimEntries = (dateStr) => {
    const saved = getPlannedQuantitiesForDate(dateStr) || {};
    const qty = SIM_TASKS
        .filter(t => Object.prototype.hasOwnProperty.call(saved, t.key) && Number.isFinite(Number(saved[t.key])))
        .map(t => ({ task: t, value: Math.round(Number(saved[t.key])), kind: 'qty' }));
    const time = activeTimeTasks()
        .map(t => ({ t, v: getPlannedTime(dateStr, t.key) }))
        .filter(x => x.v)
        .map(x => ({ task: x.t, value: x.v.minutes, kind: 'time' }));
    const ex = getPlannedExcludeMinutesForDate(dateStr);
    const extra = (ex != null && ex > 0)
        ? [{ task: { label: '업무 제외시간' }, value: ex, kind: 'time' }]
        : [];
    return [...qty, ...time, ...extra];
};

/** 저장 목록 한 줄 표기 — 시간형은 '분'으로 */
const savedEntryText = (e) => e.kind === 'time'
    ? `${escapeHtml(e.task.label)} ${e.value}분`
    : `${escapeHtml(e.task.label)} ${e.value > 0 ? e.value.toLocaleString() : '0'}`;

const updateSavedInfo = (dateStr) => {
    const el = document.getElementById('sim-saved-info');
    if (!el) return;
    if (!dateStr) { el.textContent = ''; return; }

    // 📌 확정 여부 — 확정한 날만 마감 후 '정확도'에서 비교된다
    const snap = getForecastSnapshotForDate(dateStr);
    // 자동으로 얼린 것과 사람이 맞춰 확정한 것을 구분해 보여준다 —
    // 자동값이 마음에 안 들면 값을 고치고 '다시 확정'을 누르면 된다는 신호가 된다.
    const snapMark = snap
        ? `<span class="${snap.auto ? 'text-gray-500 dark:text-gray-400' : 'text-indigo-600 dark:text-indigo-300'} font-bold" title="${(snap.at || '').slice(0, 16).replace('T', ' ')} ${snap.auto ? '자동 저장' : '확정'} · 마감 후 정확도 화면에서 비교됩니다">${snap.auto ? `🤖 자동 계획 저장됨${snap.autoAt ? ` (${snap.autoAt})` : ''}` : '📌 계획 확정됨'}</span>
           <button type="button" id="sim-snapshot-cancel"
                   class="text-[11px] font-bold text-gray-400 dark:text-gray-500 underline underline-offset-2 hover:text-rose-500 transition"
                   title="이 날짜의 얼려 둔 계획을 지웁니다. 작업량 저장값과 계산에는 영향이 없고, 정확도 비교에서만 빠집니다.">${snap.auto ? '지우기' : '확정 취소'}</button>
           <span class="text-gray-300 dark:text-gray-600">|</span> `
        : '';
    // 이미 확정한 날은 버튼 문구를 바꿔, 새로 찍는 게 아니라 덮어쓰는 것임을 알린다
    const snapBtn = document.getElementById('sim-snapshot-btn');
    if (snapBtn) snapBtn.textContent = snap ? '📌 다시 확정' : '📌 계획 확정';

    const entries = savedSimEntries(dateStr);
    if (entries.length === 0) {
        el.innerHTML = snapMark + `<span class="text-gray-400 dark:text-gray-500">저장된 수기 값 없음 — 자동값으로 계산 중</span>`;
        return;
    }
    const list = entries.map(savedEntryText).join(', ');
    el.innerHTML = snapMark + `<span class="text-amber-700 dark:text-amber-400 font-bold">💾 저장됨 ${entries.length}개</span>
        <span class="text-gray-400 dark:text-gray-500">— ${list} · '자동값'을 누르기 전까지 유지되며, 오늘 실측이 잡히면 실측이 우선합니다.</span>`;
};

const saveSimQuantities = async () => {
    const dateStr = document.getElementById('sim-target-date')?.value;
    if (!dateStr) { alert('대상일을 선택해주세요.'); return; }
    if (dateStr < getTodayDateString()) {
        showToast('지난 날짜의 작업량은 저장할 수 없습니다. (예정 물량은 오늘 이후만 보관합니다)', true);
        return;
    }
    const { tasks, timeTasks } = readSimInputs();
    // 이 화면에 없는 업무(예: 해외배송)의 예정 물량은 건드리지 않는다
    const merged = { ...(getPlannedQuantitiesForDate(dateStr) || {}) };
    // 0과 빈칸(=0)도 '그렇게 하기로 한 값'으로 그대로 저장한다.
    // 실측으로 채워진 값도 그대로 저장한다 — 실측이 예정 물량보다 우선이라,
    // 나중에 실적이 더 쌓이면 그 값이 자동으로 앞선다(저장값에 갇히지 않는다).
    SIM_TASKS.forEach(t => {
        // 🔑 사람이 손댄 칸만 저장한다 (shouldSaveQty).
        //   예전에는 화면의 모든 칸을 저장했다. 그래서 한 칸 고치고 누르면 자동값까지
        //   28개가 '예정물량'(우선순위 2위)으로 굳어, 🔄 자동값을 누르기 전까지 자동 추정
        //   (AI 예측·빈도 분석·입고일정 연동)을 영구히 이겼다 — 정확도를 올리려고 만든
        //   추정기들이 그 날엔 작동하지 않았다(실측: 저장이 있는 15일에 거의 전 업무가 저장됨).
        //
        //   hasInput — 입력칸이 없어 읽지 못한 업무는 건드리지 않는다. 0 으로 써 버리면
        //   예정 물량 화면에 넣어 둔 값이 조용히 사라지고, 그 0 이 자동값을 이겨 굳는다.
        //
        //   '사람이 일부러 넣은 0' 과 '자동 추정이 넣은 0' 의 구분은 simDirtyQty 가 담당한다.
        //   예전의 별도 0 처리 규칙은 이 한 줄에 그대로 포괄된다.
        const hasInput = Object.prototype.hasOwnProperty.call(tasks, t.key);
        if (!shouldSaveQty({ hasInput, dirty: simDirtyQty.has(t.key) })) return;
        merged[t.key] = Math.max(0, Math.round(Number(tasks[t.key]) || 0));
    });

    const btn = document.getElementById('sim-save-btn');
    if (btn) { btn.disabled = true; btn.classList.add('opacity-60'); }
    // 시간형 업무도 0(=안 함)까지 그대로 저장한다
    const mergedTime = { ...(getPlannedTimeTasksForDate(dateStr) || {}) };
    const zeroKeysForSave = simZeroTasks();
    const 알림 = [];   // 화면과 저장이 달라진 것 — 조용히 넘기면 사용자가 영문을 모른다
    activeTimeTasks().forEach(t => {
        const e = timeTasks[t.key];
        // 수량형과 같은 규칙 — 손댄 칸만.
        // 분이 0 이면 '그날 안 함' 으로 정리한다(normalizeTimeEntry — 순수·테스트됨)
        const { minutes: mm, workers: ww, changed } = normalizeTimeEntry(e || {});
        const dirty = simDirtyTime.has(t.key);
        if (!shouldSaveTime({
            hasInput: !!e, dirty,
            zeroDefault: zeroKeysForSave.has(t.key), minutes: mm, workers: ww
        })) {
            // '기본 0명' 업무(청소·앵글정리)를 0 으로 되돌린 경우다.
            // ⚠️ 거르기만 하면 **이미 저장해 둔 값이 그대로 남는다** — 사용자는 0명으로
            //    되돌렸는데 다음 진입에서 옛 값이 되살아나고, 탈출구가 '🔄 자동값'(그 날
            //    저장값 전체 삭제)뿐이게 된다. 거름과 되돌림은 다른 동작이다.
            if (dirty && Object.prototype.hasOwnProperty.call(mergedTime, t.key)) {
                delete mergedTime[t.key];
                알림.push(`${t.label}: 저장해 둔 값을 지우고 기본값(0명)으로 되돌렸습니다`);
            }
            return;
        }
        if (changed) 알림.push(`${t.label}: 분이 0 이라 '오늘 안 함'(0명)으로 저장했습니다`);
        mergedTime[t.key] = { minutes: mm, workers: ww };
    });
    // 수량형으로 옮겨간 업무가 시간형 잔재로 남으면 나중에 되살아나 시간이 두 번 더해진다
    SIM_TASKS.forEach(t => delete mergedTime[t.key]);

    const excl = readExcludeMinutes();
    // 바뀐 것이 없으면 서버에 쓰지 않는다. '실패' 가 아니라 '저장할 것이 없음' 이다.
    // ⚠️ dirty 집합의 크기가 아니라 **결과를 비교**한다. 고친 칸이 전부 걸러진 경우
    //    (기본 0명 업무를 원래대로 되돌린 것뿐인 경우)에 '저장되었습니다' 가 뜨면서
    //    변화 없는 문서를 서버에 쓰던 문제가 있었다.
    const 같나 = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const 바뀐것없음 =
        같나(merged, getPlannedQuantitiesForDate(dateStr) || {})
        && 같나(mergedTime, getPlannedTimeTasksForDate(dateStr) || {})
        && excl === (getPlannedExcludeMinutesForDate(dateStr) ?? 0);
    if (바뀐것없음) {
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-60'); }
        showToast(알림.length > 0
            ? 알림.join(' / ')
            : '고친 칸이 없습니다 — 저장할 내용이 없습니다.');
        simDirtyQty = new Set();
        simDirtyTime = new Set();
        return;
    }
    const ok = await savePlannedQuantities(dateStr, merged,
        { keepZeros: true, timeTasks: mergedTime, excludeMinutes: excl > 0 ? excl : -1 });
    if (btn) { btn.disabled = false; btn.classList.remove('opacity-60'); }
    if (!ok) return;

    // 화면과 저장이 달라진 것은 반드시 알린다 — 조용히 넘기면 '저장되었습니다' 만 보고
    // 사용자는 자기가 넣은 인원이 왜 사라졌는지 모른다.
    // 토스트는 하나로 합친다 — 여러 개를 띄우면 성공 토스트와 같은 색으로 겹쳐 쌓여
    // 맨 위의 안내가 '실패' 로 읽힌다.
    if (알림.length > 0) showToast(알림.join(' / '));

    simDirtyQty = new Set();          // 저장 완료 — 다시 자동값 기준으로 본다
    simDirtyTime = new Set();
    autoFillSimInputs(dateStr);       // 배지를 '예정물량'으로 갱신
    updateSavedInfo(dateStr);
    simOverride = null;   // 자동값으로 다시 채웠으므로 카드도 자동값 기준
    renderForecastSummary();
};

/** '자동값' — 저장해 둔 수기 값이 있으면 지울지 먼저 묻고, 지운 뒤 자동값으로 되돌린다. */
const handleAutoFillClick = async () => {
    const dateStr = document.getElementById('sim-target-date')?.value;
    if (!dateStr) return;
    simDirtyQty = new Set();          // 자동값으로 되돌리므로 '손댄 칸'도 없어진다
    simDirtyTime = new Set();
    const entries = savedSimEntries(dateStr);
    if (entries.length > 0) {
        const list = entries.map(e => ` · ${savedEntryText(e)}`).join('\n');
        const msg = `${dateStr}에 저장된 수기 작업량 ${entries.length}개를 삭제하고 자동값으로 되돌립니다.

${list}

삭제한 값은 되돌릴 수 없습니다. 계속할까요?`;
        if (!confirm(msg)) return;
        const rest = { ...(getPlannedQuantitiesForDate(dateStr) || {}) };
        SIM_TASKS.forEach(t => delete rest[t.key]);
        const restTime = { ...(getPlannedTimeTasksForDate(dateStr) || {}) };
        SIM_TIME_TASKS.forEach(t => delete restTime[t.key]);
        // 수량형으로 옮겨간 업무의 시간형 잔재는 지운다(남겨 두면 나중에 되살아나 이중 계산된다)
        SIM_TASKS.forEach(t => delete restTime[t.key]);
        const ok = await savePlannedQuantities(dateStr, rest, { keepZeros: true, timeTasks: restTime, excludeMinutes: -1 });
        if (!ok) return;
    }
    // 자동값으로 되돌리는 것이므로 펼침 상태도 기본(접힘)으로 돌린다
    autoFillSimInputs(dateStr, { resetFoldView: true });
    updateSavedInfo(dateStr);
    simOverride = null;   // 자동값으로 다시 채웠으므로 카드도 자동값 기준
    renderForecastSummary();
};

/** '업무 예상' 탭 진입 시 호출: 시뮬레이션 리스너 결합 + 오늘/내일 요약 + 상세 자동값 채움 */
export const renderForecastTab = () => {
    ensureSimLists(true);        // 등록된 업무 + 최근 실적으로 업무 목록을 확정한다(수량형 → 시간형 순)
    renderSimTaskInputs();
    setupSimulationListeners();

    const dateEl = document.getElementById('sim-target-date');
    if (dateEl && !dateEl.value) dateEl.value = getTodayDateString();
    autoFillSimInputs(dateEl?.value);
    updateSavedInfo(dateEl?.value);
    simOverride = null;   // 자동값으로 다시 채웠으므로 카드도 자동값 기준
    renderForecastSummary();
    runSimulation({ silent: true });      // 오른쪽 결과칸을 자동값 기준으로 미리 채워 둔다
    // 진행 중인 업무가 있으면 '오늘 현황'으로, 아니면 '계획'으로 연다
    setForecastView(pickInitialForecastView());

    // 예정 물량이 아직 안 실렸으면 로드 후 다시 채움(캐시라 대부분 즉시)
    fetchPlannedData().then(() => {
        const d = document.getElementById('sim-target-date')?.value;
        // ⚠️ 그 사이 사용자가 고친 칸은 덮지 않는다. 캐시가 만료된 상태면 이 then 이
        //    수백 ms 뒤에 도착하는데, 그때 화면을 통째로 덮으면 방금 타이핑한 값이
        //    자동값으로 되돌아간다. 그렇다고 통째로 건너뛰면 저장해 둔 예정물량이
        //    그 세션 내내 화면에 안 들어와서, 📌 계획 확정이 그 값이 빠진 계획을 얼린다.
        //    → 고친 칸만 지키고 나머지는 채운다.
        autoFillSimInputs(d, { preserveDirty: true });
        updateSavedInfo(d);
        simOverride = null;   // 자동값으로 다시 채웠으므로 카드도 자동값 기준
        renderForecastSummary();
        runSimulation({ silent: true });
        if (forecastView === 'today') renderTodayProgress();   // 예정 물량이 실리면 기준선이 달라진다
    }).catch(() => {});

    const rBtn = document.getElementById('forecast-refresh-btn');
    if (rBtn && !rBtn.dataset.bound) {
        rBtn.dataset.bound = 'true';
        rBtn.addEventListener('click', () => {
            const d = document.getElementById('sim-target-date')?.value;
            autoFillSimInputs(d);
            updateSavedInfo(d);
            simOverride = null;   // 자동값으로 다시 채웠으므로 카드도 자동값 기준
            renderForecastSummary();
            runSimulation({ silent: true });
        });
    }
};

const setupSimulationListeners = () => {
    const runBtn = document.getElementById('sim-run-btn');
    if (!runBtn) return; // panel not in DOM yet
    if (runBtn.dataset.simSetup === 'true') return; // already wired
    runBtn.dataset.simSetup = 'true';

    const dateEl = document.getElementById('sim-target-date');
    if (dateEl) {
        if (!dateEl.value) {
            // 기본값: 오늘 (요약 카드에서 오늘·내일을 함께 보여주므로 상세는 오늘 기준)
            dateEl.value = getTodayDateString();
        }
        dateEl.addEventListener('change', () => {
            simDirtyQty = new Set();      // 날짜가 바뀌면 '손댄 칸' 기록도 새로 시작한다
            simDirtyTime = new Set();
            autoFillSimInputs(dateEl.value, { resetFoldView: true });
            updateSavedInfo(dateEl.value);
            simOverride = null;   // 자동값으로 다시 채웠으므로 카드도 자동값 기준
            renderForecastSummary();
            runSimulation({ silent: true });
        });
    }
    document.getElementById('sim-autofill-btn')?.addEventListener('click', handleAutoFillClick);
    document.getElementById('sim-save-btn')?.addEventListener('click', saveSimQuantities);
    runBtn.addEventListener('click', () => runSimulation());

    // 값을 바꾸면 상단 요약 카드도 같은 값으로 다시 계산한다(입력이 잦으므로 살짝 미뤄서).
    let syncTimer = null;
    const syncSummary = () => {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => {
            captureSimOverride();
            renderForecastSummary();
            if (forecastView === 'today') renderTodayProgress();   // 계획을 고치면 현황 기준선도 같이 움직인다
        }, 200);
    };
    ['sim-task-list', 'sim-staff-fulltime', 'sim-staff-parttimer', 'sim-exclude-min'].forEach(id => {
        const el = document.getElementById(id);
        el?.addEventListener('input', syncSummary);
        el?.addEventListener('change', syncSummary);
    });
    ['sim-staff-fulltime', 'sim-staff-parttimer'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', paintStaffTotal);
    });

    // 업무 제외시간은 10분 단위로 스냅하고, 옆에 '1시간 20분'처럼 풀어서 보여준다.
    const exclEl = document.getElementById('sim-exclude-min');
    exclEl?.addEventListener('input', paintExcludeHint);
    exclEl?.addEventListener('change', () => {
        const m = readExcludeMinutes();
        if (exclEl.value !== '') exclEl.value = m > 0 ? m : '';
        paintExcludeHint();
    });
    paintExcludeHint();

    // 📌 계획 확정 — 지금 값을 그 날짜의 '확정 계획'으로 얼려 둔다
    document.getElementById('sim-snapshot-btn')?.addEventListener('click', async () => {
        const dateStr = document.getElementById('sim-target-date')?.value;
        if (!dateStr) { alert('대상일을 선택해주세요.'); return; }
        if (dateStr < getTodayDateString()) {
            showToast('지난 날짜는 확정할 수 없습니다. 지금 값으로 얼려도 그날의 예상치가 아니기 때문입니다.', true);
            return;
        }
        const already = getForecastSnapshotForDate(dateStr);
        if (already && !confirm(`${dateStr} 계획은 이미 확정되어 있습니다.\n지금 값으로 다시 확정할까요?`)) return;

        const btn = document.getElementById('sim-snapshot-btn');
        if (btn) { btn.disabled = true; btn.textContent = '확정 중…'; }
        try {
            await saveForecastSnapshot(dateStr, buildForecastSnapshot(dateStr));
            accuracySnapshots = null;              // 다음에 정확도 화면을 열 때 다시 읽는다
            updateSavedInfo(dateStr);
        } finally {
            // 문구는 updateSavedInfo 가 확정 여부를 보고 정한다('📌 다시 확정').
            // 여기서 고정값으로 되돌리면 방금 확정한 표시가 지워진다.
            if (btn) btn.disabled = false;
            updateSavedInfo(dateStr);
        }
    });

    // 📌 확정 취소 (계획 화면 — 오늘·앞으로의 날짜)
    document.getElementById('sim-saved-info')?.addEventListener('click', async (e) => {
        if (!e.target?.closest?.('#sim-snapshot-cancel')) return;
        const dateStr = document.getElementById('sim-target-date')?.value;
        if (!dateStr) return;
        if (!confirm(`${dateStr} 계획 확정을 취소할까요?\n\n작업량 저장값과 계산은 그대로이고, 정확도 비교에서만 빠집니다.`)) return;
        await deleteForecastSnapshot(dateStr);
        accuracySnapshots = null;
        updateSavedInfo(dateStr);
    });

    // 정확도 화면 조작 (기간 변경 · 다시 읽기)
    document.getElementById('forecast-accuracy-body')?.addEventListener('change', (e) => {
        if (e.target?.id !== 'accuracy-days') return;
        accuracyDays = Number(e.target.value) || 14;
        renderAccuracyBody();
    });
    document.getElementById('forecast-accuracy-body')?.addEventListener('click', async (e) => {
        if (e.target?.closest?.('#accuracy-reload')) {
            accuracySnapshots = null;
            renderAccuracyView();
            return;
        }
        // 잘못 확정한 지난 날짜를 통계에서 뺀다 (그 날짜를 볼 수 있는 곳이 여기뿐이다)
        const drop = e.target?.closest?.('.accuracy-drop');
        if (drop && drop.dataset.date) {
            const d = drop.dataset.date;
            if (!confirm(`${d}의 확정 계획을 지울까요?\n\n그날은 정확도 비교에서 빠집니다. 업무 기록과 실적은 그대로입니다.`)) return;
            if (await deleteForecastSnapshot(d)) {
                if (accuracySnapshots) delete accuracySnapshots[d];
                renderAccuracyBody();
            }
        }
    });

    // 값 없는 업무 펼치기·접기
    document.getElementById('sim-empty-wrap')?.addEventListener('click', (e) => {
        if (!e.target?.closest?.('#sim-empty-toggle')) return;
        showEmptySimRows = !showEmptySimRows;
        applyEmptyRowFolding();
    });

    // 화면 전환 (오늘 현황 / 계획 / 정확도)
    document.getElementById('forecast-view-switch')?.addEventListener('click', (e) => {
        const b = e.target?.closest?.('.forecast-view-btn');
        if (b && b.dataset.fview) setForecastView(b.dataset.fview);
    });

    // '하는 날 N' 을 누르면 그 값을 작업량 칸에 넣는다.
    // input 이벤트를 직접 일으켜, 상단 요약·연동 업무도 함께 다시 계산되게 한다.
    document.getElementById('sim-task-list')?.addEventListener('click', (e) => {
        const btn = e.target?.closest?.('.pred-day-apply');
        if (!btn || !btn.dataset.value) return;
        const id = btn.dataset.taskId;
        const el = document.getElementById(`sim-qty-${id}`);
        if (!el) return;
        el.value = btn.dataset.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const t = SIM_TASKS.find(x => x.id === id);
        if (t) paintDayApply(t, Number(btn.dataset.value));   // 같은 값이 되었으니 버튼은 사라진다
        el.focus();
    });

    // 중국제작 수량을 직접 고치면 샘플검수도 그 비율로 다시 계산한다.
    // 단, 예정 물량에 샘플검수를 수기로 넣어둔 날은 그 값을 덮지 않는다.
    // 입력칸은 JS가 다시 만들 수 있으므로 목록 컨테이너에 위임해서 듣는다.
    document.getElementById('sim-task-list')?.addEventListener('input', (e) => {
        if (!e.target.matches('#sim-qty-china')) return;
        const dateStr = document.getElementById('sim-target-date')?.value;
        if (!dateStr) return;
        const china = Number(e.target.value) || 0;
        const data = State.allHistoryData;
        const untouched = (key) => todayActualQty(data, dateStr, key) == null && getPlanned(dateStr, key) == null;

        if (untouched('샘플검수')) {
            const sampleTask = SIM_TASKS.find(t => t.id === 'sample');
            const 새값 = china > 0 ? Math.round(computeSampleRatio(data) * china) : 0;
            setQty('sample', 새값);
            if (sampleTask) {
                markSourceBadge(sampleTask, 'china-linked');
                덮어쓴meta(sampleTask.key, 새값, 'china-linked');
            }
        }
        // 상.하차처럼 입고 박스에 연동된 업무도 같이 다시 계산한다
        // (선적이 밀려 입고를 0 으로 고쳤는데 상.하차만 그대로 남으면 인원이 과대 산출된다)
        SIM_TASKS.forEach(t => {
            const { mode, arg } = parseAutoMode(t.auto);
            if (mode !== 'incoming-boxes') return;
            if ((arg || '중국제작') !== '중국제작') return;   // 이 입력칸은 중국제작이다
            if (!untouched(t.key)) return;
            const v = incomingBoxesValueFor(dateStr, t, data, arg, china);
            setQty(t.id, v.value);
            markSourceBadge(t, v.source, v.detail);
            덮어쓴meta(t.key, v.value, v.source);
        });
        applyEmptyRowFolding();
    });

    // 물량을 직접 고치면, 그 물량에 묶인 담당 업무(중국제작(담당)·직진배송 사전작업 등)도 다시 잡는다.
    // 물량이 0이 되면 그 담당 업무도 0이 된다.
    document.getElementById('sim-task-list')?.addEventListener('input', (e) => {
        const m = /^sim-qty-(.+)$/.exec(e.target?.id || '');
        if (!m) return;
        const changed = SIM_TASKS.find(t => t.id === m[1]);
        if (changed) simDirtyQty.add(changed.key);
        const dateStr = document.getElementById('sim-target-date')?.value;
        if (!changed || !dateStr) return;

        const lookup = (key) => {
            const t2 = SIM_TASKS.find(x => x.key === key);
            const el = t2 ? document.getElementById(`sim-qty-${t2.id}`) : null;
            return el ? (Number(el.value) || 0) : 0;
        };
        SIM_TIME_TASKS.forEach(t => {
            if (!timeTaskDeps(t.key).includes(changed.key)) return;
            // '전날 준비' 업무는 그날 물량이 아니라 다음 근무일 물량을 보므로, 이 입력과 무관하다
            if (isNextDayDep(t.key)) return;
            if (getPlannedTime(dateStr, t.key)) return;      // 저장해 둔 값은 건드리지 않는다
            const v = autoTimeValueFor(dateStr, t, State.allHistoryData, lookup);
            setTimeInputs(t, v);
            timeTaskUnit.set(t.key, Math.max(0, Math.round(Number(v.unitMinutes ?? v.minutes) || 0)));
            markTimeSourceBadge(t, v.source, v.detail);
            덮어쓴meta('t:' + t.key, Number(v.minutes) || 0, v.source);
        });
    });

    // ⏳ 담당 업무 — 인원을 바꾸면 '1인 시간 × 인원'으로 총 투입시간을 다시 넣는다.
    //    (각자 자기 몫을 따로 하는 업무라, 사람이 늘면 그 사람 시간이 통째로 더해진다)
    //    시간을 직접 고치면 그 값을 인원으로 나눈 값이 새 1인 기준이 된다.
    document.getElementById('sim-task-list')?.addEventListener('input', (e) => {
        const id = e.target?.id || '';
        const mW = /^sim-workers-(.+)$/.exec(id);
        if (mW) {
            const t = SIM_TIME_TASKS.find(x => x.id === mW[1]);
            if (!t) return;
            const workers = Math.max(0, Math.round(Number(e.target.value) || 0));
            const unit = timeTaskUnit.get(t.key);
            // 1인 기준을 모르거나(null) 0 이면 분 칸이 0 으로 남는다. 그 상태로 '손댐' 을 찍으면
            // {분 0, 인원 N} 이 되어 저장에서 막히고, 사용자에게는 아무 일도 안 일어난 것처럼
            // 보인다(기준 시간이 없는 신규 업무에서 정상 조작만으로 재현된다).
            if (!(unit > 0)) {
                // title 은 마우스를 올려야 보인다 — 글씨로도 알린다.
                const badge0 = document.getElementById(`sim-src-t-${t.id}`);
                if (badge0) {
                    // 폴딩이 이 자리에 '펼친 사유' 를 쓰므로, 경고가 덮이지 않게 표시해 둔다.
                    // (경고는 사유보다 우선한다 — 사용자가 방금 한 조작에 대한 답이다)
                    badge0.dataset.warn = '1';
                    badge0.textContent = '분 직접 입력';
                    badge0.title = '이 업무는 최근 4주 기록이 없어 1인 기준 시간을 모릅니다.'
                        + ' 인원만 올려서는 시간이 잡히지 않습니다 — 분을 직접 넣으면 그 값이 기준이 됩니다.';
                }
                return;
            }
            simDirtyTime.add(t.key);
            const total = unit * workers;
            const mEl = document.getElementById(`sim-time-${t.id}`);
            if (mEl) mEl.value = total > 0 ? total : '';
            const badge = document.getElementById(`sim-src-t-${t.id}`);
            if (badge) badge.title = workers > 0
                ? `1인 ${unit}분 × ${workers}명 = 총 ${total}분으로 잡았습니다.`
                : '인원 0명 — 그날은 하지 않는 업무로 봅니다. 인원을 올리면 시간이 다시 잡힙니다.';
            return;
        }
        const mT = /^sim-time-(.+)$/.exec(id);
        if (mT) {
            const t = SIM_TIME_TASKS.find(x => x.id === mT[1]);
            if (!t) return;
            simDirtyTime.add(t.key);
            const wEl = document.getElementById(`sim-workers-${t.id}`);
            let workers = Math.max(0, Math.round(Number(wEl?.value) || 0));
            const typed = Math.max(0, Number(e.target.value) || 0);
            // 0명인데 시간을 넣으면 1명으로 올려 준다(0명이면 계산에서 빠지므로)
            if (workers === 0 && typed > 0) { workers = 1; if (wEl) wEl.value = 1; }
            // ⚠️ 여기서 인원을 0 으로 내리지 않는다. 그렇게 했더니 인원 2 였던 업무가
            //    분을 지웠다 다시 넣을 때 1 로 되살아나 1인 기준이 2배가 됐다(120분 → 240분).
            //    '분 0' 의 정규화는 **저장 시점**에 한다 — 화면의 인원은 사용자 것이다.
            setTimeUnit(t, typed, workers);        // 직접 고친 값이 새 기준
        }
    });

    document.getElementById('sim-reset-btn')?.addEventListener('click', () => {
        // 모든 수량/인원 입력 초기화 (업무 목록은 항상 기본 등록이므로 숨기지 않음)
        // ※ 저장해 둔 수기 값은 지우지 않는다(그건 '자동값' 버튼의 역할).
        // ⚠️ '손댐' 기록도 비운다. 남겨 두면 리셋으로 비워진 칸이 '사람이 0 으로 정한 값' 이
        //    되어, 그 뒤 저장을 누를 때 0 으로 굳는다(저장이 손댄 칸만 쓰게 된 뒤로는
        //    이 집합이 유일한 판단축이라 오염되면 그대로 사고가 된다).
        simDirtyQty = new Set();
        simDirtyTime = new Set();
        // 접기 판정 재료도 버린다. 안 버리면 비워진 화면을 초기화 **전** 값으로 판정해,
        // 접힘 버튼 title 이 화면에 없는 숫자를 보여 준다.
        simRowMeta.clear();
        SIM_TASKS.forEach(t => setQty(t.id, ''));
        SIM_TIME_TASKS.forEach(t => setTimeInputs(t, { minutes: 0, workers: 0 }));
        ['sim-staff-fulltime','sim-staff-parttimer','sim-exclude-min'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        showResultPlaceholder();
        paintStaffTotal();
        // 초기화는 '직접 넣겠다' 는 뜻이다. 접기 기준으로는 빈 칸이 전부 접혀서
        // 입력칸이 화면에서 사라지므로(구획까지 숨는다), 펼친 상태로 둔다.
        showEmptySimRows = true;
        applyEmptyRowFolding();
        simOverride = null;              // 요약 카드는 자동값 기준으로 되돌린다
        renderForecastSummary();
    });

    // 초기 자동 채우기
    autoFillSimInputs(dateEl?.value);
    updateSavedInfo(dateEl?.value);
};

// ═══════════════════════════════════════════════════════════
// ⏱ 오늘 진행 현황 — 지금까지 쓴 시간(인시)을 계획과 맞춰 본다.
//    물량은 업무를 끝낼 때만 들어오므로 여기서는 다루지 않는다(정확도 화면에서 비교).
// ═══════════════════════════════════════════════════════════

/** 오늘의 업무 기록. 실시간 동기화되는 appState 를 먼저 쓰고, 없으면 이력에서 찾는다. */
const todayWorkRecords = () => {
    const live = State.appState?.workRecords;
    if (Array.isArray(live) && live.length > 0) return live;
    const today = getTodayDateString();
    const day = (State.allHistoryData || []).find(d => d.id === today);
    return (day && day.workRecords) || [];
};

/** 기준 종료에 점심 1시간을 더해야 하는가.
 *
 *  ★ 기준은 '평일인가' 가 아니라 **'점심 자동정지가 실제로 돌았는가'** 다.
 *    소진 인시(spentMinutesOf)는 lunch pause 가 찍힌 만큼만 점심을 빼기 때문이다.
 *    pause 가 안 찍힌 날에 기준에만 +60 을 하면 두 효과가 같은 방향으로 겹쳐
 *    (소진 부풀음 + 기준 늦어짐) 실제로는 늦고 있는데 계속 초록으로 보인다.
 *
 *  · 주말: autoPauseForLunch 가 아예 호출되지 않는다(app-lifecycle.js 는 평일만) → 더하지 않는다.
 *  · 평일 점심 전·중: 아직 돌 차례가 안 됐으니 돌 것으로 보고 더한다(오전 판정이 흔들리지 않게).
 *  · 평일 점심 후: lunch pause 나 실행 플래그가 있어야 더한다.
 *    12:30~13:29 에 아무도 앱을 열지 않은 날은 pause 가 안 남는다 — 그때는 더하지 않는다.
 */
const 점심반영할까 = (records, nowMin, weekend) => {
    if (weekend) return false;
    if (nowMin < LUNCH_END_MIN) return true;
    const 점심정지있음 = (records || []).some(r =>
        Array.isArray(r?.pauses) && r.pauses.some(p => p && p.type === 'lunch'));
    return 점심정지있음 || !!State.appState?.lunchPauseExecuted;
};

/** 오늘 계획 — 계획 화면에 넣어 둔 값이 오늘 것이면 그 값을, 아니면 자동값을 쓴다. */
const buildTodayPlan = () => {
    const today = getTodayDateString();
    const { inputs, linked } = inputsForSummaryDate(today);
    const r = simulateOneDay(today, inputs, computeTaskUPHs(State.allHistoryData), State.appConfig);
    return { today, inputs, linked, r };
};

/** 계획 줄 — 시뮬레이션이 아는 업무는 계획이 0이어도 넣는다.
 *  '계획 외'는 시뮬레이션이 아예 모르는 업무(예: 창고정리)만을 뜻해야 한다.
 *  오늘 물량이 0으로 잡힌 채우기까지 '계획 외'가 되면 읽는 사람이 오해한다.
 *  (계획 0 · 실적 0 인 줄은 buildProgressRows 가 걸러 낸다) */
const planRowsOf = (r) => {
    const rows = [];
    SIM_TASKS.forEach(t => {
        const e = r.taskTimes[t.key];
        // 물량은 잡혔는데 기준 속도(UPH)가 없어 계획 시간이 0인 업무 — 진행률 분모에서 빠지므로 표시해 준다
        const noBaseline = !!(e && e.qty > 0 && !(e.hours > 0));
        rows.push({ key: t.key, label: t.label, planHours: e ? e.hours : 0, kind: 'qty', noBaseline });
    });
    activeTimeTasks().forEach(t => {
        const e = r.timeTaskTimes[t.key];
        rows.push({ key: t.key, label: t.label, planHours: e ? e.hours : 0, kind: 'time' });
    });
    return rows;
};

/** 오늘 현황 한 덩어리 계산 — 화면과 대시보드 띠가 같은 값을 쓰도록 한 곳에 모은다. */
const computeTodayStatus = () => {
    // 대시보드 띠처럼 '업무 예상' 탭을 거치지 않고 부르는 경로에서는 시간형 업무 목록이 비어 있다.
    // 비워 두면 담당 업무 시간이 계획에서 통째로 빠져 띠와 상세 화면의 숫자가 어긋난다.
    try { ensureSimLists(); } catch (e) {}

    const { today, r, linked } = buildTodayPlan();
    const nowStr = nowTimeString();
    const nowMin = hhmmToMin(nowStr) ?? 0;

    const 기록들 = todayWorkRecords();
    const progress = computeDayProgress(기록들, nowStr);
    const rows = buildProgressRows(planRowsOf(r), progress);

    // 계획이 0 인 업무(오늘은 안 하는 것으로 본 빈도형 업무 등)를 실제로 하고 있으면,
    // 그 시간을 계획 쪽에도 더해 준다 — 분자에만 쌓이면 진행률이 100%를 훌쩍 넘고 종료 예상도 빨라진다.
    const unplannedHours = rows.reduce((a, row) =>
        a + ((row.planHours > 0) ? 0 : Math.max(0, Number(row.spentHours) || 0)), 0);
    const planHours = r.totalHours + unplannedHours;
    const spentHours = progress.totalSpentMin / 60;
    const pct = planHours > 0 ? Math.round(spentHours / planHours * 100) : 0;

    const fin = projectFinish({
        planHours, spentHours,
        activeWorkers: progress.activeWorkers,
        fallbackWorkers: r.availableTotal,
        nowMin, firstStartMin: progress.firstStartMin,
        dailyHours: r.dailyHours, excludeMinutes: r.excludeMinutes,
        skipLunch: 점심반영할까(기록들, nowMin, r.weekend)
    });

    return { today, r, linked, nowStr, nowMin, progress, rows, planHours, spentHours, pct, fin };
};

/** 대시보드 띠가 쓰는 요약 (계산 결과가 없으면 null) */
export const getTodayProgressSummary = () => {
    try {
        const s = computeTodayStatus();
        if (!s.progress.hasRecords && s.planHours <= 0) return null;
        return {
            planHours: s.planHours, spentHours: s.spentHours, pct: s.pct,
            activeWorkers: s.progress.activeWorkers,
            started: s.progress.hasRecords,
            finishText: s.fin.finishMin == null ? null : minToHhmm(s.fin.finishMin),
            baseFinishText: minToHhmm(s.fin.baseFinishMin),
            baseLunchMin: s.fin.baseLunchMin,
            baseLunchText: s.fin.baseLunchText,
            diffMin: s.fin.diffMin
        };
    } catch (e) { console.warn('[forecast] 오늘 진행 요약 실패:', e); return null; }
};

/** 늦음/이름 상태에 따른 색 한 벌 */
const paceTone = (diffMin) => {
    if (diffMin == null) return { text: 'text-gray-500 dark:text-gray-400', bar: 'bg-gray-400', chip: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' };
    if (diffMin <= 0)   return { text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' };
    if (diffMin <= 30)  return { text: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500', chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' };
    return { text: 'text-rose-600 dark:text-rose-400', bar: 'bg-rose-500', chip: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' };
};

const STATUS_CHIP = {
    working: { cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
    paused:  { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    ended:   { cls: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400' },
    todo:    { cls: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300' }
};

const statusLabel = (row) => {
    if (row.extra) return row.working > 0 ? `계획 외 · ${row.working}명` : '계획 외';
    if (row.noBaseline) {
        if (row.working > 0) return `기준 없음 · ${row.working}명 진행 중`;
        if (row.paused > 0) return `기준 없음 · ${row.paused}명 정지`;
        if (row.done > 0) return '기준 없음 · 종료';
        return '기준 없음 · 미착수';
    }
    if (row.status === 'working') return `${row.working}명 진행 중`;
    if (row.status === 'paused')  return `${row.paused}명 정지`;
    if (row.status === 'ended')   return '종료';
    return '미착수';
};

const progressRowHtml = (row) => {
    // 계획 시간이 없는 줄(기준 없음)을 100%로 그리면 다 끝난 것처럼 보인다
    const pct = row.planHours > 0
        ? Math.min(100, Math.round(row.spentHours / row.planHours * 100))
        : (row.noBaseline ? 0 : (row.spentHours > 0 ? 100 : 0));
    const over = row.planHours > 0 && row.spentHours > row.planHours;
    const chip = STATUS_CHIP[row.status] || STATUS_CHIP.ended;
    const barColor = row.extra ? 'bg-violet-400'
                   : over ? 'bg-rose-500'
                   : row.status === 'working' ? 'bg-indigo-500'
                   : row.status === 'ended' ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600';
    const planText = row.planHours > 0 ? fmtHM(row.planHours) : '—';
    const memberTip = row.members.length ? `\n지금: ${row.members.join(', ')}` : '';
    return `
        <div class="flex items-center gap-3 px-3 py-2 border-b border-gray-100 dark:border-gray-700/60 last:border-b-0"
             title="계획 ${planText} · 소진 ${fmtHM(row.spentHours)}${escapeHtml(memberTip)}">
            <span class="w-28 md:w-32 shrink-0 truncate text-sm font-bold text-gray-700 dark:text-gray-200">${escapeHtml(row.label)}</span>
            <div class="flex-1 min-w-0 h-2.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                <div class="h-full rounded-full ${barColor} transition-all" style="width:${pct}%"></div>
            </div>
            <span class="w-[112px] shrink-0 text-right text-[12px] font-bold tabular-nums ${over ? 'text-rose-600 dark:text-rose-400' : 'text-gray-600 dark:text-gray-300'}">
                ${fmtHM(row.spentHours)} <span class="font-medium text-gray-400 dark:text-gray-500">/ ${planText}</span>
            </span>
            <span class="w-[92px] shrink-0 text-center text-[11px] font-bold rounded-md py-0.5 ${row.extra ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : chip.cls}">${statusLabel(row)}</span>
        </div>`;
};

const bigStat = (label, value, sub, tone = '') => `
    <div class="flex-1 min-w-[150px] px-4 py-3">
        <div class="text-[11px] font-bold text-gray-500 dark:text-gray-400">${label}</div>
        <div class="mt-0.5 text-[26px] leading-tight font-extrabold tabular-nums ${tone || 'text-gray-900 dark:text-white'}">${value}</div>
        <div class="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">${sub}</div>
    </div>`;

const renderTodayProgress = () => {
    const host = document.getElementById('today-progress-body');
    if (!host) return;

    let s;
    try { s = computeTodayStatus(); }
    catch (e) {
        console.error('[forecast] 오늘 현황 계산 실패:', e);
        host.innerHTML = `<div class="rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center text-gray-400 text-[12px]">현황을 계산하지 못했습니다.</div>`;
        return;
    }

    if (!s.progress.hasRecords) {
        host.innerHTML = `
            <section class="rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 bg-white/60 dark:bg-gray-800/30 p-10 text-center">
                <div class="text-3xl mb-2">☕</div>
                <p class="text-sm font-bold text-gray-600 dark:text-gray-300">아직 시작된 업무가 없습니다</p>
                <p class="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                    오늘 계획은 <b class="text-gray-600 dark:text-gray-300">${fmtHM(s.planHours)}</b> ·
                    필요 인원 <b class="text-gray-600 dark:text-gray-300">${s.r.requiredFTE}명</b> 입니다.
                    업무가 시작되면 여기에서 진행 상황을 볼 수 있습니다.
                </p>
            </section>`;
        return;
    }

    const tone = paceTone(s.fin.diffMin);
    const elapsedMin = s.progress.firstStartMin != null ? Math.max(0, s.nowMin - s.progress.firstStartMin) : 0;
    const barPct = Math.min(100, Math.max(0, s.pct));

    const diffText = s.fin.diffMin == null ? '—'
        : s.fin.diffMin === 0 ? '정시'
        : s.fin.diffMin > 0 ? `정시 +${fmtMin(s.fin.diffMin)}` : `정시 −${fmtMin(-s.fin.diffMin)}`;

    const finishText = s.fin.finishMin == null ? '—' : minToHhmm(s.fin.finishMin);

    host.innerHTML = `
      <div class="space-y-4">

        <!-- 큰 숫자 세 개 -->
        <section class="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
            <div class="flex flex-wrap divide-x divide-gray-100 dark:divide-gray-700">
                ${bigStat('경과', fmtMin(elapsedMin),
                          s.progress.firstStartMin != null
                            ? `${minToHhmm(s.progress.firstStartMin)} 첫 업무 시작 · 지금 ${s.nowStr}`
                            : `지금 ${s.nowStr}`)}
                ${bigStat('계획 대비 소진', `${s.pct}%`,
                          `${fmtHM(s.spentHours)} / ${fmtHM(s.planHours)} 인시`)}
                ${bigStat('종료 예상', finishText,
                          s.fin.rate > 0
                            ? `기준 ${minToHhmm(s.fin.baseFinishMin)} · ${s.fin.usedFallback ? '가용' : '현재'} ${s.fin.rate}명 기준`
                            : '투입 인원이 없어 계산할 수 없습니다',
                          tone.text)}
                <div class="flex-1 min-w-[150px] px-4 py-3">
                    <div class="text-[11px] font-bold text-gray-500 dark:text-gray-400">지금 투입</div>
                    <div class="mt-0.5 text-[26px] leading-tight font-extrabold tabular-nums text-gray-900 dark:text-white">${s.progress.activeWorkers}<span class="text-sm font-bold text-gray-400 ml-0.5">명</span></div>
                    <div class="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">남은 계획 ${fmtHM(s.fin.remainHours)}</div>
                </div>
            </div>
            <div class="px-4 pb-3">
                <div class="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                    <div class="h-full rounded-full ${tone.bar} transition-all" style="width:${barPct}%"></div>
                </div>
                <div class="mt-1.5 flex items-center justify-between text-[11px]">
                    <span class="text-gray-400 dark:text-gray-500">
                        ${s.linked ? '계획 화면에 넣은 값 기준' : '자동값 기준'} ·
                        시간(인시)만 비교합니다 — 물량은 마감 후 <b class="font-bold">정확도</b>에서
                    </span>
                    <span class="font-extrabold ${tone.text}">${diffText}</span>
                </div>
            </div>
        </section>

        <!-- 업무별 -->
        <section class="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
            <header class="flex items-baseline gap-2 px-3.5 py-2.5 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
                <h4 class="text-[12px] font-extrabold text-gray-700 dark:text-gray-200">업무별 진행</h4>
                <span class="text-[11px] text-gray-400 dark:text-gray-500">소진 시간 / 계획 시간 · 진행 중인 것부터</span>
                <span class="ml-auto text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">${s.rows.length}개</span>
            </header>
            ${s.rows.length ? s.rows.map(progressRowHtml).join('')
                            : '<p class="px-3.5 py-6 text-center text-[11px] text-gray-400">표시할 업무가 없습니다.</p>'}
        </section>

        <p class="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed px-1">
            · <b>소진 시간</b>은 업무 기록의 실제 투입 시간입니다(쉰 시간 제외, 진행 중인 업무는 지금까지).<br>
            · <b>종료 예상</b>은 남은 계획 시간을 지금 붙어 있는 인원으로 나눈 값입니다.
              기준 시각은 첫 업무 시작 + ${s.r.dailyHours}시간${s.r.excludeMinutes > 0 ? ` + 제외 ${fmtMin(s.r.excludeMinutes)}` : ''}${s.fin.baseLunchMin > 0 ? ` + 점심 ${fmtMin(s.fin.baseLunchMin)}(${s.fin.baseLunchText})` : ''} 입니다.${s.fin.baseLunchMin > 0 ? '' : (s.r.weekend ? ' 주말은 점심 자동정지가 없어 점심을 더하지 않습니다.' : (s.fin.skipLunch ? '' : ' 오늘은 점심 자동정지 기록이 없어 점심을 더하지 않았습니다.'))}<br>
            · <b class="text-violet-500">계획 외</b>는 계획에 없었는데 실제로 진행한 업무입니다.<br>
            · <b>기준 없음</b>은 물량은 잡혔지만 처리 속도 기준이 아직 없어 계획 시간을 못 낸 업무입니다(진행률 계산에서 빠집니다).
        </p>
      </div>`;
};

// ───────────────────────────────────────────────────────────
// 🤖 자동 계획 스냅샷
//
//  왜 필요한가
//    정확도는 '📌 계획 확정'을 누른 날만 비교된다. 그런데 계획이 어긋나는 날은 아침부터
//    바쁜 날이고, 바쁜 날에는 아무도 버튼을 누르지 않는다. 그래서 남은 표본이 '잘 맞은 날'로
//    치우친다 — 실측: 2026-09-18~27 열흘이 통째로 비어 있었다.
//    표본을 늘리는 게 아니라 **고르게** 만드는 것이 목적이다.
//
//  왜 readSimInputs 를 쓰지 않는가
//    그 함수는 계획 화면의 입력칸(DOM)을 읽는다. 게다가 '입력칸이 없는 업무는 건너뛴다' 라서,
//    DOM 이 없으면 에러도 없이 빈 계획(총 0시간)이 저장된다. 대상일이 내일로 바뀌어 있으면
//    내일 값이 오늘 스냅샷으로 얼려지기까지 한다. → computeAutoInputsForDate(DOM 미의존)를 쓴다.
//
//  왜 ignoreActual 인가
//    자동값은 '오늘 실측'을 1순위로 쓴다(autoValueFor). 그대로 찍으면 계획 = 실적이 되어
//    정확도가 늘 100%로 나온다. 측정을 고치려는 작업이 측정을 망치는 셈이라 반드시 끈다.
// ───────────────────────────────────────────────────────────
const AUTO_SNAPSHOT_CUTOFF_MIN = 13 * 60;   // 13:00 — 이보다 늦은 첫 접속이면 찍지 않는다
// 하한도 필요하다. 공용 PC 대시보드를 켠 채 퇴근하면 60초 타이머가 자정을 넘기며 돌아,
// 그날 휴무자도 예정물량도 전혀 반영되지 않은 값이 '아침 예상치'로 굳어 버린다.
const AUTO_SNAPSHOT_EARLIEST_MIN = 6 * 60;  // 06:00
// 입고일정 캐시는 '오늘 갱신분'만 인정한다(isIncomingCacheFreshToday).
// 어제 캐시로 얼리면 오늘 아침 시트에서 빠진 선적이 그대로 계획에 들어간다.
let autoSnapInFlight = false;
let autoSnapDoneDate = null;
let autoSnapForcedFetchDate = null;   // 예정물량 강제 갱신은 하루 1회
let autoSnapNextTryAt = 0;            // 재시도 쿨다운(실패한 날 60초마다 서버를 때리지 않게)
const AUTO_SNAPSHOT_RETRY_MS = 10 * 60 * 1000;
let 입고경고_날짜 = null;

const 자동스냅_키 = (d) => `forecastAutoSnap:${d}`;
const 자동스냅_했나 = (d) => {
    if (autoSnapDoneDate === d) return true;
    try { return localStorage.getItem(자동스냅_키(d)) === '1'; } catch (_) { return false; }
};
const 자동스냅_표시 = (d) => {
    autoSnapDoneDate = d;
    try {
        // 어제까지의 표시는 지운다 — 하루에 하나씩 영원히 쌓이지 않게
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith('forecastAutoSnap:') && k !== 자동스냅_키(d)) localStorage.removeItem(k);
        }
        localStorage.setItem(자동스냅_키(d), '1');
    } catch (_) {}
};

/** 자동 스냅샷용 계획값 — DOM 을 보지 않고, 오늘 실측도 계획으로 쓰지 않는다. */
const buildAutoForecastSnapshot = (dateStr) => {
    const inputs = computeAutoInputsForDate(dateStr, 0, { ignoreActual: true });

    // 쓰레기 스냅샷 방지 — 계획이 통째로 비었으면 찍지 않는다(되돌릴 수 없다)
    const qty합 = Object.values(inputs.tasks || {}).reduce((a, v) => a + (Number(v) || 0), 0);
    const time합 = Object.values(inputs.timeTasks || {})
        .reduce((a, v) => a + (Number(v?.minutes) || 0), 0);
    if (qty합 <= 0 && time합 <= 0) return null;

    const taskUPH = computeTaskUPHs(State.allHistoryData);
    const r = simulateOneDay(dateStr, inputs, taskUPH, State.appConfig);
    if (!(r.totalHours > 0)) return null;

    // 그날 기준 UPH도 함께 얼린다 — 수동 확정(buildForecastSnapshot)과 같은 스키마여야
    // 정확도 화면이 두 종류를 구분 없이 읽을 수 있다.
    const uph = {};
    SIM_TASKS.forEach(t => { if (taskUPH[t.key] > 0) uph[t.key] = Number(taskUPH[t.key].toFixed(2)); });

    return {
        tasks: inputs.tasks, timeTasks: inputs.timeTasks, uph,
        staffFulltime: inputs.staffFulltime, staffPart: inputs.staffPart,
        excludeMinutes: inputs.excludeMinutes,
        availableTotal: r.availableTotal, requiredFTE: r.requiredFTE,
        totalHours: Number(r.totalHours.toFixed(3)),
        qtyHours: Number(r.qtyHours.toFixed(3)),
        timeHours: Number(r.timeHours.toFixed(3)),
        elapsedHours: Number(r.elapsedHours.toFixed(3)),
        dailyHours: r.dailyHours,
        auto: true,
        autoAt: nowTimeString()
    };
};

/** 오늘 계획 스냅샷이 없으면 조용히 하나 찍는다.
 *  절대 throw 하지 않고, 토스트도 띄우지 않는다(메인 화면 렌더 중에 돈다).
 *  가드 하나라도 걸리면 **찍지 않는다** — 잘못 얼린 스냅샷은 그날이 지나면 되돌릴 수 없다. */
const ensureTodayForecastSnapshot = async () => {
    if (autoSnapInFlight) return;
    const today = getTodayDateString();
    if (자동스냅_했나(today)) return;
    if (Date.now() < autoSnapNextTryAt) return;      // 방금 제대로 시도해 실패했다 — 10분 뒤에 다시

    autoSnapInFlight = true;
    try {
        // ① 로그인 — appState.currentUser 는 설정·휴무일정까지 준비됐다는 신호다
        if (!State.auth?.currentUser || !State.appState?.currentUser) return;
        // ② 계산 재료 — 없으면 가용인원 0 · UPH 0 이 얼려진다
        if (!(State.allHistoryData || []).length) return;
        if (!Object.keys(State.appConfig || {}).length) return;
        // ③ 주말·공휴일은 비교 대상이 아니다
        if (isOffDay(today)) { 자동스냅_표시(today); return; }
        // ④ 시각 — 너무 늦으면 '아침의 예상치'가 아니고, 너무 이르면(자정 등) 아무것도 안 차 있다
        const 지금분 = hhmmToMin(nowTimeString());
        if (지금분 >= AUTO_SNAPSHOT_CUTOFF_MIN) { 자동스냅_표시(today); return; }
        if (지금분 < AUTO_SNAPSHOT_EARLIEST_MIN) return;      // 재시도 — 아침에 다시 걸린다
        // ⑤ 입고일정 캐시 — 중국제작·샘플검수·상.하차 하차분이 전부 여기서 나온다.
        //    비었거나 오래된 캐시로 찍으면 입고 300박스가 예정된 날이 0 으로 얼려지고
        //    되돌릴 수 없다. 표시하지 않고 return 해서 캐시가 채워진 뒤 다시 시도한다.
        if (!isIncomingCacheFreshToday()) {
            // 시트 열 이름이 바뀌면 캐시가 영원히 갱신되지 않아, 이 기능이 아무 흔적 없이 멈춘다.
            // 하루 한 번은 콘솔에 남겨 둔다.
            if (입고경고_날짜 !== today) {
                입고경고_날짜 = today;
                console.warn('[자동 계획] 입고일정 캐시가 오늘 갱신되지 않아 계획을 얼리지 않았습니다.'
                    + ' 대시보드 입고일정이 정상인지 확인하세요.');
            }
            return;
        }
        // ⑥ 업무 목록 — 빼면 시간형 업무가 통째로 빠진 스냅샷이 남는다
        ensureSimLists();
        // ⑦ 예정 물량 — 그날 **처음 한 번은 서버에서 강제로** 다시 읽는다.
        //    10분 TTL 캐시를 그대로 쓰면, 다른 PC 가 아침에 넣은 예정 물량을 못 보고
        //    자동 추정값으로 얼려 버린다. 단 강제 갱신을 매번 하면, 스냅샷이 안 찍히는 날
        //    (계획이 통째로 0 인 날 등) 60초마다 서버를 때린다 — 그래서 하루 1회로 묶는다.
        //    길이 0 은 정상이다(아무도 예정물량을 안 넣은 날) — 실패로 보면 정작
        //    자동 스냅샷이 가장 필요한 날에 기능이 안 켜진다.
        // 여기서부터가 비용이 드는 구간이다. 이 지점을 넘었다면 '제대로 시도했다'로 보고
        // 실패해도 10분은 쉰다 — 위의 준비 가드(①~⑤)에 걸려 되돌아가는 것은 쿨다운 대상이 아니다
        // (초기 로딩 중에는 0·1.5·4초 렌더가 연달아 걸리는데, 그걸 10분씩 미루면 안 된다).
        autoSnapNextTryAt = Date.now() + AUTO_SNAPSHOT_RETRY_MS;
        const 강제 = autoSnapForcedFetchDate !== today;
        autoSnapForcedFetchDate = today;
        await fetchPlannedData(강제);
        // ⑧ 수동 확정 보존 (서버 재확인은 저장 함수가 한 번 더 한다)
        if (getForecastSnapshotForDate(today)) { 자동스냅_표시(today); return; }

        const snapshot = buildAutoForecastSnapshot(today);
        if (!snapshot) return;

        const res = await saveForecastSnapshotIfAbsent(today, snapshot);
        // already-exists = 다른 사람·탭이 먼저 찍었다. 성공과 똑같이 '끝난 일'이다.
        if (res?.ok || res?.reason === 'already-exists') {
            자동스냅_표시(today);
            accuracySnapshots = null;      // 정확도 화면을 열 때 다시 읽는다
        }
    } catch (e) {
        console.warn('ensureTodayForecastSnapshot 건너뜀:', e);
    } finally {
        autoSnapInFlight = false;
    }
};

export { ensureTodayForecastSnapshot };

// ── 화면 전환 (오늘 현황 / 계획 / 정확도) ────────────────────────
const FORECAST_VIEWS = {
    today:    { sub: '지금까지 쓴 시간을 계획과 맞춰 봅니다' },
    plan:     { sub: '작업량 대비 필요·가용 인원을 예측합니다' },
    accuracy: { sub: '마감 후 계획과 실제가 얼마나 달랐는지 봅니다' }
};
let forecastView = 'plan';
let todayTimer = null;

const paintViewButtons = () => {
    document.querySelectorAll('.forecast-view-btn').forEach(b => {
        const on = b.dataset.fview === forecastView;
        b.className = `forecast-view-btn px-3 py-1.5 transition ${b.dataset.fview !== 'today' ? 'border-l border-gray-300 dark:border-gray-600 ' : ''}`
            + (on ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700');
    });
    const sub = document.getElementById('forecast-view-sub');
    if (sub) sub.textContent = FORECAST_VIEWS[forecastView]?.sub || '';
};

const setForecastView = (v) => {
    if (!FORECAST_VIEWS[v]) v = 'plan';
    forecastView = v;
    ['today', 'plan', 'accuracy'].forEach(k => {
        document.getElementById(`forecast-view-${k}`)?.classList.toggle('hidden', k !== v);
    });
    paintViewButtons();

    // 다른 화면에 있는 동안 업무 목록이 바뀌었으면 입력칸부터 다시 그린다
    if (v === 'plan' && simInputsStale) {
        simInputsStale = false;
        renderSimTaskInputs();
        autoFillSimInputs(document.getElementById('sim-target-date')?.value);
        simOverride = null;
        renderForecastSummary();
        runSimulation({ silent: true });
    }

    clearInterval(todayTimer); todayTimer = null;
    if (v === 'today') {
        // 아직 오늘 계획이 얼려져 있지 않으면 조용히 하나 찍는다(렌더를 막지 않는다)
        void ensureTodayForecastSnapshot();
        renderTodayProgress();
        // 진행 중인 업무는 시간이 계속 흐르므로 1분마다 다시 그린다
        todayTimer = setInterval(() => {
            if (forecastView !== 'today' || !document.getElementById('today-progress-body')) {
                clearInterval(todayTimer); todayTimer = null; return;
            }
            renderTodayProgress();
        }, 60000);
    } else if (v === 'accuracy') {
        renderAccuracyView();
    }
};

/** 탭을 열 때 어느 화면을 보여줄지 — 진행 중인 업무가 있으면 '오늘 현황' */
const pickInitialForecastView = () => {
    const live = todayWorkRecords();
    const busy = live.some(r => r && (r.status === 'ongoing' || r.status === 'paused'));
    return busy ? 'today' : 'plan';
};

// 정확도 화면 — 아래 '정확도' 절에서 실제 구현으로 바뀐다.
let renderAccuracyView = () => {};

// ═══════════════════════════════════════════════════════════
// 🎯 정확도 — 아침에 확정한 계획과 실제가 얼마나 달랐는지.
//    계획은 자동값이 매일 바뀌므로 '확정 스냅샷'이 있는 날만 비교한다.
// ═══════════════════════════════════════════════════════════

/** 지금 계획 화면의 값 그대로를 스냅샷으로 만든다(확정 버튼용) */
const buildForecastSnapshot = (dateStr) => {
    const { tasks, timeTasks, staffFulltime, staffPart, excludeMinutes } = readSimInputs();
    const taskUPH = computeTaskUPHs(State.allHistoryData);
    const staffInfo = computeAvailableStaff(dateStr, State.appConfig, State.persistentLeaveSchedule, State.allHistoryData);
    const inputs = {
        tasks, timeTasks, staffFulltime, staffPart, excludeMinutes,
        staffInfo: { ...staffInfo, available: Math.round(staffFulltime + staffPart) }
    };
    const r = simulateOneDay(dateStr, inputs, taskUPH, State.appConfig);

    // 그날 기준 UPH도 함께 얼린다 — 나중에 UPH가 바뀌면 시간 비교를 재현할 수 없다
    const uph = {};
    SIM_TASKS.forEach(t => { if (taskUPH[t.key] > 0) uph[t.key] = Number(taskUPH[t.key].toFixed(2)); });

    return {
        tasks, timeTasks, uph,
        staffFulltime, staffPart, excludeMinutes,
        availableTotal: r.availableTotal, requiredFTE: r.requiredFTE,
        totalHours: Number(r.totalHours.toFixed(3)),
        qtyHours: Number(r.qtyHours.toFixed(3)),
        timeHours: Number(r.timeHours.toFixed(3)),
        elapsedHours: Number(r.elapsedHours.toFixed(3)),
        dailyHours: r.dailyHours,
        // ⚠️ 반드시 명시한다. 저장이 merge 라, 자동으로 먼저 찍힌 날에 사람이 '다시 확정' 해도
        //    예전 auto:true·autoAt 이 그대로 남아 정확도 화면이 🤖 자동으로 거짓 표시했다
        //    (에뮬레이터에서 실제로 재현했다 — 수동 확정인데 auto:true 였다).
        auto: false,
        autoAt: null
    };
};

let accuracyDays = 14;          // 되돌아볼 근무일 수
let accuracySnapshots = null;   // { 날짜: 스냅샷 }
let accuracyLoading = false;

/** 마감된 날(어제까지) 중 근무 기록이 있는 최근 N일 */
const recentClosedDays = (n) => {
    const today = getTodayDateString();
    return (State.allHistoryData || [])
        .filter(d => d && typeof d.id === 'string' && d.id < today)
        .filter(d => (d.workRecords || []).length > 0)
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, n)
        .sort((a, b) => a.id.localeCompare(b.id));
};

/** 하루치 계획 대비 실제.
 *  시간 쪽 수식은 forecast-accuracy.js(순수·테스트됨)에 있다 — 여기서는 화면에 필요한
 *  물량 비교·인원·스냅샷 정보만 덧붙인다. 기존 필드(planHours·hourErr…)는 그대로 유지한다. */
const accuracyRowOf = (day, snap) => {
    const spentMin = (day.workRecords || []).reduce((sum, r) => {
        const d = Number(r?.duration);
        return sum + (Number.isFinite(d) && d > 0 ? d : 0);
    }, 0);
    const members = new Set((day.workRecords || []).map(r => r?.member).filter(Boolean));

    const t = decomposeAccuracy(snap, day);

    const qty = {};
    Object.entries(snap.tasks || {}).forEach(([k, v]) => {
        qty[k] = { plan: Math.round(Number(v) || 0), actual: Math.round(Number(day.taskQuantities?.[k]) || 0) };
    });
    // 계획엔 없었는데 실제로 물량이 잡힌 업무도 담는다
    Object.entries(day.taskQuantities || {}).forEach(([k, v]) => {
        if (qty[k]) return;
        if (!SIM_TASKS.some(t => t.key === k)) return;      // 시뮬레이션이 다루는 업무만
        qty[k] = { plan: 0, actual: Math.round(Number(v) || 0) };
    });

    return {
        ...t,
        date: day.id,
        planFTE: Number(snap.requiredFTE) || 0,
        actualMembers: members.size,
        qty, snapAt: snap.at || null, snapAutoAt: snap.autoAt || null, spentMin
    };
};

const pctText = (v) => v == null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
const errTone = (v) => {
    if (v == null) return 'text-gray-400';
    const a = Math.abs(v);
    if (a <= 0.1) return 'text-emerald-600 dark:text-emerald-400';
    if (a <= 0.25) return 'text-amber-600 dark:text-amber-400';
    return 'text-rose-600 dark:text-rose-400';
};

const renderAccuracyBody = () => {
    const host = document.getElementById('forecast-accuracy-body');
    if (!host) return;
    // 이 화면만 따로 열면 업무 목록이 옛 상태라, 확정 스냅샷에 있던 업무가 통째로 빠진다
    try { ensureSimLists(); } catch (e) {}

    const head = (note) => `
        <div class="flex flex-wrap items-center gap-2 mb-3">
            <h4 class="text-sm font-extrabold text-gray-800 dark:text-gray-100">정확도</h4>
            <span class="text-[11px] text-gray-400 dark:text-gray-500">${note}</span>
            <div class="ml-auto flex items-center gap-1.5">
                <label class="text-[11px] font-bold text-gray-500 dark:text-gray-400">기간</label>
                <select id="accuracy-days" class="text-xs px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white font-medium">
                    <option value="7"${accuracyDays === 7 ? ' selected' : ''}>최근 7근무일</option>
                    <option value="14"${accuracyDays === 14 ? ' selected' : ''}>최근 14근무일</option>
                    <option value="30"${accuracyDays === 30 ? ' selected' : ''}>최근 30근무일</option>
                </select>
                <button id="accuracy-reload" class="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition">🔄</button>
            </div>
        </div>`;

    if (accuracyLoading) {
        host.innerHTML = head('불러오는 중…')
            + `<div class="rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center text-gray-400 text-[12px]">확정해 둔 계획을 불러오는 중입니다…</div>`;
        return;
    }

    const days = recentClosedDays(accuracyDays);
    const snaps = accuracySnapshots || {};
    const rows = days.map(d => (snaps[d.id] ? accuracyRowOf(d, snaps[d.id]) : null)).filter(Boolean);

    if (rows.length === 0) {
        host.innerHTML = head('아직 비교할 자료가 없습니다')
            + `<section class="rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 bg-white/60 dark:bg-gray-800/30 p-10 text-center">
                <div class="text-3xl mb-2">🎯</div>
                <p class="text-sm font-bold text-gray-600 dark:text-gray-300">확정해 둔 계획이 없습니다</p>
                <p class="mt-1.5 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500 max-w-md mx-auto">
                    자동값은 실적이 쌓이면서 매일 바뀝니다. 나중에 다시 계산해도 <b>그날 아침의 예상치</b>는 되살릴 수 없어,
                    오차를 재려면 그 시점의 값을 얼려 두어야 합니다.<br><br>
                    평일에는 그날 앱을 처음 열 때 자동으로 얼려 두므로, 내일부터는 이 화면이 채워집니다.
                    더 정확히 맞추고 싶으면 <b class="text-gray-600 dark:text-gray-300">계획</b> 화면에서 값을 고친 뒤
                    <b class="text-indigo-500">📌 계획 확정</b>을 누르세요.
                </p>
            </section>`;
        return;
    }

    // ── 요약 ──────────────────────────────────────────────
    const sum = summarizeAccuracyRows(rows);

    // ── 업무별 누적 ────────────────────────────────────────
    // 물량만 보던 표에 **시간**을 넣는다.
    //   · 시간형 업무(개인담당업무·중국제작(담당) 등)는 물량이 없어 예전에는 이 표에서
    //     통째로 빠졌다 — 합계 오차에는 들어가는데 어느 업무 때문인지 볼 수가 없었다.
    //   · 수량은 맞혔는데 시간이 더 걸린 경우도 여기서만 보인다.
    // 집계·오차 계산은 forecast-accuracy.js 의 순수 함수에 있다(테스트됨) —
    // 이 자리에서 분자·분모의 날짜 집합이 어긋나는 버그가 두 번 났기 때문이다.
    const stdUPH = computeTaskUPHs(State.allHistoryData);
    const taskRows = aggregateByTask(rows).map(t => ({
        ...t,
        label: SIM_TASKS.find(x => x.key === t.key)?.label
            || SIM_TIME_TASKS.find(x => x.key === t.key)?.label || t.key,
        nowUPH: stdUPH[t.key] || 0      // '지금' 기준 UPH 는 참고용으로만 보여 준다
    }));

    // 칩은 '물량' 을 말하므로 물량 기준으로 따로 고른다 — 표 정렬은 시간 기준이라
    // 첫 행을 집으면 가장 어긋난 업무가 아니다.
    const worst = taskRows
        .filter(t => t.err != null && Math.abs(t.err) > 0.2)
        .sort((a, b) => Math.abs(b.err) - Math.abs(a.err))[0];

    // 기준 UPH 가 없던 날은 계획 시간을 낼 수 없어 계산에서 뺐다 — 그 사실을 칸마다 알린다.
    // (시간 오차에만 붙이면, 값이 작아지는 '계획 시간'·'실제 시간' 칸에 설명이 없다)
    const 별표 = (t) => {
        const 쪽지 = [];
        if (t.noBaseDays > 0) {
            쪽지.push(`기준 속도가 없던 ${t.noBaseDays}일은 물량·시간 양쪽에서 빼고 계산했습니다`
                + (t.noBaseActualHours > 0 ? ` (그 날들의 실제 ${fmtHM(t.noBaseActualHours)} 제외)` : ''));
        }
        if (!t.unplanned && (t.offPlanHours > 0 || t.offPlanQty > 0)) {
            쪽지.push(`계획에 없던 날의 실적은 뺐습니다 (${fmtHM(t.offPlanHours)}`
                + (t.offPlanQty > 0 ? ` · ${t.offPlanQty.toLocaleString()}개` : '') + ' — 계획 외 유입으로 집계)');
        }
        return 쪽지.length === 0 ? ''
            : `<span class="text-[10px] font-normal text-gray-400" title="${escapeHtml(쪽지.join('\n'))}">*</span>`;
    };

    const stat = (label, value, sub, cls) => `
        <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/30 p-3">
            <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500 tracking-wide">${label}</div>
            <div class="text-2xl font-black mt-1 ${cls || 'text-gray-900 dark:text-white'}">${value}</div>
            <div class="text-[10px] text-gray-400 dark:text-gray-500 mt-1">${sub}</div>
        </div>`;

    host.innerHTML = head(`확정한 계획이 있는 ${rows.length}일을 비교했습니다`) + `
      <div class="space-y-4">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            ${stat('비교한 날', `${rows.length}<span class="text-sm font-bold text-gray-400 ml-0.5">일</span>`,
                   `최근 ${accuracyDays}근무일 중${sum.autoDays > 0 ? ` · 자동 ${sum.autoDays}일` : ''}`)}
            ${stat('계획 적중', sum.avgAbsPlanHitErr == null ? '—' : `${Math.round(sum.avgAbsPlanHitErr * 100)}%`,
                   sum.avgPlanHitErr == null ? '계획한 업무만의 시간 오차'
                     : `치우침 ${pctText(sum.avgPlanHitErr)}${sum.avgPlanHitErr === 0 ? ''
                         : ` · ${sum.avgPlanHitErr > 0 ? '계획보다 오래 걸림' : '계획보다 덜 함'}`}`,
                   errTone(sum.avgAbsPlanHitErr))}
            ${stat('계획 외 유입', sum.avgUnplannedShare == null ? '—' : `${Math.round(sum.avgUnplannedShare * 100)}%`,
                   '실제 시간 중 계획에 없던 업무', sum.avgUnplannedShare == null ? '' : errTone(sum.avgUnplannedShare))}
            ${stat('미착수', sum.missedTaskTotal === 0 ? '없음'
                     : `${sum.missedTaskTotal}<span class="text-sm font-bold text-gray-400 ml-0.5">건</span>`,
                   (sum.missedTaskTotal === 0 ? '계획한 업무를 모두 진행'
                     : `${sum.missedDays}일에 걸쳐 · 계획 ${fmtHM(sum.missedHoursTotal)} 분량`)
                     + (sum.noBaselineDays > 0 ? ` · 판정 불가 ${sum.noBaselineDays}일` : ''),
                   sum.missedTaskTotal === 0
                     ? (sum.noBaselineDays > 0 ? 'text-gray-400 dark:text-gray-500' : 'text-emerald-600 dark:text-emerald-400')
                     : 'text-rose-600 dark:text-rose-400')}
        </div>
        ${worst ? `<p class="text-[11px] text-gray-400 dark:text-gray-500 px-1 -mt-1.5">
            · 물량이 가장 어긋난 업무: <b class="${errTone(worst.err)}">${escapeHtml(worst.label)} ${pctText(worst.err)}</b>
        </p>` : ''}

        <!-- 업무별 누적 -->
        <section class="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
            <header class="flex items-baseline gap-2 px-3.5 py-2.5 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
                <h5 class="text-[12px] font-extrabold text-gray-700 dark:text-gray-200">업무별 누적</h5>
                <span class="text-[11px] text-gray-400 dark:text-gray-500">계획 대비 실제 · 시간이 많이 어긋난 순</span>
            </header>
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50/60 dark:bg-gray-900/20">
                        <tr>
                            <th class="py-2 px-3 text-left font-bold">업무</th>
                            <th class="py-2 px-3 text-right font-bold">계획 물량</th>
                            <th class="py-2 px-3 text-right font-bold">실제 물량</th>
                            <th class="py-2 px-3 text-right font-bold">물량 오차</th>
                            <th class="py-2 px-3 text-right font-bold"
                                title="그날 계획한 소요시간(인시). 수량형은 물량 ÷ 그날 기준 UPH, 시간형은 넣어 둔 투입시간입니다.">계획 시간</th>
                            <th class="py-2 px-3 text-right font-bold" title="그 업무에 실제로 쓴 시간(인시)">실제 시간</th>
                            <th class="py-2 px-3 text-right font-bold"
                                title="시간이 계획보다 얼마나 더(덜) 걸렸는가. 물량을 맞혔어도 여기가 틀어질 수 있습니다.">시간 오차</th>
                            <th class="py-2 px-3 text-right font-bold" title="실제 물량 ÷ 실제 투입 인시">실제 UPH</th>
                            <th class="py-2 px-3 text-right font-bold"
                                title="그날 계획이 가정한 속도(= 계획 물량 ÷ 계획 시간). 지금 기준이 아니라 그날 얼린 값입니다.">계획 UPH</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${taskRows.map(t => `
                        <tr class="border-t border-gray-100 dark:border-gray-700/60">
                            <td class="py-2 px-3 font-medium text-gray-700 dark:text-gray-200">${escapeHtml(t.label)}${t.unplanned
                                ? ' <span class="text-[10px] font-bold text-violet-500 dark:text-violet-300" title="계획에 없었는데 실제로 진행한 업무입니다">계획 외</span>'
                                : (t.isTime ? ' <span class="text-[10px] font-bold text-indigo-400 dark:text-indigo-300" title="처리량이 없어 투입시간으로 재는 업무입니다">시간</span>' : '')}</td>
                            <td class="py-2 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400">${(t.isTime || t.unplanned) ? '—' : t.plan.toLocaleString()}${별표(t)}</td>
                            <td class="py-2 px-3 text-right tabular-nums font-bold text-gray-800 dark:text-gray-100">${t.isTime ? '—' : t.showQty.toLocaleString()}${별표(t)}</td>
                            <td class="py-2 px-3 text-right tabular-nums font-bold ${t.isTime ? 'text-gray-300 dark:text-gray-600' : errTone(t.err)}">${(t.isTime || t.unplanned) ? '—' : pctText(t.err)}</td>
                            <td class="py-2 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400">${t.planHours > 0 ? fmtHM(t.planHours) : '—'}${별표(t)}</td>
                            <td class="py-2 px-3 text-right tabular-nums font-bold text-gray-800 dark:text-gray-100">${t.showHours > 0 ? fmtHM(t.showHours) : '—'}${별표(t)}</td>
                            <td class="py-2 px-3 text-right tabular-nums font-bold ${errTone(t.hourErr)}">${pctText(t.hourErr)}${별표(t)}</td>
                            <td class="py-2 px-3 text-right tabular-nums ${t.uphErr != null && Math.abs(t.uphErr) > 0.15 ? 'font-bold ' + errTone(t.uphErr) : 'text-gray-600 dark:text-gray-300'}">${t.realUPH != null ? t.realUPH.toFixed(1) : '—'}</td>
                            <td class="py-2 px-3 text-right tabular-nums text-gray-400 dark:text-gray-500"${t.nowUPH > 0 ? ` title="지금 기준 UPH ${t.nowUPH.toFixed(1)}"` : ''}>${t.planUPH > 0 ? t.planUPH.toFixed(1) : '—'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </section>

        <!-- 날짜별 -->
        <section class="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
            <header class="flex items-baseline gap-2 px-3.5 py-2.5 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
                <h5 class="text-[12px] font-extrabold text-gray-700 dark:text-gray-200">날짜별</h5>
                <span class="text-[11px] text-gray-400 dark:text-gray-500">계획 소요시간(인시) 대비 실제 투입</span>
            </header>
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50/60 dark:bg-gray-900/20">
                        <tr>
                            <th class="py-2 px-3 text-left font-bold">날짜</th>
                            <th class="py-2 px-3 text-right font-bold">계획 시간</th>
                            <th class="py-2 px-3 text-right font-bold">실제 시간</th>
                            <th class="py-2 px-3 text-right font-bold"
                                title="계획한 업무만 비교한 시간 오차. 계획 외 업무는 빼고 봅니다 — 계획 자체가 맞았는지를 봅니다.">계획 적중</th>
                            <th class="py-2 px-3 text-right font-bold"
                                title="그날 실제 투입시간 중 계획에 없던 업무가 차지한 비중">계획 외</th>
                            <th class="py-2 px-3 text-right font-bold"
                                title="계획 물량·시간이 있었는데 실적이 0인 업무 수">미착수</th>
                            <th class="py-2 px-3 text-right font-bold"
                                title="계획 외 업무를 계획 쪽에 더해 본 종전 지표. 계획 외 업무가 많은 날은 오차가 작게 보입니다.">전체 오차</th>
                            <th class="py-2 px-3 text-right font-bold">계획 인원</th>
                            <th class="py-2 px-3 text-right font-bold">실제 투입</th>
                            <th class="py-2 px-2 w-8"></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.slice().reverse().map(r => `
                        <tr class="border-t border-gray-100 dark:border-gray-700/60">
                            <td class="py-2 px-3 font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">${dayLabel(r.date)}${r.auto
                                ? ` <span class="text-[10px] text-gray-400 dark:text-gray-500" title="아침에 자동으로 얼린 계획${r.snapAutoAt ? ` (${r.snapAutoAt})` : ''}">🤖</span>` : ''}</td>
                            <td class="py-2 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400">${fmtHM(r.planPlannedHours)}</td>
                            <td class="py-2 px-3 text-right tabular-nums font-bold text-gray-800 dark:text-gray-100"
                                title="전체 ${fmtHM(r.actualHours)} = 계획한 업무 ${fmtHM(r.actualPlannedHours)} + 계획 외 ${fmtHM(r.unplannedHours)}${r.untaggedHours > 0 ? ` + 업무명 없는 기록 ${fmtHM(r.untaggedHours)}` : ''}">${fmtHM(r.actualHours)}</td>
                            <td class="py-2 px-3 text-right tabular-nums font-bold ${errTone(r.planHitErr)}"
                                title="계획 ${fmtHM(r.planPlannedHours)} 대비 계획한 업무에 쓴 ${fmtHM(r.actualPlannedHours)}">${pctText(r.planHitErr)}</td>
                            <td class="py-2 px-3 text-right tabular-nums ${(r.unplannedShare || 0) > 0.3 ? 'font-bold text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}">${r.unplannedShare == null ? '—' : `${Math.round(r.unplannedShare * 100)}%`}</td>
                            <td class="py-2 px-3 text-right tabular-nums ${r.missed.count > 0 ? 'font-bold text-rose-600 dark:text-rose-400' : 'text-gray-300 dark:text-gray-600'}"${r.missed.count > 0 ? ` title="${escapeHtml(r.missed.keys.join(' · '))}"` : ''}>${r.missed.count > 0 ? `${r.missed.count}건` : '—'}</td>
                            <td class="py-2 px-3 text-right tabular-nums ${errTone(r.hourErr)} opacity-60"
                                title="분모 = 계획 ${fmtHM(r.planPlannedHours)} + 계획 외 ${fmtHM(r.unplannedHours)} = ${fmtHM(r.planHours)}">${pctText(r.hourErr)}</td>
                            <td class="py-2 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400">${r.planFTE}명</td>
                            <td class="py-2 px-3 text-right tabular-nums text-gray-600 dark:text-gray-300">${r.actualMembers}명</td>
                            <td class="py-2 px-2 text-center">
                                <button type="button" class="accuracy-drop text-gray-300 dark:text-gray-600 hover:text-rose-500 transition text-[13px] leading-none"
                                        data-date="${r.date}" title="이 날의 확정 계획을 지웁니다 (정확도 비교에서 제외 · 업무 기록은 그대로)">✕</button>
                            </td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </section>

        <p class="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed px-1">
            · <b>계획</b>은 그날 아침에 얼려 둔 값입니다. 아무도 <b>📌 계획 확정</b>을 누르지 않아도
              그날 앱을 처음 열 때 <b>🤖 자동으로</b> 얼립니다(평일 13:00 이전 첫 접속).
              그보다 늦게 처음 열린 날은 비교에서 빠집니다.<br>
            · <b>주말·공휴일 특근</b>은 자동으로 얼리지 않습니다(인원·업무 구성이 평일과 달라
              평일 평균을 흐립니다). 그날도 비교하고 싶으면 <b>📌 계획 확정</b>을 눌러 두세요.<br>
            · <b>계획 적중</b>이 이 화면의 주된 지표입니다. <b>전체 오차</b>는 계획에 없던 업무까지 계획으로 쳐서
              계산한 종전 값이라, 계획이 통째로 어긋난 날도 작게 보입니다 — 두 값이 많이 다른 날은
              <b>계획 외</b>·<b>미착수</b> 칸을 함께 보세요.<br>
            · <b>실제 시간</b>은 그날 업무 기록의 소요시간 합계(인시)입니다.<br>
            · <b>시간 오차</b>가 이 표의 핵심입니다 — 물량을 맞혔어도 시간이 틀어질 수 있고,
              <b>시간으로 재는 업무</b>(<span class="text-indigo-400">시간</span> 표시)는 물량이 없어 여기서만 보입니다.
              <b>계획 외</b> 업무는 표 아래쪽에 실제 시간이 큰 순으로 모아 둡니다.<br>
            · <b>*</b> 는 그 업무에서 <b>계산에서 뺀 날</b>이 있다는 뜻입니다 — 기준 속도가 없던 날,
              또는 그 업무가 그날 계획에 없던 날입니다. 계획과 짝이 맞는 날만 비교해야
              '계획을 한 번도 어기지 않았는데 오차가 뜨는' 일이 없습니다(표시에 마우스를 올리면 나옵니다).<br>
            · <b>계획 UPH</b>는 그날 계획이 가정한 속도입니다(지금 기준이 아니라 <b>그날 얼린 값</b>).
              <b>실제 UPH</b>가 그보다 꾸준히 낮으면 기준 속도를 다시 볼 때가 된 것입니다
              (지금 기준값은 그 칸에 마우스를 올리면 나옵니다).<br>
            · 잘못 확정한 날은 오른쪽 <b>✕</b>로 비교에서 뺄 수 있습니다(업무 기록·실적은 지워지지 않습니다).
        </p>
      </div>`;
};

/** 정확도 화면 진입 — 과거 스냅샷을 한 번 읽어 온다(들어올 때만) */
renderAccuracyView = () => {
    if (accuracySnapshots) { renderAccuracyBody(); return; }
    accuracyLoading = true;
    renderAccuracyBody();

    const days = recentClosedDays(30);
    const from = days[0]?.id, to = days[days.length - 1]?.id;
    if (!from || !to) { accuracyLoading = false; accuracySnapshots = {}; renderAccuracyBody(); return; }

    fetchForecastSnapshots(from, to)
        .then(m => { accuracySnapshots = m || {}; })
        .catch(e => { console.error('[forecast] 스냅샷 로드 실패:', e); accuracySnapshots = {}; })
        .finally(() => { accuracyLoading = false; renderAccuracyBody(); });
};


const predictionCharts = {
    revenue: null,
    delivery: null
};

// ───────────────────────────────────────────────────────────
// 🔀 채널 선택 — 실적 예측 전체(KPI·오늘 진행률·차트)를 한 채널 기준으로 계산한다.
//   '전체'는 총계(모든 채널 합), 개별 채널은 그 채널의 매출·주문건수·배송량만 사용.
//   예) 일반배송(카페24) = 국내배송 물량 + 카페24 매출/주문건
// ───────────────────────────────────────────────────────────
let predChannelId = 'all';
const predScope = () => channelScope(predChannelId === 'all' ? null : predChannelId);

const renderChannelTabs = (historyData) => {
    const host = document.getElementById('pred-channel-tabs');
    const note = document.getElementById('pred-channel-note');
    if (!host) return;

    // 배송량이 없는 채널('기타')은 예측 탭에서 뺀다.
    // 이 화면은 매출·주문건수·배송량이 한 세트라, 배송량이 없으면 차트가 빈 채로 남아 고장처럼 보인다.
    const opts = [{ id: 'all', label: '전체' }, ...DELIVERY_CHANNELS.map(c => ({ id: c.id, label: c.label }))];
    host.innerHTML = opts.map(o => {
        const on = o.id === predChannelId;
        return `<button type="button" data-pred-channel="${o.id}"
            class="px-3 py-1.5 border-r border-gray-200 dark:border-gray-600 last:border-r-0 ${on
                ? 'bg-indigo-600 text-white'
                : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}">${o.label}</button>`;
    }).join('');

    const sc = predScope();
    if (note) {
        note.textContent = predChannelId === 'all'
            ? `매출·주문건수는 전체 합계, 배송량은 ${sc.deliverySource} 합계 기준`
            : `매출·주문건수는 ${sc.label}, 배송량은 ${sc.deliverySource} 물량 기준`;
    }

    if (host.dataset.bound !== 'true') {
        host.dataset.bound = 'true';
        host.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-pred-channel]');
            if (!btn) return;
            predChannelId = btn.dataset.predChannel;
            renderPredictionTab(State.allHistoryData);
        });
    }
};

// 💡 배송량은 "건 / 장"으로 함께 표시한다. (장 = 상품수, 건 = 주문건수)
//
// 건수 환산 계수(건당 상품수)는 고정값 1.2가 아니라 **선택한 채널의 실제 기록**에서 구한다.
//   계수 = Σ배송량(장) ÷ Σ주문건수(건)   ← 최근 이력 중 둘 다 입력된 날만 사용
// 채널마다 건당 상품수가 다르므로(일반배송 ~1.2, 직진/도착보장은 다름) 채널별로 계산해야 맞다.
// 주문건수 기록이 아직 없는 채널·기간은 예전과 동일하게 1.2로 폴백한다.
const DEFAULT_ITEMS_PER_ORDER = 1.2;
let itemsPerOrder = DEFAULT_ITEMS_PER_ORDER;
// 직진배송·도착보장은 건수 개념이 없어 장수만 표시한다(전체도 섞이므로 장수만).
let showDeliveryCases = true;

const computeItemsPerOrder = (historyData, scope) => {
    let sumDel = 0, sumOrd = 0;
    (historyData || []).forEach(d => {
        const del = scope.deliveryOf(d);
        const ord = scope.orderCountOf(d);
        if (del > 0 && ord > 0) { sumDel += del; sumOrd += ord; }
    });
    if (sumOrd <= 0) return DEFAULT_ITEMS_PER_ORDER;
    const ratio = sumDel / sumOrd;
    // 비정상값(입력 실수 등) 방어 — 1건당 0.5~10장 범위를 벗어나면 기본값 사용
    return (ratio >= 0.5 && ratio <= 10) ? ratio : DEFAULT_ITEMS_PER_ORDER;
};

/** 장 → "N건 / M장" (건수 개념이 있는 채널만 병기, 그 외는 "M장") */
const formatDelivery = (val) => {
    const v = Math.round(Number(val) || 0);
    if (!showDeliveryCases) return `${v.toLocaleString()}장`;
    if (v <= 0) return '0건 / 0장';
    const cases = Math.round(v / (itemsPerOrder || DEFAULT_ITEMS_PER_ORDER));
    return `${cases.toLocaleString()}건 / ${v.toLocaleString()}장`;
};

/** 장 수를 건수로만 환산 (범위 표기용) */
const toCases = (val) => Math.round((Number(val) || 0) / (itemsPerOrder || DEFAULT_ITEMS_PER_ORDER));

export const renderPredictionTab = (historyData, daysToPredict = 14) => {
    // (업무량 시뮬레이션은 '업무 예상' 탭(renderForecastTab)으로 이동됨)
    const revenueCtx = document.getElementById('chart-prediction-revenue');
    const deliveryCtx = document.getElementById('chart-prediction-delivery');

    if (!revenueCtx || !deliveryCtx) return;

    const selectEl = document.getElementById('prediction-days-select');
    if (selectEl) {
        daysToPredict = parseInt(selectEl.value, 10);
    }

    // 🔀 선택된 채널 기준으로 매출·주문건수·배송량을 모두 계산한다.
    const scope = predScope();
    renderChannelTabs(historyData);

    // 배송량의 "건" 환산 계수도 선택한 채널 기준으로 갱신 (채널마다 건당 상품수가 다름)
    itemsPerOrder = computeItemsPerOrder(historyData, scope);
    showDeliveryCases = scope.showDeliveryCases !== false;

    // 주문건수는 세 채널 모두 유효하므로 항상 표시한다.
    // 다만 풀필먼트 채널(직진배송·도착보장)은 '그날 보낸 장수'와 '그날 잡히는 주문건수'가
    // 서로 다른 시점의 값이라 둘을 연결해 보면 안 된다는 안내를 띄운다.
    ['pred-card-tomorrow-ord', 'pred-card-avg-ord', 'pred-today-ord-block'].forEach(id => {
        document.getElementById(id)?.classList.remove('hidden');
    });
    const noteEl = document.getElementById('pred-fulfillment-note');
    if (noteEl) {
        const isFulfillment = scope.fulfillment === true && predChannelId !== 'all';
        noteEl.classList.toggle('hidden', !isFulfillment);
        if (isFulfillment) {
            noteEl.innerHTML = `ℹ️ <b>${scope.label}</b>은 풀필먼트(채널 창고로 선입고 후 판매) 방식입니다. `
                + `배송량(장)은 <b>우리가 그날 보낸 수량</b>, 매출·주문건수는 <b>그날 채널에서 수집된 판매 실적</b>이라 `
                + `서로 다른 시점의 값입니다. 두 값을 곱하거나 나눠 비교하지 말고 <b>각각 따로</b> 보세요.`;
        }
    }

    const result = predictFutureTrends(historyData, daysToPredict, scope);

    // 차트 제목에 현재 기준 표시
    const scopeSuffix = predChannelId === 'all' ? '(전체 합계)' : `(${scope.label})`;
    const revScopeEl = document.getElementById('pred-chart-rev-scope');
    const delScopeEl = document.getElementById('pred-chart-del-scope');
    if (revScopeEl) revScopeEl.textContent = scopeSuffix;
    if (delScopeEl) {
        const base = predChannelId === 'all' ? '전체 합계' : scope.deliverySource;
        if (showDeliveryCases) {
            delScopeEl.textContent = `(${base} · 건당 ${itemsPerOrder.toFixed(2)}장 기준)`;
            delScopeEl.title = itemsPerOrder === DEFAULT_ITEMS_PER_ORDER
                ? '주문건수 기록이 없어 기본값 1.2장/건으로 환산했습니다.'
                : '실제 기록(Σ배송량 ÷ Σ주문건수)에서 계산한 건당 상품수입니다.';
        } else {
            delScopeEl.textContent = `(${base} · 장수 기준)`;
            delScopeEl.title = '이 채널은 주문 건수 개념이 없어 장수(상품수)로만 표시합니다.';
        }
    }

    if (!result) {
        renderNoData(revenueCtx, "데이터가 부족하여 예측할 수 없습니다.");
        renderNoData(deliveryCtx, "데이터가 부족하여 예측할 수 없습니다.");
        updateKPICards(null, null, daysToPredict);
        return;
    }

    const { historical, prediction, trend } = result;

    const splitIndex = historical.labels.length;
    const allLabels = [...historical.labels, ...prediction.labels];

    // ✨ 범위(range) 데이터를 함께 넘겨주어 신뢰 구간을 그리도록 수정
    renderChart('revenue', revenueCtx, allLabels, historical.revenue, prediction.revenue, prediction.rangeRevenue, splitIndex, '매출 (원)', 'rgb(79, 70, 229)');
    renderChart('delivery', deliveryCtx, allLabels, historical.delivery, prediction.delivery, prediction.rangeDelivery, splitIndex, '배송량 (장)', 'rgb(16, 185, 129)');

    updateKPICards(prediction, trend, daysToPredict);

    if (selectEl && !selectEl.dataset.listenerAttached) {
        selectEl.dataset.listenerAttached = 'true';
        selectEl.addEventListener('change', () => {
            renderPredictionTab(historyData); 
        });
    }
};

const updateKPICards = (prediction, trend, daysToPredict) => {
    // Today Monitoring UI
    const elTodayEstRev = document.getElementById('pred-today-est-rev');
    const elTodayActRev = document.getElementById('pred-today-act-rev');
    const elTodayRevBar = document.getElementById('pred-today-rev-bar');
    
    const elTodayEstDel = document.getElementById('pred-today-est-del');
    const elTodayActDel = document.getElementById('pred-today-act-del');
    const elTodayDelBar = document.getElementById('pred-today-del-bar');

    const elTodayEstOrd = document.getElementById('pred-today-est-ord');
    const elTodayActOrd = document.getElementById('pred-today-act-ord');
    const elTodayOrdBar = document.getElementById('pred-today-ord-bar');
    const elErrorText = document.getElementById('pred-error-rate-text');

    // Tomorrow & Period UI
    const elTomRev = document.getElementById('pred-tomorrow-revenue');
    const elTomDel = document.getElementById('pred-tomorrow-delivery');
    const elTomOrd = document.getElementById('pred-tomorrow-ordercount');
    const elPerAvgRev = document.getElementById('pred-period-avg-revenue');
    const elPerAvgDel = document.getElementById('pred-period-avg-delivery');
    const elPerAvgOrd = document.getElementById('pred-period-avg-ordercount');
    const elPeriodLabel = document.getElementById('pred-period-label');
    const elRevTrend = document.getElementById('pred-revenue-trend');
    const elDelTrend = document.getElementById('pred-delivery-trend');
    const elOrdTrend = document.getElementById('pred-ordercount-trend');

    if (!prediction) {
        [elTomRev, elTomDel, elTomOrd, elPerAvgRev, elPerAvgDel, elPerAvgOrd]
            .forEach(el => { if (el) el.textContent = '-'; });
        return;
    }

    const { today, tomorrow, revenue, delivery, orderCount } = prediction;

    // 1. 당일 실적 추적 모니터링 업데이트
    if (today) {
        if (elTodayEstRev) elTodayEstRev.textContent = today.predictedRev.toLocaleString();
        if (elTodayActRev) elTodayActRev.textContent = today.actualRev.toLocaleString();
        if (elTodayRevBar) {
            const revPct = today.predictedRev > 0 ? Math.min(100, (today.actualRev / today.predictedRev) * 100) : 0;
            elTodayRevBar.style.width = `${revPct}%`;
        }

        if (elTodayEstDel) elTodayEstDel.textContent = formatDelivery(today.predictedDel);
        if (elTodayActDel) elTodayActDel.textContent = formatDelivery(today.actualDel);
        if (elTodayDelBar) {
            const delPct = today.predictedDel > 0 ? Math.min(100, (today.actualDel / today.predictedDel) * 100) : 0;
            elTodayDelBar.style.width = `${delPct}%`;
        }

        if (elTodayEstOrd) elTodayEstOrd.textContent = `${(today.predictedOrd || 0).toLocaleString()}건`;
        if (elTodayActOrd) elTodayActOrd.textContent = `${(today.actualOrd || 0).toLocaleString()}건`;
        if (elTodayOrdBar) {
            const ordPct = today.predictedOrd > 0 ? Math.min(100, (today.actualOrd / today.predictedOrd) * 100) : 0;
            elTodayOrdBar.style.width = `${ordPct}%`;
        }

        if (elErrorText) {
            const revFactorPct = ((today.errorFactorRev - 1) * 100).toFixed(1);
            const delFactorPct = ((today.errorFactorDel - 1) * 100).toFixed(1);
            const revColor = revFactorPct >= 0 ? 'text-red-500' : 'text-blue-500';
            const delColor = delFactorPct >= 0 ? 'text-red-500' : 'text-blue-500';
            
            elErrorText.innerHTML = `최근 14일 오차율을 분석하여 예측치에 <br/>매출 <strong class="${revColor}">${revFactorPct > 0 ? '+'+revFactorPct : revFactorPct}%</strong>, 배송 <strong class="${delColor}">${delFactorPct > 0 ? '+'+delFactorPct : delFactorPct}%</strong> 자동 보정 반영됨.`;
        }
    }

    // 2. 내일 예측 및 기간 평균 업데이트 (✨ 범위 텍스트 추가됨)
    const avgRev = revenue.reduce((a,b)=>a+b,0) / revenue.length;
    const avgDel = delivery.reduce((a,b)=>a+b,0) / delivery.length;
    const ordSeries = orderCount || [];
    const avgOrd = ordSeries.length ? ordSeries.reduce((a,b)=>a+b,0) / ordSeries.length : 0;

    if (elTomRev) {
        if (tomorrow.revenue > 0) {
            const minRev = prediction.rangeRevenue[0].min;
            const maxRev = prediction.rangeRevenue[0].max;
            elTomRev.innerHTML = `${tomorrow.revenue.toLocaleString()} <span class="text-[11px] text-gray-500 font-normal ml-1">(최소 ${minRev.toLocaleString()} ~ 최대 ${maxRev.toLocaleString()})</span>`;
        } else {
            elTomRev.textContent = '휴무(0)';
        }
    }
    
    if (elTomDel) {
        if (tomorrow.delivery > 0) {
            const minDel = prediction.rangeDelivery[0].min;
            const maxDel = prediction.rangeDelivery[0].max;
            const rangeTxt = showDeliveryCases
                ? `(최소 ${toCases(minDel).toLocaleString()}건 ~ 최대 ${toCases(maxDel).toLocaleString()}건)`
                : `(최소 ${minDel.toLocaleString()}장 ~ 최대 ${maxDel.toLocaleString()}장)`;
            elTomDel.innerHTML = `${formatDelivery(tomorrow.delivery)} <span class="text-[11px] text-gray-500 font-normal ml-1 mt-1 block md:inline">${rangeTxt}</span>`;
        } else {
            elTomDel.textContent = '휴무(0)';
        }
    }
    
    if (elTomOrd) {
        if (tomorrow.orderCount > 0) {
            const r = (prediction.rangeOrderCount && prediction.rangeOrderCount[0]) || { min: 0, max: 0 };
            elTomOrd.innerHTML = `${tomorrow.orderCount.toLocaleString()}건 <span class="text-[11px] text-gray-500 font-normal ml-1">(최소 ${r.min.toLocaleString()} ~ 최대 ${r.max.toLocaleString()})</span>`;
        } else {
            elTomOrd.textContent = '휴무(0)';
        }
    }

    if (elPerAvgRev) elPerAvgRev.textContent = Math.round(avgRev).toLocaleString();
    if (elPerAvgDel) elPerAvgDel.textContent = formatDelivery(avgDel);
    if (elPerAvgOrd) elPerAvgOrd.textContent = `${Math.round(avgOrd).toLocaleString()}건`;
    if (elPeriodLabel) elPeriodLabel.textContent = `향후 ${daysToPredict}일 기준`;

    // 3. 장기 추세 안내 텍스트
    if (elRevTrend && trend) {
        const factor = trend.revenueFactor;
        let trendIcon = '➡️', trendText = '보합세 유지 중', color = 'text-blue-500';
        if (factor > 1.05) { trendIcon = '📈'; trendText = `최근 매출 꾸준한 상승세`; color = 'text-red-500'; }
        else if (factor < 0.95) { trendIcon = '📉'; trendText = `최근 매출 하락세 주의`; color = 'text-blue-500'; }
        elRevTrend.innerHTML = `${trendIcon} <span class="${color} font-bold">${trendText}</span>`;
    }

    if (elOrdTrend && trend) {
        const factor = trend.orderCountFactor || 1;
        let trendIcon = '➡️', trendText = '보합세 유지 중', color = 'text-blue-500';
        if (factor > 1.05) { trendIcon = '🧾📈'; trendText = `최근 주문건수 증가 추세`; color = 'text-red-500'; }
        else if (factor < 0.95) { trendIcon = '🧾📉'; trendText = `최근 주문건수 감소 추세`; color = 'text-blue-500'; }
        elOrdTrend.innerHTML = `${trendIcon} <span class="${color} font-bold">${trendText}</span>`;
    }

    if (elDelTrend && trend) {
        const factor = trend.deliveryFactor;
        let trendIcon = '➡️', trendText = '보합세 유지 중', color = 'text-blue-500';
        if (factor > 1.05) { trendIcon = '📦📈'; trendText = `최근 배송량 증가 추세`; color = 'text-red-500'; }
        else if (factor < 0.95) { trendIcon = '📦📉'; trendText = `최근 배송량 감소 추세`; color = 'text-blue-500'; }
        elDelTrend.innerHTML = `${trendIcon} <span class="${color} font-bold">${trendText}</span>`;
    }
};

// ✨ 신뢰 구간 범위를 포함하여 렌더링하도록 수정
const renderChart = (key, ctx, labels, histData, predData, predRangeData, splitIndex, label, color) => {
    if (predictionCharts[key]) {
        predictionCharts[key].destroy();
    }

    // 1. 과거 실적 데이터
    const historicalDataset = histData.map((v, i) => i < splitIndex ? v : null);
    
    // 2. 예측 평균 데이터 (선이 이어지도록 스플릿 인덱스 처리)
    const predictionDataset = labels.map((_, i) => {
        if (i === splitIndex - 1) return histData[splitIndex - 1]; 
        if (i >= splitIndex) return predData[i - splitIndex];
        return null;
    });

    // 3. 예측 최대치 데이터 (신뢰 구간의 상단)
    const predictionMaxDataset = labels.map((_, i) => {
        if (i === splitIndex - 1) return histData[splitIndex - 1]; 
        if (i >= splitIndex) return predRangeData[i - splitIndex]?.max || predData[i - splitIndex];
        return null;
    });

    // 4. 예측 최소치 데이터 (신뢰 구간의 하단)
    const predictionMinDataset = labels.map((_, i) => {
        if (i === splitIndex - 1) return histData[splitIndex - 1]; 
        if (i >= splitIndex) return predRangeData[i - splitIndex]?.min || predData[i - splitIndex];
        return null;
    });

    predictionCharts[key] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '실적 (과거)',
                    data: historicalDataset,
                    borderColor: color,
                    backgroundColor: color.replace(')', ', 0.1)').replace('rgb', 'rgba'),
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.3,
                    fill: true
                },
                {
                    label: '예측 최대치',
                    data: predictionMaxDataset,
                    borderColor: 'transparent',
                    backgroundColor: color.replace(')', ', 0.15)').replace('rgb', 'rgba'), // 옅은 색상 영역
                    borderWidth: 0,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0.3,
                    fill: '+1' // 🔥 하단(최소치) 라인까지 영역을 색칠함 (신뢰 구간 형성)
                },
                {
                    label: '예측 최소치',
                    data: predictionMinDataset,
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    borderWidth: 0,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0.3,
                    fill: false
                },
                {
                    label: '예측 평균 (AI)',
                    data: predictionDataset,
                    borderColor: '#f59e0b', 
                    borderWidth: 2,
                    borderDash: [5, 5], 
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.3,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end',
                    labels: { 
                        boxWidth: 12, 
                        usePointStyle: true,
                        // ✨ 범례가 지저분해지지 않도록 최대치/최소치 항목은 숨김
                        filter: function(item) {
                            return !item.text.includes('최대치') && !item.text.includes('최소치');
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                const val = Math.round(context.parsed.y);
                                if (key === 'delivery') {
                                    const cases = Math.round(val / 1.2);
                                    label += `${cases.toLocaleString()}건 / ${val.toLocaleString()}장`;
                                } else {
                                    label += val.toLocaleString();
                                }
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 10, font: { size: 10 } }
                },
                y: {
                    beginAtZero: true,
                    grid: { borderDash: [2, 2] },
                    ticks: { font: { size: 10 } }
                }
            }
        }
    });
};

const renderNoData = (ctx, msg) => {
    const context = ctx.getContext('2d');
    context.clearRect(0, 0, ctx.width, ctx.height);
    context.font = "14px 'Noto Sans KR'";
    context.fillStyle = "#9ca3af";
    context.textAlign = "center";
    context.fillText(msg, ctx.width / 2, ctx.height / 2);
};