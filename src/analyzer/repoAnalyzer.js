/**
 * Repository Analyzer
 * 
 * Scans a repository recursively, detects file types,
 * parses imports/dependencies, and builds a graph model.
 */

const fs = require('fs');
const path = require('path');
const { detectLanguage, getLanguageParser } = require('./languageDetector');
const { parseImports } = require('./importParser');

// Default ignore patterns
const DEFAULT_IGNORE = [
  'node_modules', '.git', 'dist', 'build', '.vscode', '__pycache__',
  '.next', 'coverage', '.nyc_output', '.cache', 'vendor', '.idea',
  '.vs', 'bin', 'obj', 'target', '.gradle', '.mvn', 'venv', '.env',
  '.tox', 'eggs', '*.egg-info', '.sass-cache', 'bower_components',
];

const DEFAULT_MAX_FILE_SIZE = 100 * 1024; // 100KB

async function analyzeRepo(repoPath, options = {}) {
  const maxDepth = options.maxDepth || 10;
  const includeContent = options.includeContent !== false;

  // Load .vizarc config if exists
  let config = { ignore: [], maxFileSize: DEFAULT_MAX_FILE_SIZE };
  const configPath = path.join(repoPath, '.vizarc.json');
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      config.ignore = parsed.ignore || [];
      config.maxFileSize = parsed.maxFileSize || DEFAULT_MAX_FILE_SIZE;
    } catch (e) {
      // Ignore config parse errors
    }
  }

  const ignoreSet = new Set([...DEFAULT_IGNORE, ...config.ignore]);
  const files = [];
  const directories = [];
  const fileMap = new Map(); // path -> node

  // Recursively scan
  function scan(dir, depth, parentRelative) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return; // Permission denied, etc.
    }

    for (const entry of entries) {
      const name = entry.name;

      // Check ignore list
      if (ignoreSet.has(name)) continue;
      if (name.startsWith('.') && name !== '.env.example') continue;

      const fullPath = path.join(dir, name);
      const relativePath = path.relative(repoPath, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        directories.push({
          path: relativePath,
          name: name,
          depth: depth,
        });
        scan(fullPath, depth + 1, relativePath);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > config.maxFileSize) continue; // Skip large files

          const ext = path.extname(name).toLowerCase();
          const language = detectLanguage(name, ext);

          // Read content for analysis
          let content = '';
          let lines = 0;
          if (includeContent || language !== 'binary') {
            try {
              content = fs.readFileSync(fullPath, 'utf-8');
              lines = content.split('\n').length;
            } catch (e) {
              content = '';
            }
          }

          // Extract exports/functions info
          const metadata = extractMetadata(content, language, name);

          const fileNode = {
            id: generateId(relativePath),
            name: name,
            path: relativePath,
            fullPath: fullPath,
            extension: ext,
            language: language,
            size: stat.size,
            lines: lines,
            content: includeContent ? content : undefined,
            metadata: metadata,
            imports: [],
            exports: [],
          };

          // Parse imports
          if (content && language !== 'binary') {
            fileNode.imports = parseImports(content, language, relativePath);
          }

          files.push(fileNode);
          fileMap.set(relativePath, fileNode);
        } catch (e) {
          // Skip files we can't read
        }
      }
    }
  }

  scan(repoPath, 0, '');

  // Build edges (connections between files)
  const edges = buildEdges(files, fileMap, repoPath);

  // Build directory tree structure
  const tree = buildTree(files, directories);

  return {
    meta: {
      name: path.basename(repoPath),
      path: repoPath,
      analyzedAt: new Date().toISOString(),
      totalFiles: files.length,
      totalDirectories: directories.length,
      totalEdges: edges.length,
    },
    files,
    directories,
    edges,
    tree,
  };
}

/**
 * Extract metadata like functions, classes, exports from file content
 */
function extractMetadata(content, language, filename) {
  const metadata = {
    functions: [],
    classes: [],
    exports: [],
    description: '',
  };

  if (!content) return metadata;

  try {
    const lines = content.split('\n');

    switch (language) {
      case 'javascript':
      case 'typescript':
      case 'jsx':
      case 'tsx':
        // Functions
        const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
        let match;
        while ((match = funcRegex.exec(content)) !== null) {
          metadata.functions.push(match[1]);
        }

        // Arrow functions assigned to const/let/var
        const arrowRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/g;
        while ((match = arrowRegex.exec(content)) !== null) {
          metadata.functions.push(match[1]);
        }

        // Classes
        const classRegex = /(?:export\s+)?class\s+(\w+)/g;
        while ((match = classRegex.exec(content)) !== null) {
          metadata.classes.push(match[1]);
        }

        // Exports
        const exportRegex = /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/g;
        while ((match = exportRegex.exec(content)) !== null) {
          metadata.exports.push(match[1]);
        }
        break;

      case 'python':
        // Functions
        const pyFuncRegex = /^def\s+(\w+)/gm;
        while ((match = pyFuncRegex.exec(content)) !== null) {
          metadata.functions.push(match[1]);
        }

        // Classes
        const pyClassRegex = /^class\s+(\w+)/gm;
        while ((match = pyClassRegex.exec(content)) !== null) {
          metadata.classes.push(match[1]);
        }
        break;

      case 'java':
      case 'csharp':
      case 'kotlin':
        // Classes
        const javaClassRegex = /(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?class\s+(\w+)/g;
        while ((match = javaClassRegex.exec(content)) !== null) {
          metadata.classes.push(match[1]);
        }

        // Methods
        const methodRegex = /(?:public|private|protected)\s+(?:static\s+)?(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/g;
        while ((match = methodRegex.exec(content)) !== null) {
          metadata.functions.push(match[1]);
        }
        break;

      case 'go':
        const goFuncRegex = /^func\s+(?:\([^)]+\)\s+)?(\w+)/gm;
        while ((match = goFuncRegex.exec(content)) !== null) {
          metadata.functions.push(match[1]);
        }
        break;

      case 'rust':
        const rustFuncRegex = /(?:pub\s+)?fn\s+(\w+)/g;
        while ((match = rustFuncRegex.exec(content)) !== null) {
          metadata.functions.push(match[1]);
        }

        const rustStructRegex = /(?:pub\s+)?struct\s+(\w+)/g;
        while ((match = rustStructRegex.exec(content)) !== null) {
          metadata.classes.push(match[1]);
        }
        break;

      case 'ruby':
        const rubyMethodRegex = /^\s*def\s+(\w+)/gm;
        while ((match = rubyMethodRegex.exec(content)) !== null) {
          metadata.functions.push(match[1]);
        }

        const rubyClassRegex = /^\s*class\s+(\w+)/gm;
        while ((match = rubyClassRegex.exec(content)) !== null) {
          metadata.classes.push(match[1]);
        }
        break;

      case 'php':
        const phpFuncRegex = /(?:public|private|protected|static)?\s*function\s+(\w+)/g;
        while ((match = phpFuncRegex.exec(content)) !== null) {
          metadata.functions.push(match[1]);
        }

        const phpClassRegex = /class\s+(\w+)/g;
        while ((match = phpClassRegex.exec(content)) !== null) {
          metadata.classes.push(match[1]);
        }
        break;
    }

    // Extract first comment as description
    const firstCommentMatch = content.match(/^\/\*\*?\s*([\s\S]*?)\*\//);
    if (firstCommentMatch) {
      metadata.description = firstCommentMatch[1]
        .replace(/\s*\*\s*/g, ' ')
        .trim()
        .substring(0, 200);
    } else {
      const lineComment = content.match(/^(?:\/\/|#)\s*(.+)/);
      if (lineComment) {
        metadata.description = lineComment[1].trim().substring(0, 200);
      }
    }
  } catch (e) {
    // Ignore parsing errors
  }

  return metadata;
}

/**
 * Build edges between files based on import/require statements
 */
function buildEdges(files, fileMap, repoPath) {
  const edges = [];
  const edgeSet = new Set(); // Dedup

  for (const file of files) {
    if (!file.imports || file.imports.length === 0) continue;

    for (const imp of file.imports) {
      // Try to resolve the import to a file in the repo
      const resolved = resolveImport(imp.source, file.path, fileMap, repoPath);

      if (resolved) {
        const edgeKey = `${file.id}->${resolved.id}`;
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey);
          edges.push({
            id: edgeKey,
            source: file.id,
            target: resolved.id,
            sourcePath: file.path,
            targetPath: resolved.path,
            type: imp.type || 'import',
            label: imp.specifiers ? imp.specifiers.join(', ') : '',
          });
        }
      }
    }
  }

  return edges;
}

/**
 * Resolve an import path to a file in the repository
 */
function resolveImport(importSource, fromFile, fileMap, repoPath) {
  if (!importSource) return null;

  // Skip external packages (npm, pip, etc.)
  if (!importSource.startsWith('.') && !importSource.startsWith('/') && !importSource.startsWith('~')) {
    // Check if it could be an absolute import within the project
    // e.g., "src/utils/helper" or "components/Button"
    const possiblePaths = [
      importSource,
      `src/${importSource}`,
    ];

    const extensions = ['', '.js', '.ts', '.jsx', '.tsx', '.json', '.mjs', '.cjs', '/index.js', '/index.ts', '/index.jsx', '/index.tsx'];

    for (const basePath of possiblePaths) {
      for (const ext of extensions) {
        const candidate = `${basePath}${ext}`.replace(/\\/g, '/');
        if (fileMap.has(candidate)) {
          return fileMap.get(candidate);
        }
      }
    }
    return null;
  }

  // Resolve relative import
  const fromDir = path.dirname(fromFile);
  let resolved = path.posix.join(fromDir, importSource).replace(/\\/g, '/');

  // Clean up the path
  if (resolved.startsWith('./')) {
    resolved = resolved.substring(2);
  }

  // Try with various extensions
  const extensions = ['', '.js', '.ts', '.jsx', '.tsx', '.json', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.vue', '.svelte'];

  for (const ext of extensions) {
    const candidate = `${resolved}${ext}`;
    if (fileMap.has(candidate)) {
      return fileMap.get(candidate);
    }
  }

  // Try as directory with index file
  const indexFiles = ['index.js', 'index.ts', 'index.jsx', 'index.tsx', 'mod.rs', '__init__.py'];
  for (const indexFile of indexFiles) {
    const candidate = `${resolved}/${indexFile}`;
    if (fileMap.has(candidate)) {
      return fileMap.get(candidate);
    }
  }

  return null;
}

/**
 * Build a tree structure from files and directories
 */
function buildTree(files, directories) {
  const tree = { name: 'root', children: [], type: 'directory' };

  for (const file of files) {
    const parts = file.path.split('/');
    let current = tree;

    for (let i = 0; i < parts.length - 1; i++) {
      let child = current.children.find(c => c.name === parts[i] && c.type === 'directory');
      if (!child) {
        child = { name: parts[i], children: [], type: 'directory' };
        current.children.push(child);
      }
      current = child;
    }

    current.children.push({
      name: file.name,
      type: 'file',
      id: file.id,
      language: file.language,
      size: file.size,
      lines: file.lines,
    });
  }

  return tree;
}

/**
 * Generate a stable ID from a file path
 */
function generateId(filePath) {
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    const char = filePath.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return 'f_' + Math.abs(hash).toString(36) + '_' + filePath.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
}

module.exports = { analyzeRepo };
