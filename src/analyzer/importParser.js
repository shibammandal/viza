/**
 * Import Parser
 * 
 * Parses import/require/include statements from source code
 * to detect dependencies between files.
 */

function parseImports(content, language, filePath) {
  const imports = [];

  if (!content) return imports;

  try {
    switch (language) {
      case 'javascript':
      case 'typescript':
      case 'jsx':
      case 'tsx':
        parseJsImports(content, imports);
        break;

      case 'python':
        parsePythonImports(content, imports);
        break;

      case 'go':
        parseGoImports(content, imports);
        break;

      case 'rust':
        parseRustImports(content, imports);
        break;

      case 'java':
      case 'kotlin':
        parseJavaImports(content, imports);
        break;

      case 'csharp':
        parseCSharpImports(content, imports);
        break;

      case 'ruby':
        parseRubyImports(content, imports);
        break;

      case 'php':
        parsePhpImports(content, imports);
        break;

      case 'c':
      case 'cpp':
        parseCImports(content, imports);
        break;

      case 'css':
      case 'scss':
      case 'sass':
      case 'less':
        parseCssImports(content, imports);
        break;

      case 'vue':
      case 'svelte':
        // These use JS imports in script sections
        parseJsImports(content, imports);
        parseCssImports(content, imports);
        break;
    }
  } catch (e) {
    // Silently handle parse errors
  }

  return imports;
}

function parseJsImports(content, imports) {
  // ES6 imports: import X from 'path'
  const importRegex = /import\s+(?:(?:\{([^}]*)\}|(\*\s+as\s+\w+)|(\w+))(?:\s*,\s*(?:\{([^}]*)\}|(\*\s+as\s+\w+)|(\w+)))*\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const specifiers = [];
    // Collect named imports
    [match[1], match[4]].forEach(group => {
      if (group) {
        group.split(',').forEach(s => {
          const name = s.trim().split(/\s+as\s+/)[0].trim();
          if (name) specifiers.push(name);
        });
      }
    });
    // Default import
    if (match[3]) specifiers.push(match[3]);
    if (match[6]) specifiers.push(match[6]);

    imports.push({
      source: match[7],
      specifiers: specifiers,
      type: 'import',
    });
  }

  // Dynamic imports: import('path')
  const dynamicRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      type: 'dynamic-import',
    });
  }

  // CommonJS require: require('path')
  const requireRegex = /(?:const|let|var)\s+(?:(\w+)|\{([^}]*)\})\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    const specifiers = [];
    if (match[1]) specifiers.push(match[1]);
    if (match[2]) {
      match[2].split(',').forEach(s => {
        const name = s.trim().split(/\s*:\s*/)[0].trim();
        if (name) specifiers.push(name);
      });
    }
    imports.push({
      source: match[3],
      specifiers: specifiers,
      type: 'require',
    });
  }

  // Bare require (no assignment)
  const bareRequireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = bareRequireRegex.exec(content)) !== null) {
    // Check if already captured
    const source = match[1];
    if (!imports.find(i => i.source === source)) {
      imports.push({
        source: source,
        specifiers: [],
        type: 'require',
      });
    }
  }

  // Re-exports: export { X } from 'path'
  const reExportRegex = /export\s+(?:\{([^}]*)\}|\*)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    const specifiers = [];
    if (match[1]) {
      match[1].split(',').forEach(s => {
        const name = s.trim().split(/\s+as\s+/)[0].trim();
        if (name) specifiers.push(name);
      });
    }
    imports.push({
      source: match[2],
      specifiers: specifiers,
      type: 're-export',
    });
  }
}

function parsePythonImports(content, imports) {
  // from X import Y
  const fromImportRegex = /^from\s+(\S+)\s+import\s+(.+)/gm;
  let match;
  while ((match = fromImportRegex.exec(content)) !== null) {
    const source = match[1].replace(/\./g, '/');
    const specifiers = match[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    imports.push({
      source: source,
      specifiers: specifiers,
      type: 'from-import',
    });
  }

  // import X
  const importRegex = /^import\s+(\S+)(?:\s+as\s+\w+)?/gm;
  while ((match = importRegex.exec(content)) !== null) {
    if (match[1].startsWith('from')) continue;
    imports.push({
      source: match[1].replace(/\./g, '/'),
      specifiers: [],
      type: 'import',
    });
  }
}

function parseGoImports(content, imports) {
  // Single import
  const singleRegex = /^import\s+"([^"]+)"/gm;
  let match;
  while ((match = singleRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      type: 'import',
    });
  }

  // Multi-line import block
  const blockRegex = /import\s*\(([\s\S]*?)\)/g;
  while ((match = blockRegex.exec(content)) !== null) {
    const block = match[1];
    const lineRegex = /\s*(?:\w+\s+)?"([^"]+)"/g;
    let lineMatch;
    while ((lineMatch = lineRegex.exec(block)) !== null) {
      imports.push({
        source: lineMatch[1],
        specifiers: [],
        type: 'import',
      });
    }
  }
}

function parseRustImports(content, imports) {
  // use statements
  const useRegex = /^use\s+([\w:]+(?:::\{[^}]+\})?)/gm;
  let match;
  while ((match = useRegex.exec(content)) !== null) {
    imports.push({
      source: match[1].replace(/::/g, '/'),
      specifiers: [],
      type: 'use',
    });
  }

  // mod statements
  const modRegex = /^mod\s+(\w+)\s*;/gm;
  while ((match = modRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      type: 'mod',
    });
  }
}

function parseJavaImports(content, imports) {
  const importRegex = /^import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push({
      source: match[1].replace(/\./g, '/'),
      specifiers: [],
      type: 'import',
    });
  }
}

function parseCSharpImports(content, imports) {
  const usingRegex = /^using\s+(?:static\s+)?([\w.]+)\s*;/gm;
  let match;
  while ((match = usingRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      type: 'using',
    });
  }
}

function parseRubyImports(content, imports) {
  // require / require_relative
  const requireRegex = /^(?:require|require_relative|load)\s+['"]([^'"]+)['"]/gm;
  let match;
  while ((match = requireRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      type: 'require',
    });
  }
}

function parsePhpImports(content, imports) {
  // use statements
  const useRegex = /^use\s+([\w\\]+)(?:\s+as\s+\w+)?\s*;/gm;
  let match;
  while ((match = useRegex.exec(content)) !== null) {
    imports.push({
      source: match[1].replace(/\\/g, '/'),
      specifiers: [],
      type: 'use',
    });
  }

  // require/include
  const requireRegex = /(?:require|include|require_once|include_once)\s+['"]([^'"]+)['"]/g;
  while ((match = requireRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      type: 'require',
    });
  }
}

function parseCImports(content, imports) {
  // #include "file.h" (local includes)
  const includeRegex = /^\s*#include\s+"([^"]+)"/gm;
  let match;
  while ((match = includeRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      type: 'include',
    });
  }

  // #include <system.h> (system includes — less relevant but tracked)
  const sysIncludeRegex = /^\s*#include\s+<([^>]+)>/gm;
  while ((match = sysIncludeRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      type: 'system-include',
    });
  }
}

function parseCssImports(content, imports) {
  // @import url('path') or @import 'path'
  const importRegex = /@import\s+(?:url\s*\(\s*)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      type: 'import',
    });
  }
}

module.exports = { parseImports };
