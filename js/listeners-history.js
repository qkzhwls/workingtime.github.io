// === js/listeners-history.js ===
import * as DOM from './dom-elements.js?v=202610021122';
import * as State from './state.js?v=202610021122';
import { showToast, getTodayDateString, toDateString } from './utils.js?v=202610021122';

import { setupHistoryDownloadListeners, openDownloadFormatModal } from './listeners-history-download.js?v=202610021122';
import { setupHistoryRecordListeners } from './listeners-history-records.js?v=202610021122';
import { setupHistoryAttendanceListeners } from './listeners-history-attendance.js?v=202610021122';
import { setupHistoryInspectionListeners } from './listeners-history-inspection.js?v=202610021122';

import { loadAndRenderHistoryList, renderHistoryDetail, switchHistoryView, openHistoryQuantityModal, augmentHistoryWithPersistentLeave } from './app-history-logic.js?v=202610021122';
import { renderAttendanceDailyHistory, renderAttendanceWeeklyHistory, renderAttendanceMonthlyHistory, renderAttendanceYearlyHistory, renderReportDaily, renderReportWeekly, renderReportMonthly, renderReportYearly, renderPersonalReport, renderManagementDaily, renderManagementSummary, renderWeeklyHistory, renderMonthlyHistory, renderYearlyHistory, renderPredictionTab } from './ui-history.js?v=202610021122';
import { syncTodayToHistory, saveManagementData, backfillFxRates, peekDailyData, recoverDailyDataToHistory, fetchAllHistoryData } from './history-data-manager.js?v=202610021122';
import { REVENUE_CHANNELS, CHANNEL_METRICS } from './revenue-channels.js?v=202610021122';
import { doc, getDoc, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { setupGlobalFilterListeners, setupHistoryTabsListeners, getFilteredHistoryData, getPeriodFilteredData, renderAnalyticsTab } from './listeners-history-tabs.js?v=202610021122';
import { preloadWeekendPay } from './ui-history-personal.js?v=202610021122';
import { saveView } from './view-state.js?v=202610021122';
import { placeOpenDropdown } from './table-filter.js?v=202610021122';

let isHistoryMaximized = false;

export function setupHistoryModalListeners() {
    setupHistoryDownloadListeners();
    setupHistoryRecordListeners();
    setupHistoryAttendanceListeners();
    setupHistoryInspectionListeners();

    setupGlobalFilterListeners(); 
    setupHistoryTabsListeners();  

    const managementTabs = document.getElementById('management-tabs');
    const managementSaveBtn = document.getElementById('management-save-btn');
    const predictionDaysSelect = document.getElementById('prediction-days-select');

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
            if (icon) icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />`;
        } else {
            DOM.historyModal.classList.add('flex', 'items-center', 'justify-center', 'p-4');
            DOM.historyModalContentBox.classList.remove('fixed', 'inset-0', 'h-full', 'z-[150]', 'rounded-none');
            DOM.historyModalContentBox.classList.add('relative', 'w-[1400px]', 'h-[880px]', 'rounded-2xl', 'shadow-2xl');
            if (toggleBtn) toggleBtn.title = "전체화면";
            if (icon) icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m0 0V4m0 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m0 0v-4m0 0l-5-5" />`;
        }
    };

    const getSelectedDateKey = () => DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100')?.dataset.key || null;

    const refreshAttendanceView = async () => {
        const dateKey = getSelectedDateKey();
        if (dateKey === getTodayDateString()) {
            await syncTodayToHistory();
            augmentHistoryWithPersistentLeave(State.allHistoryData, State.persistentLeaveSchedule);
        }
        const filteredData = getFilteredHistoryData();
        const gran = State.context.globalGranularity || 'day';
        if (!dateKey) return;

        if (gran === 'day') renderAttendanceDailyHistory(dateKey, filteredData);
        else if (gran === 'week') renderAttendanceWeeklyHistory(dateKey, filteredData);
        else if (gran === 'month') renderAttendanceMonthlyHistory(dateKey, filteredData);
        else if (gran === 'year') renderAttendanceYearlyHistory(dateKey, filteredData);
    };

    const refreshReportView = () => {
        const dateKey = getSelectedDateKey();
        const filteredData = getFilteredHistoryData();
        const gran = State.context.globalGranularity || 'day';

        if (gran === 'day') renderReportDaily(dateKey, filteredData, State.appConfig, State.context);
        else if (gran === 'week') renderReportWeekly(dateKey, filteredData, State.appConfig, State.context);
        else if (gran === 'month') renderReportMonthly(dateKey, filteredData, State.appConfig, State.context);
        else if (gran === 'year') renderReportYearly(dateKey, filteredData, State.appConfig, State.context);
    };

    const refreshPersonalView = async () => {
        const dateKey = getSelectedDateKey();
        const gran = State.context.globalGranularity || 'day';
        const viewMode = { day: 'personal-daily', week: 'personal-weekly', month: 'personal-monthly', year: 'personal-yearly' }[gran];
        const memberName = DOM.personalReportMemberSelect?.value;
        if (dateKey && memberName) {
            // 주말근무 급여(회당 11만원) 반영 위해 해당 연도 확정 주말근무 선로드
            await preloadWeekendPay(String(dateKey).slice(0, 4));
            renderPersonalReport('personal-report-content', viewMode, dateKey, memberName, State.allHistoryData);
        }
    };

    const refreshManagementView = () => {
        const dateKey = getSelectedDateKey();
        const gran = State.context.globalGranularity || 'day';
        const viewMode = { day: 'management-daily', week: 'management-weekly', month: 'management-monthly', year: 'management-yearly' }[gran];
        if (!dateKey) return;
        if (viewMode === 'management-daily') renderManagementDaily(dateKey, State.allHistoryData);
        else renderManagementSummary(viewMode, dateKey, State.allHistoryData);
    };

    // 💱 과거 환율 채우기(백필) — 경영지표 표의 버튼에서 호출. 완료 후 화면 갱신.
    window.__runFxBackfill = async (fromDate = '2026-06-01') => {
        await backfillFxRates(fromDate);
        refreshManagementView();
    };

    // 🛟 마감 누락 복구 도구 (콘솔에서 실행).
    // 어제(기본값) 또는 특정 날짜의 daily_data 원본을 history로 옮긴다.
    // 로컬 시간대 기준 어제 (utils.toDateString 이 시차를 보정한다)
    const yesterdayStr = () => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return toDateString(d);
    };
    // 1) 미리보기: __peekDay() 또는 __peekDay('2026-07-27')
    window.__peekDay = async (dateKey = yesterdayStr()) => peekDailyData(dateKey);
    // 2) 복구 실행: __recoverDay() 또는 __recoverDay('2026-07-27')
    window.__recoverDay = async (dateKey = yesterdayStr()) => {
        const res = await recoverDailyDataToHistory(dateKey);
        if (res && res.records >= 0 && !res.canceled) {
            await fetchAllHistoryData(true); // 서버 최신값으로 재조회
            refreshManagementView();
        }
        return res;
    };

    // 💡 핵심 수정 파트: 데이터를 다 불러온 후에 UI를 순차적으로 깨웁니다.
    const openHistoryModalLogic = async (e) => {
        if (!State.auth || !State.auth.currentUser) {
            showToast('이력을 보려면 로그인이 필요합니다.', true);
            if (DOM.historyModal) DOM.historyModal.classList.add('hidden');
            if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
            return;
        }

        if (window.innerWidth >= 768) {
            if (e) e.preventDefault();
            window.open('history.html', '_blank');
            return;
        }

        if (DOM.historyModal) {
            DOM.historyModal.classList.remove('hidden');
            setHistoryMaximized(true); 

            try { 
                await loadAndRenderHistoryList(); 
                
                // 모바일 환경에서 데이터가 빈 화면으로 뜨는 것을 방지하기 위한 강제 렌더링 트리거
                const rawdataMainTabBtn = document.querySelector('[data-main-tab="rawdata"]');
                const dashboardMainTabBtn = document.querySelector('[data-main-tab="dashboard"]');
                const tabButtons = Array.from(document.querySelectorAll('.history-tab-btn, button'));
                const dailyTabBtn = tabButtons.find(btn => btn.textContent && btn.textContent.trim().includes('일별 상세'));
                
                if (rawdataMainTabBtn) rawdataMainTabBtn.click();
                if (dailyTabBtn) dailyTabBtn.click();
                if (typeof switchHistoryView === 'function') switchHistoryView('daily');
                
                setTimeout(() => {
                    const firstDateItem = document.querySelector('#history-date-list li');
                    if (firstDateItem) firstDateItem.click();
                    
                    setTimeout(() => {
                        if (dashboardMainTabBtn) dashboardMainTabBtn.click();
                    }, 100);
                }, 100);

            } 
            catch (loadError) { 
                console.error("이력 데이터 로딩 에러:", loadError);
                showToast("이력 데이터를 불러오는 중 오류가 발생했습니다.", true); 
            }
        }
    };

    if (DOM.openHistoryBtn) {
        DOM.openHistoryBtn.addEventListener('click', openHistoryModalLogic);
    }
    
    if (DOM.openHistoryBtnMobile) {
        DOM.openHistoryBtnMobile.addEventListener('click', (e) => { 
            e.preventDefault();
            e.stopPropagation();
            openHistoryModalLogic(e); 
            if (DOM.navContent) DOM.navContent.classList.add('hidden'); 
        });
    }

    if (DOM.closeHistoryBtn) DOM.closeHistoryBtn.addEventListener('click', () => { if (DOM.historyModal) { DOM.historyModal.classList.add('hidden'); setHistoryMaximized(false); } });

    // 📱 모바일 날짜 드로어 토글 (데스크톱은 md:hidden 이라 무시됨)
    const mobileDateToggle = document.getElementById('history-mobile-date-toggle');
    if (mobileDateToggle) {
        mobileDateToggle.addEventListener('click', () => {
            const sb = document.getElementById('history-global-sidebar');
            const chev = document.getElementById('history-mobile-date-chevron');
            if (!sb) return;
            const open = sb.classList.toggle('mobile-open');
            if (chev) chev.classList.toggle('rotate', open);
        });
    }

    if (DOM.historyDateList) {
        DOM.historyDateList.addEventListener('click', (e) => {
            const btn = e.target.closest('.history-date-btn');
            if (!btn) return;

            DOM.historyDateList.querySelectorAll('button').forEach(b => b.classList.remove('bg-blue-100', 'font-bold'));
            btn.classList.add('bg-blue-100', 'font-bold');
            const dateKey = btn.dataset.key;
            saveView({ dateKey });   // 새로고침해도 이 날짜가 다시 선택되도록

            // 📱 모바일: 선택한 날짜를 토글 바 라벨에 반영. 드로어는 실제 사용자 탭일 때만 닫음
            // (세분화 변경 시 자동 선택되는 프로그래밍적 클릭 e.isTrusted=false 에서는 열린 상태 유지)
            const mLabel = document.getElementById('history-mobile-date-label');
            if (mLabel) mLabel.textContent = (btn.textContent || '').trim() || '날짜 선택';
            if (e.isTrusted) {
                const sb = document.getElementById('history-global-sidebar');
                if (sb && sb.classList.contains('mobile-open')) {
                    sb.classList.remove('mobile-open');
                    const chev = document.getElementById('history-mobile-date-chevron');
                    if (chev) chev.classList.remove('rotate');
                }
            }

            State.context.activeFilterDropdown = null;

            const mainView = State.context.activeHistoryView || 'rawdata';
            const gran = State.context.globalGranularity || 'day';

            // 분석 탭(대시보드/생산성/인력/예측)은 선택 기간 데이터로 렌더링
            if (mainView !== 'rawdata') {
                renderAnalyticsTab(mainView, getPeriodFilteredData(gran, dateKey));
                return;
            }

            // 로우 데이터 탭은 활성 서브탭별로 분기
            const sub = State.context.activeMainHistoryTab || 'work';

            if (sub === 'attendance') { refreshAttendanceView(); return; }
            if (sub === 'management') { refreshManagementView(); return; }
            if (sub === 'report') { refreshReportView(); return; }
            if (sub === 'personal') { refreshPersonalView(); return; }

            // work
            const filteredData = getFilteredHistoryData();
            State.context.reportSortState = {};
            if (gran === 'day') {
                const currentIndex = filteredData.findIndex(d => d.id === dateKey);
                const previousDayData = (currentIndex > -1 && currentIndex + 1 < filteredData.length) ? filteredData[currentIndex + 1] : null;
                renderHistoryDetail(dateKey, previousDayData);
            } else if (gran === 'week') renderWeeklyHistory(dateKey, filteredData, State.appConfig);
            else if (gran === 'month') renderMonthlyHistory(dateKey, filteredData, State.appConfig);
            else if (gran === 'year') renderYearlyHistory(dateKey, filteredData, State.appConfig);
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
            } else switchHistoryView(btn.dataset.view);
        }
    };

    if (DOM.historyTabs) DOM.historyTabs.addEventListener('click', (e) => switchHistoryView(e.target.closest('button[data-view]')?.dataset.view));
    if (DOM.attendanceHistoryTabs) DOM.attendanceHistoryTabs.addEventListener('click', (e) => { State.context.activeFilterDropdown = null; switchHistoryView(e.target.closest('button[data-view]')?.dataset.view); });
    if (DOM.reportTabs) DOM.reportTabs.addEventListener('click', (e) => { State.context.reportSortState = {}; State.context.activeFilterDropdown = null; switchHistoryView(e.target.closest('button[data-view]')?.dataset.view); });
    if (DOM.personalReportTabs) DOM.personalReportTabs.addEventListener('click', (e) => handleTabSwitch(e, DOM.personalReportTabs));
    if (managementTabs) managementTabs.addEventListener('click', (e) => handleTabSwitch(e, managementTabs));

    if (DOM.personalReportMemberSelect) DOM.personalReportMemberSelect.addEventListener('change', (e) => { State.context.personalReportMember = e.target.value; refreshPersonalView(); });

    if (managementSaveBtn) {
        // 💹 경영 지표 저장
        //  ⚠️ 빈 칸은 '0'이 아니라 '건드리지 않음'으로 다룬다.
        //     예전에는 빈 칸을 0으로 저장해서, 다른 항목만 입력해 저장하거나
        //     내 화면이 오래된 캐시일 때(다른 사람이 넣은 매출·환율이 안 보일 때)
        //     이미 저장돼 있던 값이 0으로 덮여 사라졌다.
        //  ⚠️ 저장 직전에 서버의 현재 값을 다시 읽어 메모리·합계 계산의 기준으로 삼는다.
        const readInput = (id, { decimal = false } = {}) => {
            const el = document.getElementById(id);
            if (!el) return null;
            const raw = String(el.value ?? '').trim();
            if (raw === '') return null;                                  // 빈 칸 → 변경 없음
            const cleaned = decimal ? raw.replace(/[^0-9.]/g, '') : raw.replace(/[^0-9]/g, '');
            if (cleaned === '') return null;
            const n = Number(cleaned);
            return Number.isFinite(n) ? n : null;
        };

        managementSaveBtn.addEventListener('click', async () => {
            const dateKey = managementSaveBtn.dataset.dateKey;
            if (!dateKey) return;

            managementSaveBtn.disabled = true; managementSaveBtn.textContent = '저장 중...';
            try {
                // ① 서버의 현재 값 (내 캐시가 오래됐을 수 있으므로 여기서 다시 읽는다)
                let serverMgmt = {};
                let serverReadFailed = false;
                try {
                    const snap = await getDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey));
                    if (snap.exists()) serverMgmt = snap.data().management || {};
                    if (dateKey === getTodayDateString()) {
                        const dsnap = await getDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', dateKey));
                        if (dsnap.exists()) serverMgmt = { ...serverMgmt, ...(dsnap.data().management || {}) };
                    }
                } catch (e) {
                    // 못 읽으면 '안 건드린 채널'을 0으로 보게 되어 총계가 입력분만으로 덮인다.
                    // 채널값은 그대로 남고 총액만 작아져 불일치가 DB에 굳으므로, 총계 갱신을 건너뛴다.
                    serverReadFailed = true;
                    console.warn('[경영지표] 저장 전 서버 값 읽기 실패 — 총계는 갱신하지 않습니다.', e);
                }

                // 서버 값을 메모리에도 반영해 둔다(저장 후 화면이 최신으로 그려지도록)
                const mi = State.allHistoryData.findIndex(d => d.id === dateKey);
                if (mi > -1) {
                    State.allHistoryData[mi].management = { ...serverMgmt, ...(State.allHistoryData[mi].management || {}) };
                }

                // ② 화면에서 실제로 입력된 값만 모은다
                const payload = {};
                CHANNEL_METRICS.forEach(m => {
                    let sum = 0, touched = false;
                    REVENUE_CHANNELS.forEach(c => {
                        const field = m.fieldOf(c);
                        const v = readInput(`mgmt-input-${field}`);
                        if (v != null) { payload[field] = v; sum += v; touched = true; }
                        else sum += Number(serverMgmt[field]) || 0;      // 안 건드린 채널은 저장된 값으로 합산
                    });
                    // 채널을 하나라도 입력했을 때만 총계를 다시 쓴다(구 데이터 보호).
                    // 서버 값을 못 읽었으면 합계가 틀리므로 총계는 건드리지 않는다.
                    if (touched && !serverReadFailed) payload[m.totalField] = sum;
                });

                const inventoryQty = readInput('mgmt-input-inventoryQty');
                const inventoryAmt = readInput('mgmt-input-inventoryAmt');
                const usdRate = readInput('mgmt-input-usdRate', { decimal: true });
                const cnyRate = readInput('mgmt-input-cnyRate', { decimal: true });
                if (inventoryQty != null) payload.inventoryQty = inventoryQty;
                if (inventoryAmt != null) payload.inventoryAmt = inventoryAmt;
                if (usdRate != null) payload.usdRate = usdRate;
                if (cnyRate != null) payload.cnyRate = cnyRate;

                if (Object.keys(payload).length === 0) {
                    showToast('입력된 값이 없습니다. 저장할 내용이 없습니다.', true);
                    return;
                }

                await saveManagementData(dateKey, payload);
                showToast('경영 지표가 저장되었습니다.'); refreshManagementView();
            } catch (e) { showToast('저장 중 오류가 발생했습니다.', true); }
            finally { managementSaveBtn.disabled = false; managementSaveBtn.textContent = '저장'; }
        });
    }

    if (predictionDaysSelect) predictionDaysSelect.addEventListener('change', () => { if (State.context.activeMainHistoryTab === 'prediction') renderPredictionTab(State.allHistoryData, Number(predictionDaysSelect.value)); });

    if (DOM.historyViewContainer) {
        DOM.historyViewContainer.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button || !button.dataset.dateKey) return;
            if (button.dataset.action === 'open-history-quantity-modal') { setHistoryMaximized(false); openHistoryQuantityModal(button.dataset.dateKey); } 
            else if (button.dataset.action === 'request-history-deletion') { setHistoryMaximized(false); requestHistoryDeletion(button.dataset.dateKey); }
        });
    }

    if (DOM.historyModalContentBox) {
        DOM.historyModalContentBox.addEventListener('click', (e) => {
            if (e.target.closest('#inspection-download-btn')) { e.stopPropagation(); openDownloadFormatModal('inspection'); return; }
            const deleteBtn = e.target.closest('button[data-action="request-history-deletion"]');
            if (deleteBtn && deleteBtn.dataset.dateKey) { e.stopPropagation(); setHistoryMaximized(false); requestHistoryDeletion(deleteBtn.dataset.dateKey); }
        });
    }

    if (DOM.confirmHistoryDeleteBtn) {
        DOM.confirmHistoryDeleteBtn.addEventListener('click', async () => {
            const dateKey = State.context.historyKeyToDelete;
            if (dateKey) {
                const activeTab = State.context.activeMainHistoryTab || 'work';
                const updates = {};
                
                if (activeTab === 'work' || activeTab === 'report') { updates.workRecords = deleteField(); updates.taskQuantities = deleteField(); updates.partTimers = deleteField(); updates.confirmedZeroTasks = deleteField(); } 
                else if (activeTab === 'attendance') { updates.onLeaveMembers = deleteField(); } 
                else if (activeTab === 'management') { updates.management = deleteField(); } 
                else if (activeTab === 'inspection') { updates.inspectionList = deleteField(); } 
                else { showToast('삭제할 대상 탭이 명확하지 않습니다.', true); return; }

                try {
                    await updateDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey), updates);
                    if (dateKey === getTodayDateString()) {
                        await updateDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', dateKey), updates);
                        if (activeTab === 'work' || activeTab === 'report') { State.appState.workRecords = []; State.appState.taskQuantities = {}; State.appState.partTimers = []; State.appState.confirmedZeroTasks = []; } 
                        else if (activeTab === 'attendance') { State.appState.dailyOnLeaveMembers = []; } 
                        else if (activeTab === 'inspection') { State.appState.inspectionList = []; }
                    }
                    showToast(`${dateKey}의 데이터가 삭제되었습니다.`);
                    await loadAndRenderHistoryList();
                } catch (e) { showToast('삭제 중 오류가 발생했습니다.', true); }
            }
            if (DOM.deleteHistoryModal) DOM.deleteHistoryModal.classList.add('hidden');
            State.context.historyKeyToDelete = null;
        });
    }

    const setupFilterListeners = (container, stateKeySort, stateKeyFilter, rawRefresh) => {
        if (!container) return;
        // 다시 그린 뒤에는 열려 있는 필터 창의 위치를 화면 기준으로 다시 잡아 준다.
        // (표의 스크롤 상자에 잘려 안 보이던 문제)
        const refreshFunc = () => {
            rawRefresh();
            requestAnimationFrame(() => placeOpenDropdown(container));
        };
        container.addEventListener('click', (e) => {
            if (e.target.closest('.filter-dropdown')) { e.stopPropagation(); return; }
            const filterIconBtn = e.target.closest('.filter-icon-btn');
            if (filterIconBtn) {
                e.stopPropagation();
                const dropdownId = filterIconBtn.dataset.dropdownId;
                State.context.activeFilterDropdown = (State.context.activeFilterDropdown === dropdownId) ? null : dropdownId;
                refreshFunc(); return;
            }
            const sortTh = e.target.closest('th[data-sort-key]');
            if (sortTh && sortTh.dataset.sortTarget && sortTh.dataset.sortKey) {
                const mode = sortTh.dataset.sortTarget, key = sortTh.dataset.sortKey;
                if (!State.context[stateKeySort][mode]) State.context[stateKeySort][mode] = { key: '', dir: 'asc' };
                const currentSort = State.context[stateKeySort][mode];
                if (currentSort.key === key) currentSort.dir = (currentSort.dir === 'asc' ? 'desc' : 'asc');
                else { currentSort.key = key; currentSort.dir = 'asc'; }
                refreshFunc(); return;
            }
        });
        // 다중 선택: 체크박스 조작 / '전체'·'해제' 버튼 / 값 검색
        container.addEventListener('click', (e) => {
            const dd = e.target.closest('.filter-dropdown');
            if (!dd) return;
            const allBtn = e.target.closest('[data-filter-all]');
            const noneBtn = e.target.closest('[data-filter-none]');
            if (!allBtn && !noneBtn) return;
            e.stopPropagation();
            const btn = allBtn || noneBtn;
            const mode = btn.dataset.filterTarget, key = btn.dataset.filterKey;
            if (!State.context[stateKeyFilter][mode]) State.context[stateKeyFilter][mode] = {};
            // 전체 = 필터 없음(null) / 해제 = 빈 배열(아무것도 통과 못 함)
            State.context[stateKeyFilter][mode][key] = allBtn ? null : [];
            refreshFunc();
        });

        // 목록 안 값 검색 — 다시 그리지 않고 항목만 숨긴다(입력 흐름이 끊기지 않도록)
        container.addEventListener('input', (e) => {
            const q = e.target.closest('[data-filter-search]');
            if (!q) return;
            e.stopPropagation();
            const list = q.closest('.filter-dropdown')?.querySelector('[data-filter-list]');
            if (!list) return;
            const kw = q.value.trim().toLowerCase();
            list.querySelectorAll('label').forEach(l => {
                l.style.display = l.textContent.toLowerCase().includes(kw) ? '' : 'none';
            });
        });

        container.addEventListener('change', (e) => {
            const box = e.target.closest('input[data-filter-multi]');
            if (!box) return;
            const dd = box.closest('.filter-dropdown');
            const mode = box.dataset.filterTarget, key = box.dataset.filterKey;
            if (!State.context[stateKeyFilter][mode]) State.context[stateKeyFilter][mode] = {};
            const boxes = [...dd.querySelectorAll('input[data-filter-multi]')];
            const checked = boxes.filter(b => b.checked).map(b => b.value);
            // 전부 체크 = 필터 없음
            State.context[stateKeyFilter][mode][key] = (checked.length === boxes.length) ? null : checked;
            refreshFunc();
        });

        container.addEventListener('input', (e) => {
            const filterInput = e.target.closest('[data-filter-key]:not([data-filter-multi])');
            if (filterInput && !filterInput.hasAttribute('data-filter-search')) {
                const mode = filterInput.dataset.filterTarget, key = filterInput.dataset.filterKey;
                if (!State.context[stateKeyFilter][mode]) State.context[stateKeyFilter][mode] = {};
                State.context[stateKeyFilter][mode][key] = filterInput.value;
                refreshFunc();
                setTimeout(() => {
                    const newInput = container.querySelector(`[data-filter-target="${mode}"][data-filter-key="${key}"]`);
                    if (newInput) { newInput.focus(); if (newInput.tagName === 'INPUT') { const val = newInput.value; newInput.value = ''; newInput.value = val; } }
                }, 0);
            }
        });
    };

    setupFilterListeners(DOM.attendanceHistoryViewContainer, 'attendanceSortState', 'attendanceFilterState', refreshAttendanceView);
    setupFilterListeners(DOM.reportViewContainer, 'reportSortState', 'reportFilterState', refreshReportView);
    setupFilterListeners(DOM.personalReportViewContainer, 'personalReportSortState', 'personalReportFilterState', refreshPersonalView);

    document.addEventListener('click', (e) => {
        if (State.context && State.context.activeFilterDropdown && !e.target.closest('.filter-dropdown') && !e.target.closest('.filter-icon-btn')) {
            State.context.activeFilterDropdown = null;
            if (State.context.activeMainHistoryTab === 'attendance') refreshAttendanceView();
            else if (State.context.activeMainHistoryTab === 'report') refreshReportView();
            else if (State.context.activeMainHistoryTab === 'personal') refreshPersonalView();
        }
    });

    const historyHeader = document.getElementById('history-modal-header');
    if (DOM.historyModal && historyHeader && DOM.historyModalContentBox) {
        let isDragging = false, offsetX, offsetY;
        historyHeader.addEventListener('mousedown', e => {
            if(isHistoryMaximized || e.target.closest('button')) return;
            isDragging = true; 
            if(DOM.historyModalContentBox.dataset.hasBeenUncentered !== 'true') {
                const r = DOM.historyModalContentBox.getBoundingClientRect();
                DOM.historyModal.classList.remove('flex','items-center','justify-center');
                DOM.historyModalContentBox.style.position = 'absolute'; 
                DOM.historyModalContentBox.style.top = `${r.top}px`; DOM.historyModalContentBox.style.left = `${r.left}px`;
                DOM.historyModalContentBox.style.width = `${r.width}px`; DOM.historyModalContentBox.style.height = `${r.height}px`;
                DOM.historyModalContentBox.style.transform = 'none'; DOM.historyModalContentBox.dataset.hasBeenUncentered = 'true';
            }
            const r = DOM.historyModalContentBox.getBoundingClientRect(); offsetX = e.clientX - r.left; offsetY = e.clientY - r.top;
            document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        });
        function onMove(e) { if(!isDragging)return; DOM.historyModalContentBox.style.left = `${e.clientX - offsetX}px`; DOM.historyModalContentBox.style.top = `${e.clientY - offsetY}px`; }
        function onUp() { isDragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    }

    const toggleFullscreenBtn = document.getElementById('toggle-history-fullscreen-btn');
    if (toggleFullscreenBtn) toggleFullscreenBtn.addEventListener('click', (e) => { e.stopImmediatePropagation(); setHistoryMaximized(!isHistoryMaximized); });

    if (window.location.pathname.includes('history.html')) {
        setTimeout(() => { const dashTab = document.querySelector('.history-main-tab-btn[data-main-tab="dashboard"]'); if (dashTab) dashTab.click(); }, 300);
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
    if (msgEl) msgEl.innerHTML = `정말로 이 날짜의 <span class="text-red-600 font-bold">${targetName}</span> 데이터를 삭제하시겠습니까?`;
    if (DOM.deleteHistoryModal) DOM.deleteHistoryModal.classList.remove('hidden');
};