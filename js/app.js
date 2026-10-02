// === js/app.js ===
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirebase, loadAppConfig, loadLeaveSchedule } from './config.js?v=202610021228';
import { displayCurrentDate, showToast } from './utils.js?v=202610021228';
import { renderDashboardLayout, renderRealtimeStatus, renderCompletedWorkLog, updateSummary, renderTaskAnalysis, renderTaskSelectionModal, applyDynamicSidebar } from './ui.js?v=202610021228';
import { initializeAppListeners } from './app-listeners.js?v=202610021228';
import * as DOM from './dom-elements.js?v=202610021228';
import * as State from './state.js?v=202610021228';
import { autoPauseForLunch, autoResumeFromLunch } from './app-logic.js?v=202610021228';
import { checkAdminTodoNotifications } from './admin-todo-logic.js?v=202610021228';
import { setupWeekendListeners } from './listeners-weekend.js?v=202610021228';

// ✅ 분리된 모듈 가져오기
import { updateElapsedTimes, autoSaveProgress, markDataAsDirty } from './app-lifecycle.js?v=202610021228';
import { setupNotificationListeners } from './app-notifications.js?v=202610021228';
import { setupFirebaseListeners, unsubscribeNotifications } from './app-sync.js?v=202610021228';
import { healYesterdayOnStartup } from './history-data-manager.js?v=202610021228';
import { initWorkCalendarWidget } from './widget-calendar.js?v=202610021228';
import { subscribeLeaveSchedule, unsubscribeLeaveSchedule } from './leave-schedule-sync.js?v=202610021228';
import { subscribeEzadmin, unsubscribeEzadmin } from './ezadmin-sync.js?v=202610021228';

export const normalizeName = (s = '') => s.normalize('NFC').trim().toLowerCase();

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

async function startAppAfterLogin(user) {
    if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'block'; 

    try {
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '설정 로딩 중...';

        State.setAppConfig(await loadAppConfig(State.db));
        State.setPersistentLeaveSchedule(await loadLeaveSchedule(State.db));

        State.context.autoPauseForLunch = autoPauseForLunch;
        State.context.autoResumeFromLunch = autoResumeFromLunch;

        const userEmail = user.email?.toLowerCase();
        if (!userEmail) {
            State.auth.signOut();
            return;
        }

        const emailToMemberMap = Object.entries(State.appConfig.memberEmails || {}).reduce((acc, [name, email]) => {
            if (email) acc[email.toLowerCase()] = name;
            return acc;
        }, {});

        const systemAccounts = State.appConfig.systemAccounts || [];
        const sysAcc = systemAccounts.find(acc => acc && acc.email && acc.email.toLowerCase() === userEmail);

        const currentUserName = emailToMemberMap[userEmail] || (sysAcc ? sysAcc.name : null);
        const currentUserRole = (State.appConfig.memberRoles || {})[userEmail] || (sysAcc ? sysAcc.role : 'user');

        if (!currentUserName) {
            showToast('앱에 등록된 사용자가 아닙니다. 관리자에게 문의하세요.', true);
            State.auth.signOut();
            return;
        }

        // 퇴사자는 여기서 막는다.
        // 권한 목록에서 빼고 메뉴 접근을 해제해도 사이드바만 비질 뿐이다.
        // 출퇴근 토글·업무보드는 nav 밖에 있고, 하위 페이지는 주소를 직접 치면 열린다.
        // ※ 완전한 차단은 Firebase Authentication 에서 계정을 비활성화해야 한다
        //    (브라우저 코드는 우회가 가능하다).
        if ((State.appConfig.resignedMembers || {})[currentUserName]) {
            showToast('퇴사 처리된 계정입니다. 관리자에게 문의하세요.', true);
            State.auth.signOut();
            return;
        }

        State.appState.currentUser = currentUserName;
        State.appState.currentUserRole = currentUserRole;

        // UI 토글 (Admin vs User) - 기존 로직 유지
        if (DOM.userGreeting) {
            DOM.userGreeting.textContent = `${currentUserName}님 (${currentUserRole}), 안녕하세요.`;
            DOM.userGreeting.classList.remove('hidden');
        }
        // PC·모바일 로그아웃 버튼을 함께 켠다.
        // (모바일 쪽을 빠뜨려 hidden 이 그대로 남아 버튼이 아예 보이지 않았다)
        if (DOM.logoutBtn) DOM.logoutBtn.classList.remove('hidden');
        if (DOM.logoutBtnMobile) DOM.logoutBtnMobile.classList.remove('hidden');

        // 관리자용 UI
        // 🏁 업무 마감도 관리자 전용이다. 예전엔 숨김 처리가 없어 로그인한 누구나
        //    누를 수 있었다 — 그 한 번이 전 직원 퇴근시각을 확정하고 그날 원본을 지운다.
        const adminElements = [document.getElementById('admin-link-btn'), DOM.adminLinkBtnMobile, DOM.resetAppBtn, DOM.resetAppBtnMobile, DOM.openHistoryBtn, DOM.openHistoryBtnMobile, document.getElementById('open-admin-todo-btn'), DOM.endShiftBtn, DOM.endShiftBtnMobile];
        adminElements.forEach(el => { if (el) el.style.display = (currentUserRole === 'admin') ? 'flex' : 'none'; });
        
        if (currentUserRole === 'admin') {
            setInterval(checkAdminTodoNotifications, 30000);
        }

        // 메인 영역 노출
        document.getElementById('main-content-area')?.classList.remove('hidden');

        if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; 
        
        // ✨ 신규: 관리자 권한 UI가 세팅된 직후, 메뉴 순서를 동적으로 재배치합니다.
        applyDynamicSidebar(State.appConfig);

        renderDashboardLayout(State.appConfig);
        renderTaskSelectionModal(State.appConfig.taskGroups);

    } catch (e) {
        console.error("설정 로드 실패:", e);
        if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; 
    }

    displayCurrentDate();
    
    // ✅ 1. 타이머 설정 (분리된 로직 사용)
    if (State.elapsedTimeTimer) clearInterval(State.elapsedTimeTimer);
    State.setElapsedTimeTimer(setInterval(updateElapsedTimes, 1000));

    if (State.periodicRefreshTimer) clearInterval(State.periodicRefreshTimer);
    State.setPeriodicRefreshTimer(setInterval(render, 30000));

    if (State.autoSaveTimer) clearInterval(State.autoSaveTimer);
    State.setAutoSaveTimer(setInterval(autoSaveProgress, State.AUTO_SAVE_INTERVAL));

    // ✅ 2. Firebase 실시간 동기화 리스너 실행 (분리된 파일 호출)
    setupFirebaseListeners(render, markDataAsDirty);

    // 🩺 3. 어제 업무기록이 이력에 없으면 자동 복구 (관리자 세션, 하루 1회)
    if (State.appState.currentUserRole === 'admin') {
        healYesterdayOnStartup().catch(e => console.warn('자가복구 건너뜀:', e));
    }

    // 🗓️ 4. 업무 캘린더 위젯 (근태 예정·입고일정 연동 + 일정 등록/수정/삭제)
    initWorkCalendarWidget().catch(e => console.warn('업무 캘린더 초기화 실패:', e));

    // 🔗 5. 근태(연차) 일정 실시간 구독 — 어느 화면에서 바뀌든(다른 사용자 포함)
    //        대시보드 근태예정 위젯·업무 캘린더·내 연차관리가 함께 갱신된다.
    subscribeLeaveSchedule();
    subscribeEzadmin();
}

async function main() {
    if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'block'; 

    try {
        const firebase = initializeFirebase();
        State.setDb(firebase.db);
        State.setAuth(firebase.auth);
    } catch (e) {
        return;
    }

    // ✅ 3. 알림 이벤트 리스너 세팅
    setupNotificationListeners();

    onAuthStateChanged(State.auth, async user => {
        if (user) {
            if (DOM.loginModal) DOM.loginModal.classList.add('hidden');
            await startAppAfterLogin(user);
        } else {
            // 로그아웃 초기화
            if (State.unsubscribeToday) State.unsubscribeToday();
            if (State.unsubscribeWorkRecords) State.unsubscribeWorkRecords();
            if (unsubscribeNotifications) unsubscribeNotifications();
            unsubscribeLeaveSchedule();
            unsubscribeEzadmin();

            State.appState.workRecords = [];
            State.appState.currentUser = null;
            if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
        }
    });

    initializeAppListeners();
    setupWeekendListeners();
}

main();