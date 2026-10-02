// === js/history-list-controller.js ===
// 설명: 이력 모달의 좌측 날짜 목록 관리, 탭 전환, 데이터 로딩 등 네비게이션 컨트롤러입니다.

import * as DOM from './dom-elements.js?v=202610021228';
import * as State from './state.js?v=202610021228';
import { showToast, getTodayDateString, getWeekOfYear, getAllTaskKeys } from './utils.js?v=202610021228';
import { augmentHistoryWithPersistentLeave } from './history-enricher.js?v=202610021228';
import { fetchAllHistoryData, syncTodayToHistory, getDailyDocRef, selfHealRecentHistory,
         fetchPlannedData, getPlannedQuantitiesForDate, savePlannedQuantities, getUpcomingPlannedDateStrings } from './history-data-manager.js?v=202610021228';
import { checkMissingQuantities } from './analysis-logic.js?v=202610021228';
import { renderQuantityModalInputs } from './ui.js?v=202610021228';
import { getIncomingQtyByDateFromCache } from './widget-incoming-schedule.js?v=202610021228';
import { getAutoQuantitiesForDate } from './ui-history-prediction.js?v=202610021228';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let isRenderingList = false;
let renderListQueue = null;

export const loadAndRenderHistoryList = async () => {
    if (!DOM.historyDateList) return;
    DOM.historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500 text-sm">이력 로딩 중...</div></li>';

    await fetchAllHistoryData();
    await syncTodayToHistory();

    // 📅 예정 물량(미래 7일) 로드 — 목록 상단 '예정' 그룹 + 예측 연동에 사용
    try { await fetchPlannedData(); } catch (e) { console.warn('예정 물량 로드 건너뜀:', e); }

    // 🩺 마감 누락 자동 복구: history가 빈 최근 날을 daily_data에서 자동으로 되살림(실패해도 목록 렌더는 계속)
    try { await selfHealRecentHistory(); } catch (e) { console.warn('selfHeal 건너뜀:', e); }

    augmentHistoryWithPersistentLeave(State.allHistoryData, State.persistentLeaveSchedule);

    if (State.allHistoryData.length === 0) {
        DOM.historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500 text-sm">저장된 이력이 없습니다.</div></li>';
        const viewsToClear = [
            'history-daily-view', 'history-weekly-view', 'history-monthly-view',
            'history-attendance-daily-view', 'history-attendance-weekly-view', 'history-attendance-monthly-view',
            'report-daily-view', 'report-weekly-view', 'report-monthly-view', 'report-yearly-view'
        ];
        viewsToClear.forEach(viewId => {
            const viewEl = document.getElementById(viewId);
            if (viewEl) viewEl.innerHTML = '';
        });
        return;
    }

    // 메인 탭 스타일 초기화
    document.querySelectorAll('.history-main-tab-btn[data-main-tab="work"]').forEach(btn => {
        btn.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
        btn.classList.remove('font-medium', 'text-gray-500');
    });
    document.querySelectorAll('.history-main-tab-btn:not([data-main-tab="work"])').forEach(btn => {
        btn.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
        btn.classList.add('font-medium', 'text-gray-500');
    });

    // 하위 탭 스타일 초기화
    document.querySelectorAll('#history-tabs button[data-view="daily"]').forEach(btn => {
        btn.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
        btn.classList.remove('text-gray-500');
    });
    document.querySelectorAll('#history-tabs button:not([data-view="daily"])').forEach(btn => {
        btn.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
        btn.classList.add('text-gray-500');
    });

    // 패널 가시성 초기화
    if (DOM.workHistoryPanel) DOM.workHistoryPanel.classList.remove('hidden');
    if (DOM.attendanceHistoryPanel) DOM.attendanceHistoryPanel.classList.add('hidden');
    if (DOM.trendAnalysisPanel) DOM.trendAnalysisPanel.classList.add('hidden');
    if (DOM.reportPanel) DOM.reportPanel.classList.add('hidden');

    document.getElementById('history-daily-view')?.classList.remove('hidden');
    document.getElementById('history-weekly-view')?.classList.add('hidden');
    document.getElementById('history-monthly-view')?.classList.add('hidden');
    document.getElementById('history-attendance-daily-view')?.classList.add('hidden');
    document.getElementById('history-attendance-weekly-view')?.classList.add('hidden');
    document.getElementById('history-attendance-monthly-view')?.classList.add('hidden');
    document.getElementById('report-daily-view')?.classList.remove('hidden');
    document.getElementById('report-weekly-view')?.classList.add('hidden');
    document.getElementById('report-monthly-view')?.classList.add('hidden');
    document.getElementById('report-yearly-view')?.classList.add('hidden');

    State.context.activeMainHistoryTab = 'work';
    State.context.activeHistoryView = 'rawdata';
    State.context.globalGranularity = 'day';
    State.context.reportSortState = {};
    State.context.currentReportParams = null;

    updateGranularityButtons('day');
    await renderHistoryDateListByMode('day');
};

// 📅 미래 7일 '예정 물량' 그룹 HTML (day 모드에서 목록 최상단에 표시)
const buildPlannedGroupHtml = () => {
    const dates = getUpcomingPlannedDateStrings(7);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const incoming = getIncomingQtyByDateFromCache();
    const items = dates.map(dateStr => {
        const planned = getPlannedQuantitiesForDate(dateStr);
        // 업무 예상 화면에서 '0으로 저장'한 값도 들어올 수 있다 — 지정 여부(hasData)와
        // 실제 물량이 있는 개수(count)를 나눠서 본다.
        const hasData = Object.keys(planned).length > 0;
        const count = Object.values(planned).filter(v => Number(v) > 0).length;
        const chinaIncoming = Math.round(Number(incoming[dateStr]) || 0);
        const d = new Date(dateStr + 'T00:00:00');
        const wd = isNaN(d.getDay()) ? '' : ` (${days[d.getDay()]})`;
        const rightLabel = hasData
            ? `<span class="ml-auto text-[10px] text-indigo-500 shrink-0">${count > 0 ? `${count}개 입력` : '0으로 지정'}</span>`
            : (chinaIncoming > 0
                ? `<span class="ml-auto text-[10px] text-blue-500 shrink-0">입고 ${chinaIncoming.toLocaleString()}</span>`
                : `<span class="ml-auto text-[10px] text-gray-400 shrink-0">미입력</span>`);
        return `
            <li>
                <button data-key="${dateStr}" class="planned-date-btn w-full text-left py-2 px-2.5 text-[13px] rounded-md transition-colors focus:outline-none flex items-center gap-2 shrink-0 text-gray-600 dark:text-gray-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30">
                    <span class="inline-block w-1.5 h-1.5 rounded-full ${hasData ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'} shrink-0"></span>
                    <span class="whitespace-nowrap tracking-tight shrink-0">${dateStr}${wd}</span>
                    ${rightLabel}
                </button>
            </li>`;
    }).join('');
    return `
        <li class="mb-2">
            <button class="accordion-toggle w-full flex justify-between items-center py-2.5 px-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors shadow-sm focus:outline-none shrink-0">
                <div class="flex items-center gap-2 shrink-0">
                    <span class="folder-icon text-[15px]">📅</span>
                    <span class="font-bold text-[14px] text-indigo-700 dark:text-indigo-300 whitespace-nowrap tracking-tight shrink-0">예정 물량 (미래 7일)</span>
                </div>
                <svg class="w-4 h-4 text-indigo-400 transform transition-transform duration-200 shrink-0 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            <ul class="accordion-content mt-1 space-y-0.5 overflow-hidden transition-all duration-300 block border-l-2 border-indigo-100 dark:border-indigo-800 ml-2 pl-1.5">
                ${items}
            </ul>
        </li>`;
};

// 📅 예정 물량 입력 모달 (기존 처리량 모달 재사용, 저장은 plannedData로)
export const openPlannedQuantityModal = (dateStr) => {
    if (!dateStr) return;
    const allTasks = getAllTaskKeys(State.appConfig);

    // 자동 추정값(업무 예상 시뮬레이션과 동일한 계산 — 지난 7회 평균 / AI / 입고일정)을 먼저 깔고,
    // 이미 수기로 저장해 둔 예정값이 있으면 그 값으로 덮는다.
    // → 화면을 열자마자 시뮬레이션과 같은 값이 보이고, 여기서 고친 값이 시뮬레이션에 그대로 반영된다.
    const auto = getAutoQuantitiesForDate(dateStr);
    const saved = getPlannedQuantitiesForDate(dateStr);
    const planned = { ...auto, ...saved };

    renderQuantityModalInputs(planned, allTasks, [], []);

    const title = document.getElementById('quantity-modal-title');
    if (title) title.textContent = `📅 ${dateStr} 예정 물량 입력`;

    const hint = document.getElementById('planned-auto-hint');
    if (hint) {
        hint.textContent = '자동 추정값(국내배송=AI 예측 · 중국제작=입고일정 · 그 외=지난 7회 업무량 평균)이 미리 채워져 있습니다. 값을 고쳐 저장하면 업무 예상 시뮬레이션에도 그대로 적용됩니다.';
        hint.classList.remove('hidden');
    }

    // 확정 체크박스는 예정 입력엔 불필요 — 꺼둠
    const confirmCheckbox = document.getElementById('quantity-confirm-checkbox');
    if (confirmCheckbox) confirmCheckbox.checked = false;

    State.context.quantityModalContext.mode = 'planned';
    State.context.quantityModalContext.dateKey = dateStr;
    State.context.quantityModalContext.isVerifyingMode = false;
    State.context.quantityModalContext.onConfirm = async (newQuantities) => {
        await savePlannedQuantities(dateStr, newQuantities);
        // 좌측 목록의 예정 그룹 갱신
        try { await renderHistoryDateListByMode(State.context.globalGranularity || 'day', State.context.selectedHistoryDate || null); } catch (_) {}
    };
    State.context.quantityModalContext.onCancel = () => {};

    const modalEl = document.getElementById('quantity-modal');
    if (modalEl) modalEl.classList.remove('hidden');
};

export const renderHistoryDateListByMode = async (mode = 'day', selectedKey = null) => {
    if (!DOM.historyDateList) return;

    if (isRenderingList) {
        renderListQueue = { mode, selectedKey };
        return;
    }
    isRenderingList = true;

    try {
        await syncTodayToHistory(); 
        augmentHistoryWithPersistentLeave(State.allHistoryData, State.persistentLeaveSchedule);

        const filteredData = (State.context.historyStartDate || State.context.historyEndDate)
            ? State.allHistoryData.filter(d => {
                const date = d.id;
                const start = State.context.historyStartDate;
                const end = State.context.historyEndDate;
                if (start && end) return date >= start && date <= end;
                if (start) return date >= start;
                if (end) return date <= end;
                return true;
            })
            : State.allHistoryData;

        let keys = [];

        if (mode === 'day') {
            keys = filteredData.map(d => d.id);
        } else if (mode === 'week') {
            const weekSet = new Set(filteredData.map(d => getWeekOfYear(new Date(d.id + "T00:00:00"))));
            keys = Array.from(weekSet).sort((a, b) => b.localeCompare(a));
        } else if (mode === 'month') {
            const monthSet = new Set(filteredData.map(d => d.id.substring(0, 7)));
            keys = Array.from(monthSet).sort((a, b) => b.localeCompare(a));
        } else if (mode === 'year') {
            const yearSet = new Set(filteredData.map(d => d.id.substring(0, 4)));
            keys = Array.from(yearSet).sort((a, b) => b.localeCompare(a));
        }

        keys = [...new Set(keys)];

        if (keys.length === 0) {
            DOM.historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500 text-sm">데이터 없음</div></li>';
        } else {
            const groupedKeys = {};
            keys.forEach(key => {
                let groupName = '전체 이력';
                if (mode === 'day') {
                    groupName = `${key.substring(0, 4)}년 ${key.substring(5, 7)}월`;
                } else if (mode === 'week' || mode === 'month') {
                    groupName = `${key.substring(0, 4)}년`;
                }
                
                if (!groupedKeys[groupName]) groupedKeys[groupName] = [];
                groupedKeys[groupName].push(key);
            });

            // 📅 미래 7일 예정 물량 그룹을 목록 최상단에 (day 모드에서만)
            let htmlContent = (mode === 'day') ? buildPlannedGroupHtml() : '';
            let isFirstGroup = true;

            let targetGroupName = null;
            if (selectedKey) {
                for (const [gName, gKeys] of Object.entries(groupedKeys)) {
                    if (gKeys.includes(selectedKey)) {
                        targetGroupName = gName;
                        break;
                    }
                }
            }

            for (const [groupName, groupItemKeys] of Object.entries(groupedKeys)) {
                const isOpen = targetGroupName ? (groupName === targetGroupName) : isFirstGroup;
                
                // ✨ 수정 포인트: 좁은 영역에서도 폴더명 텍스트가 줄바꿈되거나 잘리지 않도록 (shrink-0, whitespace-nowrap) 강력 적용
                htmlContent += `
                <li class="mb-2">
                    <button class="accordion-toggle w-full flex justify-between items-center py-2.5 px-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shadow-sm focus:outline-none shrink-0">
                        <div class="flex items-center gap-2 shrink-0">
                            <span class="folder-icon text-[15px]">${isOpen ? '📂' : '📁'}</span>
                            <span class="font-bold text-[14px] text-gray-700 dark:text-gray-200 whitespace-nowrap tracking-tight shrink-0">${groupName}</span>
                        </div>
                        <svg class="w-4 h-4 text-gray-400 transform transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <ul class="accordion-content mt-1 space-y-0.5 overflow-hidden transition-all duration-300 ${isOpen ? 'block' : 'hidden'} border-l-2 border-gray-100 dark:border-gray-700 ml-2 pl-1.5">
                `;

                groupItemKeys.forEach(key => {
                    let hasWarning = false;
                    let titleAttr = '';

                    if (mode === 'day') {
                        const dayData = filteredData.find(d => d.id === key);
                        if (dayData) {
                            const missingTasksList = checkMissingQuantities(dayData);
                            hasWarning = missingTasksList.length > 0;
                            if (hasWarning) {
                                titleAttr = ` title="처리량 누락: ${missingTasksList.join(', ')}"`;
                            }
                        }
                    }
                    
                    // ✨ 요일 표시 로직 
                    let displayKey = key;
                    if (mode === 'day') {
                        const d = new Date(key);
                        const days = ['일', '월', '화', '수', '목', '금', '토'];
                        const dayStr = isNaN(d.getDay()) ? '' : ` (${days[d.getDay()]})`;
                        displayKey = `${key}${dayStr}`;
                    }

                    const isSelected = key === selectedKey;
                    const baseClass = isSelected 
                        ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 font-bold' 
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50';

                    // ✨ 수정 포인트: 좁은 영역에서도 날짜와 요일 텍스트가 줄바꿈되거나 잘리지 않도록 (shrink-0, whitespace-nowrap) 강력 적용
                    htmlContent += `
                        <li>
                            <button data-key="${key}" class="history-date-btn w-full text-left py-2 px-2.5 text-[13px] rounded-md transition-colors focus:outline-none flex items-center gap-2 shrink-0 ${baseClass} ${hasWarning ? 'warning-no-quantity' : ''}"${titleAttr}>
                                <span class="inline-block w-1.5 h-1.5 rounded-full ${hasWarning ? 'bg-red-500' : (isSelected ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600')} shrink-0"></span>
                                <span class="whitespace-nowrap tracking-tight shrink-0">${displayKey}</span>
                            </button>
                        </li>`;
                });

                htmlContent += `</ul></li>`;
                isFirstGroup = false;
            }

            DOM.historyDateList.innerHTML = htmlContent;

            // 아코디언 토글 이벤트 부착
            const toggleBtns = DOM.historyDateList.querySelectorAll('.accordion-toggle');
            toggleBtns.forEach(btn => {
                btn.addEventListener('click', function() {
                    const content = this.nextElementSibling;
                    const icon = this.querySelector('svg');
                    const folderIcon = this.querySelector('.folder-icon');
                    
                    if (content.classList.contains('hidden')) {
                        content.classList.remove('hidden');
                        icon.classList.add('rotate-180');
                        if(folderIcon) folderIcon.textContent = '📂';
                    } else {
                        content.classList.add('hidden');
                        icon.classList.remove('rotate-180');
                        if(folderIcon) folderIcon.textContent = '📁';
                    }
                });
            });

            // 📅 예정 물량 날짜 클릭 → 예정 입력 모달
            DOM.historyDateList.querySelectorAll('.planned-date-btn').forEach(btn => {
                btn.addEventListener('click', () => openPlannedQuantityModal(btn.dataset.key));
            });
        }

        let targetBtn = null;
        if (selectedKey) {
            targetBtn = DOM.historyDateList.querySelector(`button[data-key="${selectedKey}"]`);
        }
        if (!targetBtn) {
            targetBtn = DOM.historyDateList.querySelector('.history-date-btn');
        }

        if (targetBtn) {
            targetBtn.click();
            if (selectedKey) {
                targetBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        }

    } finally {
        isRenderingList = false;
        if (renderListQueue) {
            const nextJob = renderListQueue;
            renderListQueue = null;
            renderHistoryDateListByMode(nextJob.mode, nextJob.selectedKey);
        }
    }
};

// 좌측 사이드바의 일/주/월/년 단위 버튼 활성 상태를 갱신합니다.
export const updateGranularityButtons = (mode) => {
    const base = 'history-gran-btn flex-1 py-1.5 rounded-lg text-xs md:text-sm font-bold transition border';
    document.querySelectorAll('.history-gran-btn').forEach(btn => {
        const isActive = btn.dataset.granularity === mode;
        btn.className = isActive
            ? `${base} bg-blue-600 text-white border-blue-600 shadow-sm`
            : `${base} bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600`;
    });
};

// view: daily/weekly/monthly/yearly, attendance-*, report-*, personal-*, management-*
export const switchHistoryView = async (view, preserveKey = null) => {
    if (!view) return;

    const allViews = [
        'history-daily-view', 'history-weekly-view', 'history-monthly-view', 'history-yearly-view',
        'history-attendance-daily-view', 'history-attendance-weekly-view', 'history-attendance-monthly-view', 'history-attendance-yearly-view',
        'report-daily-view', 'report-weekly-view', 'report-monthly-view', 'report-yearly-view'
    ].map(id => document.getElementById(id));
    allViews.forEach(v => v && v.classList.add('hidden'));

    // 공용 사이드바 노출 (검수/연차/주말 탭에서만 숨기며, 그 처리는 서브탭 핸들러가 담당)
    const sidebar = document.getElementById('history-global-sidebar');
    if (sidebar) sidebar.style.display = '';

    let viewToShow = null;
    let listMode = 'day';

    switch (view) {
        case 'daily': listMode = 'day'; viewToShow = document.getElementById('history-daily-view'); break;
        case 'weekly': listMode = 'week'; viewToShow = document.getElementById('history-weekly-view'); break;
        case 'monthly': listMode = 'month'; viewToShow = document.getElementById('history-monthly-view'); break;
        case 'yearly': listMode = 'year'; viewToShow = document.getElementById('history-yearly-view'); break;
        case 'attendance-daily': listMode = 'day'; viewToShow = document.getElementById('history-attendance-daily-view'); break;
        case 'attendance-weekly': listMode = 'week'; viewToShow = document.getElementById('history-attendance-weekly-view'); break;
        case 'attendance-monthly': listMode = 'month'; viewToShow = document.getElementById('history-attendance-monthly-view'); break;
        case 'attendance-yearly': listMode = 'year'; viewToShow = document.getElementById('history-attendance-yearly-view'); break;
        case 'report-daily': listMode = 'day'; viewToShow = document.getElementById('report-daily-view'); break;
        case 'report-weekly': listMode = 'week'; viewToShow = document.getElementById('report-weekly-view'); break;
        case 'report-monthly': listMode = 'month'; viewToShow = document.getElementById('report-monthly-view'); break;
        case 'report-yearly': listMode = 'year'; viewToShow = document.getElementById('report-yearly-view'); break;
        // 개인/경영 지표는 단일 컨테이너에 렌더링되므로 별도 뷰 토글이 없습니다.
        case 'personal-daily': case 'management-daily': listMode = 'day'; break;
        case 'personal-weekly': case 'management-weekly': listMode = 'week'; break;
        case 'personal-monthly': case 'management-monthly': listMode = 'month'; break;
        case 'personal-yearly': case 'management-yearly': listMode = 'year'; break;
    }

    State.context.globalGranularity = listMode;
    updateGranularityButtons(listMode);

    await renderHistoryDateListByMode(listMode, preserveKey);

    if (viewToShow) viewToShow.classList.remove('hidden');
};

export const openHistoryQuantityModal = (dateKey) => {
    const todayDateString = getTodayDateString();

    if (dateKey === todayDateString) {
        const todayData = {
            id: todayDateString,
            workRecords: State.appState.workRecords || [],
            taskQuantities: State.appState.taskQuantities || {},
            confirmedZeroTasks: State.appState.confirmedZeroTasks || []
        };
        const missingTasksList = checkMissingQuantities(todayData);
        renderQuantityModalInputs(State.appState.taskQuantities || {}, State.appConfig.quantityTaskTypes, missingTasksList, State.appState.confirmedZeroTasks || []);
    } else {
        const dayData = State.allHistoryData.find(d => d.id === dateKey);
        if (!dayData) {
            return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);
        }
        const missingTasksList = checkMissingQuantities(dayData);
        renderQuantityModalInputs(dayData.taskQuantities || {}, State.appConfig.quantityTaskTypes, missingTasksList, dayData.confirmedZeroTasks || []);
    }

    const title = document.getElementById('quantity-modal-title');
    if (title) title.textContent = `${dateKey} 처리량 수정`;

    State.context.quantityModalContext.mode = 'history';
    State.context.quantityModalContext.dateKey = dateKey;

    State.context.quantityModalContext.onConfirm = async (newQuantities, confirmedZeroTasks) => {
        if (!dateKey) return;

        const idx = State.allHistoryData.findIndex(d => d.id === dateKey);
        if (idx > -1) {
            State.allHistoryData[idx] = {
                ...State.allHistoryData[idx],
                taskQuantities: newQuantities,
                confirmedZeroTasks: confirmedZeroTasks
            };
        }

        const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
        try {
            await setDoc(historyDocRef, {
                taskQuantities: newQuantities,
                confirmedZeroTasks: confirmedZeroTasks
            }, { merge: true });

            showToast(`${dateKey}의 처리량이 수정되었습니다.`);

            localStorage.removeItem('historyDataCache');
            localStorage.removeItem('historyDataCacheTime');
            localStorage.removeItem('unverifiedDataCache');
            localStorage.removeItem('unverifiedDataCacheTime');

            if (dateKey === getTodayDateString()) {
                 const dailyDocRef = getDailyDocRef();
                 await setDoc(dailyDocRef, { taskQuantities: newQuantities, confirmedZeroTasks: confirmedZeroTasks }, { merge: true });
            }

            if (DOM.historyModal && !DOM.historyModal.classList.contains('hidden')) {
                const gran = State.context.globalGranularity || 'day';
                const sub = State.context.activeMainHistoryTab || 'work';
                const viewMap = {
                    work: { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' },
                    report: { day: 'report-daily', week: 'report-weekly', month: 'report-monthly', year: 'report-yearly' }
                };
                const currentView = (viewMap[sub] || viewMap.work)[gran] || 'daily';

                await switchHistoryView(currentView, dateKey);
            }

        } catch (e) {
            console.error('Error updating history quantities:', e);
            showToast('처리량 업데이트 중 오류가 발생했습니다.', true);
        }
    };

    const cBtn = document.getElementById('confirm-quantity-btn');
    const xBtn = document.getElementById('cancel-quantity-btn');
    if (cBtn) cBtn.textContent = '수정 저장';
    if (xBtn) xBtn.textContent = '취소';
    if (DOM.quantityModal) DOM.quantityModal.classList.remove('hidden');
};

export const requestHistoryDeletion = (dateKey) => {
    State.context.historyKeyToDelete = dateKey;
    const activeTab = State.context.activeMainHistoryTab || 'work';
    let targetName = '모든';
    
    if (activeTab === 'work' || activeTab === 'report') targetName = '업무 이력(처리량 포함)';
    else if (activeTab === 'attendance') targetName = '근태 이력';
    else if (activeTab === 'management') targetName = '경영 지표';
    else if (activeTab === 'inspection') targetName = '검수 이력';

    const msgEl = document.querySelector('#delete-history-modal h3');
    if (msgEl) {
        msgEl.innerHTML = `정말로 이 날짜의 <span class="text-red-600 font-bold">${targetName}</span> 데이터를 삭제하시겠습니까?`;
    }

    if (DOM.deleteHistoryModal) DOM.deleteHistoryModal.classList.remove('hidden');
};