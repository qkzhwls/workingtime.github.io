// === js/history-data-manager.js ===
import * as State from './state.js';
import { getTodayDateString, getCurrentTime, calcElapsedMinutes, showToast } from './utils.js';
import {
    doc, setDoc, getDoc, collection, getDocs, deleteDoc,
    query, where, writeBatch, updateDoc, increment, documentId
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let isHistoryCached = false;
let cachedUnverifiedDates = null;
let lastUnverifiedCheckTime = 0;

let historyFetchPromise = null;
let unverifiedFetchPromise = null;

// ✨ 데이터가 변경되었을 때 로컬 캐시를 초기화하는 헬퍼 함수 (읽기 요금 방어용)
const clearLocalCache = () => {
    sessionStorage.removeItem('historyDataCache');
    sessionStorage.removeItem('historyDataCacheTime');
    sessionStorage.removeItem('unverifiedDataCache');
    sessionStorage.removeItem('unverifiedDataCacheTime');
};

export const getWorkRecordsCollectionRef = () => {
    const today = getTodayDateString();
    return collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
};

export const getDailyDocRef = () => {
    return doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
};

export const syncTodayToHistory = async () => {
    const todayKey = getTodayDateString();
    const now = getCurrentTime();

    try {
        const liveWorkRecords = (State.appState.workRecords || []).map(record => {
            const data = { ...record };
            if (data.status === 'ongoing' || data.status === 'paused') {
                data.duration = calcElapsedMinutes(data.startTime, now, data.pauses);
                data.endTime = now;
            }
            return data;
        });

        const idx = State.allHistoryData.findIndex(d => d.id === todayKey);
        const existingHistory = idx > -1 ? State.allHistoryData[idx] : null;

        const isLiveEmpty = liveWorkRecords.length === 0;
        const isLiveQtyEmpty = !State.appState.taskQuantities || Object.keys(State.appState.taskQuantities).length === 0;
        const hasHistoryData = existingHistory && existingHistory.workRecords && existingHistory.workRecords.length > 0;

        let finalWorkRecords = liveWorkRecords;
        let finalQuantities = State.appState.taskQuantities || {};

        if (isLiveEmpty && isLiveQtyEmpty && hasHistoryData) {
            finalWorkRecords = existingHistory.workRecords;
            finalQuantities = existingHistory.taskQuantities || {};
        }

        const liveTodayData = {
            id: todayKey,
            workRecords: finalWorkRecords,
            taskQuantities: finalQuantities,
            confirmedZeroTasks: State.appState.confirmedZeroTasks || (existingHistory?.confirmedZeroTasks || []),
            onLeaveMembers: State.appState.dailyOnLeaveMembers || (existingHistory?.onLeaveMembers || []),
            partTimers: State.appState.partTimers || (existingHistory?.partTimers || []),
            dailyAttendance: State.appState.dailyAttendance || (existingHistory?.dailyAttendance || {}),
            management: State.appState.management || (existingHistory?.management || {}),
            inspectionList: State.appState.inspectionList || (existingHistory?.inspectionList || []),
            isQuantityVerified: State.appState.isQuantityVerified || (existingHistory?.isQuantityVerified || false)
        };

        if (idx > -1) {
            State.allHistoryData[idx] = liveTodayData;
        } else {
            State.allHistoryData.unshift(liveTodayData);
            State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
        }
    } catch (e) {
        console.error("Error syncing today to history cache: ", e);
    }
};

export async function saveProgress(isAutoSave = false, isQuantityVerified = false) {
    const dateStr = getTodayDateString();
    const now = getCurrentTime();

    if (!isAutoSave) {
        showToast('서버의 최신 상태를 이력에 저장합니다...');
    }

    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateStr);

    try {
        const dailyData = {
            taskQuantities: State.appState.taskQuantities || {},
            confirmedZeroTasks: State.appState.confirmedZeroTasks || [],
            onLeaveMembers: State.appState.dailyOnLeaveMembers || [],
            partTimers: State.appState.partTimers || [],
            dailyAttendance: State.appState.dailyAttendance || {},
            management: State.appState.management || {},
            inspectionList: State.appState.inspectionList || [],
            isQuantityVerified: State.appState.isQuantityVerified || false
        };

        const liveWorkRecords = (State.appState.workRecords || []).map(record => {
            const data = { ...record };
            if (data.status === 'ongoing' || data.status === 'paused') {
                data.duration = calcElapsedMinutes(data.startTime, now, data.pauses);
                data.endTime = now;
                if (data.duration > 1200) data.status = 'completed';
            }
            return data;
        }).filter(record => {
            if (record.status !== 'completed') return true;
            return Math.round(record.duration || 0) > 0;
        });

        const existingHistory = State.allHistoryData.find(d => d.id === dateStr) || {};
        const existingRecordsCount = (existingHistory.workRecords || []).length;
        
        if (existingRecordsCount > 0 && liveWorkRecords.length < existingRecordsCount) {
            if (!isAutoSave) showToast("이미 데이터가 안전하게 마감/저장되었습니다.");
            return; 
        }

        if (liveWorkRecords.length === 0 && 
            Object.keys(dailyData.taskQuantities).length === 0 && 
            (!dailyData.inspectionList || dailyData.inspectionList.length === 0)) {
             return;
        }

        const mergedAttendance = { ...dailyData.dailyAttendance, ...State.appState.dailyAttendance };

        const historyData = {
            id: dateStr,
            workRecords: liveWorkRecords,
            taskQuantities: dailyData.taskQuantities,
            confirmedZeroTasks: dailyData.confirmedZeroTasks,
            onLeaveMembers: dailyData.onLeaveMembers,
            partTimers: dailyData.partTimers,
            dailyAttendance: mergedAttendance, 
            management: dailyData.management,
            inspectionList: dailyData.inspectionList,
            isQuantityVerified: isQuantityVerified || State.appState.isQuantityVerified || false,
            savedAt: now
        };

        await setDoc(historyDocRef, historyData, { merge: true });
        
        if (isQuantityVerified) {
            await setDoc(getDailyDocRef(), { isQuantityVerified: true }, { merge: true });
        }

        await syncTodayToHistory(); 
        clearLocalCache(); // ✨ 데이터 변경 시 캐시 지우기

        if (!isAutoSave) {
            showToast('최신 상태가 이력에 안전하게 저장되었습니다.');
        }

    } catch (e) {
        console.error('Error in saveProgress: ', e);
        if (!isAutoSave) showToast(`저장 중 오류가 발생했습니다: ${e.message}`, true);
    }
}

export async function saveDayDataToHistory(shouldReset) {
    const workRecordsColRef = getWorkRecordsCollectionRef();
    const globalEndTime = getCurrentTime(); 

    try {
        const dailyDocRef = getDailyDocRef();
        const dailyDocSnap = await getDoc(dailyDocRef);
        const dailyData = dailyDocSnap.exists() ? dailyDocSnap.data() : {};
        
        const dailyAttendance = { ...dailyData.dailyAttendance, ...State.appState.dailyAttendance };
        const querySnapshot = await getDocs(workRecordsColRef);
        
        let attendanceUpdated = false;
        Object.keys(dailyAttendance).forEach(member => {
            if (dailyAttendance[member].status === 'active') {
                let autoOutTime = globalEndTime; 
                if (dailyAttendance[member].inTime && autoOutTime < dailyAttendance[member].inTime) {
                    autoOutTime = globalEndTime;
                }
                dailyAttendance[member].status = 'returned'; 
                dailyAttendance[member].outTime = autoOutTime;
                attendanceUpdated = true;
            }
        });

        if (attendanceUpdated) {
            await updateDoc(dailyDocRef, { dailyAttendance: dailyAttendance });
            State.appState.dailyAttendance = dailyAttendance;
        }
        
        if (!querySnapshot.empty) {
            const batch = writeBatch(State.db);
            let removedCount = 0;

            querySnapshot.forEach(docSnap => {
                const record = docSnap.data();
                let duration = record.duration || 0;
                let pauses = record.pauses || [];
                let needsUpdate = false;
                
                let recordEndTime = globalEndTime;
                const attendance = dailyAttendance[record.member];
                
                if (attendance && attendance.status === 'returned' && attendance.outTime) {
                    if (attendance.outTime > record.startTime) {
                        recordEndTime = (attendance.outTime <= globalEndTime) ? attendance.outTime : globalEndTime;
                    } else {
                        recordEndTime = globalEndTime;
                    }
                }

                if (record.startTime > recordEndTime) recordEndTime = record.startTime;

                if (record.status === 'ongoing' || record.status === 'paused') {
                    if (record.status === 'paused') {
                        const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                        if (lastPause && lastPause.end === null) lastPause.end = recordEndTime;
                    }
                    duration = calcElapsedMinutes(record.startTime, recordEndTime, pauses);
                    
                    needsUpdate = true;
                }

                if (Math.round(duration) <= 0) {
                    batch.delete(docSnap.ref);
                    removedCount++;
                } else if (needsUpdate) {
                    batch.update(docSnap.ref, {
                        status: 'completed',
                        endTime: recordEndTime,
                        duration: duration,
                        pauses: pauses
                    });
                }
            });
            await batch.commit();
        }
    } catch (e) {
         console.error("Finalizing error: ", e);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
    await saveProgress(false); 

    if (shouldReset) {
         try {
            const qAll = query(workRecordsColRef);
            const snapshotAll = await getDocs(qAll);
            if (!snapshotAll.empty) {
                const deleteBatch = writeBatch(State.db);
                snapshotAll.forEach(doc => deleteBatch.delete(doc.ref));
                await deleteBatch.commit();
            }
            await setDoc(getDailyDocRef(), { taskQuantities: {}, confirmedZeroTasks: [], isQuantityVerified: false }, { merge: true });
        } catch (e) {
             console.error("Error clearing daily data: ", e);
        }
        
        State.appState.workRecords = []; 
        clearLocalCache();
        showToast('오늘의 업무 기록을 초기화했습니다.');
    }
}

export async function fetchAllHistoryData(forceRefresh = false) {
    if (!forceRefresh && isHistoryCached && State.allHistoryData.length > 0) {
        return State.allHistoryData;
    }

    // ✨ 브라우저 세션 스토리지 확인 (새로고침 시 DB 읽기 요금 방어)
    if (!forceRefresh) {
        const cached = sessionStorage.getItem('historyDataCache');
        const cacheTime = sessionStorage.getItem('historyDataCacheTime');
        const now = Date.now();
        // 5분(300,000ms) 이내의 캐시가 있다면 통신 없이 바로 재사용!
        if (cached && cacheTime && (now - parseInt(cacheTime) < 300000)) {
            try {
                State.allHistoryData.length = 0;
                State.allHistoryData.push(...JSON.parse(cached));
                isHistoryCached = true;
                return State.allHistoryData;
            } catch(e) {}
        }
    }

    if (historyFetchPromise && !forceRefresh) {
        return historyFetchPromise; 
    }

    historyFetchPromise = (async () => {
        const historyCollectionRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'history');
        try {
            const d = new Date();
            // 🚨 기존 2개월 -> 1개월로 축소 (기본 읽기 비용 50% 절감)
            d.setMonth(d.getMonth() - 1); 
            const oneMonthAgoStr = d.toISOString().split('T')[0];

            const q = query(historyCollectionRef, where(documentId(), ">=", oneMonthAgoStr));
            const querySnapshot = await getDocs(q);
            
            const dataMap = new Map();
            querySnapshot.forEach((doc) => {
                const docData = doc.data();
                if (docData) dataMap.set(doc.id, { id: doc.id, ...docData });
            });

            const today = getTodayDateString();
            let minDate = today;
            if (dataMap.size > 0) {
                const keys = Array.from(dataMap.keys());
                keys.sort();
                minDate = keys[0];
            }

            const fullHistory = [];
            const current = new Date(minDate);
            const end = new Date(today);

            while (current <= end) {
                const dateStr = current.toISOString().slice(0, 10);
                if (dataMap.has(dateStr)) {
                    fullHistory.push(dataMap.get(dateStr));
                } else {
                    fullHistory.push({
                        id: dateStr, workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [],
                        management: { revenue: 0, orderCount: 0, inventoryQty: 0, inventoryAmt: 0 }, inspectionList: []
                    });
                }
                current.setDate(current.getDate() + 1);
            }

            fullHistory.sort((a, b) => b.id.localeCompare(a.id));
            State.allHistoryData.length = 0; 
            State.allHistoryData.push(...fullHistory); 
            
            isHistoryCached = true; 
            
            // ✨ 성공적으로 가져왔다면 브라우저 메모리에 캐싱
            sessionStorage.setItem('historyDataCache', JSON.stringify(State.allHistoryData));
            sessionStorage.setItem('historyDataCacheTime', Date.now().toString());

            return State.allHistoryData;
        } catch (error) {
            console.error('Error fetching all history data:', error);
            State.allHistoryData.length = 0;
            return [];
        } finally {
            historyFetchPromise = null;
        }
    })();

    return historyFetchPromise;
}

export async function addHistoryWorkRecord(dateKey, newRecordData) {
    const todayKey = getTodayDateString();

    if (newRecordData.startTime && newRecordData.endTime && !newRecordData.duration) {
        newRecordData.duration = calcElapsedMinutes(newRecordData.startTime, newRecordData.endTime, newRecordData.pauses || []);
    }
    
    if (newRecordData.status === 'completed' && Math.round(newRecordData.duration || 0) <= 0) return;

    if (dateKey === todayKey) {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', newRecordData.id);
        await setDoc(docRef, newRecordData);
        await syncTodayToHistory();
        clearLocalCache();
        return;
    }

    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    let dayData = dayIndex > -1 ? State.allHistoryData[dayIndex] : null;
    
    if (!dayData) {
        dayData = { id: dateKey, workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [] };
        State.allHistoryData.push(dayData);
        State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
    }

    if (!dayData.workRecords) dayData.workRecords = [];
    dayData.workRecords.push(newRecordData);

    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
    await setDoc(historyDocRef, { workRecords: dayData.workRecords }, { merge: true });
    clearLocalCache();
}

export async function updateHistoryWorkRecord(dateKey, recordId, updateData) {
    const todayKey = getTodayDateString();

    if (dateKey === todayKey) {
        const localRecord = (State.appState.workRecords || []).find(r => r.id === recordId);
        if (!localRecord) {
             try {
                const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
                if (dayIndex > -1) {
                    const dayData = State.allHistoryData[dayIndex];
                    const recIdx = dayData.workRecords.findIndex(r => r.id === recordId);
                    if (recIdx > -1) return await updateHistoryDirectly(dateKey, recordId, updateData);
                }
             } catch(e) {}
             throw new Error("기록을 찾을 수 없습니다.");
        }

        let newDuration = localRecord.duration;
        let newStatus = updateData.status || localRecord.status;

        if (updateData.startTime || updateData.endTime || updateData.pauses) {
            const start = updateData.startTime || localRecord.startTime;
            const end = updateData.endTime || localRecord.endTime;
            const pauses = updateData.pauses || localRecord.pauses || [];
            if (end) newDuration = calcElapsedMinutes(start, end, pauses);
            updateData.duration = newDuration;
        }

        if (newStatus === 'completed' && newDuration !== null && Math.round(newDuration) <= 0) {
            await deleteHistoryWorkRecord(dateKey, recordId);
            return;
        }
        
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', recordId);
        await updateDoc(docRef, updateData);
        await syncTodayToHistory(); 
        clearLocalCache();
        return;
    }

    await updateHistoryDirectly(dateKey, recordId, updateData);
}

async function updateHistoryDirectly(dateKey, recordId, updateData) {
    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex === -1) throw new Error("이력 없음");

    const dayData = State.allHistoryData[dayIndex];
    const recordIndex = dayData.workRecords.findIndex(r => r.id === recordId);
    if (recordIndex === -1) throw new Error("기록 없음");

    const originalRecord = dayData.workRecords[recordIndex];
    const updatedRecord = { ...originalRecord, ...updateData };

    if (updateData.startTime || updateData.endTime || originalRecord.pauses) {
        const start = updateData.startTime || originalRecord.startTime;
        const end = updateData.endTime || originalRecord.endTime;
        const pauses = updateData.pauses || originalRecord.pauses || [];
        updatedRecord.duration = calcElapsedMinutes(start, end, pauses);
    }

    if (updatedRecord.status === 'completed' && Math.round(updatedRecord.duration || 0) <= 0) {
        await deleteHistoryWorkRecord(dateKey, recordId);
        return;
    }

    dayData.workRecords[recordIndex] = updatedRecord;
    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
    await setDoc(historyDocRef, { workRecords: dayData.workRecords }, { merge: true });
    clearLocalCache();
}

export async function deleteHistoryWorkRecord(dateKey, recordId) {
    const todayKey = getTodayDateString();

    if (dateKey === todayKey) {
        const dailyRecordRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', recordId);
        const dailySnap = await getDoc(dailyRecordRef);
        
        if (dailySnap.exists()) {
            await deleteDoc(dailyRecordRef);
            await syncTodayToHistory();
            clearLocalCache();
            return;
        }
    }

    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex === -1) throw new Error("해당 날짜의 이력을 찾을 수 없습니다.");

    const dayData = State.allHistoryData[dayIndex];
    const newRecords = dayData.workRecords.filter(r => r.id !== recordId);

    if (dayData.workRecords.length === newRecords.length) return;

    dayData.workRecords = newRecords; 
    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
    await setDoc(historyDocRef, { workRecords: newRecords }, { merge: true });
    clearLocalCache();
}

export async function saveManagementData(dateKey, managementData) {
    const todayKey = getTodayDateString();

    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex > -1) {
        State.allHistoryData[dayIndex].management = managementData;
    } else {
        State.allHistoryData.push({
            id: dateKey, workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], management: managementData
        });
        State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
    }

    const updates = { management: managementData };

    try {
        if (dateKey === todayKey) await setDoc(getDailyDocRef(), updates, { merge: true });
        const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
        await setDoc(historyDocRef, updates, { merge: true });
        clearLocalCache();
    } catch (e) {
        console.error("Error saving management data:", e);
        throw e; 
    }
}

export async function checkUnverifiedRecords(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedUnverifiedDates && (now - lastUnverifiedCheckTime < 3600000)) {
        return cachedUnverifiedDates;
    }

    // ✨ 브라우저 세션 스토리지 캐시 확인
    if (!forceRefresh) {
        const cached = sessionStorage.getItem('unverifiedDataCache');
        const cacheTime = sessionStorage.getItem('unverifiedDataCacheTime');
        if (cached && cacheTime && (now - parseInt(cacheTime) < 300000)) { // 5분
            try {
                cachedUnverifiedDates = JSON.parse(cached);
                lastUnverifiedCheckTime = now;
                return cachedUnverifiedDates;
            } catch(e) {}
        }
    }

    if (unverifiedFetchPromise && !forceRefresh) {
        return unverifiedFetchPromise;
    }

    unverifiedFetchPromise = (async () => {
        const historyCol = collection(State.db, 'artifacts', 'team-work-logger-v2', 'history');
        
        try {
            const d = new Date();
            // 🚨 기존 14일 -> 7일로 축소하여 읽기 요금 반토막
            d.setDate(d.getDate() - 7); 
            const sevenDaysAgoStr = d.toISOString().split('T')[0];

            const q = query(historyCol, where(documentId(), ">=", sevenDaysAgoStr)); 
            const snapshot = await getDocs(q);
            
            const unverifiedDates = [];
            const today = getTodayDateString();

            snapshot.forEach(doc => {
                const data = doc.data();
                if (doc.id !== today) {
                    const hasQuantities = data.taskQuantities && Object.keys(data.taskQuantities).length > 0;
                    if (hasQuantities && !data.isQuantityVerified) unverifiedDates.push(doc.id);
                }
            });

            unverifiedDates.sort();
            cachedUnverifiedDates = unverifiedDates;
            lastUnverifiedCheckTime = Date.now();
            
            sessionStorage.setItem('unverifiedDataCache', JSON.stringify(unverifiedDates));
            sessionStorage.setItem('unverifiedDataCacheTime', Date.now().toString());

            return unverifiedDates; 
        } catch (e) {
            console.error("Failed to check unverified records:", e);
            return [];
        } finally {
            unverifiedFetchPromise = null;
        }
    })();

    return unverifiedFetchPromise;
}