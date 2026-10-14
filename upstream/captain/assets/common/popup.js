let errorPopupOnClose = null;

function ensureErrorPopup() {
    if (!document.getElementById('posnic-error-popup-style')) {
        const style = document.createElement('style');
        style.id = 'posnic-error-popup-style';
        style.textContent = `
            #error-popup-overlay {
                position: fixed; inset: 0; z-index: 2147483646;
                display: none; align-items: center; justify-content: center;
                padding: 20px; background: rgba(15, 23, 42, .62);
                backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
            }
            #error-popup {
                width: min(340px, 100%); box-sizing: border-box;
                padding: 22px 20px 18px; border-radius: 18px;
                background: #fff; color: #1f2937; text-align: center;
                box-shadow: 0 24px 60px rgba(15, 23, 42, .3);
            }
            #error-popup-title {
                margin-bottom: 9px; color: #dc2626;
                font-size: 17px; font-weight: 800;
            }
            #error-popup-message {
                margin-bottom: 18px; color: #4b5563;
                font-size: 14px; line-height: 1.55; overflow-wrap: anywhere;
            }
            #error-popup-close {
                min-width: 110px; min-height: 44px; border: 0;
                border-radius: 12px; background: #ff7a3c; color: #fff;
                font-size: 14px; font-weight: 750; cursor: pointer;
            }
        `;
        document.head.appendChild(style);
    }

    let overlay = document.getElementById('error-popup-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'error-popup-overlay';
        overlay.innerHTML = `
            <div id="error-popup" role="alertdialog" aria-modal="true" aria-labelledby="error-popup-title">
                <div id="error-popup-title">Unable to continue</div>
                <div id="error-popup-message">Something went wrong.</div>
                <button type="button" id="error-popup-close">OK</button>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    const closeButton = document.getElementById('error-popup-close');
    if (closeButton && !closeButton.dataset.popupBound) {
        closeButton.dataset.popupBound = '1';
        closeButton.onclick = closeErrorPopup;
    }
    return overlay;
}

function showErrorPopup(message, onClose) {
    const overlay = ensureErrorPopup();
    const msgEl = document.getElementById('error-popup-message');
    if (msgEl) msgEl.textContent = message || 'Something went wrong.';
    if (overlay) overlay.style.display = 'flex';

    // optional callback when user presses OK
    errorPopupOnClose = (typeof onClose === 'function') ? onClose : null;
    const closeButton = document.getElementById('error-popup-close');
    if (closeButton) setTimeout(() => closeButton.focus(), 0);
}

function closeErrorPopup() {
    const overlay = document.getElementById('error-popup-overlay');
    if (overlay) overlay.style.display = 'none';

    if (typeof errorPopupOnClose === 'function') {
        const cb = errorPopupOnClose;
        errorPopupOnClose = null;   // avoid double-call
        cb();
    }
}
