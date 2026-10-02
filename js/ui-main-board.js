// === js/ui-main-board.js ===
import { formatTimeTo24H, formatDuration, calcTotalPauseMinutes, getTodayDateString, isMemberActiveOn } from './utils.js?v=202610021228';
import * as State from './state.js?v=202610021228';
import { leaveTypeLabel } from './state.js?v=202610021228';
import { onLeaveScheduleChanged } from './leave-schedule-sync.js?v=202610021228';
import { getLeaveDisplayLabel } from './ui-main-utils.js?v=202610021228';

// ===== 업무현황 카드 커버플로우(coverflow) 컨트롤러 =====
// 가운데 업무 카드 1개만 크고 선명하게, 양옆 카드는 작고 흐리게 뒤로 물러남.
// - 자동 롤링 없음(수동만): 좌우 화살표/하단 점/양옆 카드 클릭으로 이동, 클릭한 카드가 가운데로
// - _cfIndex(가운데 카드 위치)는 30초 전체 재렌더에도 유지
// - v4.5: 공통업무/그 외 업무 두 줄로 분리 — rowId('common'|'other')별로 독립 상태 유지
let _cfIndex = { common: 0, other: 0 };
let _cfResizeBound = false;

function _cfCards(rowId) {
    const stage = document.getElementById(`task-coverflow-${rowId}`);
    return stage ? Array.from(stage.querySelectorAll(':scope > .cf-card')) : [];
}

function _cfLayout(rowId) {
    const stage = document.getElementById(`task-coverflow-${rowId}`);
    if (!stage) return;
    const cards = _cfCards(rowId);
    const n = cards.length;
    if (n === 0) return;
    _cfIndex[rowId] = Math.max(0, Math.min(_cfIndex[rowId] || 0, n - 1));

    const W = stage.clientWidth || 1;
    const cw = Math.min(440, Math.max(260, W * 0.42)); // 가운데 카드 폭
    cards.forEach((card, i) => {
        card.style.width = cw + 'px';
        const off = i - _cfIndex[rowId];
        const a = Math.abs(off);
        const tx = off * (cw * 0.5);
        const sc = off === 0 ? 1 : (a === 1 ? 0.84 : 0.7);
        const op = off === 0 ? 1 : (a === 1 ? 0.5 : 0.24);
        const bl = off === 0 ? 0 : (a === 1 ? 1.5 : 3);
        card.style.transform = `translate(-50%,-50%) translateX(${tx}px) scale(${sc})`;
        card.style.opacity = a >= 3 ? 0 : op;
        card.style.filter = bl ? `blur(${bl}px)` : 'none';
        card.style.zIndex = String(100 - a);
        card.style.pointerEvents = a >= 3 ? 'none' : 'auto';
        card.style.cursor = off === 0 ? '' : 'pointer';
        card.classList.toggle('is-center', off === 0);
    });

    const dotsWrap = document.getElementById(`task-cf-dots-${rowId}`);
    if (dotsWrap) Array.from(dotsWrap.children).forEach((d, i) => d.classList.toggle('on', i === _cfIndex[rowId]));

    const container = document.getElementById(`task-carousel-${rowId}`);
    if (container) {
        const show = n > 1;
        const prev = container.querySelector('.task-carousel-arrow.prev');
        const next = container.querySelector('.task-carousel-arrow.next');
        if (prev) prev.hidden = !show;
        if (next) next.hidden = !show;
    }
}

function _cfGo(rowId, i) {
    const n = _cfCards(rowId).length;
    if (n === 0) return;
    _cfIndex[rowId] = ((i % n) + n) % n;
    _cfLayout(rowId);
}

function mountTaskCarousel(rowId) {
    const container = document.getElementById(`task-carousel-${rowId}`);
    const stage = document.getElementById(`task-coverflow-${rowId}`);
    if (!container || !stage) return;
    const cards = _cfCards(rowId);
    const n = cards.length;

    if (_cfIndex[rowId] >= n) _cfIndex[rowId] = Math.max(0, n - 1); // 재렌더로 카드 수 변동 시 보정

    // 하단 점 인디케이터
    const dotsWrap = document.getElementById(`task-cf-dots-${rowId}`);
    if (dotsWrap) {
        dotsWrap.innerHTML = '';
        for (let i = 0; i < n; i++) {
            const d = document.createElement('button');
            d.type = 'button';
            d.className = 'task-cf-dot';
            d.setAttribute('aria-label', `${i + 1}번 업무로 이동`);
            d.addEventListener('click', () => _cfGo(rowId, i));
            dotsWrap.appendChild(d);
        }
    }

    // 좌우 화살표
    const prev = container.querySelector('.task-carousel-arrow.prev');
    const next = container.querySelector('.task-carousel-arrow.next');
    if (prev) prev.onclick = () => _cfGo(rowId, _cfIndex[rowId] - 1);
    if (next) next.onclick = () => _cfGo(rowId, _cfIndex[rowId] + 1);

    // 가운데가 아닌 카드를 클릭하면 그 카드를 가운데로 (버튼 동작은 막고 포커스만)
    // 캡처 단계에서 처리해 task-status-board의 위임 클릭보다 먼저 가로챈다.
    stage.addEventListener('click', (e) => {
        const card = e.target.closest('.cf-card');
        if (!card) return;
        const idx = _cfCards(rowId).indexOf(card);
        if (idx !== -1 && idx !== _cfIndex[rowId]) {
            e.preventDefault();
            e.stopPropagation();
            _cfGo(rowId, idx);
        }
    }, true);

    // 모바일 손가락 좌우 스와이프로 카드 넘기기 (세로 스크롤은 유지)
    let _sx = 0, _sy = 0, _st = 0;
    stage.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        _sx = e.touches[0].clientX;
        _sy = e.touches[0].clientY;
        _st = Date.now();
    }, { passive: true });
    stage.addEventListener('touchend', (e) => {
        const t = e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - _sx;
        const dy = t.clientY - _sy;
        const dt = Date.now() - _st;
        // 가로 이동이 충분하고(40px+) 세로보다 우세하며 빠른 제스처일 때만 스와이프로 처리
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3 && dt < 800) {
            e.preventDefault(); // 스와이프 직후 클릭(카드 포커스) 발생 방지
            if (dx < 0) _cfGo(rowId, _cfIndex[rowId] + 1); // 왼쪽으로 밀면 다음
            else _cfGo(rowId, _cfIndex[rowId] - 1);        // 오른쪽으로 밀면 이전
        }
    }, { passive: false });

    _cfLayout(rowId);

    if (!_cfResizeBound) {
        _cfResizeBound = true;
        window.addEventListener('resize', () => { _cfLayout('common'); _cfLayout('other'); });
    }
}

export const renderAttendanceToggle = (appState) => {
    const currentUser = appState.currentUser;
    if (!currentUser) return;

    const attendance = appState.dailyAttendance?.[currentUser];
    const status = attendance?.status;
    const isClockedIn = status === 'active';
    const isReturned = status === 'returned';

    const pcToggle = document.getElementById('pc-attendance-checkbox');
    const mobileToggle = document.getElementById('mobile-attendance-checkbox');
    const pcCancelBtn = document.getElementById('pc-clock-out-cancel-btn');
    const mobileCancelBtn = document.getElementById('mobile-clock-out-cancel-btn');

    if (pcToggle) pcToggle.checked = isClockedIn;
    if (mobileToggle) mobileToggle.checked = isClockedIn;

    if (pcCancelBtn) pcCancelBtn.classList.toggle('hidden', !isReturned);
    if (mobileCancelBtn) mobileCancelBtn.classList.toggle('hidden', !isReturned);
};

export const renderRealtimeStatus = (appState, teamGroups = [], keyTasks = [], isMobileTaskViewExpanded = false, isMobileMemberViewExpanded = false) => {

    const memberToggleBtn = document.getElementById('toggle-all-members-mobile');
    if (memberToggleBtn && memberToggleBtn.textContent === '간략히') {
        isMobileMemberViewExpanded = true;
    }

    const currentUserRole = appState.currentUserRole || 'user';
    const currentUserName = appState.currentUser || null;
    
    const taskStatusBoard = document.getElementById('task-status-board');
    const memberStatusBoard = document.getElementById('member-status-board');
    if (!taskStatusBoard || !memberStatusBoard) return;

    taskStatusBoard.innerHTML = '';
    memberStatusBoard.innerHTML = '';

    const dailyLeaves = Array.isArray(appState.dailyOnLeaveMembers) ? appState.dailyOnLeaveMembers : (appState.dailyOnLeaveMembers ? Object.values(appState.dailyOnLeaveMembers) : []);
    const dateLeaves = Array.isArray(appState.dateBasedOnLeaveMembers) ? appState.dateBasedOnLeaveMembers : [];
    const combinedOnLeaveMembers = [...dailyLeaves, ...dateLeaves];
    
    const onLeaveStatusMap = new Map(
        combinedOnLeaveMembers
            .filter(item => !(item.type === '외출' && item.endTime) && item.type !== '지각')
            .map(item => [item.member, item])
    );
    const onLeaveMemberNames = new Set(onLeaveStatusMap.keys());

    const baseTasks = keyTasks.length > 0 ? keyTasks : ['국내배송', '중국제작', '직진배송', '채우기', '개인담당업무'];

    const ongoingRecords = (appState.workRecords || []).filter(r =>
        (r.status === 'ongoing' || r.status === 'paused') && !onLeaveMemberNames.has(r.member)
    );

    // 카드 정렬 — 1) 본인 진행 업무 → 2) 참여 인원 많은 진행 업무 → 3) 기본 순서
    const allTaskCandidates = [...new Set([...baseTasks, ...ongoingRecords.map(r => r.task)])];

    // task → 고유 참여 멤버 수
    const taskMemberMap = new Map();
    ongoingRecords.forEach(r => {
        if (!taskMemberMap.has(r.task)) taskMemberMap.set(r.task, new Set());
        taskMemberMap.get(r.task).add(r.member);
    });
    const countOf = (task) => (taskMemberMap.get(task)?.size || 0);

    // 현재 사용자가 진행/휴식 중인 업무
    const userOngoingTasks = new Set(
        currentUserName
            ? ongoingRecords.filter(r => r.member === currentUserName).map(r => r.task)
            : []
    );

    const tier1 = []; // 본인이 진행 중인 업무
    const tier2 = []; // 그 외 진행 중인 업무 (참여 인원 많은 순)
    const tier3 = []; // 진행 없는 기본 업무 (baseTasks 원본 순서 유지)
    allTaskCandidates.forEach(task => {
        if (userOngoingTasks.has(task)) tier1.push(task);
        else if (countOf(task) > 0) tier2.push(task);
        else tier3.push(task);
    });
    tier1.sort((a, b) => countOf(b) - countOf(a));
    tier2.sort((a, b) => countOf(b) - countOf(a));

    const tasksToRender = [...tier1, ...tier2, ...tier3];

    // v4.5: 공통업무 vs 그 외 업무(담당/기타/남직원/관리 등) 두 줄로 분리
    // taskGroups(관리자 설정)에서 이름이 '공통'인 그룹의 업무만 위쪽 줄, 나머지는 전부 아래 줄로.
    const taskGroups = State.appConfig?.taskGroups || [];
    const commonGroup = taskGroups.find(g => g && g.name === '공통');
    const commonTaskSet = new Set(commonGroup?.tasks || []);
    const commonTasksToRender = tasksToRender.filter(task => commonTaskSet.has(task));
    const otherTasksToRender = tasksToRender.filter(task => !commonTaskSet.has(task));

    // 업무 카드 1개 생성 (공통/그외 두 줄에서 공용으로 사용)
    const buildTaskCard = (task) => {
        const card = document.createElement('div');
        const groupRecords = ongoingRecords.filter(r => r.task === task);
        const isCurrentUserWorkingOnThisTask = groupRecords.some(r => r.member === currentUserName);
        const isPaused = groupRecords.length > 0 && groupRecords.every(r => r.status === 'paused');
        const isOngoing = groupRecords.some(r => r.status === 'ongoing');
        const mobileVisibilityClass = 'flex'; // 캐러셀: 모든 카드를 트랙에 포함하고 롤링으로 노출 제한

        if (groupRecords.length > 0) {
            const firstRecord = groupRecords[0];
            const headerColor = isPaused ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
            const titleColor = isPaused ? 'text-yellow-800 dark:text-yellow-400' : 'text-blue-800 dark:text-blue-400';
            
            card.className = `${mobileVisibilityClass} flex-col min-h-[280px] bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden transition-all hover:shadow-md cursor-pointer`;
            card.dataset.task = task; 
            card.dataset.groupId = firstRecord.groupId; 

            let membersHtml = '<div class="p-2 overflow-y-auto max-h-48 space-y-1.5 bg-gray-50/50 dark:bg-gray-900/50 flex-grow">';
            groupRecords.sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '')).forEach(rec => {
                const isRecPaused = rec.status === 'paused';
                const pauseMin = calcTotalPauseMinutes(rec.pauses);
                const memberPauseText = pauseMin > 0 ? `<span class="text-[10px] text-gray-400 dark:text-gray-500 ml-1">(휴:${formatDuration(pauseMin)})</span>` : '';

                membersHtml += `
                    <div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-gray-800 border ${isRecPaused ? 'border-yellow-200 dark:border-yellow-700' : 'border-gray-100 dark:border-gray-700'} shadow-sm hover:border-blue-300 dark:hover:border-blue-500 transition-colors member-row">
                        <div class="flex items-start gap-2 overflow-hidden flex-1">
                            <div class="w-2 h-2 shrink-0 rounded-full ${isRecPaused ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'} mt-1.5"></div>
                            <div class="flex flex-col min-w-0">
                                <span class="font-bold text-gray-800 dark:text-gray-200 text-sm truncate" title="${rec.member}">${rec.member}</span>
                                <span class="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                                    (${formatTimeTo24H(rec.startTime)})${memberPauseText}
                                </span>
                            </div>
                        </div>
                        <div class="flex gap-1 shrink-0 member-actions ml-2">
                            ${isRecPaused 
                                ? `<button data-action="resume-individual" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-md bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-800/50 transition" title="재개"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.25l14.25 6.75-14.25 6.75V5.25z" /></svg></button>`
                                : `<button data-action="pause-individual" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-md bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-800/50 transition" title="정지"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg></button>`
                            }
                            <button data-action="stop-individual" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-md bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-800/50 transition" title="종료"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                            <button data-action="edit-individual-start-time" data-record-id="${rec.id}" data-current-start-time="${rec.startTime || ''}" class="w-7 h-7 flex items-center justify-center rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800/50 transition" title="시작시간 수정"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></button>
                        </div>
                    </div>`;
            });
            membersHtml += '</div>';

            const earliestStartTime = groupRecords.reduce((earliest, current) => ((current.startTime && (!earliest || current.startTime < earliest)) ? current.startTime : earliest), null);
            const representativeRecord = groupRecords.find(r => r.startTime === earliestStartTime) || groupRecords[0];
            const pausesJson = JSON.stringify(representativeRecord.pauses || []);
            const totalPauseMinutes = calcTotalPauseMinutes(representativeRecord.pauses);
            const pauseDisplay = totalPauseMinutes > 0 ? `<span class="text-[10px] text-gray-500 font-normal ml-1">(전체휴식: ${formatDuration(totalPauseMinutes)})</span>` : '';

            let specialButtonHtml = '';
            if (task === '샘플검수') {
                specialButtonHtml = `
                    <div class="px-3 pt-3 pb-1 bg-gray-50/50 dark:bg-gray-900/50 shrink-0 border-b border-gray-100 dark:border-gray-800">
                        <button data-action="open-inspection" class="w-full py-2.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800/60 font-extrabold text-sm rounded-xl transition flex justify-center items-center gap-1 shadow-sm border border-purple-200 dark:border-purple-800">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
                            정밀검수 매니저 열기
                        </button>
                    </div>
                `;
            } else if (task === '전량검수') {
                specialButtonHtml = `
                    <div class="px-3 pt-3 pb-1 bg-gray-50/50 dark:bg-gray-900/50 shrink-0 border-b border-gray-100 dark:border-gray-800">
                        <button data-action="open-total-inspection" class="w-full py-2.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-200 dark:hover:bg-indigo-800/60 font-extrabold text-sm rounded-xl transition flex justify-center items-center gap-1 shadow-sm border border-indigo-200 dark:border-indigo-800">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
                            전량검수 창 열기
                        </button>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="px-4 py-3 ${headerColor} border-b flex justify-between items-start shrink-0">
                    <div>
                        <h3 class="font-bold text-lg ${titleColor} tracking-tight">${task}</h3>
                        <div class="text-[11px] ${isPaused ? 'text-yellow-700 dark:text-yellow-500' : 'text-blue-600 dark:text-blue-400'} mt-1 font-bold group-time-display cursor-pointer" data-action="edit-group-start-time" data-group-id="${firstRecord.groupId}" data-current-start-time="${earliestStartTime || ''}" title="그룹 시작시간 수정">
                            시작: ${formatTimeTo24H(earliestStartTime)}
                            <span class="ongoing-duration ml-1 font-extrabold" data-start-time="${earliestStartTime || ''}" data-status="${isOngoing ? 'ongoing' : 'paused'}" data-pauses-json='${pausesJson}'></span>
                            ${pauseDisplay}
                        </div>
                    </div>
                    <span class="px-2 py-1 ${isPaused ? 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300' : 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'} text-xs font-bold rounded-full shadow-sm">${groupRecords.length}명 참여</span>
                </div>
                ${specialButtonHtml}
                ${membersHtml}
                <div class="p-3 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 flex gap-2 shrink-0 card-actions">
                    <button data-task="${task}" class="${isPaused ? 'resume-work-group-btn bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800/60' : 'pause-work-group-btn bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-200 dark:hover:bg-yellow-800/60'} flex-1 py-2 font-bold text-sm rounded-xl transition flex justify-center items-center gap-1 shadow-sm">${isPaused ? '▶ 전체재개' : '⏸ 전체정지'}</button>
                    <button data-task="${task}" class="stop-work-group-btn flex-1 py-2 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800/60 font-bold text-sm rounded-xl transition flex justify-center items-center gap-1 shadow-sm">⏹ 전체종료</button>
                </div>
            `;
        } else {
            card.className = `${mobileVisibilityClass} flex-col justify-center items-center min-h-[280px] bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-blue-400 dark:hover:border-blue-500 transition-all group`;
            card.dataset.action = 'start-task';
            card.dataset.task = task;
            card.innerHTML = `
                <div class="w-14 h-14 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full shadow-sm flex items-center justify-center text-gray-400 group-hover:text-blue-500 dark:group-hover:text-blue-400 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30 group-hover:border-blue-200 dark:group-hover:border-blue-800 transition-all mb-4 text-2xl font-light">+</div>
                <h3 class="font-bold text-lg text-gray-600 dark:text-gray-300 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">${task} 시작</h3>
                <p class="text-xs text-gray-400 dark:text-gray-500 mt-2 font-medium">클릭하여 인원 선택</p>
            `;
        }
        card.classList.add('cf-card'); // 커버플로우 카드 (className 할당 이후에 추가)
        return card;
    };

    const buildOtherTaskCard = () => {
        const otherTaskCard = document.createElement('div');
        otherTaskCard.className = `flex flex-col justify-center items-center min-h-[280px] bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500 transition-all group`;
        otherTaskCard.classList.add('cf-card');
        otherTaskCard.dataset.action = 'other';
        otherTaskCard.innerHTML = `
            <div class="w-14 h-14 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full shadow-sm flex items-center justify-center text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 group-hover:bg-gray-100 dark:group-hover:bg-gray-600 transition-all mb-4 text-xl">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <h3 class="font-bold text-lg text-gray-600 dark:text-gray-300">기타 업무</h3>
            <p class="text-xs text-gray-400 dark:text-gray-500 mt-2 font-medium">새로운 업무 만들기</p>
        `;
        return otherTaskCard;
    };

    // 커버플로우 한 줄(row) 생성 — rowId별 독립 DOM/상태('common'|'other')
    const buildCarouselRow = (rowId, label, tasks, appendOtherCard) => {
        const rowWrap = document.createElement('div');
        rowWrap.className = 'task-carousel-row';

        const rowLabel = document.createElement('div');
        rowLabel.className = 'task-row-label';
        rowLabel.textContent = label;
        rowWrap.appendChild(rowLabel);

        const presetTaskContainer = document.createElement('div');
        presetTaskContainer.className = 'task-carousel relative';
        presetTaskContainer.id = `task-carousel-${rowId}`;
        presetTaskContainer.innerHTML = `
            <button type="button" class="task-carousel-arrow prev" aria-label="이전 업무" hidden>
                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
            </button>
            <button type="button" class="task-carousel-arrow next" aria-label="다음 업무" hidden>
                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
            </button>`;

        const presetGrid = document.createElement('div');
        presetGrid.className = 'task-coverflow';
        presetGrid.id = `task-coverflow-${rowId}`;

        tasks.forEach(task => presetGrid.appendChild(buildTaskCard(task)));
        if (appendOtherCard) presetGrid.appendChild(buildOtherTaskCard());

        if (presetGrid.children.length === 0) {
            const emptyNote = document.createElement('div');
            emptyNote.className = 'task-row-empty';
            emptyNote.textContent = '표시할 업무가 없습니다.';
            presetGrid.appendChild(emptyNote);
        }

        presetTaskContainer.appendChild(presetGrid);
        rowWrap.appendChild(presetTaskContainer);

        const cfDots = document.createElement('div');
        cfDots.className = 'task-cf-dots';
        cfDots.id = `task-cf-dots-${rowId}`;
        rowWrap.appendChild(cfDots);

        return rowWrap;
    };

    const carouselStack = document.createElement('div');
    carouselStack.className = 'task-carousel-stack';
    carouselStack.appendChild(buildCarouselRow('common', '공통업무', commonTasksToRender, false));
    carouselStack.appendChild(buildCarouselRow('other', '그 외 업무', otherTasksToRender, true));

    // ── 우측 빠른시작 리스트: 진행중 업무(이름카드, 공통/그외 두 줄) + 기타 업무 ──
    const quickList = document.createElement('div');
    quickList.className = 'task-quick-list';
    const ongoingTasks = [...tier1, ...tier2]; // 진행 중인 업무 (본인 → 참여 많은 순)
    const ongoingCommon = ongoingTasks.filter(task => commonTaskSet.has(task));
    const ongoingOther = ongoingTasks.filter(task => !commonTaskSet.has(task));

    // 빠른시작 항목 1개 HTML (커버플로우 카드 클릭과 동일한 data-cf-focus 위임)
    const buildQuickItem = (task) => {
        const grp = ongoingRecords.filter(r => r.task === task);
        const cnt = new Set(grp.map(r => r.member)).size;
        const paused = grp.length > 0 && grp.every(r => r.status === 'paused');
        return `
            <div class="task-quick-card" data-cf-focus="${task}" title="'${task}' 업무 카드 보기">
                <span class="task-quick-dot ${paused ? 'is-paused' : 'is-on'}"></span>
                <span class="task-quick-name">${task}</span>
                <span class="task-quick-badge">${cnt}</span>
            </div>`;
    };

    let quickHtml = `<div class="task-quick-title">공통업무</div>`;
    quickHtml += ongoingCommon.length > 0
        ? ongoingCommon.map(buildQuickItem).join('')
        : `<div class="task-quick-empty">진행 중인 공통업무가 없습니다</div>`;

    quickHtml += `<div class="task-quick-title task-quick-title-second">그 외 업무</div>`;
    quickHtml += ongoingOther.length > 0
        ? ongoingOther.map(buildQuickItem).join('')
        : `<div class="task-quick-empty">진행 중인 업무가 없습니다</div>`;

    // 기타 업무(새 업무 시작) — data-action="other" 위임 핸들러 재사용
    quickHtml += `
        <div class="task-quick-card task-quick-other" data-action="other" title="새 업무 시작">
            <span class="task-quick-plus">+</span>
            <span class="task-quick-name">기타 업무</span>
        </div>`;
    quickList.innerHTML = quickHtml;

    // 진행중 항목 클릭 → 해당 업무가 속한 줄(공통/그외)의 커버플로우에서 그 업무 카드를 가운데로
    quickList.addEventListener('click', (e) => {
        const item = e.target.closest('[data-cf-focus]');
        if (!item) return;
        const task = item.dataset.cfFocus;
        const rowId = commonTaskSet.has(task) ? 'common' : 'other';
        const idx = _cfCards(rowId).findIndex(c => c.dataset.task === task);
        if (idx >= 0) _cfGo(rowId, idx);
    });

    // ── 좌(커버플로우 두 줄) + 우(빠른시작) 레이아웃 ──
    const boardLayout = document.createElement('div');
    boardLayout.className = 'task-board-layout';
    boardLayout.appendChild(carouselStack);
    boardLayout.appendChild(quickList);

    taskStatusBoard.appendChild(boardLayout);

    mountTaskCarousel('common');
    mountTaskCarousel('other');

    const allMembersContainer = document.createElement('div');
    allMembersContainer.id = 'all-members-container';
    if (isMobileMemberViewExpanded) allMembersContainer.classList.add('mobile-expanded');
    
    allMembersContainer.innerHTML = ``;

    const ongoingMembers = new Set(ongoingRecords.filter(r => r.status === 'ongoing').map(r => r.member));
    const pausedMembers = new Set(ongoingRecords.filter(r => r.status === 'paused').map(r => r.member));
    const workingMembersMap = new Map(ongoingRecords.map(r => [r.member, r.task]));

    const orderedTeamGroups = [
        teamGroups.find(g => g.name === '관리'), teamGroups.find(g => g.name === '공통파트'), teamGroups.find(g => g.name === '담당파트'), teamGroups.find(g => g.name === '제작파트')
    ].filter(Boolean);

    orderedTeamGroups.forEach(group => {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'mb-6';
        groupContainer.innerHTML = `<div class="flex items-center gap-2 mb-3 hidden md:flex"><h4 class="text-sm font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">${group.name}</h4><div class="h-px bg-gray-200 dark:bg-gray-700 flex-grow"></div></div>`;
        const groupGrid = document.createElement('div');
        groupGrid.className = 'flex flex-wrap gap-2.5';
        
        [...new Set(group.members)].forEach(member => {
            if (!isMemberActiveOn(member, null, State.appConfig)) return; // 🚪 퇴사자(오늘 기준 비활성) 제외
            const card = document.createElement('button');
            const leaveInfo = onLeaveStatusMap.get(member);
            const isOnLeave = !!leaveInfo;
            const isWorking = ongoingMembers.has(member) || pausedMembers.has(member);
            
            const attendance = appState.dailyAttendance?.[member];
            const isClockedIn = attendance && attendance.status === 'active';
            const isReturned = attendance && attendance.status === 'returned';
            
            const isSelf = (member === currentUserName);
            const visibilityClass = (isSelf || isMobileMemberViewExpanded) ? 'flex' : 'hidden md:flex mobile-member-hidden';
            
            card.className = `p-2 rounded-xl border text-center transition-all min-h-[76px] ${visibilityClass} ${isSelf ? 'w-full md:w-[110px]' : 'w-[110px]'} flex-col justify-center shadow-sm`;
            card.dataset.memberName = member;

            if (isOnLeave) {
                card.dataset.action = 'member-toggle-leave'; 
                card.dataset.leaveType = leaveInfo.type; 
                card.dataset.startTime = leaveInfo.startTime || ''; 
                card.dataset.startDate = leaveInfo.startDate || ''; 
                card.dataset.endTime = leaveInfo.endTime || ''; 
                card.dataset.endDate = leaveInfo.endDate || '';
                
                card.className += ' bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400';
                if (currentUserRole === 'admin' || isSelf) {
                    card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30';
                } else {
                    card.className += ' cursor-not-allowed';
                }
                
                const displayLabel = getLeaveDisplayLabel(member, leaveInfo);
                let detailText = leaveInfo.startTime ? formatTimeTo24H(leaveInfo.startTime) + (leaveInfo.endTime ? ` - ${formatTimeTo24H(leaveInfo.endTime)}` : (leaveInfo.type === '외출' ? ' ~' : '')) : (leaveInfo.startDate ? leaveInfo.startDate.substring(5) + (leaveInfo.endDate && leaveInfo.endDate !== leaveInfo.startDate ? ` ~ ${leaveInfo.endDate.substring(5)}` : '') : '');
                
                card.innerHTML = `<div class="font-extrabold text-sm text-gray-600 dark:text-gray-300 mb-0.5">${member}</div><div class="text-[11px] font-bold text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded inline-block">${displayLabel}</div>${detailText ? `<div class="text-[10px] mt-1 text-gray-400 dark:text-gray-500">${detailText}</div>` : ''}`;
            } else if (isWorking) {
                card.dataset.action = 'member-toggle-leave';
                card.className += ' opacity-80 cursor-not-allowed';
                
                if (ongoingMembers.has(member)) {
                    card.className += ' bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
                } else {
                    card.className += ' bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
                }

                card.innerHTML = `<div class="font-extrabold text-sm ${ongoingMembers.has(member) ? 'text-red-700 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'} mb-1">${member}</div><div class="text-[10px] font-bold ${ongoingMembers.has(member) ? 'text-red-500 dark:text-red-500' : 'text-yellow-600 dark:text-yellow-500'} truncate px-1" title="${workingMembersMap.get(member)}">${ongoingMembers.has(member) ? workingMembersMap.get(member) : '휴식 중'}</div>`;
            } else if (isClockedIn) {
                card.dataset.action = 'member-toggle-leave';
                card.className += ' bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
                if (currentUserRole === 'admin' || isSelf) {
                    card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500';
                } else {
                    card.className += ' cursor-not-allowed opacity-70';
                }
                card.innerHTML = `<div class="font-extrabold text-sm text-green-700 dark:text-green-400 mb-1">${member}</div><div class="text-[11px] font-bold text-green-600 dark:text-green-500">대기 중</div>`;
            } else if (isReturned) {
                card.dataset.action = 'member-toggle-leave';
                card.className += ' bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700';
                if (currentUserRole === 'admin' || isSelf) {
                    card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500';
                } else {
                    card.className += ' cursor-not-allowed opacity-60';
                }
                card.innerHTML = `<div class="font-extrabold text-sm text-gray-600 dark:text-gray-300 mb-1">${member}</div><div class="text-[11px] font-medium text-gray-400 dark:text-gray-500">퇴근 완료</div>`;
            } else {
                card.dataset.action = 'member-toggle-leave';
                card.className += ' bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 opacity-60';
                 if (currentUserRole === 'admin' || isSelf) {
                     card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500';
                 } else {
                     card.className += ' cursor-not-allowed';
                 }
                card.innerHTML = `<div class="font-extrabold text-sm mb-1">${member}</div><div class="text-[11px] font-medium text-gray-400 dark:text-gray-500">출근 전</div>`;
            }
            groupGrid.appendChild(card);
        });
        groupContainer.appendChild(groupGrid);
        allMembersContainer.appendChild(groupContainer);
    });

    const activePartTimers = (appState.partTimers || []).filter(pt => ongoingMembers.has(pt.name) || onLeaveStatusMap.has(pt.name) || appState.dailyAttendance?.[pt.name]);
    if (activePartTimers.length > 0) {
        const albaContainer = document.createElement('div'); albaContainer.className = 'mb-6'; 
        albaContainer.innerHTML = `<div class="flex items-center gap-2 mb-3 hidden md:flex"><h4 class="text-sm font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">알바</h4><div class="h-px bg-gray-200 dark:bg-gray-700 flex-grow"></div></div>`;
        const albaGrid = document.createElement('div'); albaGrid.className = 'flex flex-wrap gap-2.5';
        
        activePartTimers.forEach(pt => {
             const card = document.createElement('button');
             const isSelfAlba = (pt.name === currentUserName);
             const visibilityClassAlba = (isSelfAlba || isMobileMemberViewExpanded) ? 'flex' : 'hidden md:flex mobile-member-hidden';
             
             card.className = `p-2 rounded-xl border text-center transition-all min-h-[76px] ${visibilityClassAlba} ${isSelfAlba ? 'w-full md:w-[110px]' : 'w-[110px]'} flex-col justify-center shadow-sm`;
             
             const albaLeaveInfo = onLeaveStatusMap.get(pt.name);
             const isAlbaOnLeave = !!albaLeaveInfo;
             const isAlbaWorking = workingMembersMap.has(pt.name) || pausedMembers.has(pt.name);
             const albaAttendance = appState.dailyAttendance?.[pt.name];
             const isAlbaClockedIn = albaAttendance && albaAttendance.status === 'active';
             const isAlbaReturned = albaAttendance && albaAttendance.status === 'returned';

            card.dataset.memberName = pt.name;
            
            if (isAlbaOnLeave) {
                card.dataset.action = 'member-toggle-leave'; card.dataset.leaveType = albaLeaveInfo.type; card.dataset.startTime = albaLeaveInfo.startTime || ''; card.dataset.startDate = albaLeaveInfo.startDate || ''; card.dataset.endTime = albaLeaveInfo.endTime || ''; card.dataset.endDate = albaLeaveInfo.endDate || '';
                
                card.className += ' bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400';
                if (currentUserRole === 'admin' || isSelfAlba) {
                    card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30';
                } else {
                    card.className += ' cursor-not-allowed';
                }

                const displayLabel = getLeaveDisplayLabel(pt.name, albaLeaveInfo);
                let detailText = albaLeaveInfo.startTime ? formatTimeTo24H(albaLeaveInfo.startTime) + (albaLeaveInfo.endTime ? ` - ${formatTimeTo24H(albaLeaveInfo.endTime)}` : (albaLeaveInfo.type === '외출' ? ' ~' : '')) : (albaLeaveInfo.startDate ? albaLeaveInfo.startDate.substring(5) + (albaLeaveInfo.endDate && albaLeaveInfo.endDate !== albaLeaveInfo.startDate ? ` ~ ${albaLeaveInfo.endDate.substring(5)}` : '') : '');
                card.innerHTML = `<div class="font-extrabold text-sm text-gray-600 dark:text-gray-300 mb-0.5">${pt.name}</div><div class="text-[11px] font-bold text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded inline-block">${displayLabel}</div>${detailText ? `<div class="text-[10px] mt-1 text-gray-400 dark:text-gray-500">${detailText}</div>` : ''}`;
            } else if (isAlbaWorking) {
                card.dataset.action = 'member-toggle-leave';
                card.className += ' opacity-80 cursor-not-allowed';
                
                if (ongoingMembers.has(pt.name)) {
                    card.className += ' bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
                } else {
                    card.className += ' bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
                }

                card.innerHTML = `<div class="font-extrabold text-sm ${ongoingMembers.has(pt.name) ? 'text-red-700 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'} mb-1">${pt.name}</div><div class="text-[10px] font-bold ${ongoingMembers.has(pt.name) ? 'text-red-500 dark:text-red-500' : 'text-yellow-600 dark:text-yellow-500'} truncate px-1">${ongoingMembers.has(pt.name) ? workingMembersMap.get(pt.name) : '휴식 중'}</div>`;
            } else if (isAlbaClockedIn) {
                 card.dataset.action = 'member-toggle-leave';
                 card.className += ' bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
                 if (currentUserRole === 'admin' || isSelfAlba) {
                     card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500';
                 } else {
                     card.className += ' cursor-not-allowed opacity-70';
                 }
                 card.innerHTML = `<div class="font-extrabold text-sm text-green-700 dark:text-green-400 mb-1">${pt.name}</div><div class="text-[11px] font-bold text-green-600 dark:text-green-500">대기 중</div>`;
            } else if (isAlbaReturned) {
                 card.dataset.action = 'member-toggle-leave';
                 card.className += ' bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700';
                 if (currentUserRole === 'admin' || isSelfAlba) {
                     card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500';
                 } else {
                     card.className += ' cursor-not-allowed opacity-60';
                 }
                 card.innerHTML = `<div class="font-extrabold text-sm text-gray-600 dark:text-gray-300 mb-1">${pt.name}</div><div class="text-[11px] font-medium text-gray-400 dark:text-gray-500">퇴근 완료</div>`;
            } else {
                 card.dataset.action = 'member-toggle-leave';
                 card.className += ' bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 opacity-60';
                 if (currentUserRole === 'admin' || isSelfAlba) {
                     card.className += ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500';
                 } else {
                     card.className += ' cursor-not-allowed';
                 }
                 card.innerHTML = `<div class="font-extrabold text-sm mb-1">${pt.name}</div><div class="text-[11px] font-medium text-gray-400 dark:text-gray-500">출근 전</div>`;
            }
             albaGrid.appendChild(card);
        });
        albaContainer.appendChild(albaGrid); allMembersContainer.appendChild(albaContainer);
    }
    
    memberStatusBoard.appendChild(allMembersContainer);

    renderAttendanceToggle(appState);
    renderLeaveScheduleWidget();
};

// 🔗 근태가 어디서 바뀌든(연차관리 모달·캘린더·데이터관리·다른 사용자) 이 위젯을 다시 그린다.
onLeaveScheduleChanged('leave-widget', () => {
    try { renderLeaveScheduleWidget(); } catch (e) { console.warn('근태예정 위젯 갱신 실패:', e); }
});

// 🗓️ 근태 예정 리스트 위젯 (전체 팀원 현황 옆) — 당일 포함 예정된 근태만 표시
export const renderLeaveScheduleWidget = () => {
    const el = document.getElementById('leave-schedule-widget');
    if (!el) return;
    const today = getTodayDateString();
    const leaves = (State.persistentLeaveSchedule && State.persistentLeaveSchedule.onLeaveMembers) || [];

    const items = leaves.map(l => {
        const start = l.startDate || l.date || (l.startTime ? String(l.startTime).substring(0, 10) : '');
        const end = l.endDate || start;
        return { member: l.member || l.name || '', type: l.type || '', customLabel: l.customLabel || '', start, end };
    }).filter(l => l.start && l.end >= today)
      .sort((a, b) => (a.start || '').localeCompare(b.start || '')
                   || (a.end || '').localeCompare(b.end || '')
                   || (a.member || '').localeCompare(b.member || ''));

    if (!items.length) {
        el.innerHTML = '<div class="text-xs text-gray-400 dark:text-gray-500 italic py-3 text-center">예정된 근태가 없습니다.</div>';
        return;
    }

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const mk = (ds) => { const p = String(ds).split('-'); return `${Number(p[1])}/${Number(p[2])}`; };
    const dLabel = (start, end) => {
        const diff = Math.round((new Date(start) - new Date(today)) / 86400000);
        let head = diff === 0 ? '오늘' : (diff === 1 ? '내일' : mk(start));
        if (end && end !== start) head += `~${mk(end)}`;
        return head;
    };
    const tone = (t) => {
        if (t.includes('연차') || t.includes('반차')) return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
        if (t.includes('출장') || t.includes('외근') || t.includes('외출')) return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300';
        if (t.includes('결근')) return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
        if (t.includes('재택')) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
        if (t.includes('매장')) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
        if (t.includes('휴직')) return 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-200';
        return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
    };

    // 같은 시작일(+기간)은 한 줄에 묶어서 표시 — 날짜를 근태마다 반복하지 않는다.
    const groups = [];
    const byKey = new Map();
    items.forEach(l => {
        const key = `${l.start}|${l.end}`;
        let g = byKey.get(key);
        if (!g) {
            g = { start: l.start, end: l.end, members: [] };
            byKey.set(key, g);
            groups.push(g);
        }
        g.members.push({ member: l.member, type: l.type, customLabel: l.customLabel });
    });

    el.innerHTML = groups.map((g, i) => {
        const isToday = g.start <= today && g.end >= today;
        // 같은 날짜 안의 근태는 세로로 한 줄씩 쌓는다.
        // 한 줄 = [날짜] [이름 … 유형배지] — 두 열 모두 고정 폭이라
        // 행이 달라도 이름 시작과 배지 오른쪽 끝이 같은 자리에 선다.
        const chips = g.members.map(m => `
            <span class="flex items-center gap-1.5 w-full min-h-[18px]">
                <span class="text-xs font-bold text-gray-800 dark:text-gray-200 truncate" title="${esc(m.member)}">${esc(m.member)}</span>
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ml-auto ${tone(m.type)}" title="${esc(leaveTypeLabel(m))}">${esc(leaveTypeLabel(m))}</span>
            </span>`).join('');
        // 날짜 그룹 사이를 가로선으로 나눈다(마지막 줄은 제외).
        const divider = (i < groups.length - 1) ? ' border-b border-gray-100 dark:border-gray-700' : '';
        return `<div class="flex items-start gap-2 px-2 py-2${divider} ${isToday ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'} transition-colors">
            <span class="text-[10px] font-bold tabular-nums whitespace-nowrap ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'} w-[66px] shrink-0 pt-1">${esc(dLabel(g.start, g.end))}</span>
            <span class="flex-1 min-w-0 flex flex-col gap-1">${chips}</span>
        </div>`;
    }).join('');
};

export const renderCompletedWorkLog = (appState) => {
    const workLogBody = document.getElementById('work-log-body');
    if (!workLogBody) return;
    workLogBody.innerHTML = '';

    const allRecords = appState.workRecords || [];
    const completedRecords = allRecords.filter(r => r.status === 'completed');

    if (completedRecords.length === 0) {
        workLogBody.innerHTML = `<div class="text-center py-10 text-gray-400 dark:text-gray-500 text-sm font-medium">오늘 완료된 업무가 없습니다.</div>`;
        return;
    }

    completedRecords.sort((a, b) => (b.endTime || '').localeCompare(a.endTime || ''));

    completedRecords.forEach(record => {
        const item = document.createElement('div');
        item.className = 'bg-white dark:bg-gray-800 p-3.5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm mb-2.5 hover:border-blue-300 dark:hover:border-blue-500 transition-colors relative group';
        
        const pauseMin = calcTotalPauseMinutes(record.pauses);
        const pauseText = pauseMin > 0 ? `<span class="text-[10px] text-gray-400 dark:text-gray-500 ml-1 font-normal">(휴:${formatDuration(pauseMin)} 포함)</span>` : '';
        
        item.innerHTML = `
            <div class="flex justify-between items-center mb-1.5">
                <span class="font-extrabold text-sm text-gray-800 dark:text-gray-200">${record.task}</span>
                <span class="text-[11px] font-bold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 px-2 py-0.5 rounded-md shadow-sm">${formatDuration(record.duration)}</span>
            </div>
            <div class="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400 font-medium">
                <div class="flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full"></span>
                    ${record.member}
                </div>
                <div>${formatTimeTo24H(record.startTime)} ~ ${formatTimeTo24H(record.endTime)}${pauseText}</div>
            </div>
            <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white/95 dark:bg-gray-800/95 backdrop-blur px-1.5 py-1 rounded-md shadow-sm border border-gray-100 dark:border-gray-700 flex gap-3">
                <button data-action="edit" data-record-id="${record.id}" class="text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-bold tracking-wide">수정</button>
                <div class="w-px bg-gray-200 dark:bg-gray-600"></div>
                <button data-action="delete" data-record-id="${record.id}" class="text-[11px] text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-bold tracking-wide">삭제</button>
            </div>
        `;
        workLogBody.appendChild(item);
    });
};

const setupMobileRefreshButton = () => {
    if (document.getElementById('mobile-refresh-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'mobile-refresh-btn';
    btn.className = 'fixed bottom-6 right-6 w-12 h-12 bg-blue-600/90 text-white rounded-full shadow-lg z-50 md:hidden flex items-center justify-center';
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>`;
    btn.onclick = () => window.location.reload();
    document.body.appendChild(btn);
};
setupMobileRefreshButton();