/**
 * Viza App — Minimalist Edition
 * 
 * Clean application logic with:
 * - Simple, elegant interactions
 * - Refined tooltips and panels
 * - Smooth transitions
 */

class VizaApp {
  constructor() {
    this.graph = null;
    this.data = null;
    this.currentNode = null;

    this._init();
  }

  async _init() {
    console.log('VizaApp initializing...');
    this._showLoading(true);
    await this._loadData();
    console.log('Data loaded:', this.data ? `${this.data.nodes.length} nodes` : 'failed');
    this._initGraph();
    console.log('Graph initialized');
    this._bindUI();
    console.log('UI bound');
    this._showLoading(false);
    console.log('Loading hidden');
  }

  async _loadData() {
    try {
      const res = await fetch('/api/graph');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
      this._updateStats();
    } catch (err) {
      console.error('Failed to load:', err);
      this._showError('Unable to load graph data');
      this._showLoading(false);
    }
  }

  _initGraph() {
    const canvas = document.getElementById('graphCanvas');
    if (!canvas) {
      console.error('Canvas not found');
      return;
    }
    this.graph = new VizaGraph(canvas);

    this.graph.onNodeSelect = (node) => this._onNodeSelect(node);
    this.graph.onNodeHover = (node) => this._onNodeHover(node);
    this.graph.onNodeContextMenu = (node, x, y) => this._showContextMenu(node, x, y);

    if (this.data) this.graph.loadData(this.data);
  }

  _bindUI() {
    // Search
    const search = document.getElementById('searchInput');
    let debounce;
    search?.addEventListener('input', (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => this._handleSearch(e.target.value), 200);
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !this._isInput(e)) { e.preventDefault(); search?.focus(); }
      if (e.key === 'Escape') { search.value = ''; this._handleSearch(''); this._closePanel(); }
      if (e.key === 'f' && !this._isInput(e)) this.graph?.fitAll();
      if (e.key === 'v' && !this._isInput(e)) this._setMode('select');
      if (e.key === 'h' && !this._isInput(e)) this._setMode('pan');
      if (e.key === 'e' && !this._isInput(e)) this._toggle('edges');
      if (e.key === 'l' && !this._isInput(e)) this._toggle('labels');
      if (e.key === 'g' && !this._isInput(e)) this._toggle('groups');
      if (e.key === 'Tab' && !this._isInput(e)) { e.preventDefault(); this._toggleSidebar(); }
    });

    // Toolbar buttons (matching actual HTML IDs)
    document.getElementById('btnZoomIn')?.addEventListener('click', () => this.graph?.zoomIn());
    document.getElementById('btnZoomOut')?.addEventListener('click', () => this.graph?.zoomOut());
    document.getElementById('btnFitAll')?.addEventListener('click', () => this.graph?.fitAll());
    document.getElementById('btnToggleEdges')?.addEventListener('click', () => this._toggle('edges'));
    document.getElementById('btnToggleLabels')?.addEventListener('click', () => this._toggle('labels'));
    document.getElementById('btnToggleGroups')?.addEventListener('click', () => this._toggle('groups'));
    document.getElementById('btnSelect')?.addEventListener('click', () => this._setMode('select'));
    document.getElementById('btnPan')?.addEventListener('click', () => this._setMode('pan'));

    // Panel close
    document.getElementById('closeDetail')?.addEventListener('click', () => this._closePanel());

    // Sidebar
    document.getElementById('sidebarToggle')?.addEventListener('click', () => this._toggleSidebar());
    document.getElementById('sidebarClose')?.addEventListener('click', () => this._closeSidebar());

    // Context menu (using data-action attributes)
    document.getElementById('contextMenu')?.addEventListener('click', (e) => {
      const item = e.target.closest('.ctx-item');
      if (item) this._ctxAction(item.dataset.action);
    });
    document.getElementById('ctxShowAll')?.addEventListener('click', () => this._ctxAction('showAll'));

    // Hide context menu on click
    document.addEventListener('click', (e) => {
      const ctx = document.getElementById('contextMenu');
      if (!ctx?.contains(e.target)) ctx?.classList.add('closed');
    });
  }

  _isInput(e) {
    return e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  }

  // ===== UI UPDATES =====

  _updateStats() {
    const statFiles = document.getElementById('statFiles');
    const statEdges = document.getElementById('statEdges');
    const repoName = document.getElementById('repoName');
    if (statFiles && this.data) statFiles.textContent = `${this.data.nodes.length} files`;
    if (statEdges && this.data) statEdges.textContent = `${this.data.edges.length} connections`;
    if (repoName && this.data?.meta?.name) repoName.textContent = this.data.meta.name;
  }

  _showLoading(show) {
    const loading = document.getElementById('loading');
    if (loading) {
      if (show) {
        loading.style.display = 'flex';
        loading.classList.remove('hidden');
      } else {
        loading.classList.add('hidden');
        // After transition, hide completely
        setTimeout(() => {
          if (loading.classList.contains('hidden')) {
            loading.style.display = 'none';
          }
        }, 400);
      }
    }
  }

  _showError(msg) {
    const loading = document.getElementById('loading');
    const loadingText = loading?.querySelector('p');
    if (loadingText) loadingText.textContent = msg;
  }

  // ===== MODE =====

  _setMode(mode) {
    this.graph?.setMode(mode);
    document.getElementById('btnSelect')?.classList.toggle('active', mode === 'select');
    document.getElementById('btnPan')?.classList.toggle('active', mode === 'pan');
  }

  // ===== SIDEBAR =====

  _toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar?.classList.toggle('closed');
    if (!sidebar?.classList.contains('closed')) this._buildFileTree();
  }

  _closeSidebar() {
    document.getElementById('sidebar')?.classList.add('closed');
  }

  _buildFileTree() {
    const tree = document.getElementById('fileTree');
    if (!tree || !this.data) return;

    // Build simple list grouped by folder
    const byFolder = {};
    for (const node of this.data.nodes) {
      const parts = node.path.split('/');
      const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
      if (!byFolder[folder]) byFolder[folder] = [];
      byFolder[folder].push(node);
    }

    let html = '';
    for (const [folder, nodes] of Object.entries(byFolder).sort()) {
      html += `<div class="tree-folder">
        <div class="tree-folder-name">${folder}</div>
        ${nodes.map(n => `<button class="tree-file" data-id="${n.id}">
          <span class="tree-dot" style="background:${n.color}"></span>
          ${n.name}
        </button>`).join('')}
      </div>`;
    }

    tree.innerHTML = html;

    // Bind clicks
    tree.querySelectorAll('.tree-file').forEach(btn => {
      btn.addEventListener('click', () => this.graph?.focusNodeById(btn.dataset.id));
    });
  }

  // ===== NODE INTERACTIONS =====

  _onNodeSelect(node) {
    this.currentNode = node;
    const panel = document.getElementById('detailPanel');
    if (!node) {
      panel?.classList.add('closed');
      return;
    }

    panel?.classList.remove('closed');

    // Header
    const detailName = document.getElementById('detailName');
    const detailDot = document.getElementById('detailDot');
    if (detailName) detailName.textContent = node.name;
    if (detailDot) detailDot.style.background = node.color || '#6e9eff';

    // Info section
    const info = document.getElementById('detailInfo');
    if (info) info.innerHTML = this._renderInfo(node);

    // Connections
    const conn = document.getElementById('detailConnections');
    if (conn) conn.innerHTML = this._renderConnections(node);

    // Symbols
    const symbols = document.getElementById('detailSymbols');
    if (symbols) symbols.innerHTML = this._renderSymbols(node);
  }

  _renderInfo(node) {
    return `
      <div class="info-row"><span class="info-label">Path</span><span class="info-value">${node.path}</span></div>
      ${node.language ? `<div class="info-row"><span class="info-label">Language</span><span class="info-value">${node.language}</span></div>` : ''}
      ${node.metadata?.lines ? `<div class="info-row"><span class="info-label">Lines</span><span class="info-value">${node.metadata.lines}</span></div>` : ''}
      ${node.metadata?.size ? `<div class="info-row"><span class="info-label">Size</span><span class="info-value">${this._formatSize(node.metadata.size)}</span></div>` : ''}
    `;
  }

  _renderSymbols(node) {
    const funcs = node.metadata?.functions || [];
    const classes = node.metadata?.classes || [];

    if (!funcs.length && !classes.length) {
      return '<p class="empty">No symbols detected</p>';
    }

    let html = '';
    if (classes.length) {
      html += `<div class="sym-group"><span class="sym-label">Classes</span>${classes.map(c => `<span class="sym-item">${c}</span>`).join('')}</div>`;
    }
    if (funcs.length) {
      html += `<div class="sym-group"><span class="sym-label">Functions</span>${funcs.slice(0, 10).map(f => `<span class="sym-item">${f}</span>`).join('')}${funcs.length > 10 ? `<span class="sym-more">+${funcs.length - 10} more</span>` : ''}</div>`;
    }
    return html;
  }

  _renderConnections(node) {
    const { incoming, outgoing } = this.graph.getConnectedNodes(node.id);

    if (!incoming.length && !outgoing.length) {
      return '<p class="empty">No connections</p>';
    }

    let html = '';

    if (incoming.length) {
      html += `<div class="conn-group">
        <div class="conn-label">Imported by (${incoming.length})</div>
        ${incoming.map(c => this._renderConnNode(c.node, 'in')).join('')}
      </div>`;
    }

    if (outgoing.length) {
      html += `<div class="conn-group">
        <div class="conn-label">Imports (${outgoing.length})</div>
        ${outgoing.map(c => this._renderConnNode(c.node, 'out')).join('')}
      </div>`;
    }

    return html;
  }

  _renderConnNode(node, dir) {
    const arrow = dir === 'in' ? '←' : '→';
    return `<button class="conn-item" data-id="${node.id}">
      <span class="conn-arrow">${arrow}</span>
      <span class="conn-name">${node.name}</span>
    </button>`;
  }

  _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Setup connection button handlers
  _setupConnectionButtons() {
    document.querySelectorAll('.conn-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        this.graph?.focusNodeById(id);
      });
    });
  }

  _onNodeHover(node) {
    const tooltip = document.getElementById('tooltip');
    if (!tooltip) return;

    if (!node) {
      tooltip.classList.add('hidden');
      return;
    }

    tooltip.classList.remove('hidden');
    tooltip.innerHTML = `
      <div class="tooltip-title">${node.name}</div>
      <div class="tooltip-path">${node.path}</div>
      ${node.language ? `<div class="tooltip-lang">${node.language}</div>` : ''}
    `;

    // Position near cursor
    const { x, y } = this.graph.lastMouse;
    tooltip.style.left = (x + 16) + 'px';
    tooltip.style.top = (y + 16) + 'px';
  }

  _closePanel() {
    document.getElementById('detailPanel')?.classList.add('closed');
    this.graph?.selectNode(null);
  }

  // ===== SEARCH =====

  _handleSearch(query) {
    const results = this.graph?.search(query) || [];
    
    // Show results dropdown if needed
    const dropdown = document.getElementById('searchResults');
    if (!dropdown) return;

    if (!query || results.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }

    dropdown.classList.remove('hidden');
    dropdown.innerHTML = results.slice(0, 8).map(n => `
      <button class="search-result" data-id="${n.id}">
        <span class="search-name">${n.name}</span>
        <span class="search-path">${n.path}</span>
      </button>
    `).join('');

    // Bind result clicks
    dropdown.querySelectorAll('.search-result').forEach(btn => {
      btn.addEventListener('click', () => {
        this.graph?.focusNodeById(btn.dataset.id);
        dropdown.classList.add('hidden');
        document.getElementById('searchInput').value = '';
      });
    });
  }

  // ===== TOGGLES =====

  _toggle(type) {
    let active;
    switch (type) {
      case 'edges': active = this.graph?.toggleEdges(); break;
      case 'labels': active = this.graph?.toggleLabels(); break;
      case 'groups': active = this.graph?.toggleGroups(); break;
    }

    const btnId = 'btnToggle' + type.charAt(0).toUpperCase() + type.slice(1);
    const btn = document.getElementById(btnId);
    btn?.classList.toggle('on', active);
  }

  // ===== CONTEXT MENU =====

  _showContextMenu(node, x, y) {
    this.currentNode = node;
    const menu = document.getElementById('contextMenu');
    if (!menu) return;

    menu.classList.remove('closed');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    // Keep in viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';
  }

  _ctxAction(action) {
    const menu = document.getElementById('contextMenu');
    menu?.classList.add('closed');

    if (!this.currentNode && action !== 'showAll') return;

    switch (action) {
      case 'focus': this.graph?.focusNode(this.currentNode); break;
      case 'isolate': this.graph?.isolateWithConnections(this.currentNode.id); break;
      case 'hide': this.graph?.hideNode(this.currentNode.id); break;
      case 'showAll': this.graph?.showAllNodes(); break;
    }
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.app = new VizaApp();

  // Listen for connection button clicks via delegation
  document.getElementById('detailConnections')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.conn-item');
    if (btn) {
      const id = btn.dataset.id;
      window.app.graph?.focusNodeById(id);
    }
  });
});
