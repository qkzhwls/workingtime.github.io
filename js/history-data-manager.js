// === js/history-data-manager.js ===
import * as State from './state.js?v=202610021042';
import { getTodayDateString, toDateString, getCurrentTime, calcElapsedMinutes, showToast } from './utils.js?v=202610021042';
import {
    doc, setDoc, getDoc, getDocFromServer, collection, getDocs, getDocsFromServer,
    deleteDoc, deleteField,
    query, where, writeBatch, updateDoc, increment, documentId
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let isHistoryCached = false;
let cachedUnverifiedDates = null;
let lastUnverifiedCheckTime = 0;

let historyFetchPromise = null;
let unverifiedFetchPromise = null;

// 이력 캐시 TTL. 과거 이력은 변하지 않으므로 길게 캐싱(읽기 요금 절감).
// 오늘 데이터는 실시간 동기화(syncTodayToHistory)로 별도 갱신되므로 영향 없음.
const HISTORY_CACHE_TTL_MS = 30 * 60 * 1000; // 30분

// ✨ 데이터가 변경되었을 때 로컬 캐시를 초기화하는 헬퍼 함수 (읽기 요금 방어용)
// localStorage 사용: 탭 간 공유 + 새로고침/재시작 후에도 유지되어 중복 읽기 최소화.
export const clearLocalCache = () => {
    localStorage.removeItem('historyDataCache');
    localStorage.removeItem('historyDataCacheTime');
    localStorage.removeItem('unverifiedDataCache');
    localStorage.removeItem('unverifiedDataCacheTime');
};

// ============================================================
// 📅 예정 물량(plannedData) — 미래 날짜별 계획 처리량 (실적 history와 분리)
// ============================================================

const PLANNED_CACHE_KEY = 'plannedDataCache';
const PLANNED_CACHE_TIME_KEY = 'plannedDataCacheTime';
const PLANNED_CACHE_TTL_MS = 10 * 60 * 1000; // 10분

const plannedColRef = () => collection(State.db, 'artifacts', 'team-work-logger-v2', 'plannedData');

// 미래 N일(오늘 제외) 날짜 문자열 배열 (로컬 시간대 기준)
export function getUpcomingPlannedDateStrings(n = 7) {
    const base = new Date(getTodayDateString() + 'T00:00:00');
    const out = [];
    for (let i = 1; i <= n; i++) {
        const d = new Date(base); d.setDate(d.getDate() + i);
        out.push(toDateString(d));
    }
    return out;
}

// 예정 물량 로드 (오늘 이후). 10분 캐시로 읽기요금 방어.
export async function fetchPlannedData(forceRefresh = false) {
    if (!State.auth || !State.auth.currentUser) return State.plannedData;
    const today = getTodayDateString();

    if (!forceRefresh) {
        try {
            const cached = localStorage.getItem(PLANNED_CACHE_KEY);
            const t = localStorage.getItem(PLANNED_CACHE_TIME_KEY);
            if (cached && t && (Date.now() - parseInt(t) < PLANNED_CACHE_TTL_MS)) {
                State.setPlannedData(JSON.parse(cached).filter(d => d.id >= today));
                return State.plannedData;
            }
        } catch (_) {}
    }

    try {
        const q = query(plannedColRef(), where(documentId(), '>=', today));
        const snap = await getDocs(q);
        const arr = [];
        snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
        arr.sort((a, b) => a.id.localeCompare(b.id));
        State.setPlannedData(arr);
        try {
            localStorage.setItem(PLANNED_CACHE_KEY, JSON.stringify(arr));
            localStorage.setItem(PLANNED_CACHE_TIME_KEY, Date.now().toString());
        } catch (_) {}
        return State.plannedData;
    } catch (e) {
        console.error('fetchPlannedData failed:', e);
        return State.plannedData;
    }
}

// 특정 날짜의 예정 물량 맵 (없으면 {})
export function getPlannedQuantitiesForDate(dateStr) {
    const rec = (State.plannedData || []).find(d => d.id === dateStr);
    return (rec && rec.plannedQuantities) ? rec.plannedQuantities : {};
}

// 특정 날짜의 업무 제외시간(분). 저장한 적 없으면 null
export function getPlannedExcludeMinutesForDate(dateStr) {
    const rec = (State.plannedData || []).find(d => d.id === dateStr);
    const v = Number(rec?.plannedExcludeMinutes);
    return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

// 특정 날짜의 '시간으로 잡는 업무' 계획 (없으면 {})
//   { '개인담당업무': { minutes: 180, workers: 2 } } — 처리량이 없는 업무를 투입시간으로 저장한다.
export function getPlannedTimeTasksForDate(dateStr) {
    const rec = (State.plannedData || []).find(d => d.id === dateStr);
    return (rec && rec.plannedTimeTasks) ? rec.plannedTimeTasks : {};
}

// 📸 그날 아침 확정한 계획 스냅샷.
//   자동값은 실적이 쌓이면서 매일 바뀌므로, 나중에 다시 계산하면 '그날의 예상치'를 재현할 수 없다.
//   오차를 재려면 확정 시점의 값을 얼려 두어야 한다.
export function getForecastSnapshotForDate(dateStr) {
    const rec = (State.plannedData || []).find(d => d.id === dateStr);
    return (rec && rec.forecastSnapshot) ? rec.forecastSnapshot : null;
}

/** 계획 스냅샷 저장 — 같은 문서의 예정 물량은 건드리지 않는다(merge). */
export async function saveForecastSnapshot(dateStr, snapshot) {
    if (!State.auth || !State.auth.currentUser) { showToast('로그인이 필요합니다.', true); return false; }
    if (!dateStr || !snapshot) return false;
    try {
        const payload = {
            ...snapshot,
            at: new Date().toISOString(),
            by: State.appState?.currentUser || 'unknown'
        };
        await setDoc(doc(plannedColRef(), dateStr), { forecastSnapshot: payload }, { merge: true });

        const idx = (State.plannedData || []).findIndex(d => d.id === dateStr);
        if (idx > -1) State.plannedData[idx] = { ...State.plannedData[idx], forecastSnapshot: payload };
        else State.plannedData.push({ id: dateStr, forecastSnapshot: payload });
        try {
            localStorage.setItem(PLANNED_CACHE_KEY, JSON.stringify(State.plannedData));
            localStorage.setItem(PLANNED_CACHE_TIME_KEY, Date.now().toString());
        } catch (_) {}

        showToast(`${dateStr} 계획을 확정했습니다. 마감 후 '정확도'에서 비교할 수 있습니다.`);
        return true;
    } catch (e) {
        console.error('saveForecastSnapshot failed:', e);
        showToast('계획 확정 실패: ' + (e.message || e), true);
        return false;
    }
}

/** 📸 자동 계획 스냅샷 — **없을 때만** 쓴다.
 *
 *  왜 서버를 다시 읽는가
 *    State.plannedData 는 10분 TTL localStorage 캐시다. 캐시만 믿으면 다른 사람·다른 탭이
 *    방금 찍은 스냅샷이 안 보여서 덮어쓰게 된다. 아침에 사람이 값을 맞춰 확정한 것을
 *    자동값으로 갈아엎는 것이 최악이므로, 쓰기 직전에 서버에서 한 번 더 확인한다.
 *
 *  조용하다 — 토스트를 띄우지 않는다. 메인 화면 렌더 중에 돌기 때문이다.
 *  실패해도 throw 하지 않고 { ok:false, reason } 을 돌려준다.
 */
export async function saveForecastSnapshotIfAbsent(dateStr, snapshot) {
    if (!State.auth || !State.auth.currentUser) return { ok: false, reason: 'not-signed-in' };
    if (!dateStr || !snapshot) return { ok: false, reason: 'bad-args' };
    try {
        const ref = doc(plannedColRef(), dateStr);
        // 캐시가 아니라 서버 — 다른 사람/탭이 이미 찍었는지 본다
        const snap = await getDocFromServer(ref);
        if (snap.exists() && snap.data()?.forecastSnapshot) {
            return { ok: false, reason: 'already-exists' };
        }
        const payload = {
            ...snapshot,
            at: new Date().toISOString(),
            by: 'auto'
        };
        await setDoc(ref, { forecastSnapshot: payload }, { merge: true });

        const idx = (State.plannedData || []).findIndex(d => d.id === dateStr);
        if (idx > -1) State.plannedData[idx] = { ...State.plannedData[idx], forecastSnapshot: payload };
        else State.plannedData.push({ id: dateStr, forecastSnapshot: payload });
        try {
            localStorage.setItem(PLANNED_CACHE_KEY, JSON.stringify(State.plannedData));
            localStorage.setItem(PLANNED_CACHE_TIME_KEY, Date.now().toString());
        } catch (_) {}

        return { ok: true };
    } catch (e) {
        // 조용히 넘어간다 — 자동 스냅샷 실패가 화면을 막아서는 안 된다
        console.warn('saveForecastSnapshotIfAbsent failed:', e);
        return { ok: false, reason: 'error' };
    }
}

/** 계획 확정 취소 — 스냅샷만 지운다(예정 물량은 그대로 둔다).
 *  잘못 확정한 날이 정확도 통계를 계속 오염시키는 것을 막기 위해 지난 날짜도 지울 수 있다.
 *  (기록을 지우는 것은 없던 계획을 만들어 내는 것과 달라 안전하다) */
export async function deleteForecastSnapshot(dateStr) {
    if (!State.auth || !State.auth.currentUser) { showToast('로그인이 필요합니다.', true); return false; }
    if (!dateStr) return false;
    try {
        await setDoc(doc(plannedColRef(), dateStr), { forecastSnapshot: deleteField() }, { merge: true });

        const idx = (State.plannedData || []).findIndex(d => d.id === dateStr);
        if (idx > -1) {
            const rec = { ...State.plannedData[idx] };
            delete rec.forecastSnapshot;
            State.plannedData[idx] = rec;
            try {
                localStorage.setItem(PLANNED_CACHE_KEY, JSON.stringify(State.plannedData));
                localStorage.setItem(PLANNED_CACHE_TIME_KEY, Date.now().toString());
            } catch (_) {}
        }
        showToast(`${dateStr} 계획 확정을 취소했습니다.`);
        return true;
    } catch (e) {
        console.error('deleteForecastSnapshot failed:', e);
        showToast('확정 취소 실패: ' + (e.message || e), true);
        return false;
    }
}

/** 지난 날짜의 계획 스냅샷을 한 번에 읽는다(정확도 화면 전용).
 *  fetchPlannedData 는 '오늘 이후'만 담으므로 과거는 여기서 따로 가져온다. */
export async function fetchForecastSnapshots(fromDate, toDate) {
    if (!State.auth || !State.auth.currentUser) return {};
    if (!fromDate || !toDate) return {};
    try {
        const q = query(plannedColRef(),
                        where(documentId(), '>=', fromDate),
                        where(documentId(), '<=', toDate));
        const snap = await getDocs(q);
        const out = {};
        snap.forEach(d => {
            const v = d.data();
            if (v && v.forecastSnapshot) out[d.id] = v.forecastSnapshot;
        });
        return out;
    } catch (e) {
        console.error('fetchForecastSnapshots failed:', e);
        return {};
    }
}

// 예정 물량 저장 (문서 전체 교체 — 0으로 지운 항목이 남지 않도록 merge 안 함)
//  keepZeros: 0도 '0으로 하기로 한 값'으로 보고 그대로 저장한다.
//    업무 예상 화면의 '작업량 저장'이 이 방식이다 — 0을 지워 버리면 다시 자동값이 채워져
//    "0으로 고쳐 저장했는데 값이 되살아난다"가 된다.
//    반대로 예정 물량 입력 모달은 빈칸도 0으로 넘겨주므로 기존처럼 0을 버린다.
//  timeTasks: '시간으로 잡는 업무'({ 업무명: {minutes, workers} }). 넘기지 않으면 기존 값을 그대로 둔다
//    (예정 물량 모달은 물량만 다루므로, 그 저장이 담당업무 시간을 지우면 안 된다).
//  excludeMinutes: 업무 제외시간(분). null이면 기존 값 유지, -1이면 지운다
export async function savePlannedQuantities(dateStr, plannedQuantities, { keepZeros = false, timeTasks = null, excludeMinutes = null } = {}) {
    if (!State.auth || !State.auth.currentUser) { showToast('로그인이 필요합니다.', true); return false; }
    if (!dateStr) return false;

    const clean = {};
    Object.entries(plannedQuantities || {}).forEach(([k, v]) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return;
        if (n > 0 || keepZeros) clean[k] = n;
    });

    // 시간형 업무: 넘어온 값이 있으면 그걸로, 없으면 기존 문서 값을 유지
    const 시간형_정리 = (src) => {
        const out = {};
        Object.entries(src || {}).forEach(([k, v]) => {
            const m = Math.round(Number(v?.minutes));
            if (!Number.isFinite(m) || m < 0) return;
            // 인원 0명 = 그날은 하지 않는 업무 — 0도 그대로 저장한다
            out[k] = { minutes: m, workers: Math.max(0, Math.round(Number(v?.workers) || 0)) };
        });
        return out;
    };
    // let — 아래에서 서버 값이 더 최신이면 그걸로 바꾼다
    let cleanTime = 시간형_정리(timeTasks || getPlannedTimeTasksForDate(dateStr));

    // 제외시간: 넘기지 않으면(null) 기존 값 유지, -1이면 삭제
    let cleanExclude = getPlannedExcludeMinutesForDate(dateStr);
    if (excludeMinutes != null) {
        const n = Math.round(Number(excludeMinutes));
        cleanExclude = (Number.isFinite(n) && n >= 0) ? n : null;
    }

    try {
        const payload = {
            plannedQuantities: clean,
            plannedTimeTasks: cleanTime,
            updatedAt: getCurrentTime(),
            updatedBy: State.appState?.currentUser || 'unknown'
        };
        if (cleanExclude != null) payload.plannedExcludeMinutes = cleanExclude;
        // 문서를 통째로 바꾸므로, 따로 저장해 둔 계획 스냅샷은 그대로 옮겨 싣는다.
        // ⚠️ 로컬 캐시(10분 TTL)만 보면 안 된다 — 다른 PC·탭이 그 사이 찍은 스냅샷이
        //    캐시에 없어서 이 저장으로 조용히 사라진다. 자동 스냅샷이 매일 생기므로
        //    예전(수동 확정일만)보다 사고 확률이 훨씬 높다. 서버에서 한 번 더 읽는다.
        let keepSnapshot = getForecastSnapshotForDate(dateStr);
        try {
            const 서버 = await getDocFromServer(doc(plannedColRef(), dateStr));
            const d = 서버.exists() ? (서버.data() || {}) : {};
            if (d.forecastSnapshot) keepSnapshot = d.forecastSnapshot;
            // 이 저장이 넘기지 않은 항목도 같은 이유로 서버 값이 더 최신일 수 있다.
            // (A PC 가 시간형 계획을 저장한 직후 B PC 가 물량만 저장하면, B 의 10분 캐시에
            //  그 시간형이 없어서 문서 교체로 사라진다 — 스냅샷과 완전히 같은 유형의 사고)
            // 서버 문서를 읽었다면 그게 정본이다 — 키가 **없는 것**도 '비어 있음'으로 본다.
            // (키가 있을 때만 반영하면, 다른 PC 가 방금 지운 값이 내 10분 캐시에서 되살아난다)
            if (서버.exists()) {
                if (timeTasks == null) cleanTime = 시간형_정리(d.plannedTimeTasks);
                if (excludeMinutes == null) {
                    const ex = Number(d.plannedExcludeMinutes);
                    cleanExclude = Number.isFinite(ex) && ex >= 0 ? Math.round(ex) : null;
                }
            }
        } catch (e) {
            // 서버를 못 읽었으면 캐시값으로 간다(없는 것보다 낫다)
            console.warn('예정 물량 서버 확인 실패, 캐시값 사용:', e);
        }
        if (keepSnapshot) payload.forecastSnapshot = keepSnapshot;
        await setDoc(doc(plannedColRef(), dateStr), payload);

        const rec = { id: dateStr, plannedQuantities: clean, plannedTimeTasks: cleanTime };
        if (cleanExclude != null) rec.plannedExcludeMinutes = cleanExclude;
        if (keepSnapshot) rec.forecastSnapshot = keepSnapshot;
        const idx = (State.plannedData || []).findIndex(d => d.id === dateStr);
        if (idx > -1) State.plannedData[idx] = rec;
        else { State.plannedData.push(rec); State.plannedData.sort((a, b) => a.id.localeCompare(b.id)); }

        try {
            localStorage.setItem(PLANNED_CACHE_KEY, JSON.stringify(State.plannedData));
            localStorage.setItem(PLANNED_CACHE_TIME_KEY, Date.now().toString());
        } catch (_) {}

        showToast(`${dateStr} 예정 물량이 저장되었습니다.`);
        return true;
    } catch (e) {
        console.error('savePlannedQuantities failed:', e);
        showToast('예정 물량 저장 실패: ' + (e.message || e), true);
        return false;
    }
}

export const getWorkRecordsCollectionRef = () => {
    const today = getTodayDateString();
    return collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
};

export const getDailyDocRef = () => {
    return doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
};

export const syncTodayToHistory = async () => {
    const todayKey = getTodayDateString();
    const now = getCurrentTime();

    try {
        const liveWorkRecords = (State.appState.workRecords || []).map(record => {
            const data = { ...record };
            if (data.status === 'ongoing' || data.status === 'paused') {
                data.duration = calcElapsedMinutes(data.startTime, now, data.pauses);
                data.endTime = now;
            }
            return data;
        });

        const idx = State.allHistoryData.findIndex(d => d.id === todayKey);
        const existingHistory = idx > -1 ? State.allHistoryData[idx] : null;

        const isLiveEmpty = liveWorkRecords.length === 0;
        const isLiveQtyEmpty = !State.appState.taskQuantities || Object.keys(State.appState.taskQuantities).length === 0;
        const hasHistoryData = existingHistory && existingHistory.workRecords && existingHistory.workRecords.length > 0;

        let finalWorkRecords = liveWorkRecords;
        let finalQuantities = State.appState.taskQuantities || {};

        if (isLiveEmpty && isLiveQtyEmpty && hasHistoryData) {
            finalWorkRecords = existingHistory.workRecords;
            finalQuantities = existingHistory.taskQuantities || {};
        }

        const liveTodayData = {
            id: todayKey,
            workRecords: finalWorkRecords,
            taskQuantities: finalQuantities,
            // 라이브가 비어 있을 때 이력의 확인 표시를 지우지 않는다.
            confirmedZeroTasks: (State.appState.confirmedZeroTasks?.length
                ? State.appState.confirmedZeroTasks : (existingHistory?.confirmedZeroTasks || [])),
            onLeaveMembers: State.appState.dailyOnLeaveMembers || (existingHistory?.onLeaveMembers || []),
            partTimers: State.appState.partTimers || (existingHistory?.partTimers || []),
            dailyAttendance: State.appState.dailyAttendance || (existingHistory?.dailyAttendance || {}),
            // ⚠️ 통째로 고르면(||) 라이브 쪽이 환율만 든 부분 객체일 때 저장된 매출·재고가 사라진다.
            //    반드시 합쳐야 한다(라이브 값이 우선).
            management: { ...(existingHistory?.management || {}), ...(State.appState.management || {}) },
            inspectionList: State.appState.inspectionList || (existingHistory?.inspectionList || []),
            isQuantityVerified: State.appState.isQuantityVerified || (existingHistory?.isQuantityVerified || false)
        };

        if (idx > -1) {
            State.allHistoryData[idx] = liveTodayData;
        } else {
            State.allHistoryData.unshift(liveTodayData);
            State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
        }
    } catch (e) {
        console.error("Error syncing today to history cache: ", e);
    }
};

// isFinalize=true 이면 "마감/자동마감" 확정 저장으로 간주하고,
// 기록 수가 줄었을 때 저장을 건너뛰는 방어 로직을 우회한다.
// (0분 기록 삭제·중복 정리로 건수가 줄어드는 것이 정상인데, 그 때문에 최종 근무시간이
//  history에 반영되지 않고 유실되던 문제가 있었다.)
// 반환값: 'saved'(저장함) | 'nothing'(저장할 게 없음) | 'failed'(서버를 못 읽었거나 예외)
//   · 'nothing' 은 실패가 아니다 — 화면에 오류로 띄우면 안 된다.
//   · 다만 마감 안전망 입장엔 '아직 못 끝냄'이라 'saved' 일 때만 완료로 찍어야 한다.
/** 그 날짜가 **서버 기준으로** 마감됐는지. 'closed' | 'open' | 'unknown'
 *
 *  왜 서버인가 — 메모리 캐시(State.allHistoryData)는 탭을 켠 시점에 얼어붙어 있어
 *  다른 PC·봇이 마감한 것을 모른다. 마감 여부를 캐시로 판단하면 보호가 통째로 헛돈다.
 *  왜 'unknown' 을 따로 두는가 — 못 읽은 것을 'open' 으로 보면, 네트워크가 흔들리는
 *  순간에 마감된 날을 덮어쓰게 된다. 호출자는 unknown 이면 아무것도 하지 않아야 한다.
 */
export async function isDayClosedOnServer(dateKey) {
    if (!State.db || !dateKey) return 'unknown';
    try {
        const snap = await getDocFromServer(
            doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey));
        return (snap.exists() && snap.data()?.closedAt) ? 'closed' : 'open';
    } catch (e) {
        console.warn('[isDayClosedOnServer] 읽기 실패:', e);
        return 'unknown';
    }
}

export async function saveProgress(isAutoSave = false, isQuantityVerified = false,
        { isFinalize = false, overrideRecords = null } = {}) {
    const dateStr = getTodayDateString();
    const now = getCurrentTime();

    if (!isAutoSave) {
        showToast('서버의 최신 상태를 이력에 저장합니다...');
    }

    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateStr);

    try {
        const dailyData = {
            taskQuantities: State.appState.taskQuantities || {},
            confirmedZeroTasks: State.appState.confirmedZeroTasks || [],
            onLeaveMembers: State.appState.dailyOnLeaveMembers || [],
            partTimers: State.appState.partTimers || [],
            dailyAttendance: State.appState.dailyAttendance || {},
            // 라이브 management 가 일부 필드만 들고 있을 수 있으므로 이미 저장된 값 위에 얹는다.
            // 베이스는 아래에서 읽는 serverHistory.management 로 교체된다(메모리 캐시는 얼어붙어 있어,
            // 그걸 베이스로 쓰면 내 탭이 켜진 뒤 남이 고친 매출·재고가 옛 값으로 되돌아간다).
            management: { ...(State.appState.management || {}) },
            inspectionList: State.appState.inspectionList || [],
            isQuantityVerified: State.appState.isQuantityVerified || false
        };

        // 업무기록은 '서버 원본'에서 읽는다.
        //
        // 예전엔 라이브 미러(State.appState.workRecords)를 그대로 이력 배열에 썼다.
        // Firestore merge 는 배열을 합치지 않고 통째로 바꾸므로, 오프라인·절전 복귀·스냅샷 지연으로
        // 미러가 뒤처진 탭이 저장하면 그 사이 남이 추가한 기록이 이력에서 사라졌다.
        // overrideRecords(마감 시 이미 서버에서 읽어 온 확정 기록)가 있으면 그걸 신뢰한다.
        let sourceRecords;
        if (Array.isArray(overrideRecords)) {
            sourceRecords = overrideRecords;
        } else {
            try {
                // ⚠️ getDocs 가 아니라 getDocsFromServer 여야 한다.
                //    getDocs 는 서버에 못 닿으면 throw 하지 않고 로컬 캐시로 조용히 성공한다.
                //    이 컬렉션엔 onSnapshot 리스너가 붙어 있어 그 캐시 내용이 곧 라이브 미러와 같다 —
                //    즉 getDocs 를 쓰면 "미러로 폴백하지 않는다"는 의도가 그대로 무너진다.
                const wrSnap = await getDocsFromServer(
                    collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', dateStr, 'workRecords')
                );
                sourceRecords = [];
                wrSnap.forEach(d => sourceRecords.push({ id: d.id, ...d.data() }));
            } catch (e) {
                // 못 읽었으면 미러로 대신하지 않는다. 그게 바로 유실 경로다.
                console.warn('[saveProgress] 서버 기록을 읽지 못해 저장하지 않습니다.', e);
                if (!isAutoSave) showToast('서버에서 기록을 읽지 못해 저장하지 않았습니다. 연결을 확인한 뒤 다시 시도하세요.', true);
                return 'failed';
            }
        }
        const liveWorkRecords = sourceRecords.map(record => {
            const data = { ...record };
            if (data.status === 'ongoing' || data.status === 'paused') {
                data.duration = calcElapsedMinutes(data.startTime, now, data.pauses);
                data.endTime = now;
                if (data.duration > 1200) data.status = 'completed';
            }
            return data;
        }).filter(record => {
            if (record.status !== 'completed') return true;
            return Math.round(record.duration || 0) > 0;
        });

        // 이력의 현재 기록 수도 서버에서 확인한다.
        // 메모리 캐시(State.allHistoryData)는 탭을 켠 시점에 얼어붙어 있어 남의 변경을 모른다.
        let serverHistory = {};
        try {
            // 여기도 getDoc 이 아니라 getDocFromServer — 캐시로 조용히 성공하면 의미가 없다.
            const hSnap = await getDocFromServer(historyDocRef);
            if (hSnap.exists()) serverHistory = hSnap.data() || {};
        } catch (e) {
            console.warn('[saveProgress] 이력을 읽지 못해 저장하지 않습니다.', e);
            if (!isAutoSave) showToast('서버에서 이력을 읽지 못해 저장하지 않았습니다. 연결을 확인한 뒤 다시 시도하세요.', true);
            return 'failed';
        }
        const existingRecordsCount = (serverHistory.workRecords || []).length;

        // management 베이스를 서버 값으로 교체 (위 주석 참조)
        dailyData.management = { ...(serverHistory.management || {}), ...(State.appState.management || {}) };

        // 살아있는 기록이 0건인데 이력엔 있으면 '업무기록만' 손대지 않는다.
        //
        // ⚠️ 예전엔 isFinalize(마감 확정)면 이 방어를 통째로 우회했다. 그 탓에
        //    탭을 켜 둔 채 자정을 넘긴 탭의 17:35 안전망이 '어제 기록'으로 오늘 이력을
        //    덮어 그날 기록이 통째로 사라지는 경로가 열려 있었다.
        //    isFinalize 의 원래 목적은 '0분 기록 정리로 건수가 줄어드는 것'을 허용하는 것이지
        //    0건으로 만드는 게 아니므로, 0건일 때는 마감이어도 기록을 덮지 않는다.
        //
        // 다만 저장 자체를 중단하면 같은 payload 에 실린 물량·검수·검증여부까지 함께 날아간다
        // (0분 기록을 전부 지우고 물량만 입력한 날의 마감이 그 경우다).
        // 그래서 '중단'이 아니라 'workRecords 키만 빼기'로 처리한다 — merge 라 서버 배열이 보존된다.
        const keepServerRecords = existingRecordsCount > 0 && liveWorkRecords.length === 0;
        if (keepServerRecords) {
            console.warn(`[saveProgress] ${dateStr}: 살아있는 기록 0건, 이력 ${existingRecordsCount}건 — 업무기록은 건드리지 않고 나머지만 저장합니다.`);
        }

        // 🔒 이미 마감된 날은 **배열을 교체하지 않는다.**
        //
        // 실제 사고 (2026-10-01)
        //   17:30 에 마감(슬랙 봇)이 정상적으로 끝나 이력에 53건이 저장됐다.
        //   그런데 22:12 에, 마감 전 상태를 메모리에 들고 있던 세션이 저장을 돌렸다.
        //   그 세션의 기준으로 통째로 교체되어 **7건이 사라지고**, 진행 중으로 남아 있던
        //   기록 3건이 17:25 대신 22:12 로 종료돼 **근무시간이 27시간 부풀었다**
        //   (이미 15:24 에 끝난 기록이 다시 열려 22:12 로 종료되기까지 했다).
        //   위의 keepServerRecords 는 '살아있는 기록 0건' 일 때만 지켜서 막지 못했다.
        //
        //   봇이 원격으로 마감하게 되면서 '마감된 뒤에도 열려 있는 세션' 이 흔해졌다.
        //   예전에는 마감을 누른 사람이 그 PC 앞에 있었기 때문에 잘 드러나지 않았다.
        //
        // 왜 '쓰기 금지' 가 아니라 '덧붙이기' 인가
        //   마감 뒤에 실제로 더 일한 기록은 이력에 들어가야 한다. 통째로 막으면 그게 사라진다.
        //   그래서 서버에 **없는 id 만** 덧붙이고, 서버에 이미 있는 기록은 그대로 둔다.
        //   (이미 있는 기록을 고치는 일은 이력 편집 기능이 따로 담당한다)
        //
        // isFinalize 는 예외다 — 마감 자체가 다시 돌아야 하는 경우가 있고,
        // 그 경로는 사람이 확인창을 거친다.
        // ⚠️ 어떤 경로도 이 보호를 뚫지 못한다.
        //    예전엔 isFinalize 면 통과였는데, eodFlushToHistory(30분마다 자정까지 재시도)와
        //    자동마감이 isFinalize:true 로 부르기 때문에 사람 손을 안 거치는 경로가 그대로
        //    마감된 날을 덮어썼다. '마감 경로에만 예외를 준다' 도 두 가지 이유로 버렸다 —
        //    (1) 첫 마감은 closedAt 이 아직 없어서 예외가 필요 없다(closedAt 은 초기화 성공
        //        뒤에 찍힌다), (2) 예외를 두면 삭제 확인창을 띄워 둔 사이에 다른 PC·봇이
        //        마감을 끝내는 창이 열려, 막으려던 사고가 그대로 재현된다.
        //    이미 마감된 날을 고쳐야 하면 이력 편집으로 한다(버튼 한 번으로 덮지 않는다).
        const isClosedDay = !!serverHistory.closedAt;
        let appendOnlyRecords = null;
        if (isClosedDay && !keepServerRecords) {
            const serverRecords = serverHistory.workRecords || [];
            const serverIds = new Set(serverRecords.map(r => r && r.id).filter(Boolean));
            // 진행 중 기록은 덧붙이지 않는다. endTime 이 '저장한 시각' 으로 박히고,
            // 그 뒤에는 '이미 있는 id' 라 영원히 갱신되지 않아 거짓 시간이 굳는다.
            const appendable = liveWorkRecords.filter(r => r && r.status === 'completed');
            const noId = appendable.filter(r => !r.id).length;
            const newRecords = appendable.filter(r => r.id && !serverIds.has(r.id));
            appendOnlyRecords = newRecords.length > 0 ? [...serverRecords, ...newRecords] : null;
            console.warn(`[saveProgress] ${dateStr}: 이미 마감된 날(closedAt=${serverHistory.closedAt})`
                + ` — 이력 ${serverRecords.length}건을 교체하지 않습니다.`
                + (newRecords.length > 0 ? ` 완료된 새 기록 ${newRecords.length}건만 덧붙입니다.` : ' 덧붙일 새 기록이 없습니다.')
                + (noId > 0 ? ` ⚠️ id 가 없어 건너뛴 기록 ${noId}건.` : ''));
        }
        const omitRecordsKey = keepServerRecords || (isClosedDay && appendOnlyRecords === null);

        if (liveWorkRecords.length === 0 &&
            Object.keys(dailyData.taskQuantities).length === 0 &&
            (!dailyData.inspectionList || dailyData.inspectionList.length === 0)) {
             // 저장할 것이 아무것도 없는 상태. 실패가 아니지만 저장도 아니다 —
             // 마감 안전망은 재시도해야 하고, 화면은 오류로 안내하면 안 되어 따로 구분한다.
             return 'nothing';
        }

        // 마감된 날에는 서버 값이 이긴다. 마감이 확정한 퇴근시각을, 그 전 상태를 들고 있던
        // 세션이 지우거나 되살리지 못하게 한다(마감 후 재출근이 되살아난 과거 사고와 같은 종류다).
        // 마감된 날: 서버에 이미 있는 사람의 근태는 **그대로 지키고**, 마감 뒤에 새로 생긴
        // 사람만 더한다. 키를 통째로 빼려고 했다가 되돌렸다 — 이력의 근태를 고치는 UI 가
        // 저장소에 존재하지 않아서(listeners-history-attendance.js 는 onLeaveMembers 만 다룬다),
        // 키를 빼면 마감 뒤 퇴근시각이 틀렸을 때 사용자가 고칠 방법이 0개가 된다.
        const liveAttendance = { ...dailyData.dailyAttendance, ...State.appState.dailyAttendance };
        const mergedAttendance = isClosedDay
            ? { ...liveAttendance, ...(serverHistory.dailyAttendance || {}) }
            : liveAttendance;

        // 🛡️ 마감된 날에는 '이력에 있는 값을 후퇴시키지 않는다'.
        //    마감이 daily_data 의 물량·검증여부를 초기화하기 때문에, 마감 뒤에 열린 세션이
        //    저장을 돌리면 빈 값이 이력을 덮어 그날 물량이 통째로 사라진다.
        //    recoverDailyDataToHistory 가 쓰는 것과 같은 규칙이다(중복 구현을 피해 같은 모양으로 둔다).
        //    dailyAttendance 는 아예 **키를 뺀다** — 마감이 확정한 퇴근시각은 이력 편집으로만
        //    고친다(.claude/skills/attendance-check 1번 규칙과 같은 방향).
        const emptyObj_ = (v) => !v || Object.keys(v).length === 0;
        const emptyArr_ = (v) => !Array.isArray(v) || v.length === 0;
        const keepClosed = (live, hist, isEmpty) => (!isClosedDay || !isEmpty(live))
            ? live
            : (hist !== undefined && hist !== null ? hist : live);

        const historyData = {
            id: dateStr,
            ...(omitRecordsKey ? {} : { workRecords: appendOnlyRecords || liveWorkRecords }),
            taskQuantities: keepClosed(dailyData.taskQuantities, serverHistory.taskQuantities, emptyObj_),
            confirmedZeroTasks: keepClosed(dailyData.confirmedZeroTasks, serverHistory.confirmedZeroTasks, emptyArr_),
            onLeaveMembers: keepClosed(dailyData.onLeaveMembers, serverHistory.onLeaveMembers, emptyArr_),
            partTimers: keepClosed(dailyData.partTimers, serverHistory.partTimers, emptyArr_),
            dailyAttendance: mergedAttendance,
            management: dailyData.management,
            inspectionList: keepClosed(dailyData.inspectionList, serverHistory.inspectionList, emptyArr_),
            // 서버값을 항상 OR 에 넣는다 — 검증을 찍은 뒤 다른 탭이 저장하면 false 로 후퇴했다.
            isQuantityVerified: !!(isQuantityVerified || State.appState.isQuantityVerified
                || serverHistory.isQuantityVerified),
            savedAt: now
        };

        await setDoc(historyDocRef, historyData, { merge: true });
        
        if (isQuantityVerified) {
            await setDoc(getDailyDocRef(), { isQuantityVerified: true }, { merge: true });
        }

        // ⚠️ 순서 주의 — syncTodayToHistory 가 먼저다.
        //    이 함수는 메모리의 오늘 행을 '라이브 미러' 기준으로 통째 교체한다.
        //    memPatch 뒤에 두면 방금 서버 기준으로 맞춘 값이 뒤처진 미러로 되돌아가,
        //    메모리만 0건(또는 옛 건수)으로 남고 그 배열이 다른 함수를 통해 서버로 되쓰인다.
        if (!overrideRecords) await syncTodayToHistory();

        // 메모리 이력을 '방금 서버에 저장한 값'으로 최종 확정한다.
        // (overrideRecords로 저장한 경우 라이브 미러가 아직 비어 있을 수 있어,
        //  syncTodayToHistory만 호출하면 화면이 옛 값을 계속 보여준다)
        // 기록을 안 건드린 경우엔 메모리에도 '서버의 실제 기록'을 넣는다.
        // ⚠️ 서버에 실제로 남은 배열과 반드시 같아야 한다. 어긋나면 addHistoryWorkRecord·
        //    updateHistoryDirectly·deleteHistoryWorkRecord 가 '메모리 배열을 통째로' 서버에
        //    쓰면서 방금 지킨 기록을 날린다(바로 위 주석의 사고가 그 경로다).
        const memRecords = omitRecordsKey
            ? (serverHistory.workRecords || [])
            : (appendOnlyRecords || liveWorkRecords);
        const memPatch = { ...historyData, workRecords: memRecords };

        const memIdx = State.allHistoryData.findIndex(d => d.id === dateStr);
        if (memIdx > -1) State.allHistoryData[memIdx] = { ...State.allHistoryData[memIdx], ...memPatch };
        else {
            State.allHistoryData.push({ ...memPatch });
            State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
        }

        clearLocalCache(); // ✨ 데이터 변경 시 캐시 지우기

        // 계측용 — 무엇을 어디서 읽어 몇 건 저장했는지 남긴다.
        // 이력이 또 사라졌다는 신고가 오면 이 줄로 출처를 좁힌다.
        console.info('[saveProgress]', {
            date: dateStr,
            source: overrideRecords ? 'override(마감 확정)' : 'server(daily_data)',
            saved: liveWorkRecords.length,
            existingBefore: existingRecordsCount,
            isFinalize, isAutoSave
        });

        if (!isAutoSave) {
            showToast('최신 상태가 이력에 안전하게 저장되었습니다.');
        }
        return 'saved';

    } catch (e) {
        console.error('Error in saveProgress: ', e);
        if (!isAutoSave) showToast(`저장 중 오류가 발생했습니다: ${e.message}`, true);
        return 'failed';
    }
}

// 마감 기준시각 형식. 0채움 HH:MM 만 받는다.
// 이 값은 아래에서 record.startTime 과 **문자열로** 비교되므로('9:30' > '17:30' 이 true),
// 0채움이 아닌 값이 들어오면 엉뚱한 기록이 0분 처리돼 삭제된다.
const END_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * 🔍 마감을 그 시각에 누르면 무엇이 어떻게 되는지 미리 계산한다. (아무것도 쓰지 않는다)
 *
 * 아래 saveDayDataToHistory 의 규칙과 **반드시 같아야 한다.** 한쪽만 고치면
 * 사용자는 화면에서 본 것과 다른 결과를 확정하게 되고, 마감은 되돌릴 수 없다.
 *
 * @returns {{closed:number, closedMinutes:number, deleted:number, deletedCompleted:number,
 *            kept:number, clamped:number, lateStart:number, invalid:number, outTimeFixed:number}}
 */
export function previewDayClose(records, dailyAttendance, endTime) {
    const att = {};
    Object.entries(dailyAttendance || {}).forEach(([k, v]) => {
        if (v && typeof v === 'object') att[k] = { ...v };
    });

    let outTimeFixed = 0;
    Object.keys(att).forEach(m => {
        if (att[m].status === 'active') {
            att[m].status = 'returned';
            att[m].outTime = endTime;
            outTimeFixed++;
        }
    });

    // 마감시각이 출근시각보다 이른 사람 — 그대로 두면 outTime < inTime 이 되고
    // attendance-stats 가 그 사람을 재실시간 집계에서 통째로 뺀다. 마감 자체를 막는다.
    const outTimeBeforeIn = Object.values(dailyAttendance || {}).filter(
        v => v && typeof v === 'object' && v.status === 'active' && v.inTime && endTime < v.inTime).length;

    const out = { closed: 0, closedMinutes: 0, deleted: 0, deletedCompleted: 0,
                  kept: 0, clamped: 0, lateStart: 0, invalid: 0, outTimeFixed, outTimeBeforeIn };

    (records || []).forEach(record => {
        const start = record.startTime;
        if (!END_TIME_RE.test(String(start || '')) || !END_TIME_RE.test(String(endTime || ''))) {
            out.invalid++;
            return;
        }
        const isOpen = record.status === 'ongoing' || record.status === 'paused';

        let recordEndTime = endTime;
        let late = false, clamp = false;
        const a = att[record.member];
        if (a && a.status === 'returned' && a.outTime) {
            if (a.outTime > start) recordEndTime = (a.outTime <= endTime) ? a.outTime : endTime;
        }
        if (start > recordEndTime) { recordEndTime = start; late = true; }
        else if (recordEndTime !== endTime) clamp = true;

        // ⓘ 이미 completed 인 기록은 아래에서 다시 계산하지 않는다(= 잘리지 않는다).
        //    그래서 '늦게 시작'·'조퇴 클램프' 도 열린 기록에만 센다.
        if (isOpen && late) out.lateStart++;
        if (isOpen && clamp) out.clamped++;

        let duration;
        if (isOpen) {
            const pauses = (record.pauses || []).map(p => ({ ...p }));
            if (record.status === 'paused' && pauses.length > 0) {
                const lp = pauses[pauses.length - 1];
                if (lp && !lp.end) lp.end = recordEndTime;
            }
            duration = calcElapsedMinutes(start, recordEndTime, pauses);
        } else {
            duration = Number(record.duration) || 0;
        }

        if (Math.round(duration) <= 0) {
            out.deleted++;
            if (!isOpen) out.deletedCompleted++;
        } else if (isOpen) {
            out.closed++;
            out.closedMinutes += duration;
        } else {
            out.kept++;
        }
    });
    return out;
}

/**
 * 🏁 하루 마감. 되돌릴 수 없다.
 *
 * @param {boolean} shouldReset      이력 저장 후 오늘 원본을 초기화할지
 * @param {string|null} endTimeOverride 마감 기준시각 'HH:MM'. 없으면 현재시각.
 *
 * ⚠️ endTimeOverride 가 왜 필요한가 — 이 값이 아직 퇴근을 찍지 않은 사람 **전원의
 *    퇴근시각**이 된다. 21시에 버튼을 누르면 전원이 21시 퇴근으로 확정된다.
 *    늦게 누르는 날에도 실제 종료시각으로 마감할 수 있어야 한다.
 */
export async function saveDayDataToHistory(shouldReset, endTimeOverride = null, opts = {}) {
    const { closedVia = '앱', confirmDestructive = null } = opts;
    const workRecordsColRef = getWorkRecordsCollectionRef();

    // 🔒 관리자만. 버튼을 숨기는 것(app.js)은 화면일 뿐이라 콘솔에서 그대로 부를 수 있다.
    //    이 한 번이 전 직원 퇴근시각을 확정하고 그날 원본을 지운다.
    //    (Firestore 규칙은 daily_data/history 쓰기를 전원에게 허용하므로 여기가 유일한 문지기다)
    if (State.appState?.currentUserRole && State.appState.currentUserRole !== 'admin') {
        showToast('업무 마감은 관리자만 할 수 있습니다.', true);
        return false;
    }

    // 형식이 틀린 값을 조용히 현재시각으로 바꾸지 않는다.
    // 그러면 사용자는 17:30 으로 마감했다고 믿고 실제로는 21:00 이 확정된다.
    if (endTimeOverride != null && !END_TIME_RE.test(String(endTimeOverride))) {
        showToast('마감 시각 형식이 올바르지 않습니다 (예: 17:30). 마감하지 않았습니다.', true);
        return false;
    }
    const globalEndTime = endTimeOverride || getCurrentTime();
    // ⚠️ 날짜를 **한 번만** 잡는다. 아래에서 getTodayDateString() 을 다시 부르면,
    //    23:59 에 시작한 마감이 서버 읽기·확인창으로 자정을 넘길 때 삭제는 전날 컬렉션인데
    //    초기화와 closedAt 은 새 날짜 문서에 찍힌다(전날은 영구 미마감 + 새 날짜에 유령 마감).
    const closeDateStr = getTodayDateString();
    // 마감이 실제로 읽어 이력에 확정한 원본 문서 id. 초기화는 이 집합만 지운다 —
    // 읽은 뒤 다른 PC 가 추가한 기록까지 지우면 이력에도 없고 원본에도 없게 된다
    // (마감된 날은 append-only 라 나중에 되살릴 경로도 없다).
    let finalizedDocIds = [];
    // 재마감을 확인창으로 막으려 했다가 되돌렸다. 슬랙 봇이 이 화면을 playwright 로
    // 조작하는데, playwright 는 네이티브 confirm 을 **자동으로 거부**한다 — 봇 마감이
    // 조용히 '불확실' 로 끝난다. 그래서 묻지 않고, '마감된 날은 어떤 경로로도 이력을
    // 교체하지 않는다' 를 saveProgress 안에서 코드로 보장한다.
    const finalizedRecords = []; // 마감 확정된 기록(이력 저장의 신뢰 원본)

    try {
        const dailyDocRef = getDailyDocRef();
        // 🛡️ 서버 강제 읽기. getDoc/getDocs 는 서버에 못 닿으면 throw 하지 않고 로컬 캐시로
        //    조용히 성공한다(이 컬렉션엔 onSnapshot 이 붙어 있어 캐시가 곧 라이브 미러다).
        //    마감은 이 읽기 결과를 '그날의 전부' 로 보고 확정·삭제하므로, 캐시로 읽으면
        //    남의 PC 가 올린 기록을 보지 못한 채 원본을 지운다.
        const dailyDocSnap = await getDocFromServer(dailyDocRef);
        const dailyData = dailyDocSnap.exists() ? dailyDocSnap.data() : {};

        const dailyAttendance = { ...dailyData.dailyAttendance, ...State.appState.dailyAttendance };
        const querySnapshot = await getDocsFromServer(workRecordsColRef);
        // 삭제는 '지금 읽어서 이력에 확정한' 문서만 대상으로 한다(아래 초기화 단계).
        finalizedDocIds = querySnapshot.docs.map(d => d.id);

        // 🛑 시작시각이 HH:MM 이 아닌 기록이 있으면 아예 마감하지 않는다.
        //    아래 비교는 전부 **문자열 비교**라('9:30' > '17:30' 이 true) 그런 기록은
        //    recordEndTime 이 '9:30' 이 되고, Date 파싱이 Invalid 라 duration 이 NaN 이 된다.
        //    NaN 은 `Math.round(NaN) <= 0` 이 false 라 삭제되지도 않고 그대로 저장된다.
        const badStart = [];
        querySnapshot.forEach(d => {
            const st = d.data()?.startTime;
            if (!END_TIME_RE.test(String(st || ''))) badStart.push(`${d.data()?.member || '?'}(${st || '없음'})`);
        });
        if (badStart.length > 0) {
            showToast(`시작시각이 이상한 기록 ${badStart.length}건이 있어 마감하지 않았습니다: `
                + badStart.slice(0, 3).join(', ') + (badStart.length > 3 ? ' 외' : '')
                + ' — 기록을 수정한 뒤 다시 마감해 주세요.', true);
            return false;
        }

        // 🛑 마감 기준시각이 누군가의 출근시각보다 이르면 마감하지 않는다.
        //    그대로 두면 outTime < inTime 이 되고, attendance-stats 는 그런 사람을
        //    재실시간 집계에서 통째로 빼 버린다(그 사람 하루가 사라진다).
        const beforeIn = Object.entries(dailyAttendance)
            .filter(([, a]) => a && typeof a === 'object' && a.status === 'active'
                               && a.inTime && globalEndTime < a.inTime)
            .map(([m, a]) => `${m}(출근 ${a.inTime})`);
        if (beforeIn.length > 0) {
            showToast(`마감 시각(${globalEndTime})이 출근시각보다 이른 분이 있어 마감하지 않았습니다: `
                + beforeIn.slice(0, 3).join(', ') + (beforeIn.length > 3 ? ' 외' : ''), true);
            return false;
        }

        // 🛑 되돌릴 수 없는 삭제는 **서버에서 읽은 기록**으로 다시 세어 확인받는다.
        //    확인창의 미리보기는 라이브 미러(State.appState.workRecords)로 그린 것이라,
        //    미러가 뒤처져 있으면 "6건 삭제" 라고 승인받고 실제로는 8건이 지워질 수 있다.
        //    승인받은 숫자와 실제 지워지는 숫자는 같아야 한다.
        if (typeof confirmDestructive === 'function') {
            const serverRecords = [];
            querySnapshot.forEach(d => serverRecords.push({ id: d.id, ...d.data() }));
            const pv = previewDayClose(serverRecords, dailyAttendance, globalEndTime);
            if (pv.deleted > 0) {
                const okToGo = await confirmDestructive(pv, globalEndTime);
                if (!okToGo) return false;
            }
        }

        let attendanceUpdated = false;
        Object.keys(dailyAttendance).forEach(member => {
            const a = dailyAttendance[member];
            if (a && typeof a === 'object' && a.status === 'active') {
                a.status = 'returned';
                a.outTime = globalEndTime;
                attendanceUpdated = true;
            }
        });

        if (attendanceUpdated) {
            // updateDoc 은 문서가 없으면 throw 한다(필드를 한 번도 안 쓴 날).
            // 예전엔 그 예외를 catch 가 삼키고 그대로 saveProgress 로 넘어가,
            // 지정한 마감시각이 조용히 '지금 시각'으로 바뀐 채 확정됐다.
            await setDoc(dailyDocRef, { dailyAttendance }, { merge: true });
            State.appState.dailyAttendance = dailyAttendance;
        }

        if (!querySnapshot.empty) {
            const batch = writeBatch(State.db);
            let removedCount = 0;

            querySnapshot.forEach(docSnap => {
                const record = { id: docSnap.id, ...docSnap.data() };
                // 레거시 데이터에 문자열 duration 이 섞여 있으면 이력 합계가 문자열 연결로 깨진다.
                let duration = Number(record.duration) || 0;
                let pauses = record.pauses || [];
                let needsUpdate = false;
                
                let recordEndTime = globalEndTime;
                const attendance = dailyAttendance[record.member];
                
                if (attendance && attendance.status === 'returned' && attendance.outTime) {
                    if (attendance.outTime > record.startTime) {
                        recordEndTime = (attendance.outTime <= globalEndTime) ? attendance.outTime : globalEndTime;
                    } else {
                        recordEndTime = globalEndTime;
                    }
                }

                if (record.startTime > recordEndTime) recordEndTime = record.startTime;

                if (record.status === 'ongoing' || record.status === 'paused') {
                    if (record.status === 'paused') {
                        const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                        // `=== null` 이 아니라 `!end` 로 본다.
                        // end 키가 아예 없는 휴식(undefined)은 `=== null` 을 통과하지 못해
                        // 닫히지 않았고, calcElapsedMinutes 는 끝이 없는 휴식을 무시하므로
                        // 그 휴식시간이 통째로 근무시간에 더해졌다.
                        // app-lifecycle.js 의 closeRecordsAt 은 원래 `!lp.end` 를 쓴다 —
                        // 같은 마감인데 경로마다 값이 달랐다.
                        // 휴식 시작보다 이른 시각으로 닫으면(조퇴 클램프와 겹칠 때)
                        // end < start 인 구간이 되어 calcElapsedMinutes 가 통째로 무시한다
                        // → 휴식이 차감되지 않은 값이 저장된다.
                        if (lastPause && !lastPause.end) {
                            lastPause.end = (recordEndTime > lastPause.start) ? recordEndTime : lastPause.start;
                        }
                    }
                    duration = calcElapsedMinutes(record.startTime, recordEndTime, pauses);

                    needsUpdate = true;
                }

                if (!Number.isFinite(duration)) {
                    // 여기 오면 위의 시작시각 검사를 통과한 값으로도 계산이 깨진 것이다.
                    // NaN 을 저장하면 이력과 원본이 어긋난 채 남는다. 통째로 중단한다.
                    throw new Error(`계산 불가(${record.member}/${record.task}): duration=${duration}`);
                }

                if (Math.round(duration) <= 0) {
                    batch.delete(docSnap.ref);
                    removedCount++;
                } else if (needsUpdate) {
                    batch.update(docSnap.ref, {
                        status: 'completed',
                        endTime: recordEndTime,
                        duration: duration,
                        pauses: pauses
                    });
                    finalizedRecords.push({ ...record, status: 'completed', endTime: recordEndTime, duration, pauses });
                } else {
                    // 이미 완료된 기록도 이력에 그대로 포함시켜야 한다.
                    finalizedRecords.push({ ...record, duration, pauses });
                }
            });
            await batch.commit();
        }
    } catch (e) {
         console.error("Finalizing error: ", e);
         // ⚠️ 예전엔 여기서 예외를 삼키고 그대로 아래로 흘렀다. 그러면 finalizedRecords 가 비어
         //    saveProgress 가 overrideRecords 없이 돌고, 그 안의 getCurrentTime() 으로
         //    **지금 시각** 마감이 된다 — 지정한 시각은 사라지는데 아래에서 closeEndTime 에는
         //    지정값이 찍혀 '17:30 에 마감했다' 는 거짓 기록이 남았다.
         showToast('마감 처리 중 오류가 발생했습니다. 아무것도 저장하지 않았습니다. 다시 시도해 주세요.', true);
         return false;
    }

    // 🛡️ 라이브 미러(onSnapshot) 반영을 기다리지 않고, 방금 Firestore에서 읽어 확정한 기록을
    //    그대로 이력에 저장한다. (기존 500ms 대기 방식은 반영이 늦으면 근무시간이 통째로 누락됐다)
    // isAutoSave=true — 여기서는 saveProgress 자체 토스트를 끄고,
    // 성공은 아래 '초기화했습니다', 실패는 게이트 안내로 한 번만 알린다.
    const saveResult = await saveProgress(true, false, {
        isFinalize: true,
        overrideRecords: finalizedRecords.length > 0 ? finalizedRecords : null
    });

    // 🛡️ 이력 저장에 성공했을 때만 원본을 지운다.
    //    저장이 실패했는데 원본까지 지우면 그날 기록은 어디에도 남지 않는다(복구 불가).
    //    오프라인에서 특히 위험하다 — 삭제 쓰기는 로컬 큐에 쌓여 재연결 시 그대로 반영되는데,
    //    이력 쓰기는 애초에 일어나지 않았기 때문이다.
    // 'nothing'(이력에 넣을 것이 없음)은 막지 않는다.
    // 그때는 보존할 실데이터도 없어서, 막으면 0분 기록만 있던 날이
    // 몇 번을 눌러도 영우히 초기화되지 않는다. 유실 위험은 'failed' 에만 있다.
    if (shouldReset && saveResult === 'failed') {
        console.warn('[saveDayDataToHistory] 이력 저장 실패 — 원본을 지우지 않습니다.', { saveResult });
        showToast('이력 저장에 실패해 오늘 기록을 초기화하지 않았습니다. 연결을 확인한 뒤 다시 마감해 주세요.', true);
        return false;
    }

    if (shouldReset) {
        let cleared = false;
         try {
            // ⚠️ 다시 읽어서 '전부' 지우지 않는다. 마감 처리 중(확인창·배치·이력 저장)에
            //    다른 PC 가 완료한 기록이 들어올 수 있고, 그건 이력에 확정되지 않았다.
            //    읽은 집합만 지우면 그 기록은 원본에 남아 다음 마감·복구가 처리한다.
            // 배치 한 번에 500건 상한이 있다. 며칠 밀린 날을 한 번에 마감하면 넘을 수 있고,
            // 넘으면 commit 이 throw 해서 '초기화 실패' 로 떨어진다.
            for (let i = 0; i < finalizedDocIds.length; i += 400) {
                const deleteBatch = writeBatch(State.db);
                finalizedDocIds.slice(i, i + 400)
                    .forEach(id => deleteBatch.delete(doc(workRecordsColRef, id)));
                await deleteBatch.commit();
            }
            await setDoc(getDailyDocRef(), { taskQuantities: {}, confirmedZeroTasks: [], isQuantityVerified: false }, { merge: true });
            cleared = true;
        } catch (e) {
             console.error("Error clearing daily data: ", e);
        }

        // ⚠️ 이 확인은 **치명 구간 밖**이다. 경고를 남기기 위한 읽기일 뿐인데 위의 try 안에
        //    두면, 삭제·이력 저장이 다 끝난 뒤 이 읽기 하나가 실패해도 cleared 가 false 로
        //    남는다. 그러면 closedAt 을 못 찍고(아래), 그날은 '마감 안 된 날' 로 남아
        //    다른 탭의 안전망이 이력을 통째로 덮어쓴다 — 2026-10-01 사고가 그대로 재현된다.
        try {
            const 남은것 = await getDocsFromServer(workRecordsColRef);
            if (!남은것.empty) {
                console.warn(`[마감] 마감 처리 중 새로 들어온 기록 ${남은것.size}건은 지우지 않았습니다`
                    + ' — 다음 마감이나 복구가 이력에 반영합니다.');
            }
        } catch (e) {
            console.warn('[마감] 남은 기록 확인만 실패했습니다(마감 자체는 끝났습니다).', e);
        }

        // 🏁 '마감 완료' 표시. **초기화까지 성공한 뒤에만** 찍는다.
        //
        // 왜 별도 필드인가 — savedAt 은 '진행상황 저장'·17:30 자동마감·종료시각 안전망이
        // 모두 찍어서 마감 신호가 못 된다. history 문서 존재 여부도 마찬가지다
        // (eodFlushToHistory 는 이력만 저장하고 원본을 남긴다).
        // 그래서 "마감했는지" 를 밖에서 알 방법이 없었다 — 슬랙 알림 봇이 추측해야 했다.
        //
        // 왜 초기화 뒤인가 — 앞에서 찍으면 초기화가 실패한 날이 '마감됨' 으로 보여
        // 재시도 알림이 영영 안 온다.
        // 저장할 것이 아무것도 없던 날('nothing')에는 표시를 남기지 않는다.
        // 그러면 이력에 closedAt 만 있는 빈 문서가 새로 생겨 이력 목록에 유령 날짜가 낀다.
        if (cleared && saveResult !== 'nothing') {
            try {
                await setDoc(
                    doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', closeDateStr),
                    {
                        id: closeDateStr,
                        closedAt: new Date().toISOString(),
                        closeEndTime: globalEndTime,
                        closedBy: State.auth?.currentUser?.email || State.auth?.currentUser?.uid || '',
                        // 확인창이 기본값으로 현재시각을 채우므로 endTimeOverride 는 사실상 항상 들어온다.
                        // 그걸로 '시각지정/버튼' 을 나누면 늘 '시각지정' 이라 거짓말이 된다.
                        // 기준시각은 closeEndTime 에 그대로 있으니 여기는 경로만 남긴다.
                        closedVia: closedVia,
                    },
                    { merge: true }
                );
            } catch (e) {
                // 표시를 못 찍어도 마감 자체는 끝났다. 알림이 한 번 더 올 뿐이다.
                console.warn('[saveDayDataToHistory] 마감 표시(closedAt) 기록 실패:', e);
            }
        }

        // ⚠️ 초기화가 실패했는데 화면만 비우고 '초기화했습니다' 라고 하면,
        //    관리자는 마감이 끝난 줄 알고 퇴근하고 서버엔 기록이 그대로 남는다.
        if (!cleared) {
            showToast('오늘 기록 초기화에 실패했습니다. 이력은 저장됐으니 다시 마감해 주세요.', true);
            return false;
        }

        State.appState.workRecords = [];
        clearLocalCache();
        showToast('오늘의 업무 기록을 초기화했습니다.');
    }
    return true;
}

// 🛟 복구: 특정 날짜의 daily_data(원본)를 history로 옮긴다.
// 마감/진행상황 저장을 안 해서 history에 안 넘어간 날을 되살리는 일회성 도구.
// - daily_data/{date}/workRecords 서브컬렉션 + daily_data/{date} 문서 필드를 읽어
//   history/{date} 문서를 만든다.
// - 아직 종료 안 된(ongoing/paused) 기록은 앱의 17:30 자동마감 규칙과 동일하게 마감 처리.
// - history에 이미 기록이 있으면 확인(confirm) 후에만 덮어씀(force=true면 확인 생략).
// 반환: { date, records, quantities, hadExisting } 또는 null/취소.
// 🔍 미리보기(읽기 전용): 쓰기 없이 daily_data / history 상태만 확인.
export async function peekDailyData(dateKey) {
    if (!State.auth || !State.auth.currentUser) { showToast('로그인이 필요합니다.', true); return null; }
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) { showToast('날짜 형식 오류 (예: 2026-07-27)', true); return null; }
    const base = ['artifacts', 'team-work-logger-v2'];
    try {
        const [dailySnap, wrSnap, histSnap] = await Promise.all([
            getDoc(doc(State.db, ...base, 'daily_data', dateKey)),
            getDocs(collection(State.db, ...base, 'daily_data', dateKey, 'workRecords')),
            getDoc(doc(State.db, ...base, 'history', dateKey)),
        ]);
        const dailyData = dailySnap.exists() ? dailySnap.data() : {};
        const dailyRecords = wrSnap.size;
        const dailyQuantities = dailyData.taskQuantities ? Object.keys(dailyData.taskQuantities).length : 0;
        const hist = histSnap.exists() ? histSnap.data() : null;
        const historyRecords = hist && hist.workRecords ? hist.workRecords.length : 0;
        const result = {
            date: dateKey,
            dailyData: { records: dailyRecords, quantities: dailyQuantities, exists: dailySnap.exists() },
            history: { exists: histSnap.exists(), records: historyRecords },
        };
        console.log(`[peek ${dateKey}] daily_data: 업무 ${dailyRecords}건 / 물량 ${dailyQuantities}종  →  history: ${histSnap.exists() ? `있음(${historyRecords}건)` : '없음'}`, result);
        showToast(`${dateKey} — 원본 업무 ${dailyRecords}건, 이력 ${histSnap.exists() ? historyRecords + '건' : '없음'}`);
        return result;
    } catch (e) {
        console.error('peekDailyData error:', e);
        showToast(`조회 오류: ${e.message}`, true);
        return null;
    }
}

export async function recoverDailyDataToHistory(dateKey, { force = false, silent = false } = {}) {
    if (!State.auth || !State.auth.currentUser) { if (!silent) showToast('복구하려면 로그인이 필요합니다.', true); return null; }
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) { if (!silent) showToast('복구할 날짜 형식이 올바르지 않습니다. (예: 2026-07-27)', true); return null; }

    const base = ['artifacts', 'team-work-logger-v2'];
    const dailyDocRef = doc(State.db, ...base, 'daily_data', dateKey);
    const workRecordsColRef = collection(State.db, ...base, 'daily_data', dateKey, 'workRecords');
    const historyDocRef = doc(State.db, ...base, 'history', dateKey);

    try {
        // ⚠️ 서버 강제 읽기. getDoc/getDocs 는 서버에 못 닿으면 throw 하지 않고
        //    로컬 캐시로 조용히 성공한다. 그러면 아래 existingCount 가 0 으로 잊혀
        //    서버의 진짜 기록을 빈 배열로 덮어쓰는 경로가 열린다.
        const [dailySnap, wrSnap, histSnap] = await Promise.all([
            getDocFromServer(dailyDocRef),
            getDocsFromServer(workRecordsColRef),
            getDocFromServer(historyDocRef),
        ]);

        const dailyData = dailySnap.exists() ? dailySnap.data() : {};
        const rawRecords = [];
        wrSnap.forEach(d => rawRecords.push({ id: d.id, ...d.data() }));

        const hasQuantities = dailyData.taskQuantities && Object.keys(dailyData.taskQuantities).length > 0;
        if (rawRecords.length === 0 && !hasQuantities) {
            if (!silent) showToast(`${dateKey}: daily_data에 복구할 원본이 없습니다.`, true);
            return { date: dateKey, records: 0, quantities: 0, hadExisting: histSnap.exists() };
        }

        // 이미 history에 데이터가 있으면 실수로 덮어쓰지 않도록 확인
        const existing = histSnap.exists() ? histSnap.data() : null;
        const existingCount = (existing && existing.workRecords) ? existing.workRecords.length : 0;
        if (existingCount > 0 && !force) {
            const ok = confirm(`${dateKey} 이력에 이미 업무 ${existingCount}건이 있습니다.\n원본(daily_data) ${rawRecords.length}건으로 덮어쓸까요?`);
            if (!ok) { if (!silent) showToast('복구를 취소했습니다.'); return { date: dateKey, canceled: true }; }
        }

        // ongoing/paused 기록 마감 처리 (앱의 17:30 자동마감과 동일한 종료시각 사용)
        const AUTO_END = '17:30';
        const workRecords = rawRecords.map(r => {
            const data = { ...r };
            if (data.status === 'ongoing' || data.status === 'paused') {
                const pauses = Array.isArray(data.pauses) ? [...data.pauses] : [];
                if (data.status === 'paused' && pauses.length > 0) {
                    const lp = pauses[pauses.length - 1];
                    // `=== null` 이 아니라 `!end` 로 본다 — end 키가 아예 없는 휴식(undefined)은
            // 닫히지 않고, calcElapsedMinutes 는 끝이 없는 휴식을 무시하므로 그 시간이
            // 통째로 근무시간에 더해진다(이 파일의 마감 경로가 이미 같은 함정을 적어 뒀다).
            // 휴식 시작보다 이른 시각으로 닫으면 end < start 가 되어 역시 무시된다.
            if (lp && !lp.end) lp.end = (AUTO_END > lp.start) ? AUTO_END : lp.start;
                }
                data.endTime = AUTO_END;
                data.duration = Math.max(0, calcElapsedMinutes(data.startTime, AUTO_END, pauses));
                data.status = 'completed';
                data.pauses = pauses;
            }
            return data;
        }).filter(r => r.status !== 'completed' || Math.round(r.duration || 0) > 0);

        // 🛡️ 이미 history에 있는 값은 절대 후퇴시키지 않는다.
        //    (마감 시 daily_data의 물량/검증여부가 초기화되므로, 원본이 비면 기존 이력을 유지)
        const keep = (fromDaily, fromHist, isEmpty) =>
            (!isEmpty(fromDaily) ? fromDaily : (fromHist !== undefined && fromHist !== null ? fromHist : fromDaily));
        const emptyObj = (v) => !v || Object.keys(v).length === 0;
        const emptyArr = (v) => !Array.isArray(v) || v.length === 0;

        // 🛡️ 원본에서 건진 기록이 0건인데 이력엔 기록이 있으면 workRecords 를 아예 보내지 않는다.
        //    merge 라 키를 빼면 서버 배열이 그대로 보존된다. (배열은 merge 로 합쳐지지 않고 통째 교체되므로
        //    빈 배열을 보내면 이력의 실제 기록이 지워진다.)
        //    selfHealRecentHistory 가 '얼어붙은 메모리 캐시'로 후보를 고르는 탓에
        //    서버엔 기록이 있는 날이 복구 대상이 되는 경로가 있어, 여기서 한 겹 막는다.
        const keepExistingRecords = workRecords.length === 0 && existingCount > 0;
        if (keepExistingRecords) {
            console.warn(`[recoverDailyData] ${dateKey}: 원본 기록 0건, 이력 ${existingCount}건 — 이력의 업무기록은 건드리지 않습니다.`);
        }

        // 🔒 이미 마감된 날은 이 버튼도 이력을 **교체하지 않는다.**
        //    실패 시나리오였던 것: 17:30 마감(이력 53건·원본 삭제) → 저녁에 누가 재출근해
        //    업무 3건을 하고 → "그 3건이 이력에 없다" 며 복구를 누르면 원본 3건이 0건이 아니라
        //    이력 53건이 3건으로 교체됐다. 근태도 저녁 재출근 버전으로 덮였다.
        //    그래서 saveProgress 와 같은 규칙을 쓴다 — 서버에 없는 '완료된' 기록만 덧붙이고,
        //    서버에 이미 있는 사람의 근태는 지킨다.
        const isClosedDay = !!(existing && existing.closedAt);
        let appendOnly = null;
        if (isClosedDay && !keepExistingRecords) {
            const serverRecords = (existing && existing.workRecords) || [];
            const serverIds = new Set(serverRecords.map(r => r && r.id).filter(Boolean));
            const newRecords = workRecords.filter(
                r => r && r.id && r.status === 'completed' && !serverIds.has(r.id));
            appendOnly = newRecords.length > 0 ? [...serverRecords, ...newRecords] : null;
            console.warn(`[recoverDailyData] ${dateKey}: 이미 마감된 날 — 이력 ${serverRecords.length}건을`
                + ` 교체하지 않습니다.`
                + (newRecords.length > 0 ? ` 완료된 새 기록 ${newRecords.length}건만 덧붙입니다.` : ''));
        }
        const omitRecordsKey = keepExistingRecords || (isClosedDay && appendOnly === null);

        const historyData = {
            id: dateKey,
            ...(omitRecordsKey ? {} : { workRecords: appendOnly || workRecords }),
            taskQuantities: keep(dailyData.taskQuantities || {}, existing && existing.taskQuantities, emptyObj),
            confirmedZeroTasks: keep(dailyData.confirmedZeroTasks || [], existing && existing.confirmedZeroTasks, emptyArr),
            onLeaveMembers: keep(dailyData.onLeaveMembers || [], existing && existing.onLeaveMembers, emptyArr),
            partTimers: keep(dailyData.partTimers || [], existing && existing.partTimers, emptyArr),
            // 마감된 날은 서버(이력)에 이미 있는 사람의 근태가 이긴다 — 마감이 확정한
            // 퇴근시각을 저녁 재출근 상태로 덮지 않는다. 새로 생긴 사람은 그대로 더해진다.
            dailyAttendance: isClosedDay
                ? { ...(dailyData.dailyAttendance || {}), ...((existing && existing.dailyAttendance) || {}) }
                : keep(dailyData.dailyAttendance || {}, existing && existing.dailyAttendance, emptyObj),
            management: keep(dailyData.management || {}, existing && existing.management, emptyObj),
            inspectionList: keep(dailyData.inspectionList || [], existing && existing.inspectionList, emptyArr),
            isQuantityVerified: !!(dailyData.isQuantityVerified || (existing && existing.isQuantityVerified)),
            savedAt: getCurrentTime(),
            recoveredAt: new Date().toISOString(),
        };

        await setDoc(historyDocRef, historyData, { merge: true });

        // 메모리 캐시도 갱신 (재조회 없이 화면 반영)
        // ⚠️ 기록을 안 건드린 경우엔 메모리에 '서버의 실제 기록'을 넣어야 한다.
        //    payload 에서 workRecords 키를 뺐다고 메모리까지 비워 두면, 그 빈 배열을 기준으로
        //    과거 기록을 추가·수정하는 함수가 서버에 통째로 다시 써서 방금 지킨 기록이 사라진다.
        // ⚠️ 서버에 실제로 남은 배열과 반드시 같아야 한다. 마감된 날 append-only 로 썼는데
        //    메모리에 원본만 넣으면, 이력 편집(add/update/delete)이 그 배열을 통째로 서버에
        //    써서 지킨 기록이 사라진다 — 바로 위 주석의 사고다.
        const memRecords = omitRecordsKey
            ? ((existing && existing.workRecords) || [])
            : (appendOnly || workRecords);
        const memPatch = { ...historyData, workRecords: memRecords };

        const idx = State.allHistoryData.findIndex(d => d.id === dateKey);
        if (idx > -1) State.allHistoryData[idx] = { ...State.allHistoryData[idx], ...memPatch };
        else {
            State.allHistoryData.push(memPatch);
            State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
        }
        clearLocalCache();

        const qtyCount = Object.keys(historyData.taskQuantities).length;
        // 마감된 날은 '덧붙인 건수' 를 말해야 한다. 예전엔 53건을 지키고 3건만 더했는데도
        // "업무 3건" 으로 보고해서, 사용자가 53건이 3건으로 줄었다고 읽었다.
        const addedCount = appendOnly
            ? (appendOnly.length - (((existing && existing.workRecords) || []).length))
            : 0;
        if (!silent) {
            showToast(keepExistingRecords
                ? `✅ ${dateKey} 복구 완료 — 이력의 업무 ${existingCount}건은 그대로 두고 물량 ${qtyCount}종만 반영`
                : (isClosedDay
                    ? `✅ ${dateKey} 복구 완료 — 마감된 날이라 이력 ${existingCount}건은 그대로 두고`
                      + ` 새 기록 ${addedCount}건을 더했습니다 (물량 ${qtyCount}종)`
                    : `✅ ${dateKey} 복구 완료 — 업무 ${workRecords.length}건, 물량 ${qtyCount}종`));
        }
        return {
            date: dateKey,
            records: memRecords.length,          // 복구 후 그 날짜의 실제 기록 수
            recovered: keepExistingRecords ? 0 : (isClosedDay ? addedCount : workRecords.length),
            keptExisting: keepExistingRecords || (isClosedDay && omitRecordsKey),
            quantities: qtyCount,
            hadExisting: existingCount > 0
        };

    } catch (e) {
        console.error('recoverDailyDataToHistory error:', e);
        if (!silent) showToast(`복구 중 오류: ${e.message}`, true);
        return null;
    }
}

// 🩺 시작 시 자가복구: 최근 며칠 중 history가 비었지만 daily_data엔 원본이 있는 날을 자동으로 복구.
// - 이미 메모리에 로드된 allHistoryData만 보고 후보(빈 날)를 고르므로 후보 선별엔 추가 읽기 없음.
// - '빈 날'에 대해서만 daily_data를 1회 확인하고, 확인한 날짜는 localStorage에 기록해 재읽기를 막음(읽기요금 방어).
// - 주말/오늘은 제외. 정상적으로 마감된 날엔 후보가 없어 추가 비용 0.
// ⚠️ 판정 로직을 고칠 때마다 키의 버전을 올린다.
//    (이전 로직이 "확인 완료"로 잘못 표시해 둔 날짜를 다시 검사하게 하기 위함)
const SELF_HEAL_CHECKED_KEY = 'selfHealCheckedDates_v2';

export async function selfHealRecentHistory({ days = 7 } = {}) {
    if (!State.auth || !State.auth.currentUser) return { healed: [] };
    const today = getTodayDateString();

    let checked = [];
    try { checked = JSON.parse(localStorage.getItem(SELF_HEAL_CHECKED_KEY) || '[]'); } catch (_) {}
    const checkedSet = new Set(checked);

    // 후보 선별: 최근 days일(오늘·주말 제외) 중 history가 비어있고 아직 확인 안 한 날
    const candidates = [];
    const base = new Date(today);
    for (let i = 1; i <= days; i++) {
        const d = new Date(base);
        d.setDate(d.getDate() - i);
        const dow = d.getDay();
        if (dow === 0 || dow === 6) continue; // 주말 제외
        const key = toDateString(d);
        if (key >= today || checkedSet.has(key)) continue;
        const h = State.allHistoryData.find(x => x.id === key);
        // 🩺 판정 기준은 오직 '업무기록(workRecords)이 비었는가'.
        //    예전에는 물량(taskQuantities)이 있으면 후보에서 제외했는데,
        //    그 때문에 "물량은 저장됐지만 근무기록만 유실된 날"이 영영 복구되지 않았다.
        //    (17:30 자동마감이 history에 쓰지 않던 버그와 겹쳐 실제 유실 발생)
        const histEmpty = !h || !Array.isArray(h.workRecords) || h.workRecords.length === 0;
        if (histEmpty) candidates.push(key);
    }

    if (candidates.length === 0) return { healed: [] };

    const healed = [];
    for (const key of candidates) {
        try {
            const res = await recoverDailyDataToHistory(key, { force: true, silent: true });
            // recovered = 이번에 실제로 복구한 건수.
            // records 는 '복구 후 그 날짜의 전체 건수'라, 기존 이력을 그대로 둔
            // 경우에도 0보다 커져 '복구했다'고 잘못 알리게 된다.
            const got = res ? (res.recovered != null ? res.recovered : res.records) : 0;
            if (got > 0) healed.push({ date: key, records: got });
            // ⚠️ res === null 은 '서버를 못 읽었다'는 뜻이다(recover 는 throw 하지 않는다).
            //    이걸 확인 완료로 찍으면, 회선이 돌아와도 그 날짜는 다시 검사되지 않아
            //    유실된 날이 영원히 방치된다. 읽지도 못한 건 캐싱할 이유가 없다.
            if (res !== null) checkedSet.add(key);
        } catch (e) {
            console.warn('selfHeal 실패:', key, e);
        }
    }

    // 확인 기록 저장 (최근 60개만 유지)
    try { localStorage.setItem(SELF_HEAL_CHECKED_KEY, JSON.stringify([...checkedSet].slice(-60))); } catch (_) {}

    if (healed.length > 0) {
        const total = healed.reduce((s, x) => s + x.records, 0);
        console.log('[selfHeal] 자동 복구된 날:', healed);
        showToast(`🩺 마감 누락 ${healed.length}일 자동 복구됨 (업무 ${total}건)`);
    }
    return { healed };
}

// 🩺 앱 시작 시 가벼운 자가복구: '어제' 하루만 확인한다.
// 데이터 관리 창을 열지 않아도 동작해야 하므로 별도로 둔다.
// 비용: 하루 최대 1회, history 1건 읽기(+누락일 때만 daily_data 조회/쓰기).
export async function healYesterdayOnStartup() {
    if (!State.auth || !State.auth.currentUser) return null;

    const today = getTodayDateString();
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return null; // 주말 제외
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const guard = 'startupHealChecked_' + key;
    if (localStorage.getItem(guard)) return null;

    try {
        const histSnap = await getDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', key));
        const hist = histSnap.exists() ? histSnap.data() : null;
        const hasRecords = hist && Array.isArray(hist.workRecords) && hist.workRecords.length > 0;

        if (hasRecords) { localStorage.setItem(guard, '1'); return null; }

        const res = await recoverDailyDataToHistory(key, { force: true, silent: true });
        // ⚠️ res === null 은 서버를 못 읽은 것(recover 는 throw 하지 않는다).
        //    가드를 찍어 버리면 그 브라우저에선 어제 데이터가 두 번 다시 복구되지 않고,
        //    사용자는 실패했다는 사실조차 모른다. 성공했을 때만 확인 완료로 찍는다.
        if (res === null) {
            console.warn(`[healYesterday] ${key}: 서버를 못 읽어 복구를 건너뜁니다. 다음 접속 때 다시 시도합니다.`);
            return null;
        }
        localStorage.setItem(guard, '1');

        const gotY = res.recovered != null ? res.recovered : res.records;
        if (gotY > 0) {
            clearLocalCache();
            showToast(`🩺 어제(${key}) 마감 누락 업무 ${gotY}건을 자동 복구했습니다.`);
            return res;
        }
    } catch (e) {
        console.warn('시작 시 어제 자가복구 실패:', e);
        try { localStorage.removeItem(guard); } catch (_) {}
    }
    return null;
}

export async function fetchAllHistoryData(forceRefresh = false) {
    if (!forceRefresh && isHistoryCached && State.allHistoryData.length > 0) {
        return State.allHistoryData;
    }

    // ✨ 로컬 스토리지 확인 (새로고침·새 탭 시 DB 읽기 요금 방어). 과거 이력은 변하지 않으므로 길게 캐싱.
    if (!forceRefresh) {
        const cached = localStorage.getItem('historyDataCache');
        const cacheTime = localStorage.getItem('historyDataCacheTime');
        const now = Date.now();
        if (cached && cacheTime && (now - parseInt(cacheTime) < HISTORY_CACHE_TTL_MS)) {
            try {
                State.allHistoryData.length = 0;
                State.allHistoryData.push(...JSON.parse(cached));
                isHistoryCached = true;
                // 🛡️ 오늘 행은 캐시 값이 오래됐을 수 있으므로 실시간 메모리 상태로 덮어써 항상 최신 유지
                try { syncTodayToHistory(); } catch (e) {}
                return State.allHistoryData;
            } catch(e) {}
        }
    }

    if (historyFetchPromise && !forceRefresh) {
        return historyFetchPromise; 
    }

    historyFetchPromise = (async () => {
        const historyCollectionRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'history');
        try {
            const d = new Date();
            // 이력 조회 범위: 최근 12개월. (세션 캐시 5분이 있어 같은 세션 내 재호출은 추가 read 없음)
            d.setMonth(d.getMonth() - 12);
            const oneYearAgoStr = toDateString(d);

            const q = query(historyCollectionRef, where(documentId(), ">=", oneYearAgoStr));
            const querySnapshot = await getDocs(q);
            
            const dataMap = new Map();
            querySnapshot.forEach((doc) => {
                const docData = doc.data();
                if (docData) dataMap.set(doc.id, { id: doc.id, ...docData });
            });

            const today = getTodayDateString();
            let minDate = today;
            if (dataMap.size > 0) {
                const keys = Array.from(dataMap.keys());
                keys.sort();
                minDate = keys[0];
            }

            const fullHistory = [];
            const current = new Date(minDate);
            const end = new Date(today);

            while (current <= end) {
                // ⓘ current 는 new Date('YYYY-MM-DD') = UTC 자정이라 toISOString 과 짝이 맞는다.
                //    (로컬 자정으로 만든 날짜였다면 하루 밀렸을 자리 — utils.toDateString 참고)
                const dateStr = current.toISOString().slice(0, 10);
                if (dataMap.has(dateStr)) {
                    fullHistory.push(dataMap.get(dateStr));
                } else {
                    fullHistory.push({
                        id: dateStr, workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [],
                        management: { revenue: 0, orderCount: 0, inventoryQty: 0, inventoryAmt: 0 }, inspectionList: []
                    });
                }
                current.setDate(current.getDate() + 1);
            }

            fullHistory.sort((a, b) => b.id.localeCompare(a.id));
            State.allHistoryData.length = 0; 
            State.allHistoryData.push(...fullHistory); 
            
            isHistoryCached = true; 
            
            // ✨ 성공적으로 가져왔다면 로컬 스토리지에 캐싱 (용량 초과 시 안전하게 스킵)
            try {
                localStorage.setItem('historyDataCache', JSON.stringify(State.allHistoryData));
                localStorage.setItem('historyDataCacheTime', Date.now().toString());
            } catch (e) {
                console.warn('[history cache] localStorage 저장 실패(용량 초과 가능) — 캐시 없이 진행:', e);
                try { localStorage.removeItem('historyDataCache'); localStorage.removeItem('historyDataCacheTime'); } catch (_) {}
            }

            return State.allHistoryData;
        } catch (error) {
            console.error('Error fetching all history data:', error);
            State.allHistoryData.length = 0;
            return [];
        } finally {
            historyFetchPromise = null;
        }
    })();

    return historyFetchPromise;
}

export async function addHistoryWorkRecord(dateKey, newRecordData) {
    const todayKey = getTodayDateString();

    if (newRecordData.startTime && newRecordData.endTime && !newRecordData.duration) {
        newRecordData.duration = calcElapsedMinutes(newRecordData.startTime, newRecordData.endTime, newRecordData.pauses || []);
    }
    
    if (newRecordData.status === 'completed' && Math.round(newRecordData.duration || 0) <= 0) return;

    if (dateKey === todayKey) {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', newRecordData.id);
        await setDoc(docRef, newRecordData);
        await syncTodayToHistory();
        clearLocalCache();
        return;
    }

    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    let dayData = dayIndex > -1 ? State.allHistoryData[dayIndex] : null;
    
    if (!dayData) {
        dayData = { id: dateKey, workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [] };
        State.allHistoryData.push(dayData);
        State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
    }

    if (!dayData.workRecords) dayData.workRecords = [];
    dayData.workRecords.push(newRecordData);

    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
    await setDoc(historyDocRef, { workRecords: dayData.workRecords }, { merge: true });
    clearLocalCache();
}

export async function updateHistoryWorkRecord(dateKey, recordId, updateData) {
    const todayKey = getTodayDateString();

    if (dateKey === todayKey) {
        const localRecord = (State.appState.workRecords || []).find(r => r.id === recordId);
        if (!localRecord) {
             try {
                const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
                if (dayIndex > -1) {
                    const dayData = State.allHistoryData[dayIndex];
                    const recIdx = dayData.workRecords.findIndex(r => r.id === recordId);
                    if (recIdx > -1) return await updateHistoryDirectly(dateKey, recordId, updateData);
                }
             } catch(e) {}
             throw new Error("기록을 찾을 수 없습니다.");
        }

        let newDuration = localRecord.duration;
        let newStatus = updateData.status || localRecord.status;

        if (updateData.startTime || updateData.endTime || updateData.pauses) {
            const start = updateData.startTime || localRecord.startTime;
            const end = updateData.endTime || localRecord.endTime;
            const pauses = updateData.pauses || localRecord.pauses || [];
            if (end) newDuration = calcElapsedMinutes(start, end, pauses);
            updateData.duration = newDuration;
        }

        if (newStatus === 'completed' && newDuration !== null && Math.round(newDuration) <= 0) {
            await deleteHistoryWorkRecord(dateKey, recordId);
            return;
        }
        
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', recordId);
        await updateDoc(docRef, updateData);
        await syncTodayToHistory(); 
        clearLocalCache();
        return;
    }

    await updateHistoryDirectly(dateKey, recordId, updateData);
}

async function updateHistoryDirectly(dateKey, recordId, updateData) {
    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex === -1) throw new Error("이력 없음");

    const dayData = State.allHistoryData[dayIndex];
    if (!Array.isArray(dayData.workRecords)) dayData.workRecords = [];
    const recordIndex = dayData.workRecords.findIndex(r => r.id === recordId);
    if (recordIndex === -1) throw new Error("기록 없음");

    const originalRecord = dayData.workRecords[recordIndex];
    const updatedRecord = { ...originalRecord, ...updateData };

    if (updateData.startTime || updateData.endTime || originalRecord.pauses) {
        const start = updateData.startTime || originalRecord.startTime;
        const end = updateData.endTime || originalRecord.endTime;
        const pauses = updateData.pauses || originalRecord.pauses || [];
        updatedRecord.duration = calcElapsedMinutes(start, end, pauses);
    }

    if (updatedRecord.status === 'completed' && Math.round(updatedRecord.duration || 0) <= 0) {
        await deleteHistoryWorkRecord(dateKey, recordId);
        return;
    }

    dayData.workRecords[recordIndex] = updatedRecord;
    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
    await setDoc(historyDocRef, { workRecords: dayData.workRecords }, { merge: true });
    clearLocalCache();
}

export async function deleteHistoryWorkRecord(dateKey, recordId) {
    const todayKey = getTodayDateString();

    if (dateKey === todayKey) {
        const dailyRecordRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', recordId);
        const dailySnap = await getDoc(dailyRecordRef);
        
        if (dailySnap.exists()) {
            await deleteDoc(dailyRecordRef);
            await syncTodayToHistory();
            clearLocalCache();
            return;
        }
    }

    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex === -1) throw new Error("해당 날짜의 이력을 찾을 수 없습니다.");

    const dayData = State.allHistoryData[dayIndex];
    if (!Array.isArray(dayData.workRecords)) dayData.workRecords = [];
    const newRecords = dayData.workRecords.filter(r => r.id !== recordId);

    if (dayData.workRecords.length === newRecords.length) return;

    dayData.workRecords = newRecords; 
    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
    await setDoc(historyDocRef, { workRecords: newRecords }, { merge: true });
    clearLocalCache();
}

export async function saveManagementData(dateKey, managementData) {
    const todayKey = getTodayDateString();

    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex > -1) {
        // Firestore 는 merge 로 깊게 합치므로 메모리도 같게 맞춘다.
        // (통째로 바꾸면 이번에 안 보낸 항목이 화면에서만 사라져 다음 저장 때 0으로 덮인다)
        State.allHistoryData[dayIndex].management = {
            ...(State.allHistoryData[dayIndex].management || {}),
            ...managementData
        };
    } else {
        State.allHistoryData.push({
            id: dateKey, workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], management: managementData
        });
        State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
    }

    const updates = { management: managementData };

    try {
        if (dateKey === todayKey) await setDoc(getDailyDocRef(), updates, { merge: true });
        const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
        await setDoc(historyDocRef, updates, { merge: true });
        clearLocalCache();
    } catch (e) {
        console.error("Error saving management data:", e);
        throw e; 
    }
}

// 💱 과거 환율 소급 입력(백필).
// history 문서가 있는 날짜 중 환율이 비어있는 날을 날짜별 조회가 되는 무료 API(frankfurter)로 채운다.
// - 오늘은 자동입력(autoFetchDailyFx)이 처리하므로 제외.
// - 주말/휴일은 API가 직전 영업일 환율을 반환.
// 반환: { ok, fail, skipped }
export async function backfillFxRates(fromDate = '2026-06-01') {
    if (!State.auth || !State.auth.currentUser) { showToast('로그인이 필요합니다.', true); return { ok: 0, fail: 0 }; }
    const todayKey = getTodayDateString();

    const targets = (State.allHistoryData || [])
        .filter(d => d.id && d.id >= fromDate && d.id < todayKey)
        .filter(d => !(d.management && Number(d.management.usdRate) > 0))
        .map(d => d.id)
        .sort();

    if (targets.length === 0) { showToast('채울 과거 환율이 없습니다. (이미 모두 입력됨)'); return { ok: 0, fail: 0 }; }
    if (!confirm(`${fromDate}부터 환율이 비어있는 ${targets.length}일을 과거 환율로 채웁니다.\n진행할까요?`)) return { ok: 0, fail: 0, canceled: true };

    let ok = 0, fail = 0;
    for (const date of targets) {
        try {
            const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=USD&symbols=KRW,CNY`, { cache: 'no-store' });
            const j = await res.json();
            const krw = j && j.rates && j.rates.KRW;
            const cny = j && j.rates && j.rates.CNY;
            if (!krw) { fail++; continue; }

            const usdRate = Math.round(krw * 100) / 100;                 // 1 USD = ? 원 (소수점 2자리)
            const cnyRate = cny ? Math.round((krw / cny) * 100) / 100 : 0; // 1 CNY = ? 원 (소수점 2자리)
            const fxAt = Date.now();
            const payload = { management: { usdRate, cnyRate, fxAt, fxBackfilled: true } };

            const histRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', date);
            await setDoc(histRef, payload, { merge: true }); // 딥머지: 기존 매출/재고 보존

            const di = State.allHistoryData.findIndex(d => d.id === date);
            if (di > -1) State.allHistoryData[di].management = { ...(State.allHistoryData[di].management || {}), usdRate, cnyRate, fxAt };
            ok++;
        } catch (e) {
            fail++;
            console.warn('환율 백필 실패:', date, e);
        }
        await new Promise(r => setTimeout(r, 150)); // API 과다호출 방지
    }

    clearLocalCache(); // 캐시 무효화 → 다음 조회 시 서버 최신값 반영
    showToast(`과거 환율 채우기 완료: 성공 ${ok}일 / 실패 ${fail}일`);
    return { ok, fail };
}

export async function checkUnverifiedRecords(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedUnverifiedDates && (now - lastUnverifiedCheckTime < 3600000)) {
        return cachedUnverifiedDates;
    }

    // ✨ 브라우저 세션 스토리지 캐시 확인
    if (!forceRefresh) {
        const cached = localStorage.getItem('unverifiedDataCache');
        const cacheTime = localStorage.getItem('unverifiedDataCacheTime');
        if (cached && cacheTime && (now - parseInt(cacheTime) < HISTORY_CACHE_TTL_MS)) {
            try {
                cachedUnverifiedDates = JSON.parse(cached);
                lastUnverifiedCheckTime = now;
                return cachedUnverifiedDates;
            } catch(e) {}
        }
    }

    if (unverifiedFetchPromise && !forceRefresh) {
        return unverifiedFetchPromise;
    }

    unverifiedFetchPromise = (async () => {
        const historyCol = collection(State.db, 'artifacts', 'team-work-logger-v2', 'history');
        
        try {
            const d = new Date();
            // 🚨 기존 14일 -> 7일로 축소하여 읽기 요금 반토막
            d.setDate(d.getDate() - 7); 
            const sevenDaysAgoStr = toDateString(d);

            const q = query(historyCol, where(documentId(), ">=", sevenDaysAgoStr)); 
            const snapshot = await getDocs(q);
            
            const unverifiedDates = [];
            const today = getTodayDateString();

            snapshot.forEach(doc => {
                const data = doc.data();
                if (doc.id !== today) {
                    const hasQuantities = data.taskQuantities && Object.keys(data.taskQuantities).length > 0;
                    if (hasQuantities && !data.isQuantityVerified) unverifiedDates.push(doc.id);
                }
            });

            unverifiedDates.sort();
            cachedUnverifiedDates = unverifiedDates;
            lastUnverifiedCheckTime = Date.now();
            
            try {
                localStorage.setItem('unverifiedDataCache', JSON.stringify(unverifiedDates));
                localStorage.setItem('unverifiedDataCacheTime', Date.now().toString());
            } catch (e) { /* 용량 초과 시 캐시 스킵 */ }

            return unverifiedDates; 
        } catch (e) {
            console.error("Failed to check unverified records:", e);
            return [];
        } finally {
            unverifiedFetchPromise = null;
        }
    })();

    return unverifiedFetchPromise;
}