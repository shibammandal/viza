/**
 * .vz File Generator
 * 
 * Generates the .vz file format from analyzed repository data.
 * The .vz format is a JSON file containing nodes, edges, and metadata
 * for the visual graph representation.
 */

const fs = require('fs');
const { getLanguageInfo } = require('../analyzer/languageDetector');

async function generateVzFile(analysis, outputPath) {
  const { meta, files, directories, edges, tree } = analysis;

  // Build nodes with layout positions
  const nodes = files.map((file, index) => {
    const langInfo = getLanguageInfo(file.language);
    const dirParts = file.path.split('/');
    const directory = dirParts.length > 1 ? dirParts.slice(0, -1).join('/') : '';

    return {
      id: file.id,
      name: file.name,
      path: file.path,
      extension: file.extension,
      language: file.language,
      color: langInfo.color,
      category: langInfo.category,
      directory: directory,
      size: file.size,
      lines: file.lines,
      content: file.content || '',
      metadata: {
        functions: file.metadata.functions || [],
        classes: file.metadata.classes || [],
        exports: file.metadata.exports || [],
        description: file.metadata.description || '',
      },
      symbols: (file.symbols || []).map((sym, si) => ({
        id: `${file.id}_s${si}`,
        type: sym.type,
        name: sym.name,
        params: sym.params || [],
        startLine: sym.startLine,
        endLine: sym.endLine,
        body: sym.body || '',
        exported: sym.exported || false,
        async: sym.async || false,
        className: sym.className || null,
        extends: sym.extends || null,
        doc: sym.doc || '',
        children: (sym.children || []).map((child, ci) => ({
          id: `${file.id}_s${si}_c${ci}`,
          type: child.type,
          name: child.name,
          params: child.params || [],
          startLine: child.startLine,
          endLine: child.endLine,
          body: child.body || '',
          className: child.className || sym.name,
        })),
      })),
      // Initial position (will be recalculated by layout engine in UI)
      position: calculateInitialPosition(file, index, files.length, directories),
    };
  });

  // Build the .vz file data
  const vzData = {
    version: '1.0',
    format: 'viza',
    meta: {
      name: meta.name,
      analyzedAt: meta.analyzedAt,
      totalFiles: meta.totalFiles,
      totalDirectories: meta.totalDirectories,
      totalEdges: meta.totalEdges,
      generatedBy: 'viza v1.0.0',
    },
    nodes: nodes,
    edges: edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourcePath: edge.sourcePath,
      targetPath: edge.targetPath,
      type: edge.type,
      label: edge.label,
    })),
    groups: buildGroups(files, directories),
    tree: tree,
    settings: {
      layout: 'force-directed',
      theme: 'dark',
      showLabels: true,
      showEdges: true,
      groupByDirectory: true,
    },
  };

  // Write to file
  const jsonStr = JSON.stringify(vzData, null, 2);
  fs.writeFileSync(outputPath, jsonStr, 'utf-8');

  return outputPath;
}

/**
 * Calculate initial position for a node based on its directory grouping
 */
function calculateInitialPosition(file, index, totalFiles, directories) {
  const dirParts = file.path.split('/');
  const directory = dirParts.length > 1 ? dirParts[0] : 'root';

  // Create a hash of the directory for consistent positioning
  let dirHash = 0;
  for (let i = 0; i < directory.length; i++) {
    dirHash = ((dirHash << 5) - dirHash) + directory.charCodeAt(i);
    dirHash = dirHash & dirHash;
  }

  // Position in a spiral-like pattern grouped by directory
  const angle = (Math.abs(dirHash) % 360) * (Math.PI / 180);
  const radius = 200 + (dirParts.length - 1) * 150;
  const spread = index * 0.1;

  return {
    x: Math.cos(angle + spread) * radius + 600,
    y: Math.sin(angle + spread) * radius + 400,
  };
}

/**
 * Build groups based on directory structure
 */
function buildGroups(files, directories) {
  const groupMap = new Map();

  for (const file of files) {
    const dirParts = file.path.split('/');
    const directory = dirParts.length > 1 ? dirParts.slice(0, -1).join('/') : 'root';

    if (!groupMap.has(directory)) {
      groupMap.set(directory, {
        id: `group_${directory.replace(/[^a-zA-Z0-9]/g, '_')}`,
        name: directory,
        color: getGroupColor(directory),
        nodes: [],
      });
    }

    groupMap.get(directory).nodes.push(file.id);
  }

  return Array.from(groupMap.values());
}

/**
 * Get a consistent color for a directory group
 */
function getGroupColor(directory) {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F0B27A', '#82E0AA', '#F1948A', '#85929E', '#73C6B6',
  ];

  let hash = 0;
  for (let i = 0; i < directory.length; i++) {
    hash = ((hash << 5) - hash) + directory.charCodeAt(i);
    hash = hash & hash;
  }

  return colors[Math.abs(hash) % colors.length];
}

module.exports = { generateVzFile };
