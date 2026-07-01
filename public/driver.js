const API = window.location.origin + '/api';
let token = localStorage.getItem('driver_token');
let allOrders = [];
let allSettings = {};
let currentFilter = 'ready';
let currentOrderId = null;
let routeMap = null;
let refreshInterval = null;

// Check auth
if (token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.role === 'driver' && payload.exp * 1000 > Date.now()) {
      showDashboard();
    } else {
      localStorage.removeItem('driver_token');
    }
  } catch {
    localStorage.removeItem('driver_token');
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
      body: JSON.stringify({ role: 'driver', password })
    });

    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'كلمة المرور غير صحيحة';
      if (data.retryAfter) errorEl.textContent += ` (حاول بعد ${data.retryAfter} ثانية)`;
      return;
    }

    token = data.token;
    localStorage.setItem('driver_token', token);
    showDashboard();
  } catch (e) {
    errorEl.textContent = 'تعذر الاتصال بالخادم';
  }
}

function logout() {
  localStorage.removeItem('driver_token');
  if (refreshInterval) clearInterval(refreshInterval);
  location.reload();
}

function authHeaders() {
  return { 'Authorization': 'Bearer ' + token };
}

async function init() {
  await Promise.all([loadSettings(), loadOrders(), loadStats()]);
  renderOrders();
  refreshInterval = setInterval(() => {
    loadOrders().then(renderOrders);
    loadStats();
  }, 5000);
}

async function loadSettings() {
  try {
    const res = await fetch(`${API}/settings`);
    allSettings = await res.json();
  } catch (e) { console.error('Settings error', e); }
}

async function loadOrders() {
  try {
    const res = await fetch(`${API}/orders`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Auth failed');
    allOrders = await res.json();
  } catch (e) {
    console.error('Orders error', e);
    if (e.message === 'Auth failed') { showToast('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى 🔒', 'warning'); logout(); }
  }
}

async function loadStats() {
  try {
    const res = await fetch(`${API}/stats`, { headers: authHeaders() });
    if (!res.ok) return;
    const stats = await res.json();
    document.getElementById('statsGrid').innerHTML = `
      <div class="stat-card"><div class="stat-value">${stats.ready}</div><div class="stat-label">جاهز للتوصيل</div></div>
      <div class="stat-card"><div class="stat-value">${stats.delivering}</div><div class="stat-label">قيد التوصيل</div></div>
      <div class="stat-card"><div class="stat-value">${stats.todayOrders}</div><div class="stat-label">طلبات اليوم</div></div>
    `;
  } catch (e) { console.error('Stats error', e); }
}

function filterOrders(status, el) {
  currentFilter = status;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderOrders();
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

function renderOrders() {
  const container = document.getElementById('ordersContainer');
  let filtered = allOrders.filter(o => o.order_type === 'delivery');
  if (currentFilter !== 'all') filtered = filtered.filter(o => o.status === currentFilter);

  if (filtered.length === 0) {
    container.innerHTML = `<p class="text-center" style="color:var(--text-muted);padding:3rem;">لا توجد طلبات.</p>`;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(order => {
    const card = document.createElement('div');
    card.className = `order-card ${order.status}`;

    let actions = '';
    if (order.status === 'ready') {
      actions = `<button class="btn btn-primary" onclick="startDelivery(${order.id})">🛵 بدء التوصيل</button>`;
    } else if (order.status === 'delivering') {
      actions = `<button class="btn btn-success" onclick="showRoute(${order.id})">🗺️ عرض المسار</button>`;
    }

    let metaLines = '';
    if (order.customer_name) metaLines += `<span class="meta-line"><span class="meta-label">الاسم:</span> ${order.customer_name}</span>`;
    if (order.phone) metaLines += `<span class="meta-line"><span class="meta-label">الهاتف:</span> <a href="tel:${order.phone}">${order.phone}</a></span>`;
    if (order.address_text) metaLines += `<span class="meta-line"><span class="meta-label">العنوان:</span> ${order.address_text}</span>`;
    metaLines += `<span class="meta-line"><span class="meta-label">الوقت:</span> ${formatTime(order.created_at)}</span>`;

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
            <strong>${it.item_name} × ${it.quantity}</strong>
            ${it.additions && it.additions.length > 0 ? `<div class="order-item-additions">${it.additions.map(a => `+ ${a.addition_name}`).join('، ')}</div>` : ''}
          </div>
        `).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;">
        <div class="order-actions">${actions}</div>
        <div style="font-size:1.3rem;font-weight:800;color:var(--primary);">${formatPrice(order.total_amount)}</div>
      </div>
    `;
    container.appendChild(card);
  });
}

async function startDelivery(orderId) {
  try {
    await fetch(`${API}/orders/${orderId}/status`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivering' })
    });
    loadOrders().then(renderOrders);
    loadStats();
  } catch (e) { showToast('تعذر بدء التوصيل ❌', 'error'); }
}

function showRoute(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order || !order.latitude || !order.longitude) {
    showToast('لا يوجد موقع لهذا الطلب 📍', 'warning');
    return;
  }

  currentOrderId = orderId;
  document.getElementById('mapModal').classList.remove('hidden');
  document.getElementById('routeDistance').textContent = '';

  setTimeout(() => {
    if (routeMap) { routeMap.remove(); routeMap = null; }

    const cafeLat = allSettings.cafe_lat ? parseFloat(allSettings.cafe_lat) : 33.5138;
    const cafeLng = allSettings.cafe_lng ? parseFloat(allSettings.cafe_lng) : 36.2765;
    const destLat = parseFloat(order.latitude);
    const destLng = parseFloat(order.longitude);

    routeMap = L.map('routeMap').setView([(cafeLat + destLat) / 2, (cafeLng + destLng) / 2], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(routeMap);

    // Cafe marker
    const cafeIcon = L.divIcon({
      className: 'cafe-marker',
      html: '<div style="background:var(--primary);width:24px;height:24px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:12px;">☕</div>',
      iconSize: [24, 24]
    });
    L.marker([cafeLat, cafeLng], { icon: cafeIcon }).addTo(routeMap)
      .bindPopup(allSettings.cafe_name || 'المقهى').openPopup();

    // Destination marker
    const destIcon = L.divIcon({
      className: 'dest-marker',
      html: '<div style="background:var(--success);width:24px;height:24px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:12px;">🏠</div>',
      iconSize: [24, 24]
    });
    L.marker([destLat, destLng], { icon: destIcon }).addTo(routeMap)
      .bindPopup(order.address_text || 'موقع التوصيل').openPopup();

    // Show distance from cafe to destination
    const cafeDist = calculateDistance(cafeLat, cafeLng, destLat, destLng);
    const etaMinutes = Math.round((cafeDist / 30) * 60); // 30 km/h average
    let distHtml = `المسافة من المقهى: ${cafeDist.toFixed(1)} كم | الوقت المتوقع: ~${etaMinutes} دقيقة`;

    // Show driver location if available and distance to destination
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const driverLat = pos.coords.latitude;
        const driverLng = pos.coords.longitude;
        const driverIcon = L.divIcon({
          className: 'driver-marker',
          html: '<div style="background:var(--info);width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>',
          iconSize: [20, 20]
        });
        L.marker([driverLat, driverLng], { icon: driverIcon }).addTo(routeMap)
          .bindPopup('موقعك الحالي').openPopup();
        const driverDist = calculateDistance(driverLat, driverLng, destLat, destLng);
        const driverEta = Math.round((driverDist / 30) * 60);
        distHtml += ` | المسافة إليك: ${driverDist.toFixed(1)} كم | وصولك: ~${driverEta} دقيقة`;
        document.getElementById('routeDistance').textContent = distHtml;
      }, () => {
        document.getElementById('routeDistance').textContent = distHtml;
      });
    } else {
      document.getElementById('routeDistance').textContent = distHtml;
    }

    // Show/hide deliver button based on status
    const deliverBtn = document.getElementById('deliverBtn');
    if (order.status === 'delivering') {
      deliverBtn.style.display = 'inline-block';
    } else {
      deliverBtn.style.display = 'none';
    }
  }, 100);
}

function getDriverCurrentLocation() {
  if (!routeMap) return;
  if (!navigator.geolocation) {
    showToast('المتصفح لا يدعم تحديد الموقع 📍', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      routeMap.setView([lat, lng], 16);
      const driverIcon = L.divIcon({
        className: 'driver-marker',
        html: '<div style="background:var(--info);width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>',
        iconSize: [20, 20]
      });
      L.marker([lat, lng], { icon: driverIcon }).addTo(routeMap)
        .bindPopup('موقعك الحالي').openPopup();
    },
    () => showToast('تعذر الحصول على الموقع 📍', 'error')
  );
}

function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function markDelivered() {
  if (!currentOrderId) return;
  try {
    await fetch(`${API}/orders/${currentOrderId}/status`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' })
    });
    closeMapModal();
    loadOrders().then(renderOrders);
    loadStats();
  } catch (e) { showToast('تعذر تحديث حالة الطلب ❌', 'error'); }
}

function closeMapModal() {
  document.getElementById('mapModal').classList.add('hidden');
  if (routeMap) { routeMap.remove(); routeMap = null; }
  currentOrderId = null;
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    closeMapModal();
  }
});

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
