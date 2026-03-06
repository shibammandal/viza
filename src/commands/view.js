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
    });
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
