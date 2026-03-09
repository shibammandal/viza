/**
 * Viza App — Deep Edition
 * 
 * Full visual code editor with:
 * - Inline code editing with save
 * - Symbol-level navigation
 * - Wire mode for creating imports
 * - File/function creation from canvas
 * - Expand/collapse hierarchical nodes
 */

class VizaApp {
  constructor() {
    this.graph = null;
    this.data = null;
    this.currentNode = null;     // selected file or symbol node
    this.currentFileNode = null; // always the file-level node
    this.editingSymbol = null;   // specific symbol being edited
    this.dirty = false;

    this._init();
  }

  async _init() {
    this._showLoading(true);
    await this._loadData();
    this._initGraph();
    this._bindUI();
    this._showLoading(false);
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
    if (!canvas) return;
    this.graph = new VizaGraph(canvas);

    this.graph.onNodeSelect = (node) => this._onNodeSelect(node);
    this.graph.onNodeHover = (node) => this._onNodeHover(node);
    this.graph.onNodeContextMenu = (node, x, y) => this._showContextMenu(node, x, y);
    this.graph.onSymbolSelect = (sym) => this._onSymbolSelect(sym);
    this.graph.onWireConnect = (src, tgt) => this._onWireConnect(src, tgt);

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
      if (e.key === 'w' && !this._isInput(e)) this._setMode('wire');
      if (e.key === 'e' && !this._isInput(e)) this._toggle('edges');
      if (e.key === 'l' && !this._isInput(e)) this._toggle('labels');
      if (e.key === 'g' && !this._isInput(e)) this._toggle('groups');
      if (e.key === 'Tab' && !this._isInput(e)) { e.preventDefault(); this._toggleSidebar(); }
      // Ctrl+S to save
      if (e.key === 's' && (e.ctrlKey || e.metaKey) && this._isInput(e)) {
        e.preventDefault();
        this._saveCode();
      }
    });

    // Toolbar
    document.getElementById('btnZoomIn')?.addEventListener('click', () => this.graph?.zoomIn());
    document.getElementById('btnZoomOut')?.addEventListener('click', () => this.graph?.zoomOut());
    document.getElementById('btnFitAll')?.addEventListener('click', () => this.graph?.fitAll());
    document.getElementById('btnToggleEdges')?.addEventListener('click', () => this._toggle('edges'));
    document.getElementById('btnToggleLabels')?.addEventListener('click', () => this._toggle('labels'));
    document.getElementById('btnToggleGroups')?.addEventListener('click', () => this._toggle('groups'));
    document.getElementById('btnSelect')?.addEventListener('click', () => this._setMode('select'));
    document.getElementById('btnPan')?.addEventListener('click', () => this._setMode('pan'));
    document.getElementById('btnWire')?.addEventListener('click', () => this._setMode('wire'));

    // Panel close
    document.getElementById('closeDetail')?.addEventListener('click', () => this._closePanel());

    // Sidebar
    document.getElementById('sidebarToggle')?.addEventListener('click', () => this._toggleSidebar());
    document.getElementById('sidebarClose')?.addEventListener('click', () => this._closeSidebar());

    // Save button
    document.getElementById('btnSaveCode')?.addEventListener('click', () => this._saveCode());

    // Code editor tab key support
    document.getElementById('codeEditor')?.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.target;
        const s = ta.selectionStart, end = ta.selectionEnd;
        ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = s + 2;
        this._markDirty();
      }
    });

    // Mark dirty on input
    document.getElementById('codeEditor')?.addEventListener('input', () => this._markDirty());

    // Context menu
    document.getElementById('contextMenu')?.addEventListener('click', (e) => {
      const item = e.target.closest('.ctx-item');
      if (item) this._ctxAction(item.dataset.action);
    });

    // Hide context menu
    document.addEventListener('click', (e) => {
      const ctx = document.getElementById('contextMenu');
      if (!ctx?.contains(e.target)) ctx?.classList.add('closed');
    });

    // Connection clicks via delegation
    document.getElementById('detailConnections')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.conn-item');
      if (btn) this.graph?.focusNodeById(btn.dataset.id);
    });

    // Symbol list clicks via delegation
    document.getElementById('detailSymbols')?.addEventListener('click', (e) => {
      const row = e.target.closest('.sym-item-row');
      if (row) {
        const symId = row.dataset.id;
        this._editSymbol(symId);
      }
    });
  }

  _isInput(e) {
    return e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  }

  // ===== DATA REFRESH =====

  _updateStats() {
    const statFiles = document.getElementById('statFiles');
    const statEdges = document.getElementById('statEdges');
    const repoName = document.getElementById('repoName');
    if (statFiles && this.data) statFiles.textContent = `${this.data.nodes.length} files`;
    if (statEdges && this.data) statEdges.textContent = `${this.data.edges.length} connections`;
    if (repoName && this.data?.meta?.name) repoName.textContent = this.data.meta.name;
  }

  // ===== LOADING =====

  _showLoading(show) {
    const loading = document.getElementById('loading');
    if (loading) {
      if (show) {
        loading.style.display = 'flex';
        loading.classList.remove('hidden');
      } else {
        loading.classList.add('hidden');
        setTimeout(() => {
          if (loading.classList.contains('hidden')) loading.style.display = 'none';
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
    document.getElementById('btnWire')?.classList.toggle('active', mode === 'wire');
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
        <div class="tree-folder-name" style="padding:6px 12px;color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.5px">${folder}</div>
        ${nodes.map(n => `<button class="tree-file" data-id="${n.id}" style="display:flex;align-items:center;gap:6px;width:100%;padding:5px 12px 5px 20px;background:none;border:none;color:var(--text-dim);font:inherit;font-size:12px;cursor:pointer;text-align:left">
          <span style="width:6px;height:6px;border-radius:50%;background:${n.color};flex-shrink:0"></span>
          ${n.name}
          ${n.symbols?.length ? `<span style="margin-left:auto;font-size:9px;color:var(--text-muted)">${n.symbols.length}</span>` : ''}
        </button>`).join('')}
      </div>`;
    }

    tree.innerHTML = html;
    tree.querySelectorAll('.tree-file').forEach(btn => {
      btn.addEventListener('click', () => this.graph?.focusNodeById(btn.dataset.id));
    });
  }

  // ===== NODE SELECTION =====

  _onNodeSelect(node) {
    if (!node) {
      this._closePanel();
      return;
    }

    this.currentNode = node;
    this.editingSymbol = null;

    // Determine the file-level node
    if (node._nodeType === 'symbol') {
      this.currentFileNode = this.graph.nodeMap.get(node._parentId);
      this._showSymbolEditor(node);
    } else {
      this.currentFileNode = node;
      this._showFilePanel(node);
    }
  }

  _onSymbolSelect(sym) {
    // Double-click on symbol child in graph → open its code editor
    this._editSymbol(sym.id);
  }

  _showFilePanel(node) {
    const panel = document.getElementById('detailPanel');
    panel?.classList.remove('closed');

    // Header
    document.getElementById('detailName').textContent = node.name;
    document.getElementById('detailDot').style.background = node.color || '#6e9eff';

    // Info
    document.getElementById('detailInfo').innerHTML = this._renderInfo(node);

    // Connections
    document.getElementById('detailConnections').innerHTML = this._renderConnections(node);

    // Symbols (clickable list)
    document.getElementById('detailSymbols').innerHTML = this._renderSymbolList(node);

    // Show editor with full file
    this._loadFileIntoEditor(node);
  }

  _showSymbolEditor(sym) {
    const parent = this.currentFileNode;
    const panel = document.getElementById('detailPanel');
    panel?.classList.remove('closed');

    // Header
    document.getElementById('detailName').textContent = `${sym.name} — ${parent?.name || ''}`;
    const typeColors = { function: '#6ee7b7', method: '#93c5fd', class: '#fbbf24', variable: '#c4b5fd' };
    document.getElementById('detailDot').style.background = typeColors[sym.type] || '#6e9eff';

    // Info
    document.getElementById('detailInfo').innerHTML = `
      <div class="info-row"><span class="info-label">Type</span><span class="info-value">${sym.type}</span></div>
      ${sym.params?.length ? `<div class="info-row"><span class="info-label">Params</span><span class="info-value">${sym.params.join(', ')}</span></div>` : ''}
      <div class="info-row"><span class="info-label">Lines</span><span class="info-value">${sym.startLine}–${sym.endLine}</span></div>
      ${sym.exported ? `<div class="info-row"><span class="info-label">Exported</span><span class="info-value">yes</span></div>` : ''}
      ${sym.async ? `<div class="info-row"><span class="info-label">Async</span><span class="info-value">yes</span></div>` : ''}
    `;

    // Empty connections & symbols for symbol view
    document.getElementById('detailConnections').innerHTML = '';
    document.getElementById('detailSymbols').innerHTML = '';

    // Load symbol body into editor
    this.editingSymbol = sym;
    const editor = document.getElementById('codeEditor');
    const editorSection = document.getElementById('editorSection');
    const previewSection = document.getElementById('previewSection');

    editorSection.style.display = 'block';
    previewSection.style.display = 'none';
    document.getElementById('editorTitle').textContent = `${sym.type}: ${sym.name}`;

    editor.value = sym.body || '';
    document.getElementById('editorMeta').textContent = `Lines ${sym.startLine}–${sym.endLine} · ${sym.type}`;
    this.dirty = false;
    this._setEditorStatus('');
  }

  async _loadFileIntoEditor(node) {
    const editorSection = document.getElementById('editorSection');
    const previewSection = document.getElementById('previewSection');
    const editor = document.getElementById('codeEditor');

    try {
      const res = await fetch(`/api/file/${encodeURIComponent(node.id)}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();

      editorSection.style.display = 'block';
      previewSection.style.display = 'none';
      document.getElementById('editorTitle').textContent = 'Code';

      editor.value = data.content || '';
      document.getElementById('editorMeta').textContent = `${data.lines || '?'} lines · ${node.language || ''}`;
      this.dirty = false;
      this.editingSymbol = null;
      this._setEditorStatus('');
    } catch {
      editorSection.style.display = 'none';
      previewSection.style.display = 'block';
      document.getElementById('detailCode').textContent = 'Unable to load file content';
    }
  }

  _editSymbol(symId) {
    // Find the symbol node in graph's childMap
    const sym = this.graph.childMap.get(symId);
    if (sym) {
      this.currentNode = sym;
      this.currentFileNode = this.graph.nodeMap.get(sym._parentId);
      this.graph.selectNode(sym);
      this._showSymbolEditor(sym);
    }
  }

  // ===== SAVING =====

  async _saveCode() {
    const editor = document.getElementById('codeEditor');
    if (!editor) return;

    const code = editor.value;
    this._setEditorStatus('Saving…');

    try {
      if (this.editingSymbol) {
        // Save individual symbol
        const res = await fetch('/api/symbol/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodeId: this.currentFileNode.id,
            symbolId: this.editingSymbol.id,
            startLine: this.editingSymbol.startLine,
            endLine: this.editingSymbol.endLine,
            newBody: code,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        this.editingSymbol.body = code;
      } else if (this.currentFileNode) {
        // Save whole file
        const res = await fetch(`/api/file/${encodeURIComponent(this.currentFileNode.id)}/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: code }),
        });
        if (!res.ok) throw new Error(await res.text());
      }

      this.dirty = false;
      this._setEditorStatus('Saved', 'saved');
      setTimeout(() => this._setEditorStatus(''), 2000);
    } catch (err) {
      console.error('Save failed:', err);
      this._setEditorStatus('Error saving', 'error');
    }
  }

  _markDirty() {
    this.dirty = true;
    this._setEditorStatus('Modified');
  }

  _setEditorStatus(text, cls) {
    const el = document.getElementById('editorStatus');
    if (el) {
      el.textContent = text;
      el.className = 'editor-status' + (cls ? ` ${cls}` : '');
    }
  }

  // ===== WIRE MODE =====

  async _onWireConnect(src, tgt) {
    try {
      const res = await fetch('/api/edge/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: src.id, targetId: tgt.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      // Add edge to local graph
      this.graph.addEdge({
        id: data.edge?.id || `${src.id}->${tgt.id}`,
        source: src.id,
        target: tgt.id,
        type: 'import',
      });
      // Also add to data
      this.data.edges.push({ id: `${src.id}->${tgt.id}`, source: src.id, target: tgt.id, type: 'import' });
      this._updateStats();
    } catch (err) {
      console.error('Wire connect failed:', err);
    }
  }

  // ===== RENDER HELPERS =====

  _renderInfo(node) {
    return `
      <div class="info-row"><span class="info-label">Path</span><span class="info-value">${node.path}</span></div>
      ${node.language ? `<div class="info-row"><span class="info-label">Language</span><span class="info-value">${node.language}</span></div>` : ''}
      ${node.metadata?.lines ? `<div class="info-row"><span class="info-label">Lines</span><span class="info-value">${node.metadata.lines}</span></div>` : ''}
      ${node.metadata?.size ? `<div class="info-row"><span class="info-label">Size</span><span class="info-value">${this._formatSize(node.metadata.size)}</span></div>` : ''}
      ${node.symbols?.length ? `<div class="info-row"><span class="info-label">Symbols</span><span class="info-value">${node.symbols.length}</span></div>` : ''}
    `;
  }

  _renderSymbolList(node) {
    const symbols = node.symbols || [];
    if (!symbols.length) {
      const funcs = node.metadata?.functions || [];
      const classes = node.metadata?.classes || [];
      if (!funcs.length && !classes.length) return '<p class="empty" style="font-size:11px;color:var(--text-muted)">No symbols</p>';

      let html = '';
      for (const c of classes) html += this._symRow('cls', 'C', c, '');
      for (const f of funcs.slice(0, 15)) html += this._symRow('fn', 'ƒ', f, '');
      if (funcs.length > 15) html += `<div style="font-size:10px;color:var(--text-muted);padding:4px 8px">+${funcs.length - 15} more</div>`;
      return html;
    }

    let html = '';
    for (const sym of symbols) {
      const typeClass = sym.type === 'class' ? 'cls' : sym.type === 'method' ? 'method' : sym.type === 'variable' ? 'var' : 'fn';
      const icon = sym.type === 'class' ? 'C' : sym.type === 'method' ? 'm' : sym.type === 'variable' ? 'v' : 'ƒ';
      const params = sym.params?.length ? `(${sym.params.slice(0, 3).join(', ')}${sym.params.length > 3 ? '…' : ''})` : '';
      html += `<div class="sym-item-row" data-id="${sym.id}">
        <span class="sym-icon ${typeClass}">${icon}</span>
        <span class="sym-name">${sym.name}</span>
        <span class="sym-params">${params}</span>
        <span class="sym-line">L${sym.startLine}</span>
      </div>`;

      // Render class children (methods)
      if (sym.children?.length) {
        for (const child of sym.children) {
          html += `<div class="sym-item-row" data-id="${child.id}" style="padding-left:28px">
            <span class="sym-icon method">m</span>
            <span class="sym-name">${child.name}</span>
            <span class="sym-params">${child.params?.length ? `(${child.params.slice(0, 2).join(', ')})` : ''}</span>
            <span class="sym-line">L${child.startLine}</span>
          </div>`;
        }
      }
    }
    return html;
  }

  _symRow(type, icon, name, params) {
    return `<div class="sym-item-row">
      <span class="sym-icon ${type}">${icon}</span>
      <span class="sym-name">${name}</span>
      <span class="sym-params">${params}</span>
    </div>`;
  }

  _renderConnections(node) {
    const fileId = node._nodeType === 'symbol' ? node._parentId : node.id;
    const { incoming, outgoing } = this.graph.getConnectedNodes(fileId);

    if (!incoming.length && !outgoing.length) {
      return '<p class="empty" style="font-size:11px;color:var(--text-muted)">No connections</p>';
    }

    let html = '';
    if (incoming.length) {
      html += `<div class="conn-group"><div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">Imported by (${incoming.length})</div>
        ${incoming.map(c => `<button class="conn-item" data-id="${c.node.id}" style="border:none;font:inherit;width:100%"><span class="conn-arrow">←</span><span class="conn-name" style="color:var(--text-dim)">${c.node.name}</span></button>`).join('')}
      </div>`;
    }
    if (outgoing.length) {
      html += `<div class="conn-group" style="margin-top:8px"><div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">Imports (${outgoing.length})</div>
        ${outgoing.map(c => `<button class="conn-item" data-id="${c.node.id}" style="border:none;font:inherit;width:100%"><span class="conn-arrow">→</span><span class="conn-name" style="color:var(--text-dim)">${c.node.name}</span></button>`).join('')}
      </div>`;
    }
    return html;
  }

  _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  _onNodeHover(node) {
    // Minimal — could add tooltip back if desired
  }

  _closePanel() {
    document.getElementById('detailPanel')?.classList.add('closed');
    document.getElementById('editorSection').style.display = 'none';
    document.getElementById('previewSection').style.display = 'block';
    this.graph?.selectNode(null);
    this.editingSymbol = null;
    this.currentNode = null;
    this.currentFileNode = null;
  }

  // ===== SEARCH =====

  _handleSearch(query) {
    const results = this.graph?.search(query) || [];
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
    document.getElementById(btnId)?.classList.toggle('on', active);
  }

  // ===== CONTEXT MENU =====

  _showContextMenu(node, x, y) {
    this.currentNode = node;
    this.currentFileNode = node?._nodeType === 'symbol'
      ? this.graph.nodeMap.get(node._parentId)
      : node;
    const menu = document.getElementById('contextMenu');
    if (!menu) return;

    menu.classList.remove('closed');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';
  }

  _ctxAction(action) {
    document.getElementById('contextMenu')?.classList.add('closed');

    switch (action) {
      case 'focus':
        if (this.currentNode) this.graph?.focusNode(this.currentNode);
        break;
      case 'expand':
        if (this.currentFileNode) this.graph?.toggleExpand(this.currentFileNode.id);
        break;
      case 'connections':
        if (this.currentFileNode) this.graph?.isolateWithConnections(this.currentFileNode.id);
        break;
      case 'isolate':
        if (this.currentFileNode) this.graph?.isolateWithConnections(this.currentFileNode.id);
        break;
      case 'hide':
        if (this.currentFileNode) this.graph?.hideNode(this.currentFileNode.id);
        break;
      case 'showAll':
        this.graph?.showAllNodes();
        break;
      case 'addFunction':
        this._promptAddFunction();
        break;
      case 'newFile':
        this._promptNewFile();
        break;
    }
  }

  // ===== CREATE DIALOGS =====

  _promptNewFile() {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog">
        <h3>Create new file</h3>
        <div class="dialog-field">
          <label>File path (relative)</label>
          <input type="text" id="dlgFilePath" placeholder="src/utils/helper.js">
        </div>
        <div class="dialog-actions">
          <button class="btn-sm secondary" id="dlgCancel">Cancel</button>
          <button class="btn-sm" id="dlgCreate">Create</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#dlgCancel').onclick = () => overlay.remove();
    overlay.querySelector('#dlgCreate').onclick = async () => {
      const path = overlay.querySelector('#dlgFilePath').value.trim();
      if (!path) return;

      try {
        const res = await fetch('/api/file/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: path, content: '' }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        // Add to local graph
        const newNode = this.graph.addNode({
          id: data.node?.id || path.replace(/[/\\]/g, '_'),
          name: path.split('/').pop(),
          path: path,
          language: data.node?.language || '',
          color: data.node?.color || '#6e9eff',
          symbols: [],
          metadata: {},
          x: this.graph.width / 2 + (Math.random() - 0.5) * 200,
          y: this.graph.height / 2 + (Math.random() - 0.5) * 200,
        });

        this.data.nodes.push(newNode);
        this._updateStats();
        this.graph.focusNode(newNode);
      } catch (err) {
        console.error('Create file failed:', err);
      }
      overlay.remove();
    };

    overlay.querySelector('#dlgFilePath').focus();
    overlay.querySelector('#dlgFilePath').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') overlay.querySelector('#dlgCreate').click();
      if (e.key === 'Escape') overlay.remove();
    });
  }

  _promptAddFunction() {
    if (!this.currentFileNode) return;

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog">
        <h3>Add function to ${this.currentFileNode.name}</h3>
        <div class="dialog-field">
          <label>Function name</label>
          <input type="text" id="dlgFnName" placeholder="myFunction">
        </div>
        <div class="dialog-field">
          <label>Parameters (comma-separated)</label>
          <input type="text" id="dlgFnParams" placeholder="a, b, c">
        </div>
        <div class="dialog-actions">
          <button class="btn-sm secondary" id="dlgCancel">Cancel</button>
          <button class="btn-sm" id="dlgCreate">Add</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#dlgCancel').onclick = () => overlay.remove();
    overlay.querySelector('#dlgCreate').onclick = async () => {
      const name = overlay.querySelector('#dlgFnName').value.trim();
      const params = overlay.querySelector('#dlgFnParams').value.trim();
      if (!name) return;

      try {
        const res = await fetch(`/api/file/${encodeURIComponent(this.currentFileNode.id)}/addSymbol`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            type: 'function',
            params: params ? params.split(',').map(p => p.trim()) : [],
          }),
        });
        if (!res.ok) throw new Error(await res.text());

        // Rebuild to refresh symbols
        await this._rebuild();
      } catch (err) {
        console.error('Add function failed:', err);
      }
      overlay.remove();
    };

    overlay.querySelector('#dlgFnName').focus();
    overlay.querySelector('#dlgFnName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') overlay.querySelector('#dlgCreate').click();
      if (e.key === 'Escape') overlay.remove();
    });
  }

  async _rebuild() {
    this._showLoading(true);
    try {
      await fetch('/api/rebuild', { method: 'POST' });
      await this._loadData();
      if (this.data) this.graph.loadData(this.data);
    } catch (err) {
      console.error('Rebuild failed:', err);
    }
    this._showLoading(false);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.app = new VizaApp();
});
