// === js/app.js (리팩토링 완료) ===

// --- 1. Firebase 및 라이브러리 임포트 ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, getDoc, runTransaction, query, where, writeBatch, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- 2. 모듈 임포트 ---
import { initializeFirebase, loadAppConfig, loadLeaveSchedule, saveLeaveSchedule } from './config.js';
import { showToast, getTodayDateString, displayCurrentDate, getCurrentTime, formatDuration, formatTimeTo24H, getWeekOfYear, isWeekday, calcElapsedMinutes, debounce } from './utils.js';
import {
    renderDashboardLayout,
    renderRealtimeStatus,
    renderCompletedWorkLog,
    updateSummary,
    renderTaskAnalysis,
    renderTaskSelectionModal,
    renderManualAddModalDatalists
} from './ui.js';
import { initializeAppListeners } from './app-listeners.js';

import {
    saveProgress,
    saveDayDataToHistory
} from './history-data-manager.js';

import * as DOM from './dom-elements.js';
import * as State from './state.js';

import {
    autoPauseForLunch,
    autoResumeFromLunch
} from './app-logic.js';

import {
    generateId,
    updateDailyData,
    saveStateToFirestore,
    debouncedSaveState
} from './app-data.js';

// 검수 리스트 렌더링 함수 임포트
import { renderTodoList } from './inspection-logic.js';

// Admin Todo 로직 임포트 (알림 체크용)
import { checkAdminTodoNotifications } from './admin-todo-logic.js';

// [신규] 주말 근무 리스너 임포트
import { setupWeekendListeners } from './listeners-weekend.js';


// --- 3. 헬퍼 함수 ---
export const normalizeName = (s = '') => s.normalize('NFC').trim().toLowerCase();


// 과거 연차 데이터 (이미지 기반)
const historicalLeaveData = [
    { member: "박영철", dates: ["2025-01-22", "2025-02-10", "2025-02-17", "2025-02-19", "2025-02-20", "2025-02-21", "2025-03-21", "2025-05-02", "2025-05-07", "2025-05-08", "2025-05-09", "2025-05-12", "2025-05-13", "2025-06-17", "2025-09-01", "2025-09-30", "2025-11-24"] },
    { member: "유아라", dates: ["2025-01-14", "2025-03-20", "2025-03-21", "2025-04-21", "2025-06-23", "2025-07-14", "2025-08-04", "2025-08-22", "2025-08-25", "2025-09-24", "2025-09-25", "2025-09-26", "2025-09-29", "2025-09-30", "2025-10-01", "2025-10-02", "2025-10-29", "2025-11-11", "2025-11-17"] },
    { member: "박호진", dates: ["2025-01-16", "2025-02-05", "2025-03-08", "2025-03-10", "2025-04-04", "2025-04-14", "2025-04-25", "2025-06-25", "2025-07-11", "2025-09-08", "2025-09-19", "2025-09-23", "2025-10-14", "2025-11-05", "2025-11-14"] },
    { member: "송다진", dates: ["2025-01-10", "2025-02-03", "2025-02-14", "2025-02-21", "2025-03-10", "2025-04-04", "2025-04-07", "2025-05-02", "2025-06-09", "2025-07-14", "2025-07-28", "2025-09-01", "2025-10-20", "2025-11-10", "2025-11-07"] },
    { member: "정미혜", dates: ["2025-01-06", "2025-01-07", "2025-01-08", "2025-01-10", "2025-03-14", "2025-04-09", "2025-05-21", "2025-05-22", "2025-05-23", "2025-06-13", "2025-07-21", "2025-08-04", "2025-10-17", "2025-10-24", "2025-09-22"] },
    { member: "김수은", dates: ["2025-02-03", "2025-02-13", "2025-03-12", "2025-03-18", "2025-04-30", "2025-05-02", "2025-05-15", "2025-05-27", "2025-06-18", "2025-07-21", "2025-07-31", "2025-08-18", "2025-09-01", "2025-10-14", "2025-10-23", "2025-10-24", "2025-11-06"] },
    { member: "이미숙", dates: ["2025-01-24", "2025-03-20", "2025-03-21", "2025-04-24", "2025-05-29", "2025-07-04", "2025-07-18", "2025-08-04", "2025-08-08", "2025-09-11", "2025-09-22", "2025-10-01", "2025-10-02", "2025-10-13", "2025-11-17"] },
    { member: "이승운", dates: ["2025-01-22", "2025-03-21", "2025-03-26", "2025-05-02", "2025-05-07", "2025-05-08", "2025-05-09", "2025-05-12", "2025-05-13", "2025-06-17", "2025-09-01", "2025-09-30", "2025-10-01", "2025-10-28"] },
    { member: "진희주", dates: ["2025-02-17", "2025-03-28", "2025-04-18", "2025-04-21", "2025-04-28", "2025-05-08", "2025-06-23", "2025-06-24", "2025-06-20", "2025-07-25", "2025-10-02"] },
    { member: "김성곤", dates: ["2025-06-23", "2025-07-07", "2025-07-28", "2025-08-25", "2025-09-22", "2025-10-21", "2025-10-22", "2025-11-17"] },
    { member: "김현", dates: ["2025-11-10", "2025-11-11", "2025-11-12"] },
    { member: "박상희", dates: ["2025-11-11"] },
    { member: "김동훈", dates: ["2025-01-22", "2025-01-23", "2025-02-05", "2025-02-13", "2025-03-04", "2025-03-13", "2025-03-27", "2025-04-11", "2025-04-21", "2025-05-19", "2025-06-04", "2025-06-11", "2025-06-18", "2025-07-14", "2025-08-18", "2025-08-27", "2025-11-14"] },
    { member: "신민재", dates: ["2025-03-31", "2025-04-15", "2025-05-12", "2025-06-20", "2025-08-08", "2025-08-11", "2025-09-24", "2025-09-25", "2025-10-20", "2025-11-10"] },
    { member: "황호석", dates: ["2025-03-17", "2025-04-02", "2025-04-23", "2025-05-16", "2025-06-13", "2025-07-11", "2025-07-21", "2025-08-25", "2025-09-15", "2025-10-17", "2025-11-10"] }
];

// 데이터 일괄 적용 함수
async function applyHistoricalLeaveData() {
    if (!State.persistentLeaveSchedule || !State.persistentLeaveSchedule.onLeaveMembers) {
        State.persistentLeaveSchedule = { onLeaveMembers: [] };
    }

    let updatedCount = 0;
    const currentLeaves = State.persistentLeaveSchedule.onLeaveMembers;

    const existingSet = new Set(currentLeaves.map(l => `${l.member}_${l.startDate}_연차`));

    historicalLeaveData.forEach(data => {
        data.dates.forEach(date => {
            const key = `${data.member}_${date}_연차`;
            if (!existingSet.has(key)) {
                currentLeaves.push({
                    id: `auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    member: data.member,
                    type: '연차',
                    startDate: date,
                    endDate: date // 하루 연차
                });
                existingSet.add(key);
                updatedCount++;
            }
        });
    });

    if (updatedCount > 0) {
        console.log(`총 ${updatedCount}건의 과거 연차 데이터를 새로 등록합니다.`);
        await saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
        showToast(`${updatedCount}건의 과거 연차 데이터가 적용되었습니다.`);
    } else {
        console.log("새로 적용할 연차 데이터가 없습니다 (이미 최신).");
    }
}


// --- 4. 핵심 코어 함수 ---
export const updateElapsedTimes = async () => {
    const now = getCurrentTime();
    
    // ✅ [수정] 오늘이 평일인지 확인 (주말에는 점심시간 자동정지/재개 적용 안 함)
    const todayDate = getTodayDateString();
    const isTodayWeekday = isWeekday(todayDate);
    
    // 1. 점심시간 자동 일시정지 (12:30) - 평일(isTodayWeekday)일 때만 실행
    if (isTodayWeekday && now === '12:30' && !State.appState.lunchPauseExecuted) {
        State.appState.lunchPauseExecuted = true;
        if (State.context.autoPauseForLunch) {
            try {
                const tasksPaused = await State.context.autoPauseForLunch();
                if (tasksPaused > 0) {
                    showToast(`점심시간입니다. 진행 중인 ${tasksPaused}개의 업무를 자동 일시정지합니다.`, false);
                }
            } catch (e) {
                console.error("Error during auto-pause: ", e);
            }
        }
        saveStateToFirestore(); 
    }

    // 2. 점심시간 자동 재개 (13:30) - 평일(isTodayWeekday)일 때만 실행
    if (isTodayWeekday && now === '13:30' && !State.appState.lunchResumeExecuted) {
        State.appState.lunchResumeExecuted = true;
        if (State.context.autoResumeFromLunch) {
            try {
                const tasksResumed = await State.context.autoResumeFromLunch();
                if (tasksResumed > 0) {
                    showToast(`점심시간 종료. ${tasksResumed}개의 업무를 자동 재개합니다.`, false);
                }
            } catch (e) {
                 console.error("Error during auto-resume: ", e);
            }
        }
        saveStateToFirestore(); 
    }

    document.querySelectorAll('.ongoing-duration').forEach(el => {
        try {
            const startTime = el.dataset.startTime;
            if (!startTime) return;

            const status = el.dataset.status;
            const pauses = JSON.parse(el.dataset.pausesJson || '[]');
            let currentPauses = pauses || [];

            if (status === 'paused') {
                const lastPause = currentPauses.length > 0 ? currentPauses[currentPauses.length - 1] : null;
                const tempPauses = [
                    ...currentPauses.slice(0, -1),
                    { start: lastPause?.start || startTime, end: now }
                ];
                const dur = calcElapsedMinutes(startTime, now, tempPauses);
                el.textContent = `(진행: ${formatDuration(dur)})`;

            } else { 
                const dur = calcElapsedMinutes(startTime, now, currentPauses);
                el.textContent = `(진행: ${formatDuration(dur)})`;
            }
        } catch (e) { /* noop */ }
    });

    const completedRecords = (State.appState.workRecords || []).filter(r => r.status === 'completed');
    const totalCompletedMinutes = completedRecords.reduce((sum, r) => sum + (r.duration || 0), 0);
    const ongoingLiveRecords = (State.appState.workRecords || []).filter(r => r.status === 'ongoing');
    let totalOngoingMinutes = 0;
    ongoingLiveRecords.forEach(rec => {
        totalOngoingMinutes += calcElapsedMinutes(rec.startTime, now, rec.pauses);
    });
    
    const el = document.getElementById('summary-total-work-time');
    if (el) el.textContent = formatDuration(totalCompletedMinutes + totalOngoingMinutes);
};

export const render = () => {
    try {
        renderRealtimeStatus(State.appState, State.appConfig.teamGroups, State.appConfig.keyTasks || [], State.context.isMobileTaskViewExpanded, State.context.isMobileMemberViewExpanded);
        renderCompletedWorkLog(State.appState);
        updateSummary(State.appState, State.appConfig);
        renderTaskAnalysis(State.appState, State.appConfig);
    } catch (e) {
        console.error('Render error:', e);
    }
};

export const markDataAsDirty = () => {
    State.setIsDataDirty(true);
};

export const autoSaveProgress = () => {
    const hasOngoing = (State.appState.workRecords || []).some(r => r.status === 'ongoing');

    if (State.isDataDirty || hasOngoing) {
        saveProgress(true); 
        State.setIsDataDirty(false);
    }
};

// --- 5. 앱 초기화 및 인증 로직 ---

async function startAppAfterLogin(user) {
    if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'block'; 

    try {
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '설정 로딩 중...';

        State.setAppConfig(await loadAppConfig(State.db));
        State.setPersistentLeaveSchedule(await loadLeaveSchedule(State.db));

        setTimeout(() => {
            applyHistoricalLeaveData();
        }, 2000);

        State.context.autoPauseForLunch = autoPauseForLunch;
        State.context.autoResumeFromLunch = autoResumeFromLunch;

        const userEmail = user.email;

        if (!userEmail) {
            showToast('로그인 사용자의 이메일 정보를 가져올 수 없습니다. 다시 로그인해주세요.', true);
            if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; 
            if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '인증 오류';
            State.auth.signOut();
            if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
            return;
        }

        const userEmailLower = userEmail.toLowerCase();
        const memberEmails = State.appConfig.memberEmails || {};
        const memberRoles = State.appConfig.memberRoles || {};

        const emailToMemberMap = Object.entries(memberEmails).reduce((acc, [name, email]) => {
            if (email) acc[email.toLowerCase()] = name;
            return acc;
        }, {});

        const currentUserName = emailToMemberMap[userEmailLower];
        const currentUserRole = memberRoles[userEmailLower] || 'user';

        if (!currentUserName) {
            showToast('로그인했으나 앱에 등록된 사용자가 아닙니다. 관리자에게 문의하세요.', true);
            if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; 
            if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '사용자 미등록';
            State.auth.signOut();
            if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
            return;
        }

        State.appState.currentUser = currentUserName;
        State.appState.currentUserRole = currentUserRole;

        if (DOM.userGreeting) {
            DOM.userGreeting.textContent = `${currentUserName}님 (${currentUserRole}), 안녕하세요.`;
            DOM.userGreeting.classList.remove('hidden');
        }
        if (DOM.logoutBtn) DOM.logoutBtn.classList.remove('hidden');
        if (DOM.logoutBtnMobile) DOM.logoutBtnMobile.classList.remove('hidden');

        const pcAttendanceToggle = document.getElementById('personal-attendance-toggle-pc');
        const pcAttendanceLabel = document.getElementById('pc-attendance-label');
        if (pcAttendanceToggle && pcAttendanceLabel) {
            pcAttendanceLabel.textContent = `${currentUserName}님 근태:`;
            pcAttendanceToggle.classList.remove('hidden');
            pcAttendanceToggle.classList.add('flex');
        }
        const mobileAttendanceToggle = document.getElementById('personal-attendance-toggle-mobile');
        if (mobileAttendanceToggle) {
             mobileAttendanceToggle.classList.remove('hidden');
             mobileAttendanceToggle.classList.add('flex');
        }

        const adminLinkBtn = document.getElementById('admin-link-btn');
        
        const adminTodoBtn = document.getElementById('open-admin-todo-btn');
        const adminTodoBtnMobile = document.getElementById('open-admin-todo-btn-mobile');

        if (currentUserRole === 'admin') {
            if (adminLinkBtn) adminLinkBtn.style.display = 'flex';
            if (DOM.adminLinkBtnMobile) DOM.adminLinkBtnMobile.style.display = 'flex';
            if (DOM.resetAppBtn) DOM.resetAppBtn.style.display = 'flex';
            if (DOM.resetAppBtnMobile) DOM.resetAppBtnMobile.style.display = 'flex';
            
            if (DOM.openHistoryBtn) DOM.openHistoryBtn.style.display = 'flex';
            if (DOM.openHistoryBtnMobile) DOM.openHistoryBtnMobile.style.display = 'flex';

            if (adminTodoBtn) adminTodoBtn.style.display = 'flex';
            if (adminTodoBtnMobile) adminTodoBtnMobile.style.display = 'flex';

            setInterval(() => {
                checkAdminTodoNotifications();
            }, 30000);

        } else {
            if (adminLinkBtn) adminLinkBtn.style.display = 'none';
            if (DOM.adminLinkBtnMobile) DOM.adminLinkBtnMobile.style.display = 'none';
            if (DOM.resetAppBtn) DOM.resetAppBtn.style.display = 'none';
            if (DOM.resetAppBtnMobile) DOM.resetAppBtnMobile.style.display = 'none';
            if (DOM.openHistoryBtn) DOM.openHistoryBtn.style.display = 'none';
            if (DOM.openHistoryBtnMobile) DOM.openHistoryBtnMobile.style.display = 'none';

            if (adminTodoBtn) adminTodoBtn.style.display = 'none';
            if (adminTodoBtnMobile) adminTodoBtnMobile.style.display = 'none';
        }

        document.getElementById('current-date-display')?.classList.remove('hidden');
        document.getElementById('top-right-controls')?.classList.remove('hidden');
        document.querySelector('.bg-gray-800.shadow-lg')?.classList.remove('hidden');
        document.getElementById('main-content-area')?.classList.remove('hidden');
        document.querySelectorAll('.p-6.bg-gray-50.rounded-lg.border.border-gray-200').forEach(el => {
            if (el.querySelector('#completed-log-content') || el.querySelector('#analysis-content')) {
                el.classList.remove('hidden');
            }
        });

        if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; 
        renderDashboardLayout(State.appConfig);
        renderTaskSelectionModal(State.appConfig.taskGroups);

    } catch (e) {
        console.error("설정 로드 실패:", e);
        showToast("설정 정보 로드에 실패했습니다. 기본값으로 실행합니다.", true);
        if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; 
        renderDashboardLayout(State.appConfig);
        renderTaskSelectionModal(State.appConfig.taskGroups);
    }

    displayCurrentDate();
    
    if (State.elapsedTimeTimer) clearInterval(State.elapsedTimeTimer);
    State.setElapsedTimeTimer(setInterval(updateElapsedTimes, 1000));

    if (State.periodicRefreshTimer) clearInterval(State.periodicRefreshTimer);
    State.setPeriodicRefreshTimer(setInterval(() => {
        renderCompletedWorkLog(State.appState);
        renderTaskAnalysis(State.appState, State.appConfig);
    }, 30000));

    if (State.autoSaveTimer) clearInterval(State.autoSaveTimer);
    State.setAutoSaveTimer(setInterval(autoSaveProgress, State.AUTO_SAVE_INTERVAL));

    // --- 실시간 리스너 설정 ---
    const leaveScheduleDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
    if (State.unsubscribeLeaveSchedule) State.unsubscribeLeaveSchedule();
    
    State.setUnsubscribeLeaveSchedule(onSnapshot(leaveScheduleDocRef, (docSnap) => {
        State.setPersistentLeaveSchedule(docSnap.exists() ? docSnap.data() : { onLeaveMembers: [] });
        const today = getTodayDateString();
        
        // ✅ 안전한 배열 접근
        const leaves = State.persistentLeaveSchedule.onLeaveMembers || [];
        
        State.appState.dateBasedOnLeaveMembers = leaves.filter(entry => {
            if (entry.type === '연차' || entry.type === '출장' || entry.type === '결근') {
                const endDate = entry.endDate || entry.startDate;
                return entry.startDate && typeof entry.startDate === 'string' &&
                    today >= entry.startDate && today <= (endDate || entry.startDate);
            }
            return false;
        });
        markDataAsDirty();
        render();
    }, (error) => {
        console.error("근태 일정 실시간 연결 실패:", error);
        showToast("근태 일정 연결에 실패했습니다.", true);
        State.appState.dateBasedOnLeaveMembers = [];
        render();
    }));

    const configDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');
    if (State.unsubscribeConfig) State.unsubscribeConfig();
    
    State.setUnsubscribeConfig(onSnapshot(configDocRef, (docSnap) => {
        if (docSnap.exists()) {
            console.log("실시간 앱 설정 감지: 변경 사항을 적용합니다.");
            const loadedConfig = docSnap.data();

            const mergedConfig = { ...State.appConfig, ...loadedConfig };

            mergedConfig.teamGroups = loadedConfig.teamGroups || State.appConfig.teamGroups;
            mergedConfig.keyTasks = loadedConfig.keyTasks || State.appConfig.keyTasks;
            mergedConfig.dashboardItems = loadedConfig.dashboardItems || State.appConfig.dashboardItems;
            mergedConfig.dashboardCustomItems = { ...(loadedConfig.dashboardCustomItems || {}) };
            mergedConfig.quantityTaskTypes = loadedConfig.quantityTaskTypes || State.appConfig.quantityTaskTypes;
            mergedConfig.qualityCostTasks = loadedConfig.qualityCostTasks || State.appConfig.qualityCostTasks;
            mergedConfig.systemAccounts = loadedConfig.systemAccounts || State.appConfig.systemAccounts || [];

            if (Array.isArray(loadedConfig.taskGroups)) {
                mergedConfig.taskGroups = loadedConfig.taskGroups;
            } else if (typeof loadedConfig.taskGroups === 'object' && loadedConfig.taskGroups !== null && !Array.isArray(loadedConfig.taskGroups)) {
                mergedConfig.taskGroups = Object.entries(loadedConfig.taskGroups).map(([groupName, tasks]) => {
                    return { name: groupName, tasks: Array.isArray(tasks) ? tasks : [] };
                });
            } else {
                mergedConfig.taskGroups = State.appConfig.taskGroups;
            }

            mergedConfig.memberWages = { ...State.appConfig.memberWages, ...(loadedConfig.memberWages || {}) };
            mergedConfig.memberEmails = { ...State.appConfig.memberEmails, ...(loadedConfig.memberEmails || {}) };
            mergedConfig.memberRoles = { ...State.appConfig.memberRoles, ...(loadedConfig.memberRoles || {}) };
            mergedConfig.quantityToDashboardMap = { ...State.appConfig.quantityToDashboardMap, ...(loadedConfig.quantityToDashboardMap || {}) };

            State.setAppConfig(mergedConfig); 

            renderDashboardLayout(State.appConfig);
            renderTaskSelectionModal(State.appConfig.taskGroups);
            render();

            if (DOM.addAttendanceMemberDatalist) {
                DOM.addAttendanceMemberDatalist.innerHTML = '';
                const staffMembers = (State.appConfig.teamGroups || []).flatMap(g => g.members);
                const partTimerMembers = (State.appState.partTimers || []).map(p => p.name);
                const allMembers = [...new Set([...staffMembers, ...partTimerMembers])].sort();
                allMembers.forEach(member => {
                    const option = document.createElement('option');
                    option.value = member;
                    DOM.addAttendanceMemberDatalist.appendChild(option);
                });
            }

        } else {
            console.warn("실시간 앱 설정 감지: config 문서가 삭제되었습니다. 로컬 설정을 유지합니다.");
        }
    }, (error) => {
        console.error("앱 설정 실시간 연결 실패:", error);
        showToast("앱 설정 연결에 실패했습니다.", true);
    }));

    const todayDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
    if (State.unsubscribeToday) State.unsubscribeToday();
    
    State.setUnsubscribeToday(onSnapshot(todayDocRef, (docSnap) => {
        try {
            const taskTypes = (State.appConfig.taskGroups || []).flatMap(group => group.tasks);
            const defaultQuantities = {};
            taskTypes.forEach(task => defaultQuantities[task] = 0);

            const data = docSnap.exists() ? docSnap.data() : {};
            
            let legacyState = {};
            if (data.state && typeof data.state === 'string') {
                try {
                    legacyState = JSON.parse(data.state);
                } catch (e) {
                    console.error("Legacy state parse error", e);
                }
            }

            State.appState.taskQuantities = { ...defaultQuantities, ...(data.taskQuantities || legacyState.taskQuantities || {}) };
            State.appState.partTimers = data.partTimers || legacyState.partTimers || [];
            State.appState.hiddenGroupIds = data.hiddenGroupIds || legacyState.hiddenGroupIds || [];
            
            // ✅ [수정] 오염된 onLeaveMembers가 있을 경우 배열로 변환하여 로드
            const rawLeaves = data.onLeaveMembers || legacyState.onLeaveMembers || [];
            State.appState.dailyOnLeaveMembers = Array.isArray(rawLeaves) ? rawLeaves : Object.values(rawLeaves);

            State.appState.lunchPauseExecuted = data.lunchPauseExecuted ?? legacyState.lunchPauseExecuted ?? false;
            State.appState.lunchResumeExecuted = data.lunchResumeExecuted ?? legacyState.lunchResumeExecuted ?? false;
            State.appState.confirmedZeroTasks = data.confirmedZeroTasks || legacyState.confirmedZeroTasks || [];
            State.appState.dailyAttendance = data.dailyAttendance || legacyState.dailyAttendance || {};

            State.appState.inspectionList = data.inspectionList || [];

            State.setIsDataDirty(false); 

            render();
            
            renderTodoList();
            
            if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '동기화 (메타)';
            if (DOM.statusDotEl) DOM.statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
        } catch (parseError) {
            console.error('Error parsing state from Firestore:', parseError);
            showToast('데이터 로딩 중 오류 발생 (파싱 실패).', true);
            if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '데이터 오류';
            if (DOM.statusDotEl) DOM.statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
        }
    }, (error) => {
        console.error('Firebase onSnapshot error:', error);
        showToast('실시간 연결에 실패했습니다.', true);
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '연결 오류';
        if (DOM.statusDotEl) DOM.statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
    }));
    
    const workRecordsCollectionRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords');
    if (State.unsubscribeWorkRecords) State.unsubscribeWorkRecords();
    
    State.setUnsubscribeWorkRecords(onSnapshot(workRecordsCollectionRef, (querySnapshot) => {
        State.appState.workRecords = [];
        querySnapshot.forEach((doc) => {
            State.appState.workRecords.push(doc.data());
        });

        State.appState.workRecords.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

        render();
        
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '동기화 (업무)';
        if (DOM.statusDotEl) DOM.statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';

    }, (error) => {
        console.error('Firebase workRecords onSnapshot error:', error);
        showToast('업무 기록 실시간 연결에 실패했습니다.', true);
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '연결 오류 (업무)';
        if (DOM.statusDotEl) DOM.statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500';
    }));
}

async function main() {
    if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'block'; 

    try {
        const firebase = initializeFirebase();
        State.setDb(firebase.db);
        State.setAuth(firebase.auth);
        
        if (!State.db || !State.auth) {
            if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; 
            return;
        }
    } catch (e) {
        console.error("Firebase init failed:", e);
        if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; 
        return;
    }

    onAuthStateChanged(State.auth, async user => {
        if (user) {
            if (DOM.loginModal) DOM.loginModal.classList.add('hidden');
            if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'block'; 
            await startAppAfterLogin(user);
        } else {
            if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '인증 필요';
            if (DOM.statusDotEl) DOM.statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-gray-400';

            if (State.unsubscribeToday) { State.unsubscribeToday(); State.setUnsubscribeToday(null); }
            if (State.unsubscribeLeaveSchedule) { State.unsubscribeLeaveSchedule(); State.setUnsubscribeLeaveSchedule(null); }
            if (State.unsubscribeConfig) { State.unsubscribeConfig(); State.setUnsubscribeConfig(null); }
            if (State.elapsedTimeTimer) { clearInterval(State.elapsedTimeTimer); State.setElapsedTimeTimer(null); }
            if (State.periodicRefreshTimer) { clearInterval(State.periodicRefreshTimer); State.setPeriodicRefreshTimer(null); }
            if (State.unsubscribeWorkRecords) { State.unsubscribeWorkRecords(); State.setUnsubscribeWorkRecords(null); }

            State.appState.workRecords = [];
            State.appState.taskQuantities = {};
            State.appState.dailyOnLeaveMembers = [];
            State.appState.dateBasedOnLeaveMembers = [];
            State.appState.partTimers = [];
            State.appState.hiddenGroupIds = [];
            State.appState.currentUser = null;
            State.appState.currentUserRole = 'user';
            State.appState.confirmedZeroTasks = [];
            State.appState.dailyAttendance = {};
            State.appState.lunchPauseExecuted = false;
            State.appState.lunchResumeExecuted = false;

            if (DOM.navContent) DOM.navContent.classList.add('hidden');
            if (DOM.userGreeting) DOM.userGreeting.classList.add('hidden');
            if (DOM.logoutBtn) DOM.logoutBtn.classList.add('hidden');
            if (DOM.logoutBtnMobile) DOM.logoutBtnMobile.classList.add('hidden');
            document.getElementById('current-date-display')?.classList.add('hidden');
            document.getElementById('top-right-controls')?.classList.add('hidden');
            document.querySelector('.bg-gray-800.shadow-lg')?.classList.add('hidden');
            document.getElementById('main-content-area')?.classList.add('hidden');
            document.querySelectorAll('.p-6.bg-gray-50.rounded-lg.border.border-gray-200').forEach(el => {
                if (el.querySelector('#completed-log-content') || el.querySelector('#analysis-content')) {
                    el.classList.add('hidden');
                }
            });

            document.getElementById('personal-attendance-toggle-pc')?.classList.add('hidden');
            document.getElementById('personal-attendance-toggle-mobile')?.classList.add('hidden');

            const adminLinkBtn = document.getElementById('admin-link-btn');
            if (adminLinkBtn) adminLinkBtn.style.display = 'none';
            if (DOM.adminLinkBtnMobile) DOM.adminLinkBtnMobile.style.display = 'none';
            if (DOM.resetAppBtn) DOM.resetAppBtn.style.display = 'none';
            if (DOM.resetAppBtnMobile) DOM.resetAppBtnMobile.style.display = 'none';
            if (DOM.openHistoryBtn) DOM.openHistoryBtn.style.display = 'none';
            if (DOM.openHistoryBtnMobile) DOM.openHistoryBtnMobile.style.display = 'none';

            const adminTodoBtn = document.getElementById('open-admin-todo-btn');
            const adminTodoBtnMobile = document.getElementById('open-admin-todo-btn-mobile');
            if (adminTodoBtn) adminTodoBtn.style.display = 'none';
            if (adminTodoBtnMobile) adminTodoBtnMobile.style.display = 'none';

            if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
            if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; 

            renderDashboardLayout({ dashboardItems: [] });
        }
    });

    initializeAppListeners();
    
    // [신규] 주말 근무 리스너 초기화
    setupWeekendListeners();
    
    // 모바일 버튼 클릭 시 데스크탑 버튼 이벤트 트리거
    const mobileWeekendBtn = document.getElementById('open-weekend-modal-btn-mobile');
    if (mobileWeekendBtn) {
        mobileWeekendBtn.addEventListener('click', () => {
             const desktopBtn = document.getElementById('open-weekend-modal-btn');
             if (desktopBtn) desktopBtn.click();
        });
    }
}

main();