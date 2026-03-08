# OpenTUI — AI Reference Summary

> Comprehensive reference for building terminal UIs with OpenTUI, focused on Bun + React bindings.
> Derived from the official OpenTUI documentation.

---

## 1. What is OpenTUI

OpenTUI is a native terminal UI core written in Zig with TypeScript bindings. It provides a component-based architecture with CSS Flexbox layout (via the Yoga engine), keyboard/mouse input handling, syntax highlighting (Tree-sitter), and framework bindings for React and Solid.js. It is **Bun-exclusive** (Deno/Node support is in progress).

---

## 2. Installation & Project Setup

### Scaffold a React project

```bash
bun create tui --template react
```

### Manual installation

```bash
mkdir my-tui && cd my-tui
bun init -y
bun add @opentui/core @opentui/react react
```

### tsconfig.json (React)

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "@opentui/react",
    "strict": true,
    "skipLibCheck": true
  }
}
```

### Minimal React entry point

```tsx
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

function App() {
  return <text>Hello, world!</text>
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
```

Run with: `bun index.tsx`

---

## 3. Core Architecture

### 3.1 Renderer (`CliRenderer`)

The renderer is the root object. It manages the terminal, the render loop, input events, and the component tree.

```ts
import { createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer({
  exitOnCtrlC: true,   // default
  targetFps: 30,       // default
  maxFps: 60,          // default
  useMouse: true,      // default
  useAlternateScreen: true, // default
})
```

**Key config options:**

| Option                | Type               | Default | Description                              |
|-----------------------|--------------------|---------|------------------------------------------|
| `exitOnCtrlC`         | `boolean`          | `true`  | Destroy renderer on Ctrl+C               |
| `targetFps`           | `number`           | `30`    | Target FPS for the render loop           |
| `maxFps`              | `number`           | `60`    | Maximum FPS for immediate re-renders     |
| `useMouse`            | `boolean`          | `true`  | Enable mouse input                       |
| `useAlternateScreen`  | `boolean`          | `true`  | Use alternate screen buffer              |
| `consoleOptions`      | `ConsoleOptions`   | —       | Built-in console overlay config          |
| `onDestroy`           | `() => void`       | —       | Cleanup callback                         |

**Render loop modes:**
- **Automatic (default):** Re-renders only when the tree changes.
- **Continuous:** Call `renderer.start()` for constant FPS loop; `renderer.stop()` to halt.
- **Live:** `renderer.requestLive()` / `renderer.dropLive()` for animation-driven rendering.

**Key properties:** `root`, `width`, `height`, `console`, `keyInput`, `isRunning`, `isDestroyed`, `currentFocusedRenderable`, `themeMode`.

**Events:** `"resize"`, `"destroy"`, `"selection"`, `"theme_mode"`.

### 3.2 Lifecycle & Cleanup

**Critical:** OpenTUI does NOT auto-cleanup on `process.exit` or unhandled errors. You must call `renderer.destroy()`.

```ts
process.on("uncaughtException", (error) => {
  renderer.destroy()
  process.exit(1)
})
```

By default, the renderer handles these exit signals: `SIGINT`, `SIGTERM`, `SIGQUIT`, `SIGABRT`, `SIGHUP`, `SIGBREAK`, `SIGPIPE`, `SIGBUS`, `SIGFPE`. Customize via `exitSignals` option. `destroy()` restores terminal state, clears timers, destroys all renderables, resets stdin, and frees native resources.

If the terminal gets stuck after a crash, run `reset` in the terminal.

### 3.3 Two APIs: Renderables vs Constructs

OpenTUI has two composition models that can be mixed freely:

| Aspect              | Renderables (Imperative)           | Constructs (Declarative)                  |
|---------------------|------------------------------------|-------------------------------------------|
| Creation            | `new BoxRenderable(renderer, {…})` | `Box({…}, …children)`                     |
| Context required    | Yes (renderer at creation)         | No (deferred until added to tree)         |
| State mutation      | Direct property/method access      | VNodes queue calls for replay             |
| Nested access       | Manual `.findDescendantById()`     | `delegate()` routes calls automatically   |
| Best for            | Custom low-level components        | Declarative UI composition                |

**In React bindings, you always use the JSX/declarative approach** — the underlying construct/renderable distinction is hidden.

---

## 4. Layout System (Yoga/Flexbox)

All components use the Yoga layout engine. Standard CSS Flexbox properties are supported.

### Flex direction & alignment

```tsx
<box flexDirection="row" justifyContent="space-between" alignItems="center">
  …
</box>
```

Supported `flexDirection`: `"column"` (default), `"row"`, `"column-reverse"`, `"row-reverse"`.  
Supported `justifyContent`: `"flex-start"`, `"flex-end"`, `"center"`, `"space-between"`, `"space-around"`, `"space-evenly"`.  
Supported `alignItems`: `"flex-start"`, `"flex-end"`, `"center"`, `"stretch"` (default), `"baseline"`.

### Sizing

```tsx
// Fixed
<box width={30} height={10} />

// Percentage
<box width="100%" height="50%" />

// Flex
<box flexGrow={1} flexShrink={0} flexBasis={100} />
```

### Positioning

```tsx
// Relative (default, participates in layout flow)
<box position="relative" />

// Absolute (removed from flow, positioned relative to parent)
<box position="absolute" left={10} top={5} />
```

### Spacing

All components accept: `padding`, `paddingX`, `paddingY`, `paddingTop/Right/Bottom/Left`, `margin` (same axes), and `gap`.

### Visibility

```tsx
// visible={false} is equivalent to CSS display:none — removed from layout
<box visible={false} />
```

---

## 5. React Bindings — Complete Reference

### 5.1 Rendering

```tsx
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
```

### 5.2 JSX Intrinsic Elements

All JSX tags are **lowercase** and map to core renderables.

#### Layout & Display
- `<text>` — Styled text display
- `<box>` — Container with borders and flex layout
- `<scrollbox>` — Scrollable container
- `<ascii-font>` — ASCII art text

#### Input
- `<input>` — Single-line text input
- `<textarea>` — Multi-line text editor
- `<select>` — Vertical list selection
- `<tab-select>` — Horizontal tab selection

#### Code & Data
- `<code>` — Syntax-highlighted code (Tree-sitter)
- `<line-number>` — Line number gutter
- `<diff>` — Unified or split diff viewer
- `<markdown>` — Markdown renderer

#### Text Modifiers (inside `<text>`)
- `<span>` — Inline styled text
- `<strong>`, `<b>` — Bold
- `<em>`, `<i>` — Italic
- `<u>` — Underline
- `<br>` — Line break
- `<a>` — Link text

### 5.3 Hooks

#### `useRenderer()`
Access the `CliRenderer` instance.
```tsx
const renderer = useRenderer()
```

#### `useKeyboard(handler, options?)`
Handle keyboard events. Fires on keypress by default.
```tsx
useKeyboard((key) => {
  if (key.name === "escape") process.exit(0)
})

// With release events:
useKeyboard((event) => {
  if (event.eventType === "release") { /* … */ }
}, { release: true })
```

**Key event properties:** `name` (string), `sequence` (raw escape sequence), `ctrl`, `shift`, `meta`, `option` (booleans).

Common key names: `"escape"`, `"return"`, `"space"`, `"tab"`, `"up"`, `"down"`, `"left"`, `"right"`, `"f1"`–`"f12"`, single characters like `"a"`, `"s"`.

#### `useOnResize(callback)`
```tsx
useOnResize((width, height) => { /* … */ })
```

#### `useTerminalDimensions()`
Returns reactive `{ width, height }` object.
```tsx
const { width, height } = useTerminalDimensions()
```

#### `useTimeline(options?)`
Animation timeline for tweening values.
```tsx
const timeline = useTimeline({ duration: 2000, loop: false })

useEffect(() => {
  timeline.add({ width: 0 }, {
    width: 50,
    duration: 2000,
    ease: "linear",
    onUpdate: (anim) => setWidth(anim.targets[0].width),
  })
}, [])
```
Options: `duration`, `loop`, `autoplay`, `onComplete`, `onPause`.

### 5.4 Styling

Two equivalent approaches:
```tsx
// Direct props
<box backgroundColor="blue" padding={2} />

// Style prop
<box style={{ backgroundColor: "blue", padding: 2 }} />
```

### 5.5 Component Extension

Register custom `Renderable` subclasses as JSX elements:

```tsx
import { extend } from "@opentui/react"

class MyRenderable extends BoxRenderable { /* … */ }

declare module "@opentui/react" {
  interface OpenTUIComponents {
    myComponent: typeof MyRenderable
  }
}

extend({ myComponent: MyRenderable })

// Now usable as <myComponent prop={value} />
```

### 5.6 React DevTools

```bash
bun add --dev react-devtools-core@7
npx react-devtools@7       # start DevTools
DEV=true bun run app.ts    # run app with DEV flag
```

---

## 6. Component Reference

### 6.1 `<text>`

Display styled text content.

```tsx
<text content="Hello" fg="#00FF00" />
```

**Key props:** `content` (string | StyledText), `fg`, `bg`, `attributes` (TextAttributes bitmask), `selectable` (default `true`).

**Text attributes:** `TextAttributes.BOLD`, `.DIM`, `.ITALIC`, `.UNDERLINE`, `.BLINK`, `.INVERSE`, `.HIDDEN`, `.STRIKETHROUGH`. Combine with `|`.

**Rich text with template literals** (core API):
```ts
import { t, bold, fg, underline, italic } from "@opentui/core"
t`${bold("Important:")} ${fg("#FF0000")(underline("Warning!"))} Normal text`
```

### 6.2 `<box>`

Container with borders, backgrounds, and flex layout.

```tsx
<box borderStyle="rounded" padding={1} flexDirection="column" gap={1}>
  <text content="Inside" />
</box>
```

**Border styles:** `"single"`, `"double"`, `"rounded"`, `"heavy"`, or `border={true}` for default single.

**Title:** `title="Settings"` with `titleAlignment`: `"left"` (default), `"center"`, `"right"`.

**Key props:** `width`, `height`, `backgroundColor`, `border`, `borderStyle`, `borderColor`, `title`, `titleAlignment`, `padding`, `gap`, `flexDirection`, `justifyContent`, `alignItems`.

**Mouse events (via props):** `onMouseDown`, `onMouseUp`, `onMouseMove`, `onMouseDrag`, `onMouseDragEnd`, `onMouseDrop`, `onMouseOver`, `onMouseOut`, `onMouseScroll`, `onMouse` (catch-all). Events bubble; stop with `event.stopPropagation()`.

### 6.3 `<input>`

Single-line text input. Must be focused to receive keys.

```tsx
<input
  placeholder="Enter name..."
  width={25}
  onInput={setValue}
  onSubmit={handleSubmit}
  focused={isFocused}
/>
```

**Events:** `onInput` (every keystroke), `onChange` (on blur/enter if value changed), `onSubmit` (on Enter).

**Styling props:** `backgroundColor`, `focusedBackgroundColor`, `textColor`, `cursorColor`.

**Value:** `value` prop for controlled input. Read via `input.value`.

### 6.4 `<textarea>`

Multi-line text editor with selection and keybindings. **No construct/JSX yet — use `TextareaRenderable` directly.**

```ts
const textarea = new TextareaRenderable(renderer, {
  width: 50, height: 6,
  placeholder: "Type notes here...",
  wrapMode: "word",        // "none" | "char" | "word"
  keyBindings: [{ name: "return", ctrl: true, action: "submit" }],
  onSubmit: () => { /* … */ },
})
```

**Key props:** `initialValue`, `placeholder`, `wrapMode`, `backgroundColor`, `focusedBackgroundColor`, `textColor`, `cursorColor`, `selectionBg`, `selectionFg`, `keyBindings`, `onSubmit`, `onContentChange`, `onCursorChange`.

**Useful properties:** `plainText`, `cursorOffset`.

### 6.5 `<select>`

Vertical list selection. Focus to enable keyboard navigation.

```tsx
<select
  width={30}
  height={8}
  options={[
    { name: "Option 1", description: "Desc 1" },
    { name: "Option 2", description: "Desc 2" },
  ]}
/>
```

**Keybindings:** Up/k, Down/j, Shift+Up/Down (fast scroll), Enter (select).

**Events:** `ITEM_SELECTED` (index, option), `SELECTION_CHANGED` (index, option).

**Options interface:** `{ name: string, description: string, value?: any }`.

**Key style props:** `backgroundColor`, `selectedBackgroundColor`, `selectedTextColor`, `textColor`, `descriptionColor`.

**Other props:** `showDescription`, `showScrollIndicator`, `wrapSelection`, `itemSpacing`, `fastScrollStep`.

**Programmatic:** `getSelectedIndex()`, `getSelectedOption()`, `setSelectedIndex(n)`, `moveUp()`, `moveDown()`, `selectCurrent()`.

### 6.6 `<tab-select>`

Horizontal tab selection.

```tsx
<tab-select
  width={60}
  tabWidth={20}
  options={[
    { name: "Home", description: "Dashboard" },
    { name: "Files", description: "Browse" },
  ]}
/>
```

**Keybindings:** Left/`[`, Right/`]`, Enter.

**Events:** Same as Select (`ITEM_SELECTED`, `SELECTION_CHANGED`).

### 6.7 `<scrollbox>`

Scrollable container with customizable scrollbars.

```tsx
<scrollbox width={40} height={20} stickyScroll stickyStart="bottom">
  {items.map((item, i) => <box key={i}><text content={item} /></box>)}
</scrollbox>
```

**Key props:** `scrollX` (default `false`), `scrollY` (default `true`), `stickyScroll`, `stickyStart` (`"top"` | `"bottom"` | `"left"` | `"right"`), `viewportCulling` (default `true`).

**Scroll methods:** `scrollBy(n)`, `scrollBy({ x, y })`, `scrollBy(1, "viewport")`, `scrollTo(n)`, `scrollTo({ x, y })`.

**Keyboard (when focused):** Arrow keys (line), PageUp/PageDown (page), Home/End (start/end).

**Sub-component styling:** `rootOptions`, `wrapperOptions`, `viewportOptions`, `contentOptions`, `scrollbarOptions`.

### 6.8 `<scrollbar>`

Standalone scrollbar. **No construct/JSX yet — use `ScrollBarRenderable`.**

**Props:** `orientation`, `showArrows`, `scrollSize`, `viewportSize`, `scrollPosition`, `onChange`.

### 6.9 `<code>`

Syntax-highlighted code via Tree-sitter.

```tsx
<code content={sourceCode} filetype="typescript" syntaxStyle={style} />
```

**Requires:** A `SyntaxStyle` object created with `SyntaxStyle.fromStyles({ … })`.

**Style token names:** `keyword`, `string`, `comment`, `number`, `function`, `type`, `variable`, `operator`, `punctuation`, `boolean`, `constant`, `property`, `default`, and dot-nested variants like `keyword.import`, `function.call`, etc.

**Key props:** `content`, `filetype`, `syntaxStyle`, `streaming` (for incremental/LLM output), `conceal`, `selectable`, `selectionBg`, `wrapMode`.

**Streaming mode:** Set `streaming: true` and append to `content` for incremental updates.

### 6.10 `<markdown>`

Render markdown content. **No construct/JSX yet — use `MarkdownRenderable`.**

```ts
const md = new MarkdownRenderable(renderer, {
  content: "# Title\n\n- item",
  syntaxStyle,           // uses markup.* token names
  conceal: true,         // hide markdown markers
  streaming: false,      // set true for incremental, false to finalize
  tableOptions: { … },
})
```

**Markdown syntax style tokens:** `markup.heading`, `markup.heading.1`, `markup.heading.2`, `markup.bold`, `markup.strong`, `markup.italic`, `markup.list`, `markup.quote`, `markup.raw`, `markup.raw.block`, `markup.link`, `markup.link.url`.

**Table options:** `widthMode`, `columnFitter`, `wrapMode`, `cellPadding`, `borders`, `outerBorder`, `borderStyle`, `borderColor`, `selectable`.

**Streaming:** Keep `streaming=true` while appending, set `streaming=false` to finalize.

### 6.11 `<diff>`

Diff viewer. **No construct/JSX yet — use `DiffRenderable`.**

```ts
const diff = new DiffRenderable(renderer, {
  diff: unifiedDiffString,
  view: "split",          // "unified" | "split"
  filetype: "typescript",
  syntaxStyle,
  showLineNumbers: true,
})
```

**Color props:** `addedBg`, `removedBg`, `contextBg`, `addedSignColor`, `removedSignColor`, `lineNumberFg`, `lineNumberBg`.

### 6.12 `<ascii-font>`

ASCII art text display.

```tsx
<ascii-font text="TITLE" font="block" color="#00FFFF" />
```

**Available fonts:** `"tiny"`, `"block"`, `"shade"`, `"slick"`, `"huge"`, `"grid"`, `"pallet"`.

**Props:** `text`, `font`, `color` (single or array), `backgroundColor`, `selectable`, `x`, `y`.

### 6.13 `<frame-buffer>`

Low-level 2D cell buffer for custom drawing. **No JSX construct yet for drawing ops — use `FrameBufferRenderable` to access `frameBuffer` methods.**

**Drawing methods on `frameBuffer`:**
- `setCell(x, y, char, fg, bg, attributes?)` — single cell
- `setCellWithAlphaBlending(x, y, char, fg, bg)` — with alpha
- `drawText(text, x, y, fg, bg?, attributes?)` — text string
- `fillRect(x, y, w, h, color)` — filled rectangle
- `drawFrameBuffer(destX, destY, source, …)` — composite buffers

**Performance tip:** Create `RGBA` constants outside loops and reuse them.

### 6.14 `<line-number>`

Line number gutter. Typically wraps a `CodeRenderable`. **No JSX construct yet — use `LineNumberRenderable`.**

```ts
const lineNumbers = new LineNumberRenderable(renderer, {
  target: codeRenderable,
  minWidth: 3,
  paddingRight: 1,
  fg: "#6b7280",
  bg: "#161b22",
})
```

**Per-line customization:** `setLineColor(line, color)`, `setLineSign(line, { before, beforeColor })`.

### 6.15 `<slider>`

Draggable slider. **No JSX construct yet — use `SliderRenderable`.**

```ts
new SliderRenderable(renderer, {
  orientation: "horizontal",  // or "vertical"
  width: 30, height: 1,
  min: 0, max: 100, value: 25,
  onChange: (value) => { /* … */ },
})
```

---

## 7. Colors

```ts
import { RGBA, parseColor } from "@opentui/core"

// Creation methods
RGBA.fromHex("#FF0000")
RGBA.fromHex("#FF000080")           // with alpha
RGBA.fromInts(255, 0, 0, 255)       // r, g, b, a (0-255)
RGBA.fromValues(1.0, 0.0, 0.0, 1.0) // r, g, b, a (0.0-1.0)

// Most props accept hex strings, CSS color names, or RGBA objects
<text fg="#00FF00" />
<box backgroundColor="red" />
<box backgroundColor={RGBA.fromHex("#333")} />
```

`parseColor()` converts any format (hex, CSS name, `"transparent"`, or RGBA passthrough) to RGBA.

---

## 8. Keyboard Input

### In React

```tsx
import { useKeyboard } from "@opentui/react"

useKeyboard((key) => {
  if (key.ctrl && key.name === "s") { /* save */ }
  if (key.name === "escape") { /* close */ }
})
```

### KeyEvent properties

| Property   | Type      | Description                              |
|------------|-----------|------------------------------------------|
| `name`     | `string`  | Key name: `"a"`, `"escape"`, `"f1"`, etc |
| `sequence` | `string`  | Raw escape sequence                      |
| `ctrl`     | `boolean` | Ctrl held                                |
| `shift`    | `boolean` | Shift held                               |
| `meta`     | `boolean` | Alt/Meta held                            |
| `option`   | `boolean` | Option held (macOS)                      |

### Focus routing

Keyboard events route to the focused component. Focus interactive components with `.focus()` or `focused` prop. Focus changes emit `FOCUSED` and `BLURRED` events. Click auto-focuses the nearest focusable (disable with `autoFocus: false`).

---

## 9. Mouse Events

Available as props on `<box>` and other components:

- `onMouseDown`, `onMouseUp` — click lifecycle
- `onMouseMove`, `onMouseDrag`, `onMouseDragEnd`, `onMouseDrop` — movement/drag
- `onMouseOver`, `onMouseOut` — hover
- `onMouseScroll` — wheel
- `onMouse` — catch-all

Events bubble up the tree. Call `event.stopPropagation()` to stop. Call `event.preventDefault()` in `onMouseDown` to prevent auto-focus.

---

## 10. Console Overlay

Built-in debugging console that captures `console.log/info/warn/error/debug`.

```ts
const renderer = await createCliRenderer({
  consoleOptions: {
    position: ConsolePosition.BOTTOM,  // TOP, BOTTOM, LEFT, RIGHT
    sizePercent: 30,
    colorError: "#FF0000",
    colorWarn: "#FFFF00",
  },
})

// Toggle programmatically
renderer.console.toggle()
```

Shortcuts when focused: Arrow keys (scroll), `+`/`-` (resize).

**Env vars:** `OTUI_USE_CONSOLE=false` (disable), `SHOW_CONSOLE=true` (show at start).

---

## 11. Tree-sitter Integration

Used by `<code>`, `<markdown>`, and `<diff>` for syntax highlighting.

### Add parsers globally

```ts
import { addDefaultParsers, getTreeSitterClient } from "@opentui/core"

addDefaultParsers([{
  filetype: "python",
  wasm: "https://…/tree-sitter-python.wasm",
  queries: { highlights: ["https://…/highlights.scm"] },
}])

const client = getTreeSitterClient()
await client.initialize()
```

### Per-client parsers

```ts
const client = new TreeSitterClient({ dataPath: "./cache" })
await client.initialize()
client.addFiletypeParser({ filetype: "rust", wasm: "…", queries: { highlights: ["…"] } })
```

### Local files

```ts
import pythonWasm from "./parsers/tree-sitter-python.wasm" with { type: "file" }
import pythonHighlights from "./queries/python/highlights.scm" with { type: "file" }

addDefaultParsers([{ filetype: "python", wasm: pythonWasm, queries: { highlights: [pythonHighlights] } }])
```

### File type utilities

```ts
import { pathToFiletype, extToFiletype } from "@opentui/core"
pathToFiletype("src/main.rs") // "rust"
extToFiletype("ts")           // "typescript"
```

---

## 12. Animations

Use `useTimeline` (React) for tweening:

```tsx
const [width, setWidth] = useState(0)
const timeline = useTimeline({ duration: 2000, loop: false })

useEffect(() => {
  timeline.add({ width }, {
    width: 50,
    duration: 2000,
    ease: "linear",
    onUpdate: (anim) => setWidth(anim.targets[0].width),
  })
}, [])

return <box style={{ width, backgroundColor: "#6a5acd" }} />
```

For low-level: set `live: true` on renderables and override `onUpdate(deltaTime)`.

---

## 13. Advanced Patterns

### Responsive layouts

```tsx
function App() {
  const { width } = useTerminalDimensions()

  return (
    <box flexDirection={width < 80 ? "column" : "row"}>
      <box flexGrow={1}><text content="Main" /></box>
      <box width={20}><text content="Sidebar" /></box>
    </box>
  )
}
```

### Custom constructs with `delegate()`

Route method calls to inner components in composite constructs:

```ts
import { delegate, Box, Input, Text } from "@opentui/core"

function LabeledInput(props: { id: string; label: string }) {
  return delegate(
    { focus: `${props.id}-input`, value: `${props.id}-input` },
    Box(
      { flexDirection: "row" },
      Text({ content: props.label }),
      Input({ id: `${props.id}-input`, width: 20 }),
    ),
  )
}
const field = LabeledInput({ id: "name", label: "Name:" })
field.focus() // routes to the inner Input
```

### Z-Index & Overlays

```tsx
<box position="absolute" zIndex={100}>
  {/* overlay content */}
</box>
```

### Opacity

```tsx
<box opacity={0.5}>{/* semi-transparent */}</box>
```

### Buffered / Custom Rendering

```ts
new BoxRenderable(renderer, {
  buffered: true,
  renderAfter: (buffer) => {
    buffer.fillRect(0, 0, 10, 5, RGBA.fromHex("#FF0000"))
  },
})
```

### Theme Mode Detection

```ts
const mode = renderer.themeMode // "dark" | "light" | null
renderer.on("theme_mode", (nextMode) => { /* … */ })
```

---

## 14. Environment Variables

| Variable                       | Default | Description                                    |
|-------------------------------|---------|------------------------------------------------|
| `OTUI_USE_ALTERNATE_SCREEN`    | `true`  | Use alternate screen buffer                    |
| `OTUI_SHOW_STATS`              | `false` | Show debug overlay at startup                  |
| `OTUI_DEBUG`                   | `false` | Enable debug input capture                     |
| `OTUI_NO_NATIVE_RENDER`        | `false` | Disable native rendering                       |
| `OTUI_DUMP_CAPTURES`           | `false` | Dump captured output on exit                   |
| `OTUI_USE_CONSOLE`             | `true`  | Enable built-in console                        |
| `SHOW_CONSOLE`                 | `false` | Show console at startup                        |
| `OTUI_TS_STYLE_WARN`           | `false` | Warn on missing syntax styles                  |
| `OPENTUI_GRAPHICS`             | `true`  | Kitty graphics protocol detection              |
| `OPENTUI_FORCE_EXPLICIT_WIDTH` | —       | Force explicit width detection                 |

---

## 15. Building for Production

```ts
// build.ts
import solidPlugin from "@opentui/solid/bun-plugin"   // if using Solid
// For React, standard Bun build works:

await Bun.build({
  entrypoints: ["./index.tsx"],
  target: "bun",
  outdir: "./build",
  // plugins: [solidPlugin],  // only for Solid
})

// Standalone executable (Solid example)
await Bun.build({
  entrypoints: ["./index.tsx"],
  plugins: [solidPlugin],
  compile: {
    target: "bun-darwin-arm64",
    outfile: "./app-macos",
  },
})
```

---

## 16. Quick Reference: Common Patterns

### Full-screen app skeleton (React)

```tsx
import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useState, useCallback } from "react"

function App() {
  const { width, height } = useTerminalDimensions()

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") process.exit(0)
  })

  return (
    <box width={width} height={height} flexDirection="column">
      <box height={1} backgroundColor="#333" paddingX={1}>
        <text content="My App" fg="#FFF" />
      </box>
      <box flexGrow={1} padding={1}>
        <text content="Content area" />
      </box>
      <box height={1} backgroundColor="#333" paddingX={1}>
        <text content="Status bar" fg="#888" />
      </box>
    </box>
  )
}

const renderer = await createCliRenderer({ exitOnCtrlC: true })
createRoot(renderer).render(<App />)
```

### Tab navigation between inputs

```tsx
function Form() {
  const [focused, setFocused] = useState<"a" | "b">("a")

  useKeyboard((key) => {
    if (key.name === "tab") setFocused(f => f === "a" ? "b" : "a")
  })

  return (
    <box flexDirection="column" gap={1}>
      <input placeholder="Field A" focused={focused === "a"} />
      <input placeholder="Field B" focused={focused === "b"} />
    </box>
  )
}
```

### Scrollable list with sticky bottom

```tsx
<scrollbox height={20} stickyScroll stickyStart="bottom">
  {logs.map((log, i) => (
    <text key={i} content={log} />
  ))}
</scrollbox>
```

---

## 17. Components Without JSX (Construct-only)

These components **do not have JSX/React intrinsic elements yet** and must be used as `Renderable` instances:

- `TextareaRenderable` — use `<textarea>` in JSX (available)
- `MarkdownRenderable` — no `<markdown>` in React
- `DiffRenderable` — no `<diff>` in React
- `ScrollBarRenderable` — no `<scrollbar>` in React
- `SliderRenderable` — no `<slider>` in React
- `LineNumberRenderable` — no `<line-number>` in React
- `FrameBufferRenderable` — `<frame-buffer>` exists but drawing needs imperative access

> **Note:** The React bindings list `<markdown>`, `<diff>`, `<line-number>` as JSX elements in the docs, suggesting they are available or planned. Use the imperative API as fallback if JSX versions are not yet functional.

---

## 18. Key Differences: React vs Solid Bindings

| Aspect             | React                                  | Solid                                  |
|--------------------|----------------------------------------|----------------------------------------|
| Package            | `@opentui/react`                       | `@opentui/solid`                       |
| Render             | `createRoot(renderer).render(<App />)` | `render(() => <App />)`                |
| Component naming   | kebab-case (`ascii-font`)              | snake_case (`ascii_font`)              |
| State              | `useState`                             | `createSignal`                         |
| Effects            | `useEffect`                            | `onMount`, `onCleanup`                 |
| Resize hook        | `useOnResize(cb)`                      | `onResize(cb)`                         |
| Dimensions         | `{ width, height }` object             | Signal: `dimensions().width`           |
| Extra hooks        | —                                      | `usePaste`, `useSelectionHandler`      |
| Special components | —                                      | `Portal`, `Dynamic`                    |
| Setup              | `jsxImportSource: "@opentui/react"`    | preload in `bunfig.toml`              |
