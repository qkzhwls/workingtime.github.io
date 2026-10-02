// === js/listeners-history-tabs.js ===
import * as DOM from './dom-elements.js?v=202610021042';
import * as State from './state.js?v=202610021042';
import { showToast, getTodayDateString, getWeekOfYear, buildMemberHourlyWageMap } from './utils.js?v=202610021042';

import { renderDashboardTab } from './ui-history-dashboard.js?v=202610021042';
import { renderProductivityTab } from './ui-history-productivity.js?v=202610021042';
import { renderStaffingTab } from './ui-history-staffing.js?v=202610021042';
// 💡 실적 예측 함수 불러오기 추가
import { renderPredictionTab, renderForecastTab } from './ui-history-prediction.js?v=202610021042';
import { fetchAndRenderInspectionHistory } from './listeners-history-inspection.js?v=202610021042';
import * as UILeave from './ui-history-leave.js?v=202610021042';
import { switchHistoryView, renderHistoryDateListByMode, updateGranularityButtons } from './app-history-logic.js?v=202610021042';
import { saveView } from './view-state.js?v=202610021042';

// 좌측 트리 단위(globalGranularity) → 각 로우데이터 서브탭의 뷰 이름 매핑
const SUBTAB_VIEW = {
    work:       { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' },
    attendance: { day: 'attendance-daily', week: 'attendance-weekly', month: 'attendance-monthly', year: 'attendance-yearly' },
    report:     { day: 'report-daily', week: 'report-weekly', month: 'report-monthly', year: 'report-yearly' },
    personal:   { day: 'personal-daily', week: 'personal-weekly', month: 'personal-monthly', year: 'personal-yearly' },
    management: { day: 'management-daily', week: 'management-weekly', month: 'management-monthly', year: 'management-yearly' }
};

// 선택된 트리 노드(키)와 단위로부터 해당 기간의 이력 데이터 배열을 만든다 (분석 탭용)
export const getPeriodFilteredData = (granularity, key) => {
    const all = State.allHistoryData || [];
    if (!key) return [];
    if (granularity === 'week') {
        return all.filter(d => {
            try { return getWeekOfYear(new Date(d.id + "T00:00:00")) === key; } catch (e) { return false; }
        });
    }
    if (granularity === 'month') return all.filter(d => typeof d.id === 'string' && d.id.substring(0, 7) === key);
    if (granularity === 'year') return all.filter(d => typeof d.id === 'string' && d.id.substring(0, 4) === key);
    // day (기본)
    return all.filter(d => d.id === key);
};

// 분석 탭(대시보드/생산성/인력/예측)을 선택 기간 데이터로 렌더링
export const renderAnalyticsTab = (mainView, filteredData) => {
    if (mainView === 'dashboard') renderDashboardTab(filteredData, State.appConfig);
    else if (mainView === 'productivity') renderProductivityTab(filteredData, State.appConfig);
    else if (mainView === 'staffing') renderStaffingTab(filteredData, State.appConfig);
    else if (mainView === 'prediction') renderPredictionTab(State.allHistoryData); // 예측은 전체 이력 사용
};

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

// 좌측 트리에서 현재 선택된 노드 키를 반환
const getSelectedTreeKey = () => document.querySelector('.history-date-btn.bg-blue-100')?.dataset.key || null;

// 1. 통합 다운로드 리스너 (선택 기간 기준). 날짜 조회 컨트롤은 좌측 트리로 대체됨.
export function setupGlobalFilterListeners() {
    const globalExcelBtn = document.getElementById('global-download-excel-btn');

    if (globalExcelBtn) {
        globalExcelBtn.addEventListener('click', () => {
            const gran = State.context.globalGranularity || 'day';
            const selectedKey = getSelectedTreeKey();
            const filteredData = selectedKey ? getPeriodFilteredData(gran, selectedKey) : (State.allHistoryData || []);
            if (!filteredData || filteredData.length === 0) return showToast('다운로드할 데이터가 없습니다.', true);

            let csvContent = "\uFEFF날짜,출근 인원(명),총 업무시간(분),총 인건비(원),총 생산량(개),종합 UPH\n";
            let totalMembers = 0, totalMins = 0, totalCost = 0, totalQty = 0;
            const sortedData = [...filteredData].sort((a, b) => a.id.localeCompare(b.id));
            // memberWages는 월기본급 → 시급(÷209)로 환산. 명단에 없으면 파트타이머 기본시급 10000.
            const hourlyWages = buildMemberHourlyWageMap(State.appConfig?.memberWages);

            sortedData.forEach(day => {
                const memCount = new Set((day.workRecords || []).map(r => r.member)).size;
                let dayMin = 0, dayCost = 0, dayQty = 0;

                (day.workRecords || []).forEach(r => {
                    dayMin += (r.duration || 0);
                    const wage = hourlyWages[r.member] || 10000;
                    dayCost += ((r.duration || 0) / 60) * wage;
                });
                Object.values(day.taskQuantities || {}).forEach(q => { dayQty += (Number(q) || 0); });

                const dayUph = dayMin > 0 ? (dayQty / (dayMin / 60)).toFixed(1) : 0;
                totalMembers += memCount; totalMins += dayMin; totalCost += dayCost; totalQty += dayQty;

                csvContent += `${day.id},${memCount},${dayMin},${Math.round(dayCost)},${dayQty},${dayUph}\n`;
            });

            const totalUph = totalMins > 0 ? (totalQty / (totalMins / 60)).toFixed(1) : 0;
            csvContent += `\n합계,-,${totalMins},${Math.round(totalCost)},${totalQty},${totalUph}\n`;

            const fileName = `물류팀_통합데이터_${selectedKey || '전체'}.csv`;
            const link = document.createElement("a");
            link.setAttribute("href", URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })));
            link.setAttribute("download", fileName);
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
            showToast('통합 엑셀 데이터가 성공적으로 다운로드되었습니다.');
        });
    }
}

const TREELESS_SUBTABS = ['inspection', 'leave'];

// 검수/연차 등 트리를 쓰지 않는 서브탭 진입 처리
const loadTreelessSubTab = (subTabName) => {
    if (subTabName === 'inspection') fetchAndRenderInspectionHistory();
    else if (subTabName === 'leave') UILeave.initLeaveManagement();
};

// 직원 선택 셀렉트 채우기 (개인 리포트)
const populatePersonalMemberSelect = () => {
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
};

// 활성 로우데이터 서브탭을 현재 단위(globalGranularity)로 렌더링
const renderActiveRawSubTab = (subTabName) => {
    const gran = State.context.globalGranularity || 'day';
    if (subTabName === 'personal') populatePersonalMemberSelect();
    const map = SUBTAB_VIEW[subTabName];
    if (map) switchHistoryView(map[gran] || map.day);
};

// 2. 메인/서브 탭 이동 리스너
export function setupHistoryTabsListeners() {
    const mainTabsContainer = document.getElementById('history-main-tabs');
    if (mainTabsContainer) {
        mainTabsContainer.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-main-tab]');
            if (!btn) return;
            const tabName = btn.dataset.mainTab;
            State.context.activeHistoryView = tabName;
            saveView({ main: tabName });   // 새로고침해도 이 탭으로 돌아오도록

            document.querySelectorAll('.history-main-tab-btn').forEach(b => {
                const isActive = (b === btn);
                b.className = isActive
                    ? 'history-main-tab-btn py-4 font-bold text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 transition whitespace-nowrap'
                    : 'history-main-tab-btn py-4 font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 border-b-2 border-transparent transition whitespace-nowrap';
            });

            document.getElementById('dashboard-panel').classList.toggle('hidden', tabName !== 'dashboard');
            document.getElementById('productivity-panel').classList.toggle('hidden', tabName !== 'productivity');
            document.getElementById('staffing-panel').classList.toggle('hidden', tabName !== 'staffing');
            document.getElementById('prediction-panel').classList.toggle('hidden', tabName !== 'prediction');
            const forecastPanel = document.getElementById('forecast-panel');
            if (forecastPanel) forecastPanel.classList.toggle('hidden', tabName !== 'forecast');
            document.getElementById('rawdata-panel').classList.toggle('hidden', tabName !== 'rawdata');
            const milestonesPanel = document.getElementById('milestones-panel');
            if (milestonesPanel) milestonesPanel.classList.toggle('hidden', tabName !== 'milestones');
            const settlementPanel = document.getElementById('settlement-panel');
            if (settlementPanel) settlementPanel.classList.toggle('hidden', tabName !== 'settlement');

            // 📐 업무 예상 탭: 오늘·내일 자동 예측 + 상세 시뮬레이션 (미래 기준이라 사이드바 숨김)
            if (tabName === 'forecast') {
                try {
                    const sidebar = document.getElementById('history-global-sidebar');
                    if (sidebar) sidebar.style.display = 'none';
                    renderForecastTab();
                } catch (err) {
                    console.error('forecast tab render failed:', err);
                }
                return;
            }

            // 📍 마일스톤 탭: 처음 들어올 때 1회 구독 + 리스너 바인딩
            if (tabName === 'milestones') {
                try {
                    const mod = await import('./ui-history-milestones.js?v=202610021042');
                    mod.subscribeMilestones();
                    mod.bindMilestoneListeners();
                    // 사이드바 숨김 (마일스톤은 자체 리스트 사용)
                    const sidebar = document.getElementById('history-global-sidebar');
                    if (sidebar) sidebar.style.display = 'none';
                } catch (err) {
                    console.error('milestones module load failed:', err);
                }
                return; // 아래의 분석 탭 폴백 로직 스킵
            }

            // 🧾 팀 결산 보고 탭: 월/분기/년 단위 종합 요약 보고서 (자체 기간 선택 UI 사용)
            if (tabName === 'settlement') {
                try {
                    const mod = await import('./ui-history-settlement.js?v=202610021042');
                    await mod.initSettlementReport();
                    const sidebar = document.getElementById('history-global-sidebar');
                    if (sidebar) sidebar.style.display = 'none';
                } catch (err) {
                    console.error('settlement module load failed:', err);
                }
                return;
            }

            const gran = State.context.globalGranularity || 'day';

            if (tabName === 'rawdata') {
                // 사이드바 노출 여부는 활성 서브탭이 결정
                const activeSub = document.querySelector('.rawdata-sub-tab-btn.font-bold')
                                || document.querySelector('.rawdata-sub-tab-btn[data-sub-tab="work"]');
                if (activeSub) activeSub.click();
            } else {
                // 분석 탭: 공용 사이드바 표시 + 트리 렌더(자동 선택 시 node-click이 분석 렌더링)
                const sidebar = document.getElementById('history-global-sidebar');
                if (sidebar) sidebar.style.display = '';
                updateGranularityButtons(gran);
                await renderHistoryDateListByMode(gran);
                if (!document.querySelector('.history-date-btn.bg-blue-100')) {
                    renderAnalyticsTab(tabName, []); // 데이터 없을 때 폴백
                }
            }
        });
    }

    document.querySelectorAll('.rawdata-sub-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const subTabName = e.target.dataset.subTab;
            State.context.activeMainHistoryTab = subTabName;
            saveView({ main: 'rawdata', sub: subTabName });

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
                'leave': document.getElementById('history-leave-panel')
            };

            Object.keys(panels).forEach(key => { if (panels[key]) panels[key].classList.toggle('hidden', key !== subTabName); });

            // 공용 사이드바: 트리를 쓰지 않는 탭에서는 숨김
            const sidebar = document.getElementById('history-global-sidebar');
            if (sidebar) sidebar.style.display = TREELESS_SUBTABS.includes(subTabName) ? 'none' : '';

            if (TREELESS_SUBTABS.includes(subTabName)) loadTreelessSubTab(subTabName);
            else renderActiveRawSubTab(subTabName);
        });
    });

    setupGranularityListeners();
}

// 3. 좌측 사이드바의 일/주/월/년 단위 버튼 리스너
function setupGranularityListeners() {
    const controls = document.getElementById('history-granularity-controls');
    if (!controls) return;

    controls.addEventListener('click', async (e) => {
        const btn = e.target.closest('.history-gran-btn');
        if (!btn) return;
        const gran = btn.dataset.granularity;
        if (!gran) return;

        State.context.globalGranularity = gran;
        saveView({ gran });
        updateGranularityButtons(gran);

        const mainView = State.context.activeHistoryView || 'rawdata';

        if (mainView !== 'rawdata') {
            await renderHistoryDateListByMode(gran);
            if (!document.querySelector('.history-date-btn.bg-blue-100')) {
                renderAnalyticsTab(mainView, []);
            }
            return;
        }

        const sub = State.context.activeMainHistoryTab || 'work';
        if (TREELESS_SUBTABS.includes(sub)) return; // 단위 개념이 없는 탭
        renderActiveRawSubTab(sub);
    });
}