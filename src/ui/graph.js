/**
 * Viza Graph Engine — Deep Edition
 * 
 * Hierarchical canvas rendering with:
 * - File nodes that expand to reveal functions/classes
 * - Child symbol nodes rendered inside expanded parents
 * - Smooth bezier edges with arrow heads
 * - Force-directed layout with expand/collapse
 * - Drag-and-drop with wiring mode
 */

class VizaGraph {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nodes = [];       // file-level nodes
    this.childNodes = [];  // all symbol child nodes (rendered when parent expanded)
    this.edges = [];
    this.groups = [];
    this.nodeMap = new Map();   // id -> file node
    this.childMap = new Map();  // id -> child node
    this.expandedNodes = new Set(); // file ids that are expanded

    // Camera
    this.camera = { x: 0, y: 0, zoom: 1 };

    // Interaction
    this.draggingNode = null;
    this.dragOffset = { x: 0, y: 0 };
    this.hoveredNode = null;
    this.selectedNode = null;  // can be file OR child
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    this.lastMouse = { x: 0, y: 0 };
    this.mode = 'select'; // 'select' | 'pan' | 'wire'
    this.wireStart = null; // for wire mode

    // Display
    this.showEdges = true;
    this.showLabels = true;
    this.showGroups = true;
    this.highlightedEdges = new Set();
    this.hiddenNodes = new Set();
    this.searchMatches = new Set();

    // Physics
    this.simulationRunning = false;
    this.simulationAlpha = 1;

    // Rendering
    this.animFrameId = null;
    this.needsRedraw = true;
    this.dpr = window.devicePixelRatio || 1;

    // Sizing
    this.collapsedH = 36;
    this.childH = 26;
    this.childGap = 2;
    this.headerH = 32;
    this.expandPadding = 8;

    // Callbacks
    this.onNodeSelect = null;
    this.onNodeHover = null;
    this.onNodeContextMenu = null;
    this.onSymbolSelect = null;
    this.onWireConnect = null;

    this._setupCanvas();
    this._bindEvents();
    this._startRenderLoop();
  }

  _setupCanvas() {
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = rect.width || window.innerWidth;
    this.height = rect.height || window.innerHeight;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.needsRedraw = true;
  }

  _bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
    this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    this.canvas.addEventListener('dblclick', (e) => this._onDblClick(e));
    this.canvas.addEventListener('contextmenu', (e) => this._onContextMenu(e));
    this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    this.canvas.addEventListener('touchend', (e) => this._onTouchEnd(e));
  }

  // ===== DATA =====

  loadData(data) {
    this.nodes = data.nodes.map((n, i) => ({
      ...n,
      _nodeType: 'file',
      x: n.position?.x || (this.width / 2 + (Math.random() - 0.5) * 400),
      y: n.position?.y || (this.height / 2 + (Math.random() - 0.5) * 400),
      vx: 0,
      vy: 0,
      w: this._calcWidth(n),
      h: this.collapsedH,
      visible: true,
    }));

    this.edges = data.edges.map(e => ({ ...e }));
    this.groups = data.groups || [];

    this.nodeMap.clear();
    this.childMap.clear();
    this.childNodes = [];
    this.nodes.forEach(n => {
      this.nodeMap.set(n.id, n);
      // Pre-create child nodes for each symbol
      if (n.symbols?.length) {
        n._children = n.symbols.map((sym, idx) => {
          const child = {
            ...sym,
            _nodeType: 'symbol',
            _parentId: n.id,
            x: 0, y: 0,
            w: 0, h: this.childH,
            visible: false,
            vx: 0, vy: 0,
          };
          this.childMap.set(sym.id, child);
          this.childNodes.push(child);
          return child;
        });
      } else {
        n._children = [];
      }
    });

    this._runForceLayout();
    setTimeout(() => this.fitAll(), 100);
    this.needsRedraw = true;
  }

  _calcWidth(node) {
    const baseW = 100;
    const nameW = Math.min(node.name.length * 7, 140);
    const symCount = node.symbols?.length || 0;
    // If symbols exist, need wider for child labels
    const childMaxLen = symCount > 0
      ? Math.max(...node.symbols.map(s => s.name.length)) * 6.5 + 40
      : 0;
    return Math.max(baseW, nameW + 30, childMaxLen);
  }

  /** Recalculate node height and child positions after expand/collapse */
  _recalcExpanded(node) {
    if (!this.expandedNodes.has(node.id)) {
      node.h = this.collapsedH;
      node._children.forEach(c => c.visible = false);
      return;
    }

    const children = node._children;
    if (!children.length) {
      node.h = this.collapsedH;
      return;
    }

    const totalChildH = children.length * (this.childH + this.childGap);
    node.h = this.headerH + totalChildH + this.expandPadding * 2;

    const startY = node.y - node.h / 2 + this.headerH + this.expandPadding;

    children.forEach((child, i) => {
      child.x = node.x;
      child.y = startY + i * (this.childH + this.childGap) + this.childH / 2;
      child.w = node.w - 16;
      child.visible = true;
    });
  }

  // ===== EXPAND / COLLAPSE =====

  toggleExpand(nodeId) {
    if (this.expandedNodes.has(nodeId)) {
      this.expandedNodes.delete(nodeId);
    } else {
      this.expandedNodes.add(nodeId);
    }
    const node = this.nodeMap.get(nodeId);
    if (node) this._recalcExpanded(node);
    this.needsRedraw = true;
  }

  expandNode(nodeId) {
    this.expandedNodes.add(nodeId);
    const node = this.nodeMap.get(nodeId);
    if (node) this._recalcExpanded(node);
    this.needsRedraw = true;
  }

  collapseNode(nodeId) {
    this.expandedNodes.delete(nodeId);
    const node = this.nodeMap.get(nodeId);
    if (node) this._recalcExpanded(node);
    this.needsRedraw = true;
  }

  // ===== FORCE LAYOUT =====

  _runForceLayout() {
    this.simulationRunning = true;
    this.simulationAlpha = 1;
    let iterations = 0;

    const tick = () => {
      if (!this.simulationRunning || this.simulationAlpha < 0.001) {
        this.simulationRunning = false;
        return;
      }
      this.simulationAlpha *= 0.97;
      iterations++;

      this._applyRepulsion();
      this._applyAttraction();
      if (this.showGroups) this._applyGrouping();
      this._applyCentering();

      for (const node of this.nodes) {
        if (node === this.draggingNode) continue;
        node.vx *= 0.8;
        node.vy *= 0.8;
        node.x += node.vx * this.simulationAlpha;
        node.y += node.vy * this.simulationAlpha;
        // Keep children pinned to parent
        if (this.expandedNodes.has(node.id)) this._recalcExpanded(node);
      }

      this.needsRedraw = true;
      if (iterations < 300) requestAnimationFrame(tick);
      else this.simulationRunning = false;
    };
    tick();
  }

  _applyRepulsion() {
    const strength = 800;
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i], b = this.nodes[j];
        if (!a.visible || !b.visible) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // Account for expanded node size
        const minDist = (a.h + b.h) / 2 + 40;
        if (dist < minDist) dist = minDist;
        const force = strength / (dist * dist);
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
  }

  _applyAttraction() {
    const strength = 0.035, idealLen = 200;
    for (const edge of this.edges) {
      const s = this.nodeMap.get(edge.source), t = this.nodeMap.get(edge.target);
      if (!s || !t || !s.visible || !t.visible) continue;
      let dx = t.x - s.x, dy = t.y - s.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - idealLen) * strength;
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      s.vx += fx; s.vy += fy;
      t.vx -= fx; t.vy -= fy;
    }
  }

  _applyGrouping() {
    const strength = 0.012;
    for (const group of this.groups) {
      let cx = 0, cy = 0, count = 0;
      for (const id of group.nodes) {
        const n = this.nodeMap.get(id);
        if (n?.visible) { cx += n.x; cy += n.y; count++; }
      }
      if (count < 2) continue;
      cx /= count; cy /= count;
      for (const id of group.nodes) {
        const n = this.nodeMap.get(id);
        if (!n?.visible) continue;
        n.vx += (cx - n.x) * strength;
        n.vy += (cy - n.y) * strength;
      }
    }
  }

  _applyCentering() {
    let cx = 0, cy = 0, count = 0;
    for (const n of this.nodes) {
      if (!n.visible) continue;
      cx += n.x; cy += n.y; count++;
    }
    if (!count) return;
    cx /= count; cy /= count;
    const tx = this.width / 2, ty = this.height / 2;
    for (const n of this.nodes) {
      if (!n.visible) continue;
      n.vx += (tx - cx) * 0.006;
      n.vy += (ty - cy) * 0.006;
    }
  }

  // ===== RENDER =====

  _startRenderLoop() {
    const render = () => {
      if (this.needsRedraw) { this._draw(); this.needsRedraw = false; }
      this.animFrameId = requestAnimationFrame(render);
    };
    render();
  }

  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.width / 2 + this.camera.x, -this.height / 2 + this.camera.y);

    if (this.showGroups) this._drawGroups(ctx);
    if (this.showEdges) this._drawEdges(ctx);
    this._drawNodes(ctx);

    // Wire preview line
    if (this.wireStart && this.mode === 'wire') {
      const w = this._screenToWorld(this.lastMouse.x, this.lastMouse.y);
      ctx.strokeStyle = 'rgba(110, 158, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(this.wireStart.x, this.wireStart.y);
      ctx.lineTo(w.x, w.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  _drawGroups(ctx) {
    for (const group of this.groups) {
      const gNodes = group.nodes.map(id => this.nodeMap.get(id)).filter(n => n?.visible);
      if (gNodes.length < 2) continue;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of gNodes) {
        minX = Math.min(minX, n.x - n.w / 2);
        minY = Math.min(minY, n.y - n.h / 2);
        maxX = Math.max(maxX, n.x + n.w / 2);
        maxY = Math.max(maxY, n.y + n.h / 2);
      }

      const pad = 24;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      this._roundRect(ctx, minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(group.name, minX - pad + 10, minY - pad + 16);
    }
  }

  _drawEdges(ctx) {
    for (const edge of this.edges) {
      const s = this.nodeMap.get(edge.source), t = this.nodeMap.get(edge.target);
      if (!s || !t || !s.visible || !t.visible) continue;

      const hl = this.highlightedEdges.has(edge.id);
      const rel = this.selectedNode && (edge.source === this.selectedNode.id || edge.target === this.selectedNode.id);

      if (hl || rel) {
        ctx.strokeStyle = 'rgba(110, 158, 255, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.globalAlpha = this.selectedNode ? 0.15 : 1;
      }

      const dx = t.x - s.x, dy = t.y - s.y;
      const cpx = (s.x + t.x) / 2 - dy * 0.12;
      const cpy = (s.y + t.y) / 2 + dx * 0.12;

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(cpx, cpy, t.x, t.y);
      ctx.stroke();

      // Arrowhead
      if (hl || rel || !this.selectedNode) {
        const angle = Math.atan2(t.y - cpy, t.x - cpx);
        const aLen = 7;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x - aLen * Math.cos(angle - 0.35), t.y - aLen * Math.sin(angle - 0.35));
        ctx.lineTo(t.x - aLen * Math.cos(angle + 0.35), t.y - aLen * Math.sin(angle + 0.35));
        ctx.closePath();
        ctx.fill();
      }

      ctx.globalAlpha = 1;
    }
  }

  _drawNodes(ctx) {
    // Draw non-selected first, then hovered, then selected on top
    const sorted = [...this.nodes].sort((a, b) => {
      if (a === this.selectedNode) return 1;
      if (b === this.selectedNode) return -1;
      if (a === this.hoveredNode) return 1;
      if (b === this.hoveredNode) return -1;
      return 0;
    });

    for (const node of sorted) {
      if (!node.visible || this.hiddenNodes.has(node.id)) continue;

      const sel = node === this.selectedNode;
      const hov = node === this.hoveredNode;
      const match = this.searchMatches.has(node.id);
      const dim = this.selectedNode && this.selectedNode._nodeType === 'file' && !sel && !this._isConnected(node.id);
      const expanded = this.expandedNodes.has(node.id);

      const x = node.x - node.w / 2;
      const y = node.y - node.h / 2;
      const w = node.w, h = node.h;
      const r = 8;

      ctx.globalAlpha = dim ? 0.2 : 1;

      // Shadow glow
      if ((sel || hov) && !dim) {
        ctx.shadowColor = sel ? 'rgba(110, 158, 255, 0.35)' : 'rgba(255, 255, 255, 0.1)';
        ctx.shadowBlur = sel ? 20 : 8;
      }

      // Main background
      ctx.fillStyle = this._nodeColor(sel, hov, match);
      ctx.beginPath();
      this._roundRect(ctx, x, y, w, h, r);
      ctx.fill();

      // Border
      ctx.strokeStyle = sel ? 'rgba(110, 158, 255, 0.5)' : (hov ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.06)');
      ctx.lineWidth = sel ? 1.5 : 1;
      ctx.stroke();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      // ── Header row ──
      const headerY = expanded ? y : y;
      const headerH = expanded ? this.headerH : h;

      // Language dot
      ctx.fillStyle = node.color || '#6e9eff';
      ctx.beginPath();
      ctx.arc(x + 14, y + headerH / 2, 4, 0, Math.PI * 2);
      ctx.fill();

      // File name
      if (this.showLabels && (this.camera.zoom > 0.3 || sel || hov)) {
        ctx.fillStyle = dim ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.9)';
        ctx.font = `${sel ? '500' : '400'} 11px Inter, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const maxChars = Math.floor((w - 50) / 6.5);
        const label = node.name.length > maxChars ? node.name.slice(0, maxChars - 1) + '…' : node.name;
        ctx.fillText(label, x + 24, y + headerH / 2);
      }

      // Expand/collapse chevron (if has symbols)
      if (node._children?.length > 0 && this.camera.zoom > 0.4) {
        const chevX = x + w - 16;
        const chevY = y + headerH / 2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(expanded ? '▾' : `▸ ${node._children.length}`, chevX - (expanded ? 0 : 4), chevY);
      }

      // ── Children (symbols) if expanded ──
      if (expanded && node._children?.length > 0) {
        // Separator line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 8, y + this.headerH);
        ctx.lineTo(x + w - 8, y + this.headerH);
        ctx.stroke();

        for (const child of node._children) {
          if (!child.visible) continue;
          this._drawChildNode(ctx, child, node, dim);
        }
      }

      ctx.globalAlpha = 1;
    }
  }

  _drawChildNode(ctx, child, parent, dim) {
    const cx = child.x - child.w / 2;
    const cy = child.y - child.h / 2;
    const cw = child.w;
    const ch = child.h;

    const sel = child === this.selectedNode;
    const hov = child === this.hoveredNode;

    // Child background
    ctx.fillStyle = sel
      ? 'rgba(110, 158, 255, 0.12)'
      : hov
        ? 'rgba(255, 255, 255, 0.06)'
        : 'rgba(255, 255, 255, 0.02)';
    ctx.beginPath();
    this._roundRect(ctx, cx, cy, cw, ch, 5);
    ctx.fill();

    if (sel) {
      ctx.strokeStyle = 'rgba(110, 158, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Type icon
    const iconX = cx + 10;
    const iconY = child.y;
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const typeColors = {
      function: '#6ee7b7',
      method: '#93c5fd',
      class: '#fbbf24',
      variable: '#c4b5fd',
    };

    ctx.fillStyle = typeColors[child.type] || '#6e9eff';
    const typeLabel = child.type === 'function' ? 'ƒ' : child.type === 'method' ? 'm' : child.type === 'class' ? 'C' : 'v';
    ctx.fillText(typeLabel, iconX, iconY);

    // Symbol name
    if (this.camera.zoom > 0.5) {
      ctx.fillStyle = dim ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.75)';
      ctx.font = '10px "JetBrains Mono", monospace';
      const maxChars = Math.floor((cw - 36) / 6);
      const label = child.name.length > maxChars ? child.name.slice(0, maxChars - 1) + '…' : child.name;
      ctx.fillText(label, cx + 22, child.y);
    }

    // Params hint
    if (this.camera.zoom > 0.8 && child.params?.length > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.font = '9px "JetBrains Mono", monospace';
      const paramStr = `(${child.params.slice(0, 3).join(', ')}${child.params.length > 3 ? '…' : ''})`;
      ctx.fillText(paramStr, cx + 22 + (child.name.length + 1) * 6, child.y);
    }
  }

  _nodeColor(sel, hov, match) {
    if (match) return 'rgba(250, 204, 21, 0.08)';
    if (sel) return 'rgba(110, 158, 255, 0.1)';
    if (hov) return 'rgba(255, 255, 255, 0.05)';
    return 'rgba(255, 255, 255, 0.025)';
  }

  _isConnected(nodeId) {
    return this.edges.some(e =>
      (e.source === this.selectedNode?.id && e.target === nodeId) ||
      (e.target === this.selectedNode?.id && e.source === nodeId)
    );
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
  }

  // ===== INTERACTION =====

  _screenToWorld(sx, sy) {
    return {
      x: (sx - this.width / 2) / this.camera.zoom + this.width / 2 - this.camera.x,
      y: (sy - this.height / 2) / this.camera.zoom + this.height / 2 - this.camera.y,
    };
  }

  /** Hit test: first check children of expanded nodes, then file nodes */
  _getNodeAt(wx, wy) {
    // Check child nodes first (they're on top)
    for (const child of this.childNodes) {
      if (!child.visible) continue;
      if (wx >= child.x - child.w / 2 && wx <= child.x + child.w / 2 &&
          wy >= child.y - child.h / 2 && wy <= child.y + child.h / 2) {
        return child;
      }
    }
    // Then file nodes
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (!n.visible || this.hiddenNodes.has(n.id)) continue;
      if (wx >= n.x - n.w / 2 && wx <= n.x + n.w / 2 && wy >= n.y - n.h / 2 && wy <= n.y + n.h / 2) {
        return n;
      }
    }
    return null;
  }

  /** Check if click is on the expand chevron area */
  _isChevronClick(node, wx) {
    if (node._nodeType !== 'file') return false;
    if (!node._children?.length) return false;
    return wx > node.x + node.w / 2 - 30;
  }

  _onMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const world = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    document.getElementById('contextMenu')?.classList.add('closed');

    if (e.button === 0) {
      const node = this._getNodeAt(world.x, world.y);

      if (this.mode === 'wire' && node && node._nodeType === 'file') {
        this.wireStart = node;
        this.canvas.classList.add('grabbing');
        return;
      }

      if (node && this.mode === 'select') {
        if (node._nodeType === 'file') {
          this.draggingNode = node;
          this.dragOffset = { x: world.x - node.x, y: world.y - node.y };
        }
        this.canvas.classList.add('grabbing');
      } else {
        this.isPanning = true;
        this.panStart = { x: e.clientX, y: e.clientY };
        this.canvas.classList.add('grabbing');
      }
    }
  }

  _onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const world = this._screenToWorld(sx, sy);
    this.lastMouse = { x: sx, y: sy };

    if (this.draggingNode) {
      this.draggingNode.x = world.x - this.dragOffset.x;
      this.draggingNode.y = world.y - this.dragOffset.y;
      this.draggingNode.vx = 0;
      this.draggingNode.vy = 0;
      if (this.expandedNodes.has(this.draggingNode.id)) {
        this._recalcExpanded(this.draggingNode);
      }
      this.needsRedraw = true;
    } else if (this.isPanning) {
      this.camera.x += (e.clientX - this.panStart.x) / this.camera.zoom;
      this.camera.y += (e.clientY - this.panStart.y) / this.camera.zoom;
      this.panStart = { x: e.clientX, y: e.clientY };
      this.needsRedraw = true;
    } else if (this.wireStart) {
      this.needsRedraw = true; // redraw wire preview
    } else {
      const node = this._getNodeAt(world.x, world.y);
      if (node !== this.hoveredNode) {
        this.hoveredNode = node;
        this.canvas.style.cursor = node
          ? (this.mode === 'wire' ? 'crosshair' : 'pointer')
          : (this.mode === 'pan' ? 'grab' : (this.mode === 'wire' ? 'crosshair' : 'default'));
        this.needsRedraw = true;
        this.onNodeHover?.(node);
      }
    }
  }

  _onMouseUp(e) {
    const rect = this.canvas.getBoundingClientRect();
    const world = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    if (this.wireStart) {
      const target = this._getNodeAt(world.x, world.y);
      if (target && target._nodeType === 'file' && target.id !== this.wireStart.id) {
        this.onWireConnect?.(this.wireStart, target);
      }
      this.wireStart = null;
      this.canvas.classList.remove('grabbing');
      this.needsRedraw = true;
      return;
    }

    if (this.draggingNode) {
      // Check if it was a click (not drag)
      const dx = world.x - this.dragOffset.x - this.draggingNode.x;
      const dy = world.y - this.dragOffset.y - this.draggingNode.y;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        // Check chevron click
        if (this._isChevronClick(this.draggingNode, world.x)) {
          this.toggleExpand(this.draggingNode.id);
        } else {
          this.selectNode(this.draggingNode);
        }
      }
      this.draggingNode = null;
    } else if (this.isPanning) {
      this.isPanning = false;
      const moved = Math.abs(e.clientX - this.panStart.x) + Math.abs(e.clientY - this.panStart.y);
      if (moved < 3) {
        // Click on empty space or on a child node
        const node = this._getNodeAt(world.x, world.y);
        if (node && node._nodeType === 'symbol') {
          this.selectNode(node);
        } else {
          this.selectNode(null);
        }
      }
    }
    this.canvas.classList.remove('grabbing');
    this.needsRedraw = true;
  }

  _onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    this.camera.zoom = Math.max(0.1, Math.min(5, this.camera.zoom * delta));
    this.needsRedraw = true;
  }

  _onDblClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const world = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const node = this._getNodeAt(world.x, world.y);
    if (node) {
      if (node._nodeType === 'file') {
        this.toggleExpand(node.id);
        this.selectNode(node);
      } else if (node._nodeType === 'symbol') {
        this.selectNode(node);
        this.onSymbolSelect?.(node);
      }
    }
  }

  _onContextMenu(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const world = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const node = this._getNodeAt(world.x, world.y);
    this.onNodeContextMenu?.(node, e.clientX, e.clientY);
  }

  _onTouchStart(e) {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this._onMouseDown({ clientX: t.clientX, clientY: t.clientY, button: 0, preventDefault: () => {} });
    }
  }

  _onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this._onMouseMove({ clientX: t.clientX, clientY: t.clientY });
    }
  }

  _onTouchEnd() {
    this._onMouseUp({ clientX: this.lastMouse.x, clientY: this.lastMouse.y });
  }

  // ===== PUBLIC API =====

  selectNode(node) {
    this.selectedNode = node;
    this.highlightedEdges.clear();
    const fileId = node?._nodeType === 'symbol' ? node._parentId : node?.id;
    if (fileId) {
      for (const e of this.edges) {
        if (e.source === fileId || e.target === fileId) this.highlightedEdges.add(e.id);
      }
    }
    if (node?._nodeType === 'symbol') {
      this.onSymbolSelect?.(node);
    }
    this.onNodeSelect?.(node);
    this.needsRedraw = true;
  }

  focusNode(node) {
    if (!node) return;
    const target = node._nodeType === 'symbol'
      ? this.nodeMap.get(node._parentId) || node
      : node;
    this.camera.x = this.width / 2 - target.x;
    this.camera.y = this.height / 2 - target.y;
    this.camera.zoom = 1.2;
    this.selectNode(node);
    this.needsRedraw = true;
  }

  focusNodeById(id) {
    const n = this.nodeMap.get(id) || this.childMap.get(id);
    if (n) this.focusNode(n);
  }

  fitAll() {
    if (!this.nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes) {
      if (!n.visible) continue;
      minX = Math.min(minX, n.x - n.w / 2);
      minY = Math.min(minY, n.y - n.h / 2);
      maxX = Math.max(maxX, n.x + n.w / 2);
      maxY = Math.max(maxY, n.y + n.h / 2);
    }
    const gw = maxX - minX + 80, gh = maxY - minY + 80;
    const scale = Math.min(this.width / gw, this.height / gh, 1.5);
    this.camera.zoom = scale * 0.9;
    this.camera.x = this.width / 2 - (minX + maxX) / 2;
    this.camera.y = this.height / 2 - (minY + maxY) / 2;
    this.needsRedraw = true;
  }

  zoomIn() { this.camera.zoom = Math.min(5, this.camera.zoom * 1.25); this.needsRedraw = true; }
  zoomOut() { this.camera.zoom = Math.max(0.1, this.camera.zoom / 1.25); this.needsRedraw = true; }

  setMode(m) {
    this.mode = m;
    this.wireStart = null;
    this.canvas.style.cursor = m === 'pan' ? 'grab' : m === 'wire' ? 'crosshair' : 'default';
  }

  toggleEdges() { this.showEdges = !this.showEdges; this.needsRedraw = true; return this.showEdges; }
  toggleLabels() { this.showLabels = !this.showLabels; this.needsRedraw = true; return this.showLabels; }
  toggleGroups() { this.showGroups = !this.showGroups; this.needsRedraw = true; return this.showGroups; }

  hideNode(id) {
    this.hiddenNodes.add(id);
    if (this.selectedNode?.id === id) this.selectNode(null);
    this.needsRedraw = true;
  }

  showAllNodes() {
    this.hiddenNodes.clear();
    this.nodes.forEach(n => n.visible = true);
    this.needsRedraw = true;
  }

  isolateWithConnections(id) {
    const connected = new Set([id]);
    for (const e of this.edges) {
      if (e.source === id) connected.add(e.target);
      if (e.target === id) connected.add(e.source);
    }
    this.nodes.forEach(n => n.visible = connected.has(n.id));
    this.needsRedraw = true;
  }

  search(query) {
    this.searchMatches.clear();
    if (!query) { this.needsRedraw = true; return []; }

    const q = query.toLowerCase();
    const matches = [];
    for (const n of this.nodes) {
      let matched = false;
      if (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q) || n.language?.toLowerCase().includes(q)) {
        matched = true;
      }
      // Also search symbols
      if (n.symbols?.some(s => s.name.toLowerCase().includes(q))) {
        matched = true;
      }
      if (n.metadata?.functions?.some(f => f.toLowerCase().includes(q)) ||
          n.metadata?.classes?.some(c => c.toLowerCase().includes(q))) {
        matched = true;
      }
      if (matched) {
        this.searchMatches.add(n.id);
        matches.push(n);
      }
    }
    this.needsRedraw = true;
    return matches;
  }

  getConnectedNodes(id) {
    const incoming = [], outgoing = [];
    for (const e of this.edges) {
      if (e.source === id) { const t = this.nodeMap.get(e.target); if (t) outgoing.push({ node: t, edge: e }); }
      if (e.target === id) { const s = this.nodeMap.get(e.source); if (s) incoming.push({ node: s, edge: e }); }
    }
    return { incoming, outgoing };
  }

  addNode(node) {
    node._nodeType = 'file';
    node.vx = 0;
    node.vy = 0;
    node.w = this._calcWidth(node);
    node.h = this.collapsedH;
    node.visible = true;
    node._children = [];
    this.nodes.push(node);
    this.nodeMap.set(node.id, node);
    this.needsRedraw = true;
    return node;
  }

  addEdge(edge) {
    if (!this.edges.find(e => e.id === edge.id)) {
      this.edges.push(edge);
      this.needsRedraw = true;
    }
  }

  destroy() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
  }
}

window.VizaGraph = VizaGraph;
