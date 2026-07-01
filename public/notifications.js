/* ===== Toast Notifications ===== */
function showToast(message, type = 'info') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/* ===== Custom Confirm (replaces confirm()) ===== */
function showConfirm(message, title = 'تأكيد', icon = '⚠️') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-icon">${icon}</div>
        <div class="confirm-title">${title}</div>
        <div class="confirm-message">${message}</div>
        <div class="confirm-actions">
          <button class="btn btn-primary" id="confirmYes">نعم</button>
          <button class="btn btn-outline" id="confirmNo">إلغاء</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        overlay.remove();
        resolve(true);
      }
      if (e.key === 'Escape') {
        overlay.remove();
        resolve(false);
      }
    });
    // Focus the yes button
    setTimeout(() => overlay.querySelector('#confirmYes')?.focus(), 50);

    overlay.querySelector('#confirmYes').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });

    overlay.querySelector('#confirmNo').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
  });
}

/* ===== Order Notification Popup (for owner dashboard) ===== */
function showOrderNotificationPopup() {
  const overlay = document.createElement('div');
  overlay.id = 'orderNotificationPopup';
  overlay.className = 'order-notify-overlay';
  overlay.innerHTML = `
    <div class="order-notify-box">
      <div class="notify-icon">🔔</div>
      <div class="notify-title">طلب جديد!</div>
      <div class="notify-message">لقد وصل طلب جديد. هل تريد معالجته الآن؟</div>
      <div class="notify-actions">
        <button class="btn btn-primary" onclick="processNewOrder()">📋 معالجة الطلب</button>
        <button class="btn btn-outline" onclick="skipOrderNotification()">⏭️ تخطي</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function processNewOrder() {
  const popup = document.getElementById('orderNotificationPopup');
  if (popup) popup.remove();
  // Switch to orders tab
  const ordersTab = document.querySelector('.tab[onclick*="switchTab(\'orders\'"]');
  if (ordersTab) ordersTab.click();
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function skipOrderNotification() {
  const popup = document.getElementById('orderNotificationPopup');
  if (popup) popup.remove();
}

/* ===== Share Receipt (for mobile) ===== */
async function shareReceipt(title, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (e) { /* fallback */ }
  }
  // Fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(text);
    showToast('تم نسخ الفاتورة إلى الحافظة 📋', 'success');
  } catch (e) {
    showToast('حدد النص وانسخه يدوياً', 'info');
  }
}
