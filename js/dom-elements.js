// === js/dom-elements.js ===
// 설명: 앱 전역에서 사용되는 모든 DOM 요소를 export합니다.

export const loadingSpinner = document.getElementById('loading-spinner');

// [신규] 관리자 To-Do 관련 요소

// [신규] 관리자 To-Do 알림(팝업) 관련 요소
export const adminTodoAlertModal = document.getElementById('admin-todo-alert-modal');
export const adminTodoAlertList = document.getElementById('admin-todo-alert-list');
export const adminTodoAlertConfirmBtn = document.getElementById('admin-todo-alert-confirm-btn');

// [신규] 검수 리스트(엑셀) 업로드 관련
export const inspExcelUploadInput = document.getElementById('insp-excel-upload');
export const inspOpenListWindowBtn = document.getElementById('insp-open-list-window-btn');
export const inspDeleteListBtn = document.getElementById('insp-delete-list-btn');

// [신규] 바코드 스캐너 관련
export const inspScanBtn = document.getElementById('insp-scan-btn');
export const inspScannerContainer = document.getElementById('insp-scanner-container');
export const inspCloseScannerBtn = document.getElementById('insp-close-scanner-btn');

// [신규] 이미지 업로드 관련
export const inspImageInput = document.getElementById('insp-image-upload');
export const inspImagePreviewBox = document.getElementById('insp-image-preview-box');
export const inspImagePreviewImg = document.getElementById('insp-image-preview-img');
export const inspRemoveImageBtn = document.getElementById('insp-remove-image-btn');

// [신규] 정밀 검수 매니저 전체화면 관련
export const inspFullscreenBtn = document.getElementById('insp-fullscreen-btn');

// --- 기존 요소들 ---
export const addAttendanceRecordModal = document.getElementById('add-attendance-record-modal');
export const addAttendanceForm = document.getElementById('add-attendance-form');
export const confirmAddAttendanceBtn = document.getElementById('confirm-add-attendance-btn');
export const cancelAddAttendanceBtn = document.getElementById('cancel-add-attendance-btn');
export const addAttendanceMemberNameInput = document.getElementById('add-attendance-member-name');
export const addAttendanceMemberDatalist = document.getElementById('add-attendance-member-datalist');
export const addAttendanceTypeSelect = document.getElementById('add-attendance-type');
export const addAttendanceStartTimeInput = document.getElementById('add-attendance-start-time');
export const addAttendanceEndTimeInput = document.getElementById('add-attendance-end-time');
export const addAttendanceStartDateInput = document.getElementById('add-attendance-start-date');
export const addAttendanceEndDateInput = document.getElementById('add-attendance-end-date');
export const addAttendanceDateKeyInput = document.getElementById('add-attendance-date-key');
export const addAttendanceTimeFields = document.getElementById('add-attendance-time-fields');
export const addAttendanceDateFields = document.getElementById('add-attendance-date-fields');
export const editAttendanceRecordModal = document.getElementById('edit-attendance-record-modal');
export const confirmEditAttendanceBtn = document.getElementById('confirm-edit-attendance-btn');
export const cancelEditAttendanceBtn = document.getElementById('cancel-edit-attendance-btn');
export const editAttendanceMemberName = document.getElementById('edit-attendance-member-name');
export const editAttendanceTypeSelect = document.getElementById('edit-attendance-type');
export const editAttendanceStartTimeInput = document.getElementById('edit-attendance-start-time');
export const editAttendanceEndTimeInput = document.getElementById('edit-attendance-end-time');
export const editAttendanceStartDateInput = document.getElementById('edit-attendance-start-date');
export const editAttendanceEndDateInput = document.getElementById('edit-attendance-end-date');
export const editAttendanceDateKeyInput = document.getElementById('edit-attendance-date-key');
export const editAttendanceRecordIndexInput = document.getElementById('edit-attendance-record-index');
export const editAttendanceTimeFields = document.getElementById('edit-attendance-time-fields');
export const editAttendanceDateFields = document.getElementById('edit-attendance-date-fields');
export const connectionStatusEl = document.getElementById('connection-status');
export const statusDotEl = document.getElementById('status-dot');
export const teamStatusBoard = document.getElementById('team-status-board');
export const workLogBody = document.getElementById('work-log-body');
export const teamSelectModal = document.getElementById('team-select-modal');
export const deleteConfirmModal = document.getElementById('delete-confirm-modal');
export const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
export const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
export const historyModal = document.getElementById('history-modal');
export const historyModalContentBox = document.getElementById('history-modal-content-box');
export const openHistoryBtn = document.getElementById('open-history-btn');
export const closeHistoryBtn = document.getElementById('close-history-btn');
export const historyDateList = document.getElementById('history-date-list');
export const historyViewContainer = document.getElementById('history-view-container');
export const historyTabs = document.getElementById('history-tabs');
export const workHistoryPanel = document.getElementById('work-history-panel');
export const attendanceHistoryPanel = document.getElementById('attendance-history-panel');
export const attendanceHistoryTabs = document.getElementById('attendance-history-tabs');
export const attendanceHistoryViewContainer = document.getElementById('attendance-history-view-container');
export const trendAnalysisPanel = document.getElementById('trend-analysis-panel');

export const reportPanel = document.getElementById('report-panel');
export const reportTabs = document.getElementById('report-tabs');
export const reportViewContainer = document.getElementById('report-view-container');

// 개인 리포트 관련 요소
export const personalReportTabs = document.getElementById('personal-report-tabs');
export const personalReportMemberSelect = document.getElementById('personal-report-member-select');
export const personalReportViewContainer = document.getElementById('personal-report-view-container');

export const quantityModal = document.getElementById('quantity-modal');
export const confirmQuantityBtn = document.getElementById('confirm-quantity-btn');
export const cancelQuantityBtn = document.getElementById('cancel-quantity-btn');
export const deleteHistoryModal = document.getElementById('delete-history-modal');
export const confirmHistoryDeleteBtn = document.getElementById('confirm-history-delete-btn');
export const editRecordModal = document.getElementById('edit-record-modal');
export const confirmEditBtn = document.getElementById('confirm-edit-btn');
export const cancelEditBtn = document.getElementById('cancel-edit-btn');
export const saveProgressBtn = document.getElementById('save-progress-btn');
export const quantityOnStopModal = document.getElementById('quantity-on-stop-modal');
export const confirmQuantityOnStopBtn = document.getElementById('confirm-quantity-on-stop');
export const cancelQuantityOnStopBtn = document.getElementById('cancel-quantity-on-stop');
export const endShiftBtn = document.getElementById('end-shift-btn');
export const resetAppBtn = document.getElementById('reset-app-btn');
export const resetAppModal = document.getElementById('reset-app-modal');
export const confirmResetAppBtn = document.getElementById('confirm-reset-app-btn');
export const cancelResetAppBtn = document.getElementById('cancel-reset-app-btn');
export const taskSelectModal = document.getElementById('task-select-modal');
export const stopIndividualConfirmModal = document.getElementById('stop-individual-confirm-modal');
export const confirmStopIndividualBtn = document.getElementById('confirm-stop-individual-btn');
export const cancelStopIndividualBtn = document.getElementById('cancel-stop-individual-btn');
export const stopIndividualConfirmMessage = document.getElementById('stop-individual-confirm-message');

export const stopGroupConfirmModal = document.getElementById('stop-group-confirm-modal');
export const confirmStopGroupBtn = document.getElementById('confirm-stop-group-btn');
export const cancelStopGroupBtn = document.getElementById('cancel-stop-group-btn');

export const confirmEditPartTimerBtn = document.getElementById('confirm-edit-part-timer-btn');
export const cancelEditPartTimerBtn = document.getElementById('cancel-edit-part-timer-btn');
export const cancelTeamSelectBtn = document.getElementById('cancel-team-select-btn');
export const leaveTypeModal = document.getElementById('leave-type-modal');
export const leaveMemberNameSpan = document.getElementById('leave-member-name');
export const confirmLeaveBtn = document.getElementById('confirm-leave-btn');
export const cancelLeaveConfirmModal = document.getElementById('cancel-leave-confirm-modal');
export const confirmCancelLeaveBtn = document.getElementById('confirm-cancel-leave-btn');
export const cancelCancelLeaveBtn = document.getElementById('cancel-cancel-leave-btn');
export const cancelLeaveConfirmMessage = document.getElementById('cancel-leave-confirm-message');
export const toggleCompletedLog = document.getElementById('toggle-completed-log');
export const toggleAnalysis = document.getElementById('toggle-analysis');
export const toggleSummary = document.getElementById('toggle-summary');
export const openManualAddBtn = document.getElementById('open-manual-add-btn');
export const manualAddRecordModal = document.getElementById('manual-add-record-modal');
export const confirmManualAddBtn = document.getElementById('confirm-manual-add-btn');
export const cancelManualAddBtn = document.getElementById('cancel-manual-add-btn');
export const manualAddForm = document.getElementById('manual-add-form');
export const endShiftConfirmModal = document.getElementById('end-shift-confirm-modal');
export const endShiftConfirmTitle = document.getElementById('end-shift-confirm-title');
export const endShiftConfirmMessage = document.getElementById('end-shift-confirm-message');
export const endShiftTimeInput = document.getElementById('end-shift-time');
export const endShiftPreview = document.getElementById('end-shift-preview');
export const confirmEndShiftBtn = document.getElementById('confirm-end-shift-btn');
export const cancelEndShiftBtn = document.getElementById('cancel-end-shift-btn');
export const loginModal = document.getElementById('login-modal');
export const loginForm = document.getElementById('login-form');
export const loginEmailInput = document.getElementById('login-email');
export const loginPasswordInput = document.getElementById('login-password');
export const loginSubmitBtn = document.getElementById('login-submit-btn');
export const loginErrorMsg = document.getElementById('login-error-message');
export const loginButtonText = document.getElementById('login-button-text');
export const loginButtonSpinner = document.getElementById('login-button-spinner');
export const userGreeting = document.getElementById('user-greeting');
export const logoutBtn = document.getElementById('logout-btn');
export const menuToggleBtn = document.getElementById('menu-toggle-btn');
export const menuDropdown = document.getElementById('menu-dropdown');

export const openMyLeaveBtn = document.getElementById('open-my-leave-btn');
export const openMyLeaveBtnMobile = document.getElementById('open-my-leave-btn-mobile');

export const openQuantityModalTodayBtn = document.getElementById('open-quantity-modal-today');
export const openQuantityModalTodayBtnMobile = document.getElementById('open-quantity-modal-today-mobile');
export const adminLinkBtnMobile = document.getElementById('admin-link-btn-mobile');
export const resetAppBtnMobile = document.getElementById('reset-app-btn-mobile');
export const logoutBtnMobile = document.getElementById('logout-btn-mobile');
export const hamburgerBtn = document.getElementById('hamburger-btn');
export const navContent = document.getElementById('nav-content');
export const editStartTimeModal = document.getElementById('edit-start-time-modal');
export const editStartTimeModalTitle = document.getElementById('edit-start-time-modal-title');
export const editStartTimeModalMessage = document.getElementById('edit-start-time-modal-message');
export const editStartTimeInput = document.getElementById('edit-start-time-input');
export const editStartTimeContextIdInput = document.getElementById('edit-start-time-context-id');
export const editStartTimeContextTypeInput = document.getElementById('edit-start-time-context-type');
export const confirmEditStartTimeBtn = document.getElementById('confirm-edit-start-time-btn');
export const cancelEditStartTimeBtn = document.getElementById('cancel-edit-start-time-btn');
export const analysisMemberSelect = document.getElementById('analysis-member-select');
export const editLeaveModal = document.getElementById('edit-leave-record-modal');
export const historyDownloadPeriodExcelBtn = document.getElementById('history-download-period-excel-btn');
export const pcClockOutCancelBtn = document.getElementById('pc-clock-out-cancel-btn');
export const mobileClockOutCancelBtn = document.getElementById('mobile-clock-out-cancel-btn');
export const memberActionModal = document.getElementById('member-action-modal');
export const actionMemberName = document.getElementById('action-member-name');
export const actionMemberStatusBadge = document.getElementById('action-member-status-badge');
export const actionMemberTimeInfo = document.getElementById('action-member-time-info');
export const adminClockInBtn = document.getElementById('admin-clock-in-btn');
export const adminClockOutBtn = document.getElementById('admin-clock-out-btn');
export const adminCancelClockOutBtn = document.getElementById('admin-cancel-clock-out-btn');
export const openLeaveModalBtn = document.getElementById('open-leave-modal-btn');
export const adminCancelLeaveBtn = document.getElementById('admin-cancel-leave-btn');
export const adminCancelLeaveText = document.getElementById('admin-cancel-leave-text');


export const openHistoryBtnMobile = document.getElementById('open-history-btn-mobile');
export const endShiftBtnMobile = document.getElementById('end-shift-btn-mobile');

// 이력 기록 관리 모달 관련 요소
export const historyRecordsModal = document.getElementById('history-records-modal');
export const historyRecordsTableBody = document.getElementById('history-records-table-body');
export const historyRecordsDateSpan = document.getElementById('history-records-date');

// 기록 추가 모달 관련 요소
export const historyRecordAddBtn = document.getElementById('history-record-add-btn');
export const historyAddRecordModal = document.getElementById('history-add-record-modal');
export const historyAddRecordForm = document.getElementById('history-add-record-form');
export const historyAddDateDisplay = document.getElementById('history-add-date-display');
export const historyAddMemberInput = document.getElementById('history-add-member');
export const historyAddMemberDatalist = document.getElementById('history-add-member-list');
export const historyAddTaskInput = document.getElementById('history-add-task');
export const historyAddTaskDatalist = document.getElementById('history-add-task-list');
export const historyAddStartTimeInput = document.getElementById('history-add-start-time');
export const historyAddEndTimeInput = document.getElementById('history-add-end-time');
export const confirmHistoryAddBtn = document.getElementById('confirm-history-add-btn');

// 엑셀 다운로드 버튼

// 업무 종료 알림 모달

// 검수 매니저 모달 관련 요소 (입력용)
export const inspectionManagerModal = document.getElementById('inspection-manager-modal');
export const inspProductNameInput = document.getElementById('insp-product-name');
export const inspSearchBtn = document.getElementById('insp-search-btn');
export const inspSupplierDisplay = document.getElementById('insp-supplier-display');

// 과거 이력 리포트 영역 (입력 모달 내)
export const inspHistoryReport = document.getElementById('insp-history-report');
export const inspReportTitle = document.getElementById('insp-report-title');
export const inspReportCount = document.getElementById('insp-report-count');
export const inspReportDate = document.getElementById('insp-report-date');
export const inspAlertBox = document.getElementById('insp-alert-box');
export const inspAlertMsg = document.getElementById('insp-alert-msg');

// 금일 입력 영역 (입력 모달 내)
export const inspCurrentInputArea = document.getElementById('insp-current-input-area');
export const inspInboundDateInput = document.getElementById('insp-inbound-date');
export const inspSaveNextBtn = document.getElementById('insp-save-next-btn');
export const inspOptionDisplay = document.getElementById('insp-option-display');
export const inspCodeDisplay = document.getElementById('insp-code-display');

// 13가지 체크리스트 항목 (입력 모달 내)
export const inspThicknessRef = document.getElementById('insp-thickness-ref');

// 하단 금일 리스트 영역 (입력 모달 내)
export const inspClearListBtn = document.getElementById('insp-clear-list-btn');

// 검수 이력 패널 관련 요소 (데이터 관리 팝업 내)
export const inspectionHistorySearchInput = document.getElementById('inspection-history-search');
export const inspectionHistoryRefreshBtn = document.getElementById('inspection-history-refresh-btn');
export const inspectionTotalProductCount = document.getElementById('inspection-total-product-count');
export const inspectionHistoryViewContainer = document.getElementById('inspection-history-view-container');

// 검수 이력 관리 모달 (상세보기)

// 검수 기록 수정 모달 (편집)

// 13가지 체크리스트 항목 (수정 모달용)

export const deleteInspLogBtn = document.getElementById('delete-insp-log-btn');
export const saveInspLogBtn = document.getElementById('save-insp-log-btn');

// [신규] 전량 검수 매니저 관련 요소
export const totalInspModal = document.getElementById('total-inspection-manager-modal');
export const totalInspProductName = document.getElementById('total-insp-product-name');
export const totalInspSearchBtn = document.getElementById('total-insp-search-btn');
export const totalInspContentArea = document.getElementById('total-insp-content-area');
export const totalInspReason = document.getElementById('total-insp-reason');
export const totalInspTotalStock = document.getElementById('total-insp-total-stock');
export const totalInspAccumulated = document.getElementById('total-insp-accumulated');
export const totalInspTodayNormal = document.getElementById('total-insp-today-normal');
export const totalInspTodayDefective = document.getElementById('total-insp-today-defective');
export const totalInspRemaining = document.getElementById('total-insp-remaining');
export const totalInspSaveBtn = document.getElementById('total-insp-save-btn');

// ✅ [신규] 샘플 -> 전량 전환용 버튼 및 전량 검수 상세 필드 추가
export const inspSwitchToTotalBtn = document.getElementById('insp-switch-to-total-btn');
export const totalInspCode = document.getElementById('total-insp-code');
export const totalInspOption = document.getElementById('total-insp-option');
export const totalInspSupplier = document.getElementById('total-insp-supplier');
export const totalInspLocation = document.getElementById('total-insp-location');
export const totalInspInboundDate = document.getElementById('total-insp-inbound-date');
export const totalInspBackBtn = document.getElementById('total-insp-back-btn');


// ─────────────────────────────────────────────────────────────
// 🩺 마크업이 없어 null 로 잡힌 상수를 알려 준다 (로컬에서만).
//
// 이 파일은 모듈이 로드되는 순간 getElementById 를 한 번에 실행해 상수로 굳힌다.
// 그래서 컴포넌트를 아직 안 실었거나(로드 순서), 그 화면에 없는 요소는 영원히 null 이고,
// 대부분의 코드가 `if (el)` 로 걸러 내므로 예외도 안 난다 — '눌러도 아무 일이 없다'가 된다.
// 실제로 데이터 관리 창은 폼 컴포넌트를 안 싣고 있어 모달 17개가 통째로 빠져 있었다.
//
// 운영에서는 조용히 지나가고(사용자에게 콘솔 경고를 보일 이유가 없다),
// localhost 에서만 한 번 요약해 준다.
// ─────────────────────────────────────────────────────────────
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    setTimeout(() => {
        try {
            const mod = {
                loadingSpinner,
                adminTodoAlertModal,
                adminTodoAlertList,
                adminTodoAlertConfirmBtn,
                inspExcelUploadInput,
                inspOpenListWindowBtn,
                inspDeleteListBtn,
                inspScanBtn,
                inspScannerContainer,
                inspCloseScannerBtn,
                inspImageInput,
                inspImagePreviewBox,
                inspImagePreviewImg,
                inspRemoveImageBtn,
                inspFullscreenBtn,
                addAttendanceRecordModal,
                addAttendanceForm,
                confirmAddAttendanceBtn,
                cancelAddAttendanceBtn,
                addAttendanceMemberNameInput,
                addAttendanceMemberDatalist,
                addAttendanceTypeSelect,
                addAttendanceStartTimeInput,
                addAttendanceEndTimeInput,
                addAttendanceStartDateInput,
                addAttendanceEndDateInput,
                addAttendanceDateKeyInput,
                addAttendanceTimeFields,
                addAttendanceDateFields,
                editAttendanceRecordModal,
                confirmEditAttendanceBtn,
                cancelEditAttendanceBtn,
                editAttendanceMemberName,
                editAttendanceTypeSelect,
                editAttendanceStartTimeInput,
                editAttendanceEndTimeInput,
                editAttendanceStartDateInput,
                editAttendanceEndDateInput,
                editAttendanceDateKeyInput,
                editAttendanceRecordIndexInput,
                editAttendanceTimeFields,
                editAttendanceDateFields,
                connectionStatusEl,
                statusDotEl,
                teamStatusBoard,
                workLogBody,
                teamSelectModal,
                deleteConfirmModal,
                confirmDeleteBtn,
                cancelDeleteBtn,
                historyModal,
                historyModalContentBox,
                openHistoryBtn,
                closeHistoryBtn,
                historyDateList,
                historyViewContainer,
                historyTabs,
                workHistoryPanel,
                attendanceHistoryPanel,
                attendanceHistoryTabs,
                attendanceHistoryViewContainer,
                trendAnalysisPanel,
                reportPanel,
                reportTabs,
                reportViewContainer,
                personalReportTabs,
                personalReportMemberSelect,
                personalReportViewContainer,
                quantityModal,
                confirmQuantityBtn,
                cancelQuantityBtn,
                deleteHistoryModal,
                confirmHistoryDeleteBtn,
                editRecordModal,
                confirmEditBtn,
                cancelEditBtn,
                saveProgressBtn,
                quantityOnStopModal,
                confirmQuantityOnStopBtn,
                cancelQuantityOnStopBtn,
                endShiftBtn,
                resetAppBtn,
                resetAppModal,
                confirmResetAppBtn,
                cancelResetAppBtn,
                taskSelectModal,
                stopIndividualConfirmModal,
                confirmStopIndividualBtn,
                cancelStopIndividualBtn,
                stopIndividualConfirmMessage,
                stopGroupConfirmModal,
                confirmStopGroupBtn,
                cancelStopGroupBtn,
                confirmEditPartTimerBtn,
                cancelEditPartTimerBtn,
                cancelTeamSelectBtn,
                leaveTypeModal,
                leaveMemberNameSpan,
                confirmLeaveBtn,
                cancelLeaveConfirmModal,
                confirmCancelLeaveBtn,
                cancelCancelLeaveBtn,
                cancelLeaveConfirmMessage,
                toggleCompletedLog,
                toggleAnalysis,
                toggleSummary,
                openManualAddBtn,
                manualAddRecordModal,
                confirmManualAddBtn,
                cancelManualAddBtn,
                manualAddForm,
                endShiftConfirmModal,
                endShiftConfirmTitle,
                endShiftConfirmMessage,
                endShiftTimeInput,
                endShiftPreview,
                confirmEndShiftBtn,
                cancelEndShiftBtn,
                loginModal,
                loginForm,
                loginEmailInput,
                loginPasswordInput,
                loginSubmitBtn,
                loginErrorMsg,
                loginButtonText,
                loginButtonSpinner,
                userGreeting,
                logoutBtn,
                menuToggleBtn,
                menuDropdown,
                openMyLeaveBtn,
                openMyLeaveBtnMobile,
                openQuantityModalTodayBtn,
                openQuantityModalTodayBtnMobile,
                adminLinkBtnMobile,
                resetAppBtnMobile,
                logoutBtnMobile,
                hamburgerBtn,
                navContent,
                editStartTimeModal,
                editStartTimeModalTitle,
                editStartTimeModalMessage,
                editStartTimeInput,
                editStartTimeContextIdInput,
                editStartTimeContextTypeInput,
                confirmEditStartTimeBtn,
                cancelEditStartTimeBtn,
                analysisMemberSelect,
                editLeaveModal,
                historyDownloadPeriodExcelBtn,
                pcClockOutCancelBtn,
                mobileClockOutCancelBtn,
                memberActionModal,
                actionMemberName,
                actionMemberStatusBadge,
                actionMemberTimeInfo,
                adminClockInBtn,
                adminClockOutBtn,
                adminCancelClockOutBtn,
                openLeaveModalBtn,
                adminCancelLeaveBtn,
                adminCancelLeaveText,
                openHistoryBtnMobile,
                endShiftBtnMobile,
                historyRecordsModal,
                historyRecordsTableBody,
                historyRecordsDateSpan,
                historyRecordAddBtn,
                historyAddRecordModal,
                historyAddRecordForm,
                historyAddDateDisplay,
                historyAddMemberInput,
                historyAddMemberDatalist,
                historyAddTaskInput,
                historyAddTaskDatalist,
                historyAddStartTimeInput,
                historyAddEndTimeInput,
                confirmHistoryAddBtn,
                inspectionManagerModal,
                inspProductNameInput,
                inspSearchBtn,
                inspSupplierDisplay,
                inspHistoryReport,
                inspReportTitle,
                inspReportCount,
                inspReportDate,
                inspAlertBox,
                inspAlertMsg,
                inspCurrentInputArea,
                inspInboundDateInput,
                inspSaveNextBtn,
                inspOptionDisplay,
                inspCodeDisplay,
                inspThicknessRef,
                inspClearListBtn,
                inspectionHistorySearchInput,
                inspectionHistoryRefreshBtn,
                inspectionTotalProductCount,
                inspectionHistoryViewContainer,
                deleteInspLogBtn,
                saveInspLogBtn,
                totalInspModal,
                totalInspProductName,
                totalInspSearchBtn,
                totalInspContentArea,
                totalInspReason,
                totalInspTotalStock,
                totalInspAccumulated,
                totalInspTodayNormal,
                totalInspTodayDefective,
                totalInspRemaining,
                totalInspSaveBtn,
                inspSwitchToTotalBtn,
                totalInspCode,
                totalInspOption,
                totalInspSupplier,
                totalInspLocation,
                totalInspInboundDate,
                totalInspBackBtn
            };
            const missing = Object.keys(mod).filter(k => !mod[k]);
            if (missing.length > 0) {
                console.warn(
                    `[dom-elements] 이 화면에 없는 요소 ${missing.length}개 — 관련 기능은 조용히 동작하지 않습니다.`
                    + '\n  ' + missing.join(', ')
                );
            }
        } catch (e) { /* 진단용이라 실패해도 무시 */ }
    }, 3000);
}
