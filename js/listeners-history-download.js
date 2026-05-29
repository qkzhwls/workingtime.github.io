// === js/listeners-history-download.js ===
// 설명: 이력 보기 내의 엑셀/PDF 다운로드 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';

import {
    downloadHistoryAsExcel,
    downloadPeriodHistoryAsExcel,
    downloadWeeklyHistoryAsExcel, 
    downloadMonthlyHistoryAsExcel, 
    downloadAttendanceExcel,
    downloadReportExcel,
    downloadPersonalReportExcel,
    downloadContentAsPdf,
    downloadInspectionHistory
} from './history-excel.js';

// 날짜 선택 헬퍼
const getSelectedDateKey = () => {
    const btn = DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100');
    return btn ? btn.dataset.key : null;
};

// openDownloadFormatModal 함수를 export하여 위임 로직에서 사용할 수 있도록 합니다.
export const openDownloadFormatModal = (targetType, contextData = {}) => {
    State.context.downloadContext = { targetType, ...contextData };
    const modal = document.getElementById('download-format-modal');
    if (modal) modal.classList.remove('hidden');
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

        if (format === 'pdf') {
            let targetId = 'history-daily-view';
            let title = `업무이력_일별_${key}`;
            if (view === 'weekly') { targetId = 'history-weekly-view'; title = `업무이력_주별_${key}`; }
            else if (view === 'monthly') { targetId = 'history-monthly-view'; title = `업무이력_월별_${key}`; }
            downloadContentAsPdf(targetId, title);
        } else {
            if (view === 'daily') await downloadHistoryAsExcel(key, format);
            else if (view === 'weekly') await downloadWeeklyHistoryAsExcel(key, format);
            else if (view === 'monthly') await downloadMonthlyHistoryAsExcel(key, format);
        }
    }
    else if (targetType === 'attendance') {
        const activeTabBtn = DOM.attendanceHistoryTabs.querySelector('button.font-semibold');
        const viewFull = activeTabBtn ? activeTabBtn.dataset.view : 'attendance-daily';
        const viewMode = viewFull.replace('attendance-', ''); 
        const key = getSelectedDateKey();

        if (!key) return showToast('날짜를 선택해주세요.', true);

        if (format === 'pdf') {
            let targetId = 'history-attendance-daily-view';
            let title = `근태이력_일별_${key}`;
            if (viewMode === 'weekly') { targetId = 'history-attendance-weekly-view'; title = `근태이력_주별_${key}`; }
            else if (viewMode === 'monthly') { targetId = 'history-attendance-monthly-view'; title = `근태이력_월별_${key}`; }
            downloadContentAsPdf(targetId, title);
        } else {
            downloadAttendanceExcel(viewMode, key, format);
        }
    }
    else if (targetType === 'report') {
        const reportData = State.context.lastReportData;
        if (!reportData) return showToast('리포트 데이터가 없습니다.', true);

        if (format === 'pdf') {
            let targetId = '';
            const tabs = document.querySelectorAll('#report-view-container > div');
            tabs.forEach(div => { if (!div.classList.contains('hidden')) targetId = div.id; });
            if (targetId) downloadContentAsPdf(targetId, reportData.title || '업무_리포트');
            else showToast('출력할 리포트 화면을 찾을 수 없습니다.', true);
        } else {
            downloadReportExcel(reportData, format);
        }
    }
    else if (targetType === 'personal') {
        const reportData = State.context.lastReportData;
        if (!reportData || reportData.type !== 'personal') return showToast('개인 리포트 데이터가 없습니다.', true);

        if (format === 'pdf') {
            downloadContentAsPdf('personal-report-content', reportData.title || '개인_리포트');
        } else {
            downloadPersonalReportExcel(reportData, format);
        }
    }
    else if (targetType === 'inspection') {
         // ✅ [수정] 뷰 모드에 따라 다운로드 방식 분기 (상품별 vs 리스트별)
         const viewMode = State.context.inspectionViewMode || 'product';
         
         if (format === 'pdf') {
             // PDF는 현재 화면 캡처
             downloadContentAsPdf('inspection-content-area', `검수이력_${viewMode}_${getTodayDateString()}`);
         } else {
             // 엑셀/CSV는 모드에 따라 데이터 구조가 다름
             await downloadInspectionHistory(format, viewMode);
         }
    }

    const modal = document.getElementById('download-format-modal');
    if (modal) modal.classList.add('hidden');
};

export function setupHistoryDownloadListeners() {

    // --- 다운로드 모달 및 실행 로직 ---

    const formatModal = document.getElementById('download-format-modal');
    if (formatModal) {
        formatModal.addEventListener('click', (e) => {
            const btn = e.target.closest('.download-option-btn');
            if (btn) {
                const format = btn.dataset.format; 
                executeDownload(format);
            }
        });
    }

    // --- 각 탭별 다운로드 버튼 연결 ---

    // 1. 업무 이력 탭 다운로드
    const historyDownloadBtn = document.getElementById('history-download-btn');
    if (historyDownloadBtn) {
        historyDownloadBtn.addEventListener('click', () => {
             const selectedListBtn = DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100');
             if (!selectedListBtn) return showToast('목록에서 날짜를 선택해주세요.', true);
             openDownloadFormatModal('work');
        });
    }

    // 2. 기간 엑셀 다운로드 (상단)
    if (DOM.historyDownloadPeriodExcelBtn) {
        DOM.historyDownloadPeriodExcelBtn.addEventListener('click', () => {
            const startDate = State.context.historyStartDate;
            const endDate = State.context.historyEndDate;

            if (!startDate || !endDate) {
                showToast('엑셀 다운로드를 위해 시작일과 종료일을 모두 설정(조회)해주세요.', true);
                return;
            }
            downloadPeriodHistoryAsExcel(startDate, endDate);
        });
    }

    // 3. 근태 이력 탭 다운로드
    const attendanceDownloadBtn = document.getElementById('attendance-download-btn');
    if (attendanceDownloadBtn) {
        attendanceDownloadBtn.addEventListener('click', () => {
             const selectedListBtn = DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100');
             if (!selectedListBtn) return showToast('목록에서 날짜를 선택해주세요.', true);
             openDownloadFormatModal('attendance');
        });
    }

    // 4. 업무 리포트 탭 다운로드 (이벤트 위임 사용)
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

    // 5. 개인 리포트 탭 다운로드 (이벤트 위임 사용)
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
    
    // ✅ [신규] 검수 이력 다운로드 버튼 클릭 리스너 (동적 생성 요소 위임)
    // 원래 inspection-download-btn ID를 가진 버튼이 정적 HTML에 있었으나,
    // ui-history-inspection.js에서 동적으로 생성된 HTML로 위치가 변경됨에 따라 위임 처리가 필요함.
    const historyModalContentBox = document.getElementById('history-modal-content-box');
    if (historyModalContentBox) {
        historyModalContentBox.addEventListener('click', (e) => {
            // 변경된 ID: inspection-tab-download-btn
            const downloadBtn = e.target.closest('#inspection-tab-download-btn');
            if (downloadBtn) {
                e.stopPropagation();
                openDownloadFormatModal('inspection');
            }
        });
    }
}