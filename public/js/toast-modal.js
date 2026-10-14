/**
 * In-Page Toast and Modal System
 * Guarantees ZERO usage of window.alert, window.confirm, window.prompt, window.close, or window.open.
 */

(function () {
  // Ensure Toast Container exists
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  // Ensure Modal Container exists
  let modalBackdrop = document.getElementById('modal-backdrop');
  if (!modalBackdrop) {
    modalBackdrop = document.createElement('div');
    modalBackdrop.id = 'modal-backdrop';
    modalBackdrop.innerHTML = `
      <div class="modal-window" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 id="modal-title">Notice</h3>
          <button type="button" class="toast-close" id="modal-close-btn" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body" id="modal-body"></div>
        <div class="modal-footer" id="modal-footer"></div>
      </div>
    `;
    document.body.appendChild(modalBackdrop);
  }

  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalFooter = document.getElementById('modal-footer');
  const modalCloseBtn = document.getElementById('modal-close-btn');

  let activeModalCleanup = null;

  function closeModal() {
    modalBackdrop.classList.remove('active');
    if (activeModalCleanup) {
      activeModalCleanup();
      activeModalCleanup = null;
    }
  }

  if (modalCloseBtn) {
    modalCloseBtn.onclick = closeModal;
  }

  modalBackdrop.onclick = (e) => {
    if (e.target === modalBackdrop) {
      closeModal();
    }
  };

  /**
   * Display a non-blocking in-page toast notification.
   * @param {string} message 
   * @param {'info'|'success'|'danger'|'warning'} type 
   * @param {number} duration 
   */
  window.showToast = function (message, type = 'info', duration = 3500) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'danger') icon = '⚠️';
    if (type === 'warning') icon = '⚡';

    toast.innerHTML = `
      <span style="font-size:16px;">${icon}</span>
      <div class="toast-msg">${message}</div>
      <button class="toast-close" aria-label="Dismiss">&times;</button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    const removeToast = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 200);
    };

    closeBtn.onclick = removeToast;
    toastContainer.appendChild(toast);

    if (duration > 0) {
      setTimeout(removeToast, duration);
    }
  };

  /**
   * Display an in-page modal dialog.
   */
  window.showModal = function ({
    title = 'System Notice',
    body = '',
    confirmText = 'OK',
    cancelText = null,
    onConfirm = null,
    onCancel = null,
    isDanger = false
  }) {
    modalTitle.textContent = title;
    
    if (typeof body === 'string') {
      modalBody.innerHTML = body;
    } else {
      modalBody.innerHTML = '';
      modalBody.appendChild(body);
    }

    modalFooter.innerHTML = '';

    if (cancelText) {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn';
      cancelBtn.textContent = cancelText;
      cancelBtn.onclick = () => {
        closeModal();
        if (onCancel) onCancel();
      };
      modalFooter.appendChild(cancelBtn);
    }

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = `btn ${isDanger ? 'btn-danger' : 'btn-primary'}`;
    confirmBtn.textContent = confirmText;
    confirmBtn.onclick = () => {
      closeModal();
      if (onConfirm) onConfirm();
    };
    modalFooter.appendChild(confirmBtn);

    modalBackdrop.classList.add('active');
    confirmBtn.focus();
  };

  /**
   * Display an in-page prompt modal to get user input without window.prompt.
   */
  window.showPromptModal = function ({
    title = 'Input Required',
    body = '',
    placeholder = '',
    defaultValue = '',
    confirmText = 'Submit',
    cancelText = 'Cancel',
    onConfirm = null,
    onCancel = null
  }) {
    const container = document.createElement('div');
    if (body) {
      const p = document.createElement('p');
      p.style.marginBottom = '12px';
      p.innerHTML = body;
      container.appendChild(p);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input';
    input.placeholder = placeholder;
    input.value = defaultValue;
    container.appendChild(input);

    window.showModal({
      title,
      body: container,
      confirmText,
      cancelText,
      onConfirm: () => {
        if (onConfirm) onConfirm(input.value);
      },
      onCancel
    });

    setTimeout(() => input.focus(), 50);

    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        closeModal();
        if (onConfirm) onConfirm(input.value);
      }
    };
  };

  /**
   * Copy string to clipboard with mobile and desktop support.
   */
  window.copyToClipboard = function (text, successMsg = 'Copied to clipboard!') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        window.showToast(successMsg, 'success', 2000);
      }).catch(() => {
        fallbackCopy(text, successMsg);
      });
    } else {
      fallbackCopy(text, successMsg);
    }
  };

  function fallbackCopy(text, successMsg) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      window.showToast(successMsg, 'success', 2000);
    } catch (err) {
      window.showToast('Unable to copy', 'danger', 2000);
    }
    document.body.removeChild(textArea);
  }

  // Safety overrides to completely prevent native popups
  window.alert = function (msg) {
    window.showToast(msg, 'warning', 4000);
  };
  window.confirm = function (msg) {
    console.warn('Blocked window.confirm call; use showModal instead:', msg);
    return false;
  };
  window.prompt = function (msg) {
    console.warn('Blocked window.prompt call; use showPromptModal instead:', msg);
    return null;
  };
})();
