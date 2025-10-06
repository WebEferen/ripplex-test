# Migration Guide: Ripple 0.2.109+ SSR Changes

If you're using RippleX or building custom SSR with Ripple, you need to update your server code to handle the new CSS registry pattern introduced in Ripple v0.2.109.

## What Changed

The `render()` function's return value now includes a `css` property that contains CSS hashes instead of inline CSS content.

### Old API (v0.2.108 and earlier)

```js
import { render } from 'ripple/server';

const rendered = await render(Component);
console.log(rendered);
// { head: '<style>...</style>', body: '<div>...</div>' }
```

### New API (v0.2.109+)

```js
import { render, get_css_for_hashes } from 'ripple/server';

const rendered = await render(Component);
console.log(rendered);
// { head: '', body: '<div>...</div>', css: Set(['hash1', 'hash2']) }

// To get CSS content:
const cssContent = get_css_for_hashes(rendered.css);
```

## Migration Steps

### 1. Import the new function

Add `get_css_for_hashes` to your imports:

```diff
- const { render } = await vite.ssrLoadModule('ripple/server');
+ const { render, get_css_for_hashes } = await vite.ssrLoadModule('ripple/server');
```

### 2. Extract CSS from hashes

After rendering, convert CSS hashes to actual CSS content:

```diff
  const rendered = await render(Component);

+ // Get component CSS from the CSS hashes
+ let componentCss = '';
+ if (rendered.css && rendered.css.size > 0) {
+   const cssContent = get_css_for_hashes(rendered.css);
+   if (cssContent) {
+     componentCss = `<style>${cssContent}</style>`;
+   }
+ }
```

### 3. Inject CSS into HTML

Add the component CSS to your HTML template:

```diff
  let html = transformedTemplate;
- html = html.replace(/<\/head>/i, `${rendered.head}\n</head>`);
+ html = html.replace(/<\/head>/i, `${componentCss}\n${rendered.head}\n</head>`);
  html = html.replace(/(<div\s+id="root"[^>]*>)([\s\S]*?)(<\/div>)/i, `$1${rendered.body}$3`);
```

## Complete Example

Here's a complete before/after example:

### Before (v0.2.108)

```js
app.get('/page', async (req, res) => {
  const { render } = await vite.ssrLoadModule('ripple/server');
  const module = await vite.ssrLoadModule('/pages/index.ripple');
  const Component = module.default;

  const rendered = await render(Component);

  let html = template;
  html = html.replace(/<\/head>/i, `${rendered.head}\n</head>`);
  html = html.replace(/(<div id="root">)([\s\S]*?)(<\/div>)/i, `$1${rendered.body}$3`);

  res.send(html);
});
```

### After (v0.2.109+)

```js
app.get('/page', async (req, res) => {
  const { render, get_css_for_hashes } = await vite.ssrLoadModule('ripple/server');
  const module = await vite.ssrLoadModule('/pages/index.ripple');
  const Component = module.default;

  const rendered = await render(Component);

  // Extract CSS content
  let componentCss = '';
  if (rendered.css && rendered.css.size > 0) {
    const cssContent = get_css_for_hashes(rendered.css);
    if (cssContent) {
      componentCss = `<style>${cssContent}</style>`;
    }
  }

  let html = template;
  html = html.replace(/<\/head>/i, `${componentCss}\n${rendered.head}\n</head>`);
  html = html.replace(/(<div id="root">)([\s\S]*?)(<\/div>)/i, `$1${rendered.body}$3`);

  res.send(html);
});
```

## Why This Change?

The new CSS registry pattern provides several benefits:

1. **Performance**: CSS is cached globally by hash, avoiding regeneration on each request
2. **Deduplication**: Same component CSS across multiple instances is only sent once
3. **Immutability**: CSS content is immutable per hash, enabling aggressive caching
4. **Memory Efficiency**: Reduced memory usage by storing CSS references instead of full content

## Troubleshooting

### Missing styles after upgrade

**Problem**: Pages render without styles after upgrading to Ripple v0.2.109+

**Solution**: Make sure you're calling `get_css_for_hashes(rendered.css)` and injecting the result into your HTML

### Empty CSS Set

**Problem**: `rendered.css` is empty even though components have `<style>` blocks

**Solution**: Ensure your build pipeline is properly compiling `.ripple` files. The CSS registry is populated during compilation.

### Duplicate CSS

**Problem**: CSS appears multiple times in the rendered HTML

**Solution**: Don't cache the component CSS between requests - always call `get_css_for_hashes()` fresh for each request. The function handles deduplication internally.

## Need Help?

If you encounter issues migrating, please:
1. Check that you're using Ripple v0.2.109 or later
2. Verify your Vite plugin is up to date (`vite-plugin-ripple@0.2.109+`)
3. Review the complete example above
4. Open an issue on the Ripple GitHub repository
