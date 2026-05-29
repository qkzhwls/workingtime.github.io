// === js/listeners-history-tabs.js ===
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';

import { renderDashboardTab } from './ui-history-dashboard.js';
import { renderProductivityTab } from './ui-history-productivity.js';
import { renderStaffingTab } from './ui-history-staffing.js';
// 💡 실적 예측 함수 불러오기 추가
import { renderPredictionTab } from './ui-history-prediction.js';
import { fetchAndRenderInspectionHistory } from './listeners-history-inspection.js';
import * as UILeave from './ui-history-leave.js';
import { switchHistoryView, renderHistoryDateListByMode } from './app-history-logic.js';
import { loadAndRenderWeekendStats } from './ui-history-weekend.js';

// 공용 헬퍼 함수 (기간 필터링된 이력 데이터 반환)
export const getFilteredHistoryData = () => {
    return (State.context.historyStartDate || State.context.historyEndDate)
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
};

// 1. 글로벌 필터 및 통합 다운로드 리스너
export function setupGlobalFilterListeners() {
    const presetBtn = document.getElementById('global-period-preset');
    const startInput = document.getElementById('global-start-date');
    const endInput = document.getElementById('global-end-date');
    const applyBtn = document.getElementById('global-filter-btn');
    const globalExcelBtn = document.getElementById('global-download-excel-btn');

    if (presetBtn && startInput && endInput && applyBtn) {
        if (!presetBtn.querySelector('option[value="year"]')) {
            const yearOpt = document.createElement('option');
            yearOpt.value = 'year'; yearOpt.textContent = '올해';
            const allOpt = document.createElement('option');
            allOpt.value = 'all'; allOpt.textContent = '전체';
            const customOpt = presetBtn.querySelector('option[value="custom"]');
            if (customOpt) {
                presetBtn.insertBefore(yearOpt, customOpt);
                presetBtn.insertBefore(allOpt, customOpt);
            }
        }

        const updateDates = () => {
            const val = presetBtn.value;
            const today = new Date();
            let start = '', end = '';
            
            if (val === 'today') {
                start = end = getTodayDateString();
            } else if (val === 'week') {
                const day = today.getDay();
                const diff = today.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(today.setDate(diff));
                start = monday.toISOString().split('T')[0];
                const sunday = new Date(monday);
                sunday.setDate(monday.getDate() + 6);
                end = sunday.toISOString().split('T')[0];
            } else if (val === 'month') {
                start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
                end = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
            } else if (val === 'year') {
                start = `${today.getFullYear()}-01-01`;
                end = `${today.getFullYear()}-12-31`;
            } else if (val === 'all') {
                start = ''; end = '';
            }
            
            if (val !== 'custom') { startInput.value = start; endInput.value = end; }
        };

        updateDates();
        presetBtn.addEventListener('change', updateDates);
        
        applyBtn.addEventListener('click', () => {
            State.context.historyStartDate = startInput.value || null;
            State.context.historyEndDate = endInput.value || null;
            showToast('조회 기간이 적용되었습니다.');
            
            const activeMainBtn = document.querySelector('.history-main-tab-btn.text-blue-600');
            if (activeMainBtn) {
                if (activeMainBtn.dataset.mainTab === 'rawdata') {
                    const activeSubTab = document.querySelector('.rawdata-sub-tab-btn.font-bold');
                    if (activeSubTab) activeSubTab.click();
                } else activeMainBtn.click();
            }
        });
    }

    if (globalExcelBtn) {
        globalExcelBtn.addEventListener('click', () => {
            const filteredData = getFilteredHistoryData();
            if (!filteredData || filteredData.length === 0) return showToast('다운로드할 데이터가 없습니다.', true);

            let csvContent = "\uFEFF날짜,출근 인원(명),총 업무시간(분),총 인건비(원),총 생산량(개),종합 UPH\n";
            let totalMembers = 0, totalMins = 0, totalCost = 0, totalQty = 0;
            const sortedData = [...filteredData].sort((a, b) => a.id.localeCompare(b.id));

            sortedData.forEach(day => {
                const memCount = new Set((day.workRecords || []).map(r => r.member)).size;
                let dayMin = 0, dayCost = 0, dayQty = 0;
                
                (day.workRecords || []).forEach(r => {
                    dayMin += (r.duration || 0);
                    const wage = State.appConfig?.memberWages?.[r.member] || 10000;
                    dayCost += ((r.duration || 0) / 60) * wage;
                });
                Object.values(day.taskQuantities || {}).forEach(q => { dayQty += (Number(q) || 0); });

                const dayUph = dayMin > 0 ? (dayQty / (dayMin / 60)).toFixed(1) : 0;
                totalMembers += memCount; totalMins += dayMin; totalCost += dayCost; totalQty += dayQty;

                csvContent += `${day.id},${memCount},${dayMin},${Math.round(dayCost)},${dayQty},${dayUph}\n`;
            });

            const totalUph = totalMins > 0 ? (totalQty / (totalMins / 60)).toFixed(1) : 0;
            csvContent += `\n합계,-,${totalMins},${Math.round(totalCost)},${totalQty},${totalUph}\n`;

            const fileName = `물류팀_통합데이터_${State.context.historyStartDate || '전체'}_to_${State.context.historyEndDate || '전체'}.csv`;
            const link = document.createElement("a");
            link.setAttribute("href", URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })));
            link.setAttribute("download", fileName);
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
            showToast('통합 엑셀 데이터가 성공적으로 다운로드되었습니다.');
        });
    }
}

// 2. 메인/서브 탭 이동 리스너
export function setupHistoryTabsListeners() {
    const mainTabsContainer = document.getElementById('history-main-tabs');
    if (mainTabsContainer) {
        mainTabsContainer.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-main-tab]');
            if (!btn) return;
            const tabName = btn.dataset.mainTab;
            
            document.querySelectorAll('.history-main-tab-btn').forEach(b => {
                const isActive = (b === btn);
                b.className = isActive 
                    ? 'history-main-tab-btn py-4 font-bold text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 transition whitespace-nowrap'
                    : 'history-main-tab-btn py-4 font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 border-b-2 border-transparent transition whitespace-nowrap';
            });

            // 💡 실적 예측 패널 토글 추가
            document.getElementById('dashboard-panel').classList.toggle('hidden', tabName !== 'dashboard');
            document.getElementById('productivity-panel').classList.toggle('hidden', tabName !== 'productivity');
            document.getElementById('staffing-panel').classList.toggle('hidden', tabName !== 'staffing');
            document.getElementById('prediction-panel').classList.toggle('hidden', tabName !== 'prediction');
            document.getElementById('rawdata-panel').classList.toggle('hidden', tabName !== 'rawdata');

            const filteredData = getFilteredHistoryData();
            
            // 💡 실적 예측 렌더링 호출 추가
            if (tabName === 'dashboard') renderDashboardTab(filteredData, State.appConfig);
            else if (tabName === 'productivity') renderProductivityTab(filteredData, State.appConfig);
            else if (tabName === 'staffing') renderStaffingTab(filteredData, State.appConfig);
            else if (tabName === 'prediction') renderPredictionTab(filteredData);
            else if (tabName === 'rawdata') {
                const firstSub = document.querySelector('.rawdata-sub-tab-btn[data-sub-tab="work"]');
                if (firstSub) firstSub.click();
            }
        });
    }

    document.querySelectorAll('.rawdata-sub-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const subTabName = e.target.dataset.subTab;
            State.context.activeMainHistoryTab = subTabName;
            
            document.querySelectorAll('.rawdata-sub-tab-btn').forEach(b => {
                 const isActive = (b === e.target);
                 b.className = isActive
                    ? 'rawdata-sub-tab-btn py-3 text-sm font-bold text-gray-800 dark:text-gray-200 border-b-2 border-gray-800 dark:border-gray-200 whitespace-nowrap'
                    : 'rawdata-sub-tab-btn py-3 text-sm font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 border-b-2 border-transparent whitespace-nowrap';
            });

            const panels = {
                'work': document.getElementById('work-history-panel'),
                'attendance': document.getElementById('attendance-history-panel'),
                'report': document.getElementById('report-panel'),
                'personal': document.getElementById('personal-report-panel'),
                'management': document.getElementById('management-panel'),
                'inspection': document.getElementById('inspection-history-panel'),
                'leave': document.getElementById('history-leave-panel'),
                'weekend': document.getElementById('history-weekend-panel')
            };

            Object.keys(panels).forEach(key => { if (panels[key]) panels[key].classList.toggle('hidden', key !== subTabName); });
            
            const dateListContainer = document.getElementById('history-date-list-container');
            if (dateListContainer) {
                dateListContainer.style.display = ['inspection', 'leave', 'weekend'].includes(subTabName) ? 'none' : 'block';
            }

            if (subTabName === 'work') switchHistoryView(DOM.historyTabs?.querySelector('button.font-semibold')?.dataset.view || 'daily');
            else if (subTabName === 'attendance') switchHistoryView(DOM.attendanceHistoryTabs?.querySelector('button.font-semibold')?.dataset.view || 'attendance-daily');
            else if (subTabName === 'report') switchHistoryView(DOM.reportTabs?.querySelector('button.font-semibold')?.dataset.view || 'report-daily');
            else if (subTabName === 'personal') {
                if (DOM.personalReportMemberSelect && DOM.personalReportMemberSelect.options.length <= 1) {
                    const staff = (State.appConfig.teamGroups || []).flatMap(g => g.members);
                    const partTimers = (State.appState.partTimers || []).map(p => p.name);
                    const allMembers = [...new Set([...staff, ...partTimers])].sort();
                    
                    DOM.personalReportMemberSelect.innerHTML = '<option value="">직원 선택...</option>';
                    allMembers.forEach(m => {
                        const op = document.createElement('option'); op.value = m; op.textContent = m;
                        DOM.personalReportMemberSelect.appendChild(op);
                    });
                    
                    if (State.appState.currentUser && allMembers.includes(State.appState.currentUser)) {
                        DOM.personalReportMemberSelect.value = State.appState.currentUser;
                        State.context.personalReportMember = State.appState.currentUser;
                    }
                }
                const viewMode = DOM.personalReportTabs?.querySelector('button.font-semibold')?.dataset.view || 'personal-daily';
                renderHistoryDateListByMode(viewMode.includes('weekly') ? 'week' : viewMode.includes('monthly') ? 'month' : viewMode.includes('yearly') ? 'year' : 'day');
            } else if (subTabName === 'management') {
                const viewMode = document.getElementById('management-tabs')?.querySelector('button.font-semibold')?.dataset.view || 'management-daily';
                renderHistoryDateListByMode(viewMode.includes('weekly') ? 'week' : viewMode.includes('monthly') ? 'month' : viewMode.includes('yearly') ? 'year' : 'day');
            } else if (subTabName === 'inspection') fetchAndRenderInspectionHistory();
            else if (subTabName === 'leave') UILeave.initLeaveManagement();
            else if (subTabName === 'weekend') loadAndRenderWeekendStats();
        });
    });
}