# Good Screen

Record your screen (and camera), then edit the take on a timeline: trim, zoom into what matters, backgrounds and frames, camera layouts, text and keyframes. No AI; everything runs in the browser.

## Running

```bash
npm install
npm run dev
```

Open http://localhost:3001.

## Structure

```
apps/web               Next.js: screen recorder, editor (desktop + mobile), in-browser export
packages/editor-core   Data model, EditCommand, Zustand store (undo/redo)
packages/motion        Remotion composition: screen, zoom, camera, text
packages/ui            Shared design tokens
```

Projects and recordings are stored in the browser's IndexedDB (`goodscreen-state`, `goodscreen-media`), separate from Reels Studio.
