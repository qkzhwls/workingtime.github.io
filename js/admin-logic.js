// === js/admin-logic.js ===
// 설명: 관리자 페이지의 데이터 수집 및 유효성 검사 로직을 담당합니다.

import { getAllDashboardDefinitions } from './admin-ui.js';

/**
 * DOM에서 현재 입력된 모든 설정 데이터를 수집하여 객체로 반환합니다.
 * @param {Object} currentConfig - 현재 로드된 설정 객체 (커스텀 항목 참조용)
 * @returns {Object} newConfig - 수집된 새 설정 객체
 * @throws {Error} 수집 중 중복 데이터 등 치명적 오류 발생 시
 */
export function collectConfigFromDOM(currentConfig) {
    const newConfig = {
        // 1. DOM에서 수집할 항목 (초기화)
        teamGroups: [],
        memberWages: {},
        memberEmails: {},
        memberRoles: {},
        memberLeaveSettings: {}, // 연차 설정
        dashboardItems: [],
        dashboardCustomItems: {},
        quantityToDashboardMap: {},
        keyTasks: [],
        taskGroups: [],
        quantityTaskTypes: [],
        
        // 2. DOM에서 수집할 항목 (기본값)
        defaultPartTimerWage: 10000,
        revenueIncrementUnit: 10000000,
        standardMonthlyWorkHours: 209,

        // 상품 원가 및 손익 분석 설정
        fixedMaterialCost: 0,
        fixedShippingCost: 0,
        fixedDirectDeliveryCost: 0,
        costCalcTasks: [],

        // UI에서 수정하지 않는 중요 설정값 보존
        simulationTaskLinks: currentConfig.simulationTaskLinks || {},
        qualityCostTasks: currentConfig.qualityCostTasks || [],
        systemAccounts: currentConfig.systemAccounts || [],
        standardDailyWorkHours: currentConfig.standardDailyWorkHours || { weekday: 8, weekend: 4 }
    };

    const emailCheck = new Map();
    let duplicateEmailError = null;

    // 1. 팀원 그룹 및 멤버 정보 수집
    document.querySelectorAll('#team-groups-container .team-group-card').forEach(groupCard => {
        const groupNameInput = groupCard.querySelector('.team-group-name');
        const groupName = groupNameInput ? groupNameInput.value.trim() : '';
        if (!groupName) return;

        const newGroup = { name: groupName, members: [] };

        groupCard.querySelectorAll('.member-item').forEach(memberItem => {
            const memberName = memberItem.querySelector('.member-name').value.trim();
            const memberEmail = memberItem.querySelector('.member-email').value.trim();
            const memberWage = Number(memberItem.querySelector('.member-wage').value) || 0;
            const memberRole = memberItem.querySelector('.member-role').value || 'user';

            const joinDate = memberItem.querySelector('.member-join-date').value;
            const totalLeave = Number(memberItem.querySelector('.member-total-leave').value) || 0;
            
            // ✅ [신규] 연차 적용 시작일 및 만료일 수집
            const leaveResetDate = memberItem.querySelector('.member-leave-reset-date').value;
            const expirationDate = memberItem.querySelector('.member-leave-expiration-date').value;

            if (!memberName) return;

            newGroup.members.push(memberName);
            newConfig.memberWages[memberName] = memberWage;

            // 연차 설정 저장
            newConfig.memberLeaveSettings[memberName] = {
                joinDate: joinDate,
                totalLeave: totalLeave,
                leaveResetDate: leaveResetDate, // ✅ 추가
                expirationDate: expirationDate  // ✅ 추가
            };

            if (memberEmail) {
                const emailLower = memberEmail.toLowerCase();
                if (emailCheck.has(emailLower) && emailCheck.get(emailLower) !== memberName) {
                    duplicateEmailError = memberEmail;
                }
                emailCheck.set(emailLower, memberName);
                newConfig.memberEmails[memberName] = memberEmail;
                newConfig.memberRoles[emailLower] = memberRole;
            }
        });
        newConfig.teamGroups.push(newGroup);
    });

    if (duplicateEmailError) {
        throw new Error(`이메일 주소 '${duplicateEmailError}'가 중복 할당되었습니다. 각 팀원의 이메일은 고유해야 합니다.`);
    }

    // 2. 현황판 항목 수집
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

    // 3. 주요 업무 수집
    document.querySelectorAll('#key-tasks-container .key-task-item').forEach(item => {
        const nameEl = item.querySelector('.key-task-name');
        if (nameEl) newConfig.keyTasks.push(nameEl.textContent.trim());
    });

    // 4. 업무 그룹 수집
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

    // 5. 처리량 집계 업무 수집
    document.querySelectorAll('#quantity-tasks-container .quantity-task-item').forEach(item => {
        const nameEl = item.querySelector('.quantity-task-name');
        if (nameEl) newConfig.quantityTaskTypes.push(nameEl.textContent.trim());
    });

    // 6. 기타 단일 값 설정 수집
    const wageInput = document.getElementById('default-part-timer-wage');
    if (wageInput) newConfig.defaultPartTimerWage = Number(wageInput.value) || 10000;

    const revenueUnitInput = document.getElementById('revenue-increment-unit');
    if (revenueUnitInput) newConfig.revenueIncrementUnit = Number(revenueUnitInput.value) || 10000000;

    const workHoursInput = document.getElementById('standard-monthly-work-hours');
    if (workHoursInput) newConfig.standardMonthlyWorkHours = Number(workHoursInput.value) || 209;

    // 상품 원가 및 손익 분석 설정 수집
    const materialCostInput = document.getElementById('fixed-material-cost');
    if (materialCostInput) newConfig.fixedMaterialCost = Number(materialCostInput.value) || 0;

    const shippingCostInput = document.getElementById('fixed-shipping-cost');
    if (shippingCostInput) newConfig.fixedShippingCost = Number(shippingCostInput.value) || 0;
    
    const directDeliveryCostInput = document.getElementById('fixed-direct-delivery-cost');
    if (directDeliveryCostInput) newConfig.fixedDirectDeliveryCost = Number(directDeliveryCostInput.value) || 0;

    // 체크박스로 선택된 업무들 수집
    document.querySelectorAll('.cost-calc-task-checkbox:checked').forEach(checkbox => {
        newConfig.costCalcTasks.push(checkbox.value);
    });

    // 7. 처리량-현황판 매핑 정보 수집
    document.querySelectorAll('#quantity-mapping-container .mapping-row').forEach(row => {
        const taskName = row.dataset.taskName;
        const select = row.querySelector('.dashboard-mapping-select');
        if (taskName && select && select.value) {
            newConfig.quantityToDashboardMap[taskName] = select.value;
        }
    });

    return newConfig;
}

/**
 * 수집된 설정 객체의 정합성을 검사합니다.
 * @param {Object} newConfig - 검사할 설정 객체
 * @throws {Error} 유효성 검사 실패 시 에러 메시지 포함
 */
export function validateConfig(newConfig) {
    // 모든 등록된 업무 목록 생성 (소문자로 변환하여 비교)
    const allTaskNames = new Set(
        newConfig.taskGroups.flatMap(group => group.tasks).map(t => t.trim().toLowerCase())
    );

    // '주요 업무', '처리량 업무', '원가 계산 업무'가 '업무 관리'에 실제로 존재하는지 확인
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

    return true; // 유효성 검사 통과
}