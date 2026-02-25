// ============================================
// 全局状态管理
// ============================================
let allMarkets = [];
let filteredMarkets = [];
let currentFilter = 'all';
let currentSort = 'volume-desc';
let searchQuery = '';

// ============================================
// 工具函数
// ============================================

/**
 * 格式化货币数字
 */
function formatCurrency(value) {
  const num = parseFloat(value);
  if (isNaN(num)) return '$0';
  
  if (num >= 1000000) {
    return `$${(num / 1000000).toFixed(2)}M`;
  } else if (num >= 1000) {
    return `$${(num / 1000).toFixed(1)}K`;
  }
  return `$${num.toFixed(2)}`;
}

/**
 * 格式化日期
 */
function formatDate(dateString) {
  if (!dateString) return '未设置';
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = date - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  const options = { year: 'numeric', month: 'short', day: 'numeric' };
  const formattedDate = date.toLocaleDateString('zh-CN', options);
  
  if (diffDays < 0) {
    return `${formattedDate} (已结束)`;
  } else if (diffDays === 0) {
    return `${formattedDate} (今天)`;
  } else if (diffDays === 1) {
    return `${formattedDate} (明天)`;
  } else if (diffDays <= 7) {
    return `${formattedDate} (${diffDays}天后)`;
  }
  return formattedDate;
}

/**
 * 判断市场是否即将结束 (7天内)
 */
function isEndingSoon(dateString) {
  if (!dateString) return false;
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = date - now;
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  return diffDays > 0 && diffDays <= 7;
}

/**
 * 创建市场卡片 HTML
 */
function createMarketCard(market) {
  const isActive = market.active && !market.closed;
  const endingSoon = isEndingSoon(market.endDate);
  
  // 确定状态徽章
  let statusBadge;
  if (!isActive) {
    statusBadge = `<span class="status-badge status-badge--closed" role="status" aria-label="市场状态: 已关闭">已关闭</span>`;
  } else if (endingSoon) {
    statusBadge = `<span class="status-badge status-badge--ending-soon" role="status" aria-label="市场状态: 即将结束">即将结束</span>`;
  } else {
    statusBadge = `<span class="status-badge status-badge--active" role="status" aria-label="市场状态: 活跃">活跃</span>`;
  }
  
  const marketSlug = market.slug || market.marketSlug || '';
  const marketUrl = marketSlug ? `https://polymarket.com/event/${marketSlug}` : '#';
  
  return `
    <article 
      class="market-card" 
      role="listitem"
      tabindex="0"
      data-market-id="${market.conditionId}"
      aria-labelledby="market-${market.conditionId}-title"
    >
      <div class="market-card__header">
        <h2 id="market-${market.conditionId}-title" class="market-card__title">
          ${escapeHtml(market.question)}
        </h2>
        ${statusBadge}
      </div>
      
      <div class="market-card__content">
        <div class="metrics-grid">
          <div class="metric-item">
            <span class="metric-label">交易量</span>
            <span 
              class="metric-value currency"
              aria-label="交易量 ${formatCurrency(market.volume)}"
            >
              ${formatCurrency(market.volume)}
            </span>
          </div>
          
          <div class="metric-item">
            <span class="metric-label">流动性</span>
            <span 
              class="metric-value currency"
              aria-label="流动性 ${formatCurrency(market.liquidity)}"
            >
              ${market.liquidity ? formatCurrency(market.liquidity) : 'N/A'}
            </span>
          </div>
        </div>
      </div>
      
      <div class="market-card__footer">
        <div class="market-card__date">
          <time datetime="${market.endDate}">
            ${formatDate(market.endDate)}
          </time>
        </div>
        <a 
          href="${marketUrl}" 
          class="market-card__link" 
          target="_blank" 
          rel="noopener noreferrer"
          aria-label="查看市场详情: ${escapeHtml(market.question)}"
          onclick="event.stopPropagation()"
        >
          查看详情 →
        </a>
      </div>
    </article>
  `;
}

/**
 * 转义 HTML 特殊字符
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * 显示加载状态
 */
function showLoading() {
  document.getElementById('loading-state').classList.remove('hidden');
  document.getElementById('markets-grid').classList.add('hidden');
  document.getElementById('error-state').classList.add('hidden');
  document.getElementById('empty-state').classList.add('hidden');
}

/**
 * 显示错误状态
 */
function showError() {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('markets-grid').classList.add('hidden');
  document.getElementById('error-state').classList.remove('hidden');
  document.getElementById('empty-state').classList.add('hidden');
}

/**
 * 显示空状态
 */
function showEmpty() {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('markets-grid').classList.add('hidden');
  document.getElementById('error-state').classList.add('hidden');
  document.getElementById('empty-state').classList.remove('hidden');
}

/**
 * 显示市场网格
 */
function showMarkets() {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('markets-grid').classList.remove('hidden');
  document.getElementById('error-state').classList.add('hidden');
  document.getElementById('empty-state').classList.add('hidden');
}

// ============================================
// 数据加载
// ============================================

/**
 * 加载市场数据
 */
async function loadMarkets() {
  showLoading();
  
  try {
    // 加载本地 JSON 文件
    const response = await fetch('../database/markets.json');
    if (!response.ok) {
      throw new Error('Failed to load markets data');
    }
    
    const data = await response.json();
    allMarkets = data;
    
    // 更新统计信息
    updateStats();
    
    // 应用筛选和排序
    applyFiltersAndSort();
    
    // 渲染市场卡片
    renderMarkets();
    
    // 更新最后更新时间
    updateLastUpdateTime();
    
  } catch (error) {
    console.error('Error loading markets:', error);
    showError();
  }
}

/**
 * 更新统计信息
 */
function updateStats() {
  const totalMarkets = allMarkets.length;
  const activeMarkets = allMarkets.filter(m => m.active && !m.closed).length;
  const totalVolume = allMarkets.reduce((sum, m) => sum + parseFloat(m.volume || 0), 0);
  
  document.getElementById('total-markets').textContent = totalMarkets;
  document.getElementById('active-markets').textContent = activeMarkets;
  document.getElementById('total-volume').textContent = formatCurrency(totalVolume);
}

/**
 * 更新最后更新时间
 */
function updateLastUpdateTime() {
  const now = new Date();
  const timeString = now.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  document.getElementById('last-update').textContent = timeString;
}

// ============================================
// 筛选和排序
// ============================================

/**
 * 应用筛选和排序
 */
function applyFiltersAndSort() {
  // 筛选
  filteredMarkets = allMarkets.filter(market => {
    // 状态筛选
    let statusMatch = true;
    if (currentFilter === 'active') {
      statusMatch = market.active && !market.closed;
    } else if (currentFilter === 'closed') {
      statusMatch = market.closed || !market.active;
    }
    
    // 搜索筛选
    let searchMatch = true;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      searchMatch = market.question.toLowerCase().includes(query);
    }
    
    return statusMatch && searchMatch;
  });
  
  // 排序
  filteredMarkets.sort((a, b) => {
    switch (currentSort) {
      case 'volume-desc':
        return parseFloat(b.volume || 0) - parseFloat(a.volume || 0);
      case 'volume-asc':
        return parseFloat(a.volume || 0) - parseFloat(b.volume || 0);
      case 'liquidity-desc':
        return parseFloat(b.liquidity || 0) - parseFloat(a.liquidity || 0);
      case 'liquidity-asc':
        return parseFloat(a.liquidity || 0) - parseFloat(b.liquidity || 0);
      case 'date-asc':
        return new Date(a.endDate || 0) - new Date(b.endDate || 0);
      case 'date-desc':
        return new Date(b.endDate || 0) - new Date(a.endDate || 0);
      default:
        return 0;
    }
  });
}

/**
 * 渲染市场卡片
 */
function renderMarkets() {
  const grid = document.getElementById('markets-grid');
  
  if (filteredMarkets.length === 0) {
    showEmpty();
    return;
  }
  
  const html = filteredMarkets.map(market => createMarketCard(market)).join('');
  grid.innerHTML = html;
  showMarkets();
  
  // 为卡片添加点击事件
  addCardEventListeners();
}

// ============================================
// 事件监听器
// ============================================

/**
 * 为卡片添加事件监听器
 */
function addCardEventListeners() {
  const cards = document.querySelectorAll('.market-card');
  
  cards.forEach((card, index) => {
    // 点击跳转
    card.addEventListener('click', (e) => {
      if (e.target.tagName !== 'A') {
        const link = card.querySelector('.market-card__link');
        if (link && link.href !== '#') {
          window.open(link.href, '_blank', 'noopener,noreferrer');
        }
      }
    });
    
    // 键盘导航
    card.addEventListener('keydown', (e) => {
      let targetCard;
      
      switch(e.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          targetCard = cards[index + 1];
          e.preventDefault();
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          targetCard = cards[index - 1];
          e.preventDefault();
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          const link = card.querySelector('.market-card__link');
          if (link && link.href !== '#') {
            window.open(link.href, '_blank', 'noopener,noreferrer');
          }
          break;
        case 'Home':
          targetCard = cards[0];
          e.preventDefault();
          break;
        case 'End':
          targetCard = cards[cards.length - 1];
          e.preventDefault();
          break;
        default:
          return;
      }
      
      if (targetCard) {
        targetCard.focus();
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });
}

/**
 * 设置筛选按钮
 */
function setupFilterButtons() {
  const filterButtons = document.querySelectorAll('.filter-button');
  
  filterButtons.forEach(button => {
    button.addEventListener('click', () => {
      const filter = button.dataset.filter;
      
      // 更新按钮状态
      filterButtons.forEach(btn => btn.setAttribute('aria-pressed', 'false'));
      button.setAttribute('aria-pressed', 'true');
      
      // 应用筛选
      currentFilter = filter;
      applyFiltersAndSort();
      renderMarkets();
    });
  });
}

/**
 * 设置搜索功能
 */
function setupSearch() {
  const searchInput = document.getElementById('search-input');
  let searchTimeout;
  
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchQuery = e.target.value.trim();
      applyFiltersAndSort();
      renderMarkets();
    }, 300); // 防抖 300ms
  });
}

/**
 * 设置排序功能
 */
function setupSort() {
  const sortSelect = document.getElementById('sort-select');
  
  sortSelect.addEventListener('change', (e) => {
    currentSort = e.target.value;
    applyFiltersAndSort();
    renderMarkets();
  });
}

// ============================================
// 初始化
// ============================================

/**
 * 页面加载完成后初始化
 */
document.addEventListener('DOMContentLoaded', () => {
  // 设置事件监听器
  setupFilterButtons();
  setupSearch();
  setupSort();
  
  // 加载数据
  loadMarkets();
  
  // 每 5 分钟自动刷新数据
  setInterval(() => {
    loadMarkets();
  }, 5 * 60 * 1000);
});

// ============================================
// 导出供测试使用（可选）
// ============================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatCurrency,
    formatDate,
    isEndingSoon,
    escapeHtml
  };
}
