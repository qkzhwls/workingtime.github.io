// === js/dom-elements.js ===
// 설명: 앱 전역에서 사용되는 모든 DOM 요소를 export합니다.

export const loadingSpinner = document.getElementById('loading-spinner');

// [신규] 관리자 To-Do 관련 요소
export const adminTodoModal = document.getElementById('admin-todo-modal');
export const adminTodoInput = document.getElementById('admin-todo-input');
export const adminTodoDateTimeInput = document.getElementById('admin-todo-datetime');
export const adminTodoAddBtn = document.getElementById('admin-todo-add-btn');
export const adminTodoList = document.getElementById('admin-todo-list');
export const openAdminTodoBtn = document.getElementById('open-admin-todo-btn');
export const openAdminTodoBtnMobile = document.getElementById('open-admin-todo-btn-mobile');

// [신규] 관리자 To-Do 알림(팝업) 관련 요소
export const adminTodoAlertModal = document.getElementById('admin-todo-alert-modal');
export const adminTodoAlertList = document.getElementById('admin-todo-alert-list');
export const adminTodoAlertConfirmBtn = document.getElementById('admin-todo-alert-confirm-btn');

// [신규] 검수 리스트(엑셀) 업로드 관련
export const inspExcelUploadInput = document.getElementById('insp-excel-upload');
export const inspExcelUploadBtn = document.getElementById('insp-excel-upload-btn');
export const inspOpenListWindowBtn = document.getElementById('insp-open-list-window-btn');
export const inspDeleteListBtn = document.getElementById('insp-delete-list-btn');
export const inspTodoListArea = document.getElementById('insp-todo-list-area');
export const inspTodoListBody = document.getElementById('insp-todo-list-body');

// [신규] 바코드 스캐너 관련
export const inspScanBtn = document.getElementById('insp-scan-btn');
export const inspScannerContainer = document.getElementById('insp-scanner-container');
export const inspScannerReader = document.getElementById('reader');
export const inspCloseScannerBtn = document.getElementById('insp-close-scanner-btn');

// [신규] 이미지 업로드 관련
export const inspImageInput = document.getElementById('insp-image-upload');
export const inspImagePreviewBox = document.getElementById('insp-image-preview-box');
export const inspImagePreviewImg = document.getElementById('insp-image-preview-img');
export const inspRemoveImageBtn = document.getElementById('insp-remove-image-btn');

// [신규] 정밀 검수 매니저 전체화면 관련
export const inspFullscreenBtn = document.getElementById('insp-fullscreen-btn');
export const inspModalContent = document.getElementById('insp-modal-content');

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
export const historyMainTabs = document.getElementById('history-main-tabs');
export const workHistoryPanel = document.getElementById('work-history-panel');
export const attendanceHistoryPanel = document.getElementById('attendance-history-panel');
export const attendanceHistoryTabs = document.getElementById('attendance-history-tabs');
export const attendanceHistoryViewContainer = document.getElementById('attendance-history-view-container');
export const trendAnalysisPanel = document.getElementById('trend-analysis-panel');

export const reportPanel = document.getElementById('report-panel');
export const reportTabs = document.getElementById('report-tabs');
export const reportViewContainer = document.getElementById('report-view-container');
export const reportDailyView = document.getElementById('report-daily-view');
export const reportWeeklyView = document.getElementById('report-weekly-view');
export const reportMonthlyView = document.getElementById('report-monthly-view');
export const reportYearlyView = document.getElementById('report-yearly-view');

// 개인 리포트 관련 요소
export const personalReportPanel = document.getElementById('personal-report-panel');
export const personalReportTabs = document.getElementById('personal-report-tabs');
export const personalReportMemberSelect = document.getElementById('personal-report-member-select');
export const personalReportViewContainer = document.getElementById('personal-report-view-container');
export const personalReportContent = document.getElementById('personal-report-content');

export const historyAttendanceDailyView = document.getElementById('history-attendance-daily-view');
export const historyAttendanceWeeklyView = document.getElementById('history-attendance-weekly-view');
export const historyAttendanceMonthlyView = document.getElementById('history-attendance-monthly-view');
export const quantityModal = document.getElementById('quantity-modal');
export const confirmQuantityBtn = document.getElementById('confirm-quantity-btn');
export const cancelQuantityBtn = document.getElementById('cancel-quantity-btn');
export const deleteHistoryModal = document.getElementById('delete-history-modal');
export const confirmHistoryDeleteBtn = document.getElementById('confirm-history-delete-btn');
export const cancelHistoryDeleteBtn = document.getElementById('cancel-history-delete-btn');
export const deleteAllCompletedBtn = document.getElementById('delete-all-completed-btn');
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

export const editPartTimerModal = document.getElementById('edit-part-timer-modal');
export const confirmEditPartTimerBtn = document.getElementById('confirm-edit-part-timer-btn');
export const cancelEditPartTimerBtn = document.getElementById('cancel-edit-part-timer-btn');
export const partTimerNewNameInput = document.getElementById('part-timer-new-name');
export const partTimerEditIdInput = document.getElementById('part-timer-edit-id');
export const cancelTeamSelectBtn = document.getElementById('cancel-team-select-btn');
export const leaveTypeModal = document.getElementById('leave-type-modal');
export const leaveModalTitle = document.getElementById('leave-modal-title');
export const leaveMemberNameSpan = document.getElementById('leave-member-name');
export const leaveTypeOptionsContainer = document.getElementById('leave-type-options');
export const confirmLeaveBtn = document.getElementById('confirm-leave-btn');
export const cancelLeaveBtn = document.getElementById('cancel-leave-btn');
export const leaveDateInputsDiv = document.getElementById('leave-date-inputs');
export const leaveStartDateInput = document.getElementById('leave-start-date-input');
export const leaveEndDateInput = document.getElementById('leave-end-date-input');
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
export const historyStartDateInput = document.getElementById('history-start-date');
export const historyEndDateInput = document.getElementById('history-end-date');
export const historyFilterBtn = document.getElementById('history-filter-btn');
export const historyClearFilterBtn = document.getElementById('history-clear-filter-btn');
export const historyDownloadPeriodExcelBtn = document.getElementById('history-download-period-excel-btn');
export const coqExplanationModal = document.getElementById('coq-explanation-modal');
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

// ✅ [추가] 근태 취소 버튼 요소
export const adminCancelLeaveBtn = document.getElementById('admin-cancel-leave-btn');
export const adminCancelLeaveText = document.getElementById('admin-cancel-leave-text');

export const costSimulationModal = document.getElementById('cost-simulation-modal');
export const openCostSimulationBtn = document.getElementById('open-cost-simulation-btn');
export const simTaskSelect = document.getElementById('sim-task-select');
export const simTargetQuantityInput = document.getElementById('sim-target-quantity');
export const simWorkerCountInput = document.getElementById('sim-worker-count');
export const simCalculateBtn = document.getElementById('sim-calculate-btn');
export const simResultContainer = document.getElementById('sim-result-container');
export const simResultDuration = document.getElementById('sim-result-duration');
export const simResultCost = document.getElementById('sim-result-cost');
export const simResultSpeed = document.getElementById('sim-result-speed');
export const simModeRadios = document.getElementsByName('sim-mode');
export const simInputWorkerGroup = document.getElementById('sim-input-worker-group');
export const simInputDurationGroup = document.getElementById('sim-input-duration-group');
export const simTargetDurationInput = document.getElementById('sim-target-duration');
export const simEfficiencyChartCanvas = document.getElementById('sim-efficiency-chart');
export const simAddComparisonBtn = document.getElementById('sim-add-to-compare-btn');
export const simComparisonContainer = document.getElementById('sim-comparison-container');
export const simComparisonTbody = document.getElementById('sim-comparison-tbody');
export const simClearComparisonBtn = document.getElementById('sim-clear-comparison-btn');
export const simResultLabel1 = document.getElementById('sim-result-label-1');
export const simResultValue1 = document.getElementById('sim-result-value-1');
export const simBottleneckContainer = document.getElementById('sim-bottleneck-container');
export const simBottleneckTbody = document.getElementById('sim-bottleneck-tbody');
export const simChartContainer = document.getElementById('sim-chart-container');
export const simInputArea = document.getElementById('sim-input-area');

export const openCostSimulationBtnMobile = document.getElementById('open-cost-simulation-btn-mobile');
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
export const historyDownloadExcelBtn = document.getElementById('history-download-excel-btn');
export const attendanceDownloadExcelBtn = document.getElementById('attendance-download-excel-btn');

// 업무 종료 알림 모달
export const shiftEndAlertModal = document.getElementById('shift-end-alert-modal');
export const confirmShiftEndAlertBtn = document.getElementById('confirm-shift-end-alert-btn');
export const cancelShiftEndAlertBtn = document.getElementById('cancel-shift-end-alert-btn');

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
export const inspInboundQtyInput = document.getElementById('insp-inbound-qty');
export const inspNotesInput = document.getElementById('insp-notes');
export const inspSaveNextBtn = document.getElementById('insp-save-next-btn');
export const inspOptionDisplay = document.getElementById('insp-option-display');
export const inspCodeDisplay = document.getElementById('insp-code-display');

// 13가지 체크리스트 항목 (입력 모달 내)
export const inspCheckThickness = document.getElementById('insp-check-thickness');
export const inspThicknessRef = document.getElementById('insp-thickness-ref');
export const inspCheckFabric = document.getElementById('insp-check-fabric');
export const inspCheckColor = document.getElementById('insp-check-color');
export const inspCheckDistortion = document.getElementById('insp-check-distortion');
export const inspCheckUnraveling = document.getElementById('insp-check-unraveling');
export const inspCheckFinishing = document.getElementById('insp-check-finishing');
export const inspCheckZipper = document.getElementById('insp-check-zipper');
export const inspCheckButton = document.getElementById('insp-check-button');
export const inspCheckLining = document.getElementById('insp-check-lining');
export const inspCheckPilling = document.getElementById('insp-check-pilling');
export const inspCheckDye = document.getElementById('insp-check-dye');

// 하단 금일 리스트 영역 (입력 모달 내)
export const inspTodayCount = document.getElementById('insp-today-count');
export const inspClearListBtn = document.getElementById('insp-clear-list-btn');
export const inspTodayListBody = document.getElementById('insp-today-list-body');

// 검수 이력 패널 관련 요소 (데이터 관리 팝업 내)
export const inspectionHistoryPanel = document.getElementById('inspection-history-panel');
export const inspectionHistorySearchInput = document.getElementById('inspection-history-search');
export const inspectionHistoryRefreshBtn = document.getElementById('inspection-history-refresh-btn');
export const inspectionTotalProductCount = document.getElementById('inspection-total-product-count');
export const inspectionHistoryViewContainer = document.getElementById('inspection-history-view-container');

// 검수 이력 관리 모달 (상세보기)
export const inspectionLogManagerModal = document.getElementById('inspection-log-manager-modal');
export const inspectionLogProductName = document.getElementById('inspection-log-product-name');
export const inspectionLogTableBody = document.getElementById('inspection-log-table-body');

// 검수 기록 수정 모달 (편집)
export const inspectionLogEditorModal = document.getElementById('inspection-log-editor-modal');
export const editInspProductName = document.getElementById('edit-insp-product-name');
export const editInspDateTime = document.getElementById('edit-insp-date-time');
export const editInspPackingNo = document.getElementById('edit-insp-packing-no');
export const editInspInboundQty = document.getElementById('edit-insp-inbound-qty');
export const editInspNotes = document.getElementById('edit-insp-notes');
export const editInspLogIndex = document.getElementById('edit-insp-log-index');
export const editInspOriginalDefects = document.getElementById('edit-insp-original-defects'); // 원래 불량 상태 보관용
export const editInspSupplierName = document.getElementById('edit-insp-supplier-name');

// 13가지 체크리스트 항목 (수정 모달용)
export const editInspCheckThickness = document.getElementById('edit-insp-check-thickness');
export const editInspCheckFabric = document.getElementById('edit-insp-check-fabric');
export const editInspCheckColor = document.getElementById('edit-insp-check-color');
export const editInspCheckDistortion = document.getElementById('edit-insp-check-distortion');
export const editInspCheckUnraveling = document.getElementById('edit-insp-check-unraveling');
export const editInspCheckFinishing = document.getElementById('edit-insp-check-finishing');
export const editInspCheckZipper = document.getElementById('edit-insp-check-zipper');
export const editInspCheckButton = document.getElementById('edit-insp-check-button');
export const editInspCheckLining = document.getElementById('edit-insp-check-lining');
export const editInspCheckPilling = document.getElementById('edit-insp-check-pilling');
export const editInspCheckDye = document.getElementById('edit-insp-check-dye');

export const deleteInspLogBtn = document.getElementById('delete-insp-log-btn');
export const saveInspLogBtn = document.getElementById('save-insp-log-btn');