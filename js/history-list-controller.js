// === js/history-list-controller.js ===
// 설명: 이력 모달의 좌측 날짜 목록 관리, 탭 전환, 데이터 로딩 등 네비게이션 컨트롤러입니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString, getWeekOfYear } from './utils.js';
import { augmentHistoryWithPersistentLeave } from './history-enricher.js';
import { fetchAllHistoryData, syncTodayToHistory, getDailyDocRef } from './history-data-manager.js';
import { checkMissingQuantities } from './analysis-logic.js';
import { renderQuantityModalInputs } from './ui.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let isRenderingList = false;
let renderListQueue = null;

export const loadAndRenderHistoryList = async () => {
    if (!DOM.historyDateList) return;
    DOM.historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500 text-sm">이력 로딩 중...</div></li>';

    await fetchAllHistoryData(); 
    await syncTodayToHistory(); 

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
    State.context.reportSortState = {};
    State.context.currentReportParams = null;

    await renderHistoryDateListByMode('day');
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

            let htmlContent = '';
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

export const switchHistoryView = async (view, preserveKey = null) => {
    const allViews = [
        document.getElementById('history-daily-view'),
        document.getElementById('history-weekly-view'),
        document.getElementById('history-monthly-view'),
        document.getElementById('history-attendance-daily-view'),
        document.getElementById('history-attendance-weekly-view'),
        document.getElementById('history-attendance-monthly-view'),
        document.getElementById('report-daily-view'),
        document.getElementById('report-weekly-view'),
        document.getElementById('report-monthly-view'),
        document.getElementById('report-yearly-view')
    ];
    allViews.forEach(v => v && v.classList.add('hidden'));

    const resetTabs = (container) => {
        if (container) {
            container.querySelectorAll('button').forEach(btn => {
                btn.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
                btn.classList.add('text-gray-500');
            });
        }
    };
    resetTabs(DOM.historyTabs);
    resetTabs(DOM.attendanceHistoryTabs);
    resetTabs(DOM.reportTabs);

    const dateListContainer = document.getElementById('history-date-list-container');
    if (dateListContainer) {
        dateListContainer.style.display = 'block';
    }

    let viewToShow = null;
    let tabToActivate = null;
    let listMode = 'day';

    switch (view) {
        case 'daily':
            listMode = 'day';
            viewToShow = document.getElementById('history-daily-view');
            tabToActivate = DOM.historyTabs?.querySelector('button[data-view="daily"]');
            break;
        case 'weekly':
            listMode = 'week';
            viewToShow = document.getElementById('history-weekly-view');
            tabToActivate = DOM.historyTabs?.querySelector('button[data-view="weekly"]');
            break;
        case 'monthly':
            listMode = 'month';
            viewToShow = document.getElementById('history-monthly-view');
            tabToActivate = DOM.historyTabs?.querySelector('button[data-view="monthly"]');
            break;
        case 'attendance-daily':
            listMode = 'day';
            viewToShow = document.getElementById('history-attendance-daily-view');
            tabToActivate = DOM.attendanceHistoryTabs?.querySelector('button[data-view="attendance-daily"]');
            break;
        case 'attendance-weekly':
            listMode = 'week';
            viewToShow = document.getElementById('history-attendance-weekly-view');
            tabToActivate = DOM.attendanceHistoryTabs?.querySelector('button[data-view="attendance-weekly"]');
            break;
        case 'attendance-monthly':
            listMode = 'month';
            viewToShow = document.getElementById('history-attendance-monthly-view');
            tabToActivate = DOM.attendanceHistoryTabs?.querySelector('button[data-view="attendance-monthly"]');
            break;
        case 'report-daily':
            listMode = 'day';
            viewToShow = document.getElementById('report-daily-view');
            tabToActivate = DOM.reportTabs?.querySelector('button[data-view="report-daily"]');
            break;
        case 'report-weekly':
            listMode = 'week';
            viewToShow = document.getElementById('report-weekly-view');
            tabToActivate = DOM.reportTabs?.querySelector('button[data-view="report-weekly"]');
            break;
        case 'report-monthly':
            listMode = 'month';
            viewToShow = document.getElementById('report-monthly-view');
            tabToActivate = DOM.reportTabs?.querySelector('button[data-view="report-monthly"]');
            break;
        case 'report-yearly':
            listMode = 'year';
            viewToShow = document.getElementById('report-yearly-view');
            tabToActivate = DOM.reportTabs?.querySelector('button[data-view="report-yearly"]');
            break;
    }

    await renderHistoryDateListByMode(listMode, preserveKey);

    if (viewToShow) viewToShow.classList.remove('hidden');
    if (tabToActivate) {
        tabToActivate.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
        tabToActivate.classList.remove('text-gray-500');
    }
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

            sessionStorage.removeItem('historyDataCache');
            sessionStorage.removeItem('historyDataCacheTime');
            sessionStorage.removeItem('unverifiedDataCache');
            sessionStorage.removeItem('unverifiedDataCacheTime');

            if (dateKey === getTodayDateString()) {
                 const dailyDocRef = getDailyDocRef();
                 await setDoc(dailyDocRef, { taskQuantities: newQuantities, confirmedZeroTasks: confirmedZeroTasks }, { merge: true });
            }

            if (DOM.historyModal && !DOM.historyModal.classList.contains('hidden')) {
                const activeSubTabBtn = document.querySelector('#history-tabs button.font-semibold')
                                     || document.querySelector('#report-tabs button.font-semibold');
                const currentView = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
                
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