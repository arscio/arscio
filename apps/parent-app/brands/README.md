# Parent app brands

One code base, many possible apps.

- **`aiedu/`** (default): the "AIEdu Parent" app with the gold icon. Serves every school; after login the app
  shows the child's school name, logo and colour.
- **A school's own app (later)**: copy `aiedu/` to e.g. `gvps/`, put the school's icon, splash and name in it,
  give it its own store IDs, and set `lockToSchoolId` to that school's ID so only that school appears.
  Build it with `APP_BRAND=gvps`.

| File | What it is |
|---|---|
| `brand.json` | App name, store IDs, colours, optional school lock |
| `icon.png` | 1024x1024 store icon |
| `android-foreground.png`, `android-background.png`, `android-monochrome.png` | Android adaptive icon (432x432) |
| `splash.png` | Shown while the app opens |
| `favicon.png` | Used when the app is opened in a web browser for testing |
