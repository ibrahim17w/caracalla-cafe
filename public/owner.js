//owner.js
const API = window.location.origin + '/api';
let token = localStorage.getItem('owner_token');
let allItems = [];
let allCategories = [];
let allOrders = [];
let allSettings = {};
let orderMap = null;
let orderMapMarker = null;
let cafeSettingMap = null;
let cafeSettingMarker = null;
let draggedCategory = null;
let previousOrderCount = null;

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    
    // Windows-style notification: two pleasant sine wave chimes
    const playChime = (freq, start, duration, vol) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      // Smooth envelope
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(vol, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.start(start);
      osc.stop(start + duration);
    };
    
    // Pleasant notification chord: D5 + A5 (like Windows 10 notification)
    playChime(587.33, now, 0.4, 0.8);      // D5
    playChime(880.00, now + 0.08, 0.35, 0.7); // A5 (harmony)
    playChime(1174.66, now + 0.16, 0.3, 0.5); // D6 (bright finish)
    
    setTimeout(() => { ctx.close(); }, 800);
  } catch (e) { console.error('Beep failed', e); }
}

// Check auth
if (token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.role === 'owner' && payload.exp * 1000 > Date.now()) {
      showDashboard();
    } else {
      localStorage.removeItem('owner_token');
    }
  } catch {
    localStorage.removeItem('owner_token');
  }
}

function showDashboard() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  init();
}

function togglePassword() {
  const input = document.getElementById('loginPassword');
  const btn = document.querySelector('.password-toggle');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁️';
  }
}

async function doLogin() {
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');
  errorEl.textContent = '';

  try {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'owner', password })
    });

    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'كلمة المرور غير صحيحة';
      if (data.retryAfter) errorEl.textContent += ` (حاول بعد ${data.retryAfter} ثانية)`;
      return;
    }

    token = data.token;
    localStorage.setItem('owner_token', token);
    showDashboard();
  } catch (e) {
    errorEl.textContent = 'تعذر الاتصال بالخادم';
  }
}

function logout() {
  localStorage.removeItem('owner_token');
  if (ownerRefreshInterval) { clearInterval(ownerRefreshInterval); ownerRefreshInterval = null; }
  location.reload();
}

// Enter key support for login
document.getElementById('loginPassword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLogin();
});

function authHeaders() {
  return { 'Authorization': 'Bearer ' + token };
}

async function init() {
  await Promise.all([loadSettings(), loadCategories(), loadItems(), loadOrders(), loadStats()]);
  generateQR();
  renderItems();
  renderCategories();
  renderOrders();
  populateCategorySelects();
  applySettings();
  
  // Global order polling — slower interval, manual refresh available
  if (ownerRefreshInterval) clearInterval(ownerRefreshInterval);
  ownerRefreshInterval = setInterval(async () => {
    await loadOrders();
    // Only re-render if on orders tab, but always check for new orders
    const ordersTabActive = document.querySelector('.tab.active')?.textContent?.includes('الطلبات');
    if (ordersTabActive) renderOrders();
    loadStats();
  }, 60000); // 60 seconds instead of 10
}

async function loadSettings() {
  const res = await fetch(`${API}/settings`);
  const data = await res.json();
  allSettings = data;
}

async function loadCategories() {
  const res = await fetch(`${API}/categories`);
  allCategories = await res.json();
}

async function loadItems() {
  const res = await fetch(`${API}/items`);
  allItems = await res.json();
}

async function loadOrders() {
  const res = await fetch(`${API}/orders`, { headers: authHeaders() });
  const newOrders = await res.json();
  if (previousOrderCount !== null && newOrders.length > previousOrderCount) {
    playBeep();
    if (allSettings.order_notifications !== 'false') {
      showOrderNotificationPopup();
    }
  }
  previousOrderCount = newOrders.length;
  allOrders = newOrders;
}

async function loadStats() {
  const res = await fetch(`${API}/stats`, { headers: authHeaders() });
  const stats = await res.json();
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card"><div class="stat-value">${stats.pending}</div><div class="stat-label">قيد الانتظار</div></div>
    <div class="stat-card"><div class="stat-value">${stats.preparing}</div><div class="stat-label">قيد التحضير</div></div>
    <div class="stat-card"><div class="stat-value">${stats.ready}</div><div class="stat-label">جاهز</div></div>
    <div class="stat-card"><div class="stat-value">${stats.delivering}</div><div class="stat-label">في الطريق</div></div>
    <div class="stat-card"><div class="stat-value">${stats.todayOrders}</div><div class="stat-label">طلبات اليوم</div></div>
    <div class="stat-card"><div class="stat-value">${stats.todayRevenue.toLocaleString('ar-SY')}</div><div class="stat-label">إيرادات اليوم (ل.س)</div></div>
  `;
}

function applySettings() {
  if (allSettings.cafe_name) {
    document.getElementById('navTitle').textContent = allSettings.cafe_name;
  }
  if (allSettings.cafe_phone) document.getElementById('setCafePhone').value = allSettings.cafe_phone;
  if (allSettings.cafe_address) document.getElementById('setCafeAddress').value = allSettings.cafe_address;
  if (allSettings.cafe_description) document.getElementById('setCafeDesc').value = allSettings.cafe_description;
  if (allSettings.cafe_open_hours) {
    try {
      const hours = JSON.parse(allSettings.cafe_open_hours);
      document.getElementById('setOpenTime').value = hours.open || '08:00';
      document.getElementById('setCloseTime').value = hours.close || '23:00';
    } catch (e) {}
  }
  const openToggle = document.getElementById('setCafeOpen');
  if (openToggle) {
    openToggle.checked = allSettings.cafe_force_open === 'true';
  }
  // Update nav open status indicator
  updateNavOpenStatus();
  if (allSettings.receipt_footer) document.getElementById('setReceiptFooter').value = allSettings.receipt_footer;
  if (allSettings.cafe_logo) {
    const logo = document.getElementById('navLogo');
    logo.src = allSettings.cafe_logo;
    logo.style.display = 'inline';
    document.getElementById('setLogoPreview').innerHTML = `<img src="${allSettings.cafe_logo}" alt="logo">`;
  }
  if (allSettings.cafe_menu_image) {
    document.getElementById('setMenuImagePreview').innerHTML = `<img src="${allSettings.cafe_menu_image}" alt="menu bg">`;
  }
  if (allSettings.cafe_lat && allSettings.cafe_lng) {
    initCafeSettingMap(parseFloat(allSettings.cafe_lat), parseFloat(allSettings.cafe_lng));
  } else {
    initCafeSettingMap(33.5138, 36.2765);
  }
  // Order notifications toggle
  const notifToggle = document.getElementById('setOrderNotifications');
  if (notifToggle) {
    notifToggle.checked = allSettings.order_notifications !== 'false';
  }
  renderReceiptFields();
    // Update favicon
  if (allSettings.cafe_logo) {
    const favicon = document.getElementById('favicon');
    if (favicon) favicon.href = allSettings.cafe_logo;
  }
}
function updateNavOpenStatus() {
  const navStatus = document.getElementById('navOpenStatus');
  if (!navStatus) return;
  
  // Force closed takes precedence over force open
  if (allSettings.cafe_force_open === 'false') {
    navStatus.style.display = 'inline-block';
    navStatus.textContent = '🔴 مغلق';
    navStatus.style.color = 'var(--danger)';
    return;
  }
  
  const now = new Date();
  const syriaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Damascus' }));
  const currentHour = syriaTime.getHours();
  const currentMinute = syriaTime.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;
  
  let isOpen = false;
  let hasHours = false;
  
  if (allSettings.cafe_force_open === 'true') {
    isOpen = true;
    hasHours = true;
  } else if (allSettings.cafe_open_hours) {
    try {
      const hours = JSON.parse(allSettings.cafe_open_hours);
      const [openH, openM] = (hours.open || '08:00').split(':').map(Number);
      const [closeH, closeM] = (hours.close || '23:00').split(':').map(Number);
      const openTime = openH * 60 + openM;
      const closeTime = closeH * 60 + closeM;
      isOpen = currentTime >= openTime && currentTime < closeTime;
      hasHours = true;
    } catch (e) {}
  }
  
  navStatus.style.display = 'inline-block';
  if (!hasHours) {
    navStatus.textContent = '⚪ غير محدد';
    navStatus.style.color = 'var(--text-muted)';
  } else {
    navStatus.textContent = isOpen ? '🟢 مفتوح' : '🔴 مغلق';
    navStatus.style.color = isOpen ? 'var(--success)' : 'var(--danger)';
  }
}

async function toggleCafeOpen() {
  const current = allSettings.cafe_force_open === 'true';
  const newVal = current ? 'false' : 'true';
  try {
    const res = await fetch(`${API}/settings`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'cafe_force_open', value: newVal })
    });
    if (!res.ok) throw new Error('Failed to save');
    allSettings.cafe_force_open = newVal;
    // Sync the settings tab checkbox
    const openToggle = document.getElementById('setCafeOpen');
    if (openToggle) openToggle.checked = newVal === 'true';
    updateNavOpenStatus();
    showToast(newVal === 'true' ? 'المقهى مفتوح الآن ✅' : 'المقهى مغلق الآن 🔴', 'success');
  } catch (e) {
    showToast('تعذر تحديث الحالة ❌', 'error');
  }
}
function populateCategorySelects() {
  const opts = allCategories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  document.getElementById('newCategory').innerHTML = '<option value="">بدون قسم</option>' + opts;
  document.getElementById('editCategory').innerHTML = '<option value="">بدون قسم</option>' + opts;
}

function formatPrice(price) {
  return Math.round(price).toLocaleString('en-US') + ' ل.س';
}

function getStatusLabel(status) {
  const map = { pending: 'قيد الانتظار', preparing: 'قيد التحضير', ready: 'جاهز', delivering: 'في الطريق', completed: 'مكتمل', cancelled: 'ملغى' };
  return map[status] || status;
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleString('ar-SY', { timeZone: 'Asia/Damascus' });
}

// ===================== QR CODE =====================
function generateQR() {
  const cafeName = allSettings.cafe_name || 'Caracalla Cafe';
  fetch(`${API}/qrcode`)
    .then(r => r.json())
    .then(data => {
      document.getElementById('qrImage').src = data.qr;
      document.getElementById('qrUrl').textContent = data.url;
      let qrLabel = document.getElementById('qrLabel');
      if (!qrLabel) {
        qrLabel = document.createElement('div');
        qrLabel.id = 'qrLabel';
        qrLabel.style.cssText = 'font-weight:700;color:var(--primary);margin-top:0.5rem;font-size:1.1rem;';
        document.querySelector('.qr-section').appendChild(qrLabel);
      }
    });
}

function generateTableQR() {
  const tableNum = document.getElementById('tableQrInput').value;
  if (!tableNum) return showToast('أدخل رقم الطاولة', 'warning');
  const cafeName = allSettings.cafe_name || 'Caracalla Cafe';
  const tableUrl = window.location.origin + '/menu?table=' + encodeURIComponent(tableNum);
  const container = document.getElementById('tableQrResult');
  container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;">جاري إنشاء الرمز...</p>';
  fetch(`${API}/qrcode?url=${encodeURIComponent(tableUrl)}`)
    .then(r => r.json())
    .then(data => {
      container.innerHTML = `
        <img src="${data.qr}" style="max-width:200px;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:0.5rem;">
        <div style="font-weight:700;color:var(--primary);font-size:1.1rem;margin-bottom:0.3rem;">${cafeName} - طاولة ${tableNum}</div>
        <p style="font-size:0.8rem;color:var(--text-muted);word-break:break-all;">${data.url}</p>
        <div class="flex gap-1 mt-1" style="justify-content:center;">
          <button class="btn btn-outline btn-sm" id="tableQrShareBtn">📤 مشاركة</button>
          <button class="btn btn-outline btn-sm" id="tableQrPrintBtn">🖨️ طباعة</button>
        </div>
      `;
      document.getElementById('tableQrShareBtn').onclick = () => {
        const tableText = `${cafeName} - طاولة ${tableNum}`;
        const fullText = tableText + '\n' + data.url;
        if (navigator.share) {
          fetch(data.qr).then(r => r.blob()).then(blob => {
            const file = new File([blob], 'table-qr.png', { type: 'image/png' });
            navigator.share({ files: [file], title: tableText, text: fullText }).catch(() => {
              navigator.clipboard.writeText(fullText).then(() => showToast('تم نسخ الرابط!', 'success'));
            });
          }).catch(() => {
            navigator.share({ title: tableText, url: data.url }).catch(() => {
              navigator.clipboard.writeText(fullText).then(() => showToast('تم نسخ الرابط!', 'success'));
            });
          });
        } else {
          navigator.clipboard.writeText(fullText).then(() => showToast('تم نسخ الرابط!', 'success'));
        }
      };
      document.getElementById('tableQrPrintBtn').onclick = () => {
        const w = window.open('', '_blank');
        w.document.write(`
          <html dir="rtl">
          <head>
            <meta charset="UTF-8">
            <style>
              @page { size: 80mm 80mm; margin: 0; }
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body {
                width: 80mm;
                height: 80mm;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 8mm;
                font-family: 'Tajawal', sans-serif;
                text-align: center;
              }
              .logo-text {
                font-size: 14pt;
                font-weight: 800;
                color: #B07D4B;
                margin-bottom: 3mm;
              }
              .table-text {
                font-size: 18pt;
                font-weight: 800;
                color: #2C1810;
                margin-bottom: 4mm;
              }
              .qr-img {
                width: 50mm;
                height: 50mm;
                object-fit: contain;
              }
              .scan-text {
                font-size: 9pt;
                color: #7A6B5F;
                margin-top: 3mm;
              }
            </style>
          </head>
          <body>
            <div class="logo-text">${cafeName}</div>
            <div class="table-text">طاولة ${tableNum}</div>
            <img src="${data.qr}" class="qr-img" alt="QR">
            <div class="scan-text">امسح للطلب</div>
          </body>
          </html>
        `);
        w.document.close();
        w.onload = () => { w.print(); setTimeout(() => w.close(), 800); };
      };
    })
    .catch(() => {
      container.innerHTML = '<p style="color:var(--danger);font-size:0.8rem;">فشل إنشاء الرمز</p>';
    });
}

function shareQR() {
  const cafeName = allSettings.cafe_name || 'Caracalla Cafe';
  const url = document.getElementById('qrUrl').textContent;
  const text = `${cafeName} - القائمة`;
  const qrSrc = document.getElementById('qrImage').src;
  
  if (navigator.share && qrSrc) {
    fetch(qrSrc)
      .then(r => r.blob())
      .then(blob => {
        const file = new File([blob], 'menu-qr.png', { type: 'image/png' });
        // Pass only text (no url) when sharing files to avoid duplication
        navigator.share({ files: [file], title: cafeName, text: text + '\n' + url }).catch(() => {
          navigator.clipboard.writeText(text + '\n' + url).then(() => showToast('تم نسخ الرابط إلى الحافظة 📋', 'success'));
        });
      })
      .catch(() => {
        // Fallback without files: pass url only, no text to avoid duplication
        navigator.share({ title: cafeName, url: url }).catch(() => {
          navigator.clipboard.writeText(text + '\n' + url).then(() => showToast('تم نسخ الرابط إلى الحافظة 📋', 'success'));
        });
      });
  } else {
    navigator.clipboard.writeText(text + '\n' + url).then(() => showToast('تم نسخ الرابط إلى الحافظة 📋', 'success'));
  }
}

function printQR() {
  const qr = document.getElementById('qrImage').src;
  const w = window.open('', '_blank');
  w.document.write(`<html><body style="text-align:center;padding:2rem;"><h2>${allSettings.cafe_name || 'Caracalla Cafe'}</h2><img src="${qr}" style="max-width:300px;"><p>امسح الرمز لعرض القائمة</p></body></html>`);
  w.document.close();
  w.print();
}

function switchTab(tab, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['items', 'add', 'categories', 'tables', 'orders', 'settings'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('hidden', t !== tab);
  });
  if (tab === 'orders') {
    loadOrders().then(renderOrders);
    loadStats();
  }
  if (tab === 'items') loadItems().then(() => renderItems());
  if (tab === 'categories') loadCategories().then(renderCategories);
  if (tab === 'tables') {
    if (!allItems.length) loadItems().then(() => {});
    loadTableTabs().then(renderTableTabs);
  }
  if (tab === 'settings') setTimeout(() => { if (cafeSettingMap) cafeSettingMap.invalidateSize(); }, 100);
}

// ===================== ITEMS =====================
let ownerRefreshInterval = null;

function filterItems() {
  const query = document.getElementById('itemSearch').value.trim().toLowerCase();
  renderItems(query);
}

let draggedItem = null;

function renderItems(filter = '') {
  const grid = document.getElementById('ownerItemsGrid');
  grid.innerHTML = '';

  let items = allItems;
  if (filter) {
    items = allItems.filter(i => i.name.toLowerCase().includes(filter) || (i.description || '').toLowerCase().includes(filter));
  }

  if (items.length === 0) {
    grid.innerHTML = '<div class="text-center" style="grid-column:1/-1;color:var(--text-muted);padding:2rem;">لا توجد أصناف</div>';
    return;
  }
  items.forEach((item, idx) => {
    const cat = allCategories.find(c => c.id === item.category_id);
    const div = document.createElement('div');
    div.className = 'menu-item';
    div.style.opacity = item.is_available ? '1' : '0.5';
    if (!filter) {
      div.draggable = true;
      div.dataset.id = item.id;
      div.dataset.index = idx;
      div.addEventListener('dragstart', itemDragStart);
      div.addEventListener('dragover', itemDragOver);
      div.addEventListener('drop', itemDrop);
      div.addEventListener('dragend', itemDragEnd);
    }
    const imgHtml = item.image_path
      ? `<div class="item-img"><img src="${item.image_path}" alt="${item.name}"></div>`
      : `<div class="item-img">☕</div>`;
    const stockHtml = item.stock !== null
      ? `<div style="color:${item.stock <= 5 ? 'var(--danger)' : 'var(--text-muted)'};font-size:0.8rem;font-weight:${item.stock <= 5 ? '700' : '400'};">المخزون: ${item.stock} ${item.stock <= 5 ? '⚠️ منخفض' : ''}</div>`
      : '';
    const dragHandle = !filter ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0.8rem;background:var(--cream);border-bottom:1px solid var(--border);cursor:grab;border-radius:var(--radius) var(--radius) 0 0;"><span style="color:var(--text-muted);font-weight:700;font-size:1rem;">⋮⋮</span><span style="font-size:0.8rem;color:var(--text-muted);">اسحب لإعادة الترتيب</span></div>` : '';
    div.innerHTML = `
      ${dragHandle}
      ${imgHtml}
      <div class="item-body">
        <div class="item-name">${item.name} ${!item.is_available ? '<span style="color:var(--danger);font-size:0.75rem;">(غير متاح)</span>' : ''}</div>
        <div class="item-desc">${cat ? cat.name : 'بدون قسم'} | ${item.description || ''}</div>
        <div class="item-price">${formatPrice(item.price)}</div>
        ${stockHtml}
        <div style="color:var(--text-muted);font-size:0.8rem;margin-bottom:0.5rem;">
          ${(item.additions || []).map(a => a.name).join('، ') || 'لا توجد إضافات'}
        </div>
        <button class="btn btn-primary btn-sm" onclick="openEditModal(${item.id})">تعديل</button>
        <button class="btn btn-sm" onclick="toggleItemAvailability(${item.id})" style="background:${item.is_available ? 'var(--success)' : 'var(--danger)'};color:white;min-width:2.5rem;">${item.is_available ? '✅' : '❌'}</button>
        <button class="btn btn-outline btn-sm" onclick="duplicateItem(${item.id})">📋 نسخ</button>
      </div>
    `;
    grid.appendChild(div);
  });
}

function previewImage(input, previewId) {
  const preview = document.getElementById(previewId);
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      preview.innerHTML = `<img src="${e.target.result}" alt="preview">`;
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function addAdditionRow(containerId = 'newAdditions') {
  const div = document.getElementById(containerId);
  const row = document.createElement('div');
  row.className = 'flex gap-1 align-center mt-1';
  row.innerHTML = `
    <input type="text" placeholder="اسم الإضافة" class="add-name" style="flex:2;">
    <input type="number" placeholder="السعر" class="add-price" style="flex:1;">
    <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">×</button>
  `;
  div.appendChild(row);
}

function addEditAdditionRow() {
  const div = document.getElementById('editAdditions');
  const row = document.createElement('div');
  row.className = 'flex gap-1 align-center mt-1';
  row.innerHTML = `
    <input type="text" placeholder="اسم الإضافة" class="add-name" style="flex:2;">
    <input type="number" placeholder="السعر" class="add-price" style="flex:1;">
    <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">×</button>
  `;
  div.appendChild(row);
}

function getAdditionsFromForm(containerId) {
  const rows = document.querySelectorAll(`#${containerId} .flex.gap-1`);
  const additions = [];
  rows.forEach(row => {
    const name = row.querySelector('.add-name').value.trim();
    const price = parseFloat(row.querySelector('.add-price').value) || 0;
    if (name) additions.push({ name, price });
  });
  return additions;
}

async function saveItem() {
  const formData = new FormData();
  formData.append('name', document.getElementById('newName').value);
  formData.append('category_id', document.getElementById('newCategory').value);
  formData.append('description', document.getElementById('newDesc').value);
  formData.append('price', document.getElementById('newPrice').value);
  formData.append('stock', document.getElementById('newStock').value);
  formData.append('additions', JSON.stringify(getAdditionsFromForm('newAdditions')));

  const imageFile = document.getElementById('newImage').files[0];
  if (imageFile) formData.append('image', imageFile);

  if (!formData.get('name') || !formData.get('price')) {
    showToast('الاسم والسعر مطلوبان ⚠️', 'warning');
    return;
  }

  try {
    const res = await fetch(`${API}/items`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData
    });
    if (!res.ok) throw new Error('Failed');

    showToast('تم إضافة الصنف بنجاح! ✅', 'success');
    document.getElementById('newName').value = '';
    document.getElementById('newDesc').value = '';
    document.getElementById('newPrice').value = '';
    document.getElementById('newStock').value = '';
    document.getElementById('newImage').value = '';
    document.getElementById('newImagePreview').innerHTML = '<span>📷 اضغط لاختيار صورة</span>';
    document.getElementById('newAdditions').innerHTML = '';
    await loadItems();
    renderItems();
  } catch (e) {
    showToast('تعذر إضافة الصنف، حاول مرة أخرى ❌', 'error');
  }
}

function openEditModal(itemId) {
  const item = allItems.find(i => i.id === itemId);
  if (!item) return;

  document.getElementById('editId').value = item.id;
  document.getElementById('editName').value = item.name;
  document.getElementById('editCategory').value = item.category_id || '';
  document.getElementById('editDesc').value = item.description || '';
  document.getElementById('editPrice').value = item.price;
  document.getElementById('editStock').value = item.stock || '';
  document.getElementById('editAvailable').value = String(item.is_available);

  const preview = document.getElementById('editImagePreview');
  if (item.image_path) {
    preview.innerHTML = `<img src="${item.image_path}" alt="${item.name}">`;
  } else {
    preview.innerHTML = '<span>📷 اضغط لاختيار صورة</span>';
  }
  document.getElementById('editImage').value = '';

  const addDiv = document.getElementById('editAdditions');
  addDiv.innerHTML = '';
  (item.additions || []).forEach(a => {
    const row = document.createElement('div');
    row.className = 'flex gap-1 align-center mt-1';
    row.innerHTML = `
      <input type="text" value="${a.name}" class="add-name" style="flex:2;">
      <input type="number" value="${a.price}" class="add-price" style="flex:1;">
      <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">×</button>
    `;
    addDiv.appendChild(row);
  });

  document.getElementById('editModal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('editModal').classList.add('hidden');
}

async function updateItem() {
  const id = document.getElementById('editId').value;
  const formData = new FormData();
  formData.append('category_id', document.getElementById('editCategory').value);
  formData.append('name', document.getElementById('editName').value);
  formData.append('description', document.getElementById('editDesc').value);
  formData.append('price', document.getElementById('editPrice').value);
  formData.append('stock', document.getElementById('editStock').value);
  formData.append('is_available', document.getElementById('editAvailable').value);
  formData.append('additions', JSON.stringify(getAdditionsFromForm('editAdditions')));

  const imageFile = document.getElementById('editImage').files[0];
  if (imageFile) formData.append('image', imageFile);

  try {
    const res = await fetch(`${API}/items/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: formData
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed');
    }
    showToast('تم تحديث الصنف بنجاح! ✅', 'success');
    closeEditModal();
    await loadItems();
    renderItems();
  } catch (e) {
    showToast('تعذر تحديث الصنف، حاول مرة أخرى ❌', 'error');
  }
}

async function deleteItem() {
  const confirmed = await showConfirm('هل أنت متأكد من الحذف؟ لا يمكن التراجع.', 'تأكيد الحذف', '🗑️');
  if (!confirmed) return;
  const id = document.getElementById('editId').value;
  try {
    const res = await fetch(`${API}/items/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (!res.ok) throw new Error('Failed');
    closeEditModal();
    await loadItems();
    renderItems();
  } catch (e) {
    showToast('تعذر حذف الصنف، حاول مرة أخرى ❌', 'error');
  }
}

async function toggleItemAvailability(id) {
  try {
    const res = await fetch(`${API}/items/${id}/toggle`, {
      method: 'PUT',
      headers: authHeaders()
    });
    if (!res.ok) throw new Error('Failed');
    await loadItems();
    renderItems();
  } catch (e) {
    showToast('تعذر تغيير حالة التوفر ❌', 'error');
  }
}

function duplicateItem(itemId) {
  const item = allItems.find(i => i.id === itemId);
  if (!item) return;
  document.getElementById('newName').value = item.name + ' (نسخة)';
  document.getElementById('newCategory').value = item.category_id || '';
  document.getElementById('newDesc').value = item.description || '';
  document.getElementById('newPrice').value = item.price;
  document.getElementById('newStock').value = item.stock || '';
  document.getElementById('newImage').value = '';
  document.getElementById('newImagePreview').innerHTML = '<span>📷 اضغط لاختيار صورة</span>';

  const addDiv = document.getElementById('newAdditions');
  addDiv.innerHTML = '';
  (item.additions || []).forEach(a => {
    const row = document.createElement('div');
    row.className = 'flex gap-1 align-center mt-1';
    row.innerHTML = `
      <input type="text" value="${a.name}" class="add-name" style="flex:2;">
      <input type="number" value="${a.price}" class="add-price" style="flex:1;">
      <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">×</button>
    `;
    addDiv.appendChild(row);
  });

  const addTabBtn = document.querySelector('.tab[onclick*="switchTab(\'add\'"]');
  if (addTabBtn) switchTab('add', addTabBtn);
}

function printKitchenTicket(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;
  const itemsHtml = order.items.map(it => {
    let adds = '';
    if (it.additions && it.additions.length > 0) {
      adds = `<div style="font-size:0.8rem;color:#666;margin-top:2px;">${it.additions.map(a => `+ ${a.addition_name}`).join('، ')}</div>`;
    }
    return `<div style="margin-bottom:8px;border-bottom:1px dashed #ccc;padding-bottom:4px;"><strong>${it.item_name}</strong> × ${it.quantity}${adds}</div>`;
  }).join('');
  const w = window.open('', '_blank');
  w.document.write(`
    <html dir="rtl">
    <head><style>
      body { font-family: 'Tajawal', sans-serif; padding: 1rem; font-size: 1.2rem; }
      h2 { text-align: center; margin-bottom: 0.5rem; font-size: 1.5rem; }
      .meta { text-align: center; color: #666; font-size: 0.9rem; margin-bottom: 1rem; }
      .items { border-top: 2px solid #333; border-bottom: 2px solid #333; padding: 0.5rem 0; }
      .notes { background: #fff0f0; border: 2px solid #c00; padding: 0.5rem; margin-top: 1rem; font-weight: bold; color: #c00; border-radius: 4px; }
      .time { text-align: center; font-size: 0.8rem; color: #999; margin-top: 1rem; }
      @media print { body { padding: 0; } }
    </style></head>
    <body>
           <h2>🍳 طلب مطبخ #${order.daily_order_number || order.id}</h2>
      <div class="meta">${order.order_type === 'delivery' ? '🛵 توصيل' : '🍽️ داخل المقهى'} ${order.table_number ? '— طاولة ' + order.table_number : ''}</div>
      <div class="items">${itemsHtml}</div>
      ${order.notes ? `<div class="notes">📌 ملاحظة: ${order.notes}</div>` : ''}
      <div class="time">${formatTime(order.created_at)}</div>
      <script>window.onload = function() { window.print(); setTimeout(() => window.close(), 500); };</script>
    </body></html>
  `);
  w.document.close();
}

// ===================== CATEGORIES =====================
async function addCategory() {
  const name = document.getElementById('newCatName').value.trim();
  if (!name) return showToast('اسم القسم مطلوب ⚠️', 'warning');

  const formData = new FormData();
  formData.append('name', name);
  formData.append('sort_order', allCategories.length);
  const imageFile = document.getElementById('newCatImage').files[0];
  if (imageFile) formData.append('image', imageFile);

  try {
    const res = await fetch(`${API}/categories`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData
    });
    if (!res.ok) throw new Error('Failed');
    document.getElementById('newCatName').value = '';
    document.getElementById('newCatImage').value = '';
    document.getElementById('newCatImagePreview').innerHTML = '<span>📷 اضغط لاختيار صورة</span>';
    await loadCategories();
    renderCategories();
    populateCategorySelects();
  } catch (e) {
    showToast('تعذر إضافة القسم، حاول مرة أخرى ❌', 'error');
  }
}

async function deleteCategory(id) {
  const confirmed = await showConfirm('هل أنت متأكد من حذف هذا القسم؟', 'تأكيد الحذف', '🗑️');
  if (!confirmed) return;
  try {
    await fetch(`${API}/categories/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    await loadCategories();
    renderCategories();
    populateCategorySelects();
    await loadItems();
    renderItems();
  } catch (e) {
    showToast('تعذر حذف القسم، حاول مرة أخرى ❌', 'error');
  }
}

function renderCategories() {
  const container = document.getElementById('categoriesList');
  if (allCategories.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;">لا توجد أقسام</p>';
    return;
  }
  container.innerHTML = allCategories.map((c, idx) => `
    <div class="category-row" draggable="true" data-id="${c.id}" data-index="${idx}" ondragstart="dragStart(event)" ondragover="dragOver(event)" ondrop="drop(event)" ondragend="dragEnd(event)">
      <span class="drag-handle">⋮⋮</span>
      ${c.image_path ? `<img src="${c.image_path}" style="width:40px;height:40px;border-radius:8px;object-fit:cover;margin-left:0.5rem;border:1px solid var(--border);">` : ''}
      <span class="cat-name">${c.name}</span>
      <div style="margin-right:auto;display:flex;gap:0.5rem;align-items:center;">
        <button class="btn btn-sm btn-outline" onclick="editCategory(${c.id})">تعديل</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCategory(${c.id})">حذف</button>
      </div>
    </div>
  `).join('');
}

let editingCategoryId = null;

function editCategory(id) {
  const cat = allCategories.find(c => c.id === id);
  if (!cat) return;
  editingCategoryId = id;
  
  document.getElementById('editCatName').value = cat.name;
  document.getElementById('editCatImagePreview').innerHTML = cat.image_path 
    ? `<img src="${cat.image_path}" style="width:100%;height:100%;object-fit:cover;">` 
    : '<span>📷 اضغط لاختيار صورة جديدة</span>';
  document.getElementById('editCatImage').value = '';
  
  document.getElementById('editCatModal').classList.remove('hidden');
}

function closeEditCatModal() {
  document.getElementById('editCatModal').classList.add('hidden');
  editingCategoryId = null;
}

async function saveCategoryEdit() {
  if (!editingCategoryId) return;
  const cat = allCategories.find(c => c.id === editingCategoryId);
  const name = document.getElementById('editCatName').value.trim();
  if (!name) return showToast('اسم القسم مطلوب ⚠️', 'warning');
  
  const formData = new FormData();
  formData.append('name', name);
  formData.append('sort_order', cat.sort_order || 0);
  
  const imageFile = document.getElementById('editCatImage').files[0];
  if (imageFile) formData.append('image', imageFile);
  
  try {
    const res = await fetch(`${API}/categories/${editingCategoryId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: formData
    });
    if (!res.ok) throw new Error('Failed');
    closeEditCatModal();
    await loadCategories();
    renderCategories();
    populateCategorySelects();
    showToast('تم تحديث القسم ✅', 'success');
  } catch (e) {
    showToast('تعذر تحديث القسم ❌', 'error');
  }
}

function dragStart(e) {
  draggedCategory = parseInt(e.target.dataset.id);
  e.target.classList.add('dragging');
}

function dragOver(e) {
  e.preventDefault();
}

function drop(e) {
  e.preventDefault();
  const targetRow = e.target.closest('.category-row');
  if (!targetRow) return;
  const targetId = parseInt(targetRow.dataset.id);
  if (draggedCategory === targetId) return;

  const draggedIdx = allCategories.findIndex(c => c.id === draggedCategory);
  const targetIdx = allCategories.findIndex(c => c.id === targetId);

  const [moved] = allCategories.splice(draggedIdx, 1);
  allCategories.splice(targetIdx, 0, moved);

  // Update sort_order
  allCategories.forEach((c, i) => {
    fetch(`${API}/categories/${c.id}`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: c.name, sort_order: i })
    });
  });

  renderCategories();
}

function dragEnd(e) {
  e.target.classList.remove('dragging');
  draggedCategory = null;
}

function itemDragStart(e) {
  draggedItem = parseInt(e.currentTarget.dataset.id);
  e.currentTarget.classList.add('dragging');
}

function itemDragOver(e) {
  e.preventDefault();
}

async function itemDrop(e) {
  e.preventDefault();
  const targetCard = e.target.closest('.menu-item');
  if (!targetCard) return;
  const targetId = parseInt(targetCard.dataset.id);
  if (draggedItem === targetId) return;

  const draggedIdx = allItems.findIndex(i => i.id === draggedItem);
  const targetIdx = allItems.findIndex(i => i.id === targetId);

  const [moved] = allItems.splice(draggedIdx, 1);
  allItems.splice(targetIdx, 0, moved);

  allItems.forEach((item, i) => {
    fetch(`${API}/items/${item.id}/sort`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sort_order: i })
    }).catch(() => {});
  });

  renderItems(document.getElementById('itemSearch').value.trim().toLowerCase());
}

function itemDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  draggedItem = null;
}
// ===================== ORDERS =====================
function renderOrders() {
  const container = document.getElementById('ownerOrders');
  if (allOrders.length === 0) {
    container.innerHTML = '<p class="text-center" style="color:var(--text-muted);padding:3rem;">لا توجد طلبات بعد.</p>';
    return;
  }

  const activeOrders = allOrders.filter(o => !['completed', 'cancelled'].includes(o.status));
  const finishedOrders = allOrders.filter(o => ['completed', 'cancelled'].includes(o.status));

  let html = '';

  // Active orders section
  if (activeOrders.length > 0) {
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin:1.5rem 0 1rem;"><h3 style="color:var(--primary);font-size:1.2rem;font-weight:800;">🔥 الطلبات النشطة (' + activeOrders.length + ')</h3><button class="btn btn-outline btn-sm" onclick="manualRefreshOrders()">🔄 تحديث</button></div>';
    activeOrders.forEach(order => {
      html += renderOrderCard(order);
    });
  }

  // Finished orders section
  if (finishedOrders.length > 0) {
    html += '<h3 style="color:var(--text-muted);margin:2rem 0 1rem;font-size:1.2rem;font-weight:800;border-top:2px dashed var(--border);padding-top:1.5rem;">✔️ الطلبات المنتهية (' + finishedOrders.length + ')</h3>';
    finishedOrders.forEach(order => {
      html += renderOrderCard(order);
    });
  }

  container.innerHTML = html;
}

function renderOrderCard(order) {
  const card = document.createElement('div');
  card.className = `order-card ${order.status}`;

  let locationBtn = '';
  if (order.order_type === 'delivery' && order.latitude && order.longitude && order.status !== 'completed' && order.status !== 'cancelled') {
    locationBtn = `<button class="btn btn-info btn-sm" onclick="showOrderMap(${order.latitude}, ${order.longitude}, '${order.address_text || ''}')">📍 عرض الموقع</button>`;
  }

  const typeLabel = order.order_type === 'delivery' ? '🛵 توصيل' : '🍽️ داخل المقهى';

  let metaLines = '';
  if (order.customer_name) metaLines += `<span class="meta-line"><span class="meta-label">الاسم:</span> ${order.customer_name}</span>`;
  metaLines += `<span class="meta-line"><span class="meta-label">نوع الطلب:</span> ${typeLabel}</span>`;
  if (order.table_number) metaLines += `<span class="meta-line"><span class="meta-label">رقم الطاولة:</span> ${order.table_number}</span>`;
  if (order.phone) metaLines += `<span class="meta-line"><span class="meta-label">الهاتف:</span> <a href="tel:${order.phone}">${order.phone}</a></span>`;
  if (order.address_text) metaLines += `<span class="meta-line"><span class="meta-label">العنوان:</span> ${order.address_text}</span>`;
  metaLines += `<span class="meta-line"><span class="meta-label">الوقت:</span> ${formatTime(order.created_at)}</span>`;

  let actions = '';
  if (order.status === 'pending') {
    actions = `<button class="btn btn-info" onclick="updateOrderStatus(${order.id}, 'preparing')">ابدأ التحضير</button>`;
  } else if (order.status === 'preparing') {
    actions = `<button class="btn btn-success" onclick="updateOrderStatus(${order.id}, 'ready')">جاهز للتسليم</button>`;
  } else if (order.status === 'ready') {
    if (order.order_type === 'delivery') {
      actions = `<button class="btn btn-primary" onclick="updateOrderStatus(${order.id}, 'delivering')">🛵 إرسال للتوصيل</button>`;
    } else {
      actions = `<button class="btn btn-primary" onclick="updateOrderStatus(${order.id}, 'completed')">تم الدفع والتسليم</button>`;
    }
  } else if (order.status === 'delivering') {
    actions = `<button class="btn btn-primary" onclick="updateOrderStatus(${order.id}, 'completed')">تم التسليم</button>`;
  }

  let cancelBtn = '';
  if (order.status === 'pending' || order.status === 'preparing') {
    cancelBtn = `<button class="btn btn-danger btn-sm" onclick="cancelOrder(${order.id})">إلغاء</button>`;
  }

  let deleteBtn = `<button class="btn btn-danger btn-sm" onclick="deleteOrder(${order.id})">🗑️ حذف</button>`;
  let receiptBtn = `<button class="btn btn-outline btn-sm" onclick="generateReceipt(${order.id})">🧾 فاتورة</button>`;
  let kitchenBtn = `<button class="btn btn-outline btn-sm" onclick="printKitchenTicket(${order.id})">🧾 مطبخ</button>`;
  let editBtn = `<button class="btn btn-warning btn-sm" onclick="editOrder(${order.id})">✏️ تعديل</button>`;

  // For finished orders, simplify actions
  let cardActions = '';
  if (['completed', 'cancelled'].includes(order.status)) {
    cardActions = `${receiptBtn} ${deleteBtn}`;
  } else {
    cardActions = `${actions} ${cancelBtn} ${editBtn} ${receiptBtn} ${kitchenBtn} ${deleteBtn}`;
  }

  card.innerHTML = `
    <div class="order-header">
      <div class="order-title">
        <strong style="font-size:1.1rem;">طلب #${order.daily_order_number || order.id}</strong>
        <span class="badge badge-${order.status}">${getStatusLabel(order.status)}</span>
      </div>
      <div class="order-meta">${metaLines}</div>
    </div>
    <div class="order-items">
      ${order.items.map(it => `
        <div class="order-item-line">
          <strong>${it.item_name} × ${it.quantity}</strong> - ${formatPrice(it.subtotal)}
          ${it.additions && it.additions.length > 0 ? `
            <div class="order-item-additions">
              ${it.additions.map(a => `+ ${a.addition_name} (${formatPrice(a.addition_price)})`).join('<br>')}
            </div>
          ` : ''}
        </div>
      `).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;">
      <div>${locationBtn}</div>
      <div style="font-size:1.3rem;font-weight:800;color:var(--primary);">
        الإجمالي: ${formatPrice(order.total_amount)}
      </div>
    </div>
    <div class="order-actions" style="flex-wrap:wrap;gap:0.5rem;">
      ${cardActions}
    </div>
    ${order.notes ? `<div style="border:2px solid var(--danger);color:var(--danger);font-size:1rem;margin-top:0.5rem;background:#fff0f0;padding:0.5rem;border-radius:6px;font-weight:700;">📌 ملاحظة: ${order.notes}</div>` : ''}
  `;
  return card.outerHTML;
}

async function updateOrderStatus(orderId, status) {
  try {
    await fetch(`${API}/orders/${orderId}/status`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    loadOrders().then(renderOrders);
    loadStats();
  } catch (e) { showToast('تعذر تحديث حالة الطلب ❌', 'error'); }
}
async function manualRefreshOrders() {
  await loadOrders();
  renderOrders();
  loadStats();
  showToast('تم التحديث ✅', 'success');
}
async function cancelOrder(orderId) {
  const confirmed = await showConfirm('هل تريد إلغاء هذا الطلب؟', 'تأكيد الإلغاء', '❌');
  if (!confirmed) return;
  try {
    await fetch(`${API}/orders/${orderId}/status`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' })
    });
    loadOrders().then(renderOrders);
    loadStats();
  } catch (e) { showToast('تعذر إلغاء الطلب ❌', 'error'); }
}

async function deleteOrder(orderId) {
  const confirmed = await showConfirm('هل أنت متأكد من حذف هذا الطلب؟ لا يمكن التراجع.', 'تأكيد الحذف', '🗑️');
  if (!confirmed) return;
  try {
    await fetch(`${API}/orders/${orderId}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    loadOrders().then(renderOrders);
    loadStats();
  } catch (e) { showToast('تعذر حذف الطلب ❌', 'error'); }
}

function editOrder(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;
  
  document.getElementById('editOrderId').textContent = order.daily_order_number || order.id;
  document.getElementById('editOrderIdVal').value = order.id;
  document.getElementById('editOrderName').value = order.customer_name || '';
  document.getElementById('editOrderPhone').value = order.phone || '';
  document.getElementById('editOrderType').value = order.order_type || 'dine_in';
  document.getElementById('editOrderTable').value = order.table_number || '';
  document.getElementById('editOrderAddress').value = order.address_text || '';
  document.getElementById('editOrderStatus').value = order.status;
  document.getElementById('editOrderNotes').value = order.notes || '';
  
  toggleEditOrderType();
  document.getElementById('orderEditModal').classList.remove('hidden');
}

function toggleEditOrderType() {
  const type = document.getElementById('editOrderType').value;
  if (type === 'dine_in') {
    document.getElementById('editOrderTableGroup').classList.remove('hidden');
    document.getElementById('editOrderAddressGroup').classList.add('hidden');
  } else {
    document.getElementById('editOrderTableGroup').classList.add('hidden');
    document.getElementById('editOrderAddressGroup').classList.remove('hidden');
  }
}

document.getElementById('editOrderType')?.addEventListener('change', toggleEditOrderType);

async function saveOrderEdit() {
  const id = document.getElementById('editOrderIdVal').value;
  const payload = {
    customer_name: document.getElementById('editOrderName').value || null,
    phone: document.getElementById('editOrderPhone').value || null,
    order_type: document.getElementById('editOrderType').value,
    table_number: document.getElementById('editOrderTable').value || null,
    address_text: document.getElementById('editOrderAddress').value || null,
    status: document.getElementById('editOrderStatus').value,
    notes: document.getElementById('editOrderNotes').value || null
  };
  
  try {
    const res = await fetch(`${API}/orders/${id}`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed');
    showToast('تم تحديث الطلب بنجاح! ✅', 'success');
    closeOrderEditModal();
    loadOrders().then(renderOrders);
    loadStats();
  } catch (e) {
    showToast('تعذر تحديث الطلب ❌', 'error');
  }
}

function closeOrderEditModal() {
  document.getElementById('orderEditModal').classList.add('hidden');
}

function showOrderMap(lat, lng, address) {
  document.getElementById('mapModal').classList.remove('hidden');
  setTimeout(() => {
    if (orderMap) { orderMap.remove(); orderMap = null; }
    
    const cafeLat = allSettings.cafe_lat ? parseFloat(allSettings.cafe_lat) : null;
    const cafeLng = allSettings.cafe_lng ? parseFloat(allSettings.cafe_lng) : null;
    
    // Center between cafe and customer if both exist, otherwise customer location
    let centerLat = lat, centerLng = lng, zoom = 16;
    if (cafeLat && cafeLng) {
      centerLat = (cafeLat + lat) / 2;
      centerLng = (cafeLng + lng) / 2;
      zoom = 13;
    }
    
    orderMap = L.map('orderMap').setView([centerLat, centerLng], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(orderMap);
    
    // Cafe marker with logo
    if (cafeLat && cafeLng) {
      const logoUrl = allSettings.cafe_logo || '';
      const cafeIconHtml = logoUrl
        ? `<div style="width:44px;height:44px;border-radius:50%;overflow:hidden;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);background:white;"><img src="${logoUrl}" style="width:100%;height:100%;object-fit:cover;"></div>`
        : `<div style="width:44px;height:44px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;color:white;font-size:20px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);">☕</div>`;
      const cafeIcon = L.divIcon({
        className: 'cafe-logo-marker',
        html: cafeIconHtml,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        popupAnchor: [0, -22]
      });
      L.marker([cafeLat, cafeLng], { icon: cafeIcon }).addTo(orderMap)
        .bindPopup(allSettings.cafe_name || 'المقهى').openPopup();
    }
    
    // Customer/delivery marker
    const destIcon = L.divIcon({
      className: 'dest-marker',
      html: '<div style="background:var(--success);width:24px;height:24px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:12px;">🏠</div>',
      iconSize: [24, 24]
    });
    orderMapMarker = L.marker([lat, lng], { icon: destIcon }).addTo(orderMap)
      .bindPopup(address || 'موقع التوصيل').openPopup();
  }, 100);
}

function closeMapModal() {
  document.getElementById('mapModal').classList.add('hidden');
  if (orderMap) { orderMap.remove(); orderMap = null; }
}

async function generateReceipt(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const cafeName = allSettings.cafe_name || 'Caracalla Cafe';
  const cafePhone = allSettings.cafe_phone || '';
  const cafeAddress = allSettings.cafe_address || '';

  let customFieldsHtml = '';
  for (let i = 1; i <= 10; i++) {
    const key = allSettings[`receipt_field_${i}_name`];
    const val = allSettings[`receipt_field_${i}_value`];
    if (key && val) {
      customFieldsHtml += `<div class="receipt-line"><span>${key}</span><span>${val}</span></div>`;
    }
  }

  let itemsHtml = '';
  order.items.forEach(it => {
    itemsHtml += `<div class="receipt-line"><span>${it.item_name} × ${it.quantity}</span><span>${formatPrice(it.subtotal)}</span></div>`;
    if (it.additions && it.additions.length > 0) {
      it.additions.forEach(a => {
        itemsHtml += `<div class="receipt-line" style="padding-right:1rem;font-size:0.85rem;color:var(--text-muted);"><span>+ ${a.addition_name}</span><span>${formatPrice(a.addition_price)}</span></div>`;
      });
    }
  });

  // Generate QR code via server API
  let qrDataUrl = '';
  try {
    const qrRes = await fetch(`${API}/qrcode?url=${encodeURIComponent(window.location.origin + '/menu')}`);
    if (qrRes.ok) {
      const qrData = await qrRes.json();
      qrDataUrl = qrData.qr;
    }
  } catch (e) { qrDataUrl = ''; }

  const isDelivery = order.order_type === 'delivery';
  const customerLabel = isDelivery ? 'رقم الزبون' : 'رقم الطاولة';
  const customerValue = isDelivery ? (order.phone || '-') : (order.table_number || '-');
  const dashedLine = `<div style="border-top:1px dashed #7A6B5F;margin:0.5rem 0;height:0;"></div>`;

  const receiptHtml = `
    <div id="receiptPrint" class="receipt">
      <div class="receipt-header" style="border-bottom:none;padding-bottom:0.3rem;margin-bottom:0.3rem;text-align:center;">
       ${allSettings.cafe_logo ? `<div style="text-align:center;margin-bottom:0.5rem;"><img src="${allSettings.cafe_logo}" alt="logo" style="width:60px;height:60px;border-radius:50%;object-fit:cover;display:block;margin:0 auto;background:#fff;border:2px solid #fff;"></div>` : ''}
        <h3>${cafeName}</h3>
        ${cafePhone ? `<div style="font-size:0.85rem;color:var(--text-muted);margin-top:0.2rem;">${cafePhone}</div>` : ''}
        ${cafeAddress ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.2rem;">${cafeAddress}</div>` : ''}
      </div>
      <div class="receipt-line" style="justify-content:center;font-size:0.85rem;color:var(--text-muted);margin-bottom:0.5rem;"><span>${formatTime(order.created_at)}</span></div>
      ${customFieldsHtml ? customFieldsHtml + dashedLine : ''}
      <div class="receipt-line"><span>الزبون:</span><span>${order.customer_name || 'زبون'}</span></div>
      ${dashedLine}
      <div class="receipt-line"><span>${customerLabel}:</span><span>${customerValue}</span></div>
      ${dashedLine}
      <div class="receipt-line"><span>رقم الطلب:</span><span>#${order.daily_order_number || order.id}</span></div>
      ${dashedLine}
      ${itemsHtml}
      ${dashedLine}
      <div class="receipt-line receipt-total"><span>المجموع:</span><span>${formatPrice(order.total_amount)}</span></div>
      <div class="receipt-footer" style="border-top:none;padding-top:0.5rem;margin-top:0.5rem;">
        ${allSettings.receipt_footer || 'شكراً لزيارتكم!'}
        ${qrDataUrl ? `<div style="margin-top:0.5rem;"><img src="${qrDataUrl}" style="width:80px;height:80px;"></div><div style="font-size:0.7rem;color:var(--text-muted);">امسح لرؤية القائمة</div>` : ''}
      </div>
    </div>
  `;

  document.getElementById('receiptContent').innerHTML = receiptHtml;
  document.getElementById('receiptModal').classList.remove('hidden');
}

function printReceipt() {
  const btn = document.querySelector('#receiptModal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الطباعة...'; }

  const content = document.getElementById('receiptContent').innerHTML;
  const w = window.open('', '_blank', 'width=400,height=600');
  w.document.write(`
    <html dir="rtl">
    <head>
      <title>فاتورة</title>
      <style>
        @page { size: auto; margin: 0; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: 'Tajawal', sans-serif; 
          padding: 4px; 
          margin: 0; 
          font-size: 13px; 
          color: #000;
          width: 100%;
        }
        .receipt { 
          width: 100%; 
          max-width: none; 
          padding: 0; 
          border: none; 
          margin: 0; 
          background: #fff;
        }
        .receipt-header { 
          text-align: center; 
          margin-bottom: 4px; 
          padding-bottom: 4px; 
        }
        .receipt-header h3 { margin: 0 0 4px; font-size: 15px; }
       .receipt-header img { width: 60px; height: 60px; border-radius: 50%; object-fit: cover; display: block; margin: 0 auto 4px; background: #fff; border: 2px solid #fff; }
        .receipt-header div { font-size: 11px; color: #333; margin-bottom: 2px; }
        .receipt-line { 
          display: flex; 
          justify-content: space-between; 
          padding: 2px 0; 
          font-size: 12px; 
        }
        .receipt-line span:first-child { margin-left: 8px; }
        .receipt-total { 
          font-weight: 800; 
          font-size: 14px; 
        }
        .receipt-footer { 
          text-align: center; 
          margin-top: 4px; 
          padding-top: 4px; 
          font-size: 11px; 
          color: #333; 
        }
        .receipt-footer img { width: 70px; height: 70px; margin-top: 4px; }
        @media print { 
          body { padding: 0; margin: 0; } 
          .receipt { padding: 4px; }
        }
      </style>
    </head>
    <body>${content}</body>
    </html>
  `);
  w.document.close();
  w.onload = () => {
    w.print();
    setTimeout(() => { w.close(); closeReceiptModal(); }, 500);
  };
  setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = '🖨️ طباعة'; } }, 3000);
}

function closeReceiptModal() {
  document.getElementById('receiptModal').classList.add('hidden');
}

// ===================== SETTINGS =====================
function initCafeSettingMap(lat, lng) {
  if (cafeSettingMap) { cafeSettingMap.remove(); cafeSettingMap = null; }
  cafeSettingMap = L.map('cafeSettingMap').setView([lat, lng], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(cafeSettingMap);
  const logoUrl = allSettings.cafe_logo || '';
  const cafeIconHtml = logoUrl
    ? `<div style="width:44px;height:44px;border-radius:50%;overflow:hidden;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);background:white;"><img src="${logoUrl}" style="width:100%;height:100%;object-fit:cover;"></div>`
    : `<div style="width:44px;height:44px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;color:white;font-size:20px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);">☕</div>`;
  const cafeIcon = L.divIcon({
    className: 'cafe-logo-marker',
    html: cafeIconHtml,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22]
  });
  cafeSettingMarker = L.marker([lat, lng], { icon: cafeIcon }).addTo(cafeSettingMap);
  cafeSettingMap.on('click', function(e) {
    if (cafeSettingMarker) cafeSettingMap.removeLayer(cafeSettingMarker);
    cafeSettingMarker = L.marker(e.latlng, { icon: cafeIcon }).addTo(cafeSettingMap);
  });
}

function getCafeCurrentLocation() {
  if (!navigator.geolocation) {
    showToast('المتصفح لا يدعم تحديد الموقع 📍', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      initCafeSettingMap(lat, lng);
    },
    () => showToast('تعذر الحصول على الموقع 📍', 'error')
  );
}

async function saveSettings() {
  const logoFile = document.getElementById('setLogo').files[0];
  let logoPath = allSettings.cafe_logo || '';
  if (logoFile) {
    const formData = new FormData();
    formData.append('image', logoFile);
    try {
      const res = await fetch(`${API}/upload`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData
      });
      if (res.ok) { const data = await res.json(); logoPath = data.path; }
    } catch (e) { console.error('Logo upload failed', e); }
  }

  const menuImageFile = document.getElementById('setMenuImage').files[0];
  let menuImagePath = allSettings.cafe_menu_image || '';
  if (menuImageFile) {
    const formData = new FormData();
    formData.append('image', menuImageFile);
    try {
      const res = await fetch(`${API}/upload`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData
      });
      if (res.ok) { const data = await res.json(); menuImagePath = data.path; }
    } catch (e) { console.error('Menu image upload failed', e); }
  }

  const settings = [
    { key: 'cafe_phone', value: document.getElementById('setCafePhone').value },
    { key: 'cafe_address', value: document.getElementById('setCafeAddress').value },
    { key: 'cafe_description', value: document.getElementById('setCafeDesc').value },
  ];
  
  const openTime = document.getElementById('setOpenTime').value || '08:00';
  const closeTime = document.getElementById('setCloseTime').value || '23:00';
  settings.push({ key: 'cafe_open_hours', value: JSON.stringify({ open: openTime, close: closeTime }) });
  settings.push({ key: 'cafe_force_open', value: document.getElementById('setCafeOpen').checked ? 'true' : 'false' });
  if (logoPath) settings.push({ key: 'cafe_logo', value: logoPath });
  if (menuImagePath) settings.push({ key: 'cafe_menu_image', value: menuImagePath });
  if (cafeSettingMarker) {
    const latlng = cafeSettingMarker.getLatLng();
    settings.push({ key: 'cafe_lat', value: String(latlng.lat) });
    settings.push({ key: 'cafe_lng', value: String(latlng.lng) });
  }

  const notifToggle = document.getElementById('setOrderNotifications');
  if (notifToggle) {
    settings.push({ key: 'order_notifications', value: notifToggle.checked ? 'true' : 'false' });
  }

  // Also save receipt footer and fields
  settings.push({ key: 'receipt_footer', value: document.getElementById('setReceiptFooter').value });
  const rows = document.querySelectorAll('#receiptCustomFields .receipt-field-row');
  let idx = 1;
  for (const row of rows) {
    const name = row.querySelector('.field-name').value.trim();
    const value = row.querySelector('.field-value').value.trim();
    if (name && idx <= 10) {
      settings.push({ key: `receipt_field_${idx}_name`, value: name });
      settings.push({ key: `receipt_field_${idx}_value`, value: value });
      idx++;
    }
  }
  // Clear old receipt fields beyond current count
  for (let i = idx; i <= 10; i++) {
    await fetch(`${API}/settings/receipt_field_${i}_name`, { method: 'DELETE', headers: authHeaders() });
    await fetch(`${API}/settings/receipt_field_${i}_value`, { method: 'DELETE', headers: authHeaders() });
  }

  let allSuccess = true;
  for (const s of settings) {
    try {
      const res = await fetch(`${API}/settings`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(s)
      });
      if (!res.ok) allSuccess = false;
    } catch (e) { allSuccess = false; }
  }

  if (allSuccess) {
    showToast('تم حفظ الإعدادات بنجاح! ✅', 'success');
    document.getElementById('setLogo').value = '';
    document.getElementById('setMenuImage').value = '';
  } else {
    showToast('حدث خطأ أثناء الحفظ، يرجى تسجيل الدخول مجدداً ❌', 'error');
  }
  await loadSettings();
  applySettings();
}

function addReceiptField() {
  const container = document.getElementById('receiptCustomFields');
  const count = container.querySelectorAll('.receipt-field-row').length + 1;
  if (count > 10) { showToast('الحد الأقصى 10 حقول مخصصة ⚠️', 'warning'); return; }

  const row = document.createElement('div');
  row.className = 'flex gap-1 align-center receipt-field-row mt-1';
  row.innerHTML = `
    <input type="text" placeholder="اسم الحقل (مثال: الرقم الضريبي)" class="field-name" style="flex:1;">
    <input type="text" placeholder="القيمة" class="field-value" style="flex:1;">
    <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">×</button>
  `;
  container.appendChild(row);
}

function renderReceiptFields() {
  const container = document.getElementById('receiptCustomFields');
  container.innerHTML = '';
  for (let i = 1; i <= 10; i++) {
    const name = allSettings[`receipt_field_${i}_name`];
    const value = allSettings[`receipt_field_${i}_value`];
    if (name) {
      const row = document.createElement('div');
      row.className = 'flex gap-1 align-center receipt-field-row mt-1';
      row.innerHTML = `
        <input type="text" value="${name}" class="field-name" style="flex:1;">
        <input type="text" value="${value || ''}" class="field-value" style="flex:1;">
        <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">×</button>
      `;
      container.appendChild(row);
    }
  }
}

async function saveReceiptSettings() {
  const rows = document.querySelectorAll('#receiptCustomFields .receipt-field-row');

  // Clear old fields
  for (let i = 1; i <= 10; i++) {
    await fetch(`${API}/settings/receipt_field_${i}_name`, { method: 'DELETE', headers: authHeaders() });
    await fetch(`${API}/settings/receipt_field_${i}_value`, { method: 'DELETE', headers: authHeaders() });
  }

  // Save new fields
  let idx = 1;
  for (const row of rows) {
    const name = row.querySelector('.field-name').value.trim();
    const value = row.querySelector('.field-value').value.trim();
    if (name && idx <= 10) {
      await fetch(`${API}/settings`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: `receipt_field_${idx}_name`, value: name })
      });
      await fetch(`${API}/settings`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: `receipt_field_${idx}_value`, value: value })
      });
      idx++;
    }
  }

  await fetch(`${API}/settings`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'receipt_footer', value: document.getElementById('setReceiptFooter').value })
  });

  showToast('تم حفظ إعدادات الفاتورة بنجاح! ✅', 'success');
  await loadSettings();
  applySettings();
}

// ===================== TABLE TABS =====================
let allTableTabs = [];

async function loadTableTabs() {
  try {
    const res = await fetch(`${API}/table-tabs`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Auth failed');
    allTableTabs = await res.json();
  } catch (e) {
    console.error('Table tabs error', e);
    if (e.message === 'Auth failed') { showToast('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى 🔒', 'warning'); logout(); }
  }
}

function renderTableTabs() {
  const activeGrid = document.getElementById('activeTablesGrid');
  const closedList = document.getElementById('closedTablesList');
  const active = allTableTabs.filter(t => t.status === 'open');
  const closed = allTableTabs.filter(t => t.status === 'closed');

  if (active.length === 0) {
    activeGrid.innerHTML = '<p class="text-center" style="color:var(--text-muted);padding:2rem;">لا توجد طاولات مفتوحة حالياً.</p>';
  } else {
    activeGrid.innerHTML = '';
    active.forEach(tab => {
      const items = tab.items || [];
      let itemsHtml = items.map(it => `
        <div style="display:flex;justify-content:space-between;padding:0.3rem 0;border-bottom:1px solid var(--border);font-size:0.9rem;">
          <span>${it.name} × ${it.quantity}</span>
          <span style="font-weight:700;">${formatPrice(it.price * it.quantity)}</span>
        </div>
      `).join('');
      const card = document.createElement('div');
      card.className = 'card';
      card.style.borderRight = '4px solid var(--primary)';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
          <h3 style="margin:0;color:var(--primary);font-size:1.3rem;">طاولة ${tab.table_number}</h3>
          <span style="font-size:1.2rem;font-weight:800;color:var(--primary);">${formatPrice(tab.total_amount)}</span>
        </div>
        <div style="max-height:200px;overflow-y:auto;margin-bottom:1rem;">${itemsHtml || '<p style="color:var(--text-muted);font-size:0.9rem;">لا توجد أصناف بعد</p>'}</div>
        <div class="flex gap-1" style="flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" onclick="showAddTableItem(${tab.id}, '${tab.table_number}')">➕ إضافة صنف</button>
          <button class="btn btn-success btn-sm" onclick="closeTableTab(${tab.id})">✔️ إغلاق التبويب</button>
          <button class="btn btn-outline btn-sm" onclick="printTableReceipt(${tab.id})">🧾 فاتورة</button>
          <button class="btn btn-danger btn-sm" onclick="deleteTableTab(${tab.id})">🗑️ حذف</button>
        </div>
      `;
      activeGrid.appendChild(card);
    });
  }

  if (closed.length === 0) {
    closedList.innerHTML = '<p class="text-center" style="color:var(--text-muted);padding:2rem;">لا يوجد سجل.</p>';
  } else {
    closedList.innerHTML = closed.map(t => `
      <div class="order-card completed" style="margin-bottom:0.5rem;padding:1rem;">
        <div style="display:flex;justify-content:space-between;">
          <strong>طاولة ${t.table_number}</strong>
          <span style="font-weight:700;color:var(--primary);">${formatPrice(t.total_amount)}</span>
        </div>
        <div style="color:var(--text-muted);font-size:0.85rem;">تم الإغلاق: ${formatTime(t.closed_at)}</div>
      </div>
    `).join('');
  }
}

async function openTableTab() {
  const num = document.getElementById('newTableNumber').value.trim();
  if (!num) return showToast('أدخل رقم الطاولة ⚠️', 'warning');
  try {
    const res = await fetch(`${API}/table-tabs`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ table_number: num, items: [] })
    });
    if (!res.ok) throw new Error('Failed');
    showToast('تم فتح التبويب ✅', 'success');
    document.getElementById('newTableNumber').value = '';
    await loadTableTabs();
    renderTableTabs();
  } catch (e) { showToast('تعذر فتح التبويب ❌', 'error'); }
}

function showAddTableItem(tabId, tableNum) {
  document.getElementById('tableItemTabId').value = tabId;
  document.getElementById('tableItemTableNum').textContent = tableNum;
  document.getElementById('tableItemQty').value = 1;
  const select = document.getElementById('tableItemSelect');
  select.innerHTML = allItems.map(i => `<option value="${i.id}">${i.name} — ${formatPrice(i.price)}</option>`).join('');
  document.getElementById('tableItemAdditions').innerHTML = '';
  select.onchange = () => renderTableItemAdditions(select.value);
  renderTableItemAdditions(select.value);
  document.getElementById('tableItemModal').classList.remove('hidden');
}

function renderTableItemAdditions(itemId) {
  const item = allItems.find(i => i.id == itemId);
  const container = document.getElementById('tableItemAdditions');
  if (!item || !item.additions || item.additions.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">لا توجد إضافات</p>';
    return;
  }
  container.innerHTML = item.additions.map(a => `
    <label class="addition-option">
      <input type="checkbox" value="${a.id}" data-name="${a.name}" data-price="${a.price}">
      <span>${a.name}</span>
      <span class="add-price">+ ${formatPrice(a.price)}</span>
    </label>
  `).join('');
}

function closeTableItemModal() {
  document.getElementById('tableItemModal').classList.add('hidden');
}

async function saveTableItem() {
  const tabId = document.getElementById('tableItemTabId').value;
  const itemId = document.getElementById('tableItemSelect').value;
  const qty = parseInt(document.getElementById('tableItemQty').value) || 1;
  const item = allItems.find(i => i.id == itemId);
  if (!item) return;
  
  const checked = document.querySelectorAll('#tableItemAdditions input:checked');
  const additions = Array.from(checked).map(cb => ({ id: parseInt(cb.value), name: cb.dataset.name, price: parseFloat(cb.dataset.price) }));
  
  const payload = [{
    id: item.id,
    name: item.name,
    price: parseFloat(item.price),
    quantity: qty,
    additions: additions
  }];
  
  try {
    const res = await fetch(`${API}/table-tabs/${tabId}/items`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payload })
    });
    if (!res.ok) throw new Error('Failed');
    showToast('تم إضافة الصنف ✅', 'success');
    closeTableItemModal();
    await loadTableTabs();
    renderTableTabs();
  } catch (e) { showToast('تعذر إضافة الصنف ❌', 'error'); }
}

async function closeTableTab(tabId) {
  const confirmed = await showConfirm('هل تريد إغلاق تبويب هذه الطاولة؟ سيتم حفظ الطلب في السجل.', 'إغلاق التبويب', '✔️');
  if (!confirmed) return;
  try {
    const res = await fetch(`${API}/table-tabs/${tabId}/close`, {
      method: 'PUT',
      headers: authHeaders()
    });
    if (!res.ok) throw new Error('Failed');
    showToast('تم إغلاق التبويب وحفظ الطلب ✅', 'success');
    await loadTableTabs();
    renderTableTabs();
    loadStats();
  } catch (e) { showToast('تعذر إغلاق التبويب ❌', 'error'); }
}

async function deleteTableTab(tabId) {
  const confirmed = await showConfirm('هل تريد حذف هذا التبويب؟ لا يمكن التراجع.', 'تأكيد الحذف', '🗑️');
  if (!confirmed) return;
  try {
    await fetch(`${API}/table-tabs/${tabId}`, { method: 'DELETE', headers: authHeaders() });
    showToast('تم الحذف ✅', 'success');
    await loadTableTabs();
    renderTableTabs();
  } catch (e) { showToast('تعذر الحذف ❌', 'error'); }
}

function printTableReceipt(tabId) {
  const tab = allTableTabs.find(t => t.id === tabId);
  if (!tab) return;
  const cafeName = allSettings.cafe_name || 'Caracalla Cafe';
  let itemsHtml = '';
  let total = 0;
  (tab.items || []).forEach(it => {
    let sub = it.price * it.quantity;
    let addsHtml = '';
    if (it.additions) {
      it.additions.forEach(a => { sub += (a.price || 0) * it.quantity; addsHtml += `<div style="padding-right:1rem;font-size:0.85rem;color:#666;">+ ${a.name}</div>`; });
    }
    total += sub;
    itemsHtml += `<div style="display:flex;justify-content:space-between;margin-bottom:0.2rem;"><span>${it.name} × ${it.quantity}</span><span>${Math.round(sub).toLocaleString('en-US')} ل.س</span></div>${addsHtml}`;
  });
  const w = window.open('', '_blank');
  w.document.write(`
    <html dir="rtl"><head><meta charset="UTF-8"><style>
      body{font-family:'Tajawal',sans-serif;padding:1rem;font-size:1.1rem;}
      h2{text-align:center;margin-bottom:0.5rem;font-size:1.4rem;}
      .meta{text-align:center;color:#666;font-size:0.9rem;margin-bottom:1rem;}
      .items{border-top:2px solid #333;border-bottom:2px solid #333;padding:0.5rem 0;}
      .total{font-weight:800;font-size:1.3rem;text-align:center;margin-top:1rem;}
      @media print{body{padding:0;}}
    </style></head><body>
      <h2>${cafeName}</h2>
      <div class="meta">طاولة ${tab.table_number} — ${new Date().toLocaleString('ar-SY')}</div>
      <div class="items">${itemsHtml}</div>
      <div class="total">المجموع: ${Math.round(total).toLocaleString('en-US')} ل.س</div>
      <script>window.onload=function(){window.print();setTimeout(()=>window.close(),500);};</script>
    </body></html>
  `);
  w.document.close();
}

// ===================== EXPORT / IMPORT =====================
async function exportItemsCSV() {
  try {
    const res = await fetch(`${API}/export/items`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'caracalla_items.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('تم تصدير المنتجات ✅', 'success');
  } catch (e) { showToast('تعذر التصدير ❌', 'error'); }
}

async function importItemsCSV(input) {
  const file = input.files[0];
  if (!file) return;
  const text = await file.text();
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return showToast('ملف CSV فارغ ⚠️', 'warning');
  
  const parseCSVLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i+1] === '"') { current += '"'; i++; }
      else if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { result.push(current); current = ''; }
      else { current += char; }
    }
    result.push(current);
    return result;
  };
  
  const headers = parseCSVLine(lines[0]).map(h => h.trim().replace(/^"|"$/g, ''));
  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      let val = cols[idx] !== undefined ? cols[idx].trim().replace(/^"|"$/g, '').replace(/""/g, '"') : '';
      if (h === 'price' || h === 'stock' || h === 'category_id') val = val ? parseFloat(val) : null;
      if (h === 'is_available') val = val === 'true' || val === '1';
      if (h === 'additions') { try { val = JSON.parse(val || '[]'); } catch { val = []; } }
      obj[h] = val;
    });
    items.push(obj);
  }
  
  if (!items.length) return showToast('لا توجد منتجات للاستيراد ⚠️', 'warning');
  const confirmed = await showConfirm(`هل تريد استيراد ${items.length} منتج؟ سيتم إضافتها كمنتجات جديدة.`, 'تأكيد الاستيراد', '📤');
  if (!confirmed) return;
  
  try {
    const res = await fetch(`${API}/import/items`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    showToast(`تم استيراد ${data.imported} منتج ✅`, 'success');
    await loadItems();
    renderItems();
  } catch (e) { showToast('تعذر الاستيراد ❌', 'error'); }
  input.value = '';
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    if (e.target.id !== 'receiptModal') {
      e.target.classList.add('hidden');
      if (e.target.id === 'mapModal' && orderMap) { orderMap.remove(); orderMap = null; }
    }
  }
});

// Theme toggle
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('cafeTheme', next);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = next === 'dark' ? '☀️' : '🌙';
}

(function initTheme() {
  const saved = localStorage.getItem('cafeTheme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    const icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = saved === 'dark' ? '☀️' : '🌙';
  }
})();
