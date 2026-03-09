/**
 * Viza View Command
 * 
 * Starts a local server and opens the interactive
 * drag-and-drop visualization UI in the browser.
 */

const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const ora = require('ora');
const express = require('express');
const open = require('open');
const { glob } = require('glob');
const { analyzeRepo } = require('../analyzer/repoAnalyzer');
const { generateVzFile } = require('../generator/vzGenerator');

async function viewProject(vzFile, options) {
  // If no file specified, find the first .vz file in current directory
  if (!vzFile) {
    const vzFiles = await glob('*.vz', { cwd: process.cwd() });
    if (vzFiles.length === 0) {
      throw new Error(
        'No .vz file found in current directory.\n' +
        '   Run "viza build" first to generate one.'
      );
    }
    vzFile = vzFiles[0];
    console.log(chalk.gray(`   Auto-detected: ${vzFile}`));
  }

  const vzPath = path.resolve(vzFile);
  if (!fs.existsSync(vzPath)) {
    throw new Error(`File not found: ${vzPath}`);
  }

  // Read and parse the .vz file
  const spinner = ora('Loading .vz file...').start();
  let vzData;
  try {
    const raw = fs.readFileSync(vzPath, 'utf-8');
    vzData = JSON.parse(raw);
    spinner.succeed(`Loaded ${chalk.green(vzData.meta.name)} (${vzData.nodes.length} nodes, ${vzData.edges.length} edges)`);
  } catch (err) {
    spinner.fail('Failed to parse .vz file');
    throw err;
  }

  // Start Express server
  const port = parseInt(options.port) || 3000;
  const app = express();

  // Serve static UI files
  const uiPath = path.join(__dirname, '..', 'ui');
  app.use(express.static(uiPath));

  // API endpoint to get graph data
  app.get('/api/graph', (req, res) => {
    res.json(vzData);
  });

  // API endpoint to get file content
  app.get('/api/file/:nodeId', (req, res) => {
    const node = vzData.nodes.find(n => n.id === req.params.nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }
    res.json({
      id: node.id,
      path: node.path,
      content: node.content || '(content not available)',
      language: node.language,
      metadata: node.metadata,
      symbols: node.symbols || [],
    });
  });

  // Parse JSON body
  app.use(express.json({ limit: '2mb' }));

  // ─── EDITING ENDPOINTS ───

  /** Save an entire file's content back to disk */
  app.post('/api/file/:nodeId/save', (req, res) => {
    try {
      const node = vzData.nodes.find(n => n.id === req.params.nodeId);
      if (!node) return res.status(404).json({ error: 'Node not found' });

      const { content } = req.body;
      if (typeof content !== 'string') return res.status(400).json({ error: 'Missing content' });

      const fullPath = path.resolve(path.dirname(vzPath), node.path);
      fs.writeFileSync(fullPath, content, 'utf-8');

      // Update in-memory
      node.content = content;
      node.lines = content.split('\n').length;
      node.size = Buffer.byteLength(content, 'utf-8');

      res.json({ ok: true, path: node.path, lines: node.lines, size: node.size });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Save a single symbol (function/class) — replaces its line range in the file */
  app.post('/api/symbol/save', (req, res) => {
    try {
      const { nodeId, symbolId, newBody } = req.body;
      if (!nodeId || !symbolId || typeof newBody !== 'string') {
        return res.status(400).json({ error: 'Missing nodeId, symbolId or newBody' });
      }

      const node = vzData.nodes.find(n => n.id === nodeId);
      if (!node) return res.status(404).json({ error: 'Node not found' });

      const symbol = node.symbols?.find(s => s.id === symbolId);
      if (!symbol) return res.status(404).json({ error: 'Symbol not found' });

      // Replace lines in the file
      const fileLines = (node.content || '').split('\n');
      const before = fileLines.slice(0, symbol.startLine);
      const after = fileLines.slice(symbol.endLine + 1);
      const updated = [...before, ...newBody.split('\n'), ...after].join('\n');

      const fullPath = path.resolve(path.dirname(vzPath), node.path);
      fs.writeFileSync(fullPath, updated, 'utf-8');

      node.content = updated;
      node.lines = updated.split('\n').length;
      node.size = Buffer.byteLength(updated, 'utf-8');

      // Update symbol body
      const newBodyLines = newBody.split('\n');
      const lineDiff = newBodyLines.length - (symbol.endLine - symbol.startLine + 1);
      symbol.body = newBody;
      symbol.endLine = symbol.startLine + newBodyLines.length - 1;

      // Shift subsequent symbols
      for (const s of (node.symbols || [])) {
        if (s.id !== symbolId && s.startLine > symbol.startLine) {
          s.startLine += lineDiff;
          s.endLine += lineDiff;
        }
      }

      res.json({ ok: true, path: node.path, lines: node.lines });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Create a new file on disk and add it to the graph */
  app.post('/api/file/create', (req, res) => {
    try {
      const { filePath: relPath, content, language } = req.body;
      if (!relPath) return res.status(400).json({ error: 'Missing filePath' });

      const fullPath = path.resolve(path.dirname(vzPath), relPath);

      // Create directories if needed
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const fileContent = content || '';
      fs.writeFileSync(fullPath, fileContent, 'utf-8');

      // Generate node ID
      let hash = 0;
      for (let i = 0; i < relPath.length; i++) {
        hash = ((hash << 5) - hash) + relPath.charCodeAt(i);
        hash = hash & hash;
      }
      const newId = 'f_' + Math.abs(hash).toString(36) + '_' + relPath.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);

      const newNode = {
        id: newId,
        name: path.basename(relPath),
        path: relPath.replace(/\\/g, '/'),
        extension: path.extname(relPath),
        language: language || 'text',
        color: '#6e9eff',
        category: 'source',
        directory: path.dirname(relPath).replace(/\\/g, '/'),
        size: Buffer.byteLength(fileContent, 'utf-8'),
        lines: fileContent.split('\n').length,
        content: fileContent,
        metadata: { functions: [], classes: [], exports: [], description: '' },
        symbols: [],
        position: { x: 500 + Math.random() * 200, y: 400 + Math.random() * 200 },
      };

      vzData.nodes.push(newNode);

      res.json({ ok: true, node: newNode });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Add a new function/symbol to an existing file */
  app.post('/api/file/:nodeId/addSymbol', (req, res) => {
    try {
      const node = vzData.nodes.find(n => n.id === req.params.nodeId);
      if (!node) return res.status(404).json({ error: 'Node not found' });

      const { name, type, params, body } = req.body;
      if (!name || !body) return res.status(400).json({ error: 'Missing name or body' });

      // Append to end of file
      const fileContent = node.content || '';
      const updated = fileContent.trimEnd() + '\n\n' + body + '\n';

      const fullPath = path.resolve(path.dirname(vzPath), node.path);
      fs.writeFileSync(fullPath, updated, 'utf-8');

      const updatedLines = updated.split('\n');
      const bodyLines = body.split('\n');
      const startLine = updatedLines.length - bodyLines.length - 1;

      const symId = `${node.id}_s${(node.symbols || []).length}`;
      const newSymbol = {
        id: symId,
        type: type || 'function',
        name,
        params: params || [],
        startLine,
        endLine: startLine + bodyLines.length - 1,
        body,
        exported: false,
      };

      if (!node.symbols) node.symbols = [];
      node.symbols.push(newSymbol);
      node.content = updated;
      node.lines = updatedLines.length;
      node.size = Buffer.byteLength(updated, 'utf-8');

      res.json({ ok: true, symbol: newSymbol });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Add an edge (import connection) between two files */
  app.post('/api/edge/create', (req, res) => {
    try {
      const { sourceId, targetId, importStatement } = req.body;
      const source = vzData.nodes.find(n => n.id === sourceId);
      const target = vzData.nodes.find(n => n.id === targetId);
      if (!source || !target) return res.status(404).json({ error: 'Node not found' });

      // Add import statement to source file
      if (importStatement) {
        const updated = importStatement + '\n' + (source.content || '');
        const fullPath = path.resolve(path.dirname(vzPath), source.path);
        fs.writeFileSync(fullPath, updated, 'utf-8');
        source.content = updated;
        source.lines = updated.split('\n').length;
      }

      const edgeId = `${sourceId}->${targetId}`;
      if (!vzData.edges.find(e => e.id === edgeId)) {
        const newEdge = {
          id: edgeId,
          source: sourceId,
          target: targetId,
          sourcePath: source.path,
          targetPath: target.path,
          type: 'import',
          label: '',
        };
        vzData.edges.push(newEdge);
        res.json({ ok: true, edge: newEdge });
      } else {
        res.json({ ok: true, existing: true });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Rebuild the .vz file from disk (re-analyze) */
  app.post('/api/rebuild', async (req, res) => {
    try {
      const repoPath = path.dirname(vzPath);
      const analysis = await analyzeRepo(repoPath);
      await generateVzFile(analysis, vzPath);
      const raw = fs.readFileSync(vzPath, 'utf-8');
      const newData = JSON.parse(raw);
      // Update in-memory data
      vzData.nodes = newData.nodes;
      vzData.edges = newData.edges;
      vzData.groups = newData.groups;
      vzData.tree = newData.tree;
      vzData.meta = newData.meta;
      res.json({ ok: true, nodes: newData.nodes.length, edges: newData.edges.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Start server
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(chalk.cyan(`\n🌐 Viza Visual Explorer is running!`));
      console.log(chalk.white(`   Open: ${chalk.yellow(url)}`));
      console.log(chalk.gray(`   Press Ctrl+C to stop\n`));

      // Open browser
      open(url).catch(() => {
        console.log(chalk.gray('   (Could not auto-open browser)'));
      });
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(chalk.gray('\n   Shutting down...'));
      server.close(() => {
        resolve();
        process.exit(0);
      });
    });
  });
}

module.exports = { viewProject };
