# Fonts embedded in generated PDFs

Noto Sans Regular and Bold (static TTF), SIL Open Font License 1.1 (`OFL.txt`). They cover Spanish (accents, ñ, ¿ ¡) and
the euro sign. Source: npm package `@expo-google-fonts/noto-sans@0.4.2` (files `400Regular/NotoSans_400Regular.ttf` and
`700Bold/NotoSans_700Bold.ttf`, which come from https://github.com/notofonts/latin-greek-cyrillic).

| File | sha256 |
|---|---|
| NotoSans-Regular.ttf | fe8c022f48d8dd29f17b744d16f9346f4357e16f7d4f7be58b000ae7c291b614 |
| NotoSans-Bold.ttf | 13a813c49624ae3ba3c5c6e72c5ebffc4b9e1e6ea32f421c04069b037c6ad431 |

The renderer embeds a subset of the glyphs actually used. The Docker image must copy `apps/api/assets`.
