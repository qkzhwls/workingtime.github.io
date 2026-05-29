// === js/listeners-history-download.js ===
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';

import {
    downloadHistoryAsExcel,
    downloadPeriodHistoryAsExcel,
    downloadWeeklyHistoryAsExcel, 
    downloadMonthlyHistoryAsExcel, 
    downloadAttendanceExcel,
    downloadPeriodAttendanceAsExcel, // ✅ 신규 추가: 기간별 근태
    downloadPeriodInspectionAsExcel, // ✅ 신규 추가: 기간별 검수
    downloadPeriodWeekendAsExcel,    // ✅ 신규 추가: 기간별 주말
    downloadReportExcel,
    downloadPersonalReportExcel,
    downloadInspectionHistory
} from './history-excel.js';

const getSelectedDateKey = () => {
    const btn = DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100');
    return btn ? btn.dataset.key : null;
};

// 중복 다운로드 방지를 위한 락(Lock) 변수
let isDownloading = false;

// UX 개선: 여러 형식을 선택할 필요 없이, 엑셀 형식('xlsx')으로 즉시 다운로드를 실행합니다.
export const openDownloadFormatModal = (targetType, contextData = {}) => {
    if (isDownloading) return; 
    isDownloading = true;

    State.context.downloadContext = { targetType, ...contextData };
    showToast('엑셀 파일 변환 및 다운로드를 준비 중입니다...', false);
    
    setTimeout(async () => {
        try {
            await executeDownload('xlsx');
        } catch (error) {
            console.error("다운로드 에러:", error);
            showToast('다운로드 중 오류가 발생했습니다.', true);
        } finally {
            setTimeout(() => { isDownloading = false; }, 1000);
        }
    }, 100);
};

const executeDownload = async (format) => {
    const ctx = State.context.downloadContext;
    if (!ctx) return;
    
    const { targetType } = ctx;

    if (targetType === 'work') {
        const activeTabBtn = DOM.historyTabs.querySelector('button.font-semibold');
        const view = activeTabBtn ? activeTabBtn.dataset.view : 'daily';
        const key = getSelectedDateKey();

        if (!key) return showToast('날짜를 선택해주세요.', true);

        if (view === 'daily') await downloadHistoryAsExcel(key, format);
        else if (view === 'weekly') await downloadWeeklyHistoryAsExcel(key, format);
        else if (view === 'monthly') await downloadMonthlyHistoryAsExcel(key, format);
    }
    else if (targetType === 'attendance') {
        const activeTabBtn = DOM.attendanceHistoryTabs.querySelector('button.font-semibold');
        const viewFull = activeTabBtn ? activeTabBtn.dataset.view : 'attendance-daily';
        const viewMode = viewFull.replace('attendance-', ''); 
        const key = getSelectedDateKey();

        if (!key) return showToast('날짜를 선택해주세요.', true);
        downloadAttendanceExcel(viewMode, key, format);
    }
    else if (targetType === 'report') {
        const reportData = State.context.lastReportData;
        if (!reportData) return showToast('리포트 데이터가 없습니다.', true);
        downloadReportExcel(reportData, format);
    }
    else if (targetType === 'personal') {
        const reportData = State.context.lastReportData;
        if (!reportData || reportData.type !== 'personal') return showToast('개인 리포트 데이터가 없습니다.', true);
        downloadPersonalReportExcel(reportData, format);
    }
    else if (targetType === 'inspection') {
         const viewMode = State.context.inspectionViewMode || 'product';
         await downloadInspectionHistory(format, viewMode);
    }

    // 모달 닫기
    const modal = document.getElementById('download-format-modal');
    if (modal) modal.classList.add('hidden');
};

let isDownloadListenersSetup = false;

export function setupHistoryDownloadListeners() {
    if (isDownloadListenersSetup) return;
    isDownloadListenersSetup = true;

    // 1. 업무 이력 탭 다운로드 (좌측 개별)
    const historyDownloadBtn = document.getElementById('history-download-btn');
    if (historyDownloadBtn) {
        historyDownloadBtn.addEventListener('click', () => {
             const selectedListBtn = DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100');
             if (!selectedListBtn) return showToast('목록에서 날짜를 선택해주세요.', true);
             openDownloadFormatModal('work');
        });
    }

    // 🔥 [수정/확장] 2. 기간 엑셀 다운로드 통합 라우터 (상단)
    if (DOM.historyDownloadPeriodExcelBtn) {
        DOM.historyDownloadPeriodExcelBtn.addEventListener('click', () => {
            const startDate = State.context.historyStartDate;
            const endDate = State.context.historyEndDate;

            if (!startDate || !endDate) {
                showToast('엑셀 다운로드를 위해 시작일과 종료일을 모두 설정(조회)해주세요.', true);
                return;
            }

            // 활성화된 패널 확인 헬퍼 함수
            const isVisible = (id) => {
                const el = document.getElementById(id);
                return el && !el.classList.contains('hidden');
            };

            // 현재 화면(탭)에 따라 다운로드 함수 분기
            if (isVisible('history-work-panel')) {
                downloadPeriodHistoryAsExcel(startDate, endDate);
            } 
            else if (isVisible('history-attendance-panel')) {
                downloadPeriodAttendanceAsExcel(startDate, endDate);
            } 
            else if (isVisible('history-inspection-panel')) {
                downloadPeriodInspectionAsExcel(startDate, endDate);
            } 
            else if (isVisible('history-weekend-panel') || isVisible('weekend-history-panel') || isVisible('weekend-panel')) {
                downloadPeriodWeekendAsExcel(startDate, endDate);
            } 
            else if (isVisible('history-comprehensive-panel') || isVisible('history-report-panel')) {
                const reportData = State.context.lastReportData;
                if (reportData && reportData.type !== 'personal') {
                    downloadReportExcel(reportData, 'xlsx');
                } else {
                    showToast('조회(생성)된 종합 리포트 데이터가 없습니다.', true);
                }
            } 
            else if (isVisible('history-personal-panel')) {
                const reportData = State.context.lastReportData;
                if (reportData && reportData.type === 'personal') {
                    downloadPersonalReportExcel(reportData, 'xlsx');
                } else {
                    showToast('조회(생성)된 개인 리포트 데이터가 없습니다.', true);
                }
            } 
            else {
                // 예외 상황 시 기본값으로 업무이력 다운로드 수행
                downloadPeriodHistoryAsExcel(startDate, endDate);
            }
        });
    }

    // 3. 근태 이력 탭 다운로드 (좌측 개별)
    const attendanceDownloadBtn = document.getElementById('attendance-download-btn');
    if (attendanceDownloadBtn) {
        attendanceDownloadBtn.addEventListener('click', () => {
             const selectedListBtn = DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100');
             if (!selectedListBtn) return showToast('목록에서 날짜를 선택해주세요.', true);
             openDownloadFormatModal('attendance');
        });
    }

    // 4. 업무 리포트 탭 다운로드 (버튼 자체 처리)
    if (DOM.reportViewContainer) {
        DOM.reportViewContainer.addEventListener('click', (e) => {
            if (e.target.closest('#report-download-btn')) {
                if (State.context.lastReportData && State.context.lastReportData.type !== 'personal') {
                    openDownloadFormatModal('report');
                } else {
                    showToast('다운로드할 리포트 데이터가 없습니다.', true);
                }
            }
        });
    }

    // 5. 개인 리포트 탭 다운로드 (버튼 자체 처리)
    if (DOM.personalReportViewContainer) {
        DOM.personalReportViewContainer.addEventListener('click', (e) => {
             if (e.target.closest('#personal-download-btn')) {
                if (State.context.lastReportData && State.context.lastReportData.type === 'personal') {
                    openDownloadFormatModal('personal');
                } else {
                    showToast('다운로드할 개인 리포트 데이터가 없습니다.', true);
                }
            }
        });
    }
    
    // 6. 검수 이력 탭 다운로드 (좌측 개별)
    const historyModalContentBox = document.getElementById('history-modal-content-box');
    if (historyModalContentBox) {
        historyModalContentBox.addEventListener('click', (e) => {
            const downloadBtn = e.target.closest('#inspection-tab-download-btn');
            if (downloadBtn) {
                e.stopPropagation();
                openDownloadFormatModal('inspection');
            }
        });
    }
}