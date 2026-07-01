const API = window.location.origin + '/api';
let items = [];
let categories = [];
let cart = [];
let currentItem = null;
let selectedOrderType = 'dine_in';
let deliveryMap = null;
let deliveryMarker = null;
let customerLocation = null;
let cafeLocation = null;
let cafeMap = null;
let settings = {};
let bestSellers = [];

async function loadMenu() {
  try {
    const [catRes, itemRes, settingsRes, bestSellersRes] = await Promise.all([
      fetch(`${API}/categories`),
      fetch(`${API}/items`),
      fetch(`${API}/settings`),
      fetch(`${API}/best-sellers`)
    ]);
    if (!catRes.ok || !itemRes.ok) throw new Error('Network error');
    categories = await catRes.json();
    items = await itemRes.json();
    settings = await settingsRes.json();
    bestSellers = await bestSellersRes.json().catch(() => []);

    // Update cafe name/logo
    if (settings.cafe_name) document.getElementById('cafeName').textContent = settings.cafe_name;
    if (settings.cafe_logo) {
      const logo = document.getElementById('cafeLogo');
      logo.src = settings.cafe_logo;
      logo.style.display = 'inline';
    }
    if (settings.cafe_lat && settings.cafe_lng) {
      cafeLocation = { lat: parseFloat(settings.cafe_lat), lng: parseFloat(settings.cafe_lng) };
    }

    // Check for table number in URL
    const urlParams = new URLSearchParams(window.location.search);
    const tableNum = urlParams.get('table');
    if (tableNum) {
      window.preselectedTable = tableNum;
      const cartPanel = document.getElementById('cartPanel');
      if (cartPanel) {
        let badge = document.getElementById('tableBadge');
        if (!badge) {
          badge = document.createElement('div');
          badge.id = 'tableBadge';
          badge.style.cssText = 'background:var(--primary);color:white;padding:2px 8px;border-radius:10px;font-size:0.8rem;font-weight:700;position:absolute;top:-10px;left:10px;';
          cartPanel.style.position = 'relative';
          cartPanel.appendChild(badge);
        }
        badge.textContent = 'طاولة ' + tableNum;
      }
    }

    renderTabs();
    renderMenu('all');
  } catch (e) {
    document.getElementById('menuGrid').innerHTML = `
      <div class="text-center" style="grid-column:1/-1;padding:3rem;color:var(--text-muted);">
        <p>⚠️ لم نتمكن من تحميل القائمة</p>
        <p class="text-sm">تأكد من تشغيل الخادم على المنفذ 3015</p>
      </div>
    `;
  }
}

function renderTabs() {
  const tabs = document.getElementById('categoryTabs');
  let html = `<button class="tab active" onclick="filterCategory('all', this)">الكل</button>`;
  categories.forEach(cat => {
    html += `<button class="tab" onclick="filterCategory(${cat.id}, this)">${cat.name}</button>`;
  });
  tabs.innerHTML = html;
}

function filterCategory(catId, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderMenu(catId);
}

function renderMenu(catId) {
  const grid = document.getElementById('menuGrid');
  grid.innerHTML = '';
  const filtered = catId === 'all' ? items : items.filter(i => i.category_id === catId);

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="text-center" style="grid-column:1/-1;padding:3rem;color:var(--text-muted);">لا توجد أصناف في هذا القسم</div>`;
    return;
  }

  filtered.forEach(item => {
    if (!item.is_available) return;
    if (item.stock !== null && item.stock <= 0) return;
    const div = document.createElement('div');
    div.className = 'menu-item';
    const imgHtml = item.image_path 
      ? `<div class="item-img"><img src="${item.image_path}" alt="${item.name}"></div>`
      : `<div class="item-img">☕</div>`;
    const isBestSeller = bestSellers.some(bs => String(bs.item_id) === String(item.id));
    const cartItem = cart.find(c => c.id === item.id);
    const cartQty = cartItem ? cartItem.quantity : 0;
    const badgeHtml = isBestSeller ? '<span style="background:var(--warning);color:white;font-size:0.7rem;padding:2px 6px;border-radius:8px;font-weight:700;margin-left:4px;">🔥 الأكثر مبيعاً</span>' : '';
    const cartBadgeHtml = cartQty > 0 ? `<span style="background:var(--primary);color:white;font-size:0.75rem;padding:2px 8px;border-radius:10px;font-weight:700;margin-left:4px;">🛒 ${cartQty}</span>` : '';
    div.innerHTML = `
      ${imgHtml}
      <div class="item-body">
        <div class="item-name">${item.name}${badgeHtml}${cartBadgeHtml}</div>
        <div class="item-desc">${item.description || ''}</div>
        <div class="item-price">${formatPrice(item.price)}</div>
        <button class="btn btn-primary btn-sm" onclick="openItemModal(${item.id})">تخصيص</button>
      </div>
    `;
    grid.appendChild(div);
  });
}

function formatPrice(price) {
  return parseInt(price).toLocaleString('ar-SY') + ' ل.س';
}

function openItemModal(itemId) {
  currentItem = items.find(i => i.id === itemId);
  if (!currentItem) return;

  document.getElementById('modalItemName').textContent = currentItem.name;
  document.getElementById('modalItemDesc').textContent = currentItem.description || '';
  document.getElementById('modalItemPrice').textContent = formatPrice(currentItem.price);
  document.getElementById('modalQty').value = 1;
  document.getElementById('modalNotes').value = '';

  const addDiv = document.getElementById('modalAdditions');
  if (currentItem.additions && currentItem.additions.length > 0) {
    let html = '<div class="additions-list"><label style="display:block;margin-bottom:0.5rem;font-weight:700;color:var(--primary-dark);">إضافات</label>';
    currentItem.additions.forEach(add => {
      html += `
        <label class="addition-option">
          <input type="checkbox" value="${add.id}" data-name="${add.name}" data-price="${add.price}">
          <span>${add.name}</span>
          <span class="add-price">+ ${formatPrice(add.price)}</span>
        </label>
      `;
    });
    html += '</div>';
    addDiv.innerHTML = html;
  } else {
    addDiv.innerHTML = '';
  }

  document.getElementById('itemModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('itemModal').classList.add('hidden');
  currentItem = null;
}

function addToCart() {
  if (!currentItem) return;

  const qty = parseInt(document.getElementById('modalQty').value) || 1;
  const notes = document.getElementById('modalNotes').value;
  const checked = document.querySelectorAll('#modalAdditions input:checked');
  const additions = Array.from(checked).map(cb => ({
    id: parseInt(cb.value),
    name: cb.dataset.name,
    price: parseFloat(cb.dataset.price)
  }));

  cart.push({
    id: currentItem.id,
    name: currentItem.name,
    price: parseFloat(currentItem.price),
    quantity: qty,
    notes: notes,
    additions: additions
  });

  saveCart();
  updateCartUI();
  closeModal();
}

function saveCart() {
  localStorage.setItem('cafeCart', JSON.stringify(cart));
}

function loadCart() {
  const saved = localStorage.getItem('cafeCart');
  if (saved) {
    try { cart = JSON.parse(saved); } catch (e) { cart = []; }
  }
}

function clearCart() {
  cart = [];
  localStorage.removeItem('cafeCart');
  updateCartUI();
}

function updateCartUI() {
  const count = cart.reduce((s, i) => s + i.quantity, 0);
  const total = cart.reduce((s, i) => {
    let t = i.price * i.quantity;
    i.additions.forEach(a => t += a.price * i.quantity);
    return s + t;
  }, 0);

  document.getElementById('cartCount').textContent = count;
  document.getElementById('cartTotal').textContent = total.toLocaleString('ar-SY');
}

function openCheckout() {
  if (cart.length === 0) {
  showToast('السلة فارغة، أضف بعض الأصناف أولاً 🛒', 'warning');
  return;
}

  const container = document.getElementById('checkoutItems');
  container.innerHTML = '';
  let total = 0;

  cart.forEach((item, idx) => {
    let itemTotal = item.price * item.quantity;
    let addsHtml = '';
    item.additions.forEach(a => {
      itemTotal += a.price * item.quantity;
      addsHtml += `<div style="color:var(--text-muted);font-size:0.85rem;">+ ${a.name}</div>`;
    });
    total += itemTotal;

    container.innerHTML += `
      <div style="padding:0.8rem 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;">
          <strong>${item.name} × ${item.quantity}</strong>
          <span style="color:var(--primary);font-weight:700;">${itemTotal.toLocaleString('ar-SY')} ل.س</span>
        </div>
        ${addsHtml}
        ${item.notes ? `<div style="color:var(--text-muted);font-size:0.8rem;font-style:italic;">ملاحظة: ${item.notes}</div>` : ''}
        <button class="btn btn-danger btn-sm" onclick="removeCartItem(${idx})" style="margin-top:0.3rem;">حذف</button>
      </div>
    `;
  });

  document.getElementById('checkoutTotal').textContent = 'الإجمالي: ' + total.toLocaleString('ar-SY') + ' ل.س';
  selectOrderType('dine_in', document.querySelector('[data-type="dine_in"]'));
  if (window.preselectedTable) {
    document.getElementById('tableNumber').value = window.preselectedTable;
  }
  document.getElementById('checkoutModal').classList.remove('hidden');
}

function removeCartItem(idx) {
  cart.splice(idx, 1);
  saveCart();
  updateCartUI();
  openCheckout();
}

function closeCheckout() {
  document.getElementById('checkoutModal').classList.add('hidden');
  if (deliveryMap) { deliveryMap.remove(); deliveryMap = null; }
}

function selectOrderType(type, el) {
  selectedOrderType = type;
  document.querySelectorAll('.order-type-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');

  if (type === 'dine_in') {
    document.getElementById('dineInFields').classList.remove('hidden');
    document.getElementById('deliveryFields').classList.add('hidden');
  } else {
    document.getElementById('dineInFields').classList.add('hidden');
    document.getElementById('deliveryFields').classList.remove('hidden');
    setTimeout(initDeliveryMap, 100);
  }
}

function initDeliveryMap() {
  if (deliveryMap) return;
  const mapEl = document.getElementById('deliveryMap');
  if (!mapEl) return;

  const defaultLat = cafeLocation ? cafeLocation.lat : 33.5138;
  const defaultLng = cafeLocation ? cafeLocation.lng : 36.2765;
  deliveryMap = L.map('deliveryMap').setView([defaultLat, defaultLng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(deliveryMap);

  // Show cafe location marker
  if (cafeLocation) {
    L.marker([cafeLocation.lat, cafeLocation.lng]).addTo(deliveryMap)
      .bindPopup('موقع المقهى').openPopup();
  }

  deliveryMap.on('click', function(e) {
    if (deliveryMarker) deliveryMap.removeLayer(deliveryMarker);
    deliveryMarker = L.marker(e.latlng).addTo(deliveryMap);
    customerLocation = { lat: e.latlng.lat, lng: e.latlng.lng };
    showDeliveryDistance();
  });
}

function getCurrentLocation() {
  if (!navigator.geolocation) {
    showToast('المتصفح لا يدعم تحديد الموقع 📍', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (deliveryMap) {
        deliveryMap.setView([lat, lng], 16);
        if (deliveryMarker) deliveryMap.removeLayer(deliveryMarker);
        deliveryMarker = L.marker([lat, lng]).addTo(deliveryMap);
        customerLocation = { lat, lng };
        showDeliveryDistance();
      }
    },
    () => showToast('تعذر الحصول على الموقع، يرجى النقر على الخريطة يدوياً 📍', 'error')
  );
}

function showDeliveryDistance() {
  if (!customerLocation || !cafeLocation) return;
  const dist = calculateDistance(customerLocation.lat, customerLocation.lng, cafeLocation.lat, cafeLocation.lng);
  // Add or update distance display below the map
  let distEl = document.getElementById('deliveryDistance');
  if (!distEl) {
    distEl = document.createElement('div');
    distEl.id = 'deliveryDistance';
    distEl.style.cssText = 'margin-top:0.5rem;font-weight:700;color:var(--primary);text-align:center;';
    const mapContainer = document.getElementById('deliveryMap');
    mapContainer.parentNode.insertBefore(distEl, mapContainer.nextSibling);
  }
  distEl.textContent = `المسافة من المقهى: ${dist.toFixed(1)} كم`;
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

async function submitOrder() {
  const name = document.getElementById('customerName').value || null;

  const orderItems = cart.map(c => ({
    id: c.id,
    name: c.name,
    price: c.price,
    quantity: c.quantity,
    additions: c.additions
  }));

  const payload = {
    customer_name: name,
    items: orderItems,
    notes: '',
    order_type: selectedOrderType
  };

  if (selectedOrderType === 'dine_in') {
    const tableNum = document.getElementById('tableNumber').value.trim();
    if (!tableNum) {
      showToast('يرجى إدخال رقم الطاولة 🪑', 'warning');
      document.getElementById('tableNumber').focus();
      return;
    }
    payload.table_number = tableNum;
  } else {
    const phone = document.getElementById('phoneNumber').value.trim();
    if (!phone) {
      showToast('يرجى إدخال رقم الهاتف 📞', 'warning');
      document.getElementById('phoneNumber').focus();
      return;
    }
    payload.phone = phone;
    payload.address_text = document.getElementById('addressText').value || null;
    if (customerLocation) {
      payload.latitude = customerLocation.lat;
      payload.longitude = customerLocation.lng;
    }
  }

  try {
    const res = await fetch(`${API}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Order failed');
    }

    const order = await res.json();
    window.lastOrder = order;
    window.lastOrderItems = cart.map(c => ({...c})); // save copy of cart items

    document.getElementById('successOrderId').textContent = '#' + order.id;
    document.getElementById('successModal').classList.remove('hidden');

    clearCart();
    closeCheckout();
  } catch (e) {
    showToast('تعذر إرسال الطلب، يرجى المحاولة لاحقاً ❌', 'error');
  }
}

function showCustomerReceipt() {
  if (!window.lastOrder) return;
  const order = window.lastOrder;
  const items = window.lastOrderItems || [];
  const cafeName = settings.cafe_name || 'كاراكالا كافيه';

  let itemsHtml = '';
  let total = 0;
  items.forEach(it => {
    let subtotal = it.price * it.quantity;
    let addsHtml = '';
    if (it.additions && it.additions.length > 0) {
      it.additions.forEach(a => {
        subtotal += a.price * it.quantity;
        addsHtml += `<div style="padding-right:1rem;font-size:0.8rem;color:var(--text-muted);">+ ${a.name}</div>`;
      });
    }
    total += subtotal;
    itemsHtml += `<div style="display:flex;justify-content:space-between;margin-bottom:0.3rem;"><span>${it.name} × ${it.quantity}</span><span>${subtotal.toLocaleString('ar-SY')} ل.س</span></div>${addsHtml}`;
  });

  const receiptHtml = `
    <div id="customerReceiptPrint" class="receipt">
      <div class="receipt-header" style="text-align:center;">
        <h3>${cafeName}</h3>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem;font-size:0.9rem;"><span>رقم الطلب:</span><span>#${order.id}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem;font-size:0.9rem;"><span>التاريخ:</span><span>${new Date(order.created_at).toLocaleString('ar-SY')}</span></div>
      <hr style="border:1px dashed var(--border);margin:0.5rem 0;">
      ${itemsHtml}
      <hr style="border:1px dashed var(--border);margin:0.5rem 0;">
      <div style="display:flex;justify-content:space-between;font-weight:800;color:var(--primary);font-size:1.1rem;"><span>الإجمالي:</span><span>${total.toLocaleString('ar-SY')} ل.س</span></div>
      <div style="text-align:center;margin-top:1rem;color:var(--text-muted);font-size:0.8rem;">شكراً لزيارتكم!</div>
    </div>
  `;

  document.getElementById('customerReceiptContent').innerHTML = receiptHtml;
  document.getElementById('customerReceiptModal').classList.remove('hidden');
}

function copyReceiptText() {
  const text = document.getElementById('customerReceiptContent').innerText;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('تم نسخ الفاتورة! 📋', 'success');
    }).catch(() => {
      showToast('حدد النص وانسخه يدوياً', 'warning');
    });
  } else {
    showToast('حدد النص وانسخه يدوياً', 'warning');
  }
}

function closeCustomerReceipt() {
  document.getElementById('customerReceiptModal').classList.add('hidden');
}

function closeSuccess() {
  document.getElementById('successModal').classList.add('hidden');
}

// ===================== CAFE LOCATION =====================
function showCafeLocation() {
  if (!cafeLocation) {
    showToast('لم يتم تحديد موقع المقهى بعد 📍', 'warning');
    return;
  }
  document.getElementById('cafeLocationModal').classList.remove('hidden');
  document.getElementById('cafeDistance').textContent = '';
  setTimeout(() => {
    if (cafeMap) { cafeMap.remove(); cafeMap = null; }
    cafeMap = L.map('cafeMap').setView([cafeLocation.lat, cafeLocation.lng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(cafeMap);
    L.marker([cafeLocation.lat, cafeLocation.lng]).addTo(cafeMap)
      .bindPopup(settings.cafe_name || 'كاراكالا كافيه').openPopup();

    // Show user location and distance if available
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const userLat = pos.coords.latitude;
        const userLng = pos.coords.longitude;
        L.marker([userLat, userLng], { icon: L.divIcon({ className: 'user-marker', html: '<div style="background:#5A8F5A;width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>' }) }).addTo(cafeMap);
        const dist = calculateDistance(userLat, userLng, cafeLocation.lat, cafeLocation.lng);
        document.getElementById('cafeDistance').textContent = `المسافة: ${dist.toFixed(1)} كم`;
      }, () => {});
    }
  }, 100);
}

function getCafeCurrentLocation() {
  if (!cafeMap) return;
  if (!navigator.geolocation) {
    showToast('المتصفح لا يدعم تحديد الموقع 📍', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      cafeMap.setView([lat, lng], 16);
      L.marker([lat, lng], { icon: L.divIcon({ className: 'user-marker', html: '<div style="background:#5A8F5A;width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>' }) }).addTo(cafeMap)
        .bindPopup('موقعك الحالي').openPopup();
      if (cafeLocation) {
        const dist = calculateDistance(lat, lng, cafeLocation.lat, cafeLocation.lng);
        document.getElementById('cafeDistance').textContent = `المسافة: ${dist.toFixed(1)} كم`;
      }
    },
    () => showToast('تعذر الحصول على الموقع 📍', 'error')
  );
}

function closeCafeLocation() {
  document.getElementById('cafeLocationModal').classList.add('hidden');
  if (cafeMap) { cafeMap.remove(); cafeMap = null; }
}

// ===================== ORDER TRACKING =====================
function showOrderStatus() {
  document.getElementById('orderStatusModal').classList.remove('hidden');
  document.getElementById('trackOrderId').value = '';
  document.getElementById('trackResult').innerHTML = '';
}

function closeOrderStatus() {
  document.getElementById('orderStatusModal').classList.add('hidden');
}

async function trackOrder() {
  const orderId = document.getElementById('trackOrderId').value;
  if (!orderId) return;

  try {
    const res = await fetch(`${API}/orders/${orderId}`);
    if (!res.ok) throw new Error('Order not found');
    const order = await res.json();

    const statusLabels = {
      pending: '⏳ قيد الانتظار',
      preparing: '👨‍🍳 قيد التحضير',
      ready: '✅ جاهز',
      delivering: '🛵 في الطريق',
      completed: '✔️ تم التسليم',
      cancelled: '❌ ملغى'
    };

    let html = `
      <div class="card" style="margin-top:1rem;">
        <div style="text-align:center;margin-bottom:1rem;">
          <div style="font-size:3rem;">${statusLabels[order.status] || order.status}</div>
        </div>
        <div class="order-items">
          ${order.items.map(it => `
            <div class="order-item-line">
              <strong>${it.item_name} × ${it.quantity}</strong>
              ${it.additions && it.additions.length > 0 ? `<div class="order-item-additions">${it.additions.map(a => `+ ${a.addition_name}`).join('، ')}</div>` : ''}
            </div>
          `).join('')}
        </div>
        <div style="text-align:left;font-weight:800;color:var(--primary);margin-top:1rem;">
          الإجمالي: ${formatPrice(order.total_amount)}
        </div>
    `;

    // Show delivery location map if it's a delivery order and not yet completed
    if (order.order_type === 'delivery' && order.latitude && order.longitude && order.status !== 'completed' && order.status !== 'cancelled') {
      html += `
        <div class="map-container" id="trackOrderMap" style="height:200px;margin-top:1rem;"></div>
        <div id="trackOrderDistance" style="margin-top:0.5rem;font-weight:700;color:var(--primary);text-align:center;"></div>
      `;
    }

    // Mark completed button for all non-completed, non-cancelled orders
    if (order.status !== 'completed' && order.status !== 'cancelled') {
      html += `<button class="btn btn-success btn-block mt-1" onclick="confirmReceived(${order.id})">✔️ تأكيد استلام الطلب (إنهاء الطلب)</button>`;
    }

    // Cancel button for pending orders only
    if (order.status === 'pending') {
      html += `<button class="btn btn-danger btn-block mt-1" onclick="cancelCustomerOrder(${order.id})">❌ إلغاء الطلب</button>`;
    }

    html += '</div>';
    document.getElementById('trackResult').innerHTML = html;

    // Init map if we added one
    if (order.order_type === 'delivery' && order.latitude && order.longitude && order.status !== 'completed' && order.status !== 'cancelled') {
      setTimeout(() => {
        const trackMap = L.map('trackOrderMap').setView([order.latitude, order.longitude], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(trackMap);
        L.marker([order.latitude, order.longitude]).addTo(trackMap).bindPopup(order.address_text || 'موقع التوصيل').openPopup();
        if (cafeLocation) {
          L.marker([cafeLocation.lat, cafeLocation.lng]).addTo(trackMap).bindPopup('المقهى');
          const dist = calculateDistance(order.latitude, order.longitude, cafeLocation.lat, cafeLocation.lng);
          document.getElementById('trackOrderDistance').textContent = `المسافة من المقهى: ${dist.toFixed(1)} كم`;
        }
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition((pos) => {
            const userLat = pos.coords.latitude;
            const userLng = pos.coords.longitude;
            L.marker([userLat, userLng], { icon: L.divIcon({ className: 'user-marker', html: '<div style="background:#5A8F5A;width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>' }) }).addTo(trackMap);
          }, () => {});
        }
      }, 100);
    }
  } catch (e) {
    document.getElementById('trackResult').innerHTML = '<p style="color:var(--danger);text-align:center;margin-top:1rem;">الطلب غير موجود</p>';
  }
}

async function confirmReceived(orderId) {
  const confirmed = await showConfirm('هل أنت متأكد من استلام الطلب؟ بعد التأكيد لن يتمكن أحد من رؤية موقعك.', 'تأكيد الاستلام', '✅');
  if (!confirmed) return;
  try {
    const res = await fetch(`${API}/orders/${orderId}/customer-status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed');
    }
    showToast('تم تأكيد استلام الطلب بنجاح! ✅', 'success');
    trackOrder();
  } catch (e) {
    showToast('تعذر تأكيد الاستلام، حاول مرة أخرى ❌', 'error');
  }
}

async function cancelCustomerOrder(orderId) {
  const confirmed = await showConfirm('هل تريد إلغاء هذا الطلب؟', 'تأكيد الإلغاء', '❌');
  if (!confirmed) return;
  try {
    const res = await fetch(`${API}/orders/${orderId}/customer-status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed');
    }
    showToast('تم إلغاء الطلب بنجاح ✅', 'success');
    trackOrder();
  } catch (e) {
    showToast('تعذر إلغاء الطلب، حاول مرة أخرى ❌', 'error');
  }
}

// Close modals on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    if (!e.target.id.includes('success')) {
      e.target.classList.add('hidden');
      if (e.target.id === 'checkoutModal' && deliveryMap) { deliveryMap.remove(); deliveryMap = null; }
      if (e.target.id === 'cafeLocationModal' && cafeMap) { cafeMap.remove(); cafeMap = null; }
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

loadCart();
updateCartUI();
loadMenu();

document.getElementById('trackOrderId').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') trackOrder();
});

// Handle #track hash from splash screen
if (window.location.hash === '#track') {
  setTimeout(() => showOrderStatus(), 500);
}
