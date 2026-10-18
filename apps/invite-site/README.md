# Budgie invite site

Static files for invite links (`https://dinagur11.github.io/join#token=…`), published with GitHub Pages as the
**`dinagur11/dinagur11.github.io`** repository (a user site: App Links need `/.well-known/assetlinks.json` at the
domain root, which a project site such as `dinagur11.github.io/budgie` can't serve).

- `join/index.html`: shown only when the app didn't open the link. It tries to open the app (`budgie://join?token=…`
  through an Android intent) and falls back to the Play Store listing. The token stays in the fragment, so it never
  reaches GitHub's servers. No scripts or styles from elsewhere, no analytics.
- `.well-known/assetlinks.json`: lets Android verify the link and open it in the app directly. It lists the SHA-256
  fingerprint of each key that signs the app. Today only the debug keystore (`apps/mobile/android/app/debug.keystore`,
  the React Native default). When the app goes on Google Play, add the **app signing key** fingerprint from Play
  Console > Test and release > App integrity (and the upload key's, if you install builds signed with it).
- `.nojekyll`: without it GitHub Pages (Jekyll) skips the `.well-known` folder.

Publishing: copy this folder's contents (including the dot files) into the root of the `dinagur11.github.io`
repository, push, and enable Pages for the `main` branch. Check
`https://dinagur11.github.io/.well-known/assetlinks.json` loads. After installing a new build, check verification with
`adb shell pm get-app-links com.budgie.mobile` (the domain should be `verified`).
