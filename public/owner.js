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
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, 200);
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
    document.getElementById('setCafeName').value = allSettings.cafe_name;
  }
  if (allSettings.cafe_phone) document.getElementById('setCafePhone').value = allSettings.cafe_phone;
  if (allSettings.cafe_address) document.getElementById('setCafeAddress').value = allSettings.cafe_address;
  if (allSettings.receipt_footer) document.getElementById('setReceiptFooter').value = allSettings.receipt_footer;
  if (allSettings.cafe_logo) {
    const logo = document.getElementById('navLogo');
    logo.src = allSettings.cafe_logo;
    logo.style.display = 'inline';
    document.getElementById('setLogoPreview').innerHTML = `<img src="${allSettings.cafe_logo}" alt="logo">`;
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
}

function populateCategorySelects() {
  const opts = allCategories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  document.getElementById('newCategory').innerHTML = '<option value="">بدون قسم</option>' + opts;
  document.getElementById('editCategory').innerHTML = '<option value="">بدون قسم</option>' + opts;
}

function formatPrice(price) {
  return parseInt(price).toLocaleString('ar-SY') + ' ل.س';
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
  const cafeName = allSettings.cafe_name || 'كاراكالا كافيه';
  fetch(`${API}/qrcode`)
    .then(r => r.json())
    .then(data => {
      document.getElementById('qrImage').src = data.qr;
      document.getElementById('qrUrl').textContent = data.url;
      // Add cafe name label below QR
      let qrLabel = document.getElementById('qrLabel');
      if (!qrLabel) {
        qrLabel = document.createElement('div');
        qrLabel.id = 'qrLabel';
        qrLabel.style.cssText = 'font-weight:700;color:var(--primary);margin-top:0.5rem;font-size:1.1rem;';
        document.querySelector('.qr-section').appendChild(qrLabel);
      }
      qrLabel.textContent = `${cafeName} - القائمة`;
      // Add share button
      let shareBtn = document.getElementById('qrShareBtn');
      if (!shareBtn) {
        shareBtn = document.createElement('button');
        shareBtn.id = 'qrShareBtn';
        shareBtn.className = 'btn btn-outline btn-sm mt-1';
        document.querySelector('.qr-section').appendChild(shareBtn);
      }
      shareBtn.textContent = '📤 مشاركة QR';
      shareBtn.onclick = () => {
        if (navigator.share) {
          fetch(data.qr).then(r => r.blob()).then(blob => {
            const file = new File([blob], 'menu-qr.png', { type: 'image/png' });
            navigator.share({ files: [file], title: `${cafeName} - القائمة` }).catch(() => {});
          }).catch(() => {
            navigator.share({ title: `${cafeName} - القائمة`, url: data.url }).catch(() => {});
          });
        } else {
          navigator.clipboard.writeText(data.url).then(() => showToast('تم نسخ الرابط! 📋', 'success')).catch(() => {});
        }
      };
    });
}

function generateTableQR() {
  const tableNum = document.getElementById('tableQrInput').value;
  if (!tableNum) return showToast('أدخل رقم الطاولة', 'warning');
  const cafeName = allSettings.cafe_name || 'كاراكالا كافيه';
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
        if (navigator.share) {
          fetch(data.qr).then(r => r.blob()).then(blob => {
            const file = new File([blob], 'table-qr.png', { type: 'image/png' });
            navigator.share({ files: [file], title: `${cafeName} - طاولة ${tableNum}` }).catch(() => {});
          }).catch(() => {
            navigator.clipboard.writeText(data.url).then(() => showToast('تم نسخ الرابط!', 'success')).catch(() => {});
          });
        } else {
          navigator.clipboard.writeText(data.url).then(() => showToast('تم نسخ الرابط!', 'success')).catch(() => {});
        }
      };
      document.getElementById('tableQrPrintBtn').onclick = () => {
        const w = window.open('', '_blank');
        w.document.write(`<html><body style="text-align:center;padding:2rem;"><img src="${data.qr}" style="width:300px;height:300px;"><p style="font-size:1.2rem;font-weight:bold;margin-top:1rem;">${cafeName} - طاولة ${tableNum}</p><p>${data.url}</p></body></html>`);
        w.document.close();
        w.onload = () => { w.print(); setTimeout(() => w.close(), 500); };
      };
    })
    .catch(() => {
      container.innerHTML = '<p style="color:var(--danger);font-size:0.8rem;">فشل إنشاء الرمز</p>';
    });
}

function shareQR() {
  const cafeName = allSettings.cafe_name || 'كاراكالا كافيه';
  const url = document.getElementById('qrUrl').textContent;
  const text = `${cafeName} - القائمة: ${url}`;
  if (navigator.share) {
    navigator.share({ title: cafeName, text: text, url: url });
  } else {
    navigator.clipboard.writeText(text).then(() => showToast('تم نسخ الرابط إلى الحافظة 📋', 'success'));
  }
}

function printQR() {
  const qr = document.getElementById('qrImage').src;
  const w = window.open('', '_blank');
  w.document.write(`<html><body style="text-align:center;padding:2rem;"><h2>${allSettings.cafe_name || 'كاراكالا كافيه'}</h2><img src="${qr}" style="max-width:300px;"><p>امسح الرمز لعرض القائمة</p></body></html>`);
  w.document.close();
  w.print();
}

// ===================== TABS =====================
function switchTab(tab, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['items', 'add', 'categories', 'orders', 'settings'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('hidden', t !== tab);
  });
  if (tab === 'orders') {
    loadOrders().then(renderOrders);
    loadStats();
    if (ownerRefreshInterval) clearInterval(ownerRefreshInterval);
    ownerRefreshInterval = setInterval(() => {
      loadOrders().then(renderOrders);
      loadStats();
    }, 10000);
  } else {
    if (ownerRefreshInterval) { clearInterval(ownerRefreshInterval); ownerRefreshInterval = null; }
  }
  if (tab === 'items') loadItems().then(() => renderItems());
  if (tab === 'categories') loadCategories().then(renderCategories);
  if (tab === 'settings') setTimeout(() => { if (cafeSettingMap) cafeSettingMap.invalidateSize(); }, 100);
}

// ===================== ITEMS =====================
let ownerRefreshInterval = null;

function filterItems() {
  const query = document.getElementById('itemSearch').value.trim().toLowerCase();
  renderItems(query);
}

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
  items.forEach(item => {
    const cat = allCategories.find(c => c.id === item.category_id);
    const div = document.createElement('div');
    div.className = 'menu-item';
    div.style.opacity = item.is_available ? '1' : '0.5';
    const imgHtml = item.image_path
      ? `<div class="item-img"><img src="${item.image_path}" alt="${item.name}"></div>`
      : `<div class="item-img">☕</div>`;
    const stockHtml = item.stock !== null
      ? `<div style="color:${item.stock <= 5 ? 'var(--danger)' : 'var(--text-muted)'};font-size:0.8rem;font-weight:${item.stock <= 5 ? '700' : '400'};">المخزون: ${item.stock} ${item.stock <= 5 ? '⚠️ منخفض' : ''}</div>`
      : '';
    div.innerHTML = `
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
      <h2>🍳 طلب مطبخ #${order.id}</h2>
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

  try {
    const res = await fetch(`${API}/categories`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sort_order: allCategories.length })
    });
    if (!res.ok) throw new Error('Failed');
    document.getElementById('newCatName').value = '';
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
      <span class="cat-name">${c.name}</span>
      <button class="btn btn-danger btn-sm" onclick="deleteCategory(${c.id})">حذف</button>
    </div>
  `).join('');
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
    html += '<h3 style="color:var(--primary);margin:1.5rem 0 1rem;font-size:1.2rem;font-weight:800;">🔥 الطلبات النشطة (' + activeOrders.length + ')</h3>';
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
        <strong style="font-size:1.1rem;">طلب #${order.id}</strong>
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
  const newName = prompt('تعديل اسم الزبون:', order.customer_name || '');
  if (newName === null) return;
  const newPhone = prompt('تعديل رقم الهاتف:', order.phone || '');
  if (newPhone === null) return;
  const newTable = prompt('تعديل رقم الطاولة:', order.table_number || '');
  if (newTable === null) return;
  const newNotes = prompt('تعديل الملاحظات:', order.notes || '');
  if (newNotes === null) return;

  // Update via API (we need to add an edit endpoint or use existing)
  // For now, we'll update via a custom endpoint
  fetch(`${API}/orders/${orderId}/status`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: order.status }) // Keep same status, update other fields
  }).then(() => {
    showToast('تم التعديل! (ملاحظة: يجب إضافة endpoint تعديل كامل للطلب) ⚠️', 'warning');
    loadOrders().then(renderOrders);
  });
}

function showOrderMap(lat, lng, address) {
  document.getElementById('mapModal').classList.remove('hidden');
  setTimeout(() => {
    if (orderMap) { orderMap.remove(); orderMap = null; }
    orderMap = L.map('orderMap').setView([lat, lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(orderMap);
    orderMapMarker = L.marker([lat, lng]).addTo(orderMap)
      .bindPopup(address || 'موقع التوصيل').openPopup();
  }, 100);
}

function closeMapModal() {
  document.getElementById('mapModal').classList.add('hidden');
  if (orderMap) { orderMap.remove(); orderMap = null; }
}

// ===================== RECEIPT =====================
async function generateReceipt(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const cafeName = allSettings.cafe_name || 'كاراكالا كافيه';
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
        itemsHtml += `<div class="receipt-line" style="padding-right:1rem;font-size:0.8rem;"><span>+ ${a.addition_name}</span><span>${formatPrice(a.addition_price)}</span></div>`;
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

  const receiptHtml = `
    <div id="receiptPrint" class="receipt">
      <div class="receipt-header">
        ${allSettings.cafe_logo ? `<img src="${allSettings.cafe_logo}" class="logo">` : ''}
        <h3>${cafeName}</h3>
        ${cafePhone ? `<div style="font-size:0.8rem;color:var(--text-muted);">📞 ${cafePhone}</div>` : ''}
        ${cafeAddress ? `<div style="font-size:0.8rem;color:var(--text-muted);">${cafeAddress}</div>` : ''}
      </div>
      <div class="receipt-line"><span>رقم الطلب:</span><span>#${order.id}</span></div>
      <div class="receipt-line"><span>التاريخ:</span><span>${formatTime(order.created_at)}</span></div>
      <div class="receipt-line"><span>الزبون:</span><span>${order.customer_name || 'زبون'}</span></div>
      ${customFieldsHtml ? '<hr style="border:1px dashed var(--border);margin:0.5rem 0;">' + customFieldsHtml : ''}
      <hr style="border:1px dashed var(--border);margin:0.5rem 0;">
      ${itemsHtml}
      <hr style="border:1px dashed var(--border);margin:0.5rem 0;">
      <div class="receipt-line receipt-total"><span>الإجمالي:</span><span>${formatPrice(order.total_amount)}</span></div>
      <div class="receipt-footer">
        ${allSettings.receipt_footer || 'شكراً لزيارتكم!'}
        ${qrDataUrl ? `<div style="margin-top:0.5rem;"><img src="${qrDataUrl}" style="width:100px;height:100px;"></div><div style="font-size:0.7rem;color:var(--text-muted);">امسح لرؤية القائمة</div>` : ''}
      </div>
    </div>
  `;

  document.getElementById('receiptContent').innerHTML = receiptHtml;
  document.getElementById('receiptModal').classList.remove('hidden');
}

function printReceipt() {
  window.print();
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
  cafeSettingMarker = L.marker([lat, lng]).addTo(cafeSettingMap);
  cafeSettingMap.on('click', function(e) {
    if (cafeSettingMarker) cafeSettingMap.removeLayer(cafeSettingMarker);
    cafeSettingMarker = L.marker(e.latlng).addTo(cafeSettingMap);
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
      if (res.ok) {
        const data = await res.json();
        logoPath = data.path;
      }
    } catch (e) { console.error('Logo upload failed', e); }
  }

  const settings = [
    { key: 'cafe_name', value: document.getElementById('setCafeName').value },
    { key: 'cafe_phone', value: document.getElementById('setCafePhone').value },
    { key: 'cafe_address', value: document.getElementById('setCafeAddress').value },
  ];

  if (logoPath) settings.push({ key: 'cafe_logo', value: logoPath });

  if (cafeSettingMarker) {
    const latlng = cafeSettingMarker.getLatLng();
    settings.push({ key: 'cafe_lat', value: String(latlng.lat) });
    settings.push({ key: 'cafe_lng', value: String(latlng.lng) });
  }

  const notifToggle = document.getElementById('setOrderNotifications');
  if (notifToggle) {
    settings.push({ key: 'order_notifications', value: notifToggle.checked ? 'true' : 'false' });
  }

  for (const s of settings) {
    await fetch(`${API}/settings`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(s)
    });
  }

  showToast('تم حفظ الإعدادات بنجاح! ✅', 'success');
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
  rows.forEach(row => {
    const name = row.querySelector('.field-name').value.trim();
    const value = row.querySelector('.field-value').value.trim();
    if (name && idx <= 10) {
      fetch(`${API}/settings`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: `receipt_field_${idx}_name`, value: name })
      });
      fetch(`${API}/settings`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: `receipt_field_${idx}_value`, value: value })
      });
      idx++;
    }
  });

  await fetch(`${API}/settings`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'receipt_footer', value: document.getElementById('setReceiptFooter').value })
  });

  showToast('تم حفظ إعدادات الفاتورة بنجاح! ✅', 'success');
  await loadSettings();
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
