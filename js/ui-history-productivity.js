// === js/ui-history-productivity.js ===
import * as State from './state.js';

let productivityChartInstance = null;

export function renderProductivityTab(filteredData, appConfig) {
    const taskTypes = ['국내배송', '중국제작', '직진배송'];
    
    // 각 파트별 유니크 작업자 집계를 위해 Set 객체 추가
    const summary = {
        '종합': { duration: 0, qty: 0, members: new Set() },
        '국내배송': { duration: 0, qty: 0, members: new Set() },
        '중국제작': { duration: 0, qty: 0, members: new Set() },
        '직진배송': { duration: 0, qty: 0, members: new Set() }
    };

    const wageMap = { ...(appConfig.memberWages || {}) };
    let nonWorkDurationMin = 0;
    let nonWorkActualMin = 0; // 추가: 인당 비업무시간
    let nonWorkCost = 0;

    filteredData.forEach(day => {
        let dayTotalWork = 0;
        
        (day.workRecords || []).forEach(r => {
            dayTotalWork += (r.duration || 0);
            
            const matchedType = taskTypes.find(t => (r.taskType && r.taskType.includes(t)) || (r.task && r.task.includes(t)));
            if (matchedType) {
                summary[matchedType].duration += (r.duration || 0);
                if (r.member) summary[matchedType].members.add(r.member);
            }
            summary['종합'].duration += (r.duration || 0);
            if (r.member) summary['종합'].members.add(r.member);
        });

        Object.entries(day.taskQuantities || {}).forEach(([taskKey, qty]) => {
            const numQty = Number(qty) || 0;
            const matchedType = taskTypes.find(t => taskKey.includes(t));
            if (matchedType) {
                summary[matchedType].qty += numQty;
            }
            summary['종합'].qty += numQty;
        });

        const uniqueMembers = new Set((day.workRecords || []).map(r => r.member));
        const potentialMinutes = uniqueMembers.size * 480;
        
        if (potentialMinutes > dayTotalWork) {
            const loss = potentialMinutes - dayTotalWork;
            nonWorkDurationMin += loss;
            // 누수시간도 인원수로 나누어 실제 누수 평균 도출
            nonWorkActualMin += uniqueMembers.size > 0 ? (loss / uniqueMembers.size) : 0;
            nonWorkCost += (loss / 60) * 10000; 
        }
    });

    const setProductivityText = (typeId, data) => {
        const mins = data.duration;
        const hours = mins / 60;
        
        const upm = mins > 0 ? (data.qty / mins) : 0;
        const uph = hours > 0 ? (data.qty / hours) : 0;
        const upd = uph * 8; 

        const upmEl = document.getElementById(`prod-upm-${typeId}`);
        const uphEl = document.getElementById(`prod-uph-${typeId}`);
        const updEl = document.getElementById(`prod-upd-${typeId}`);

        if (upmEl) upmEl.textContent = upm > 0 ? `${upm.toFixed(2)} 개` : '0';
        if (uphEl) uphEl.textContent = uph > 0 ? `${uph.toFixed(1)} 개` : '0';
        if (updEl) updEl.textContent = upd > 0 ? `${Math.round(upd).toLocaleString()} 개` : '0';
    };

    setProductivityText('general', summary['종합']);
    setProductivityText('domestic', summary['국내배송']);
    setProductivityText('china', summary['중국제작']);
    setProductivityText('direct', summary['직진배송']);

    const ctx = document.getElementById('chart-productivity-efficiency');
    if (ctx) {
        if (productivityChartInstance) productivityChartInstance.destroy();

        const colors = { '국내배송': '#10b981', '중국제작': '#ef4444', '직진배송': '#a855f7' };
        const datasets = taskTypes.map(type => {
            const hours = summary[type].duration / 60;
            // 실제 평균 소요시간 계산
            const actualHours = summary[type].members.size > 0 ? hours / summary[type].members.size : 0;
            
            return {
                label: type,
                data: [{ 
                    x: parseFloat(hours.toFixed(1)), 
                    y: summary[type].qty, 
                    r: hours > 0 ? 15 : 0, 
                    actualX: parseFloat(actualHours.toFixed(1)) 
                }],
                backgroundColor: colors[type] || '#3b82f6'
            };
        });

        productivityChartInstance = new Chart(ctx, {
            type: 'bubble',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: '총 투입 시간 (Hours)', font: { weight: 'bold' } }, beginAtZero: true },
                    y: { title: { display: true, text: '총 생산량 (개수)', font: { weight: 'bold' } }, beginAtZero: true }
                },
                plugins: { 
                    tooltip: { 
                        callbacks: { 
                            // 툴팁에서 총 투입 시간과 함께 실제(인당) 소요시간을 괄호 안에 출력
                            label: (ctx) => `${ctx.dataset.label}: 총 투입 ${ctx.raw.x}h (인당 실제소요 ${ctx.raw.actualX}h), ${ctx.raw.y}개 생산` 
                        } 
                    } 
                }
            }
        });
    }

    const tbody = document.getElementById('prod-coq-table-body');
    if (tbody) {
        const totalDurationGeneral = summary['종합'].duration;
        const actualDurationGeneral = summary['종합'].members.size > 0 ? totalDurationGeneral / summary['종합'].members.size : 0;

        tbody.innerHTML = `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td class="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">⏳ 대기 및 비업무 시간 누수</td>
                <td class="px-4 py-3 text-right text-gray-600 dark:text-gray-400 font-mono">
                    <div class="font-bold text-gray-800 dark:text-gray-200">총 합산 ${Math.round(nonWorkDurationMin).toLocaleString()} 분</div>
                    <div class="text-xs text-blue-500 font-bold">실제 평균 ${Math.round(nonWorkActualMin).toLocaleString()} 분</div>
                </td>
                <td class="px-4 py-3 text-right text-red-500 font-bold font-mono">-${Math.round(nonWorkCost).toLocaleString()} 원</td>
            </tr>
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td class="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">📦 불량 검수 및 조정 Overhead</td>
                <td class="px-4 py-3 text-right text-gray-600 dark:text-gray-400 font-mono">
                    <div class="font-bold text-gray-800 dark:text-gray-200">총 합산 ${Math.round(totalDurationGeneral * 0.05)} 분</div>
                    <div class="text-xs text-blue-500 font-bold">실제 평균 ${Math.round(actualDurationGeneral * 0.05)} 분</div>
                </td>
                <td class="px-4 py-3 text-right text-red-500 font-bold font-mono">-${Math.round((totalDurationGeneral * 0.05 / 60) * 11000).toLocaleString()} 원</td>
            </tr>
        `;
    }
}