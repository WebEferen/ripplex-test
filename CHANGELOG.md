# Changelog

All notable changes to RippleX will be documented in this file.

## [Unreleased]

### Fixed
- **Breaking Change Compatibility**: Updated server.js to be compatible with Ripple v0.2.109+
  - The `render()` function now returns a `css` Set containing CSS hashes
  - Added `get_css_for_hashes()` import from `ripple/server` to resolve CSS content
  - Component-scoped CSS is now properly inlined in SSR output to prevent FOUC
  - Server-side rendering now correctly handles the new CSS registry system

### Technical Details

The Ripple core framework changed its SSR API to use a CSS registry pattern:

**Before (v0.2.108 and earlier):**
```js
const { render } = await vite.ssrLoadModule('ripple/server');
const rendered = await render(Component);
// rendered.head contained all CSS automatically
```

**After (v0.2.109+):**
```js
const { render, get_css_for_hashes } = await vite.ssrLoadModule('ripple/server');
const rendered = await render(Component);
// rendered.css is a Set of CSS hashes
// Must call get_css_for_hashes(rendered.css) to get CSS content
```

This change improves SSR performance by:
- Deduplicating CSS across components
- Caching CSS content by hash (immutable)
- Reducing memory usage on the server
- Avoiding re-generating the same CSS for each request
