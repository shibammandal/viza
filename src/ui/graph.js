/**
 * Viza Graph Engine — Minimalist Edition
 * 
 * Clean, elegant canvas rendering with:
 * - Rounded rectangle nodes with soft shadows
 * - Smooth bezier edges
 * - Refined force-directed layout
 * - Gentle animations
 */

class VizaGraph {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nodes = [];
    this.edges = [];
    this.groups = [];
    this.nodeMap = new Map();

    // Camera
    this.camera = { x: 0, y: 0, zoom: 1 };

    // Interaction
    this.draggingNode = null;
    this.dragOffset = { x: 0, y: 0 };
    this.hoveredNode = null;
    this.selectedNode = null;
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    this.lastMouse = { x: 0, y: 0 };
    this.mode = 'select';

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

    // Node sizing
    this.nodeWidth = 90;
    this.nodeHeight = 36;

    // Callbacks
    this.onNodeSelect = null;
    this.onNodeHover = null;
    this.onNodeContextMenu = null;

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

    // Touch
    this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    this.canvas.addEventListener('touchend', (e) => this._onTouchEnd(e));
  }

  // ===== DATA =====

  loadData(data) {
    this.nodes = data.nodes.map((n, i) => ({
      ...n,
      x: n.position?.x || (this.width / 2 + (Math.random() - 0.5) * 400),
      y: n.position?.y || (this.height / 2 + (Math.random() - 0.5) * 400),
      vx: 0,
      vy: 0,
      w: this._calcWidth(n),
      h: this.nodeHeight,
      visible: true,
    }));

    this.edges = data.edges.map(e => ({ ...e }));
    this.groups = data.groups || [];

    this.nodeMap.clear();
    this.nodes.forEach(n => this.nodeMap.set(n.id, n));

    this._runForceLayout();
    setTimeout(() => this.fitAll(), 100);
    this.needsRedraw = true;
  }

  _calcWidth(node) {
    const baseW = 80;
    const charW = Math.min(node.name.length * 6, 120);
    return Math.max(baseW, charW + 24);
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
      }

      this.needsRedraw = true;
      if (iterations < 300) requestAnimationFrame(tick);
      else this.simulationRunning = false;
    };

    tick();
  }

  _applyRepulsion() {
    const strength = 600;
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i], b = this.nodes[j];
        if (!a.visible || !b.visible) continue;

        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = strength / (dist * dist);
        const fx = (dx / dist) * force, fy = (dy / dist) * force;

        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
  }

  _applyAttraction() {
    const strength = 0.04, idealLen = 180;
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
    const strength = 0.015;
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
      n.vx += (tx - cx) * 0.008;
      n.vy += (ty - cy) * 0.008;
    }
  }

  // ===== RENDER =====

  _startRenderLoop() {
    const render = () => {
      if (this.needsRedraw) {
        this._draw();
        this.needsRedraw = false;
      }
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
      const x = minX - pad, y = minY - pad;
      const w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      this._roundRect(ctx, x, y, w, h, 12);
      ctx.fill();
      ctx.stroke();

      // Label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.font = '10px Inter, sans-serif';
      ctx.fillText(group.name, x + 10, y + 16);
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
        ctx.globalAlpha = this.selectedNode ? 0.2 : 1;
      }

      // Bezier curve
      const dx = t.x - s.x, dy = t.y - s.y;
      const cx = (s.x + t.x) / 2 - dy * 0.15;
      const cy = (s.y + t.y) / 2 + dx * 0.15;

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(cx, cy, t.x, t.y);
      ctx.stroke();

      ctx.globalAlpha = 1;
    }
  }

  _drawNodes(ctx) {
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
      const match = this.searchMatches.size > 0 && this.searchMatches.has(node.id);
      const dim = this.selectedNode && !sel && !this._isConnected(node.id);

      const x = node.x - node.w / 2;
      const y = node.y - node.h / 2;
      const w = node.w, h = node.h;
      const r = 8;

      ctx.globalAlpha = dim ? 0.2 : 1;

      // Glow for selected/hovered
      if ((sel || hov) && !dim) {
        ctx.shadowColor = sel ? 'rgba(110, 158, 255, 0.4)' : 'rgba(255, 255, 255, 0.15)';
        ctx.shadowBlur = sel ? 20 : 10;
      }

      // Background
      ctx.fillStyle = this._nodeColor(sel, hov, match);
      ctx.beginPath();
      this._roundRect(ctx, x, y, w, h, r);
      ctx.fill();

      // Border
      ctx.strokeStyle = sel ? 'rgba(110, 158, 255, 0.6)' : (hov ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.06)');
      ctx.lineWidth = sel ? 1.5 : 1;
      ctx.stroke();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      // Language dot
      const dotR = 4;
      const dotX = x + 12;
      const dotY = node.y;
      ctx.fillStyle = node.color || '#6e9eff';
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
      ctx.fill();

      // Label
      if (this.showLabels && (this.camera.zoom > 0.35 || sel || hov)) {
        ctx.fillStyle = dim ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.85)';
        ctx.font = `${sel ? '500' : '400'} 11px Inter, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const label = node.name.length > 14 ? node.name.slice(0, 13) + '…' : node.name;
        ctx.fillText(label, x + 22, node.y);
      }

      ctx.globalAlpha = 1;
    }
  }

  _nodeColor(sel, hov, match) {
    if (match) return 'rgba(250, 204, 21, 0.1)';
    if (sel) return 'rgba(110, 158, 255, 0.12)';
    if (hov) return 'rgba(255, 255, 255, 0.06)';
    return 'rgba(255, 255, 255, 0.03)';
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

  _getNodeAt(wx, wy) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (!n.visible || this.hiddenNodes.has(n.id)) continue;
      if (wx >= n.x - n.w / 2 && wx <= n.x + n.w / 2 && wy >= n.y - n.h / 2 && wy <= n.y + n.h / 2) {
        return n;
      }
    }
    return null;
  }

  _onMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const world = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    document.getElementById('contextMenu')?.classList.add('closed');

    if (e.button === 0) {
      const node = this._getNodeAt(world.x, world.y);
      if (node && this.mode === 'select') {
        this.draggingNode = node;
        this.dragOffset = { x: world.x - node.x, y: world.y - node.y };
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
      this.needsRedraw = true;
    } else if (this.isPanning) {
      this.camera.x += (e.clientX - this.panStart.x) / this.camera.zoom;
      this.camera.y += (e.clientY - this.panStart.y) / this.camera.zoom;
      this.panStart = { x: e.clientX, y: e.clientY };
      this.needsRedraw = true;
    } else {
      const node = this._getNodeAt(world.x, world.y);
      if (node !== this.hoveredNode) {
        this.hoveredNode = node;
        this.canvas.style.cursor = node ? 'pointer' : (this.mode === 'pan' ? 'grab' : 'default');
        this.needsRedraw = true;
        this.onNodeHover?.(node);
      }
    }
  }

  _onMouseUp(e) {
    if (this.draggingNode) {
      const rect = this.canvas.getBoundingClientRect();
      const world = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const dx = world.x - this.dragOffset.x - this.draggingNode.x;
      const dy = world.y - this.dragOffset.y - this.draggingNode.y;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) this.selectNode(this.draggingNode);
      this.draggingNode = null;
    } else if (this.isPanning) {
      this.isPanning = false;
      const moved = Math.abs(e.clientX - this.panStart.x) + Math.abs(e.clientY - this.panStart.y);
      if (moved < 3) this.selectNode(null);
    }
    this.canvas.classList.remove('grabbing');
    this.needsRedraw = true;
  }

  _onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    this.camera.zoom = Math.max(0.15, Math.min(4, this.camera.zoom * delta));
    this.needsRedraw = true;
  }

  _onDblClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const world = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const node = this._getNodeAt(world.x, world.y);
    if (node) this.focusNode(node);
  }

  _onContextMenu(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const world = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const node = this._getNodeAt(world.x, world.y);
    if (node) this.onNodeContextMenu?.(node, e.clientX, e.clientY);
  }

  _onTouchStart(e) {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this._onMouseDown({ clientX: t.clientX, clientY: t.clientY, button: 0 });
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
    if (node) {
      for (const e of this.edges) {
        if (e.source === node.id || e.target === node.id) this.highlightedEdges.add(e.id);
      }
    }
    this.onNodeSelect?.(node);
    this.needsRedraw = true;
  }

  focusNode(node) {
    if (!node) return;
    this.camera.x = this.width / 2 - node.x;
    this.camera.y = this.height / 2 - node.y;
    this.camera.zoom = 1.2;
    this.selectNode(node);
    this.needsRedraw = true;
  }

  focusNodeById(id) {
    const n = this.nodeMap.get(id);
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

  zoomIn() { this.camera.zoom = Math.min(4, this.camera.zoom * 1.25); this.needsRedraw = true; }
  zoomOut() { this.camera.zoom = Math.max(0.15, this.camera.zoom / 1.25); this.needsRedraw = true; }

  setMode(m) {
    this.mode = m;
    this.canvas.style.cursor = m === 'pan' ? 'grab' : 'default';
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
      if (
        n.name.toLowerCase().includes(q) ||
        n.path.toLowerCase().includes(q) ||
        n.language?.toLowerCase().includes(q) ||
        n.metadata?.functions?.some(f => f.toLowerCase().includes(q)) ||
        n.metadata?.classes?.some(c => c.toLowerCase().includes(q))
      ) {
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

  destroy() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
  }
}

window.VizaGraph = VizaGraph;
