# Good Screen

Rekam layar (dan kamera), lalu edit hasilnya di timeline: potong, zoom ke area penting, latar dan bingkai, layout kamera, teks, serta keyframe. Tanpa AI; semua berjalan di browser.

## Menjalankan

```bash
npm install
npm run dev
```

Buka http://localhost:3001.

## Struktur

```
apps/web               Next.js: perekam layar, editor (desktop + mobile), ekspor di browser
packages/editor-core   Model data, EditCommand, store Zustand (undo/redo)
packages/motion        Komposisi Remotion: layar, zoom, kamera, teks
packages/ui            Token desain bersama
```

Proyek dan file rekaman disimpan di IndexedDB browser (`goodscreen-state`, `goodscreen-media`), terpisah dari Reels Studio.
