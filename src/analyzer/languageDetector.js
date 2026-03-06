/**
 * Language Detector
 * 
 * Detects the programming language of a file based on
 * its name and extension.
 */

const EXTENSION_MAP = {
  // JavaScript / TypeScript
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.tsx': 'tsx',

  // Python
  '.py': 'python',
  '.pyw': 'python',
  '.pyx': 'python',

  // Web
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.vue': 'vue',
  '.svelte': 'svelte',

  // Systems
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.cs': 'csharp',
  '.rs': 'rust',
  '.go': 'go',

  // JVM
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.clj': 'clojure',
  '.groovy': 'groovy',

  // Scripting
  '.rb': 'ruby',
  '.php': 'php',
  '.pl': 'perl',
  '.pm': 'perl',
  '.lua': 'lua',
  '.r': 'r',
  '.R': 'r',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
  '.ps1': 'powershell',
  '.bat': 'batch',
  '.cmd': 'batch',

  // Data & Config
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.csv': 'csv',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.proto': 'protobuf',

  // Markup & Docs
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.rst': 'restructuredtext',
  '.tex': 'latex',
  '.txt': 'text',

  // Config files
  '.env': 'env',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini',

  // Functional
  '.hs': 'haskell',
  '.elm': 'elm',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.ml': 'ocaml',
  '.fs': 'fsharp',
  '.fsx': 'fsharp',

  // Mobile
  '.swift': 'swift',
  '.m': 'objective-c',
  '.dart': 'dart',

  // Other
  '.sol': 'solidity',
  '.zig': 'zig',
  '.nim': 'nim',
  '.v': 'vlang',
  '.wasm': 'wasm',
};

const FILENAME_MAP = {
  'Dockerfile': 'dockerfile',
  'Makefile': 'makefile',
  'CMakeLists.txt': 'cmake',
  'Rakefile': 'ruby',
  'Gemfile': 'ruby',
  'Vagrantfile': 'ruby',
  'Jenkinsfile': 'groovy',
  'Procfile': 'text',
  '.gitignore': 'gitignore',
  '.dockerignore': 'dockerignore',
  '.editorconfig': 'editorconfig',
  '.eslintrc': 'json',
  '.prettierrc': 'json',
  'tsconfig.json': 'json',
  'package.json': 'json',
  'composer.json': 'json',
  'Cargo.toml': 'toml',
  'go.mod': 'go',
  'go.sum': 'go',
  'requirements.txt': 'pip',
  'setup.py': 'python',
  'pyproject.toml': 'toml',
};

// Language category for color coding
const LANGUAGE_CATEGORIES = {
  javascript: { color: '#f7df1e', category: 'scripting' },
  typescript: { color: '#3178c6', category: 'scripting' },
  jsx: { color: '#61dafb', category: 'scripting' },
  tsx: { color: '#3178c6', category: 'scripting' },
  python: { color: '#3776ab', category: 'scripting' },
  java: { color: '#ed8b00', category: 'compiled' },
  csharp: { color: '#239120', category: 'compiled' },
  go: { color: '#00add8', category: 'compiled' },
  rust: { color: '#dea584', category: 'compiled' },
  ruby: { color: '#cc342d', category: 'scripting' },
  php: { color: '#777bb4', category: 'scripting' },
  c: { color: '#555555', category: 'compiled' },
  cpp: { color: '#00599c', category: 'compiled' },
  html: { color: '#e34f26', category: 'markup' },
  css: { color: '#1572b6', category: 'style' },
  scss: { color: '#cf649a', category: 'style' },
  json: { color: '#292929', category: 'data' },
  yaml: { color: '#cb171e', category: 'data' },
  markdown: { color: '#083fa1', category: 'docs' },
  shell: { color: '#89e051', category: 'scripting' },
  sql: { color: '#e38c00', category: 'data' },
  vue: { color: '#4fc08d', category: 'framework' },
  svelte: { color: '#ff3e00', category: 'framework' },
  kotlin: { color: '#7f52ff', category: 'compiled' },
  swift: { color: '#f05138', category: 'compiled' },
  dart: { color: '#0175c2', category: 'compiled' },
};

function detectLanguage(filename, ext) {
  // Check exact filename first
  if (FILENAME_MAP[filename]) {
    return FILENAME_MAP[filename];
  }

  // Check extension
  if (EXTENSION_MAP[ext]) {
    return EXTENSION_MAP[ext];
  }

  // Check if it looks like a binary
  const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.zip', '.gz', '.tar', '.exe', '.dll', '.so', '.dylib', '.pdf'];
  if (binaryExtensions.includes(ext)) {
    return 'binary';
  }

  return 'unknown';
}

function getLanguageInfo(language) {
  return LANGUAGE_CATEGORIES[language] || { color: '#888888', category: 'other' };
}

module.exports = { detectLanguage, getLanguageInfo, LANGUAGE_CATEGORIES };
