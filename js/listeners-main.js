// === js/listeners-main.js ===
// 설명: 메인 화면의 리스너 (실시간 현황판 제외)

import * as DOM from './dom-elements.js';
import * as State from './state.js';

// app.js에서는 'render'만, app-data.js에서는 'updateDailyData'를 가져옵니다.
import { render } from './app.js';
import { updateDailyData } from './app-data.js';

import { calcElapsedMinutes, showToast, getTodayDateString, getCurrentTime, formatTimeTo24H } from './utils.js';
import {
    renderPersonalAnalysis,
    renderQuantityModalInputs,
    renderManualAddModalDatalists,
    renderLeaveTypeModalOptions 
} from './ui.js';
import {
    processClockIn, processClockOut, cancelClockOut
} from './app-logic.js';
import { saveProgress, saveDayDataToHistory, checkUnverifiedRecords } from './history-data-manager.js';
import { checkMissingQuantities } from './analysis-logic.js';
import { openHistoryQuantityModal } from './app-history-logic.js';

import { 
    doc, updateDoc, collection, query, where, getDocs, setDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Admin Todo 로직 임포트
import * as AdminTodoLogic from './admin-todo-logic.js';

export function setupMainScreenListeners() {

    // --- 개인 출퇴근 리스너 ---
    const pcAttendanceCheckbox = document.getElementById('pc-attendance-checkbox');
    if (pcAttendanceCheckbox) {
        pcAttendanceCheckbox.addEventListener('change', (e) => {
            const currentUser = State.appState.currentUser;
            if (!currentUser) return;
            if (e.target.checked) {
                processClockIn(currentUser);
            } else {
                const success = processClockOut(currentUser);
                if (!success) e.target.checked = true;
            }
        });
    }

    const mobileAttendanceCheckbox = document.getElementById('mobile-attendance-checkbox');
    if (mobileAttendanceCheckbox) {
        mobileAttendanceCheckbox.addEventListener('change', (e) => {
            const currentUser = State.appState.currentUser;
            if (!currentUser) return;
            if (e.target.checked) {
                processClockIn(currentUser);
            } else {
                 const success = processClockOut(currentUser);
                if (!success) e.target.checked = true;
            }
        });
    }

    if (DOM.pcClockOutCancelBtn) {
        DOM.pcClockOutCancelBtn.addEventListener('click', () => {
            const currentUser = State.appState.currentUser;
            if (currentUser) cancelClockOut(currentUser);
        });
    }

    if (DOM.mobileClockOutCancelBtn) {
        DOM.mobileClockOutCancelBtn.addEventListener('click', () => {
            const currentUser = State.appState.currentUser;
            if (currentUser) cancelClockOut(currentUser);
        });
    }
    
    // 내 연차관리 버튼 리스너 (PC)
    if (DOM.openMyLeaveBtn) {
        DOM.openMyLeaveBtn.addEventListener('click', () => {
            const currentUser = State.appState.currentUser;
            if (!currentUser) {
                showToast('로그인이 필요합니다.', true);
                if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
                return;
            }
            
            // 컨텍스트 설정
            State.context.memberToSetLeave = currentUser;
            if (DOM.leaveMemberNameSpan) DOM.leaveMemberNameSpan.textContent = currentUser;

            // '연차 현황' 탭으로 모달 열기
            renderLeaveTypeModalOptions(State.LEAVE_TYPES, 'status');
            
            if (DOM.leaveTypeModal) DOM.leaveTypeModal.classList.remove('hidden');
            if (DOM.menuDropdown) DOM.menuDropdown.classList.add('hidden');
        });
    }

    // 내 연차관리 버튼 리스너 (Mobile)
    if (DOM.openMyLeaveBtnMobile) {
        DOM.openMyLeaveBtnMobile.addEventListener('click', () => {
            const currentUser = State.appState.currentUser;
            if (!currentUser) {
                showToast('로그인이 필요합니다.', true);
                if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
                return;
            }

            State.context.memberToSetLeave = currentUser;
            if (DOM.leaveMemberNameSpan) DOM.leaveMemberNameSpan.textContent = currentUser;

            renderLeaveTypeModalOptions(State.LEAVE_TYPES, 'status');

            if (DOM.leaveTypeModal) DOM.leaveTypeModal.classList.remove('hidden');
            if (DOM.navContent) DOM.navContent.classList.add('hidden');
        });
    }


    // --- 하단 완료 로그 리스너 ---
    if (DOM.workLogBody) {
        DOM.workLogBody.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('button[data-action="delete"]');
            if (deleteBtn) {
                State.context.recordToDeleteId = deleteBtn.dataset.recordId;
                State.context.deleteMode = 'single';
                const msgEl = document.getElementById('delete-confirm-message');
                if (msgEl) msgEl.textContent = '이 업무 기록을 삭제하시겠습니까?';
                if (DOM.deleteConfirmModal) DOM.deleteConfirmModal.classList.remove('hidden');
                return;
            }
            const editBtn = e.target.closest('button[data-action="edit"]');
            if (editBtn) {
                State.context.recordToEditId = editBtn.dataset.recordId;
                const record = (State.appState.workRecords || []).find(r => String(r.id) === String(State.context.recordToEditId));
                if (record) {
                    document.getElementById('edit-member-name').value = record.member;
                    document.getElementById('edit-start-time').value = record.startTime || '';
                    document.getElementById('edit-end-time').value = record.endTime || '';

                    const taskSelect = document.getElementById('edit-task-type');
                    taskSelect.innerHTML = '';

                    const allTasks = (State.appConfig.taskGroups || []).flatMap(group => group.tasks);

                    allTasks.forEach(task => {
                        const option = document.createElement('option');
                        option.value = task;
                        option.textContent = task;
                        if (task === record.task) option.selected = true;
                        taskSelect.appendChild(option);
                    });

                    if (DOM.editRecordModal) DOM.editRecordModal.classList.remove('hidden');
                }
                return;
            }
        });
    }

    // --- 하단 버튼 (마감, 저장, 수동추가) 리스너 ---
    if (DOM.endShiftBtn) {
        DOM.endShiftBtn.addEventListener('click', () => {
            const ongoingRecords = (State.appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');

            if (ongoingRecords.length > 0) {
                const ongoingTaskNames = new Set(ongoingRecords.map(r => r.task));
                const ongoingTaskCount = ongoingTaskNames.size;
                if (DOM.endShiftConfirmTitle) DOM.endShiftConfirmTitle.textContent = `진행 중인 업무 ${ongoingTaskCount}종`;
                if (DOM.endShiftConfirmMessage) DOM.endShiftConfirmMessage.textContent = `총 ${ongoingRecords.length}명이 참여 중인 ${ongoingTaskCount}종의 업무가 있습니다. 모두 종료하고 마감하시겠습니까?`;
                if (DOM.endShiftConfirmModal) DOM.endShiftConfirmModal.classList.remove('hidden');
            } else {
                saveDayDataToHistory(true);
            }
        });
    }
    
    if (DOM.endShiftBtnMobile) {
        DOM.endShiftBtnMobile.addEventListener('click', () => {
            const ongoingRecords = (State.appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');

            if (ongoingRecords.length > 0) {
                const ongoingTaskNames = new Set(ongoingRecords.map(r => r.task));
                const ongoingTaskCount = ongoingTaskNames.size;
                if (DOM.endShiftConfirmTitle) DOM.endShiftConfirmTitle.textContent = `진행 중인 업무 ${ongoingTaskCount}종`;
                if (DOM.endShiftConfirmMessage) DOM.endShiftConfirmMessage.textContent = `총 ${ongoingRecords.length}명이 참여 중인 ${ongoingTaskCount}종의 업무가 있습니다. 모두 종료하고 마감하시겠습니까?`;
                if (DOM.endShiftConfirmModal) DOM.endShiftConfirmModal.classList.remove('hidden');
            } else {
                saveDayDataToHistory(true);
            }
            if (DOM.navContent) DOM.navContent.classList.add('hidden');
        });
    }


    if (DOM.saveProgressBtn) {
        // [수정] 수동 저장 시에는 '확정'이 아닌 '가저장' 상태로 저장 (isQuantityVerified = false)
        DOM.saveProgressBtn.addEventListener('click', () => saveProgress(false, false));
    }

    if (DOM.openManualAddBtn) {
        DOM.openManualAddBtn.addEventListener('click', () => {
            document.getElementById('manual-add-start-time').value = getCurrentTime();
            document.getElementById('manual-add-end-time').value = '';
            renderManualAddModalDatalists(State.appState, State.appConfig);
            if (DOM.manualAddRecordModal) DOM.manualAddRecordModal.classList.remove('hidden');
        });
    }

    // --- 패널 접기/펴기 (모바일) 리스너 ---
    [DOM.toggleCompletedLog, DOM.toggleAnalysis, DOM.toggleSummary].forEach(toggle => {
        if (!toggle) return;
        toggle.addEventListener('click', () => {
            if (window.innerWidth >= 768) return;
            const content = toggle.nextElementSibling;
            const arrow = toggle.querySelector('svg');
            if (!content) return;
            content.classList.toggle('hidden');
            if (arrow) arrow.classList.toggle('rotate-180');
        });
    });

    // --- 헤더 메뉴 / 햄버거 메뉴 리스너 ---
    if (DOM.hamburgerBtn && DOM.navContent) {
        DOM.hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            DOM.navContent.classList.toggle('hidden');
        });
        DOM.navContent.addEventListener('click', (e) => {
            if (window.innerWidth < 768 && e.target.closest('a, button')) {
                DOM.navContent.classList.add('hidden');
            }
        });
    }

    if (DOM.menuToggleBtn) {
        DOM.menuToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (DOM.menuDropdown) DOM.menuDropdown.classList.toggle('hidden');
        });
    }

    document.addEventListener('click', (e) => {
        if (DOM.navContent && DOM.hamburgerBtn) {
            const isClickInsideNav = DOM.navContent.contains(e.target);
            const isClickOnHamburger = DOM.hamburgerBtn.contains(e.target);
            if (!DOM.navContent.classList.contains('hidden') && !isClickInsideNav && !isClickOnHamburger) {
                DOM.navContent.classList.add('hidden');
            }
        }
        if (DOM.menuDropdown && DOM.menuToggleBtn) {
            const isClickInsideMenu = DOM.menuDropdown.contains(e.target);
            const isClickOnMenuBtn = DOM.menuToggleBtn.contains(e.target);
            if (!DOM.menuDropdown.classList.contains('hidden') && !isClickInsideMenu && !isClickOnMenuBtn) {
                DOM.menuDropdown.classList.add('hidden');
            }
        }
    });

    // --- 처리량 입력 (메뉴) 리스너 ---
    if (DOM.openQuantityModalTodayBtn) {
        DOM.openQuantityModalTodayBtn.addEventListener('click', () => {
            if (!State.auth || !State.auth.currentUser) {
                showToast('로그인이 필요합니다.', true);
                if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
                return;
            }

            const quantityModal = document.getElementById('quantity-modal');

            const todayData = {
                workRecords: State.appState.workRecords || [],
                taskQuantities: State.appState.taskQuantities || {},
                confirmedZeroTasks: State.appState.confirmedZeroTasks || []
            };
            const missingTasksList = checkMissingQuantities(todayData);

            renderQuantityModalInputs(State.appState.taskQuantities || {}, State.appConfig.quantityTaskTypes || [], missingTasksList, State.appState.confirmedZeroTasks || []);

            const title = document.getElementById('quantity-modal-title');
            if (title) title.textContent = '오늘의 처리량 입력 (예상값)';

            State.context.quantityModalContext.mode = 'today';
            State.context.quantityModalContext.dateKey = null;
            // [중요] 오늘의 입력은 '확정' 단계가 아님 (isVerifyingMode = false)
            State.context.quantityModalContext.isVerifyingMode = false;

            State.context.quantityModalContext.onConfirm = async (newQuantities, confirmedZeroTasks) => {
                State.appState.taskQuantities = newQuantities;
                State.appState.confirmedZeroTasks = confirmedZeroTasks;
                
                await updateDailyData({
                    taskQuantities: newQuantities,
                    confirmedZeroTasks: confirmedZeroTasks
                });

                // 오늘 입력은 '가저장' 상태이므로 isQuantityVerified = false로 저장
                saveProgress(false, false); 

                showToast('오늘의 처리량(예상)이 저장되었습니다.');
            };

            State.context.quantityModalContext.onCancel = () => {};

            const quantityModalEl = document.getElementById('quantity-modal');
            if (quantityModalEl) quantityModalEl.classList.remove('hidden');
            if (DOM.menuDropdown) DOM.menuDropdown.classList.add('hidden');
        });
    }

    if (DOM.openQuantityModalTodayBtnMobile) {
        DOM.openQuantityModalTodayBtnMobile.addEventListener('click', () => {
            if (!State.auth || !State.auth.currentUser) {
                showToast('로그인이 필요합니다.', true);
                if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
                return;
            }

            const quantityModal = document.getElementById('quantity-modal');

            const todayData = {
                workRecords: State.appState.workRecords || [],
                taskQuantities: State.appState.taskQuantities || {},
                confirmedZeroTasks: State.appState.confirmedZeroTasks || []
            };
            const missingTasksList = checkMissingQuantities(todayData);

            renderQuantityModalInputs(State.appState.taskQuantities || {}, State.appConfig.quantityTaskTypes || [], missingTasksList, State.appState.confirmedZeroTasks || []);

            const title = document.getElementById('quantity-modal-title');
            if (title) title.textContent = '오늘의 처리량 입력 (예상값)';

            State.context.quantityModalContext.mode = 'today';
            State.context.quantityModalContext.dateKey = null;
            State.context.quantityModalContext.isVerifyingMode = false;

            State.context.quantityModalContext.onConfirm = async (newQuantities, confirmedZeroTasks) => {
                State.appState.taskQuantities = newQuantities;
                State.appState.confirmedZeroTasks = confirmedZeroTasks;

                await updateDailyData({
                    taskQuantities: newQuantities,
                    confirmedZeroTasks: confirmedZeroTasks
                });
                
                saveProgress(false, false);

                showToast('오늘의 처리량(예상)이 저장되었습니다.');
            };

            State.context.quantityModalContext.onCancel = () => {};

            const quantityModalEl = document.getElementById('quantity-modal');
            if (quantityModalEl) quantityModalEl.classList.remove('hidden');
            if (DOM.navContent) DOM.navContent.classList.add('hidden');
        });
    }

    // --- 분석 패널 리스너 ---
    const analysisTabs = document.getElementById('analysis-tabs');
    if (analysisTabs) {
        analysisTabs.addEventListener('click', (e) => {
            const button = e.target.closest('.analysis-tab-btn');
            if (!button) return;
            const panelId = button.dataset.tabPanel;
            if (!panelId) return;

            analysisTabs.querySelectorAll('.analysis-tab-btn').forEach(btn => {
                btn.classList.remove('text-blue-600', 'border-blue-600');
                btn.classList.add('text-gray-500', 'border-transparent', 'hover:text-gray-700', 'hover:border-gray-300');
            });
            button.classList.add('text-blue-600', 'border-blue-600');
            button.classList.remove('text-gray-500', 'border-transparent', 'hover:text-gray-700', 'hover:border-gray-300');

            document.querySelectorAll('.analysis-tab-panel').forEach(panel => {
                panel.classList.add('hidden');
            });
            const panelToShow = document.getElementById(panelId);
            if (panelToShow) {
                panelToShow.classList.remove('hidden');
            }
        });
    }

    if (DOM.analysisMemberSelect) {
        DOM.analysisMemberSelect.addEventListener('change', (e) => {
            const selectedMember = e.target.value;
            renderPersonalAnalysis(selectedMember, State.appState);
        });
    }

    // ======================================================
    // 관리자 To-Do 리스트 관련 리스너
    // ======================================================
    
    // 1. 버튼 클릭 시 모달 열기
    const openButtons = ['open-admin-todo-btn', 'open-admin-todo-btn-mobile'];
    openButtons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', () => {
                const modal = document.getElementById('admin-todo-modal');
                if (modal) {
                    modal.classList.remove('hidden');
                    AdminTodoLogic.loadAdminTodos(); 
                    setTimeout(() => document.getElementById('admin-todo-input')?.focus(), 50);
                }
                // 메뉴 닫기
                if (DOM.menuDropdown) DOM.menuDropdown.classList.add('hidden');
                if (DOM.navContent) DOM.navContent.classList.add('hidden');
            });
        }
    });

    // 2. 모달 내부 동작 (추가, 삭제, 토글)
    const todoInput = document.getElementById('admin-todo-input');
    const todoDateInput = document.getElementById('admin-todo-datetime'); 
    const todoAddBtn = document.getElementById('admin-todo-add-btn');
    const todoList = document.getElementById('admin-todo-list');

    if (todoAddBtn && todoInput) {
        // 추가 버튼 클릭
        todoAddBtn.addEventListener('click', () => {
            AdminTodoLogic.addTodo(todoInput.value, todoDateInput ? todoDateInput.value : null);
            todoInput.value = '';
            if (todoDateInput) todoDateInput.value = ''; 
            todoInput.focus();
        });
        // 엔터키 입력
        todoInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                AdminTodoLogic.addTodo(todoInput.value, todoDateInput ? todoDateInput.value : null);
                todoInput.value = '';
                if (todoDateInput) todoDateInput.value = '';
            }
        });
    }

    if (todoList) {
        todoList.addEventListener('click', (e) => {
            // 삭제 버튼
            const deleteBtn = e.target.closest('.delete-todo-btn');
            if (deleteBtn) {
                AdminTodoLogic.deleteTodo(deleteBtn.dataset.id);
                return;
            }
            // 완료 토글 (아이템 클릭)
            const itemClick = e.target.closest('.todo-item-click');
            if (itemClick) {
                AdminTodoLogic.toggleTodo(itemClick.dataset.id);
            }
        });
    }

    // 알림 모달 '확인했습니다' 버튼 리스너
    if (DOM.adminTodoAlertConfirmBtn) {
        DOM.adminTodoAlertConfirmBtn.addEventListener('click', () => {
            if (DOM.adminTodoAlertModal) {
                DOM.adminTodoAlertModal.classList.add('hidden');
            }
        });
    }
}

// [신규] 미확정 처리량 데이터 확인 및 모달 호출 함수 (앱 실행 시 호출 권장)
export async function checkPendingVerifications() {
    const unverifiedDates = await checkUnverifiedRecords();
    
    if (unverifiedDates.length > 0) {
        // 가장 최근의 미확정 날짜 선택
        const targetDate = unverifiedDates[unverifiedDates.length - 1];
        
        // confirm 창 또는 전용 모달 띄우기
        if (confirm(`📅 [${targetDate}] 업무 처리량이 아직 '예상치' 상태입니다.\n실제 값을 확인하고 확정하시겠습니까?`)) {
            // 히스토리 수정 모달을 '확정 모드'로 염
            openHistoryQuantityModal(targetDate, true); 
        }
    }
}