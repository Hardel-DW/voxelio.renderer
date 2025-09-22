## voxelio.renderer

Render 128×128 PNG icons for every Minecraft item id using deepslate (misode).
Sources: Mojang auto-generated assets (atlas, item components, item/item/block definitions) mirrored by `misode/mcmeta`.

### Requirements
- Node.js 18+
- pnpm or npm

### Install and Use.
```bash
npm i
npm run render
```

- Writes PNGs to `output/` (git-ignored)
- One file per id, e.g. `output/diamond_sword.png`

### How it works
- Fetches registries, atlas JSON/PNG, item components, and definitions from `misode/mcmeta`
- Builds a texture atlas and renders via `deepslate` `ItemRenderer` with headless `gl` and `@napi-rs/canvas`
- Script: `src/render-items.ts`; output: `output/`

### Notes
- Output size is fixed at 128×128
- Items without a model are skipped; existing outputs are not overwritten
- Cross‑platform; no GPU required

### License
ISC

Note:
- Copper Golem Status" Special Model isn't supported. So it will be added with "hardcoded" folder.
- Player Head Special Model isn't supported. So it will be added with "hardcoded" folder.
- Air Is excluded from the output.