import './style.css';

const app = document.querySelector('#app');
const amapKey = import.meta.env.VITE_AMAP_KEY;
const amapSecurityCode = import.meta.env.VITE_AMAP_SECURITY_CODE;
const geocodeCacheKey = 'ningbo-service-map-name-geocode-v6';
const state = {
  points: [],
  filtered: [],
  selected: null,
  view: 'map',
  admin: false,
  showVillageMarkers: false,
  search: '',
  district: '全部区域',
  type: '全部类型',
  status: '全部状态',
  map: null,
  markers: [],
  userLocation: null,
  userMarker: null,
  geocoder: null,
  placeSearch: null,
  geocodeCache: {},
  townCenterCache: {},
  geocodeQueue: [],
  geocodeRunning: false,
  geocodeStarted: false,
  geocodeStats: { total: 0, done: 0, success: 0, failed: 0 }
};

const districtOrder = ['海曙', '江北', '镇海', '北仑', '鄞州', '奉化', '余姚', '慈溪', '宁海', '象山', '前湾', '高新'];
const typeOrder = ['县级窗口', '乡镇延伸点', '村级代办点'];
const escapeHtml = (value = '') =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

const iconForType = (type) => {
  if (type === '县级窗口') return 'center';
  if (type === '乡镇延伸点') return 'town';
  return 'village';
};

const markerContent = (type) => {
  const element = document.createElement('div');
  element.className = `map-marker marker-${iconForType(type)}`;
  const label = type === '县级窗口' ? '县' : type === '乡镇延伸点' ? '乡' : '村';
  element.innerHTML = `<span><b>${label}</b></span>`;
  return element;
};

const getQueryText = (point) =>
  [point.name, point.district, point.town, point.village, point.address, point.business].join(' ').toLowerCase();

const isEstimatedCoordinate = (point) => !point.coordinateSource || point.coordinateSource === 'district-estimate' || point.coordinateSource === 'town-estimate';

const townCenters = {
  海曙: {
    集士港镇: [121.455, 29.879],
    横街镇: [121.346, 29.862],
    鄞江镇: [121.352, 29.785],
    洞桥镇: [121.419, 29.803],
    章水镇: [121.239, 29.782],
    龙观乡: [121.278, 29.719],
    古林镇: [121.455, 29.822],
    高桥镇: [121.493, 29.892],
    月湖街道: [121.547, 29.872],
    西门街道: [121.536, 29.883],
    江厦街道: [121.555, 29.872],
    南门街道: [121.536, 29.858],
    鼓楼街道: [121.552, 29.880],
    白云街道: [121.516, 29.872],
    望春街道: [121.493, 29.878],
    段塘街道: [121.523, 29.845],
    石碶街道: [121.500, 29.825]
  },
  宁海: {
    长街镇: [121.610, 29.230],
    胡陈乡: [121.552, 29.338],
    力洋镇: [121.565, 29.268],
    茶院镇: [121.508, 29.238],
    一市镇: [121.405, 29.182],
    越溪乡: [121.472, 29.142],
    桑洲镇: [121.210, 29.245],
    岔路镇: [121.282, 29.288],
    前童镇: [121.323, 29.298],
    黄坛镇: [121.322, 29.378],
    西店镇: [121.435, 29.530],
    深甽镇: [121.245, 29.465],
    大佳何镇: [121.487, 29.415],
    强蛟镇: [121.570, 29.462],
    桥头胡街道: [121.480, 29.355],
    跃龙街道: [121.425, 29.288],
    桃源街道: [121.438, 29.318],
    梅林街道: [121.440, 29.382]
  },
  高新: {
    贵驷街道: [121.640, 29.912],
    梅墟街道: [121.630, 29.885],
    新明街道: [121.605, 29.884],
    聚贤街道: [121.622, 29.892]
  }
};

function coordinateText(point) {
  if (point.coordinateSource === 'amap-poi-search') return '高德站点搜索大致位置';
  if (point.coordinateSource === 'amap-name-geocode') return '高德名称匹配大致位置';
  if (point.coordinateSource === 'amap-geocode') return '高德地址解析位置';
  if (point.coordinateSource === 'manual') return '人工核验位置';
  if (point.coordinateSource === 'town-estimate') return '镇街名称估算大致位置';
  return '区县中心估算位置';
}

function loadGeocodeCache() {
  try {
    state.geocodeCache = JSON.parse(localStorage.getItem(geocodeCacheKey) || '{}');
  } catch {
    state.geocodeCache = {};
  }
}

function saveGeocodeCache() {
  try {
    localStorage.setItem(geocodeCacheKey, JSON.stringify(state.geocodeCache));
  } catch {
    // 浏览器可能禁用本地存储，缓存失败不影响地图使用。
  }
}

function applyCachedCoordinates(point) {
  const cached = state.geocodeCache[point.id];
  if (!cached) return;
  point.lng = cached.lng;
  point.lat = cached.lat;
  point.coordinateSource = cached.coordinateSource;
  point.coordinateAccuracy = cached.coordinateAccuracy;
  point.geocodedAddress = cached.geocodedAddress;
  point.geocodeQuery = cached.geocodeQuery;
}

function hashText(value = '') {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function estimateAroundCenter(point, center, source = '镇街名称估算', query = '') {
  const hash = hashText(`${point.district}-${point.town}-${point.village || point.name}`);
  const angle = ((hash % 360) * Math.PI) / 180;
  const ring = ((hash >>> 9) % 1000) / 1000;
  const urbanTown = /街道$/.test(point.town || '') || point.district === '高新';
  const radius = urbanTown ? 0.004 + ring * 0.014 : 0.008 + ring * 0.036;
  const lngAdjust = Math.cos(angle) * radius;
  const latAdjust = Math.sin(angle) * radius * 0.82;
  return {
    lng: Number((center[0] + lngAdjust).toFixed(6)),
    lat: Number((center[1] + latAdjust).toFixed(6)),
    coordinateSource: 'town-estimate',
    coordinateAccuracy: source,
    geocodedAddress: `${point.district}${point.town}${point.village || point.name}`,
    geocodeQuery: query || `${point.district}${point.town}`
  };
}

function applyTownEstimate(point) {
  if (!isEstimatedCoordinate(point)) return;
  const center = townCenters[point.district]?.[point.town];
  if (!center) return;
  Object.assign(point, estimateAroundCenter(point, center, '镇街名称估算'));
}

function buildGeocodeQuery(point) {
  const village = point.village ? point.village.replace(/村级代办点$/, '') : '';
  if (point.type === '村级代办点' && village) {
    return `宁波市${point.district}${point.town}${village}村委会`;
  }
  const name = point.name === '无' ? '' : point.name;
  const address = point.address && point.address !== '村委会'
    ? point.address
    : `${point.town}${name}`;
  return `宁波市${point.district}${address}`
    .replace(/0?574[-—\s]*\d{7,8}/g, '')
    .replace(/1\d{10}/g, '')
    .replace(/[，,；;。]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePlaceName(value = '') {
  return String(value)
    .replace(/村级代办点|代办点|村民委员会|居民委员会|村委会|居委会/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function uniqueCompact(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function buildPoiKeywords(point) {
  const district = point.district || '';
  const town = point.town || '';
  const rawName = point.name === '无' ? '' : point.name;
  const village = normalizePlaceName(point.village || rawName);
  const name = normalizePlaceName(rawName);
  const address = point.address && point.address !== '村委会' ? point.address : '';
  const base = village || name;

  return uniqueCompact([
    `宁波市${district}${town}${base}村委会`,
    `宁波市${district}${town}${base}社区`,
    `宁波市${district}${town}${base}`,
    rawName && `宁波市${district}${rawName}`,
    rawName && `宁波市${district}${town}${rawName}`,
    address && `宁波市${district}${address}`,
    buildGeocodeQuery(point)
  ]);
}

function renderShell() {
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">甬</div>
          <div>
            <div class="brand-title">宁波市不动产登记服务地图</div>
            <div class="brand-subtitle">图上找点 · 线上指引 · 线下办理</div>
          </div>
        </div>
        <div class="topbar-actions">
          <span class="data-badge"><span class="live-dot"></span>数据已同步</span>
          <button class="nav-button ${state.admin ? '' : 'active'}" data-action="map">服务地图</button>
          <button class="nav-button ${state.admin ? 'active' : ''}" data-action="admin">管理台</button>
        </div>
      </header>
      <main class="workspace">
        <section class="main-stage">
          <div class="stage-heading">
            <div>
              <div class="eyebrow">PUBLIC SERVICE DIRECTORY</div>
              <h1>${state.admin ? '服务网点管理台' : '全市服务网点一张图'}</h1>
              <p>${state.admin ? '维护网点基础信息、运营状态和服务范围' : '查找离你最近的登记窗口、延伸服务点和村级代办点'}</p>
            </div>
            <div class="heading-actions">
              <button class="outline-button" data-action="locate">定位我</button>
              <button class="primary-button" data-action="scan">生成服务二维码</button>
            </div>
          </div>
          ${state.admin ? renderAdmin() : renderMapWorkspace()}
        </section>
      </main>
      ${state.selected ? renderDetailDrawer() : ''}
      <div id="toast" class="toast" aria-live="polite"></div>
    </div>
  `;
  bindActions();
  if (!state.admin) {
    setupMap()
      .then(() => renderMap())
      .catch((error) => {
        const mapElement = document.querySelector('#map');
        if (mapElement) {
          mapElement.innerHTML = `<div class="map-error"><strong>高德地图加载失败</strong><span>${escapeHtml(error.message)}</span></div>`;
        }
      });
  }
}

function renderMapWorkspace() {
  return `
    <div class="content-grid">
      <section class="map-panel">
        <div id="map" class="map-canvas"></div>
        <label class="map-layer-toggle">
          <input id="show-village-markers" type="checkbox" ${state.showVillageMarkers ? 'checked' : ''} />
          <span>显示村级代办点</span>
        </label>
        <div class="map-legend">
          <span><i class="legend-dot center"></i>县级窗口</span>
          <span><i class="legend-dot town"></i>乡镇延伸点</span>
          <span><i class="legend-dot village"></i>村级代办点</span>
        </div>
        <div class="map-scale-note">已按代办点名称自动匹配大致位置 · 详细业务以网点现场公示为准</div>
      </section>
      <aside class="directory-panel">
        <div class="search-row">
          <label class="search-box">
            <span class="search-glyph">⌕</span>
            <input id="search-input" value="${escapeHtml(state.search)}" placeholder="搜索网点、地址、乡镇或业务" />
            <button class="clear-search" data-action="clear-search" title="清空搜索">×</button>
          </label>
          <button class="filter-toggle" data-action="toggle-filters">筛选</button>
        </div>
        <div class="filter-row">
          <select id="district-filter" aria-label="行政区划">
            <option>全部区域</option>
            ${districtOrder.map((item) => `<option ${state.district === item ? 'selected' : ''}>${item}</option>`).join('')}
          </select>
          <select id="type-filter" aria-label="网点类型">
            <option>全部类型</option>
            ${typeOrder.map((item) => `<option ${state.type === item ? 'selected' : ''}>${item}</option>`).join('')}
          </select>
          <select id="status-filter" aria-label="运营状态">
            <option>全部状态</option>
            <option ${state.status === '正常运营' ? 'selected' : ''}>正常运营</option>
            <option ${state.status === '暂停服务' ? 'selected' : ''}>暂停服务</option>
          </select>
        </div>
        <div class="result-summary">
          <strong>${state.filtered.length.toLocaleString()}</strong>
          <span>个服务点</span>
          <button data-action="reset-filters">重置条件</button>
        </div>
        <div class="result-tabs">
          <button class="${state.view === 'map' ? 'active' : ''}" data-action="set-view" data-view="map">地图</button>
          <button class="${state.view === 'list' ? 'active' : ''}" data-action="set-view" data-view="list">列表</button>
        </div>
        <div class="directory-list">
          ${state.filtered.slice(0, 80).map(renderPointCard).join('')}
          ${state.filtered.length > 80 ? `<div class="list-footnote">已展示前 80 个结果，请继续缩小筛选范围</div>` : ''}
          ${state.filtered.length === 0 ? '<div class="empty-state"><strong>没有找到匹配网点</strong><span>试试更换区域、类型或搜索关键词</span></div>' : ''}
        </div>
      </aside>
    </div>
    <section class="stats-strip">
      ${renderStat('服务点总数', state.points.length.toLocaleString(), '覆盖全市 12 个区域')}
      ${renderStat('县级窗口', countType('县级窗口').toLocaleString(), '综合登记服务')}
      ${renderStat('乡镇延伸点', countType('乡镇延伸点').toLocaleString(), '便民服务中心及自然资源所')}
      ${renderStat('名称匹配定位', countGeocoded().toLocaleString(), geocodeProgressText())}
    </section>
  `;
}

function geocodeProgressText() {
  if (state.geocodeRunning || state.geocodeQueue.length) {
    return `正在匹配 ${state.geocodeStats.done.toLocaleString()} / ${state.geocodeStats.total.toLocaleString()}`;
  }
  return countEstimated() ? `待匹配 ${countEstimated().toLocaleString()} 个` : '已完成当前匹配';
}

function renderPointCard(point) {
  return `
    <button class="point-card" data-action="select-point" data-id="${point.id}">
      <span class="point-type ${iconForType(point.type)}">${point.type}</span>
        <span class="point-card-body">
          <strong>${escapeHtml(point.name)}</strong>
          <span>${escapeHtml(point.district)} · ${escapeHtml(point.town || '宁波市')}</span>
        <small>${escapeHtml(point.address || '地址信息待补充')} · ${coordinateText(point)}</small>
      </span>
      <span class="point-arrow">›</span>
    </button>
  `;
}

function renderStat(label, value, note) {
  return `<div class="stat-item"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`;
}

function renderAdmin() {
  const districtCounts = districtOrder.map((district) => ({
    district,
    total: state.points.filter((point) => point.district === district).length,
    village: state.points.filter((point) => point.district === district && point.type === '村级代办点').length
  }));
  return `
    <section class="admin-layout">
      <div class="admin-toolbar">
        <div>
          <div class="section-kicker">网点信息维护</div>
          <h2>数据管理</h2>
        </div>
        <div class="toolbar-actions">
          <button class="outline-button" data-action="download-data">导出当前数据</button>
          <label class="primary-button file-button">导入 Excel<input id="import-input" type="file" accept=".xls,.xlsx" /></label>
        </div>
      </div>
      <div class="admin-metrics">
        ${renderStat('记录总数', state.points.length.toLocaleString(), '来自 12 份区域统计表')}
        ${renderStat('正常运营', state.points.filter((item) => item.status === '正常运营').length.toLocaleString(), '当前可查询')}
        ${renderStat('有电话记录', state.points.filter((item) => item.phone).length.toLocaleString(), '可直接联系')}
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>网点名称</th><th>区域</th><th>类型</th><th>乡镇 / 街道</th><th>联系电话</th><th>状态</th><th>来源</th></tr></thead>
          <tbody>
            ${state.points.slice(0, 100).map((point) => `
              <tr>
                <td><strong>${escapeHtml(point.name)}</strong><small>${escapeHtml(point.address || '地址待补充')}</small></td>
                <td>${escapeHtml(point.district)}</td>
                <td><span class="table-type ${iconForType(point.type)}">${point.type}</span></td>
                <td>${escapeHtml(point.town)}</td>
                <td>${escapeHtml(point.phone || '未登记')}</td>
                <td><span class="status-pill">${escapeHtml(point.status)}</span></td>
                <td class="source-cell">${escapeHtml(point.source.replace(/附件１?\.|不动产登记服务向乡（镇）村延伸服务点位信息统计表-/g, '').replace('.xls', ''))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="district-overview">
        <div class="section-kicker">区域分布</div>
        <div class="district-grid">
          ${districtCounts.map((item) => `
            <div class="district-row">
              <span>${item.district}</span><div class="bar-track"><i style="width:${Math.max(5, (item.total / Math.max(...districtCounts.map((x) => x.total))) * 100)}%"></i></div><strong>${item.total}</strong>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

function renderDetailDrawer() {
  const point = state.selected;
  return `
    <div class="drawer-backdrop" data-action="close-detail"></div>
    <aside class="detail-drawer">
      <button class="drawer-close" data-action="close-detail" title="关闭">×</button>
      <span class="point-type ${iconForType(point.type)}">${point.type}</span>
      <h2>${escapeHtml(point.name)}</h2>
      <div class="detail-location">${escapeHtml(point.district)} · ${escapeHtml(point.town || '宁波市')}</div>
      <div class="detail-status"><span class="live-dot"></span>${escapeHtml(point.status)}</div>
      <div class="detail-section">
        <span class="detail-label">办理地址</span>
        <p>${escapeHtml(point.address || '暂无详细地址')}</p>
      </div>
      <div class="detail-section">
        <span class="detail-label">地图位置来源</span>
        <p>${escapeHtml(coordinateText(point))}${point.geocodedAddress ? `：${escapeHtml(point.geocodedAddress)}` : ''}</p>
      </div>
      <div class="detail-section">
        <span class="detail-label">联系电话</span>
        <p>${point.phone ? `<a href="tel:${escapeHtml(point.phone.split('、')[0])}">${escapeHtml(point.phone)}</a>` : '暂无电话记录'}</p>
      </div>
      <div class="detail-section">
        <span class="detail-label">可办业务</span>
        <p>${escapeHtml(point.business || '请以现场公示为准')}</p>
      </div>
      ${point.village ? `<div class="detail-section"><span class="detail-label">服务村</span><p>${escapeHtml(point.village)}</p></div>` : ''}
      ${point.agent ? `<div class="detail-section"><span class="detail-label">代办联系人</span><p>${escapeHtml(point.agent)}</p></div>` : ''}
      <div class="drawer-actions">
        <button class="primary-button" data-action="focus-point" data-id="${point.id}">地图定位</button>
        <button class="outline-button" data-action="navigate-point" data-id="${point.id}">导航到这里</button>
        <button class="outline-button" data-action="copy-address" data-id="${point.id}">复制地址</button>
      </div>
    </aside>
  `;
}

function navigationUrl(point) {
  const name = encodeURIComponent(point.name || '服务点');
  return `https://uri.amap.com/navigation?to=${point.lng},${point.lat},${name}&mode=car&policy=1&coordinate=gaode&callnative=0`;
}

async function loadData() {
  loadGeocodeCache();
  const response = await fetch('/data/service-points.json');
  state.points = await response.json();
  state.points.forEach(applyCachedCoordinates);
  state.points.forEach(applyTownEstimate);
  state.filtered = [...state.points];
  renderShell();
}

function countType(type) {
  return state.points.filter((point) => point.type === type).length;
}

function countGeocoded() {
  return state.points.filter((point) => point.coordinateSource === 'amap-poi-search' || point.coordinateSource === 'amap-name-geocode' || point.coordinateSource === 'amap-geocode' || point.coordinateSource === 'manual').length;
}

function countEstimated() {
  return state.points.filter(isEstimatedCoordinate).length;
}

function applyFilters() {
  const search = state.search.trim().toLowerCase();
  state.filtered = state.points.filter((point) => {
    const matchesSearch = !search || getQueryText(point).includes(search);
    const matchesDistrict = state.district === '全部区域' || point.district === state.district;
    const matchesType = state.type === '全部类型' || point.type === state.type;
    const matchesStatus = state.status === '全部状态' || point.status === state.status;
    return matchesSearch && matchesDistrict && matchesType && matchesStatus;
  });
  renderShell();
}

function loadAMap() {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (!amapKey) return Promise.reject(new Error('未配置 VITE_AMAP_KEY'));
  if (amapSecurityCode) {
    window._AMapSecurityConfig = { securityJsCode: amapSecurityCode };
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-amap-loader]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.AMap), { once: true });
      existing.addEventListener('error', () => reject(new Error('高德地图脚本加载失败')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.dataset.amapLoader = 'true';
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(amapKey)}`;
    script.async = true;
    script.onload = () => resolve(window.AMap);
    script.onerror = () => reject(new Error('高德地图脚本加载失败，请检查 Key、域名白名单或网络连接'));
    document.head.appendChild(script);
  });
}

async function setupMap() {
  const AMap = await loadAMap();
  state.map = new AMap.Map('map', {
    zoom: 10,
    center: [121.55, 29.87],
    viewMode: '2D',
    resizeEnable: true,
    features: ['bg', 'road']
  });
  if (!state.geocodeStarted) {
    state.geocodeStarted = true;
    scheduleNameGeocoding(state.points);
  }
}

function renderMap() {
  if (!state.map) return;
  state.map.remove(state.markers);
  state.markers = [];
  const mapPoints = state.filtered.filter((point) => state.showVillageMarkers || point.type !== '村级代办点');
  mapPoints.slice(0, 520).forEach((point) => {
    const marker = new window.AMap.Marker({
      position: [point.lng, point.lat],
      title: `${point.name}（${coordinateText(point)}）`,
      content: markerContent(point.type),
      offset: new window.AMap.Pixel(-11, -11),
      anchor: 'center'
    });
    marker.on('click', () => {
      state.selected = point;
      renderShell();
    });
    marker.setMap(state.map);
    state.markers.push(marker);
  });
  scheduleNameGeocoding(mapPoints.slice(0, 520), true);
}

function ensureGeocoder() {
  if (state.geocoder) return Promise.resolve(state.geocoder);
  return new Promise((resolve) => {
    window.AMap.plugin('AMap.Geocoder', () => {
      state.geocoder = new window.AMap.Geocoder({ city: '宁波' });
      resolve(state.geocoder);
    });
  });
}

function ensurePlaceSearch() {
  if (state.placeSearch) return Promise.resolve(state.placeSearch);
  return new Promise((resolve) => {
    window.AMap.plugin('AMap.PlaceSearch', () => {
      state.placeSearch = new window.AMap.PlaceSearch({
        city: '宁波',
        citylimit: true,
        extensions: 'all',
        pageSize: 10,
        pageIndex: 1
      });
      resolve(state.placeSearch);
    });
  });
}

function scheduleNameGeocoding(points, priority = false) {
  const candidates = points.filter((point) => isEstimatedCoordinate(point) && !state.geocodeCache[point.id]);
  if (!candidates.length) return;
  const existing = new Set(state.geocodeQueue.map((point) => point.id));
  const additions = candidates.filter((point) => !existing.has(point.id));
  state.geocodeQueue = priority ? [...additions, ...state.geocodeQueue] : [...state.geocodeQueue, ...additions];
  state.geocodeStats.total = Math.max(state.geocodeStats.total, state.geocodeQueue.length + state.geocodeStats.done);
  runGeocodeQueue();
}

async function runGeocodeQueue() {
  if (state.geocodeRunning || !state.map || !window.AMap) return;
  state.geocodeRunning = true;
  const geocoder = await ensureGeocoder();
  const placeSearch = await ensurePlaceSearch();
  showToast('正在根据代办点名称匹配大致位置');
  let redrawCounter = 0;
  while (state.geocodeQueue.length) {
    const point = state.geocodeQueue.shift();
    if (!point || !isEstimatedCoordinate(point) || state.geocodeCache[point.id]) continue;
    const query = buildGeocodeQuery(point);
    const result = await locatePointByName(placeSearch, geocoder, point, query);
    state.geocodeStats.done += 1;
    if (result) {
      point.lng = result.lng;
      point.lat = result.lat;
      point.coordinateSource = result.source || 'amap-name-geocode';
      point.coordinateAccuracy = result.level || '名称匹配';
      point.geocodedAddress = result.formattedAddress || query;
      point.geocodeQuery = result.query || query;
      state.geocodeCache[point.id] = {
        lng: point.lng,
        lat: point.lat,
        coordinateSource: point.coordinateSource,
        coordinateAccuracy: point.coordinateAccuracy,
        geocodedAddress: point.geocodedAddress,
        geocodeQuery: point.geocodeQuery
      };
      state.geocodeStats.success += 1;
      redrawCounter += 1;
    } else {
      state.geocodeStats.failed += 1;
    }
    if (redrawCounter >= 20) {
      saveGeocodeCache();
      renderMap();
      redrawCounter = 0;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 160));
  }
  saveGeocodeCache();
  state.geocodeRunning = false;
  renderMap();
  showToast(`名称匹配完成：成功 ${state.geocodeStats.success} 个`);
}

async function locatePointByName(placeSearch, geocoder, point, fallbackQuery) {
  const keywords = buildPoiKeywords(point);
  for (const keyword of keywords) {
    const poiResult = await searchPoiByName(placeSearch, keyword, point);
    if (poiResult) return poiResult;
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
  const geocodeResult = await geocodeByName(geocoder, fallbackQuery);
  if (geocodeResult) {
    return { ...geocodeResult, source: 'amap-name-geocode', query: fallbackQuery };
  }
  const townCenter = await findTownCenter(placeSearch, geocoder, point);
  if (townCenter) {
    const estimated = estimateAroundCenter(point, [townCenter.lng, townCenter.lat], townCenter.level, townCenter.query);
    return {
      lng: estimated.lng,
      lat: estimated.lat,
      formattedAddress: townCenter.formattedAddress || estimated.geocodedAddress,
      level: estimated.coordinateAccuracy,
      source: 'town-estimate',
      query: estimated.geocodeQuery
    };
  }
  if (Number.isFinite(point.lng) && Number.isFinite(point.lat)) {
    const estimated = estimateAroundCenter(point, [point.lng, point.lat], '原始坐标散点估算', fallbackQuery);
    return {
      lng: estimated.lng,
      lat: estimated.lat,
      formattedAddress: estimated.geocodedAddress,
      level: estimated.coordinateAccuracy,
      source: 'town-estimate',
      query: estimated.geocodeQuery
    };
  }
  return null;
}

async function findTownCenter(placeSearch, geocoder, point) {
  const key = `${point.district}-${point.town}`;
  const staticCenter = townCenters[point.district]?.[point.town];
  if (staticCenter) {
    return {
      lng: staticCenter[0],
      lat: staticCenter[1],
      formattedAddress: `${point.district}${point.town}`,
      level: '镇街名称估算',
      query: key
    };
  }
  if (state.townCenterCache[key]) return state.townCenterCache[key];

  const queries = uniqueCompact([
    `宁波市${point.district}${point.town}`,
    `宁波市${point.town}`,
    `${point.district}${point.town}便民服务中心`,
    `${point.district}${point.town}人民政府`,
    `${point.district}${point.town}办事处`
  ]);
  for (const query of queries) {
    const poiResult = await searchTownPoi(placeSearch, query, point);
    if (poiResult) {
      state.townCenterCache[key] = poiResult;
      return poiResult;
    }
    const geocodeResult = await geocodeByName(geocoder, query);
    if (geocodeResult) {
      const result = {
        ...geocodeResult,
        formattedAddress: geocodeResult.formattedAddress || query,
        level: `镇街自动定位：${query}`,
        query
      };
      state.townCenterCache[key] = result;
      return result;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
  return null;
}

function searchTownPoi(placeSearch, keyword, point) {
  return new Promise((resolve) => {
    placeSearch.search(keyword, (status, result) => {
      const pois = result?.poiList?.pois || [];
      if (status !== 'complete' || !pois.length) {
        resolve(null);
        return;
      }
      const best = pois.find((poi) => poi?.location && [poi.name, poi.address, poi.district, poi.adname].join('').includes(point.town));
      if (!best?.location) {
        resolve(null);
        return;
      }
      resolve({
        lng: best.location.lng,
        lat: best.location.lat,
        formattedAddress: best.address || best.name || keyword,
        level: `镇街自动定位：${best.name || keyword}`,
        query: keyword
      });
    });
  });
}

function scorePoi(poi, point, keyword) {
  const haystack = [poi.name, poi.address, poi.district, poi.adname, poi.cityname, poi.pname].join('');
  const village = normalizePlaceName(point.village || point.name);
  const name = normalizePlaceName(point.name);
  let score = 0;
  if (village && haystack.includes(village)) score += 8;
  if (name && haystack.includes(name)) score += 4;
  if (point.town && haystack.includes(point.town)) score += 3;
  if (point.district && haystack.includes(point.district)) score += 2;
  if (/村委会|村民委员会|社区|居委会|便民|服务中心|自然资源/.test(haystack)) score += 2;
  if (keyword && poi.name && keyword.includes(poi.name)) score += 1;
  return score;
}

function searchPoiByName(placeSearch, keyword, point) {
  return new Promise((resolve) => {
    placeSearch.search(keyword, (status, result) => {
      const pois = result?.poiList?.pois || [];
      if (status !== 'complete' || !pois.length) {
        resolve(null);
        return;
      }
      const ranked = pois
        .filter((poi) => poi?.location)
        .map((poi) => ({ poi, score: scorePoi(poi, point, keyword) }))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0];
      if (!best || best.score < 2) {
        resolve(null);
        return;
      }
      resolve({
        lng: best.poi.location.lng,
        lat: best.poi.location.lat,
        formattedAddress: best.poi.address || best.poi.name || keyword,
        level: `POI匹配：${best.poi.name || keyword}`,
        source: 'amap-poi-search',
        query: keyword
      });
    });
  });
}

function geocodeByName(geocoder, query) {
  return new Promise((resolve) => {
    geocoder.getLocation(query, (status, result) => {
      if (status !== 'complete' || !result?.geocodes?.length) {
        resolve(null);
        return;
      }
      const item = result.geocodes[0];
      if (!item?.location) {
        resolve(null);
        return;
      }
      resolve({
        lng: item.location.lng,
        lat: item.location.lat,
        formattedAddress: item.formattedAddress || item.formatted_address || query,
        level: item.level
      });
    });
  });
}

function locateWithAMap() {
  if (!state.map || !window.AMap) {
    showToast('地图还在加载，请稍后再定位');
    return;
  }
  window.AMap.plugin('AMap.Geolocation', () => {
    const geolocation = new window.AMap.Geolocation({
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
      convert: true,
      showButton: false,
      showMarker: false,
      showCircle: true,
      panToLocation: true,
      zoomToAccuracy: true
    });
    state.map.addControl(geolocation);
    geolocation.getCurrentPosition((status, result) => {
      if (status !== 'complete' || !result?.position) {
        showToast(result?.message || '定位失败，请检查浏览器和系统定位权限');
        return;
      }
      const location = [result.position.lng, result.position.lat];
      state.userLocation = [result.position.lat, result.position.lng];
      state.map.setZoomAndCenter(16, location);
      state.userMarker?.setMap(null);
      state.userMarker = new window.AMap.Marker({
        position: location,
        content: '<div class="user-location-marker"></div>',
        offset: new window.AMap.Pixel(-8, -8),
        anchor: 'center',
        title: '我的位置'
      });
      state.userMarker.setMap(state.map);
      const accuracyText = result.accuracy ? `，精度约 ${Math.round(result.accuracy)} 米` : '';
      showToast(`已定位到当前位置${accuracyText}`);
    });
  });
}

function bindActions() {
  document.querySelectorAll('[data-action]').forEach((element) => {
    element.addEventListener('click', () => {
      const action = element.dataset.action;
      if (action === 'map') {
        state.admin = false;
        renderShell();
      }
      if (action === 'admin') {
        state.admin = true;
        renderShell();
      }
      if (action === 'select-point') {
        state.selected = state.points.find((point) => point.id === element.dataset.id);
        renderShell();
      }
      if (action === 'close-detail') {
        state.selected = null;
        renderShell();
      }
      if (action === 'clear-search') {
        state.search = '';
        applyFilters();
      }
      if (action === 'reset-filters') {
        state.search = '';
        state.district = '全部区域';
        state.type = '全部类型';
        state.status = '全部状态';
        applyFilters();
      }
      if (action === 'set-view') {
        state.view = element.dataset.view;
        renderShell();
      }
      if (action === 'focus-point') {
        const point = state.points.find((item) => item.id === element.dataset.id);
        state.selected = null;
        state.admin = false;
        renderShell();
        setTimeout(() => state.map?.setZoomAndCenter(15, [point.lng, point.lat]), 250);
      }
      if (action === 'copy-address') {
        const point = state.points.find((item) => item.id === element.dataset.id);
        navigator.clipboard?.writeText(point.address || '').then(() => showToast('地址已复制'));
      }
      if (action === 'navigate-point') {
        const point = state.points.find((item) => item.id === element.dataset.id);
        if (!point) return;
        const url = navigationUrl(point);
        const opened = window.open(url, '_blank', 'noopener,noreferrer');
        if (!opened) {
          navigator.clipboard?.writeText(url).then(() => showToast('导航链接已复制，请粘贴到浏览器打开'));
        }
      }
      if (action === 'locate') {
        locateWithAMap();
      }
      if (action === 'scan') showToast('二维码入口已预留，接入正式域名后可生成');
      if (action === 'download-data') downloadData();
    });
  });

  const searchInput = document.querySelector('#search-input');
  searchInput?.addEventListener('input', (event) => {
    state.search = event.target.value;
    const caret = event.target.selectionStart ?? state.search.length;
    applyFilters();
    const nextSearch = document.querySelector('#search-input');
    nextSearch?.focus();
    nextSearch?.setSelectionRange(caret, caret);
  });
  ['district-filter', 'type-filter', 'status-filter'].forEach((id) => {
    document.querySelector(`#${id}`)?.addEventListener('change', (event) => {
      const key = id.replace('-filter', '');
      state[key] = event.target.value;
      applyFilters();
    });
  });
  document.querySelector('#show-village-markers')?.addEventListener('change', (event) => {
    state.showVillageMarkers = event.target.checked;
    renderMap();
  });
  document.querySelector('#import-input')?.addEventListener('change', () => showToast('已接收 Excel 文件，正式版将写入后台数据库'));
}

function downloadData() {
  const blob = new Blob([JSON.stringify(state.points, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = '宁波不动产登记服务网点数据.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

loadData().catch(() => {
  app.innerHTML = '<div class="load-error">数据加载失败，请确认项目通过开发服务器启动。</div>';
});
