// === js/admin.js ===
// 설명: 관리자 페이지의 메인 진입점. 초기화, 이벤트 연결, UI와 로직의 조정을 담당합니다.

import { initializeFirebase, loadAppConfig, saveAppConfig } from './config.js';
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// UI 렌더링 모듈 임포트
import {
    renderAdminUI,
    renderKeyTasks,
    renderQuantityTasks,
    renderDashboardItemsConfig,
    renderQuantityToDashboardMapping,
    populateTaskSelectModal,
    openDashboardItemModal,
    getAllDashboardDefinitions
} from './admin-ui.js';

// 비즈니스 로직 모듈 임포트
import {
    collectConfigFromDOM,
    validateConfig
} from './admin-logic.js';

let db, auth;
let appConfig = {}; // 모듈 레벨 전역 변수

// 드래그 앤 드롭 상태 변수
let draggedItem = null;
let currentModalTarget = null;
let taskJustAdded = null;

// =================================================================
// 1. 메인 초기화 및 인증 처리
// =================================================================
document.addEventListener('DOMContentLoaded', () => {
    const adminContent = document.getElementById('admin-content');

    try {
        const firebase = initializeFirebase();
        db = firebase.db;
        auth = firebase.auth;
    } catch (e) {
        console.error(e);
        if (adminContent) {
            adminContent.innerHTML = `<h2 class="text-2xl font-bold text-red-600 p-8 text-center">Firebase 초기화 실패.</h2>`;
            adminContent.classList.remove('hidden');
        }
        return;
    }

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            try {
                // 설정 로드
                appConfig = await loadAppConfig(db);

                // 권한 확인
                const userEmailLower = (user.email || '').toLowerCase();
                const memberRoles = appConfig.memberRoles || {};
                const currentUserRole = memberRoles[userEmailLower] || 'user';

                if (currentUserRole === 'admin') {
                    // 관리자라면 UI 렌더링 및 이벤트 연결
                    renderAdminUI(appConfig);
                    setupEventListeners();
                    if (adminContent) adminContent.classList.remove('hidden');
                } else {
                    if (adminContent) {
                         adminContent.innerHTML = `<h2 class="text-2xl font-bold text-yellow-600 p-8 text-center">접근 거부: 관리자 계정이 아닙니다.</h2>`;
                         adminContent.classList.remove('hidden');
                    }
                }
            } catch (e) {
                console.error("초기화 중 오류:", e);
                alert(`초기화 중 오류가 발생했습니다: ${e.message}`);
            }
        } else {
             if (adminContent) {
                adminContent.innerHTML = `<h2 class="text-2xl font-bold text-gray-600 p-8 text-center">접근 거부: 로그인이 필요합니다.<br><br><a href="index.html" class="text-blue-600 hover:underline">메인 앱으로 이동</a></h2>`;
                adminContent.classList.remove('hidden');
             }
        }
    });
});

// =================================================================
// 2. 이벤트 리스너 설정 (Controller)
// =================================================================
function setupEventListeners() {
    // 상단 메인 버튼
    document.getElementById('save-all-btn')?.addEventListener('click', handleSaveAll);
    
    // ✅ [추가] 모달 닫기 버튼 공통 리스너
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.dataset.modalId;
            if (modalId) {
                const modal = document.getElementById(modalId);
                if (modal) modal.classList.add('hidden');
            }
        });
    });
    
    // 추가 버튼들
    document.getElementById('add-team-group-btn')?.addEventListener('click', addTeamGroup);
    document.getElementById('add-task-group-btn')?.addEventListener('click', addTaskGroup);
    document.getElementById('add-dashboard-item-btn')?.addEventListener('click', () => openDashboardItemModal(appConfig));
    document.getElementById('add-custom-dashboard-item-btn')?.addEventListener('click', addCustomDashboardItem);

    // 모달 열기 버튼들
    document.getElementById('add-key-task-btn')?.addEventListener('click', () => {
        currentModalTarget = 'key';
        populateTaskSelectModal('key');
        document.getElementById('select-task-modal')?.classList.remove('hidden');
    });
    document.getElementById('add-quantity-task-btn')?.addEventListener('click', () => {
        currentModalTarget = 'quantity';
        populateTaskSelectModal('quantity');
        document.getElementById('select-task-modal')?.classList.remove('hidden');
    });

    // 모달 내부 선택 이벤트
    document.getElementById('select-task-list')?.addEventListener('click', (e) => {
        const button = e.target.closest('.task-select-list-btn');
        if (button) {
            const taskName = button.dataset.taskName;
            if (currentModalTarget === 'key') addKeyTask(taskName);
            else if (currentModalTarget === 'quantity') addQuantityTask(taskName);
            
            document.getElementById('select-task-modal')?.classList.add('hidden');
            currentModalTarget = null;
        }
    });

    document.getElementById('select-dashboard-item-list')?.addEventListener('click', (e) => {
        const button = e.target.closest('.dashboard-item-select-btn');
        if (button && !button.disabled) {
            const itemId = button.dataset.id;
            if (!appConfig.dashboardItems) appConfig.dashboardItems = [];
            appConfig.dashboardItems.push(itemId);
            
            // 부분 재렌더링
            renderDashboardItemsConfig(appConfig.dashboardItems, appConfig);
            renderQuantityToDashboardMapping(appConfig);
            
            document.getElementById('select-dashboard-item-modal')?.classList.add('hidden');
        }
    });

    // 알림 모달 버튼
    document.getElementById('confirm-add-to-quantity-btn')?.addEventListener('click', () => {
        if (taskJustAdded) addQuantityTask(taskJustAdded);
        document.getElementById('confirm-add-to-quantity-modal')?.classList.add('hidden');
        taskJustAdded = null;
    });
    document.getElementById('cancel-add-to-quantity-btn')?.addEventListener('click', () => {
        document.getElementById('confirm-add-to-quantity-modal')?.classList.add('hidden');
        taskJustAdded = null;
    });

    // 동적 요소 클릭 이벤트 위임 (삭제 버튼 등)
    document.body.addEventListener('click', handleDynamicClicks);

    // 드래그 앤 드롭 활성화
    setupAllDragListeners();
}

// =================================================================
// 3. 주요 액션 핸들러 (Controller Logic)
// =================================================================

// 저장 핸들러
async function handleSaveAll() {
    const btn = document.getElementById('save-all-btn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    try {
        // 1. DOM에서 데이터 수집 (admin-logic.js)
        const newConfig = collectConfigFromDOM(appConfig);
        
        // 2. 유효성 검사 (admin-logic.js)
        validateConfig(newConfig);

        // 3. Firebase 저장 (config.js)
        await saveAppConfig(db, newConfig);
        
        // 4. 성공 처리
        appConfig = newConfig;
        alert('✅ 모든 변경사항이 성공적으로 저장되었습니다!');
        
        // 5. UI 새로고침 (완전 동기화)
        renderAdminUI(appConfig);
        setupAllDragListeners(); // DOM이 교체되었으므로 드래그 리스너 재연결

    } catch (e) {
        console.error("저장 실패:", e);
        alert(`❌ 저장 실패:\n${e.message}`);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 inline-block -mt-1 mr-1" viewBox="0 0 20 20" fill="currentColor"><path d="M7.707 10.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V6h5a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2h5v5.586l-1.293-1.293zM9 4a1 1 0 012 0v2H9V4z" /></svg> 모든 변경사항 저장`; }
    }
}

// 주요 업무 추가
function addKeyTask(taskName) {
    const nameToAdd = taskName || '새 주요 업무';
    if (!appConfig.keyTasks) appConfig.keyTasks = [];

    if (appConfig.keyTasks.some(t => t.trim().toLowerCase() === nameToAdd.trim().toLowerCase())) {
        alert("이미 '주요 업무'에 등록된 업무입니다.");
        return;
    }
    appConfig.keyTasks.push(nameToAdd);
    renderKeyTasks(appConfig.keyTasks);
}

// 처리량 업무 추가
function addQuantityTask(taskName) {
    const nameToAdd = taskName || '새 처리량 업무';
    if (!appConfig.quantityTaskTypes) appConfig.quantityTaskTypes = [];

    if (appConfig.quantityTaskTypes.some(t => t.trim().toLowerCase() === nameToAdd.trim().toLowerCase())) {
        if (taskJustAdded === taskName) return; // 중복 알림 방지
        alert("이미 '처리량 집계 업무'에 등록된 업무입니다.");
        return;
    }
    appConfig.quantityTaskTypes.push(nameToAdd);
    renderQuantityTasks(appConfig.quantityTaskTypes);
    renderQuantityToDashboardMapping(appConfig);
}

// 커스텀 현황판 항목 추가
function addCustomDashboardItem() {
    const newTitle = prompt("새로 추가할 수량 항목의 이름을 입력하세요:");
    if (!newTitle || newTitle.trim() === '') return;
    const trimmedTitle = newTitle.trim();

    const allDefinitions = getAllDashboardDefinitions(appConfig);
    if (Object.values(allDefinitions).some(def => def.title.toLowerCase() === trimmedTitle.toLowerCase())) {
        alert("이미 같은 이름의 항목이 존재합니다.");
        return;
    }

    const newId = `custom-${Date.now()}-${Math.random().toString(16).substring(2, 6)}`;
    if (!appConfig.dashboardCustomItems) appConfig.dashboardCustomItems = {};
    appConfig.dashboardCustomItems[newId] = { title: trimmedTitle, isQuantity: true };

    if (!appConfig.dashboardItems) appConfig.dashboardItems = [];
    appConfig.dashboardItems.push(newId);

    renderDashboardItemsConfig(appConfig.dashboardItems, appConfig);
    renderQuantityToDashboardMapping(appConfig);
}

// =================================================================
// 4. UI 인터랙션 (Interactive UI Builders)
// =================================================================

// 새 팀 그룹 추가 (DOM 생성)
function addTeamGroup() {
    const container = document.getElementById('team-groups-container');
    if (!container) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'p-4 border rounded-lg bg-gray-50 team-group-card';
    groupEl.innerHTML = `
        <div class="flex justify-between items-center mb-4">
            <div class="flex items-center">
                <span class="drag-handle" draggable="true">☰</span> 
                <input type="text" value="새 그룹" class="text-lg font-semibold team-group-name w-auto">
            </div>
            <button class="btn btn-danger btn-small delete-team-group-btn">그룹 삭제</button>
        </div>
        <div class="pl-4 border-l-2 border-gray-200 space-y-2 members-container">
             </div>
        <button class="btn btn-secondary btn-small mt-3 add-member-btn">+ 팀원 추가</button>
    `;
    container.appendChild(groupEl);
    setupDragDropListeners('.members-container', '.member-item'); // 새 컨테이너에 드래그 리스너 연결
}

// 새 업무 그룹 추가 (DOM 생성)
function addTaskGroup() {
    const container = document.getElementById('task-groups-container');
    if (!container) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'p-4 border rounded-lg bg-gray-50 task-group-card';
    groupEl.innerHTML = `
         <div class="flex justify-between items-center mb-4">
            <div class="flex items-center"> 
               <span class="drag-handle" draggable="true">☰</span>
               <input type="text" value="새 업무 그룹" class="text-lg font-semibold task-group-name w-auto">
             </div>
            <button class="btn btn-danger btn-small delete-task-group-btn">그룹 삭제</button>
        </div>
        <div class="pl-4 border-l-2 border-gray-200 space-y-2 tasks-container"></div>
        <button class="btn btn-secondary btn-small mt-3 add-task-btn">+ 업무 추가</button>
    `;
    container.appendChild(groupEl);
    setupDragDropListeners('.tasks-container', '.task-item');
}

// 동적 클릭 이벤트 핸들러 (위임)
function handleDynamicClicks(e) {
    // 1. 삭제 버튼들
    if (e.target.classList.contains('delete-member-btn')) e.target.closest('.member-item')?.remove();
    else if (e.target.classList.contains('delete-team-group-btn')) e.target.closest('.team-group-card')?.remove();
    else if (e.target.classList.contains('delete-key-task-btn')) e.target.closest('.key-task-item')?.remove();
    else if (e.target.classList.contains('delete-task-btn')) e.target.closest('.task-item')?.remove();
    else if (e.target.classList.contains('delete-task-group-btn')) e.target.closest('.task-group-card')?.remove();
    else if (e.target.classList.contains('delete-quantity-task-btn')) {
        e.target.closest('.quantity-task-item')?.remove();
        renderQuantityToDashboardMapping({ ...appConfig, quantityTaskTypes: getAllCurrentQuantityTasks() }); // 매핑 업데이트
    }
    else if (e.target.classList.contains('delete-dashboard-item-btn')) {
        e.target.closest('.dashboard-item-config')?.remove();
        // 현황판 항목 삭제 시 매핑 드롭다운도 업데이트 필요
        setTimeout(() => renderQuantityToDashboardMapping(collectConfigFromDOM(appConfig)), 0);
    }

    // 2. 추가 버튼들 (그룹 내부)
    else if (e.target.classList.contains('add-member-btn')) {
        const container = e.target.previousElementSibling;
        const defaultWage = document.getElementById('default-part-timer-wage')?.value || 10000;
        const newMemberEl = document.createElement('div');
        newMemberEl.className = 'flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 member-item';
        newMemberEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span>
            <input type="text" value="새 팀원" class="member-name w-32" placeholder="팀원 이름">
            <label class="text-sm whitespace-nowrap ml-2">로그인 이메일:</label>
            <input type="email" value="" class="member-email w-48" placeholder="example@email.com">
            <label class="text-sm whitespace-nowrap ml-2">시급:</label>
            <input type="number" value="${defaultWage}" class="member-wage w-20" placeholder="시급">
            <label class="text-sm whitespace-nowrap ml-2">역할:</label>
            <select class="member-role w-24 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm">
                <option value="user" selected>일반사용자</option>
                <option value="admin">관리자</option>
            </select>
            <button class="btn btn-danger btn-small delete-member-btn ml-auto">삭제</button>
        `;
        container.appendChild(newMemberEl);
    }
    else if (e.target.classList.contains('add-task-btn')) {
        const container = e.target.previousElementSibling;
        const newTaskEl = document.createElement('div');
        newTaskEl.className = 'flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 task-item';
        newTaskEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span>
            <input type="text" value="새 업무" class="task-name flex-grow">
            <button class="btn btn-danger btn-small delete-task-btn">삭제</button>
        `;
        container.appendChild(newTaskEl);
        // 새 업무 입력 시 자동 포커스 및 블러 이벤트 연결
        const input = newTaskEl.querySelector('.task-name');
        if (input) {
            input.focus();
            input.addEventListener('blur', handleNewTaskNameBlur, { once: true });
        }
    }

    // 3. 카드 토글
    const toggleBtn = e.target.closest('.config-card-toggle');
    if (toggleBtn) {
        const card = toggleBtn.closest('.config-card');
        card.querySelector('.config-card-content')?.classList.toggle('hidden');
        toggleBtn.querySelector('svg')?.classList.toggle('arrow-rotated');
    }
}

// 새 업무 이름 입력 완료 시 처리량 추가 제안
function handleNewTaskNameBlur(e) {
    const newTaskName = e.target.value.trim();
    if (!newTaskName || newTaskName === '새 업무') return;

    // 이미 처리량 목록에 있는지 확인
    const currentQuantityTasks = getAllCurrentQuantityTasks();
    if (currentQuantityTasks.some(t => t.toLowerCase() === newTaskName.toLowerCase())) return;

    // 알림 모달 표시
    taskJustAdded = newTaskName;
    const msgEl = document.getElementById('confirm-add-to-quantity-message');
    if (msgEl) msgEl.textContent = `방금 추가한 '${newTaskName}' 업무를 처리량 집계 목록에도 추가하시겠습니까?`;
    document.getElementById('confirm-add-to-quantity-modal')?.classList.remove('hidden');
}

// 현재 DOM 기준 처리량 업무 목록 가져오기 헬퍼
function getAllCurrentQuantityTasks() {
    const tasks = [];
    document.querySelectorAll('#quantity-tasks-container .quantity-task-name').forEach(el => {
        tasks.push(el.textContent.trim());
    });
    return tasks;
}

// =================================================================
// 5. 드래그 앤 드롭 (Drag & Drop)
// =================================================================
function setupAllDragListeners() {
    setupDragDropListeners('#team-groups-container', '.team-group-card');
    setupDragDropListeners('.members-container', '.member-item');
    setupDragDropListeners('#dashboard-items-container', '.dashboard-item-config');
    setupDragDropListeners('#key-tasks-container', '.key-task-item');
    setupDragDropListeners('#task-groups-container', '.task-group-card');
    setupDragDropListeners('.tasks-container', '.task-item');
    setupDragDropListeners('#quantity-tasks-container', '.quantity-task-item');
}

function setupDragDropListeners(containerSelector, itemSelector) {
    const containers = document.querySelectorAll(containerSelector);
    containers.forEach(container => {
        // 중복 리스너 방지
        if (container.dataset.dragAttached) return;
        container.dataset.dragAttached = 'true';

        container.addEventListener('dragstart', (e) => {
            if (!e.target.classList.contains('drag-handle')) { e.preventDefault(); return; }
            draggedItem = e.target.closest(itemSelector);
            if (draggedItem) {
                setTimeout(() => draggedItem.classList.add('dragging'), 0);
                e.dataTransfer.effectAllowed = 'move';
            }
        });

        container.addEventListener('dragend', (e) => {
            if (draggedItem) {
                draggedItem.classList.remove('dragging');
                draggedItem = null;
            }
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            // 순서 변경 후 필요한 경우 매핑 UI 업데이트
            if (containerSelector === '#dashboard-items-container') {
                renderQuantityToDashboardMapping(collectConfigFromDOM(appConfig));
            }
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = getDragAfterElement(container, e.clientY, itemSelector);
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            if (afterElement) afterElement.classList.add('drag-over');
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            const afterElement = getDragAfterElement(container, e.clientY, itemSelector);
            if (draggedItem) {
                if (afterElement) container.insertBefore(draggedItem, afterElement);
                else container.appendChild(draggedItem);
            }
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
    });
}

function getDragAfterElement(container, y, itemSelector) {
    const draggableElements = [...container.querySelectorAll(`${itemSelector}:not(.dragging)`)];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}