/**
 * Symbol Extractor
 * 
 * Deep code analysis — extracts functions, classes, methods,
 * variables, and exports with exact line ranges and code bodies.
 * Supports JS/TS, Python, Go, Rust, Java/C#, Ruby, PHP, C/C++.
 */

function extractSymbols(content, language) {
  if (!content) return [];

  const lines = content.split('\n');

  switch (language) {
    case 'javascript':
    case 'typescript':
    case 'jsx':
    case 'tsx':
      return extractJsSymbols(content, lines);

    case 'python':
      return extractPythonSymbols(content, lines);

    case 'go':
      return extractGoSymbols(content, lines);

    case 'rust':
      return extractRustSymbols(content, lines);

    case 'java':
    case 'kotlin':
    case 'csharp':
      return extractJavaLikeSymbols(content, lines);

    case 'ruby':
      return extractRubySymbols(content, lines);

    case 'php':
      return extractPhpSymbols(content, lines);

    case 'c':
    case 'cpp':
      return extractCSymbols(content, lines);

    default:
      return [];
  }
}

// ─── Helpers ───

function lineAt(lines, idx) {
  return idx >= 0 && idx < lines.length ? lines[idx] : '';
}

/** Find the closing brace that matches the opening one at `startLine`. */
function findBraceEnd(lines, startLine) {
  let depth = 0;
  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) return i; }
    }
  }
  return lines.length - 1;
}

/** Extract the body text from lines[start..end] inclusive. */
function bodySlice(lines, start, end) {
  return lines.slice(start, end + 1).join('\n');
}

/** Collect leading comment block (JSDoc, # comments, etc.) */
function leadingComment(lines, beforeLine, commentPrefix) {
  const result = [];
  for (let i = beforeLine - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (
      trimmed.startsWith(commentPrefix) ||
      trimmed.startsWith('/**') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('*/') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*')
    ) {
      result.unshift(lines[i]);
    } else break;
  }
  return result.join('\n');
}

/** Extract parameter names from a parameter string like "(a, b, c = 5)" */
function extractParams(paramStr) {
  if (!paramStr) return [];
  return paramStr
    .split(',')
    .map(p => p.trim().split(/[\s=:]+/)[0].replace(/[^a-zA-Z0-9_$]/g, ''))
    .filter(Boolean);
}

// ─── JavaScript / TypeScript ───

function extractJsSymbols(content, lines) {
  const symbols = [];

  // 1. Named functions: function name(...) { ... }
  const funcRe = /^(\s*)(?:export\s+)?(?:export\s+default\s+)?(?:async\s+)?function\s*(\*?)\s*(\w+)\s*\(([^)]*)\)/gm;
  let m;
  while ((m = funcRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findBraceEnd(lines, startLine);
    const isExported = m[0].includes('export');
    symbols.push({
      type: 'function',
      name: m[3],
      params: extractParams(m[4]),
      startLine,
      endLine,
      body: bodySlice(lines, startLine, endLine),
      exported: isExported,
      async: m[0].includes('async'),
      generator: m[2] === '*',
      doc: leadingComment(lines, startLine, '//'),
    });
  }

  // 2. Arrow / assigned functions: const name = (...) => { ... }
  const arrowRe = /^(\s*)(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*\w+(?:<[^>]+>)?\s*)?=>/gm;
  while ((m = arrowRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    // Arrow can be one-liner or block
    const restOfStart = lines[startLine].substring(lines[startLine].indexOf('=>') + 2).trim();
    let endLine;
    if (restOfStart.startsWith('{') || lines[startLine].includes('{')) {
      endLine = findBraceEnd(lines, startLine);
    } else {
      // one-liner — scan for semicolon or next line
      endLine = startLine;
      for (let i = startLine; i < lines.length; i++) {
        if (lines[i].includes(';') || (i > startLine && lines[i].trim() && !lines[i].trim().startsWith('.'))) {
          endLine = i;
          break;
        }
      }
    }
    const isExported = m[0].includes('export');
    symbols.push({
      type: 'function',
      name: m[2],
      params: extractParams(m[3]),
      startLine,
      endLine,
      body: bodySlice(lines, startLine, endLine),
      exported: isExported,
      async: m[0].includes('async'),
      generator: false,
      doc: leadingComment(lines, startLine, '//'),
    });
  }

  // 3. Classes
  const classRe = /^(\s*)(?:export\s+)?(?:export\s+default\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/gm;
  while ((m = classRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findBraceEnd(lines, startLine);
    const isExported = m[0].includes('export');
    const className = m[2];

    // Extract methods inside the class
    const classBody = bodySlice(lines, startLine, endLine);
    const methods = extractClassMethods(classBody, startLine, className);

    symbols.push({
      type: 'class',
      name: className,
      extends: m[3] || null,
      startLine,
      endLine,
      body: bodySlice(lines, startLine, endLine),
      exported: isExported,
      children: methods,
      doc: leadingComment(lines, startLine, '//'),
    });
  }

  // 4. Top-level const/let/var (non-function)
  const varRe = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?!(?:async\s*)?\()/gm;
  while ((m = varRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    // Skip if already captured as arrow function
    if (symbols.some(s => s.name === m[1])) continue;
    // Simple heuristic: ends at ; or next blank line
    let endLine = startLine;
    for (let i = startLine; i < Math.min(startLine + 20, lines.length); i++) {
      endLine = i;
      if (lines[i].trimEnd().endsWith(';') || lines[i].trimEnd().endsWith(',') === false && i > startLine && lines[i].trim() === '') break;
    }
    symbols.push({
      type: 'variable',
      name: m[1],
      startLine,
      endLine,
      body: bodySlice(lines, startLine, endLine),
      exported: m[0].includes('export'),
      doc: leadingComment(lines, startLine, '//'),
    });
  }

  return dedup(symbols);
}

function extractClassMethods(classBody, classStartLine, className) {
  const methods = [];
  const lines = classBody.split('\n');
  // Match method patterns: name(...) {  or  async name(...) {  or  get name() {
  const methodRe = /^(\s+)(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(?:#)?(\w+)\s*\(([^)]*)\)\s*\{?/gm;
  let m;
  while ((m = methodRe.exec(classBody)) !== null) {
    const localLine = classBody.substring(0, m.index).split('\n').length - 1;
    const absStart = classStartLine + localLine;
    const absEnd = classStartLine + findBraceEnd(lines, localLine);
    methods.push({
      type: 'method',
      name: m[2],
      params: extractParams(m[3]),
      startLine: absStart,
      endLine: absEnd,
      body: bodySlice(lines, localLine, findBraceEnd(lines, localLine)),
      className,
    });
  }
  return methods;
}

// ─── Python ───

function extractPythonSymbols(content, lines) {
  const symbols = [];

  // Functions
  const funcRe = /^([ \t]*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm;
  let m;
  while ((m = funcRe.exec(content)) !== null) {
    const indent = m[1].length;
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findIndentEnd(lines, startLine, indent);
    const isMethod = indent > 0;
    symbols.push({
      type: isMethod ? 'method' : 'function',
      name: m[2],
      params: extractParams(m[3]),
      startLine,
      endLine,
      body: bodySlice(lines, startLine, endLine),
      exported: !m[2].startsWith('_'),
      async: m[0].includes('async'),
      doc: leadingComment(lines, startLine, '#'),
    });
  }

  // Classes
  const classRe = /^class\s+(\w+)(?:\(([^)]*)\))?:/gm;
  while ((m = classRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findIndentEnd(lines, startLine, 0);
    const children = symbols.filter(s => s.type === 'method' && s.startLine > startLine && s.startLine <= endLine);
    symbols.push({
      type: 'class',
      name: m[1],
      extends: m[2] || null,
      startLine,
      endLine,
      body: bodySlice(lines, startLine, endLine),
      exported: !m[1].startsWith('_'),
      children: children.map(c => ({ ...c })),
      doc: leadingComment(lines, startLine, '#'),
    });
  }

  return dedup(symbols);
}

/** For Python: find the last line at the same or deeper indent level */
function findIndentEnd(lines, startLine, baseIndent) {
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue; // skip blanks
    const indent = line.search(/\S/);
    if (indent <= baseIndent) return i - 1;
  }
  return lines.length - 1;
}

// ─── Go ───

function extractGoSymbols(content, lines) {
  const symbols = [];

  // Functions & methods: func (receiver) Name(...) ... {
  const funcRe = /^func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(([^)]*)\)/gm;
  let m;
  while ((m = funcRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findBraceEnd(lines, startLine);
    const isMethod = !!m[2];
    symbols.push({
      type: isMethod ? 'method' : 'function',
      name: m[3],
      params: extractParams(m[4]),
      startLine,
      endLine,
      body: bodySlice(lines, startLine, endLine),
      exported: m[3][0] === m[3][0].toUpperCase(),
      className: m[2] || null,
    });
  }

  // Structs
  const structRe = /^type\s+(\w+)\s+struct\s*\{/gm;
  while ((m = structRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findBraceEnd(lines, startLine);
    symbols.push({
      type: 'class',
      name: m[1],
      startLine,
      endLine,
      body: bodySlice(lines, startLine, endLine),
      exported: m[1][0] === m[1][0].toUpperCase(),
    });
  }

  return symbols;
}

// ─── Rust ───

function extractRustSymbols(content, lines) {
  const symbols = [];

  const funcRe = /^(\s*)(?:pub(?:\(crate\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/gm;
  let m;
  while ((m = funcRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findBraceEnd(lines, startLine);
    symbols.push({
      type: 'function',
      name: m[2],
      params: extractParams(m[3]),
      startLine,
      endLine,
      body: bodySlice(lines, startLine, endLine),
      exported: m[0].includes('pub'),
    });
  }

  const structRe = /^(?:pub\s+)?(?:struct|enum)\s+(\w+)/gm;
  while ((m = structRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findBraceEnd(lines, startLine);
    symbols.push({
      type: 'class',
      name: m[1],
      startLine,
      endLine,
      body: bodySlice(lines, startLine, endLine),
      exported: m[0].includes('pub'),
    });
  }

  return symbols;
}

// ─── Java / C# / Kotlin ───

function extractJavaLikeSymbols(content, lines) {
  const symbols = [];

  // Classes / interfaces
  const classRe = /^(\s*)(?:public|private|protected|internal)?\s*(?:static\s+)?(?:abstract\s+)?(?:class|interface|enum)\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+(\w+))?/gm;
  let m;
  while ((m = classRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findBraceEnd(lines, startLine);
    symbols.push({
      type: 'class',
      name: m[2],
      extends: m[3] || null,
      startLine,
      endLine,
      body: bodySlice(lines, startLine, endLine),
      exported: m[0].includes('public'),
    });
  }

  // Methods
  const methodRe = /^(\s+)(?:public|private|protected)\s+(?:static\s+)?(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+\w+(?:\s*,\s*\w+)*)?\s*\{/gm;
  while ((m = methodRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findBraceEnd(lines, startLine);
    symbols.push({
      type: 'method',
      name: m[2],
      params: extractParams(m[3]),
      startLine,
      endLine,
      body: bodySlice(lines, startLine, endLine),
    });
  }

  return symbols;
}

// ─── Ruby ───

function extractRubySymbols(content, lines) {
  const symbols = [];

  const classRe = /^(\s*)class\s+(\w+)(?:\s*<\s*(\w+))?/gm;
  let m;
  while ((m = classRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findRubyEnd(lines, startLine, m[1].length);
    symbols.push({
      type: 'class', name: m[2], extends: m[3] || null,
      startLine, endLine,
      body: bodySlice(lines, startLine, endLine),
    });
  }

  const defRe = /^(\s*)def\s+(?:self\.)?(\w+[?!=]?)\s*(?:\(([^)]*)\))?/gm;
  while ((m = defRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findRubyEnd(lines, startLine, m[1].length);
    symbols.push({
      type: m[1].length > 0 ? 'method' : 'function',
      name: m[2], params: extractParams(m[3]),
      startLine, endLine,
      body: bodySlice(lines, startLine, endLine),
    });
  }

  return symbols;
}

function findRubyEnd(lines, startLine, baseIndent) {
  for (let i = startLine + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const indent = lines[i].search(/\S/);
    if (trimmed === 'end' && indent <= baseIndent) return i;
  }
  return lines.length - 1;
}

// ─── PHP ───

function extractPhpSymbols(content, lines) {
  const symbols = [];

  const classRe = /^(?:\s*)(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/gm;
  let m;
  while ((m = classRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findBraceEnd(lines, startLine);
    symbols.push({
      type: 'class', name: m[1], extends: m[2] || null,
      startLine, endLine,
      body: bodySlice(lines, startLine, endLine),
    });
  }

  const funcRe = /^(\s*)(?:public|private|protected|static|\s)*function\s+(\w+)\s*\(([^)]*)\)/gm;
  while ((m = funcRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findBraceEnd(lines, startLine);
    symbols.push({
      type: m[1].trim().length > 0 ? 'method' : 'function',
      name: m[2], params: extractParams(m[3]),
      startLine, endLine,
      body: bodySlice(lines, startLine, endLine),
    });
  }

  return symbols;
}

// ─── C / C++ ───

function extractCSymbols(content, lines) {
  const symbols = [];

  // Functions: type name(...) {
  const funcRe = /^(?:static\s+)?(?:inline\s+)?(?:const\s+)?(?:\w+[\s*&]+)(\w+)\s*\(([^)]*)\)\s*\{/gm;
  let m;
  while ((m = funcRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findBraceEnd(lines, startLine);
    symbols.push({
      type: 'function', name: m[1], params: extractParams(m[2]),
      startLine, endLine,
      body: bodySlice(lines, startLine, endLine),
    });
  }

  // Structs / classes (C++)
  const structRe = /^(?:typedef\s+)?(?:struct|class)\s+(\w+)\s*\{/gm;
  while ((m = structRe.exec(content)) !== null) {
    const startLine = content.substring(0, m.index).split('\n').length - 1;
    const endLine = findBraceEnd(lines, startLine);
    symbols.push({
      type: 'class', name: m[1],
      startLine, endLine,
      body: bodySlice(lines, startLine, endLine),
    });
  }

  return symbols;
}

// ─── Utils ───

function dedup(symbols) {
  const seen = new Set();
  return symbols.filter(s => {
    const key = `${s.type}:${s.name}:${s.startLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { extractSymbols };
