// === js/history-excel.js ===

import { 
    appState, appConfig, db, auth, 
    allHistoryData // ✅ 로컬 이력 데이터 (입고 리스트별 다운로드 시 필요)
} from './state.js'; 

import { 
    formatTimeTo24H, formatDuration, getWeekOfYear, showToast, calculateDateDifference, getTodayDateString
} from './utils.js';

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"; 

const fitToColumn = (ws) => {
    const objectMaxLength = [];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (!data || data.length === 0) return;
    if (data[0]) {
        Object.keys(data[0]).forEach((key, index) => {
            objectMaxLength[index] = String(data[0][key]).length;
        });
    }
    data.slice(1).forEach(row => {
        Object.keys(row).forEach((key, index) => {
            const cellLength = String(row[key] ?? '').length;
            objectMaxLength[index] = Math.max(objectMaxLength[index] || 10, cellLength);
        });
    });
    ws['!cols'] = objectMaxLength.map(w => ({ width: w + 5 }));
};

const appendTotalRow = (ws, data, headers) => {
    if (!data || data.length === 0) return;
    const total = {};
    const sums = {};

    headers.forEach(header => {
        if (header.includes('(분)') || header.includes('(원)') || header.includes('(개)') || header.includes('횟수')) {
            sums[header] = data.reduce((acc, row) => acc + (Number(row[header]) || 0), 0);
        }
    });

    headers.forEach((header, index) => {
        if (index === 0) {
            total[header] = '총 합계';
        } else if (header.includes('(분)') || header.includes('(원)') || header.includes('(개)') || header.includes('횟수')) {
            if (header === '개당 처리비용(원)') {
                 const totalCost = sums['총 인건비(원)'] || 0;
                 const totalQty = sums['총 처리량(개)'] || 0;
                 const totalCostPerItem = (totalQty > 0) ? (totalCost / totalQty) : 0;
                 total[header] = Math.round(totalCostPerItem);
            } else {
                 total[header] = Math.round(sums[header]);
            }
        } else {
            total[header] = '';
        }
    });
    XLSX.utils.sheet_add_json(ws, [total], { skipHeader: true, origin: -1 });
};

// =================================================================
// ✅ [신규] 입고 리스트별 검수 이력 다운로드 (로컬 데이터 기반)
// =================================================================
const downloadListInspectionHistory = (format = 'xlsx') => {
    showToast('입고 리스트 데이터를 준비 중입니다...');

    const allLists = [];
    
    // allHistoryData에서 inspectionList 추출
    allHistoryData.forEach(day => {
        if (day.inspectionList && day.inspectionList.length > 0) {
            day.inspectionList.forEach(item => {
                allLists.push({
                    date: day.id, // 날짜 정보 추가
                    ...item
                });
            });
        }
    });

    if (allLists.length === 0) {
        return showToast('다운로드할 입고 리스트 데이터가 없습니다.', true);
    }

    try {
        const workbook = XLSX.utils.book_new();
        const headers = [
            '날짜', '코드', '상품명', '옵션', '공급처', '수량', '기준 두께', '상태'
        ];

        // 날짜 내림차순 정렬
        allLists.sort((a, b) => b.date.localeCompare(a.date));

        const sheetData = allLists.map(item => ({
            '날짜': item.date,
            '코드': item.code || '-',
            '상품명': item.name,
            '옵션': item.option || '-',
            '공급처': item.supplierName || '-',
            '수량': item.qty || 0,
            '기준 두께': item.thickness || '-',
            '상태': item.status || '대기'
        }));

        const worksheet = XLSX.utils.json_to_sheet(sheetData, { header: headers });
        fitToColumn(worksheet);
        XLSX.utils.book_append_sheet(workbook, worksheet, '입고_리스트_내역');

        XLSX.writeFile(workbook, `입고리스트_이력_${getTodayDateString()}.${format}`);
        showToast('입고 리스트 다운로드 완료');

    } catch (e) {
        console.error("Export list inspection history failed:", e);
        showToast('파일 생성 실패', true);
    }
};

// =================================================================
// ✅ [수정] 상품별 검수 이력 엑셀 다운로드 함수 (Firestore 기반)
// =================================================================
const downloadProductInspectionHistory = async (format = 'xlsx') => {
    showToast('검수 이력(상품별) 데이터를 불러오는 중...');
    
    let inspectionData = [];
    try {
        const colRef = collection(db, 'product_history');
        const snapshot = await getDocs(colRef);

        snapshot.forEach(doc => {
            inspectionData.push({
                id: doc.id,
                ...doc.data()
            });
        });
    } catch (e) {
        console.error("Error fetching inspection history:", e);
        return showToast('데이터 불러오기 실패', true);
    }
    
    if (!inspectionData || inspectionData.length === 0) {
        return showToast('다운로드할 데이터가 없습니다.', true);
    }
    
    try {
        const workbook = XLSX.utils.book_new();

        // --- Sheet 1: 상품별 요약 ---
        const sheet1Headers = [
            '상품명', '코드', '옵션', '공급처 상품명', '총 입고 횟수', '최근 검수일', '최근 불량 요약'
        ];
        const sheet1Data = inspectionData.map(item => ({
            '상품명': item.id,
            '코드': item.lastCode || '-',
            '옵션': item.lastOption || '-',
            '공급처 상품명': item.lastSupplierName || '-',
            '총 입고 횟수': item.totalInbound || 0,
            '최근 검수일': item.lastInspectionDate || '-',
            '최근 불량 요약': (item.defectSummary && item.defectSummary.length > 0) ? item.defectSummary[item.defectSummary.length - 1] : '-'
        }));
        const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
        fitToColumn(worksheet1);
        XLSX.utils.book_append_sheet(workbook, worksheet1, `상품별_요약`);

        if (format === 'csv') {
             XLSX.writeFile(workbook, `검수이력_상품별_${getTodayDateString()}.csv`);
             return;
        }

        // --- Sheet 2: 상세 로그 ---
        const sheet2Headers = [
            '상품명', '공급처 상품명', '일시(날짜)', '일시(시간)', '담당', '입고일자/패킹No', '코드', '옵션', '수량', '상태', '특이사항',
            '두께(실측)', '원단 상태', '컬러', '뒤틀림', '올 풀림', '실밥 마감', '지퍼', '단추', '안감', '보풀', '이염'
        ];
        
        const allLogs = inspectionData.flatMap(item => {
            const logs = item.logs || [];
            return logs.map(log => ({
                '상품명': item.id,
                '공급처 상품명': log.supplierName || item.lastSupplierName || '-',
                '일시(날짜)': log.date || '-',
                '일시(시간)': log.time || '-',
                '담당': log.inspector || '-',
                '입고일자/패킹No': log.inboundDate || log.packingNo || '-',
                '코드': log.code || '-',
                '옵션': log.option || '-',
                '수량': log.inboundQty || 0,
                '상태': log.status || '-',
                '특이사항': (log.defects?.length > 0 ? `[${log.defects.join(', ')}] ` : '') + (log.note || ''),
                '두께(실측)': log.checklist?.thickness || '-',
                '원단 상태': log.checklist?.fabric || '-',
                '컬러': log.checklist?.color || '-',
                '뒤틀림': log.checklist?.distortion || '-',
                '올 풀림': log.checklist?.unraveling || '-',
                '실밥 마감': log.checklist?.finishing || '-',
                '지퍼': log.checklist?.zipper || '-',
                '단추': log.checklist?.button || '-',
                '안감': log.checklist?.lining || '-',
                '보풀': log.checklist?.pilling || '-',
                '이염': log.checklist?.dye || '-'
            }));
        }).sort((a, b) => b['일시(날짜)'].localeCompare(a['일시(날짜)']));

        const worksheet2 = XLSX.utils.json_to_sheet(allLogs, { header: sheet2Headers });
        fitToColumn(worksheet2);
        XLSX.utils.book_append_sheet(workbook, worksheet2, `상세_로그`);

        XLSX.writeFile(workbook, `검수이력_상품별_${getTodayDateString()}.${format}`);
        showToast('검수 이력(상품별) 다운로드 완료');

    } catch (error) {
        console.error('Export inspection history failed:', error);
        showToast('파일 생성 실패', true);
    }
};

// 메인 함수: viewMode에 따라 분기
export const downloadInspectionHistory = async (format = 'xlsx', viewMode = 'product') => {
    if (viewMode === 'list') {
        downloadListInspectionHistory(format);
    } else {
        await downloadProductInspectionHistory(format);
    }
};

// ... (기존 업무 이력 다운로드 함수들: downloadHistoryAsExcel 등 그대로 유지)
// 아래 내용은 파일의 나머지 부분을 그대로 유지하기 위해 생략하지 않고 제공합니다.

export const downloadHistoryAsExcel = async (dateKey, format = 'xlsx') => {
    try {
        const data = allHistoryData.find(d => d.id === dateKey);
        if (!data) {
            return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);
        }
        
        const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);
        const previousDayData = (currentIndex > -1 && currentIndex + 1 < allHistoryData.length) 
                                ? allHistoryData[currentIndex + 1] 
                                : null;

        const workbook = XLSX.utils.book_new();

        const historyWageMap = {};
        (allHistoryData || []).forEach(dayData => {
            (dayData.partTimers || []).forEach(pt => {
                if (pt && pt.name && !historyWageMap[pt.name]) {
                     historyWageMap[pt.name] = pt.wage || 0;
                }
            });
        });
        const combinedWageMap = { ...historyWageMap, ...(appConfig.memberWages || {}) };

        const dailyRecords = data.workRecords || [];
        const dailyQuantities = data.taskQuantities || {};
        
        const sheet1Headers = ['팀원', '업무 종류', '시작 시간', '종료 시간', '소요 시간(분)', '인건비(원)'];
        const sheet1Data = dailyRecords.map(r => {
            const duration = Number(r.duration) || 0;
            const wage = combinedWageMap[r.member] || 0;
            const cost = (duration / 60) * wage;
            
            return {
                '팀원': r.member || '',
                '업무 종류': r.task || '',
                '시작 시간': formatTimeTo24H(r.startTime),
                '종료 시간': formatTimeTo24H(r.endTime),
                '소요 시간(분)': Math.round(duration),
                '인건비(원)': Math.round(cost)
            };
        });
        const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
        if (sheet1Data.length > 0) appendTotalRow(worksheet1, sheet1Data, sheet1Headers);
        fitToColumn(worksheet1);
        XLSX.utils.book_append_sheet(workbook, worksheet1, `상세 기록 (${dateKey})`);

        if (format === 'xlsx') {
            let prevTaskSummary = {};
            if (previousDayData) {
                const prevRecords = previousDayData.workRecords || [];
                (prevRecords).forEach(r => {
                    if (!prevTaskSummary[r.task]) {
                        prevTaskSummary[r.task] = { totalDuration: 0, totalCost: 0, members: new Set() };
                    }
                    const wage = combinedWageMap[r.member] || 0;
                    const cost = ((Number(r.duration) || 0) / 60) * wage;
                    prevTaskSummary[r.task].totalDuration += (Number(r.duration) || 0);
                    prevTaskSummary[r.task].totalCost += cost;
                    prevTaskSummary[r.task].members.add(r.member);
                });
            }
            
            const summaryByTask = {};
            dailyRecords.forEach(r => {
                if (!summaryByTask[r.task]) {
                    summaryByTask[r.task] = { totalDuration: 0, totalCost: 0, members: new Set() };
                }
                const wage = combinedWageMap[r.member] || 0;
                const cost = ((Number(r.duration) || 0) / 60) * wage;
                summaryByTask[r.task].totalDuration += (Number(r.duration) || 0);
                summaryByTask[r.task].totalCost += cost;
                summaryByTask[r.task].members.add(r.member); 
            });
            
            const sheet2Headers = [
                '업무 종류', '진행 인원수', '총 소요 시간(분)', '총 인건비(원)', '총 처리량(개)', '개당 처리비용(원)',
                '진행 인원수(전일비)', '총 시간(전일비)', '총 인건비(전일비)', '총 처리량(전일비)', '개당 처리비용(전일비)'
            ];
            
            const sheet2Data = Object.keys(summaryByTask).sort().map(task => {
                const taskQty = Number(dailyQuantities[task]) || 0;
                const taskCost = summaryByTask[task].totalCost;
                const costPerItem = (taskQty > 0) ? (taskCost / taskQty) : 0;
                const staffCount = summaryByTask[task].members.size;
                const duration = summaryByTask[task].totalDuration;
                
                const prevSummary = prevTaskSummary[task] || { totalDuration: 0, totalCost: 0, members: new Set() };
                const prevQty = Number(previousDayData?.taskQuantities?.[task]) || 0;
                const prevCost = prevSummary.totalCost;
                const prevCostPerItem = (prevQty > 0) ? (prevCost / prevQty) : 0;
                const prevStaffCount = prevSummary.members.size;
                const prevDuration = prevSummary.totalDuration;

                return {
                    '업무 종류': task,
                    '진행 인원수': staffCount,
                    '총 소요 시간(분)': Math.round(duration),
                    '총 인건비(원)': Math.round(taskCost),
                    '총 처리량(개)': taskQty,
                    '개당 처리비용(원)': Math.round(costPerItem),
                    '진행 인원수(전일비)': staffCount - prevStaffCount,
                    '총 시간(전일비)': Math.round(duration - prevDuration),
                    '총 인건비(전일비)': Math.round(taskCost - prevCost),
                    '총 처리량(전일비)': taskQty - prevQty,
                    '개당 처리비용(전일비)': Math.round(costPerItem - prevCostPerItem)
                };
            });
            
            const worksheet2 = XLSX.utils.json_to_sheet(sheet2Data, { header: sheet2Headers });
            if (sheet2Data.length > 0) appendTotalRow(worksheet2, sheet2Data, sheet2Headers); 
            fitToColumn(worksheet2);
            XLSX.utils.book_append_sheet(workbook, worksheet2, `업무 요약 (${dateKey})`);

            const sheet3Headers = ['파트', '총 인건비(원)'];
            const memberToPartMap = new Map();
            (appConfig.teamGroups || []).forEach(group => group.members.forEach(member => memberToPartMap.set(member, group.name)));
            const summaryByPart = {};
            dailyRecords.forEach(r => {
                const part = memberToPartMap.get(r.member) || '알바';
                if (!summaryByPart[part]) summaryByPart[part] = { totalCost: 0 };
                const wage = combinedWageMap[r.member] || 0;
                const cost = ((Number(r.duration) || 0) / 60) * wage;
                summaryByPart[part].totalCost += cost;
            });
            const sheet3Data = Object.keys(summaryByPart).sort().map(part => ({
                '파트': part,
                '총 인건비(원)': Math.round(summaryByPart[part].totalCost)
            }));
            const worksheet3 = XLSX.utils.json_to_sheet(sheet3Data, { header: sheet3Headers });
            if (sheet3Data.length > 0) appendTotalRow(worksheet3, sheet3Data, sheet3Headers);
            fitToColumn(worksheet3);
            XLSX.utils.book_append_sheet(workbook, worksheet3, `파트 인건비 (${dateKey})`);
        }

        XLSX.writeFile(workbook, `업무기록_${dateKey}.${format}`);

    } catch (error) {
        console.error('Export failed:', error);
        showToast('파일 생성에 실패했습니다.', true);
    }
};

export const downloadPeriodHistoryAsExcel = async (startDate, endDate, customFileName = null, format = 'xlsx') => {
    if (!startDate || !endDate) return showToast('기간을 선택해주세요.', true);

    try {
        const filteredData = allHistoryData.filter(d => d.id >= startDate && d.id <= endDate);
        if (filteredData.length === 0) return showToast('선택한 기간에 데이터가 없습니다.', true);

        const workbook = XLSX.utils.book_new();
        const historyWageMap = { ...(appConfig.memberWages || {}) };

        const sheet1Headers = ['날짜', '팀원', '업무 종류', '시작 시간', '종료 시간', '소요 시간(분)', '인건비(원)'];
        const sheet1Data = filteredData.flatMap(day => 
            (day.workRecords || []).map(r => {
                const duration = Number(r.duration) || 0;
                const wage = historyWageMap[r.member] || (appConfig.defaultPartTimerWage || 10000);
                return {
                    '날짜': day.id,
                    '팀원': r.member || '',
                    '업무 종류': r.task || '',
                    '시작 시간': formatTimeTo24H(r.startTime),
                    '종료 시간': formatTimeTo24H(r.endTime),
                    '소요 시간(분)': Math.round(duration),
                    '인건비(원)': Math.round((duration / 60) * wage)
                };
            })
        ).sort((a,b) => a['날짜'].localeCompare(b['날짜']));

        const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
        if(sheet1Data.length) appendTotalRow(worksheet1, sheet1Data, sheet1Headers);
        fitToColumn(worksheet1);
        XLSX.utils.book_append_sheet(workbook, worksheet1, `상세 기록 (기간)`);

        const fileName = customFileName || `업무기록_기간_${startDate}_${endDate}.${format}`;
        XLSX.writeFile(workbook, fileName);

    } catch (error) {
        console.error('Period export failed:', error);
        showToast('기간 데이터 다운로드 실패', true);
    }
};

export const downloadWeeklyHistoryAsExcel = async (weekKey, format = 'xlsx') => {
    if (!weekKey) return showToast('주간 정보가 없습니다.', true);
    const weekData = allHistoryData.filter(d => getWeekOfYear(new Date(d.id + "T00:00:00")) === weekKey);
    if (weekData.length === 0) return showToast(`${weekKey} 데이터가 없습니다.`, true);
    weekData.sort((a, b) => a.id.localeCompare(b.id));
    await downloadPeriodHistoryAsExcel(weekData[0].id, weekData[weekData.length - 1].id, `주간업무요약_${weekKey}.${format}`, format);
};

export const downloadMonthlyHistoryAsExcel = async (monthKey, format = 'xlsx') => {
     if (!monthKey) return showToast('월간 정보가 없습니다.', true);
     const monthData = allHistoryData.filter(d => d.id.startsWith(monthKey));
     if (monthData.length === 0) return showToast(`${monthKey} 데이터가 없습니다.`, true);
     monthData.sort((a, b) => a.id.localeCompare(b.id));
     await downloadPeriodHistoryAsExcel(monthData[0].id, monthData[monthData.length - 1].id, `월간업무요약_${monthKey}.${format}`, format);
};

export const downloadAttendanceExcel = (viewMode, key, format = 'xlsx') => {
    let dataList = [];
    let fileName = '';
    if (viewMode === 'daily') {
        const day = allHistoryData.find(d => d.id === key);
        if (day) dataList = [day];
        fileName = `근태기록_일별_${key}.${format}`;
    } else if (viewMode === 'weekly') {
        dataList = allHistoryData.filter(d => getWeekOfYear(new Date(d.id + "T00:00:00")) === key);
        fileName = `근태기록_주별_${key}.${format}`;
    } else if (viewMode === 'monthly') {
        dataList = allHistoryData.filter(d => d.id.startsWith(key));
        fileName = `근태기록_월별_${key}.${format}`;
    }

    if (dataList.length === 0) return showToast('다운로드할 데이터가 없습니다.', true);

    const summary = {};
    dataList.forEach(day => {
        (day.onLeaveMembers || []).forEach(entry => {
            if (!summary[entry.member]) {
                summary[entry.member] = { '이름': entry.member, '지각':0, '외출':0, '조퇴':0, '결근':0, '연차':0, '출장':0, '총 횟수':0, '총 결근일수':0, '총 연차일수':0 };
            }
            const rec = summary[entry.member];
            if (rec.hasOwnProperty(entry.type)) rec[entry.type]++;
            if (entry.type !== '연차') rec['총 횟수']++;
            if (entry.type === '결근') rec['총 결근일수'] += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
            if (entry.type === '연차') rec['총 연차일수'] += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
        });
    });

    const sheetData = Object.values(summary).sort((a, b) => a['이름'].localeCompare(b['이름']));
    if (sheetData.length === 0) return showToast('근태 기록이 없습니다.', true);

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(sheetData);
    fitToColumn(worksheet);
    XLSX.utils.book_append_sheet(workbook, worksheet, '근태 요약');
    XLSX.writeFile(workbook, fileName);
};

export const downloadReportExcel = (reportData, format = 'xlsx') => {
    if (!reportData) return showToast('리포트 데이터가 없습니다.', true);

    try {
        const workbook = XLSX.utils.book_new();
        const { type, title, tMetrics, tData } = reportData;

        const taskSummary = tMetrics.aggr.taskSummary;
        const taskData = Object.keys(taskSummary).map(t => ({
            '업무': t,
            '총 시간': formatDuration(taskSummary[t].duration),
            '총 인건비(원)': Math.round(taskSummary[t].cost),
            '총 처리량(개)': taskSummary[t].quantity,
            '분당 처리량': taskSummary[t].avgThroughput.toFixed(2),
            '개당 처리비용(원)': Math.round(taskSummary[t].avgCostPerItem),
            '평균 투입인원': (taskSummary[t].avgDailyStaff || 0).toFixed(1),
            '총 인원(명)': taskSummary[t].avgStaff,
            '인당 효율': taskSummary[t].efficiency.toFixed(2)
        }));
        const wsTask = XLSX.utils.json_to_sheet(taskData);
        fitToColumn(wsTask);

        if (format === 'csv') {
            XLSX.utils.book_append_sheet(workbook, wsTask, '업무별 상세');
            XLSX.writeFile(workbook, `${title.replace(/ /g, '_')}.csv`);
            return;
        }

        const kpis = tMetrics.kpis;
        const kpiData = [
            { '항목': '총 업무 시간', '값': formatDuration(kpis.totalDuration) },
            { '항목': '총 인건비', '값': `${Math.round(kpis.totalCost).toLocaleString()} 원` },
            { '항목': '총 처리량', '값': `${kpis.totalQuantity.toLocaleString()} 개` },
            { '항목': '분당 처리량', '값': `${kpis.overallAvgThroughput.toFixed(2)} 개/분` },
            { '항목': '개당 처리비용', '값': `${kpis.overallAvgCostPerItem.toFixed(0)} 원/개` },
            { '항목': '평균 근무 인원', '값': `${Number(kpis.activeMembersCount).toFixed(1)} 명` },
            { '항목': '비업무 시간', '값': formatDuration(kpis.nonWorkMinutes) },
            { '항목': 'COQ(품질비용) 비율', '값': `${kpis.coqPercentage.toFixed(1)} %` }
        ];
        const wsKPI = XLSX.utils.json_to_sheet(kpiData);
        fitToColumn(wsKPI);
        XLSX.utils.book_append_sheet(workbook, wsKPI, '주요 지표(KPI)');

        const partSummary = tMetrics.aggr.partSummary;
        const partData = Object.keys(partSummary).map(part => ({
            '파트': part,
            '총 업무시간': formatDuration(partSummary[part].duration),
            '총 인건비(원)': Math.round(partSummary[part].cost),
            '참여 인원(명)': partSummary[part].members.size
        }));
        const wsPart = XLSX.utils.json_to_sheet(partData);
        fitToColumn(wsPart);
        XLSX.utils.book_append_sheet(workbook, wsPart, '파트별 요약');

        const memberSummary = tMetrics.aggr.memberSummary;
        const memberData = Object.keys(memberSummary).map(m => ({
            '이름': m,
            '파트': tData.memberToPartMap.get(m) || '알바',
            '총 업무시간': formatDuration(memberSummary[m].duration),
            '총 인건비(원)': Math.round(memberSummary[m].cost),
            '수행 업무 수': memberSummary[m].tasks.size
        }));
        const wsMember = XLSX.utils.json_to_sheet(memberData);
        fitToColumn(wsMember);
        XLSX.utils.book_append_sheet(workbook, wsMember, '인원별 상세');

        XLSX.utils.book_append_sheet(workbook, wsTask, '업무별 상세');

        XLSX.writeFile(workbook, `${title.replace(/ /g, '_')}.xlsx`);
    } catch (e) {
        console.error(e);
        showToast('리포트 다운로드 중 오류 발생', true);
    }
};

export const downloadPersonalReportExcel = (reportData, format = 'xlsx') => {
    if (!reportData) return showToast('개인 리포트 데이터가 없습니다.', true);

    try {
        const workbook = XLSX.utils.book_new();
        const { title, stats, memberName, dateKey } = reportData;

        let logData = [];
        if (stats.dailyLogs.length > 0) {
            logData = stats.dailyLogs.map(log => ({
                '날짜': log.date,
                '근태 상태': log.attendance,
                '출근': log.inTime ? formatTimeTo24H(log.inTime) : '-',
                '퇴근': log.outTime ? formatTimeTo24H(log.outTime) : '-',
                '주요 업무': log.mainTask,
                '총 근무 시간': formatDuration(log.workTime)
            }));
        } else {
             logData = [{'결과': '기록 없음'}];
        }
        const wsLog = XLSX.utils.json_to_sheet(logData);
        fitToColumn(wsLog);

        if (format === 'csv') {
            XLSX.utils.book_append_sheet(workbook, wsLog, '일자별 활동');
            XLSX.writeFile(workbook, `${title.replace(/ /g, '_')}.csv`);
            return;
        }

        const summaryData = [
            { '항목': '이름', '값': memberName },
            { '항목': '기간/날짜', '값': dateKey },
            { '항목': '총 근무일', '값': `${stats.workDaysCount}일` },
            { '항목': '총 업무 시간', '값': formatDuration(stats.totalWorkMinutes) },
            { '항목': '예상 급여(세전)', '값': `${Math.round(stats.totalWageCost).toLocaleString()} 원` },
            { '항목': '근태 특이사항', '값': Object.entries(stats.attendanceCounts).filter(([,c])=>c>0).map(([t,c])=>`${t} ${c}회`).join(', ') || '없음' }
        ];
        const wsSummary = XLSX.utils.json_to_sheet(summaryData);
        fitToColumn(wsSummary);
        XLSX.utils.book_append_sheet(workbook, wsSummary, '개인 요약');

        const taskData = Object.entries(stats.taskStats).map(([task, data]) => ({
            '업무명': task,
            '수행 횟수': data.count,
            '총 소요 시간': formatDuration(data.duration),
            '비중(%)': (stats.totalWorkMinutes > 0 ? (data.duration / stats.totalWorkMinutes * 100).toFixed(1) : 0),
            '평균 시간/건': formatDuration(data.count > 0 ? data.duration / data.count : 0)
        }));
        const wsTask = XLSX.utils.json_to_sheet(taskData);
        fitToColumn(wsTask);
        XLSX.utils.book_append_sheet(workbook, wsTask, '업무별 통계');

        XLSX.utils.book_append_sheet(workbook, wsLog, '일자별 활동');

        if (stats.attendanceLogs.length > 0) {
            const attData = stats.attendanceLogs.map(log => ({
                '날짜': log.date,
                '유형': log.type,
                '상세 내용': log.detail
            }));
            const wsAtt = XLSX.utils.json_to_sheet(attData);
            fitToColumn(wsAtt);
            XLSX.utils.book_append_sheet(workbook, wsAtt, '근태 상세 기록');
        }

        XLSX.writeFile(workbook, `${title.replace(/ /g, '_')}.xlsx`);
    } catch (e) {
        console.error(e);
        showToast('개인 리포트 다운로드 중 오류 발생', true);
    }
};

export const downloadContentAsPdf = (elementId, title) => {
    const originalElement = document.getElementById(elementId);
    if (!originalElement) return showToast('출력할 내용을 찾을 수 없습니다.', true);

    showToast('PDF 변환을 시작합니다. (잠시만 기다려주세요)');

    const tempContainer = document.createElement('div');
    tempContainer.id = 'pdf-temp-container';
    tempContainer.style.position = 'fixed';
    tempContainer.style.top = '0';
    tempContainer.style.left = '0';
    tempContainer.style.width = '1120px';
    tempContainer.style.height = 'auto';
    tempContainer.style.background = 'white';
    tempContainer.style.zIndex = '-9999';
    tempContainer.style.overflow = 'visible';
    
    tempContainer.innerHTML = `<style>
        #pdf-temp-container * {
            overflow: visible !important;
            max-height: none !important;
            height: auto !important;
            scrollbar-width: none !important;
        }
        #pdf-temp-container table { 
            page-break-inside: auto; 
            width: 100% !important; 
            table-layout: fixed !important; 
        }
        #pdf-temp-container tr { 
            page-break-inside: avoid; 
            page-break-after: auto; 
        }
        #pdf-temp-container thead { display: table-header-group; }
        #pdf-temp-container tfoot { display: table-footer-group; }
        
        .break-inside-avoid, .p-4, .p-5, .p-6 { page-break-inside: avoid !important; }

        body, .bg-gray-50 { background: white !important; }
        .bg-white { background: white !important; box-shadow: none !important; border: 1px solid #e5e7eb !important; }
        
        th, td, p, div { 
            word-wrap: break-word; 
            white-space: normal !important; 
        }
    </style>`;
    
    const clonedElement = originalElement.cloneNode(true);
    
    clonedElement.querySelectorAll('button, input, select, .no-print').forEach(el => el.remove());

    const allElements = clonedElement.querySelectorAll('*');
    allElements.forEach(el => {
        el.classList.remove(
            'overflow-y-auto', 'overflow-x-auto', 'overflow-hidden', 'overflow-auto',
            'max-h-40', 'max-h-48', 'max-h-60', 'max-h-96', 
            'max-h-screen', 
            'max-h-[60vh]', 'max-h-[70vh]', 'max-h-[85vh]', 'max-h-[90vh]',
            'h-full', 'h-screen',
            'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-2xl',
            'fixed', 'absolute', 'sticky'
        );
        
        el.style.maxHeight = 'none';
        el.style.height = 'auto';
        el.style.overflow = 'visible';
        el.style.position = 'static';
        el.style.width = '';
    });

    tempContainer.appendChild(clonedElement);
    document.body.appendChild(tempContainer);

    const originalCanvases = originalElement.querySelectorAll('canvas');
    const clonedCanvases = clonedElement.querySelectorAll('canvas');
    originalCanvases.forEach((origCanvas, index) => {
        if (clonedCanvases[index]) {
            const ctx = clonedCanvases[index].getContext('2d');
            clonedCanvases[index].width = origCanvas.width;
            clonedCanvases[index].height = origCanvas.height;
            ctx.drawImage(origCanvas, 0, 0);
            clonedCanvases[index].style.width = '100%';
            clonedCanvases[index].style.height = 'auto';
        }
    });

    const opt = {
        margin:       [10, 10, 10, 10],
        filename:     `${title}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { 
            scale: 2,
            useCORS: true,
            scrollY: 0,
            windowWidth: 1120,
            height: tempContainer.scrollHeight
        },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };

    html2pdf().from(tempContainer).set(opt).save()
        .then(() => {
            showToast('PDF 저장이 완료되었습니다.');
        })
        .catch(err => {
            console.error('PDF generation error:', err);
            showToast('PDF 생성 중 오류가 발생했습니다.', true);
        })
        .finally(() => {
            document.body.removeChild(tempContainer);
        });
};