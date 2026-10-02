// === js/listeners-main.js ===
// 설명: 메인 화면의 리스너 (실시간 현황판 제외)

import * as DOM from './dom-elements.js?v=202610021228';
import * as State from './state.js?v=202610021228';

// app.js에서는 'render'만, app-data.js에서는 'updateDailyData'를 가져옵니다.
import { render } from './app.js?v=202610021228';
import { updateDailyData } from './app-data.js?v=202610021228';

import { calcElapsedMinutes, showToast, getTodayDateString, getCurrentTime, formatTimeTo24H } from './utils.js?v=202610021228';
import {
    renderPersonalAnalysis,
    renderQuantityModalInputs,
    renderManualAddModalDatalists,
    renderLeaveTypeModalOptions 
} from './ui.js?v=202610021228';
import {
    processClockIn, processClockOut, cancelClockOut
} from './app-logic.js?v=202610021228';
import { saveProgress, saveDayDataToHistory, checkUnverifiedRecords, previewDayClose } from './history-data-manager.js?v=202610021228';
import { checkMissingQuantities } from './analysis-logic.js?v=202610021228';
import { openHistoryQuantityModal } from './app-history-logic.js?v=202610021228';

import { 
    doc, updateDoc, collection, query, where, getDocs, setDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Admin Todo 로직 임포트
import * as AdminTodoLogic from './admin-todo-logic.js?v=202610021228';

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
    // 🔥 [핵심 수정] 진행 중인 업무가 없어도 확인 창을 띄우도록 수정

    // 마감 미리보기를 확인창에 그린다. 마감은 되돌릴 수 없으므로
    // '무엇이 마감되고 무엇이 삭제되는지' 를 누르기 전에 보여 준다.
    const renderEndShiftPreview = () => {
        const box = DOM.endShiftPreview;
        if (!box) return;
        const t = DOM.endShiftTimeInput ? DOM.endShiftTimeInput.value : '';
        if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(t)) {
            box.innerHTML = '<span class="text-red-600">마감 시각을 17:30 형식으로 입력해 주세요.</span>';
            return;
        }
        const p = previewDayClose(State.appState.workRecords || [],
                                 State.appState.dailyAttendance || {}, t);
        const 시간 = (m) => {
            const v = Math.round(m || 0);
            if (v < 60) return `${v}분`;
            return v % 60 ? `${Math.floor(v / 60)}시간 ${v % 60}분` : `${Math.floor(v / 60)}시간`;
        };
        const 줄 = [
            `· 진행 중 기록 <b>${p.closed}건</b>이 마감됩니다 (합계 ${시간(p.closedMinutes)})`,
            `· 퇴근 미기록 <b>${p.outTimeFixed}명</b>의 퇴근시각이 <b>${t}</b>로 확정됩니다`,
        ];
        if (p.deleted > 0) {
            const 사유 = [];
            if (p.deletedCompleted) 사유.push(`${p.deletedCompleted}건은 이미 종료된 0분 기록`);
            if (p.lateStart) 사유.push(`${p.lateStart}건은 ${t} 보다 늦게 시작`);
            줄.push(`· <span class="text-red-600 font-bold">⚠️ ${p.deleted}건은 0분이 되어 삭제됩니다`
                + (사유.length ? ` (그중 ${사유.join(', ')})` : '') + '</span>');
        }
        if (p.clamped > 0) 줄.push(`· ${p.clamped}건은 조퇴/퇴근 시각까지만 계산됩니다`);
        if (p.outTimeBeforeIn > 0) {
            줄.push(`· <span class="text-red-600 font-bold">⛔ ${p.outTimeBeforeIn}명은 출근시각이 ${t} 보다 늦습니다`
                + ' — 이대로는 마감할 수 없습니다</span>');
        }
        if (p.invalid > 0) {
            줄.push('· <span class="text-red-600 font-bold">⛔ '
                + `${p.invalid}건은 시작시각이 HH:MM 형식이 아닙니다 — 이대로는 마감할 수 없습니다</span>`);
        }
        줄.push(`· 이미 종료된 기록 ${p.kept}건은 그대로 유지됩니다`);
        box.innerHTML = 줄.map(x => `<div>${x}</div>`).join('');
    };

    const openEndShiftModal = () => {
        const ongoingRecords = (State.appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');

        if (ongoingRecords.length > 0) {
            const ongoingTaskNames = new Set(ongoingRecords.map(r => r.task));
            const ongoingTaskCount = ongoingTaskNames.size;
            if (DOM.endShiftConfirmTitle) DOM.endShiftConfirmTitle.textContent = `진행 중인 업무 ${ongoingTaskCount}종`;
            if (DOM.endShiftConfirmMessage) DOM.endShiftConfirmMessage.textContent = `총 ${ongoingRecords.length}명이 참여 중인 ${ongoingTaskCount}종의 업무가 있습니다. 모두 종료하고 마감하시겠습니까?`;
        } else {
            if (DOM.endShiftConfirmTitle) DOM.endShiftConfirmTitle.textContent = `오늘 업무 마감`;
            if (DOM.endShiftConfirmMessage) DOM.endShiftConfirmMessage.textContent = `진행 중인 업무가 없습니다. 이대로 오늘 업무를 마감하시겠습니까?`;
        }
        // 기본값은 현재시각 — 예전 동작과 같다. 그대로 누르면 결과가 달라지지 않는다.
        if (DOM.endShiftTimeInput) DOM.endShiftTimeInput.value = getCurrentTime();
        renderEndShiftPreview();
        if (DOM.endShiftConfirmModal) DOM.endShiftConfirmModal.classList.remove('hidden');
    };

    if (DOM.endShiftTimeInput) {
        DOM.endShiftTimeInput.addEventListener('input', renderEndShiftPreview);
        DOM.endShiftTimeInput.addEventListener('change', renderEndShiftPreview);
    }

    if (DOM.endShiftBtn) {
        DOM.endShiftBtn.addEventListener('click', openEndShiftModal);
    }

    if (DOM.endShiftBtnMobile) {
        DOM.endShiftBtnMobile.addEventListener('click', () => {
            openEndShiftModal();
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
                // (isAutoSave=true 로 주어 saveProgress 자체 토스트를 끄고, 결과만 여기서 한 번 알린다)
                // 처리량 자체는 위 updateDailyData 로 이미 반영됐다 — 확인은 먼저 알린다.
                showToast('오늘의 처리량(예상)을 반영했습니다.');

                // ⚠️ await 를 빼면 안 된다. 이 호출이 떠 있는 동안 사용자가 '업무 마감'을 누르면,
                //    뒤늦게 끝난 이쪽이 마감 전 상태(ongoing)로 이력을 통째 덮어쓴다.
                //    (workRecords 는 배열이라 merge 가 아니라 교체다)
                const resToday = await saveProgress(true, false);
                // 'nothing'(저장할 게 없음)은 정상, 'failed' 만 오류로 안내한다.
                if (resToday === 'failed') showToast('처리량은 반영됐지만 이력 저장에 실패했습니다. 연결을 확인해 주세요.', true);
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
                
                showToast('오늘의 처리량(예상)을 반영했습니다.');

                // await 필수 — 위 데스크톱 분기의 주석 참조(마감과의 경합).
                const resToday2 = await saveProgress(true, false);
                if (resToday2 === 'failed') showToast('처리량은 반영됐지만 이력 저장에 실패했습니다. 연결을 확인해 주세요.', true);
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