/**
 * Viza Build Command
 * 
 * Scans a repository, analyzes files, detects dependencies,
 * and generates a .vz file for visualization.
 */

const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const ora = require('ora');
const { analyzeRepo } = require('../analyzer/repoAnalyzer');
const { generateVzFile } = require('../generator/vzGenerator');

async function buildProject(repoPath, options) {
  // Validate path
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Path does not exist: ${repoPath}`);
  }

  const stat = fs.statSync(repoPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${repoPath}`);
  }

  const repoName = path.basename(repoPath);
  console.log(chalk.white(`📁 Analyzing repository: ${chalk.yellow(repoName)}`));
  console.log(chalk.gray(`   Path: ${repoPath}\n`));

  // Step 1: Analyze the repository
  const spinner = ora('Scanning files...').start();

  let analysis;
  try {
    analysis = await analyzeRepo(repoPath, {
      maxDepth: parseInt(options.maxDepth) || 10,
      includeContent: options.content !== false,
    });
    spinner.succeed(`Found ${chalk.green(analysis.files.length)} files in ${chalk.green(analysis.directories.length)} directories`);
  } catch (err) {
    spinner.fail('Failed to scan repository');
    throw err;
  }

  // Step 2: Detect connections
  const connSpinner = ora('Detecting file connections & dependencies...').start();
  try {
    // connections are built inside analyzeRepo
    const edgeCount = analysis.edges.length;
    connSpinner.succeed(`Detected ${chalk.green(edgeCount)} connections between files`);
  } catch (err) {
    connSpinner.fail('Failed to detect connections');
    throw err;
  }

  // Step 3: Generate .vz file
  const outputName = options.output || `${repoName}.vz`;
  const outputPath = path.resolve(outputName);
  const genSpinner = ora(`Generating ${outputName}...`).start();

  try {
    await generateVzFile(analysis, outputPath);
    const fileSize = fs.statSync(outputPath).size;
    const sizeStr = fileSize > 1024 * 1024
      ? `${(fileSize / 1024 / 1024).toFixed(2)} MB`
      : `${(fileSize / 1024).toFixed(2)} KB`;
    genSpinner.succeed(`Generated ${chalk.green(outputName)} (${sizeStr})`);
  } catch (err) {
    genSpinner.fail('Failed to generate .vz file');
    throw err;
  }

  // Summary
  console.log(chalk.cyan(`\n✨ Build complete!`));
  console.log(chalk.white(`   📊 ${analysis.files.length} files analyzed`));
  console.log(chalk.white(`   🔗 ${analysis.edges.length} connections found`));
  console.log(chalk.white(`   📄 Output: ${chalk.yellow(outputPath)}`));
  console.log(chalk.gray(`\n   Run ${chalk.cyan(`viza view ${outputName}`)} to explore visually\n`));

  return outputPath;
}

module.exports = { buildProject };
