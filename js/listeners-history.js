// === js/listeners-history.js ===
// 설명: 이력 보기 모달의 메인 진입점으로, 하위 리스너 모듈을 통합하고 탭/필터/윈도우 제어를 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';

// 분리된 하위 리스너 모듈 임포트
import { setupHistoryDownloadListeners, openDownloadFormatModal } from './listeners-history-download.js';
import { setupHistoryRecordListeners } from './listeners-history-records.js';
import { setupHistoryAttendanceListeners } from './listeners-history-attendance.js';
import { setupHistoryInspectionListeners, fetchAndRenderInspectionHistory } from './listeners-history-inspection.js';

import {
    renderTrendAnalysisCharts,
    trendCharts
} from './ui.js';

import {
    loadAndRenderHistoryList,
    renderHistoryDetail,
    switchHistoryView,
    renderHistoryDateListByMode,
    openHistoryQuantityModal,
    // requestHistoryDeletion, // <--- 제거됨 (이 파일 내에서 재정의)
    augmentHistoryWithPersistentLeave 
} from './app-history-logic.js';

import {
    renderAttendanceDailyHistory,
    renderAttendanceWeeklyHistory,
    renderAttendanceMonthlyHistory,
    renderReportDaily,
    renderReportWeekly,
    renderReportMonthly,
    renderReportYearly,
    renderPersonalReport,
    renderManagementDaily,
    renderManagementSummary,
    renderWeeklyHistory,
    renderMonthlyHistory,
    renderPredictionTab
} from './ui-history.js';

// [신규] 연차 관리 로직 임포트
import * as UILeave from './ui-history-leave.js';

import {
    syncTodayToHistory,
    saveManagementData 
} from './history-data-manager.js';

import { doc, deleteDoc, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let isHistoryMaximized = false;

export function setupHistoryModalListeners() {
    
    // 1. 하위 모듈 리스너 초기화
    setupHistoryDownloadListeners();
    setupHistoryRecordListeners();
    setupHistoryAttendanceListeners();
    setupHistoryInspectionListeners();

    // --- DOM 요소 참조 ---
    const managementPanel = document.getElementById('management-panel');
    const managementTabs = document.getElementById('management-tabs');
    const managementSaveBtn = document.getElementById('management-save-btn');
    const inspectionPanel = document.getElementById('inspection-history-panel');
    const predictionPanel = document.getElementById('prediction-panel');
    const predictionDaysSelect = document.getElementById('prediction-days-select');
    
    // [신규] 연차 패널 참조
    const leavePanel = document.getElementById('history-leave-panel');

    const iconMaximize = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m0 0V4m0 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m0 0v-4m0 0l-5-5" />`;
    const iconMinimize = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />`;

    // --- 전체화면 제어 ---
    const setHistoryMaximized = (maximized) => {
        isHistoryMaximized = maximized;
        const toggleBtn = document.getElementById('toggle-history-fullscreen-btn');
        const icon = toggleBtn?.querySelector('svg');

        DOM.historyModalContentBox.removeAttribute('style');
        DOM.historyModalContentBox.dataset.hasBeenUncentered = 'false';
        
        if (maximized) {
            DOM.historyModal.classList.remove('flex', 'items-center', 'justify-center', 'p-4');
            DOM.historyModalContentBox.classList.add('fixed', 'inset-0', 'w-full', 'h-full', 'z-[150]', 'rounded-none');
            DOM.historyModalContentBox.classList.remove('relative', 'w-[1400px]', 'h-[880px]', 'rounded-2xl', 'shadow-2xl');
            if (toggleBtn) toggleBtn.title = "기본 크기로";
            if (icon) icon.innerHTML = iconMinimize;
        } else {
            DOM.historyModal.classList.add('flex', 'items-center', 'justify-center', 'p-4');
            DOM.historyModalContentBox.classList.remove('fixed', 'inset-0', 'h-full', 'z-[150]', 'rounded-none');
            DOM.historyModalContentBox.classList.add('relative', 'w-[1400px]', 'h-[880px]', 'rounded-2xl', 'shadow-2xl');
            if (toggleBtn) toggleBtn.title = "전체화면";
            if (icon) icon.innerHTML = iconMaximize;
        }
    };
    
    const getCurrentHistoryListMode = () => {
        let activeSubTabBtn;
        if (State.context.activeMainHistoryTab === 'work') {
            activeSubTabBtn = DOM.historyTabs?.querySelector('button.font-semibold');
        } else if (State.context.activeMainHistoryTab === 'attendance') {
            activeSubTabBtn = DOM.attendanceHistoryTabs?.querySelector('button.font-semibold');
        } else if (State.context.activeMainHistoryTab === 'report') {
            activeSubTabBtn = DOM.reportTabs?.querySelector('button.font-semibold');
        } else if (State.context.activeMainHistoryTab === 'personal') {
            activeSubTabBtn = DOM.personalReportTabs?.querySelector('button.font-semibold');
        } else if (State.context.activeMainHistoryTab === 'management') {
            activeSubTabBtn = managementTabs?.querySelector('button.font-semibold');
        }

        const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (State.context.activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');

        if (activeView.includes('yearly')) return 'year';
        if (activeView.includes('weekly')) return 'week';
        if (activeView.includes('monthly')) return 'month';
        return 'day';
    };

    // --- 헬퍼 함수들 ---
    const getFilteredHistoryData = () => {
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

    const getSelectedDateKey = () => {
        const btn = DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100');
        return btn ? btn.dataset.key : null;
    };

    // 뷰 갱신 함수들
    const refreshAttendanceView = async () => {
        const dateKey = getSelectedDateKey();
        if (dateKey === getTodayDateString()) {
            await syncTodayToHistory();
            augmentHistoryWithPersistentLeave(State.allHistoryData, State.persistentLeaveSchedule);
        }
        const filteredData = getFilteredHistoryData();
        const activeSubTabBtn = DOM.attendanceHistoryTabs?.querySelector('button.font-semibold');
        const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'attendance-daily';

        if (view === 'attendance-daily') {
            if (dateKey) renderAttendanceDailyHistory(dateKey, filteredData);
        } else if (view === 'attendance-weekly') {
             if (dateKey) renderAttendanceWeeklyHistory(dateKey, filteredData);
        } else if (view === 'attendance-monthly') {
             if (dateKey) renderAttendanceMonthlyHistory(dateKey, filteredData);
        }
    };

    const refreshReportView = () => {
        const dateKey = getSelectedDateKey();
        const filteredData = getFilteredHistoryData();
        const activeSubTabBtn = DOM.reportTabs?.querySelector('button.font-semibold');
        const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'report-daily';

        if (view === 'report-daily') renderReportDaily(dateKey, filteredData, State.appConfig, State.context);
        else if (view === 'report-weekly') renderReportWeekly(dateKey, filteredData, State.appConfig, State.context);
        else if (view === 'report-monthly') renderReportMonthly(dateKey, filteredData, State.appConfig, State.context);
        else if (view === 'report-yearly') renderReportYearly(dateKey, filteredData, State.appConfig, State.context);
    };
    
    const refreshPersonalView = () => {
        const dateKey = getSelectedDateKey();
        const activeSubTabBtn = DOM.personalReportTabs?.querySelector('button.font-semibold');
        const viewMode = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'personal-daily';
        const memberName = DOM.personalReportMemberSelect?.value;
        
        if (dateKey && memberName) {
            renderPersonalReport('personal-report-content', viewMode, dateKey, memberName, State.allHistoryData);
        }
    };

    const refreshManagementView = () => {
        const dateKey = getSelectedDateKey();
        const activeSubTabBtn = managementTabs?.querySelector('button.font-semibold');
        const viewMode = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'management-daily';
        if (!dateKey) return;

        if (viewMode === 'management-daily') {
            renderManagementDaily(dateKey, State.allHistoryData);
        } else {
            renderManagementSummary(viewMode, dateKey, State.allHistoryData);
        }
    };

    // --- 이벤트 리스너 ---
    if (DOM.historyFilterBtn) {
        DOM.historyFilterBtn.addEventListener('click', () => {
            const startDate = DOM.historyStartDateInput.value;
            const endDate = DOM.historyEndDateInput.value;
            if (startDate && endDate && endDate < startDate) {
                showToast('종료일은 시작일보다 이후여야 합니다.', true); return;
            }
            State.context.historyStartDate = startDate || null;
            State.context.historyEndDate = endDate || null;
            State.context.reportSortState = {};
            renderHistoryDateListByMode(getCurrentHistoryListMode());
            showToast('이력 목록을 필터링했습니다.');
        });
    }

    if (DOM.historyClearFilterBtn) {
        DOM.historyClearFilterBtn.addEventListener('click', () => {
            DOM.historyStartDateInput.value = '';
            DOM.historyEndDateInput.value = '';
            State.context.historyStartDate = null;
            State.context.historyEndDate = null;
            State.context.reportSortState = {};
            renderHistoryDateListByMode(getCurrentHistoryListMode());
            showToast('필터를 초기화했습니다.');
        });
    }

    const openHistoryModalLogic = async () => {
        if (!State.auth || !State.auth.currentUser) {
            showToast('이력을 보려면 로그인이 필요합니다.', true);
            if (DOM.historyModal) DOM.historyModal.classList.add('hidden');
            if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
            return;
        }
        if (DOM.historyModal) {
            DOM.historyModal.classList.remove('hidden');
            setHistoryMaximized(false);
            if (DOM.historyStartDateInput) DOM.historyStartDateInput.value = '';
            if (DOM.historyEndDateInput) DOM.historyEndDateInput.value = '';
            State.context.historyStartDate = null;
            State.context.historyEndDate = null;
            try {
                await loadAndRenderHistoryList();
            } catch (loadError) {
                console.error("이력 데이터 로딩 중 오류:", loadError);
                showToast("이력 데이터를 불러오는 중 오류가 발생했습니다.", true);
            }
        }
    };

    if (DOM.openHistoryBtn) DOM.openHistoryBtn.addEventListener('click', openHistoryModalLogic);
    if (DOM.openHistoryBtnMobile) DOM.openHistoryBtnMobile.addEventListener('click', () => {
        openHistoryModalLogic();
        if (DOM.navContent) DOM.navContent.classList.add('hidden');
    });
    if (DOM.closeHistoryBtn) DOM.closeHistoryBtn.addEventListener('click', () => {
        if (DOM.historyModal) {
            DOM.historyModal.classList.add('hidden');
            setHistoryMaximized(false);
        }
    });

    if (DOM.historyDateList) {
        DOM.historyDateList.addEventListener('click', (e) => {
            const btn = e.target.closest('.history-date-btn');
            if (btn) {
                DOM.historyDateList.querySelectorAll('button').forEach(b => b.classList.remove('bg-blue-100', 'font-bold'));
                btn.classList.add('bg-blue-100', 'font-bold');
                const dateKey = btn.dataset.key;

                let activeMainTab = State.context.activeMainHistoryTab || 'work';
                State.context.activeFilterDropdown = null; 

                if (activeMainTab === 'attendance') { refreshAttendanceView(); return; }
                else if (activeMainTab === 'management') { refreshManagementView(); return; }

                const filteredData = getFilteredHistoryData();
                State.context.reportSortState = {};

                if (activeMainTab === 'work') {
                    const activeSubTabBtn = DOM.historyTabs?.querySelector('button.font-semibold');
                    const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
                    if (activeView === 'daily') {
                        const currentIndex = filteredData.findIndex(d => d.id === dateKey);
                        const previousDayData = (currentIndex > -1 && currentIndex + 1 < filteredData.length) ? filteredData[currentIndex + 1] : null;
                        renderHistoryDetail(dateKey, previousDayData);
                    } else if (activeView === 'weekly') {
                        renderWeeklyHistory(dateKey, filteredData, State.appConfig);
                    } else if (activeView === 'monthly') {
                        renderMonthlyHistory(dateKey, filteredData, State.appConfig);
                    }
                } else if (activeMainTab === 'report') {
                    refreshReportView();
                } else if (activeMainTab === 'personal') {
                    refreshPersonalView();
                }
            }
        });
    }

    const handleTabSwitch = (e, tabsContainer) => {
        const btn = e.target.closest('button[data-view]');
        if (btn) {
            State.context.activeFilterDropdown = null;
            if (tabsContainer) {
                tabsContainer.querySelectorAll('button').forEach(b => {
                    b.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
                    b.classList.add('text-gray-500', 'hover:text-gray-700');
                });
                btn.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
                btn.classList.remove('text-gray-500', 'hover:text-gray-700');
            }
            if (tabsContainer === DOM.personalReportTabs || tabsContainer === managementTabs) {
                const viewMode = btn.dataset.view;
                let listMode = 'day';
                if(viewMode.includes('weekly')) listMode = 'week';
                if(viewMode.includes('monthly')) listMode = 'month';
                if(viewMode.includes('yearly')) listMode = 'year';
                renderHistoryDateListByMode(listMode);
            } else {
                switchHistoryView(btn.dataset.view);
            }
        }
    };

    if (DOM.historyTabs) DOM.historyTabs.addEventListener('click', (e) => switchHistoryView(e.target.closest('button[data-view]')?.dataset.view));
    if (DOM.attendanceHistoryTabs) DOM.attendanceHistoryTabs.addEventListener('click', (e) => { State.context.activeFilterDropdown = null; switchHistoryView(e.target.closest('button[data-view]')?.dataset.view); });
    if (DOM.reportTabs) DOM.reportTabs.addEventListener('click', (e) => { State.context.reportSortState = {}; State.context.activeFilterDropdown = null; switchHistoryView(e.target.closest('button[data-view]')?.dataset.view); });
    if (DOM.personalReportTabs) DOM.personalReportTabs.addEventListener('click', (e) => handleTabSwitch(e, DOM.personalReportTabs));
    if (managementTabs) managementTabs.addEventListener('click', (e) => handleTabSwitch(e, managementTabs));

    if (DOM.personalReportMemberSelect) {
        DOM.personalReportMemberSelect.addEventListener('change', (e) => {
            State.context.personalReportMember = e.target.value;
            refreshPersonalView();
        });
    }

    if (managementSaveBtn) {
        managementSaveBtn.addEventListener('click', async () => {
            const dateKey = managementSaveBtn.dataset.dateKey;
            if (!dateKey) return;
            const revenue = document.getElementById('mgmt-input-revenue')?.value.replace(/,/g, '') || 0;
            const orderCount = document.getElementById('mgmt-input-orderCount')?.value.replace(/,/g, '') || 0;
            const inventoryQty = document.getElementById('mgmt-input-inventoryQty')?.value.replace(/,/g, '') || 0;
            const inventoryAmt = document.getElementById('mgmt-input-inventoryAmt')?.value.replace(/,/g, '') || 0;

            try {
                managementSaveBtn.disabled = true;
                managementSaveBtn.textContent = '저장 중...';
                await saveManagementData(dateKey, {
                    revenue: Number(revenue), orderCount: Number(orderCount),
                    inventoryQty: Number(inventoryQty), inventoryAmt: Number(inventoryAmt)
                });
                showToast('경영 지표가 저장되었습니다.');
                refreshManagementView();
            } catch (e) {
                showToast('저장 중 오류가 발생했습니다.', true);
            } finally {
                managementSaveBtn.disabled = false;
                managementSaveBtn.textContent = '저장';
            }
        });
    }

    if (DOM.historyMainTabs) {
        DOM.historyMainTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-main-tab]');
            if (btn) {
                const tabName = btn.dataset.mainTab;
                State.context.activeMainHistoryTab = tabName;
                State.context.activeFilterDropdown = null; 
                
                document.querySelectorAll('.history-main-tab-btn').forEach(b => {
                    b.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
                    b.classList.add('font-medium', 'text-gray-500');
                });
                btn.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
                btn.classList.remove('font-medium', 'text-gray-500');

                const dateListContainer = document.getElementById('history-date-list-container');
                
                DOM.workHistoryPanel.classList.toggle('hidden', tabName !== 'work');
                DOM.attendanceHistoryPanel.classList.toggle('hidden', tabName !== 'attendance');
                DOM.trendAnalysisPanel.classList.toggle('hidden', tabName !== 'trends');
                DOM.reportPanel.classList.toggle('hidden', tabName !== 'report');
                if (DOM.personalReportPanel) DOM.personalReportPanel.classList.toggle('hidden', tabName !== 'personal');
                if (managementPanel) managementPanel.classList.toggle('hidden', tabName !== 'management');
                if (inspectionPanel) inspectionPanel.classList.toggle('hidden', tabName !== 'inspection');
                if (predictionPanel) predictionPanel.classList.toggle('hidden', tabName !== 'prediction');
                
                // [신규] 연차 패널 토글
                if (leavePanel) leavePanel.classList.toggle('hidden', tabName !== 'leave');
                
                // 날짜 리스트 숨김 처리 (Trend, Inspection, Prediction, Leave 탭)
                if (dateListContainer) {
                    const hideListTabs = ['trends', 'inspection', 'prediction', 'leave'];
                    dateListContainer.style.display = hideListTabs.includes(tabName) ? 'none' : 'block';
                }

                if (tabName === 'work') {
                     const view = DOM.historyTabs?.querySelector('button.font-semibold')?.dataset.view || 'daily';
                     switchHistoryView(view);
                } else if (tabName === 'attendance') {
                     const view = DOM.attendanceHistoryTabs?.querySelector('button.font-semibold')?.dataset.view || 'attendance-daily';
                     switchHistoryView(view);
                } else if (tabName === 'report') {
                     const view = DOM.reportTabs?.querySelector('button.font-semibold')?.dataset.view || 'report-daily';
                     switchHistoryView(view);
                } else if (tabName === 'trends') {
                     renderTrendAnalysisCharts(State.allHistoryData, State.appConfig, trendCharts);
                } else if (tabName === 'prediction') { 
                     const days = predictionDaysSelect ? Number(predictionDaysSelect.value) : 14;
                     renderPredictionTab(State.allHistoryData, days);
                } else if (tabName === 'personal') {
                     if (DOM.personalReportMemberSelect && DOM.personalReportMemberSelect.options.length <= 1) {
                         const staff = (State.appConfig.teamGroups || []).flatMap(g => g.members);
                         const partTimers = (State.appState.partTimers || []).map(p => p.name);
                         const allMembers = [...new Set([...staff, ...partTimers])].sort();
                         DOM.personalReportMemberSelect.innerHTML = '<option value="">직원 선택...</option>';
                         allMembers.forEach(m => {
                             const op = document.createElement('option');
                             op.value = m; op.textContent = m;
                             DOM.personalReportMemberSelect.appendChild(op);
                         });
                         if (State.appState.currentUser && allMembers.includes(State.appState.currentUser)) {
                             DOM.personalReportMemberSelect.value = State.appState.currentUser;
                             State.context.personalReportMember = State.appState.currentUser;
                         }
                     }
                     const viewMode = DOM.personalReportTabs?.querySelector('button.font-semibold')?.dataset.view || 'personal-daily';
                     let listMode = 'day';
                     if(viewMode.includes('weekly')) listMode = 'week';
                     if(viewMode.includes('monthly')) listMode = 'month';
                     if(viewMode.includes('yearly')) listMode = 'year';
                     renderHistoryDateListByMode(listMode);
                } else if (tabName === 'management') {
                     const viewMode = managementTabs?.querySelector('button.font-semibold')?.dataset.view || 'management-daily';
                     let listMode = 'day';
                     if(viewMode.includes('weekly')) listMode = 'week';
                     if(viewMode.includes('monthly')) listMode = 'month';
                     if(viewMode.includes('yearly')) listMode = 'year';
                     renderHistoryDateListByMode(listMode);
                } else if (tabName === 'inspection') {
                    fetchAndRenderInspectionHistory();
                }
                // [신규] 연차 탭 로직
                else if (tabName === 'leave') {
                    UILeave.initLeaveManagement();
                }
            }
        });
    }

    if (predictionDaysSelect) {
        predictionDaysSelect.addEventListener('change', () => {
            if (State.context.activeMainHistoryTab === 'prediction') {
                const days = Number(predictionDaysSelect.value);
                renderPredictionTab(State.allHistoryData, days);
            }
        });
    }

    if (DOM.historyViewContainer) {
        DOM.historyViewContainer.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) return;
            const action = button.dataset.action;
            const dateKey = button.dataset.dateKey;
            if (!dateKey) return;

            if (action === 'open-history-quantity-modal') {
                setHistoryMaximized(false); 
                openHistoryQuantityModal(dateKey);
            } else if (action === 'request-history-deletion') {
                setHistoryMaximized(false); 
                requestHistoryDeletion(dateKey);
            }
        });
    }

    if (DOM.historyModalContentBox) {
        DOM.historyModalContentBox.addEventListener('click', (e) => {
            const downloadBtn = e.target.closest('#inspection-download-btn');
            if (downloadBtn) {
                e.stopPropagation();
                openDownloadFormatModal('inspection');
                return;
            }

            const deleteBtn = e.target.closest('button[data-action="request-history-deletion"]');
            if (deleteBtn) {
                e.stopPropagation();
                const dateKey = deleteBtn.dataset.dateKey;
                if(dateKey) {
                    setHistoryMaximized(false); 
                    requestHistoryDeletion(dateKey);
                }
                return;
            }
        });
    }

    if (DOM.confirmHistoryDeleteBtn) {
        DOM.confirmHistoryDeleteBtn.addEventListener('click', async () => {
            const dateKey = State.context.historyKeyToDelete;
            if (dateKey) {
                const activeTab = State.context.activeMainHistoryTab || 'work';
                const updates = {};
                
                if (activeTab === 'work' || activeTab === 'report') {
                    updates.workRecords = deleteField();
                    updates.taskQuantities = deleteField();
                    updates.partTimers = deleteField();
                    updates.confirmedZeroTasks = deleteField();
                } else if (activeTab === 'attendance') {
                    updates.onLeaveMembers = deleteField();
                } else if (activeTab === 'management') {
                    updates.management = deleteField();
                } else if (activeTab === 'inspection') {
                    updates.inspectionList = deleteField();
                } else {
                    showToast('삭제할 대상 탭이 명확하지 않습니다.', true);
                    return;
                }

                try {
                    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                    await updateDoc(historyDocRef, updates);

                    if (dateKey === getTodayDateString()) {
                        const dailyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', dateKey);
                        await updateDoc(dailyDocRef, updates);
                        
                        if (activeTab === 'work' || activeTab === 'report') {
                            State.appState.workRecords = [];
                            State.appState.taskQuantities = {};
                            State.appState.partTimers = [];
                            State.appState.confirmedZeroTasks = [];
                        } else if (activeTab === 'attendance') {
                            State.appState.dailyOnLeaveMembers = [];
                        } else if (activeTab === 'inspection') {
                            State.appState.inspectionList = [];
                        }
                    }

                    showToast(`${dateKey}의 데이터가 삭제되었습니다.`);
                    await loadAndRenderHistoryList();

                } catch (e) {
                    console.error("Partial deletion error:", e);
                    showToast('삭제 중 오류가 발생했습니다.', true);
                }
            }
            if (DOM.deleteHistoryModal) DOM.deleteHistoryModal.classList.add('hidden');
            State.context.historyKeyToDelete = null;
        });
    }

    const setupFilterListeners = (container, stateKeySort, stateKeyFilter, refreshFunc) => {
        if (!container) return;
        container.addEventListener('click', (e) => {
            if (e.target.closest('.filter-dropdown')) { e.stopPropagation(); return; }
            const filterIconBtn = e.target.closest('.filter-icon-btn');
            if (filterIconBtn) {
                e.stopPropagation();
                const dropdownId = filterIconBtn.dataset.dropdownId;
                State.context.activeFilterDropdown = (State.context.activeFilterDropdown === dropdownId) ? null : dropdownId;
                refreshFunc();
                return;
            }
            const sortTh = e.target.closest('th[data-sort-key]');
            if (sortTh) {
                const mode = sortTh.dataset.sortTarget;
                const key = sortTh.dataset.sortKey;
                if (!mode || !key) return;
                const sortStateObj = State.context[stateKeySort]; 
                if (!sortStateObj[mode]) sortStateObj[mode] = { key: '', dir: 'asc' };
                const currentSort = sortStateObj[mode];
                if (currentSort.key === key) currentSort.dir = (currentSort.dir === 'asc' ? 'desc' : 'asc');
                else { currentSort.key = key; currentSort.dir = 'asc'; }
                refreshFunc();
                return;
            }
        });
        container.addEventListener('input', (e) => {
            const filterInput = e.target.closest('[data-filter-key]');
            if (filterInput) {
                const mode = filterInput.dataset.filterTarget;
                const key = filterInput.dataset.filterKey;
                const filterStateObj = State.context[stateKeyFilter];
                if (!filterStateObj[mode]) filterStateObj[mode] = {};
                filterStateObj[mode][key] = filterInput.value;
                refreshFunc();
                setTimeout(() => {
                    const newInput = container.querySelector(`[data-filter-target="${mode}"][data-filter-key="${key}"]`);
                    if (newInput) {
                        newInput.focus();
                        if (newInput.tagName === 'INPUT') { const val = newInput.value; newInput.value = ''; newInput.value = val; }
                    }
                }, 0);
            }
        });
    };

    setupFilterListeners(DOM.attendanceHistoryViewContainer, 'attendanceSortState', 'attendanceFilterState', refreshAttendanceView);
    setupFilterListeners(DOM.reportViewContainer, 'reportSortState', 'reportFilterState', refreshReportView);
    setupFilterListeners(DOM.personalReportViewContainer, 'personalReportSortState', 'personalReportFilterState', refreshPersonalView);

    document.addEventListener('click', (e) => {
        if (State.context.activeFilterDropdown) {
            if (!e.target.closest('.filter-dropdown') && !e.target.closest('.filter-icon-btn')) {
                State.context.activeFilterDropdown = null;
                if (State.context.activeMainHistoryTab === 'attendance') refreshAttendanceView();
                else if (State.context.activeMainHistoryTab === 'report') refreshReportView();
                else if (State.context.activeMainHistoryTab === 'personal') refreshPersonalView();
            }
        }
    });

    const historyHeader = document.getElementById('history-modal-header');
    if (DOM.historyModal && historyHeader && DOM.historyModalContentBox) {
        let isDragging = false; let offsetX, offsetY;
        historyHeader.addEventListener('mousedown', e => {
            if(isHistoryMaximized || e.target.closest('button')) return;
            isDragging=true; 
            if(DOM.historyModalContentBox.dataset.hasBeenUncentered!=='true') {
                const r=DOM.historyModalContentBox.getBoundingClientRect();
                DOM.historyModal.classList.remove('flex','items-center','justify-center');
                DOM.historyModalContentBox.style.position='absolute'; 
                DOM.historyModalContentBox.style.top=`${r.top}px`; DOM.historyModalContentBox.style.left=`${r.left}px`;
                DOM.historyModalContentBox.style.width=`${r.width}px`; DOM.historyModalContentBox.style.height=`${r.height}px`;
                DOM.historyModalContentBox.style.transform='none'; DOM.historyModalContentBox.dataset.hasBeenUncentered='true';
            }
            const r=DOM.historyModalContentBox.getBoundingClientRect(); offsetX=e.clientX-r.left; offsetY=e.clientY-r.top;
            document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        });
        function onMove(e) { if(!isDragging)return; DOM.historyModalContentBox.style.left=`${e.clientX-offsetX}px`; DOM.historyModalContentBox.style.top=`${e.clientY-offsetY}px`; }
        function onUp() { isDragging=false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    }

    const toggleFullscreenBtn = document.getElementById('toggle-history-fullscreen-btn');
    if (toggleFullscreenBtn) {
        toggleFullscreenBtn.addEventListener('click', (e) => {
            e.stopImmediatePropagation();
            setHistoryMaximized(!isHistoryMaximized);
        });
    }
}

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