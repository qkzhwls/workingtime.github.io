// === js/widget-today-progress.js ===
// 설명: 메인 대시보드 맨 위의 '오늘 진행' 한 줄 띠.
//   낮에는 아무도 데이터관리 창을 열지 않는다 — 계획 대비 얼마나 왔는지,
//   지금 페이스로 언제 끝나는지를 대시보드에서 바로 보이게 하고, 누르면 자세히 볼 수 있게 한다.

import * as State from './state.js?v=202610021042';
import { formatHM } from './utils.js?v=202610021042';
import { getTodayProgressSummary, ensureTodayForecastSnapshot } from './ui-history-prediction.js?v=202610021042';
import { fetchAllHistoryData, fetchPlannedData } from './history-data-manager.js?v=202610021042';

const EL = 'today-progress-strip';
let timer = null;

/** Firebase 로그인이 끝날 때까지 기다린다(최대 90초). 끝내 안 되면 그냥 그리지 않는다. */
const waitForAuth = async (timeoutMs = 90000) => {
    const limit = Date.now() + timeoutMs;
    while (Date.now() < limit) {
        if (State.db && State.auth && State.auth.currentUser) return true;
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
};

const fmtHM = formatHM;   // 정의는 utils.js 한 곳에
const fmtMin = (m) => fmtHM((Number(m) || 0) / 60);

const tones = (diffMin) => {
    if (diffMin == null) return { text: 'text-gray-500 dark:text-gray-400', bar: 'bg-gray-400' };
    if (diffMin <= 0)    return { text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' };
    if (diffMin <= 30)   return { text: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500' };
    return { text: 'text-rose-600 dark:text-rose-400', bar: 'bg-rose-500' };
};

const render = () => {
    const el = document.getElementById(EL);
    if (!el) return;

    // 오늘 계획이 아직 얼려져 있지 않으면 조용히 하나 찍는다.
    // 여기에 두는 이유: 바쁜 날은 아무도 데이터관리 > 업무 예상 탭을 열지 않는다.
    // 메인 화면이라 아침 첫 접속자가 반드시 지나간다. 내부에 하루 1회 가드가 있다.
    void ensureTodayForecastSnapshot();

    const s = getTodayProgressSummary();
    // 계획도 실적도 없으면(주말·데이터 로딩 전 등) 띠 자체를 숨긴다 — 빈 줄이 자리를 먹지 않도록
    if (!s || (!s.started && s.planHours <= 0)) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');

    const t = tones(s.started ? s.diffMin : null);
    const pct = Math.min(100, Math.max(0, s.pct));

    const right = !s.started
        ? `<span class="text-[11px] font-bold text-gray-400 dark:text-gray-500">아직 시작된 업무 없음</span>`
        : s.finishText == null
            ? `<span class="text-[11px] font-bold text-gray-400 dark:text-gray-500">투입 인원 없음</span>`
            : `<span class="text-[11px] font-bold ${t.text} whitespace-nowrap">종료 예상 ${s.finishText}
                 <span class="font-medium">(${s.diffMin === 0 ? '정시' : s.diffMin > 0 ? `정시 +${fmtMin(s.diffMin)}` : `정시 −${fmtMin(-s.diffMin)}`})</span>
               </span>`;

    el.innerHTML = `
        <div class="flex items-center gap-3 flex-wrap md:flex-nowrap">
            <span class="text-sm font-bold text-gray-700 dark:text-gray-200 whitespace-nowrap">📐 오늘 진행</span>
            <span class="text-[15px] font-extrabold tabular-nums ${t.text} whitespace-nowrap">${s.pct}%</span>
            <div class="flex-1 min-w-[120px] h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                <div class="h-full rounded-full ${t.bar} transition-all" style="width:${pct}%"></div>
            </div>
            <span class="text-[11px] font-medium text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
                ${fmtHM(s.spentHours)} / ${fmtHM(s.planHours)} 인시${s.activeWorkers > 0 ? ` · ${s.activeWorkers}명 투입` : ''}
            </span>
            ${right}
            <span class="text-[11px] font-bold text-indigo-500 dark:text-indigo-300 whitespace-nowrap">자세히 →</span>
        </div>`;
    el.title = `계획 ${fmtHM(s.planHours)} 중 ${fmtHM(s.spentHours)} 소진`
             + (s.started ? `\n기준 종료 ${s.baseFinishText}` : '')
             // 기준 종료가 왜 그 시각인지 띠만 보는 사람도 알 수 있게 (점심 포함 여부)
             + (s.started && s.baseLunchMin > 0
                    ? ` (점심 ${s.baseLunchMin}분 포함 · ${s.baseLunchText})` : '')
             + '\n\n업무 기록의 실제 투입 시간을 계획과 맞춰 본 값입니다. 눌러서 업무별로 볼 수 있습니다.';
};

/** 대시보드에서 한 번 호출. 이력(대부분 캐시)을 실은 뒤 그리고, 1분마다 갱신한다. */
export const initTodayProgressStrip = async () => {
    const el = document.getElementById(EL);
    if (!el) return;

    // 주소 뒤 #forecast-today 를 보고 데이터관리 창이 그 화면을 바로 연다(view-state.js)
    el.addEventListener('click', () => window.open('history.html#forecast-today', '_blank'));

    // 로그인·Firebase 준비가 끝나기 전에 읽으면 실패한다 — 준비될 때까지 기다린다.
    // (대시보드는 로그인 화면이 먼저 뜨는 경우가 있어, 바로 읽으면 permission-denied 가 난다)
    const ready = await waitForAuth();
    if (!ready) return;                       // 로그인하지 않은 채 그대로 두면 띠는 숨겨진 상태로 남는다

    // 저장해 둔 예정 물량까지 실어야 데이터관리의 '오늘 현황'과 같은 계획으로 계산된다
    try {
        await Promise.all([fetchAllHistoryData(), fetchPlannedData()]);
    } catch (e) { console.warn('[today-progress] 자료 로드 실패:', e); }
    render();

    // 오늘 업무 기록은 별도 실시간 구독으로 조금 늦게 도착한다.
    // 처음 한 번만 그리면 그 사이에 '아직 시작된 업무 없음'이 떠 버리므로,
    // 초반 몇 초 동안 몇 번 더 그려 준다.
    [1500, 4000, 8000, 15000].forEach(ms => setTimeout(render, ms));

    clearInterval(timer);
    timer = setInterval(render, 60000);

    // 업무 시작·종료가 반영되면 바로 다시 그린다
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
};

/** 다른 화면에서 값이 바뀌었을 때 즉시 갱신하고 싶을 때 */
export const refreshTodayProgressStrip = () => { try { render(); } catch (e) {} };
