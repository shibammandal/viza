#!/usr/bin/env node

/**
 * Viza CLI - Visualize any code repository
 * 
 * Commands:
 *   viza build [path]  - Analyze a repo and generate a .vz file
 *   viza view [file]   - Open the visual drag-and-drop UI
 */

const { Command } = require('commander');
const chalk = require('chalk');
const path = require('path');
const { buildProject } = require('./commands/build');
const { viewProject } = require('./commands/view');

const program = new Command();

console.log(chalk.cyan.bold(`
╔══════════════════════════════════════╗
║          🔮  V I Z A  🔮            ║
║    Visual Repository Explorer        ║
╚══════════════════════════════════════╝
`));

program
  .name('viza')
  .description('Visualize any code repository as an interactive drag-and-drop graph')
  .version('1.0.0');

program
  .command('build')
  .description('Analyze a repository and generate a .vz file')
  .argument('[path]', 'Path to the repository to analyze', '.')
  .option('-o, --output <file>', 'Output .vz file name')
  .option('-d, --max-depth <number>', 'Maximum directory depth to scan', '10')
  .option('--no-content', 'Skip file content analysis (faster)')
  .action(async (repoPath, options) => {
    try {
      const absolutePath = path.resolve(repoPath);
      await buildProject(absolutePath, options);
    } catch (err) {
      console.error(chalk.red(`\n❌ Build failed: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('view')
  .description('Open the visual drag-and-drop UI to explore a .vz file')
  .argument('[file]', 'Path to the .vz file to view')
  .option('-p, --port <number>', 'Port for the local server', '3000')
  .action(async (vzFile, options) => {
    try {
      await viewProject(vzFile, options);
    } catch (err) {
      console.error(chalk.red(`\n❌ View failed: ${err.message}`));
      process.exit(1);
    }
  });

program.parse();
