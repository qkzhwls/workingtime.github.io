// === js/inspection-media.js ===
import * as DOM from './dom-elements.js';
import { showToast } from './utils.js';
import { searchProductHistory } from './inspection-logic.js';

export let html5QrCode = null;
export let currentImageBase64 = null;
export let manualImageBase64 = null;

export const setCurrentImageBase64 = (val) => { currentImageBase64 = val; };

export const toggleScanner = () => {
    if (DOM.inspScannerContainer.classList.contains('hidden')) {
        DOM.inspScannerContainer.classList.remove('hidden');
        startScanner();
    } else {
        stopScanner();
        DOM.inspScannerContainer.classList.add('hidden');
    }
};

const startScanner = () => {
    if (html5QrCode) return; 
    html5QrCode = new Html5Qrcode("reader");
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess)
    .catch(err => {
        console.error("Error starting scanner", err);
        showToast("카메라를 시작할 수 없습니다.", true);
        if(DOM.inspScannerContainer) DOM.inspScannerContainer.classList.add('hidden');
    });
};

const stopScanner = () => {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
            html5QrCode = null;
        }).catch(err => console.error("Failed to stop scanner", err));
    }
};

const onScanSuccess = (decodedText, decodedResult) => {
    showToast(`바코드 인식: ${decodedText}`);
    stopScanner(); 
    if(DOM.inspScannerContainer) DOM.inspScannerContainer.classList.add('hidden');
    if(DOM.inspProductNameInput) DOM.inspProductNameInput.value = decodedText;
    searchProductHistory();
};

export const handleImageSelect = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            let width = img.width;
            let height = img.height;
            if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            currentImageBase64 = canvas.toDataURL('image/jpeg', 0.7); 
            if (DOM.inspImagePreviewBox) {
                DOM.inspImagePreviewBox.classList.remove('hidden');
                if (DOM.inspImagePreviewImg) DOM.inspImagePreviewImg.src = currentImageBase64;
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

export const clearImageState = () => {
    currentImageBase64 = null;
    if (DOM.inspImagePreviewBox) DOM.inspImagePreviewBox.classList.add('hidden');
    if (DOM.inspImageInput) DOM.inspImageInput.value = '';
};

export const handleManualImageSelect = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            let width = img.width;
            let height = img.height;
            if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            manualImageBase64 = canvas.toDataURL('image/jpeg', 0.7); 
            
            const previewContainer = document.getElementById('manual-insp-image-preview-container');
            const previewImg = document.getElementById('manual-insp-image-preview');
            if (previewContainer && previewImg) {
                previewContainer.classList.remove('hidden');
                previewImg.src = manualImageBase64;
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

export const clearManualImageState = () => {
    manualImageBase64 = null;
    const previewContainer = document.getElementById('manual-insp-image-preview-container');
    const input = document.getElementById('manual-insp-image');
    if (previewContainer) previewContainer.classList.add('hidden');
    if (input) input.value = '';
};