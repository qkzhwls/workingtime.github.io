// === js/state.js ===
// 설명: 앱의 모든 전역 상태, 컨텍스트, 설정 변수를 정의하고 export합니다.

// --- Firebase/App State (Re-assigned variables) ---
export let db = null;
export let auth = null;
export let unsubscribeToday = null;
export let unsubscribeLeaveSchedule = null;
export let unsubscribeConfig = null;
export let elapsedTimeTimer = null;
export let periodicRefreshTimer = null;
export let unsubscribeWorkRecords = null;
export let isDataDirty = false;
export let autoSaveTimer = null;
export let appConfig = {
    teamGroups: [],
    systemAccounts: [],
    memberWages: {},
    memberEmails: {},
    memberRoles: {},
    taskGroups: {},
    quantityTaskTypes: [],
    defaultPartTimerWage: 10000,
    keyTasks: []
};
export let persistentLeaveSchedule = {
    onLeaveMembers: []
};

// --- Setters ---
export const setDb = (val) => { db = val; };
export const setAuth = (val) => { auth = val; };
export const setUnsubscribeToday = (val) => { unsubscribeToday = val; };
export const setUnsubscribeLeaveSchedule = (val) => { unsubscribeLeaveSchedule = val; };
export const setUnsubscribeConfig = (val) => { appConfig = val; };
export const setElapsedTimeTimer = (val) => { elapsedTimeTimer = val; };
export const setPeriodicRefreshTimer = (val) => { periodicRefreshTimer = val; };
export const setUnsubscribeWorkRecords = (val) => { unsubscribeWorkRecords = val; };
export const setIsDataDirty = (val) => { isDataDirty = val; };
export const setAutoSaveTimer = (val) => { autoSaveTimer = val; };
export const setAppConfig = (val) => { appConfig = val; };
export const setPersistentLeaveSchedule = (val) => { persistentLeaveSchedule = val; };

// --- Constants ---
export const AUTO_SAVE_INTERVAL = 1 * 60 * 1000;
// '기타'는 목록에 없는 근태를 직접 적어 쓰는 항목. 선택하면 항목명을 수기로 입력받고,
// 그 값은 entry.customLabel 에 저장한다(type 은 '기타' 그대로 유지).
// ⚠️ type 에 사용자 입력을 그대로 넣지 말 것 — 기간형 판정·집계·필터가 전부 깨진다.
export const OTHER_LEAVE_TYPE = '기타';
export const LEAVE_TYPES = ['연차', '외출', '조퇴', '결근', '출장', '지각', '매장근무', '재택근무', '기타', '외근'];

// 더 이상 새로 고를 수는 없지만 과거 기록에 남아 있을 수 있는 종류.
// (2026-07-30 '휴직' → '기타' 로 교체. 예전 기록이 기간형으로 계속 인식되도록 남겨둔다)
export const LEGACY_LEAVE_TYPES = ['휴직'];

// 근태는 두 갈래로 나뉜다.
//  · 당일형(TIME_BASED): 시각(startTime)만 있고 그날 daily_data에 직접 저장됨
//  · 기간형(PERSISTENT): 시작~종료일(startDate/endDate)을 갖고 persistent_data/leaveSchedule에 저장됨
// 기간형 목록은 (LEAVE_TYPES + 과거 종류)에서 당일형을 뺀 나머지로 자동 계산한다.
// ⚠️ 개별 화면에서 ['연차','출장','결근'] 같은 목록을 직접 적지 말 것.
//    그렇게 하면 나중에 추가·변경된 종류가 조용히 누락된다.
export const TIME_BASED_LEAVE_TYPES = ['외출', '조퇴', '지각'];
export const PERSISTENT_LEAVE_TYPES = [...LEAVE_TYPES, ...LEGACY_LEAVE_TYPES]
    .filter(t => !TIME_BASED_LEAVE_TYPES.includes(t));
export const isPersistentLeaveType = (type) => PERSISTENT_LEAVE_TYPES.includes(type);

/** 화면에 표시할 근태 이름. '기타'는 직접 입력한 항목명을 괄호로 함께 보여준다. */
export const leaveTypeLabel = (entry) => {
    if (!entry) return '';
    const type = entry.type || '';
    const custom = (entry.customLabel || '').trim();
    return (type === OTHER_LEAVE_TYPE && custom) ? `${type}(${custom})` : type;
};

// --- State Objects ---
export const context = {
    recordCounter: 0,
    recordIdOrGroupIdToEdit: null,
    editType: null,
    selectedTaskForStart: null,
    selectedGroupForAdd: null,
    recordToDeleteId: null,
    recordToStopId: null,
    groupToStopId: null,
    
    // 업무명 기준 종료를 위한 컨텍스트
    taskToStop: null,

    historyKeyToDelete: null,
    recordToEditId: null,
    deleteMode: 'single',
    quantityModalContext: { mode: 'today', dateKey: null, onConfirm: null, onCancel: null },
    tempSelectedMembers: [],
    memberToSetLeave: null,
    memberToCancelLeave: null,
    activeMainHistoryTab: 'work',
    // 데이터 관리 창의 활성 메인 탭 (dashboard|productivity|staffing|prediction|rawdata)
    activeHistoryView: 'rawdata',
    // 좌측 트리/전체 탭 공용 기간 단위 (day|week|month|year)
    globalGranularity: 'day',
    attendanceRecordToDelete: null,
    isMobileTaskViewExpanded: false,
    isMobileMemberViewExpanded: false,
    historyStartDate: null,
    historyEndDate: null,
    
    // 현재 열려있는 필터 드롭다운 ID
    activeFilterDropdown: null,

    monthlyRevenues: {},
    memberToAction: null,
    autoPauseForLunch: null,
    autoResumeFromLunch: null,
    
    // 검수 이력 뷰 상태
    inspectionViewMode: 'product', // 'product' | 'list'
    selectedInspectionDate: null,  // 입고 리스트별 보기에서 선택된 날짜

    // 1. 근태 이력 상태
    attendanceSortState: {
        daily: { key: 'member', dir: 'asc' },
        weekly: { key: 'member', dir: 'asc' },
        monthly: { key: 'member', dir: 'asc' },
        yearly: { key: 'member', dir: 'asc' }
    },
    attendanceFilterState: {
        daily: { member: '', type: '' },
        weekly: { member: '' },
        monthly: { member: '' },
        yearly: { member: '' }
    },
    
    // 2. 업무 리포트 상태
    reportSortState: {
        partSummary: { key: 'partName', dir: 'asc' },
        memberSummary: { key: 'memberName', dir: 'asc' },
        taskSummary: { key: 'taskName', dir: 'asc' }
    },
    reportFilterState: {
        partSummary: { partName: '' },
        memberSummary: { memberName: '', part: '' },
        taskSummary: { taskName: '' }
    },

    // 3. 개인 리포트 상태
    personalReportMember: null, 
    personalReportSortState: {
        taskStats: { key: 'duration', dir: 'desc' },
        dailyLogs: { key: 'date', dir: 'asc' },
        attendanceLogs: { key: 'date', dir: 'asc' }
    },
    personalReportFilterState: {
        taskStats: { task: '' },
        dailyLogs: { attendance: '', mainTask: '' },
        attendanceLogs: { type: '' }
    }
};

export const appState = {
    workRecords: [], 
    taskQuantities: {},
    dailyOnLeaveMembers: [],
    dateBasedOnLeaveMembers: [],
    partTimers: [],
    hiddenGroupIds: [],
    currentUser: null,
    currentUserRole: 'user',
    confirmedZeroTasks: [],
    dailyAttendance: {},
    simulationResults: null,
    lunchPauseExecuted: false,
    lunchResumeExecuted: false,
    
    // 검수 대기 리스트 (서버 동기화용)
    inspectionList: [],

    // 관리자 To-Do 리스트 상태 추가
    adminTodos: [] 
};

export const allHistoryData = [];

// 📅 예정 물량(미래 날짜별 계획 처리량). plannedData/{YYYY-MM-DD}.plannedQuantities에서 로드.
//  실적(history)과 분리 저장 — 과거 리포트/평균 오염 방지. 예측(업무예상)에서 자동값보다 우선 사용.
export let plannedData = [];
export const setPlannedData = (val) => { plannedData = Array.isArray(val) ? val : []; };