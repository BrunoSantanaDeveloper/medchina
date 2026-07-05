# Mobile icons (Nexture adapter)

React Native mirror of the web icon contract — same filenames, same `NextureIconsProps` (`variant`, `size`, `strokeWidth`, `oneTone`), plus a `color` prop replacing CSS `currentColor` (pass a theme color, e.g. `useTheme().colors.onSurface`).

Only the icons the app actually uses are ported. To add one:

```bash
# from apps/mobile — ports from apps/web/src/icons/nexture (DOM SVG → react-native-svg)
node scripts/port-icons.mjs ni-bell ni-search
```

Never import an icon library (Phosphor, Lucide, vector-icons) directly in a screen — port through this contract so sets stay swappable per project, like on the web.
