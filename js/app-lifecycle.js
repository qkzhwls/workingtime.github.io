// === js/app-lifecycle.js ===
import * as State from './state.js?v=202610021228';
import { getCurrentTime, displayCurrentDate, getTodayDateString, isWeekday, calcElapsedMinutes, formatDuration, showToast } from './utils.js?v=202610021228';
import { saveProgress, isDayClosedOnServer } from './history-data-manager.js?v=202610021228';
import { saveStateToFirestore } from './app-data.js?v=202610021228';
import { collection, doc, writeBatch, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let localLunchPauseExecuted = false;
let localLunchResumeExecuted = false;
let lastCheckedDay = null;

// 💱 매일 아침(09:00 이후) 환율 자동 입력 — 그날 daily_data/history의 management에 usdRate/cnyRate 저장.
// 첫 접속자(브라우저)만 기록하고 나머지는 스킵(이미 입력됐는지 확인). 하루 1회.
let _fxFetchedDay = null;
let _fxFetching = false;
let _fxLastAttempt = 0;
async function autoFetchDailyFx(todayKey) {
    if (_fxFetchedDay === todayKey || _fxFetching) return;
    if (!State.auth || !State.auth.currentUser) return; // 인증 필요(규칙)
    const lsKey = 'fxAutoFetched_' + todayKey;
    if (localStorage.getItem(lsKey)) { _fxFetchedDay = todayKey; return; }
    if (Date.now() - _fxLastAttempt < 5 * 60 * 1000) return; // 실패 시 5분 쿨다운
    _fxLastAttempt = Date.now();
    _fxFetching = true;
    try {
        const dailyRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey);
        const histRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', todayKey);

        // 이미 오늘 누군가 입력했으면 스킵
        const snap = await getDoc(dailyRef);
        if (snap.exists() && snap.data().management && snap.data().management.usdRate) {
            localStorage.setItem(lsKey, '1'); _fxFetchedDay = todayKey; return;
        }

        const r = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' });
        const j = await r.json();
        if (!j || !j.rates || !j.rates.KRW) return;
        const round2 = (n) => Math.round(n * 100) / 100;
        const usdRate = round2(j.rates.KRW);                                   // 1 USD = ? 원 (소수점 2자리)
        const cnyRate = j.rates.CNY ? round2(j.rates.KRW / j.rates.CNY) : 0;   // 1 CNY = ? 원 (소수점 2자리)
        const fxAt = Date.now();
        const payload = { management: { usdRate, cnyRate, fxAt } };

        await Promise.all([
            setDoc(dailyRef, payload, { merge: true }), // 딥머지: 기존 매출/재고 등 보존
            setDoc(histRef, payload, { merge: true })
        ]);

        // 메모리 즉시 반영
        // ⚠️ appState.management 는 처음엔 비어 있다. 여기서 환율만 담아 두면
        //    '부분 객체'가 되어, 이후 동기화가 이미 저장된 매출·재고를 덮어 지운다.
        //    그래서 이미 알고 있는 그날 값 위에 환율만 얹는다.
        const memMgmt = (State.allHistoryData || []).find(d => d.id === todayKey)?.management || {};
        if (State.appState) {
            State.appState.management = { ...memMgmt, ...(State.appState.management || {}), usdRate, cnyRate, fxAt };
        }
        const di = (State.allHistoryData || []).findIndex(d => d.id === todayKey);
        if (di > -1) State.allHistoryData[di].management = { ...(State.allHistoryData[di].management || {}), usdRate, cnyRate, fxAt };

        localStorage.setItem(lsKey, '1');
        _fxFetchedDay = todayKey;
        showToast(`오늘 환율 자동 입력: $${usdRate.toLocaleString()} / ¥${cnyRate.toLocaleString()}원`, false);
    } catch (e) {
        console.warn('환율 자동 입력 실패:', e);
    } finally {
        _fxFetching = false;
    }
}

// 💱 앱을 실행하지 않은 날짜(주말·휴일·미접속일)의 환율도 소급 저장.
// 누군가 앱을 열면, 마지막으로 채운 날 다음부터 '어제'까지 비어있는 날을 과거 시세로 채운다.
// - 워터마크(fxLastFilledDate)로 매번 조금씩만 처리 → 읽기/쓰기 최소화.
// - 하루 1회(브라우저당). 과도한 소급 방지를 위해 자동은 최대 60일치까지만(그 이전은 수동 버튼).
const FX_BACKFILL_START = '2026-06-01';
let _fxGapDay = null;
async function autoBackfillMissingFx(todayKey) {
    if (_fxGapDay === todayKey) return;
    if (!State.auth || !State.auth.currentUser) return;
    const lsGuard = 'fxGapFilled_' + todayKey;
    if (localStorage.getItem(lsGuard)) { _fxGapDay = todayKey; return; }
    _fxGapDay = todayKey; // 이번 세션 재시도 방지(다음날 새 가드로 재시도)

    // 로컬 시간 기준 날짜 포맷(UTC 변환 시 KST에서 하루 밀리는 문제 방지)
    const fmt = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

    const yDate = new Date(todayKey + 'T00:00:00'); yDate.setDate(yDate.getDate() - 1);
    const yesterday = fmt(yDate);

    // 시작점: 워터마크 다음날(없으면 FX_BACKFILL_START), 단 최근 60일 이내로 제한
    let start;
    const wm = localStorage.getItem('fxLastFilledDate');
    if (wm) { const s = new Date(wm + 'T00:00:00'); s.setDate(s.getDate() + 1); start = fmt(s); }
    else start = FX_BACKFILL_START;
    const capDate = new Date(todayKey + 'T00:00:00'); capDate.setDate(capDate.getDate() - 60);
    const capStr = fmt(capDate);
    if (start < capStr) start = capStr; // 60일 이전은 수동(과거 환율 채우기 버튼)

    if (start > yesterday) { localStorage.setItem(lsGuard, '1'); return; }

    let ok = 0;
    try {
        for (let d = new Date(start + 'T00:00:00'); d <= yDate; d.setDate(d.getDate() + 1)) {
            const date = fmt(d);
            const histRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', date);
            const snap = await getDoc(histRef);
            if (snap.exists() && snap.data().management && snap.data().management.usdRate) {
                localStorage.setItem('fxLastFilledDate', date); // 이미 있음 → 전진
                continue;
            }
            const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=USD&symbols=KRW,CNY`, { cache: 'no-store' });
            const j = await res.json();
            const krw = j && j.rates && j.rates.KRW;
            const cny = j && j.rates && j.rates.CNY;
            if (!krw) continue; // 값 없음 → 전진하지 않고 다음 날짜
            const usdRate = Math.round(krw * 100) / 100;              // 소수점 2자리
            const cnyRate = cny ? Math.round((krw / cny) * 100) / 100 : 0;
            await setDoc(histRef, { management: { usdRate, cnyRate, fxAt: Date.now(), fxBackfilled: true } }, { merge: true });
            localStorage.setItem('fxLastFilledDate', date);
            ok++;
            await new Promise(r => setTimeout(r, 120)); // API 과다호출 방지
        }
        localStorage.setItem(lsGuard, '1'); // 오늘치 완료
    } catch (e) {
        console.warn('환율 자동 갭필 실패(다음 접속 시 재시도):', e);
        // 가드 미설정 → 다음날 재시도. 워터마크는 마지막 성공 지점까지 저장돼 있음.
    }

    if (ok > 0) {
        try { localStorage.removeItem('historyDataCache'); localStorage.removeItem('historyDataCacheTime'); } catch (_) {}
        showToast(`앱 미실행일 포함 과거 환율 ${ok}일치를 자동 저장했습니다.`, false);
    }
}

// ✨ 야근 확인 팝업 및 타이머용 변수 추가
let localAutoClosePromptExecuted = false;
let autoCloseTimer = null;
let overtimeOptOut = false;      // [연장 근무 계속하기]를 누른 날은 강제 마감하지 않는다
let eodFlushCooldownUntil = 0;   // 종료시각 이후 이력 확정 저장 재시도 쿨다운

// 업무일 종료시각. 이력의 열린 기록 상한도 같은 값을 써야 하므로 단일 출처에서 가져온다
// (예전엔 두 파일에 따로 박혀 있어, 한쪽만 고치면 조용히 갈라졌다).
import { AUTO_END_TIME } from './lib/record-close.js?v=202610021228';

// 진행/일시정지 기록을 지정 시각으로 마감(Firestore 배치 + 로컬 미러 갱신)
async function closeRecordsAt(records, endTime, dayKey) {
    if (!records || records.length === 0) return 0;
    const colRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', dayKey, 'workRecords');
    const lockColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', dayKey, 'activeLocks');
    const batch = writeBatch(State.db);
    const pending = [];   // 커밋 성공 뒤에 화면 미러에 반영할 값

    records.forEach(rec => {
        const recRef = doc(colRef, rec.id);
        // 일시정지 중이면 열린 pause 구간을 종료시각으로 닫아야 시간이 정확하다.
        const pauses = Array.isArray(rec.pauses) ? rec.pauses.map(p => ({ ...p })) : [];
        if (rec.status === 'paused' && pauses.length > 0) {
            const lp = pauses[pauses.length - 1];
            // 휴식 시작보다 이른 시각으로 닫으면 end < start 인 구간이 원본에 영구히 남는다.
            // 계산에서는 무시되지만 휴식시간 표시·엑셀 출력이 역순 구간을 그대로 들고 다닌다.
            // (history-data-manager.js 의 두 경로와 같게 맞춘다)
            if (lp && !lp.end) lp.end = (endTime > lp.start) ? endTime : lp.start;
        }
        const duration = Math.max(0, calcElapsedMinutes(rec.startTime, endTime, pauses));
        batch.update(recRef, { status: 'completed', endTime, duration, pauses });
        // 🛡️ 멤버 잠금 해제
        if (rec.member) batch.delete(doc(lockColRef, String(rec.member)));
        // 화면 갱신은 커밋이 성공한 뒤에 한다(아래).
        pending.push({ rec, duration, pauses });
    });

    await batch.commit();

    // ⚠️ 커밋 성공 뒤에만 미러를 바꾼다.
    //    예전엔 커밋 전에 바꿔서, 실패해도 화면은 '마감됨'으로 보였고
    //    다음 재시도 때 진행 중 기록이 하나도 안 잡혀 그날 마감이 건너뛰어졌다.
    pending.forEach(({ rec, duration, pauses }) => {
        rec.status = 'completed';
        rec.endTime = endTime;
        rec.duration = duration;
        rec.pauses = pauses;
    });
    return records.length;
}

// 🛟 최후의 안전망: 종료시각 이후 오늘 상태를 history에 확정 저장한다.
// 자동마감 팝업 창(17:30~17:34)을 놓쳤거나, 비관리자만 접속했거나,
// 아무도 '업무 마감'을 누르지 않은 날에도 근무기록이 이력에 남도록 한다.
async function eodFlushToHistory(todayKey, isAdmin) {
    if (!State.auth || !State.auth.currentUser) return;
    if (Date.now() < eodFlushCooldownUntil) return;

    const lsKey = 'eodFlushed_' + todayKey;
    if (localStorage.getItem(lsKey)) return;

    // ⚠️ 쿨다운을 **첫 await 앞에서** 찍는다. 이 함수는 1초 타이머가 await 없이 부르므로,
    //    아래 서버 조회(수백 ms~수 초) 동안 다음 틱이 그대로 재진입해 여러 개가 겹쳐 돈다.
    //    조기 return 경로에도 쿨다운이 걸려야 한다 — 안 걸면 '기록 0건' 인 날이나 회선이
    //    끊긴 저녁에 getDocFromServer 가 **초당 1회** 돈다(탭당 하루 2만 회 이상).
    eodFlushCooldownUntil = Date.now() + 30 * 60 * 1000;

    // 🔒 이미 마감된 날이면 손대지 않는다.
    //    이 안전망은 30분마다 자정까지 재시도하는데, 마감을 실행한 쪽(봇·다른 PC)에만
    //    위 localStorage 플래그가 찍힌다. 그래서 '아침부터 켜 둔 다른 탭' 은 마감이 끝난
    //    뒤에도 계속 여기로 들어와 자기 기준으로 이력을 덮어쓸 수 있었다.
    //    (2026-10-01: 마감 뒤 저장이 돌아 기록 7건 유실 · 근무시간 27시간 부풀림)
    const closedState = await isDayClosedOnServer(todayKey);
    if (closedState === 'closed') {
        localStorage.setItem(lsKey, '1');   // 그날은 끝났다 — 재시도도 멈춘다
        console.warn(`[eodFlush] ${todayKey}: 이미 마감된 날 — 아무것도 저장하지 않습니다.`);
        return;
    }
    if (closedState === 'unknown') {
        // 서버를 못 읽었으면 덮어쓸 위험을 감수하지 않는다. 회선 문제는 금방 풀릴 수 있어
        // 30분을 다 기다리지 않고 5분 뒤에 다시 본다.
        eodFlushCooldownUntil = Date.now() + 5 * 60 * 1000;
        console.warn(`[eodFlush] ${todayKey}: 마감 여부를 확인하지 못해 건너뜁니다(5분 뒤 재시도).`);
        return;
    }

    const records = State.appState.workRecords || [];
    if (records.length === 0) return; // 저장할 것이 없음 → 쿨다운 뒤 재시도

    const openOnes = records.filter(r => r.status === 'ongoing' || r.status === 'paused');

    try {
        // 야근을 선택하지 않았는데 아직 안 끝난 기록이 있으면 종료시각 기준으로 마감
        if (openOnes.length > 0 && isAdmin && !overtimeOptOut) {
            await closeRecordsAt(openOnes, AUTO_END_TIME, todayKey);
        }

        const saved = (await saveProgress(true, false, { isFinalize: true })) === 'saved';

        // 모두 마감된 상태로 '실제로 저장에 성공'했을 때만 그날을 완료로 찍는다.
        // 예전엔 saveProgress 가 조용히 중단돼도(서버를 못 읽는 등) 완료로 표시해
        // 그날 재시도가 영영 사라졌다.
        const stillOpen = (State.appState.workRecords || []).some(r => r.status === 'ongoing' || r.status === 'paused');
        if (saved && !stillOpen) localStorage.setItem(lsKey, '1');
    } catch (e) {
        console.warn('종료시각 이력 확정 저장 실패(30분 뒤 재시도):', e);
    }
}

export const updateElapsedTimes = async () => {
    const now = getCurrentTime();
    displayCurrentDate();
    
    const todayDate = getTodayDateString();
    const isTodayWeekday = isWeekday(todayDate);
    
    // 날짜가 바뀌면(자정) 잠금장치 스스로 초기화
    if (lastCheckedDay !== todayDate) {
        localLunchPauseExecuted = false;
        localLunchResumeExecuted = false;
        
        // ✨ 다음 날을 위해 야근 팝업 잠금장치 초기화
        localAutoClosePromptExecuted = false;
        if (autoCloseTimer) clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
        overtimeOptOut = false;
        eodFlushCooldownUntil = 0;
        _fxFetchedDay = null; // 환율 자동입력 가드도 초기화
        _fxGapDay = null;     // 환율 자동 갭필 가드도 초기화

        lastCheckedDay = todayDate;
    }

    // 💱 매일 아침 09:00 이후 환율 자동 입력 (하루 1회)
    if (now >= '09:00') autoFetchDailyFx(todayDate);
    // 💱 앱 미실행일 포함 과거 환율 자동 갭필 (하루 1회, 시각 무관)
    autoBackfillMissingFx(todayDate);

    const currentUserLower = (State.appState.currentUser || '').toLowerCase();
    const isAdmin = State.appConfig?.memberRoles?.[currentUserLower] === 'admin';
    
    // ✨ 개선: 12:30분 정각이 아니더라도(예: 12:32분 접속) 범위 내라면 안전하게 감지
    const isLunchTime = now >= '12:30' && now < '13:30';
    const isAfterLunch = now >= '13:30';

    if (isTodayWeekday) {
        // --- 1. 점심시간 일시정지 (12:30 ~ 13:29) ---
        // ✨ 개선: 관리자(isAdmin) 조건 삭제! 누구나 접속해 있으면 서버 동기화를 통해 1회만 안전하게 실행
        if (isLunchTime && !localLunchPauseExecuted && !State.appState.lunchPauseExecuted) {
            localLunchPauseExecuted = true; 
            
            if (State.context.autoPauseForLunch) {
                try {
                    const tasksPaused = await State.context.autoPauseForLunch();
                    if (tasksPaused > 0) showToast(`점심시간입니다. 진행 중인 ${tasksPaused}개의 업무를 자동 일시정지합니다.`, false);
                } catch (e) { console.error("Error during auto-pause: ", e); }
            }
        }

        // --- 2. 점심시간 재개 (13:30 이후) ---
        // ✨ 개선: 역시 관리자 조건 삭제. 누군가 13:30 이후에 접속해 있다면 자동 재개
        if (isAfterLunch && !localLunchResumeExecuted && !State.appState.lunchResumeExecuted) {
            localLunchResumeExecuted = true;
            
            if (State.context.autoResumeFromLunch) {
                try {
                    const tasksResumed = await State.context.autoResumeFromLunch();
                    if (tasksResumed > 0) showToast(`점심시간 종료. ${tasksResumed}개의 업무를 자동 재개합니다.`, false);
                } catch (e) { console.error("Error during auto-resume: ", e); }
            }
        }
    }

    // ✨ 핵심 방어막 3: 17:30 퇴근 시간 감지 및 야근 확인 팝업 (관리자 전용)
    // 5분 윈도우(17:30~17:34)로 백그라운드 탭의 setInterval throttle에 대응.
    // 한 명이 먼저 처리하면 onSnapshot으로 동기화돼 다른 관리자에겐 ongoing.length === 0이 되어
    // 추가 팝업이 뜨지 않음.
    if (isAdmin && isTodayWeekday && now >= '17:30' && now < '17:35' && !localAutoClosePromptExecuted) {
        localAutoClosePromptExecuted = true;

        // 진행 중(ongoing) 뿐 아니라 일시정지(paused) 상태도 마감 대상이다.
        // (예전에는 ongoing만 처리해서, 점심 자동정지 후 재개되지 않은 기록이 미마감으로 남았다)
        const ongoingRecords = (State.appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');

        if (ongoingRecords.length > 0) {
            const modal = document.getElementById('overtime-prompt-modal');
            const btnContinue = document.getElementById('btn-continue-overtime');
            const btnCloseNow = document.getElementById('btn-close-now');

            if (modal) modal.classList.remove('hidden');

            // 실제 마감: Firestore workRecords 서브컬렉션을 batch.update.
            // (workRecords는 daily_data 문서의 필드가 아니라 별도 서브컬렉션이라
            //  markDataAsDirty/saveStateToFirestore로는 저장되지 않음)
            const executeAutoClose = async () => {
                // 실행 시점에 다시 필터 — 이미 누가 마감했으면 빈 배치(no-op)
                const ongoing = (State.appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
                if (ongoing.length === 0) {
                    if (modal) modal.classList.add('hidden');
                    return;
                }
                try {
                    await closeRecordsAt(ongoing, AUTO_END_TIME, getTodayDateString());

                    // 🛟 자동마감 결과를 반드시 history에도 확정 저장한다.
                    //    (이 호출이 없어서 자동마감된 날의 근무시간이 이력에 남지 않고 유실됐다)
                    try {
                        // saveProgress 는 실패해도 throw 하지 않고 false 를 돌려준다.
                        // 무조건 플래그를 찍으면 17:35 최후 안전망이 그날 내내 차단돼
                        // 저장되지 않은 근무기록이 영영 이력에 남지 않는다.
                        const savedAuto = (await saveProgress(true, false, { isFinalize: true })) === 'saved';
                        if (savedAuto) localStorage.setItem('eodFlushed_' + getTodayDateString(), '1');
                        else console.warn('[autoClose] 이력 확정 저장 실패 — 17:35 안전망에 맡깁니다.');
                    } catch (e2) {
                        console.error('Auto-close history save error:', e2);
                    }

                    showToast(`${AUTO_END_TIME} 기준으로 ${ongoing.length}개 업무가 자동 마감되었습니다.`, false);
                } catch (e) {
                    console.error('Auto-close batch error:', e);
                    showToast('업무 자동 마감 중 오류가 발생했습니다. 콘솔을 확인해주세요.', true);
                }
                if (modal) modal.classList.add('hidden');
            };

            // 1. 5분(300,000ms) 대기 타이머 시작
            autoCloseTimer = setTimeout(() => { executeAutoClose(); }, 5 * 60 * 1000);

            // 2. [연장 근무 계속하기]
            if (btnContinue) {
                btnContinue.onclick = () => {
                    clearTimeout(autoCloseTimer);
                    overtimeOptOut = true; // 안전망(eodFlush)이 강제 마감하지 않도록
                    if (modal) modal.classList.add('hidden');
                    showToast('연장 근무가 활성화되었습니다. 퇴근 시 직접 마감해주세요.', false);
                };
            }

            // 3. [지금 마감하기]
            if (btnCloseNow) {
                btnCloseNow.onclick = async () => {
                    clearTimeout(autoCloseTimer);
                    await executeAutoClose();
                };
            }
        }
    }

    // 🛟 최후의 안전망: 17:35 이후 오늘 기록을 history에 확정 저장(하루 1회).
    //    자동마감 팝업 창을 놓쳤거나 아무도 마감을 누르지 않아도 근무시간이 유실되지 않는다.
    if (isTodayWeekday && now >= '17:35') {
        eodFlushToHistory(todayDate, isAdmin);
    }

    document.querySelectorAll('.ongoing-duration').forEach(el => {
        try {
            const startTime = el.dataset.startTime;
            if (!startTime) return;

            const status = el.dataset.status;
            const pauses = JSON.parse(el.dataset.pausesJson || '[]');
            
            if (status === 'paused') {
                const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                const tempPauses = [...pauses.slice(0, -1), { start: lastPause?.start || startTime, end: now }];
                const dur = calcElapsedMinutes(startTime, now, tempPauses);
                el.textContent = `(진행: ${formatDuration(dur)})`;
            } else { 
                const dur = calcElapsedMinutes(startTime, now, pauses);
                el.textContent = `(진행: ${formatDuration(dur)})`;
            }
        } catch (e) { }
    });

    const completedRecords = (State.appState.workRecords || []).filter(r => r.status === 'completed');
    const totalCompletedMinutes = completedRecords.reduce((sum, r) => sum + (r.duration || 0), 0);
    const ongoingLiveRecords = (State.appState.workRecords || []).filter(r => r.status === 'ongoing');
    let totalOngoingMinutes = 0;
    ongoingLiveRecords.forEach(rec => {
        totalOngoingMinutes += calcElapsedMinutes(rec.startTime, now, rec.pauses);
    });
    
    const el = document.getElementById('summary-total-work-time');
    if (el) el.textContent = formatDuration(totalCompletedMinutes + totalOngoingMinutes);
};

export const autoSaveProgress = async () => {
    // 변경사항이 무시되는 버그를 고치고, 데이터가 실제로 변했을 때만 안전하게 저장 연동
    if (State.isDataDirty) {
        await saveStateToFirestore();
    }
};

export const markDataAsDirty = () => {
    State.setIsDataDirty(true);
};