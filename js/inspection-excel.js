// === js/inspection-excel.js ===
import * as State from './state.js';
import { updateDailyData } from './app-data.js';
import { showToast, getTodayDateString } from './utils.js';
import { renderTodoList, openInspectionListWindow } from './inspection-logic.js';

export const handleExcelUpload = (file) => {
    let packingDate = getTodayDateString();
    const parentMatch = file.name.match(/\((\d{6})\)/);
    const fullDateMatch = file.name.match(/20(\d{2})(\d{2})(\d{2})/);
    const shortDateMatch = file.name.match(/(\d{2})(\d{2})(\d{2})/);

    if (parentMatch) {
        const y = parentMatch[1].substring(0, 2);
        const m = parentMatch[1].substring(2, 4);
        const d = parentMatch[1].substring(4, 6);
        packingDate = `20${y}-${m}-${d}`;
    } else if (fullDateMatch) {
        packingDate = `20${fullDateMatch[1]}-${fullDateMatch[2]}-${fullDateMatch[3]}`;
    } else if (shortDateMatch) {
        packingDate = `20${shortDateMatch[1]}-${shortDateMatch[2]}-${shortDateMatch[3]}`;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            const getCleanKey = (name, option) => {
                const cleanName = String(name || '').replace(/\(매칭금지-제작샘플\)/g, '').replace(/\s/g, '').trim().toLowerCase();
                const cleanOption = String(option || '').replace(/촬샘-/g, '').replace(/\s/g, '').trim().toLowerCase();
                return cleanName + cleanOption;
            };

            const sampleMap = new Map();
            if (workbook.SheetNames.length > 1) {
                const sheet2Name = workbook.SheetNames[1];
                const sheet2 = workbook.Sheets[sheet2Name];
                const json2 = XLSX.utils.sheet_to_json(sheet2, { header: 1 });
                for (let i = 1; i < json2.length; i++) {
                    const row = json2[i];
                    if (row) {
                        const name = row[1]; 
                        const option = row[2];
                        const location = String(row[6] || '').trim();
                        if (name && location) {
                            const key = getCleanKey(name, option);
                            sampleMap.set(key, location);
                        }
                    }
                }
            }

            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            const processedList = [];
            const uniqueKeyMap = new Map(); 

            if (jsonData.length > 1) {
                for (let i = 1; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (row && row.length > 1) { 
                        const code = String(row[0] || '').trim();
                        const name = String(row[1] || '').trim();
                        const option = String(row[2] || '').trim(); 
                        const qty = Number(row[3]) || 0;
                        const thickness = String(row[4] || '');
                        const supplierName = String(row[5] || '').trim();
                        const location = String(row[6] || '').trim();
                        
                        if (code || name) {
                            let color = option.replace(/\[|\]/g, '').split('-')[0].trim();
                            if (!color) color = 'N/A';
                            const keyColor = color.replace(/\s/g, '').toLowerCase();
                            const keySupplierName = supplierName.replace(/\s/g, '').toLowerCase();
                            const uniqueKey = `${keySupplierName}::${keyColor}`; 

                            let sampleLocation = null;
                            const matchKey = getCleanKey(name, option);
                            if (sampleMap.has(matchKey)) {
                                sampleLocation = sampleMap.get(matchKey);
                            }

                            if (!uniqueKeyMap.has(uniqueKey)) {
                                uniqueKeyMap.set(uniqueKey, true); 
                                processedList.push({
                                    code, name, option, qty, thickness, supplierName, location,
                                    sampleLocation: sampleLocation,
                                    status: '대기',
                                    packingDate: packingDate 
                                });
                            }
                        }
                    }
                }
            }

            if (processedList.length > 0) {
                const existingList = State.appState.inspectionList || [];
                const mergedList = [...existingList];
                let addedCount = 0;

                processedList.forEach(newItem => {
                    const isDuplicate = existingList.some(ex => ex.name === newItem.name && ex.option === newItem.option);
                    if (!isDuplicate) {
                        mergedList.push(newItem);
                        addedCount++;
                    }
                });

                await updateDailyData({ inspectionList: mergedList });
                State.appState.inspectionList = mergedList;
                
                showToast(`기존 리스트에 ${addedCount}개의 새 항목이 추가되었습니다. (총 ${mergedList.length}개)`);
                renderTodoList(); 
                openInspectionListWindow();
            } else {
                showToast("유효한 데이터가 엑셀에 없습니다.", true);
            }
        } catch (err) {
            console.error("Excel parse error:", err);
            showToast("엑셀 파일 처리 중 오류가 발생했습니다.", true);
        }
    };
    reader.readAsArrayBuffer(file);
};