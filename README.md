# Viza 
 
A visual scripting step towards vibe coding <> 

##  Features

-  **`viza build`** - Analyzes any repo and generates a `.vz` file
-  **`viza view`** - Opens an interactive drag-and-drop visualization
-  **Smart Analysis** - Detects imports, exports, functions, classes across 30+ languages
-  **Dependency Graph** - Shows how files connect to each other
-  **Directory Grouping** - Files organized by directory with color-coded groups
-  **Drag & Drop** - Move nodes freely, pan, zoom, and explore
-  **Search** - Find files, functions, and classes instantly
-  **Code Preview** - Inspect file contents, symbols, and metadata
-  **Focus Mode** - Isolate a file and its connections
-  **Keyboard Shortcuts** - Full keyboard navigation support

## 🚀 Quick Start

### Install
```bash
npm install -g viza
```

Or use locally:
```bash
cd viza
npm install
npm link
```

### Build a Repository Graph
```bash
# Navigate to any repository
cd /path/to/your/repo

# Generate a .vz file
viza build

# Or specify a path
viza build /path/to/repo

# Custom output name
viza build -o myproject.vz
```

### View the Visualization
```bash
# Open the visual explorer
viza view

# Or specify a .vz file
viza view myproject.vz

# Custom port
viza view -p 8080
```

## 🎮 Controls

| Action | Mouse | Keyboard |
|--------|-------|----------|
| Select node | Click | - |
| Drag node | Click & drag | - |
| Pan canvas | Middle click & drag | `H` to enter pan mode |
| Zoom | Scroll wheel | `+` / `-` |
| Focus node | Double click | - |
| Fit all | - | `F` |
| Toggle edges | - | `E` |
| Toggle labels | - | `L` |
| Toggle groups | - | `G` |
| Search | - | `/` |
| Deselect all | - | `Esc` |
| Hide node | - | `Delete` |
| Context menu | Right click | - |

##  The `.vz` Format

The `.vz` file is a JSON file containing:

```json
{
  "version": "1.0",
  "format": "viza",
  "meta": {
    "name": "my-project",
    "totalFiles": 42,
    "totalEdges": 128
  },
  "nodes": [
    {
      "id": "f_123_src_index_js",
      "name": "index.js",
      "path": "src/index.js",
      "language": "javascript",
      "lines": 150,
      "metadata": {
        "functions": ["main", "init"],
        "classes": ["App"],
        "exports": ["App", "init"]
      }
    }
  ],
  "edges": [
    {
      "source": "f_123_src_index_js",
      "target": "f_456_src_utils_js",
      "type": "import",
      "label": "formatDate, parseUrl"
    }
  ],
  "groups": [...],
  "tree": {...}
}
```

## Supported Languages

JavaScript, TypeScript, Python, Go, Rust, Java, C#, C/C++, Ruby, PHP, Kotlin, Swift, Dart, Vue, Svelte, and 30+ more.

##  Configuration

Create a `.vizarc.json` in your project root:

```json
{
  "ignore": ["node_modules", ".git", "dist", "test"],
  "maxFileSize": 102400,
  "maxDepth": 10
}
```

##  License

MIT
