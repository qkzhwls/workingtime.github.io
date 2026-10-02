// === js/ui-main-dashboard.js ===
import { getAllDashboardDefinitions } from './ui.js?v=202610021042';
import * as State from './state.js?v=202610021042';
import { getRegularMembersForCount } from './utils.js?v=202610021042';
import { withBuiltinMenus } from './menu-catalog.js?v=202610021042';
import { onEzadminChange, 상태 as ezadmin상태, STALE_분 } from './ezadmin-sync.js?v=202610021042';

// 확장(ezadmin-bridge)이 postMessage 로 넘겨 주는 값. **폴백 전용.**
// 확장 payload 에는 시각이 없어서(invoice·delivery 뿐) 받은 시각을 여기서 직접 찍어 둔다.
export let currentEzadminData = null;
let 확장받은때 = 0;
const 확장_유효_분 = 5;

// 실시간 인원 현황 행 중 상세 펼침을 지원할 항목들
const EXPANDABLE_ITEMS = new Set(['leave-staff', 'idle-staff', 'working-staff', 'ongoing-tasks']);
// 가장 최근에 계산된 상세 데이터 (호버 툴팁용)
let lastPersonnelDetail = null;

/** 공지 일정 표시용. 지난 일정·오늘·앞으로를 색으로 구분한다.
 *  반환 { text, tone } / 일정이 없으면 null. */
const noticeScheduleLabel = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(v || ''));
    if (!m) return null;
    const [, y, mo, d, hh, mi] = m;
    const wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(Number(y), Number(mo) - 1, Number(d)).getDay()];
    const time = (hh && !(hh === '00' && mi === '00')) ? ` ${hh}:${mi}` : '';

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(Number(y), Number(mo) - 1, Number(d));
    const diff = Math.round((day - today) / 86400000);

    let when = '', tone = 'text-red-600 dark:text-red-400';
    if (diff < 0) { when = ` · ${-diff}일 지남`; tone = 'text-gray-400 dark:text-gray-500'; }
    else if (diff === 0) { when = ' · 오늘'; tone = 'text-red-600 dark:text-red-400'; }
    else if (diff === 1) when = ' · 내일';
    else if (diff <= 7) when = ` · ${diff}일 뒤`;
    else tone = 'text-gray-500 dark:text-gray-400';

    return { text: `${Number(mo)}월 ${Number(d)}일(${wd})${time}${when}`, tone };
};

export const renderNoticeWidget = (appState) => {
    const memoList = document.getElementById('widget-memo-list');
    if (!memoList) return;

    const notices = appState.importantNotices || [];

    const countEl = document.getElementById('widget-notice-count');
    if (countEl) countEl.textContent = notices.length;

    if (notices.length === 0) {
        memoList.innerHTML = `<li class="list-none text-yellow-700/60 dark:text-yellow-500/60 text-center text-xs px-3 py-3 font-normal">등록된 중요 공지사항이 없습니다.</li>`;
        return;
    }

    // 일정이 있는 공지를 먼저(이른 날짜순), 일정 없는 것은 최근 등록순으로 뒤에
    const ordered = [...notices].sort((a, b) => {
        if (a.scheduleAt && b.scheduleAt) return a.scheduleAt.localeCompare(b.scheduleAt);
        if (a.scheduleAt) return -1;
        if (b.scheduleAt) return 1;
        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    let html = '';
    ordered.forEach(notice => {
        const textClass = notice.completed ? 'line-through text-yellow-700/50 dark:text-yellow-500/50' : 'text-yellow-900 dark:text-yellow-200 font-bold';
        const icon = notice.completed ? '✅' : '📌';

        const safeText = notice.text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>');

        const mentionStyle = '<span class="inline-block bg-indigo-100/80 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700/50 rounded-md px-1.5 py-0 text-[10px] font-black mx-1 align-middle shadow-sm leading-tight">@$1</span>';
        const highlightedText = safeText.replace(/@([가-힣a-zA-Z0-9]+)/g, mentionStyle);

        const sched = noticeScheduleLabel(notice.scheduleAt);
        const schedHtml = sched ? `<span class="block mt-1 text-xs font-bold ${sched.tone}">🗓 ${sched.text}</span>` : '';

        html += `<li class="${textClass} list-none flex items-start gap-2 px-3 py-2"><span class="shrink-0 text-sm mt-0.5">${icon}</span> <span class="leading-snug break-words flex-1">${highlightedText}${schedHtml}</span></li>`;
    });
    memoList.innerHTML = html;
};

/** 지금 무엇을 보여 줄지 고른다.
 *
 *  Firestore(상주 수집기) 가 1순위다. 그게 오래됐거나 없으면 확장 값을 폴백으로 쓴다.
 *  ⚠️ '더 최신 것을 쓴다' 는 불가능하다 — 확장 payload 에 시각이 없다. 그래서
 *     '신선한 쪽을 우선' 이라는 규칙으로 정한다.
 */
const EZ사유문구 = {
    'not-logged-in': '이지어드민 로그인 끊김',
    'no-element': '이지어드민 화면이 바뀜',
    'partial-element': '이지어드민 화면이 일부 바뀜',
    'empty-value': '숫자를 못 읽음',
    'nav-failed': '화면 접속 실패',
};

const ezadmin표시값 = () => {
    const fs = ezadmin상태();
    if (fs.있음 && !fs.오래됨) {
        return { invoice: fs.invoice, delivery: fs.delivery,
                 라벨: fs.라벨, 흐림: false, 출처: '' };
    }
    if (fs.있음) {
        // Firestore 값이 오래됐다 — 왜 그런지(error)를 같이 알려 줘야 조치가 갈린다.
        const 사유 = !fs.ok && fs.error
            ? (EZ사유문구[fs.error] || fs.error)
            : '수집기 멈춤?';
        return { invoice: fs.invoice, delivery: fs.delivery,
                 라벨: `${fs.라벨 || `${STALE_분}분 넘게 갱신 없음`} · ${사유}`,
                 흐림: true, 사유 };
    }
    // Firestore 값이 아예 없다 → 확장 값이라도 쓴다(수집기를 아직 안 돌리는 PC).
    // ⚠️ 확장 payload 에는 시각이 없다. 오래됐다고 숫자를 지우면, 예전엔 보이던 숫자가
    //    사라져 "연동이 깨졌다" 로 읽힌다. 그래서 **값은 계속 보여 주고 흐리게만** 한다.
    if (currentEzadminData) {
        // Firestore 쪽과 같은 기준 — 숫자가 아니면 '값이 없다' 로 본다.
        // `|| 0` 을 쓰면 확장이 빈 값을 보낸 순간 '송장 0건' 이 멀쩡히 표시된다.
        const e1 = Number(currentEzadminData.invoice);
        const e2 = Number(currentEzadminData.delivery);
        if (Number.isFinite(e1) && Number.isFinite(e2)) {
            const 지남 = (Date.now() - 확장받은때) / 60000;
            const 오래 = 지남 >= 확장_유효_분;
            return { invoice: e1, delivery: e2,
                     라벨: 오래 ? `확장 기준 · ${Math.floor(지남)}분 전` : '확장 기준',
                     흐림: 오래, 사유: 오래 ? '좀비창이 멈췄을 수 있습니다' : '' };
        }
    }
    // ★ 숫자는 없지만 '왜 없는지' 는 알 때가 있다 — 수집기가 한 번도 성공하지 못한 경우다
    //   (화면 개편이면 invoice·delivery·lastOkAt 이 아예 안 쓰인다).
    //   그걸 '연동 대기 중' 으로 보여 주면 "아직 안 켰다" 로 읽혀 아무도 손대지 않는다.
    if (fs.ok === false && fs.error) {
        return { invoice: null, delivery: null,
                 라벨: EZ사유문구[fs.error] || fs.error, 흐림: true,
                 사유: '수집기가 숫자를 한 번도 읽지 못했습니다' };
    }
    return null;          // 아직 아무 값도 없다 → '연동 대기 중'
};

export const updateEzadminDisplay = () => {
    const invoiceEl = document.getElementById('ezadmin-invoice-count');
    const deliveryEl = document.getElementById('ezadmin-delivery-count');
    const 라벨El = document.getElementById('ezadmin-asof');
    if (!invoiceEl && !deliveryEl && !라벨El) return;

    const v = ezadmin표시값();
    if (v && v.invoice == null) {
        // 사유는 아는데 숫자는 없는 상태 — 숫자 자리는 비우고 사유를 빨갛게 보여 준다.
        if (invoiceEl) { invoiceEl.textContent = '–'; invoiceEl.classList.add('opacity-50'); }
        if (deliveryEl) { deliveryEl.textContent = '–'; deliveryEl.classList.add('opacity-50'); }
        if (라벨El) {
            라벨El.textContent = v.라벨;
            라벨El.className = 'mt-1.5 text-[10px] font-bold text-rose-500 dark:text-rose-400';
            라벨El.title = [v.사유, '앱 폴더의 이지어드민연동/로그 를 확인하세요.']
                .filter(Boolean).join('\n');
        }
        return;
    }
    if (!v) {
        // 0 을 보여 주면 '송장 0건' 과 구분이 안 된다. 아예 숫자를 안 쓴다.
        if (invoiceEl) invoiceEl.textContent = '–';
        if (deliveryEl) deliveryEl.textContent = '–';
        if (라벨El) {
            라벨El.textContent = '연동 대기 중';
            라벨El.className = 'mt-1.5 text-[10px] text-gray-400 dark:text-gray-500';
        }
        return;
    }

    // 반짝임은 **값이 실제로 바뀔 때만.** 예전에는 메시지가 오면 무조건 반짝여서
    // 같은 숫자로 1분마다 깜빡였다.
    const 칠하기 = (el, n, 색) => {
        if (!el) return;
        const 새글 = n.toLocaleString();
        const 바뀜 = el.textContent !== 새글;
        el.textContent = 새글;
        el.classList.toggle('opacity-50', !!v.흐림);
        if (바뀜) {
            el.classList.add('scale-125', 색);
            setTimeout(() => el.classList.remove('scale-125', 색), 500);
        }
    };
    칠하기(invoiceEl, v.invoice, 'text-orange-500');
    칠하기(deliveryEl, v.delivery, 'text-purple-500');

    if (라벨El) {
        라벨El.textContent = v.라벨;
        라벨El.className = 'mt-1.5 text-[10px] ' + (v.흐림
            ? 'font-bold text-rose-500 dark:text-rose-400'
            : 'text-gray-400 dark:text-gray-500');
        const 도움 = [v.사유, '숫자는 마지막으로 읽은 값입니다.',
                     '앱 폴더의 이지어드민연동/로그 를 확인하세요.'].filter(Boolean);
        라벨El.title = v.흐림 ? 도움.join('\n') : '';
    }
};

// Firestore 값이 바뀌거나 '몇 분 전' 이 흘러가면 다시 그린다.
onEzadminChange(() => { try { updateEzadminDisplay(); } catch (e) {} });

export const renderDashboardLayout = (appConfig) => {
    const personnelContainer = document.getElementById('summary-personnel');
    const workloadContainer = document.getElementById('summary-workload');
    
    if (!personnelContainer && !workloadContainer) return;

    const itemIds = appConfig.dashboardItems || [];
    const allDefinitions = getAllDashboardDefinitions(appConfig);

    let personnelHtml = '';
    let workloadHtml = '';

    itemIds.forEach(id => {
        const def = allDefinitions[id];
        if (!def) return;

        const isQuantity = def.isQuantity === true;
        const safeTitle = def.title.replace(/ /g, '&nbsp;'); 

        if (isQuantity) {
            workloadHtml += `
                <div class="flex justify-between items-center py-2 border-b border-blue-50 dark:border-blue-900/50 last:border-0 hover:bg-blue-50/50 dark:hover:bg-blue-900/30 transition-colors px-2 rounded gap-2 overflow-hidden">
                    <span class="text-sm font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap shrink-0 break-keep tracking-tight">${safeTitle}</span>
                    <span id="${def.valueId}" class="text-sm font-extrabold text-blue-700 dark:text-blue-300 bg-white dark:bg-gray-800 px-2 py-0.5 rounded-md shadow-sm border border-blue-100 dark:border-blue-800 transition-all shrink-0">0</span>
                </div>
            `;
        } else if (EXPANDABLE_ITEMS.has(id)) {
            personnelHtml += `
                <div class="personnel-row py-2 border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors px-2 rounded cursor-pointer select-none" data-detail-key="${id}">
                    <div class="flex justify-between items-center gap-2 overflow-hidden">
                        <span class="text-sm font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap shrink-0 break-keep tracking-tight">${safeTitle}</span>
                        <span id="${def.valueId}" class="text-sm font-extrabold text-gray-800 dark:text-gray-200 transition-all shrink-0">0</span>
                    </div>
                    <div class="personnel-detail hidden mt-1.5 pl-2 border-l-2 border-blue-400 dark:border-blue-500" data-detail-content="${id}"></div>
                </div>
            `;
        } else {
            personnelHtml += `
                <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors px-2 rounded gap-2 overflow-hidden">
                    <span class="text-sm font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap shrink-0 break-keep tracking-tight">${safeTitle}</span>
                    <span id="${def.valueId}" class="text-sm font-extrabold text-gray-800 dark:text-gray-200 transition-all shrink-0">0</span>
                </div>
            `;
        }
    });

    // 첫 그림은 빈 칸으로 두고, 아래 updateEzadminDisplay() 가 실제 값을 채운다.
    // (0 을 먼저 그리면 '송장 0건' 처럼 보인다)

    workloadHtml += `
        <div class="mt-4 p-3 border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 rounded-xl shadow-sm">
            <div class="text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-2.5 flex items-center gap-1">
                <span>🚚</span> 이지어드민 연동
            </div>
            <div class="flex gap-2">
                <div class="flex-1 flex justify-between items-center bg-orange-50 dark:bg-orange-900/20 px-2.5 py-2 rounded-lg border border-orange-100 dark:border-orange-800/50 transition-colors shadow-sm">
                    <span class="text-xs font-extrabold text-orange-600 dark:text-orange-400 break-keep">송장</span>
                    <span id="ezadmin-invoice-count" class="text-sm font-black text-orange-700 dark:text-orange-300 transition-all duration-300">–</span>
                </div>
                <div class="flex-1 flex justify-between items-center bg-purple-50 dark:bg-purple-900/20 px-2.5 py-2 rounded-lg border border-purple-100 dark:border-purple-800/50 transition-colors shadow-sm">
                    <span class="text-xs font-extrabold text-purple-600 dark:text-purple-400 break-keep">배송</span>
                    <span id="ezadmin-delivery-count" class="text-sm font-black text-purple-700 dark:text-purple-300 transition-all duration-300">–</span>
                </div>
            </div>
            <div id="ezadmin-asof" class="mt-1.5 text-[10px] text-gray-400 dark:text-gray-500"></div>
        </div>
    `;

    if (personnelContainer) personnelContainer.innerHTML = personnelHtml;
    if (workloadContainer) workloadContainer.innerHTML = workloadHtml;

    // ⚠️ 위에서 workloadContainer 를 통째로 갈아끼웠다 — 방금 만든 element 는 새것이고
    //    숫자·라벨이 비어 있다. 그려 넣지 않으면 30초마다 '–' 로 깜빡인다.
    try { updateEzadminDisplay(); } catch (e) {}
};

export const updateSummary = (appState, appConfig) => {
    const allDefinitions = getAllDashboardDefinitions(appConfig);
    const elements = {};
    Object.keys(allDefinitions).forEach(id => {
        const def = allDefinitions[id];
        if (def && def.valueId) {
            elements[id] = document.getElementById(def.valueId);
        }
    });

    // 정직원 인원 카운트는 (1) 중복 제거, (2) 프로그램 전용 ID 제외 — getRegularMembersForCount 사용.
    const allStaffMembers = getRegularMembersForCount(appConfig);
    const allPartTimers = new Set((appState.partTimers || []).map(p => p.name));
    const totalStaffCount = allStaffMembers.size;
    const totalPartTimerCount = allPartTimers.size;

    const dailyLeaves = Array.isArray(appState.dailyOnLeaveMembers) ? appState.dailyOnLeaveMembers : (appState.dailyOnLeaveMembers ? Object.values(appState.dailyOnLeaveMembers) : []);
    const dateLeaves = Array.isArray(appState.dateBasedOnLeaveMembers) ? appState.dateBasedOnLeaveMembers : [];
    const combinedOnLeaveMembers = [...dailyLeaves, ...dateLeaves];

    const onLeaveMemberNames = new Set(
        combinedOnLeaveMembers
            .filter(item => {
                if (item.type === '외출' && item.endTime) return false;
                if (item.type === '지각') return false;
                return allStaffMembers.has(item.member) || allPartTimers.has(item.member);
            })
            .map(item => item.member)
    );
    const onLeaveTotalCount = onLeaveMemberNames.size;

    const attendanceMap = appState.dailyAttendance || {};
    const currentlyClockedIn = new Set(
        Object.keys(attendanceMap).filter(member => 
            attendanceMap[member].status === 'active' && !onLeaveMemberNames.has(member)
        )
    );

    const availableStaffCount = [...currentlyClockedIn].filter(member => allStaffMembers.has(member)).length;
    const availablePartTimerCount = [...currentlyClockedIn].filter(member => allPartTimers.has(member)).length;

    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' && !onLeaveMemberNames.has(r.member));
    const pausedRecords = (appState.workRecords || []).filter(r => r.status === 'paused' && !onLeaveMemberNames.has(r.member));
    
    const ongoingMembers = new Set(ongoingRecords.map(r => r.member));
    const pausedMembers = new Set(pausedRecords.map(r => r.member));

    const totalWorkingCount = ongoingMembers.size;
    
    const pausedStaffCount = [...pausedMembers].filter(member => allStaffMembers.has(member)).length;
    const pausedPartTimerCount = [...pausedMembers].filter(member => allPartTimers.has(member)).length;
    
    const workingStaffCount = [...ongoingMembers].filter(member => allStaffMembers.has(member)).length;
    const workingPartTimerCount = [...ongoingMembers].filter(member => allPartTimers.has(member)).length;

    const idleStaffCount = Math.max(0, availableStaffCount - workingStaffCount - pausedStaffCount);
    const idlePartTimerCount = Math.max(0, availablePartTimerCount - workingPartTimerCount - pausedPartTimerCount);
    
    const totalIdleCount = idleStaffCount + idlePartTimerCount;

    const ongoingOrPausedRecords = (appState.workRecords || []).filter(r => (r.status === 'ongoing' || r.status === 'paused') && !onLeaveMemberNames.has(r.member));
    const ongoingTaskCount = new Set(ongoingOrPausedRecords.map(r => r.task)).size;

    if (elements['total-staff']) elements['total-staff'].textContent = `${totalStaffCount}/${totalPartTimerCount}`;
    if (elements['leave-staff']) elements['leave-staff'].textContent = `${onLeaveTotalCount}`;
    if (elements['active-staff']) elements['active-staff'].textContent = `${availableStaffCount}/${availablePartTimerCount}`;
    if (elements['working-staff']) elements['working-staff'].textContent = `${totalWorkingCount}`;
    if (elements['idle-staff']) elements['idle-staff'].textContent = `${totalIdleCount}`;
    if (elements['ongoing-tasks']) elements['ongoing-tasks'].textContent = `${ongoingTaskCount}`;

    const quantitiesFromState = appState.taskQuantities || {};
    const quantityStatuses = appState.taskQuantityStatuses || {};
    const taskNameToDashboardIdMap = appConfig.quantityToDashboardMap || {};
    
    for (const task in quantitiesFromState) {
        const quantity = quantitiesFromState[task] || 0;
        const targetDashboardId = taskNameToDashboardIdMap[task];

        if (targetDashboardId && elements[targetDashboardId]) {
            const el = elements[targetDashboardId];
            el.textContent = quantity;

            el.classList.remove('quantity-estimated', 'quantity-confirmed', 'text-red-500', 'text-green-500');

            const status = quantityStatuses[task];
            if (status === 'estimated') {
                el.classList.add('text-red-500'); 
            } else if (status === 'confirmed') {
                el.classList.add('text-green-500'); 
            }
        }
    }

    updateEzadminDisplay();
    renderNoticeWidget(appState);

    // 실시간 인원 현황 상세 펼침 데이터 + 인터랙션
    lastPersonnelDetail = buildPersonnelDetailData(appState, appConfig);
    paintPersonnelDetailContainers(lastPersonnelDetail);
    setupPersonnelInteractions();
};

// ───────────────────────────────────────────────────────────
// 실시간 인원 현황 상세(펼침/툴팁)
// ───────────────────────────────────────────────────────────
const buildPersonnelDetailData = (appState, appConfig) => {
    const allStaffMembers = getRegularMembersForCount(appConfig);
    const allPartTimers = new Set((appState.partTimers || []).map(p => p.name));

    const dailyLeaves = Array.isArray(appState.dailyOnLeaveMembers) ? appState.dailyOnLeaveMembers : (appState.dailyOnLeaveMembers ? Object.values(appState.dailyOnLeaveMembers) : []);
    const dateLeaves = Array.isArray(appState.dateBasedOnLeaveMembers) ? appState.dateBasedOnLeaveMembers : [];
    const combinedOnLeave = [...dailyLeaves, ...dateLeaves];

    // 휴무: 외출(복귀 완료) + 지각 제외, 중복 제거 (한 사람의 첫 항목 유지)
    const seenLeave = new Set();
    const leaveDetail = [];
    combinedOnLeave.forEach(item => {
        if (!item || !item.member) return;
        if (item.type === '외출' && item.endTime) return;
        if (item.type === '지각') return;
        if (!(allStaffMembers.has(item.member) || allPartTimers.has(item.member))) return;
        if (seenLeave.has(item.member)) return;
        seenLeave.add(item.member);
        leaveDetail.push({ member: item.member, type: item.type });
    });
    leaveDetail.sort((a, b) => a.member.localeCompare(b.member));
    const onLeaveSet = new Set(leaveDetail.map(l => l.member));

    // 진행 업무: ongoing/paused, 휴무자 제외, 멤버별 첫 업무 채택
    const workingRecords = (appState.workRecords || []).filter(r =>
        (r.status === 'ongoing' || r.status === 'paused') && !onLeaveSet.has(r.member)
    );
    const seenWorking = new Set();
    const workingDetail = [];
    workingRecords.forEach(r => {
        if (seenWorking.has(r.member)) return;
        seenWorking.add(r.member);
        workingDetail.push({ member: r.member, task: r.task || '-', paused: r.status === 'paused' });
    });
    workingDetail.sort((a, b) => (a.task || '').localeCompare(b.task || '') || a.member.localeCompare(b.member));
    const workingSet = new Set(workingDetail.map(w => w.member));

    // 진행 업무(태스크) 집계: 업무명 → {총원, 휴식 인원}
    const taskMap = new Map();
    workingRecords.forEach(r => {
        const t = r.task || '(미지정)';
        if (!taskMap.has(t)) taskMap.set(t, { task: t, members: new Set(), paused: 0 });
        const g = taskMap.get(t);
        if (!g.members.has(r.member)) {
            g.members.add(r.member);
            if (r.status === 'paused') g.paused++;
        }
    });
    const ongoingTasksDetail = Array.from(taskMap.values())
        .map(g => ({ task: g.task, count: g.members.size, paused: g.paused }))
        .sort((a, b) => b.count - a.count || a.task.localeCompare(b.task));

    // 대기: 출근(active)이지만 휴무·진행/휴식 모두 아닌 인원
    const attendanceMap = appState.dailyAttendance || {};
    const idleDetail = Object.keys(attendanceMap)
        .filter(m => attendanceMap[m].status === 'active' && !onLeaveSet.has(m) && !workingSet.has(m))
        .sort();

    return {
        'leave-staff': leaveDetail,
        'idle-staff': idleDetail,
        'working-staff': workingDetail,
        'ongoing-tasks': ongoingTasksDetail
    };
};

const renderDetailListHtml = (key, items) => {
    if (!items || items.length === 0) {
        return '<div class="text-xs text-gray-400 dark:text-gray-500 italic py-1">해당 인원 없음</div>';
    }
    if (key === 'leave-staff') {
        return '<div class="flex flex-wrap gap-1 py-1">' + items.map(it =>
            `<span class="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-[11px] px-1.5 py-0.5 rounded">
                <strong>${it.member}</strong><span class="text-[9px] text-gray-500 dark:text-gray-400">${it.type}</span>
             </span>`
        ).join('') + '</div>';
    }
    if (key === 'idle-staff') {
        return '<div class="flex flex-wrap gap-1 py-1">' + items.map(name =>
            `<span class="inline-flex bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-[11px] px-1.5 py-0.5 rounded">${name}</span>`
        ).join('') + '</div>';
    }
    if (key === 'working-staff') {
        return '<div class="space-y-0.5 py-1">' + items.map(it =>
            `<div class="flex items-center justify-between text-[11px] gap-2 ${it.paused ? 'text-yellow-700 dark:text-yellow-400' : 'text-gray-700 dark:text-gray-300'}">
                <span class="font-medium shrink-0">${it.member}</span>
                <span class="text-[10px] text-gray-500 dark:text-gray-400 truncate">${it.task}${it.paused ? ' (휴식)' : ''}</span>
             </div>`
        ).join('') + '</div>';
    }
    if (key === 'ongoing-tasks') {
        return '<div class="space-y-0.5 py-1">' + items.map(it =>
            `<div class="flex items-center justify-between text-[11px] gap-2 text-gray-700 dark:text-gray-300">
                <span class="font-medium truncate">${it.task}</span>
                <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">${it.count}명${it.paused > 0 ? ` <span class="text-yellow-700 dark:text-yellow-400">(${it.paused}명 휴식)</span>` : ''}</span>
             </div>`
        ).join('') + '</div>';
    }
    return '';
};

const paintPersonnelDetailContainers = (data) => {
    if (!data) return;
    Object.keys(data).forEach(key => {
        const el = document.querySelector(`[data-detail-content="${key}"]`);
        if (el) el.innerHTML = renderDetailListHtml(key, data[key]);
    });
};

const buildTooltipHtml = (key) => {
    const items = lastPersonnelDetail && lastPersonnelDetail[key];
    const title = { 'leave-staff': '📋 휴무 인원', 'idle-staff': '⏸️ 대기 인원', 'working-staff': '🏃 진행 인력', 'ongoing-tasks': '📋 진행 업무' }[key] || '';
    const header = `<div class="font-bold text-yellow-300 mb-1.5">${title}</div>`;
    const footer = '<div class="text-[10px] text-gray-400 mt-2 italic">💡 클릭으로 고정</div>';
    if (!items || items.length === 0) {
        return header + '<div class="text-gray-300">해당 인원 없음</div>' + footer;
    }
    let body = '';
    if (key === 'leave-staff') {
        body = items.map(it => `<div>${it.member} <span class="text-gray-400">(${it.type})</span></div>`).join('');
    } else if (key === 'idle-staff') {
        body = items.map(n => `<div>${n}</div>`).join('');
    } else if (key === 'working-staff') {
        body = items.map(it => `<div>${it.member} <span class="text-gray-400">— ${it.task}${it.paused ? ' (휴식)' : ''}</span></div>`).join('');
    } else if (key === 'ongoing-tasks') {
        body = items.map(it => `<div>${it.task} <span class="text-gray-400">— ${it.count}명${it.paused > 0 ? ` (${it.paused}명 휴식)` : ''}</span></div>`).join('');
    }
    return header + body + footer;
};

const positionTooltip = (el, x, y) => {
    const pad = 12;
    const w = el.offsetWidth || 200;
    const h = el.offsetHeight || 100;
    let left = x + pad;
    let top = y + pad;
    if (left + w > window.innerWidth - 8) left = Math.max(8, x - w - pad);
    if (top + h > window.innerHeight - 8) top = Math.max(8, y - h - pad);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
};

const setupPersonnelInteractions = () => {
    const container = document.getElementById('summary-personnel');
    if (!container || container.dataset.interactionsSetup === 'true') return;
    container.dataset.interactionsSetup = 'true';

    // 글로벌 툴팁 1개 (body에 부착)
    let tooltipEl = document.getElementById('personnel-hover-tooltip');
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'personnel-hover-tooltip';
        tooltipEl.className = 'fixed pointer-events-none z-[200] bg-gray-900 text-white text-xs rounded-lg shadow-xl p-3 max-w-xs leading-relaxed hidden';
        document.body.appendChild(tooltipEl);
    }

    let hoverTimer = null;
    const hideTooltip = () => {
        clearTimeout(hoverTimer);
        tooltipEl.classList.add('hidden');
    };

    container.addEventListener('mouseover', (e) => {
        const row = e.target.closest('.personnel-row[data-detail-key]');
        if (!row) return;
        if (row.dataset.expanded === 'true') return; // 펼친 상태에선 툴팁 생략
        const key = row.dataset.detailKey;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
            tooltipEl.innerHTML = buildTooltipHtml(key);
            tooltipEl.classList.remove('hidden');
            positionTooltip(tooltipEl, e.clientX, e.clientY);
        }, 250);
    });

    container.addEventListener('mousemove', (e) => {
        if (tooltipEl.classList.contains('hidden')) return;
        positionTooltip(tooltipEl, e.clientX, e.clientY);
    });

    container.addEventListener('mouseout', (e) => {
        if (!e.target.closest('.personnel-row[data-detail-key]')) return;
        hideTooltip();
    });

    container.addEventListener('click', (e) => {
        const row = e.target.closest('.personnel-row[data-detail-key]');
        if (!row) return;
        const detailEl = row.querySelector('.personnel-detail');
        if (!detailEl) return;
        const isExpanded = row.dataset.expanded === 'true';
        if (isExpanded) {
            row.dataset.expanded = 'false';
            detailEl.classList.add('hidden');
            row.classList.remove('bg-blue-50/40', 'dark:bg-blue-900/20');
        } else {
            row.dataset.expanded = 'true';
            detailEl.classList.remove('hidden');
            row.classList.add('bg-blue-50/40', 'dark:bg-blue-900/20');
            hideTooltip();
        }
    });
};

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'EZADMIN_DATA_UPDATE') {
        // 확장(ezadmin-bridge)의 값 — **폴백 전용.** 상주 수집기 쪽이 신선하면 이 값은 안 쓴다.
        // 받은 시각을 여기서 찍어 둔다(확장 payload 에는 시각이 없다).
        currentEzadminData = event.data.data;
        확장받은때 = Date.now();
        // 그리기는 updateEzadminDisplay 한 곳에서만 한다 — 두 곳에서 그리면
        // 어느 값이 보이는지가 '마지막에 그린 쪽' 으로 결정돼 버린다.
        try { updateEzadminDisplay(); } catch (e) {}
    }
});

// 외부 페이지(별도 창으로 열려야 하는 링크)별 아이콘 + 창 타겟 매핑.
// 관리자 페이지에서 메뉴 이름을 다르게 등록해도 '링크' 기준으로 적용되므로
// 항상 페이지에 맞는 아이콘이 표시되고, 같은 named target으로 별도 창에서 열린다.
const EXTERNAL_LINK_META = [
    { match: 'manual.html',   icon: '📖', target: '_blank' },          // 업무 매뉴얼
    { match: 'sheets.html',   icon: '🗂️', target: 'sheets_window' },   // 업무시트 대시보드 (메인 대시보드 📊와 구분)
    { match: 'location.html', icon: '📍', target: 'location_window' }, // 로케이션 관리
    { match: 'supplies.html', icon: '📦', target: 'supplies_window' }, // 비품 관리
    { match: 'admin.html',    icon: '⚙️', target: 'admin_window' },    // 관리자 페이지
    { match: 'worktime.html', icon: '🕘', target: 'worktime_window' }, // 출퇴근 기록표
    { match: 'china-stock-goods.html', icon: '🧮', target: 'chinastock_window' }, // 중국제작 미발계산기
    { match: 'scan.html',     icon: '📷', target: 'scan_window' },      // 입고 스캐너(미발계산기 안에서도 열림)
];

// 신규·폐기 메뉴 보정은 js/menu-catalog.js 로 옮겼다.
// 관리자 페이지의 '권한 관리'도 같은 목록을 봐야 해서(신규 메뉴의 권한을 못 고르던 문제)
// 양쪽에서 쓰는 공용 모듈로 뺐다.

const resolveLinkMeta = (link) => {
    if (!link) return null;
    return EXTERNAL_LINK_META.find(m => link.includes(m.match)) || null;
};

// 사이드바 동적 필터링 및 재배치 (매뉴얼/대시보드 등 별도 창 열기 포함)
export const applyDynamicSidebar = (appConfig) => {
    if (!appConfig || !appConfig.dashboardMenu) return;

    const pcNav = document.querySelector('aside nav');
    const mobileNav = document.getElementById('nav-content');
    if (!pcNav && !mobileNav) return;

    const currentUserEmail = State.auth.currentUser?.email?.toLowerCase() || '';
    const currentUserRole = State.appState.currentUserRole;
    
    let allowedMenus = null; 
    if (currentUserRole !== 'admin') {
        allowedMenus = appConfig.memberMenuAccess?.[currentUserEmail] || [];
    }

    const pcElements = {};
    if (pcNav) {
        pcNav.querySelectorAll('button, a').forEach(el => {
            const textNode = Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);
            const name = textNode ? textNode.textContent.trim() : el.textContent.trim();
            if (name) pcElements[name] = el;
        });
        pcNav.innerHTML = '';
    }

    const mobileElements = {};
    let mobileHeader = null;
    let logoutBtn = null;
    
    if (mobileNav) {
        mobileHeader = mobileNav.firstElementChild; 
        logoutBtn = document.getElementById('logout-btn-mobile');
        
        mobileNav.querySelectorAll('button, a, div').forEach(el => {
            if (el.id === 'logout-btn-mobile' || el === mobileHeader || (mobileHeader && mobileHeader.contains(el))) return;
            if (el.tagName !== 'BUTTON' && el.tagName !== 'A') return;
            
            const textNode = Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);
            const name = textNode ? textNode.textContent.trim() : el.textContent.trim();
            if (name) mobileElements[name] = el;
        });

        Array.from(mobileNav.children).forEach(child => {
            if (child !== mobileHeader && child !== logoutBtn) {
                mobileNav.removeChild(child);
            }
        });
    }

    withBuiltinMenus(appConfig.dashboardMenu).forEach((group, index) => {
        const visibleItems = group.items.filter(item => {
            if (allowedMenus === null) return true; 
            return allowedMenus.includes(item.name);
        });

        if (visibleItems.length === 0) return;

        if (pcNav) {
            const pcCat = document.createElement('div');
            pcCat.className = `text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2 px-2 ${index > 0 ? 'mt-6' : ''}`;
            pcCat.textContent = group.category;
            pcNav.appendChild(pcCat);
        }

        if (mobileNav) {
            const mobCat = document.createElement('div');
            mobCat.className = `px-5 py-2 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase ${index > 0 ? 'mt-2' : ''}`;
            mobCat.textContent = group.category;
            if (logoutBtn) mobileNav.insertBefore(mobCat, logoutBtn);
            else mobileNav.appendChild(mobCat);
        }

        visibleItems.forEach(item => {
            // ✨ 외부 페이지 링크별 아이콘/창 타겟 결정 (메뉴 이름이 달라도 링크 기준 적용)
            const meta = resolveLinkMeta(item.link);

            if (pcNav) {
                const pcEl = pcElements[item.name];
                if (pcEl) {
                    if (pcEl.tagName === 'A' && item.link && item.link !== '#') {
                        pcEl.href = item.link;
                        if (meta) pcEl.target = meta.target; // 별도 창 / 새 탭
                    }
                    if (meta) { const ic = pcEl.querySelector('span'); if (ic) ic.textContent = meta.icon; }
                    pcNav.appendChild(pcEl);
                } else {
                    const newPc = document.createElement('a');
                    newPc.href = item.link || '#';
                    if (meta) newPc.target = meta.target; // 별도 창 / 새 탭
                    newPc.className = "w-full flex items-center gap-3 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 px-4 py-3 rounded-xl font-medium transition";
                    newPc.innerHTML = `<span class="text-lg">${meta ? meta.icon : '🔗'}</span> ${item.name}`;
                    pcNav.appendChild(newPc);
                }
            }

            if (mobileNav) {
                const mobEl = mobileElements[item.name];
                if (mobEl) {
                    if (mobEl.tagName === 'A' && item.link && item.link !== '#') {
                        mobEl.href = item.link;
                        if (meta) mobEl.target = meta.target; // 별도 창 / 새 탭
                    }
                    if (meta) { const ic = mobEl.querySelector('span'); if (ic) ic.textContent = meta.icon; }
                    if (logoutBtn) mobileNav.insertBefore(mobEl, logoutBtn);
                    else mobileNav.appendChild(mobEl);
                } else {
                    const newMob = document.createElement('a');
                    newMob.href = item.link || '#';
                    if (meta) newMob.target = meta.target; // 별도 창 / 새 탭
                    newMob.className = "text-left px-5 py-4 border-b dark:border-gray-700 text-sm font-medium dark:text-gray-200 flex items-center gap-2";
                    newMob.innerHTML = `<span class="text-lg">${meta ? meta.icon : '🔗'}</span> ${item.name}`;
                    if (logoutBtn) mobileNav.insertBefore(newMob, logoutBtn);
                    else mobileNav.appendChild(newMob);
                }
            }
        });
    });
};