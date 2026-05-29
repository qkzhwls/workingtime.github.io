// === js/admin-logic.js ===
import { getAllDashboardDefinitions } from './admin-ui.js';

export function collectConfigFromDOM(currentConfig) {
    const newConfig = {
        dashboardMenu: [],
        teamGroups: [],
        memberWages: {},
        memberEmails: {},
        memberRoles: {},
        memberMenuAccess: {}, // ✨ 신규 권한 객체
        memberRanks: {}, 
        memberLeaveSettings: {},
        systemAccounts: [], 
        dashboardItems: [],
        dashboardCustomItems: {},
        quantityToDashboardMap: {},
        keyTasks: [],
        taskGroups: [],
        quantityTaskTypes: [],
        
        defaultPartTimerWage: 10000,
        revenueIncrementUnit: 10000000,
        standardMonthlyWorkHours: 209,

        fixedMaterialCost: 0,
        fixedShippingCost: 0,
        fixedDirectDeliveryCost: 0,
        costCalcTasks: [],

        simulationTaskLinks: currentConfig.simulationTaskLinks || {},
        qualityCostTasks: currentConfig.qualityCostTasks || [],
        systemAccountsOld: currentConfig.systemAccounts || [], 
        standardDailyWorkHours: currentConfig.standardDailyWorkHours || { weekday: 8, weekend: 4 }
    };

    const emailCheck = new Map();
    let duplicateEmailError = null;

    document.querySelectorAll('#menu-categories-container .menu-category-card').forEach(categoryCard => {
        const categoryNameInput = categoryCard.querySelector('.menu-category-name');
        const categoryName = categoryNameInput ? categoryNameInput.value.trim() : '';
        if (!categoryName) return;
        
        const items = [];
        categoryCard.querySelectorAll('.menu-item').forEach(itemEl => {
            const itemName = itemEl.querySelector('.menu-item-name')?.value.trim();
            const itemLink = itemEl.querySelector('.menu-item-link')?.value.trim();
            if (itemName) {
                items.push({ name: itemName, link: itemLink });
            }
        });
        newConfig.dashboardMenu.push({ category: categoryName, items: items });
    });

    document.querySelectorAll('#team-groups-container .team-group-card').forEach(groupCard => {
        const groupNameInput = groupCard.querySelector('.team-group-name');
        const groupName = groupNameInput ? groupNameInput.value.trim() : '';
        if (!groupName) return;

        const newGroup = { name: groupName, members: [] };

        groupCard.querySelectorAll('.member-item').forEach(memberItem => {
            const memberName = memberItem.querySelector('.member-name').value.trim();
            const memberEmail = memberItem.querySelector('.member-email').value.trim();
            const memberWage = Number(memberItem.querySelector('.member-wage').value) || 0;
            const memberRank = memberItem.querySelector('.member-rank')?.value || '사원'; 

            const joinDate = memberItem.querySelector('.member-join-date').value;
            const totalLeave = Number(memberItem.querySelector('.member-total-leave').value) || 0;
            const leaveResetDate = memberItem.querySelector('.member-leave-reset-date').value;
            const expirationDate = memberItem.querySelector('.member-leave-expiration-date').value;

            if (!memberName) return;

            newGroup.members.push(memberName);
            newConfig.memberWages[memberName] = memberWage;
            newConfig.memberRanks[memberName] = memberRank; 

            newConfig.memberLeaveSettings[memberName] = {
                joinDate: joinDate,
                totalLeave: totalLeave,
                leaveResetDate: leaveResetDate,
                expirationDate: expirationDate 
            };

            if (memberEmail) {
                const emailLower = memberEmail.toLowerCase();
                if (emailCheck.has(emailLower) && emailCheck.get(emailLower) !== memberName) {
                    duplicateEmailError = memberEmail;
                }
                emailCheck.set(emailLower, memberName);
                newConfig.memberEmails[memberName] = memberEmail;
            }
        });
        newConfig.teamGroups.push(newGroup);
    });

    document.querySelectorAll('#system-accounts-container .system-account-item').forEach(item => {
        const name = item.querySelector('.sys-name').value.trim();
        const email = item.querySelector('.sys-email').value.trim();

        if (name && email) {
            newConfig.systemAccounts.push({ name, email });
            const emailLower = email.toLowerCase();
            if (emailCheck.has(emailLower) && emailCheck.get(emailLower) !== name) {
                duplicateEmailError = email;
            }
            emailCheck.set(emailLower, name);
        }
    });

    if (duplicateEmailError) {
        throw new Error(`이메일 주소 '${duplicateEmailError}'가 중복 할당되었습니다. 모든 팀원 및 시스템 계정의 이메일은 고유해야 합니다.`);
    }

    // ✨ 신규: 새 권한 섹션(permissions-container)에서 권한 및 접근 정보 수집
    document.querySelectorAll('#permissions-container .permission-item').forEach(item => {
        const email = item.dataset.email;
        const role = item.querySelector('.perm-role').value;
        newConfig.memberRoles[email] = role;
        
        if (role === 'user') {
            const allowed = [];
            item.querySelectorAll('.perm-menu-checkbox:checked').forEach(cb => {
                allowed.push(cb.value);
            });
            newConfig.memberMenuAccess[email] = allowed;
        } else {
            // 관리자는 제한 없음
            newConfig.memberMenuAccess[email] = [];
        }
    });

    // 💡 방금 막 새로 추가되어 권한 섹션에 나타나지 않은 사용자에 대한 기본값(일반, 전체메뉴접근) 부여
    const allMenus = [];
    newConfig.dashboardMenu.forEach(c => c.items.forEach(i => allMenus.push(i.name)));
    
    Array.from(emailCheck.keys()).forEach(email => {
        if (!newConfig.memberRoles[email]) {
            newConfig.memberRoles[email] = 'user';
            newConfig.memberMenuAccess[email] = allMenus; // 기본적으로 모든 메뉴 허용
        }
    });

    const allDefinitions = getAllDashboardDefinitions(currentConfig);
    document.querySelectorAll('#dashboard-items-container .dashboard-item-config').forEach(item => {
        const nameSpan = item.querySelector('.dashboard-item-name');
        if (nameSpan) {
            const id = nameSpan.dataset.id;
            newConfig.dashboardItems.push(id);
            
            if (id.startsWith('custom-') && allDefinitions[id]) {
                newConfig.dashboardCustomItems[id] = {
                    title: allDefinitions[id].title,
                    isQuantity: true
                };
            }
        }
    });

    document.querySelectorAll('#key-tasks-container .key-task-item').forEach(item => {
        const nameEl = item.querySelector('.key-task-name');
        if (nameEl) newConfig.keyTasks.push(nameEl.textContent.trim());
    });

    document.querySelectorAll('#task-groups-container .task-group-card').forEach(groupCard => {
        const groupNameInput = groupCard.querySelector('.task-group-name');
        const groupName = groupNameInput ? groupNameInput.value.trim() : '';
        if (!groupName) return;
        
        const tasks = [];
        groupCard.querySelectorAll('.task-item').forEach(taskItem => {
            const taskNameInput = taskItem.querySelector('.task-name');
            if (taskNameInput) tasks.push(taskNameInput.value.trim());
        });
        newConfig.taskGroups.push({ name: groupName, tasks: tasks });
    });

    document.querySelectorAll('#quantity-tasks-container .quantity-task-item').forEach(item => {
        const nameEl = item.querySelector('.quantity-task-name');
        if (nameEl) newConfig.quantityTaskTypes.push(nameEl.textContent.trim());
    });

    const wageInput = document.getElementById('default-part-timer-wage');
    if (wageInput) newConfig.defaultPartTimerWage = Number(wageInput.value) || 10000;

    const revenueUnitInput = document.getElementById('revenue-increment-unit');
    if (revenueUnitInput) newConfig.revenueIncrementUnit = Number(revenueUnitInput.value) || 10000000;

    const workHoursInput = document.getElementById('standard-monthly-work-hours');
    if (workHoursInput) newConfig.standardMonthlyWorkHours = Number(workHoursInput.value) || 209;

    const materialCostInput = document.getElementById('fixed-material-cost');
    if (materialCostInput) newConfig.fixedMaterialCost = Number(materialCostInput.value) || 0;

    const shippingCostInput = document.getElementById('fixed-shipping-cost');
    if (shippingCostInput) newConfig.fixedShippingCost = Number(shippingCostInput.value) || 0;
    
    const directDeliveryCostInput = document.getElementById('fixed-direct-delivery-cost');
    if (directDeliveryCostInput) newConfig.fixedDirectDeliveryCost = Number(directDeliveryCostInput.value) || 0;

    document.querySelectorAll('.cost-calc-task-checkbox:checked').forEach(checkbox => {
        newConfig.costCalcTasks.push(checkbox.value);
    });

    document.querySelectorAll('#quantity-mapping-container .mapping-row').forEach(row => {
        const taskName = row.dataset.taskName;
        const select = row.querySelector('.dashboard-mapping-select');
        if (taskName && select && select.value) {
            newConfig.quantityToDashboardMap[taskName] = select.value;
        }
    });

    return newConfig;
}

export function validateConfig(newConfig) {
    const allTaskNames = new Set(
        newConfig.taskGroups.flatMap(group => group.tasks).map(t => t.trim().toLowerCase())
    );

    const invalidKeyTasks = newConfig.keyTasks.filter(task => !allTaskNames.has(task.trim().toLowerCase()));
    const invalidQuantityTasks = newConfig.quantityTaskTypes.filter(task => !allTaskNames.has(task.trim().toLowerCase()));
    const invalidCostTasks = newConfig.costCalcTasks.filter(task => !allTaskNames.has(task.trim().toLowerCase()));

    if (invalidKeyTasks.length > 0 || invalidQuantityTasks.length > 0 || invalidCostTasks.length > 0) {
        let errorMsg = "[저장 실패] '업무 관리' 목록에 존재하지 않는 업무 이름이 포함되어 있습니다.\n\n";
        if (invalidKeyTasks.length > 0) {
            errorMsg += `▶ 주요 업무 오류:\n- ${invalidKeyTasks.join('\n- ')}\n\n`;
        }
        if (invalidQuantityTasks.length > 0) {
            errorMsg += `▶ 처리량 집계 오류:\n- ${invalidQuantityTasks.join('\n- ')}\n\n`;
        }
        if (invalidCostTasks.length > 0) {
            errorMsg += `▶ 원가 계산 업무 오류:\n- ${invalidCostTasks.join('\n- ')}\n\n`;
        }
        errorMsg += "오타를 수정하거나 '업무 관리' 섹션에 해당 업무를 먼저 추가해주세요.";
        throw new Error(errorMsg);
    }

    return true; 
}