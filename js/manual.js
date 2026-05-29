// === js/manual.js ===
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc, serverTimestamp, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { firebaseConfig, loadAppConfig } from './config.js';

let app, db, auth, storage;
let appConfig = {};
let quillEditor;
let manualList = [];
let currentEditingId = null;
let selectedFile = null;
let currentZoom = 80; 

let currentUserName = '';
let isAdmin = false;

// ✨ 대분류 Header2(h2), 단계 Header3(h3), 구분선(hr)이 적용된 템플릿
const MANUAL_TEMPLATE = `
    <h2 style="color: #1d4ed8;"><strong>1. 🔑 사전 준비 & 참고사항</strong></h2>
    <ul>
        <li><strong>필요 권한/계정:</strong> </li>
        <li><strong>접속 링크:</strong> </li>
        <li><strong>기타 참고사항:</strong> </li>
    </ul>
    <p><br></p>
    <hr>
    <p><br></p>

    <h2 style="color: #1d4ed8;"><strong>2. 🏃‍♂️ 업무 진행 절차</strong></h2>
    <p><strong style="color: #ef4444;">※ 이미지는 화면 캡처 후 여기에 바로 붙여넣기(Ctrl+V) 하세요.</strong></p>
    <h3><strong>▶ 1단계</strong></h3>
    <p>&nbsp;&nbsp;&nbsp;&nbsp;내용을 입력하세요</p>
    <h3><strong>▶ 2단계</strong></h3>
    <p>&nbsp;&nbsp;&nbsp;&nbsp;내용을 입력하세요</p>
    <h3><strong>▶ 3단계</strong></h3>
    <p>&nbsp;&nbsp;&nbsp;&nbsp;내용을 입력하세요</p>
    <h3><strong>▶ 4단계</strong></h3>
    <p>&nbsp;&nbsp;&nbsp;&nbsp;내용을 입력하세요</p>
    <h3><strong>▶ 5단계</strong></h3>
    <p>&nbsp;&nbsp;&nbsp;&nbsp;내용을 입력하세요</p>
    <p><br></p>
    <hr>
    <p><br></p>

    <h2 style="color: #1d4ed8;"><strong>3. 🚨 필수 주의사항 및 예외</strong></h2>
    <ul>
        <li>업무 진행 시 주의해야 할 점이나 빈번한 실수 등을 적어주세요.</li>
        <li><strong>문제 발생 시 대처:</strong> </li>
    </ul>
    <p><br></p>
    <hr>
    <p><br></p>

    <h2 style="color: #1d4ed8;"><strong>4. 📎 참고 파일</strong></h2>
    <p>※ 하단의 <strong>'파일 찾기'</strong> 버튼을 눌러 참고할 파일을 첨부해 주세요.</p>
`;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        storage = getStorage(app);
    } catch (error) {
        console.error("Firebase 초기화 실패:", error);
        alert("시스템을 초기화할 수 없습니다.");
        return;
    }

    const BlockEmbed = Quill.import('blots/block/embed');
    class DividerBlot extends BlockEmbed {}
    DividerBlot.blotName = 'divider';
    DividerBlot.tagName = 'hr';
    Quill.register(DividerBlot);

    const imageHandler = () => {
        const input = document.createElement('input');
        input.setAttribute('type', 'file');
        input.setAttribute('accept', 'image/*');
        input.click();

        input.onchange = async () => {
            const file = input.files[0];
            if (file) await uploadInlineImageToStorage(file);
        };
    };

    quillEditor = new Quill('#quill-editor', {
        theme: 'snow',
        placeholder: '여기에 업무 매뉴얼 내용을 자세히 작성하세요. (이미지는 화면 캡처 후 Ctrl+V로 바로 붙여넣을 수 있습니다)',
        modules: {
            imageResize: { 
                displaySize: true 
            },
            keyboard: {
                bindings: {
                    disableAutoList: {
                        key: ' ',
                        collapsed: true,
                        prefix: /^\s*?(\d+\.|-|\*)$/,
                        handler: function(range, context) {
                            this.quill.insertText(range.index, ' ', 'user');
                            this.quill.setSelection(range.index + 1, 'silent');
                            return false; 
                        }
                    }
                }
            },
            toolbar: {
                container: [
                    [{ 'header': [1, 2, 3, 4, false] }, { 'size': ['small', false, 'large', 'huge'] }], 
                    ['bold', 'italic', 'underline', 'strike', 'blockquote'], 
                    [{ 'color': [] }, { 'background': [] }], 
                    [{ 'align': [] }], 
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }, { 'indent': '-1'}, { 'indent': '+1' }], 
                    ['link', 'image', 'video'], 
                    ['clean'] 
                ],
                handlers: {
                    image: imageHandler
                }
            }
        }
    });

    applyZoom();

    quillEditor.root.addEventListener('paste', async (e) => {
        if (e.clipboardData && e.clipboardData.items && e.clipboardData.items.length) {
            const items = e.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    e.preventDefault(); 
                    const file = items[i].getAsFile();
                    if(file) await uploadInlineImageToStorage(file);
                }
            }
        }
    });

    quillEditor.root.addEventListener('drop', async (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
            let hasImage = false;
            for (let i = 0; i < e.dataTransfer.files.length; i++) {
                if (e.dataTransfer.files[i].type.indexOf('image') !== -1) {
                    hasImage = true;
                }
            }
            if (hasImage) {
                e.preventDefault(); 
                for (let i = 0; i < e.dataTransfer.files.length; i++) {
                    const file = e.dataTransfer.files[i];
                    if (file.type.indexOf('image') !== -1) {
                        await uploadInlineImageToStorage(file);
                    }
                }
            }
        }
    });

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            appConfig = await loadAppConfig(db);
            const userEmailLower = (user.email || '').toLowerCase();
            
            isAdmin = (appConfig.memberRoles && appConfig.memberRoles[userEmailLower] === 'admin');

            const emails = appConfig.memberEmails || {};
            currentUserName = Object.keys(emails).find(name => (emails[name] || '').toLowerCase() === userEmailLower);
            if (!currentUserName) currentUserName = userEmailLower; 
            
            document.getElementById('btn-new-manual').classList.remove('hidden');

            populateCategories(); 
            populateManagers(); 
            populateAccessMembers(); 
            setupEventListeners();
            loadManuals();
        } else {
            alert("로그인이 필요합니다.");
            window.location.href = 'index.html';
        }
    });
});

async function uploadInlineImageToStorage(file) {
    const btn = document.getElementById('btn-save-manual');
    const originalText = btn.textContent;
    btn.textContent = '이미지 업로드 중...';
    btn.disabled = true;

    try {
        const ext = file.name ? file.name.split('.').pop() : 'png';
        const safeName = `manual_inline_${Date.now()}_${Math.floor(Math.random()*1000)}.${ext}`;
        const storageRef = ref(storage, `manuals/images/${safeName}`);

        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        const range = quillEditor.getSelection(true); 
        quillEditor.insertEmbed(range.index, 'image', url);
        quillEditor.setSelection(range.index + 1);
    } catch (e) {
        console.error("본문 이미지 업로드 실패:", e);
        alert("이미지를 서버에 업로드하는데 실패했습니다.\n- 용량이 너무 큰 이미지이거나 네트워크 연결이 끊겼습니다.\n- 또는 Firebase CORS 권한 설정이 필요합니다.");
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

function populateCategories() {
    const select = document.getElementById('edit-category');
    select.innerHTML = '';
    const groups = appConfig.teamGroups || [];
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '공통 지침';
    defaultOpt.textContent = '공통 지침';
    select.appendChild(defaultOpt);

    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.name; 
        opt.textContent = `${g.name} 매뉴얼`;
        select.appendChild(opt);
    });
}

function populateManagers() {
    const select = document.getElementById('edit-manager');
    select.innerHTML = '<option value="">선택 안함</option>';
    const members = new Set();
    (appConfig.teamGroups || []).forEach(g => {
        (g.members || []).forEach(m => members.add(m));
    });
    
    Array.from(members).sort().forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        select.appendChild(opt);
    });
}

function populateAccessMembers() {
    const container = document.getElementById('edit-access-members-container');
    container.innerHTML = '';
    const groups = appConfig.teamGroups || [];
    
    groups.forEach(g => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'flex flex-col gap-1 w-full md:w-auto min-w-[120px]';
        groupDiv.innerHTML = `<span class="text-[10px] font-extrabold text-indigo-500 mb-0.5">${g.name}</span>`;
        
        const membersDiv = document.createElement('div');
        membersDiv.className = 'flex flex-wrap gap-2';
        
        (g.members || []).forEach(m => {
            const label = document.createElement('label');
            label.className = 'flex items-center gap-1.5 text-[11px] font-bold text-gray-600 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 px-1.5 py-1 rounded transition select-none';
            label.innerHTML = `<input type="checkbox" value="${m}" class="access-member-cb w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"> <span>${m}</span>`;
            membersDiv.appendChild(label);
        });
        groupDiv.appendChild(membersDiv);
        container.appendChild(groupDiv);
    });
}

const applyZoom = () => {
    const zoomLevelEl = document.getElementById('zoom-level');
    if(zoomLevelEl) zoomLevelEl.textContent = `${currentZoom}%`;
    const viewBody = document.getElementById('view-body');
    const editorBody = document.querySelector('.ql-editor');
    if(viewBody) viewBody.style.zoom = `${currentZoom}%`;
    if(editorBody) editorBody.style.zoom = `${currentZoom}%`;
};

function setupEventListeners() {
    document.getElementById('btn-close-window').addEventListener('click', () => {
        window.close(); 
    });

    document.getElementById('manual-search-input').addEventListener('input', renderList);

    document.getElementById('edit-access-level').addEventListener('change', (e) => {
        const container = document.getElementById('edit-access-members-container');
        if (e.target.value === 'private') {
            container.classList.remove('hidden');
        } else {
            container.classList.add('hidden');
            document.querySelectorAll('.access-member-cb').forEach(cb => cb.checked = false);
        }
    });

    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
        if (currentZoom < 200) { currentZoom += 10; applyZoom(); }
    });
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
        if (currentZoom > 50) { currentZoom -= 10; applyZoom(); }
    });

    document.getElementById('btn-new-manual').addEventListener('click', () => {
        openEditor();
    });

    document.getElementById('btn-cancel-edit').addEventListener('click', () => {
        document.getElementById('manual-edit-area').classList.add('hidden');
        selectedFile = null;
    });

    document.getElementById('btn-trigger-upload').addEventListener('click', () => {
        document.getElementById('edit-file-upload').click();
    });

    document.getElementById('edit-file-upload').addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            selectedFile = e.target.files[0];
            document.getElementById('upload-file-name').innerHTML = `<span class="text-indigo-600 font-bold">✓ ${selectedFile.name}</span>`;
        }
    });

    document.getElementById('btn-save-manual').addEventListener('click', saveManual);
    document.getElementById('btn-delete-manual').addEventListener('click', deleteManual);
    document.getElementById('btn-edit-manual').addEventListener('click', () => {
        const item = manualList.find(m => m.id === currentEditingId);
        if (item) openEditor(item);
    });

    document.querySelectorAll('.symbol-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const symbol = e.target.textContent;
            const range = quillEditor.getSelection(true); 
            quillEditor.insertText(range.index, symbol); 
            quillEditor.setSelection(range.index + symbol.length); 
        });
    });

    document.getElementById('btn-divider')?.addEventListener('click', () => {
        const range = quillEditor.getSelection(true);
        quillEditor.insertText(range.index, '\n', 'user');
        quillEditor.insertEmbed(range.index + 1, 'divider', true, 'user');
        quillEditor.insertText(range.index + 2, '\n', 'user');
        quillEditor.setSelection(range.index + 3, 'silent');
    });

    document.getElementById('btn-load-template')?.addEventListener('click', () => {
        const currentContent = quillEditor.root.innerHTML.trim();
        if (currentContent !== '' && currentContent !== '<p><br></p>') {
            if (!confirm("현재 작성된 내용이 지워지고 기본 양식으로 덮어씌워집니다. 계속하시겠습니까?")) {
                return;
            }
        }
        quillEditor.root.innerHTML = MANUAL_TEMPLATE;
    });

    document.getElementById('btn-add-step')?.addEventListener('click', () => {
        let range = quillEditor.getSelection(true);
        let index = range ? range.index : quillEditor.getLength();
        
        const stepHtml = `
            <h3><strong>▶ 추가 단계</strong></h3>
            <p>&nbsp;&nbsp;&nbsp;&nbsp;내용을 입력하세요</p>
            <p><br></p>
        `;
        
        quillEditor.clipboard.dangerouslyPasteHTML(index, stepHtml);
    });
}

async function loadManuals() {
    const listContainer = document.getElementById('manual-list-container');
    listContainer.innerHTML = '<div class="flex justify-center p-5 text-gray-400 text-sm">데이터를 불러오는 중...</div>';
    
    try {
        const manualCol = collection(db, 'artifacts', 'team-work-logger-v2', 'manuals');
        const q = query(manualCol, orderBy('createdAt', 'desc'));
        const snap = await getDocs(q);
        
        manualList = [];
        snap.forEach(doc => {
            manualList.push({ id: doc.id, ...doc.data() });
        });

        renderList();
    } catch (e) {
        console.error("매뉴얼 로드 실패:", e);
        listContainer.innerHTML = '<div class="text-center p-5 text-red-500 text-sm font-bold">데이터를 불러오지 못했습니다. 새로고침 해주세요.</div>';
    }
}

const formatDateTimeShort = (timestamp) => {
    if (!timestamp) return '-';
    const d = new Date(timestamp.toMillis ? timestamp.toMillis() : timestamp);
    if (isNaN(d)) return '-';
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}.${mm}.${dd}`;
};

// ✨ 폴더형 매뉴얼 목록 렌더링 (파트 뱃지 부활 + 공개/비공개 라인 추가)
function renderList() {
    const searchTerm = document.getElementById('manual-search-input').value.trim().toLowerCase();
    const listContainer = document.getElementById('manual-list-container');
    listContainer.innerHTML = '';

    let filteredList = manualList.filter(item => {
        const titleMatch = (item.title || '').toLowerCase().includes(searchTerm);
        const catMatch = (item.category || '').toLowerCase().includes(searchTerm);
        const managerMatch = (item.manager || '').toLowerCase().includes(searchTerm);
        return titleMatch || catMatch || managerMatch;
    });

    filteredList = filteredList.filter(item => {
        if (isAdmin) return true;
        if (item.author === auth.currentUser.email) return true;
        if (!item.allowedMembers || item.allowedMembers.length === 0) return true;
        return item.allowedMembers.includes(currentUserName);
    });

    if (filteredList.length === 0) {
        listContainer.innerHTML = `<div class="p-6 text-center text-sm text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl mt-4">접근할 수 있는 검색 결과가 없습니다.</div>`;
        return;
    }

    const grouped = {};
    filteredList.forEach(item => {
        const cat = item.category || '공통 지침';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(item);
    });

    Object.keys(grouped).sort().forEach((cat, index) => {
        const isExpanded = searchTerm !== '' || index === 0;

        const folderHeader = document.createElement('div');
        folderHeader.className = 'flex items-center justify-between p-2 mt-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition select-none group';
        folderHeader.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="text-sm opacity-80">📁</span>
                <span class="text-xs font-bold text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                    ${cat} <span class="text-gray-400 font-normal">(${grouped[cat].length})</span>
                </span>
            </div>
            <svg class="w-4 h-4 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
        `;

        const itemsContainer = document.createElement('div');
        itemsContainer.className = `flex flex-col gap-1.5 pl-2 border-l-2 border-gray-100 dark:border-gray-800 ml-3 mt-1.5 mb-3 overflow-hidden transition-all duration-300 ${isExpanded ? '' : 'hidden'}`;

        folderHeader.addEventListener('click', () => {
            const svg = folderHeader.querySelector('svg');
            if (itemsContainer.classList.contains('hidden')) {
                itemsContainer.classList.remove('hidden');
                svg.classList.add('rotate-180');
            } else {
                itemsContainer.classList.add('hidden');
                svg.classList.remove('rotate-180');
            }
        });

        listContainer.appendChild(folderHeader);

        grouped[cat].forEach(item => {
            const div = document.createElement('div');
            div.className = 'p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all group flex flex-col gap-1 relative overflow-hidden';
            
            const dateStr = formatDateTimeShort(item.updatedAt || item.createdAt);
            const hasFile = item.fileUrl ? '<span class="text-[10px] bg-indigo-50 text-indigo-600 px-1 rounded font-bold border border-indigo-100 shadow-sm ml-1">첨부</span>' : '';
            
            const isPrivate = item.allowedMembers && item.allowedMembers.length > 0;
            const privateBadge = isPrivate ? '<span class="text-[10px] bg-red-50 text-red-600 px-1 rounded font-bold border border-red-100 shadow-sm ml-1">🔒 비공개</span>' : '';
            
            // ✨ 공개/비공개 여부에 따른 우측 색상 라인 (비공개: 빨간색, 공개: 녹색)
            const sideBar = isPrivate 
                ? '<div class="absolute top-0 right-0 w-1.5 h-full bg-red-400 dark:bg-red-500"></div>' 
                : '<div class="absolute top-0 right-0 w-1.5 h-full bg-emerald-400 dark:bg-emerald-500"></div>';

            div.innerHTML = `
                ${sideBar}
                <div class="flex items-center justify-between mb-1 pr-2">
                    <span class="text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800 px-1.5 py-0.5 rounded font-bold shadow-sm truncate max-w-[150px]">${item.category || '공통 지침'}</span>
                </div>
                <div class="text-sm font-extrabold text-gray-800 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition leading-snug break-all pr-3">
                    ${item.title} ${privateBadge} ${hasFile}
                </div>
                <div class="flex items-center justify-between mt-1.5 pr-2">
                    <span class="text-[10px] text-gray-500 font-medium">담당: ${item.manager || '<span class="text-gray-300">미지정</span>'}</span>
                    <span class="text-[10px] text-gray-400 font-mono tracking-tighter">수정: ${dateStr}</span>
                </div>
            `;

            div.addEventListener('click', () => viewManual(item.id));
            itemsContainer.appendChild(div);
        });

        listContainer.appendChild(itemsContainer);
    });
}

function openEditor(item = null) {
    currentEditingId = item ? item.id : null;
    selectedFile = null;

    document.getElementById('edit-title').value = item ? item.title : '';
    
    const catSelect = document.getElementById('edit-category');
    if (item && item.category) catSelect.value = item.category;
    else catSelect.selectedIndex = 0;

    const managerSelect = document.getElementById('edit-manager');
    if (item && item.manager) managerSelect.value = item.manager;
    else managerSelect.selectedIndex = 0;
    
    const accessSelect = document.getElementById('edit-access-level');
    const accessContainer = document.getElementById('edit-access-members-container');
    document.querySelectorAll('.access-member-cb').forEach(cb => cb.checked = false);

    if (item && item.allowedMembers && item.allowedMembers.length > 0) {
        accessSelect.value = 'private';
        accessContainer.classList.remove('hidden');
        document.querySelectorAll('.access-member-cb').forEach(cb => {
            if (item.allowedMembers.includes(cb.value)) cb.checked = true;
        });
    } else {
        accessSelect.value = 'public';
        accessContainer.classList.add('hidden');
    }

    quillEditor.root.innerHTML = item ? (item.content || '') : MANUAL_TEMPLATE;
    
    const fileNameDisplay = document.getElementById('upload-file-name');
    document.getElementById('edit-file-upload').value = '';
    
    if (item && item.fileUrl) {
        fileNameDisplay.innerHTML = `<span class="text-blue-600 font-bold">💾 기존 첨부파일: ${item.fileName || '유지됨'} (선택 시 교체)</span>`;
    } else {
        fileNameDisplay.textContent = '선택된 파일 없음';
    }

    document.getElementById('manual-edit-area').classList.remove('hidden');
}

async function saveManual() {
    const title = document.getElementById('edit-title').value.trim();
    const category = document.getElementById('edit-category').value;
    const manager = document.getElementById('edit-manager').value;
    const content = quillEditor.root.innerHTML;
    
    if (!title) {
        alert("제목을 반드시 입력해주세요.");
        return;
    }

    const accessLevel = document.getElementById('edit-access-level').value;
    let allowedMembers = [];
    if (accessLevel === 'private') {
        document.querySelectorAll('.access-member-cb:checked').forEach(cb => {
            allowedMembers.push(cb.value);
        });
        if (allowedMembers.length === 0) {
            alert("비공개(특정 인원 열람) 설정 시, 열람을 허용할 인원을 최소 1명 이상 체크해야 합니다.");
            return; 
        }
    }

    const btn = document.getElementById('btn-save-manual');
    btn.disabled = true;
    btn.textContent = '저장 처리 중...';

    try {
        let fileUrl = null;
        let fileName = null;

        const existingItem = manualList.find(m => m.id === currentEditingId);
        if (existingItem) {
            fileUrl = existingItem.fileUrl;
            fileName = existingItem.fileName;
        }

        if (selectedFile) {
            const ext = selectedFile.name.split('.').pop();
            const safeName = `manual_${Date.now()}.${ext}`;
            const storageRef = ref(storage, `manuals/${safeName}`);
            
            await uploadBytes(storageRef, selectedFile);
            fileUrl = await getDownloadURL(storageRef);
            fileName = selectedFile.name;
        }

        if (content.length > 500000) { 
            throw new Error("OVERSIZED_CONTENT");
        }

        const manualData = {
            title,
            category,
            manager,
            content: content === '<p><br></p>' ? '' : content,
            fileUrl: fileUrl || null,
            fileName: fileName || null,
            allowedMembers: allowedMembers, 
            author: auth.currentUser.email,
            updatedAt: serverTimestamp()
        };

        const manualCol = collection(db, 'artifacts', 'team-work-logger-v2', 'manuals');
        
        if (currentEditingId) {
            await setDoc(doc(manualCol, currentEditingId), manualData, { merge: true });
        } else {
            manualData.createdAt = serverTimestamp();
            const newDocRef = doc(manualCol, `doc_${Date.now()}`);
            await setDoc(newDocRef, manualData);
            currentEditingId = newDocRef.id; 
        }

        document.getElementById('manual-edit-area').classList.add('hidden');
        await loadManuals(); 
        
        viewManual(currentEditingId);

    } catch (e) {
        console.error("저장 오류:", e);
        if (e.message === "OVERSIZED_CONTENT" || e.code === "resource-exhausted") {
            alert("저장 실패: 본문 텍스트 용량이 초과되었습니다.\n\n(이미지 업로드가 실패하여 강제로 글자로 변환된 이미지가 남아있을 수 있습니다. 이미지를 지우고 다시 시도하거나 Firebase CORS 설정을 확인해주세요.)");
        } else {
            alert("저장에 실패했습니다. 관리자에게 문의하세요.");
        }
    } finally {
        btn.disabled = false;
        btn.textContent = '저장하기';
    }
}

const formatDateTime = (timestamp) => {
    if (!timestamp) return '-';
    const d = new Date(timestamp.toMillis ? timestamp.toMillis() : timestamp);
    if (isNaN(d)) return '-';
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
};

function viewManual(id) {
    const item = manualList.find(m => m.id === id);
    if (!item) return;

    currentEditingId = id;
    document.getElementById('viewer-empty').classList.add('hidden');
    document.getElementById('viewer-content').classList.remove('hidden');
    document.getElementById('view-title').textContent = item.title;
    document.getElementById('view-type-badge').textContent = item.category || '공통 지침';
    
    const accessBadge = document.getElementById('view-access-badge');
    if (item.allowedMembers && item.allowedMembers.length > 0) {
        accessBadge.classList.remove('hidden');
    } else {
        accessBadge.classList.add('hidden');
    }
    
    document.getElementById('view-manager').innerHTML = item.manager ? `<span class="text-indigo-600">${item.manager}</span>` : '<span class="text-gray-300">미지정</span>';
    document.getElementById('view-created-date').textContent = formatDateTime(item.createdAt);
    document.getElementById('view-updated-date').textContent = formatDateTime(item.updatedAt || item.createdAt);

    document.getElementById('view-body').innerHTML = item.content || '';

    const attachArea = document.getElementById('view-attachment');
    if (item.fileUrl) {
        attachArea.classList.remove('hidden');
        document.getElementById('view-file-name').textContent = item.fileName || '첨부된 파일 확인하기';
        document.getElementById('view-file-link').href = item.fileUrl;
    } else {
        attachArea.classList.add('hidden');
    }

    document.getElementById('btn-edit-manual').classList.remove('hidden');
    document.getElementById('btn-delete-manual').classList.remove('hidden');
}

async function deleteManual() {
    if (!confirm("이 매뉴얼을 정말로 삭제하시겠습니까?\n(복구할 수 없습니다)")) return;
    
    try {
        await deleteDoc(doc(db, 'artifacts', 'team-work-logger-v2', 'manuals', currentEditingId));
        document.getElementById('viewer-content').classList.add('hidden');
        document.getElementById('viewer-empty').classList.remove('hidden');
        currentEditingId = null;
        await loadManuals();
    } catch(e) {
        alert("삭제에 실패했습니다.");
    }
}