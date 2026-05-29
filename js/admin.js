// === js/admin.js ===
import { initializeFirebase, loadAppConfig, saveAppConfig } from './config.js';
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    renderAdminUI,
    renderKeyTasks,
    renderQuantityTasks,
    renderDashboardItemsConfig,
    renderQuantityToDashboardMapping,
    populateTaskSelectModal,
    openDashboardItemModal,
    getAllDashboardDefinitions,
    renderDashboardMenu
} from './admin-ui.js';

import {
    collectConfigFromDOM,
    validateConfig
} from './admin-logic.js';

let db, auth;
let appConfig = {}; 

let draggedItem = null;
let currentModalTarget = null;
let taskJustAdded = null;

document.addEventListener('DOMContentLoaded', () => {
    const adminContent = document.getElementById('admin-content');

    try {
        const firebase = initializeFirebase();
        db = firebase.db;
        auth = firebase.auth;
    } catch (e) {
        console.error(e);
        if (adminContent) {
            adminContent.innerHTML = `<div class="flex justify-center items-center h-full"><h2 class="text-2xl font-bold text-red-600 bg-red-50 p-6 rounded-2xl">Firebase 초기화 실패.</h2></div>`;
            adminContent.classList.remove('hidden');
        }
        return;
    }

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            try {
                appConfig = await loadAppConfig(db);

                const userEmailLower = (user.email || '').toLowerCase();
                const memberRoles = appConfig.memberRoles || {};
                const currentUserRole = memberRoles[userEmailLower] || 'user';

                if (currentUserRole === 'admin') {
                    renderAdminUI(appConfig);
                    setupEventListeners();
                    if (adminContent) adminContent.classList.remove('hidden');
                } else {
                    if (adminContent) {
                         adminContent.innerHTML = `<div class="flex justify-center items-center h-full mt-20"><div class="text-center bg-white dark:bg-gray-800 p-10 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700"><span class="text-4xl mb-4 block">🚫</span><h2 class="text-xl font-bold text-gray-800 dark:text-white mb-2">접근 권한이 없습니다</h2><p class="text-gray-500 dark:text-gray-400 text-sm">관리자 계정으로 로그인해주세요.</p></div></div>`;
                         adminContent.classList.remove('hidden');
                    }
                }
            } catch (e) {
                console.error("초기화 중 오류:", e);
                alert(`초기화 중 오류가 발생했습니다: ${e.message}`);
            }
        } else {
             if (adminContent) {
                adminContent.innerHTML = `<div class="flex justify-center items-center h-full mt-20"><div class="text-center bg-white dark:bg-gray-800 p-10 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700"><span class="text-4xl mb-4 block">🔒</span><h2 class="text-xl font-bold text-gray-800 dark:text-white mb-4">로그인이 필요합니다</h2><a href="index.html" class="inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">메인 앱으로 이동</a></div></div>`;
                adminContent.classList.remove('hidden');
             }
        }
    });
});

function setupEventListeners() {
    document.getElementById('save-all-btn')?.addEventListener('click', handleSaveAll);
    
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.dataset.modalId;
            if (modalId) {
                const modal = document.getElementById(modalId);
                if (modal) modal.classList.add('hidden');
            }
        });
    });

    document.body.addEventListener('change', (e) => {
        if (e.target.classList.contains('perm-role')) {
            const listContainer = e.target.closest('.permission-item').querySelector('.perm-menu-list');
            const checkboxes = listContainer.querySelectorAll('.perm-menu-checkbox');
            
            if (e.target.value === 'admin') {
                listContainer.classList.add('opacity-40', 'pointer-events-none');
                checkboxes.forEach(cb => cb.disabled = true);
            } else {
                listContainer.classList.remove('opacity-40', 'pointer-events-none');
                checkboxes.forEach(cb => cb.disabled = false);
            }
        }
    });
    
    document.getElementById('add-menu-category-btn')?.addEventListener('click', () => {
        const container = document.getElementById('menu-categories-container');
        if (!container) return;
        const groupEl = document.createElement('div');
        groupEl.className = 'p-5 border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-800 shadow-sm menu-category-card transition-colors drop-zone';
        groupEl.innerHTML = `
            <div class="flex justify-between items-center mb-5 pb-3 border-b border-gray-100 dark:border-gray-700">
                <div class="flex items-center gap-2"> 
                   <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move text-lg" draggable="true">☰</span>
                   <input type="text" value="새 대분류" class="text-lg font-extrabold text-gray-800 dark:text-white menu-category-name w-auto bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 p-1 outline-none" placeholder="대분류 이름">
                 </div>
                <button class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-1.5 rounded-md transition delete-menu-category-btn" type="button">대분류 삭제</button>
            </div>
            <div class="space-y-2 menu-items-container min-h-[60px] p-2 -mx-2 rounded-lg border-2 border-transparent border-dashed hover:border-gray-300 dark:hover:border-gray-600 transition-colors"></div>
            <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                <button class="text-sm bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 font-bold px-4 py-2 rounded-lg transition shadow-sm add-menu-item-btn" type="button">+ 소분류 추가</button>
            </div>
        `;
        container.appendChild(groupEl);
        setupDragDropListeners('.menu-items-container', '.menu-item');
        setupDragDropListeners('#menu-categories-container', '.menu-category-card');
    });

    document.getElementById('add-team-group-btn')?.addEventListener('click', addTeamGroup);
    document.getElementById('add-task-group-btn')?.addEventListener('click', addTaskGroup);
    document.getElementById('add-dashboard-item-btn')?.addEventListener('click', () => openDashboardItemModal(appConfig));
    document.getElementById('add-custom-dashboard-item-btn')?.addEventListener('click', addCustomDashboardItem);

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
            
            renderDashboardItemsConfig(appConfig.dashboardItems, appConfig);
            renderQuantityToDashboardMapping(appConfig);
            
            document.getElementById('select-dashboard-item-modal')?.classList.add('hidden');
        }
    });

    document.getElementById('confirm-add-to-quantity-btn')?.addEventListener('click', () => {
        if (taskJustAdded) addQuantityTask(taskJustAdded);
        document.getElementById('confirm-add-to-quantity-modal')?.classList.add('hidden');
        taskJustAdded = null;
    });
    document.getElementById('cancel-add-to-quantity-btn')?.addEventListener('click', () => {
        document.getElementById('confirm-add-to-quantity-modal')?.classList.add('hidden');
        taskJustAdded = null;
    });

    document.body.addEventListener('click', handleDynamicClicks);
    setupAllDragListeners();
}

async function handleSaveAll() {
    const btn = document.getElementById('save-all-btn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    try {
        const newConfig = collectConfigFromDOM(appConfig);
        validateConfig(newConfig);
        await saveAppConfig(db, newConfig);
        
        appConfig = newConfig;
        alert('✅ 모든 변경사항이 성공적으로 저장되었습니다!');
        
        renderAdminUI(appConfig);
        setupAllDragListeners(); 

    } catch (e) {
        console.error("저장 실패:", e);
        alert(`❌ 저장 실패:\n${e.message}`);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = `<svg class="w-4 h-4 inline-block -mt-1 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg> 전체 저장`; }
    }
}

function addKeyTask(taskName) {
    const nameToAdd = taskName || '새 주요 업무';
    if (!appConfig.keyTasks) appConfig.keyTasks = [];

    if (appConfig.keyTasks.some(t => t.trim().toLowerCase() === nameToAdd.trim().toLowerCase())) {
        alert("이미 등록된 업무입니다.");
        return;
    }
    appConfig.keyTasks.push(nameToAdd);
    renderKeyTasks(appConfig.keyTasks);
}

function addQuantityTask(taskName) {
    const nameToAdd = taskName || '새 처리량 업무';
    if (!appConfig.quantityTaskTypes) appConfig.quantityTaskTypes = [];

    if (appConfig.quantityTaskTypes.some(t => t.trim().toLowerCase() === nameToAdd.trim().toLowerCase())) {
        if (taskJustAdded === taskName) return; 
        alert("이미 등록된 업무입니다.");
        return;
    }
    appConfig.quantityTaskTypes.push(nameToAdd);
    renderQuantityTasks(appConfig.quantityTaskTypes);
    renderQuantityToDashboardMapping(appConfig);
}

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

function addTeamGroup() {
    const container = document.getElementById('team-groups-container');
    if (!container) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'p-5 border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-800 shadow-sm team-group-card transition-colors';
    groupEl.innerHTML = `
        <div class="flex justify-between items-center mb-5 pb-3 border-b border-gray-100 dark:border-gray-700">
            <div class="flex items-center gap-2">
                <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span> 
                <input type="text" value="새 그룹" class="text-lg font-extrabold text-gray-800 dark:text-white team-group-name w-auto bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 p-1">
            </div>
            <button class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-1.5 rounded-md transition delete-team-group-btn">그룹 삭제</button>
        </div>
        <div class="space-y-3 members-container"></div>
        <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 text-center">
            <button class="text-sm bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 font-bold px-4 py-2 rounded-lg transition w-full md:w-auto shadow-sm add-member-btn">+ 팀원 추가</button>
        </div>
    `;
    container.appendChild(groupEl);
    setupDragDropListeners('.members-container', '.member-item'); 
}

function addTaskGroup() {
    const container = document.getElementById('task-groups-container');
    if (!container) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'p-5 border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-800 shadow-sm task-group-card transition-colors';
    groupEl.innerHTML = `
         <div class="flex justify-between items-center mb-5 pb-3 border-b border-gray-100 dark:border-gray-700">
            <div class="flex items-center gap-2"> 
               <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span>
               <input type="text" value="새 업무 그룹" class="text-lg font-extrabold text-gray-800 dark:text-white task-group-name w-auto bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 p-1">
             </div>
            <button class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-1.5 rounded-md transition delete-task-group-btn">그룹 삭제</button>
        </div>
        <div class="space-y-2 tasks-container grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2"></div>
        <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
            <button class="text-sm bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 font-bold px-4 py-2 rounded-lg transition shadow-sm add-task-btn">+ 업무 추가</button>
        </div>
    `;
    container.appendChild(groupEl);
    setupDragDropListeners('.tasks-container', '.task-item');
}

function handleDynamicClicks(e) {
    // ✨ 신규: 전체 체크 / 전체 해제 버튼 로직 추가
    if (e.target.classList.contains('select-all-menu-btn')) {
        e.target.closest('.permission-item').querySelectorAll('.perm-menu-checkbox').forEach(cb => cb.checked = true);
    }
    else if (e.target.classList.contains('deselect-all-menu-btn')) {
        e.target.closest('.permission-item').querySelectorAll('.perm-menu-checkbox').forEach(cb => cb.checked = false);
    }

    else if (e.target.classList.contains('delete-member-btn')) e.target.closest('.member-item')?.remove();
    else if (e.target.classList.contains('delete-team-group-btn')) e.target.closest('.team-group-card')?.remove();
    else if (e.target.classList.contains('delete-key-task-btn')) e.target.closest('.key-task-item')?.remove();
    else if (e.target.classList.contains('delete-task-btn')) e.target.closest('.task-item')?.remove();
    else if (e.target.classList.contains('delete-task-group-btn')) e.target.closest('.task-group-card')?.remove();
    else if (e.target.classList.contains('delete-quantity-task-btn')) {
        e.target.closest('.quantity-task-item')?.remove();
        renderQuantityToDashboardMapping({ ...appConfig, quantityTaskTypes: getAllCurrentQuantityTasks() });
    }
    else if (e.target.classList.contains('delete-dashboard-item-btn')) {
        e.target.closest('.dashboard-item-config')?.remove();
        setTimeout(() => renderQuantityToDashboardMapping(collectConfigFromDOM(appConfig)), 0);
    }
    
    else if (e.target.classList.contains('delete-menu-item-btn')) {
        e.target.closest('.menu-item')?.remove();
    }
    else if (e.target.classList.contains('delete-menu-category-btn')) {
        if(confirm('이 대분류와 포함된 모든 메뉴를 삭제하시겠습니까?')) {
            e.target.closest('.menu-category-card')?.remove();
        }
    }
    
    else if (e.target.classList.contains('delete-sys-account-btn')) {
        e.target.closest('.system-account-item')?.remove();
    }
    else if (e.target.closest('#add-system-account-btn')) {
        const container = document.getElementById('system-accounts-container');
        if (!container) return;
        
        const item = document.createElement('div');
        item.className = 'system-account-item flex flex-wrap md:flex-nowrap items-end gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 transition-colors';
        item.innerHTML = `
            <div class="flex flex-col flex-1 min-w-[150px]">
                <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold mb-1">계정 이름 (별칭)</label>
                <input type="text" class="sys-name p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm font-bold dark:text-white outline-none focus:border-blue-500" placeholder="예: 외부 관리자">
            </div>
            <div class="flex flex-col flex-1 min-w-[200px]">
                <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold mb-1">이메일 (로그인 ID)</label>
                <input type="email" class="sys-email p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm dark:text-white outline-none focus:border-blue-500" placeholder="admin@example.com">
            </div>
            <button type="button" class="delete-sys-account-btn w-full md:w-auto text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-4 py-2.5 rounded-md md:h-[38px] transition-colors shadow-sm">삭제</button>
        `;
        container.appendChild(item);
    }

    else if (e.target.classList.contains('add-menu-item-btn')) {
        const container = e.target.closest('.menu-category-card').querySelector('.menu-items-container');
        const newItemEl = document.createElement('div');
        newItemEl.className = 'flex items-center justify-between p-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:border-blue-300 dark:hover:border-blue-500 transition-colors menu-item group shadow-sm';
        newItemEl.innerHTML = `
            <div class="flex items-center gap-3 flex-grow">
                <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span>
                <input type="text" value="" class="menu-item-name flex-grow p-1.5 bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 text-sm font-semibold dark:text-white outline-none" placeholder="새 메뉴 이름">
                <input type="text" value="" class="menu-item-link w-1/3 p-1.5 bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 text-xs text-gray-500 dark:text-gray-400 outline-none" placeholder="연결 링크 (예: index.html)">
            </div>
            <button class="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 font-bold px-2 py-1 rounded transition delete-menu-item-btn opacity-0 group-hover:opacity-100" type="button">삭제</button>
        `;
        container.appendChild(newItemEl);
        newItemEl.querySelector('.menu-item-name')?.focus();
    }

    else if (e.target.classList.contains('add-member-btn')) {
        const container = e.target.closest('.team-group-card').querySelector('.members-container');
        const defaultWage = document.getElementById('default-part-timer-wage')?.value || 10000;
        const newMemberEl = document.createElement('div');
        newMemberEl.className = 'flex flex-col gap-3 mb-4 p-4 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/30 shadow-sm member-item transition-colors';
        
        const today = new Date().toISOString().split('T')[0];

        newMemberEl.innerHTML = `
            <div class="flex flex-wrap md:flex-nowrap justify-between items-start gap-4">
                <div class="flex flex-wrap items-center gap-3 w-full md:w-auto">
                    <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span>
                    <div class="flex flex-col">
                        <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold mb-1">이름</label>
                        <input type="text" value="새 팀원" class="member-name w-24 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm font-bold dark:text-white">
                    </div>

                    <div class="flex flex-col">
                        <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold mb-1">직급</label>
                        <select class="member-rank w-20 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm font-bold dark:text-white">
                            <option value="사원" selected>사원</option>
                            <option value="주임">주임</option>
                            <option value="대리">대리</option>
                            <option value="과장">과장</option>
                            <option value="차장">차장</option>
                            <option value="부장">부장</option>
                            <option value="이사">이사</option>
                            <option value="상무">상무</option>
                            <option value="전무">전무</option>
                            <option value="사장">사장</option>
                            <option value="대표">대표</option>
                        </select>
                    </div>

                    <div class="flex flex-col">
                        <label class="text-[10px] text-gray-500 dark:text-gray-400 mb-1">이메일</label>
                        <input type="email" value="" class="member-email w-48 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm dark:text-white" placeholder="example@email.com">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-[10px] text-gray-500 dark:text-gray-400 mb-1">시급</label>
                        <input type="number" value="${defaultWage}" class="member-wage w-24 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm dark:text-white">
                    </div>
                </div>
                <button class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-2 rounded-md transition delete-member-btn">삭제</button>
            </div>
            
            <div class="flex flex-wrap items-center gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <span class="text-xs font-bold text-blue-600 dark:text-blue-400 w-full md:w-auto mb-2 md:mb-0">🏖️ 연차 설정</span>
                <div class="flex flex-col">
                    <label class="text-[9px] text-blue-600 dark:text-blue-400 mb-1">입사일자</label>
                    <input type="date" value="${today}" class="member-join-date w-32 p-1.5 border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800 rounded text-xs dark:text-gray-200">
                </div>
                <div class="flex flex-col">
                    <label class="text-[9px] text-blue-600 dark:text-blue-400 mb-1">총연차(일)</label>
                    <input type="number" value="15" class="member-total-leave w-16 p-1.5 border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800 rounded text-xs text-center dark:text-gray-200" min="0">
                </div>
                <div class="hidden md:block w-px h-8 bg-gray-300 dark:bg-gray-600 mx-2"></div>
                <div class="flex flex-col">
                    <label class="text-[9px] text-gray-500 dark:text-gray-400 mb-1 font-bold">적용 시작일</label>
                    <input type="date" value="${today}" class="member-leave-reset-date w-32 p-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded text-xs font-bold text-gray-700 dark:text-gray-200">
                </div>
                <div class="flex flex-col">
                    <label class="text-[9px] text-red-500 dark:text-red-400 mb-1 font-bold">사용 만료일</label>
                    <input type="date" value="" class="member-leave-expiration-date w-32 p-1.5 border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 rounded text-xs text-red-700 dark:text-red-400">
                </div>
            </div>
        `;
        container.appendChild(newMemberEl);
    }
    else if (e.target.classList.contains('add-task-btn')) {
        const container = e.target.closest('.task-group-card').querySelector('.tasks-container');
        const newTaskEl = document.createElement('div');
        newTaskEl.className = 'flex items-center justify-between p-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-500 transition-colors task-item group shadow-sm';
        newTaskEl.innerHTML = `
            <div class="flex items-center gap-2 flex-grow">
                <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span>
                <input type="text" value="새 업무" class="task-name flex-grow p-1.5 bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 text-sm font-semibold dark:text-white outline-none">
            </div>
            <button class="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 font-bold px-2 py-1 rounded transition delete-task-btn opacity-0 group-hover:opacity-100">삭제</button>
        `;
        container.appendChild(newTaskEl);
        
        const input = newTaskEl.querySelector('.task-name');
        if (input) {
            input.focus();
            input.addEventListener('blur', handleNewTaskNameBlur, { once: true });
        }
    }

    const toggleBtn = e.target.closest('.config-card-toggle');
    if (toggleBtn) {
        const card = toggleBtn.closest('.config-card');
        card.querySelector('.config-card-content')?.classList.toggle('hidden');
        toggleBtn.querySelector('svg')?.classList.toggle('arrow-rotated');
    }
}

function handleNewTaskNameBlur(e) {
    const newTaskName = e.target.value.trim();
    if (!newTaskName || newTaskName === '새 업무') return;

    const currentQuantityTasks = getAllCurrentQuantityTasks();
    if (currentQuantityTasks.some(t => t.toLowerCase() === newTaskName.toLowerCase())) return;

    taskJustAdded = newTaskName;
    const msgEl = document.getElementById('confirm-add-to-quantity-message');
    if (msgEl) msgEl.textContent = `방금 추가한 '${newTaskName}' 업무를 처리량 집계 목록에도 추가하시겠습니까?`;
    document.getElementById('confirm-add-to-quantity-modal')?.classList.remove('hidden');
}

function getAllCurrentQuantityTasks() {
    const tasks = [];
    document.querySelectorAll('#quantity-tasks-container .quantity-task-name').forEach(el => {
        tasks.push(el.textContent.trim());
    });
    return tasks;
}

function setupAllDragListeners() {
    setupDragDropListeners('#team-groups-container', '.team-group-card');
    setupDragDropListeners('.members-container', '.member-item');
    setupDragDropListeners('#dashboard-items-container', '.dashboard-item-config');
    setupDragDropListeners('#key-tasks-container', '.key-task-item');
    setupDragDropListeners('#task-groups-container', '.task-group-card');
    setupDragDropListeners('.tasks-container', '.task-item');
    setupDragDropListeners('#quantity-tasks-container', '.quantity-task-item');
    setupDragDropListeners('#menu-categories-container', '.menu-category-card');
    setupDragDropListeners('.menu-items-container', '.menu-item');
}

function setupDragDropListeners(containerSelector, itemSelector) {
    const containers = document.querySelectorAll(containerSelector);
    containers.forEach(container => {
        if (container.dataset.dragAttached) return;
        container.dataset.dragAttached = 'true';

        container.addEventListener('dragstart', (e) => {
            if (!e.target.classList.contains('drag-handle')) return;
            if (draggedItem) return; 

            const item = e.target.closest(itemSelector);
            if (item) {
                draggedItem = item;
                setTimeout(() => { if (draggedItem) draggedItem.classList.add('dragging'); }, 0);
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setDragImage(item, 20, 20); } catch(err) {} 
            }
        });

        container.addEventListener('dragend', (e) => {
            if (draggedItem && draggedItem.matches(itemSelector)) {
                draggedItem.classList.remove('dragging');
                draggedItem = null;
                container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
                if (containerSelector === '#dashboard-items-container') {
                    renderQuantityToDashboardMapping(collectConfigFromDOM(appConfig));
                }
            }
        });

        container.addEventListener('dragover', (e) => {
            if (!draggedItem || !draggedItem.matches(itemSelector)) return;
            e.preventDefault(); 
            
            const afterElement = getDragAfterElement(container, e.clientY, itemSelector);
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            if (afterElement) afterElement.classList.add('drag-over');
        });

        container.addEventListener('drop', (e) => {
            if (!draggedItem || !draggedItem.matches(itemSelector)) return;
            e.preventDefault();
            e.stopPropagation(); 
            
            const afterElement = getDragAfterElement(container, e.clientY, itemSelector);
            if (afterElement) container.insertBefore(draggedItem, afterElement);
            else container.appendChild(draggedItem);
            
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