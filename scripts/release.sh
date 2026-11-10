#!/bin/bash
# Builds a signed + notarized release and publishes it to GitHub Releases.
#
#   ./scripts/release.sh            uses the version in package.json
#   ./scripts/release.sh 0.3.0      bumps package.json to 0.3.0 first
#
# Uploads the dmg (signed, notarized and stapled here), zip and latest-mac.yml (the file the in-app updater reads).
# Needs the Developer ID identity in the keychain and the notarytool profile named by APPLE_KEYCHAIN_PROFILE (default MongoBrowser).
# Release notes are taken from RELEASE_NOTES.md if present, otherwise from the commits since the last tag.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "${1:-}" ]]; then
  npm version "$1" --no-git-tag-version >/dev/null
fi
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "tag $TAG already exists" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -q -m "v$VERSION"
fi

echo "==> Building $TAG (signed + notarized)..."
env -u ELECTRON_RUN_AS_NODE npm run dist --silent

DMG="release/MongoBrowser-$VERSION-arm64.dmg"
ZIP="release/MongoBrowser-$VERSION-arm64.zip"
YML="release/latest-mac.yml"
for f in "$DMG" "$ZIP" "$YML"; do [[ -f "$f" ]] || { echo "missing $f" >&2; exit 1; }; done

# electron-builder signs and notarizes the app but leaves the dmg untouched (dmg.sign is false, as the
# builder's own dmg signing clashes with notarization). Sign, notarize and staple it here so Gatekeeper
# can verify the disk image itself, then refresh its hash in latest-mac.yml since the bytes changed.
echo "==> Signing and notarizing the dmg..."
IDENTITY="${APPLE_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null \
  | grep -o '"Developer ID Application: [^"]*"' | head -1 | tr -d '"')}"
[[ -n "$IDENTITY" ]] || { echo "No 'Developer ID Application' identity in the keychain" >&2; exit 1; }
codesign --sign "$IDENTITY" --timestamp "$DMG"
xcrun notarytool submit "$DMG" --keychain-profile "${APPLE_KEYCHAIN_PROFILE:-MongoBrowser}" --wait
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG" >/dev/null
node -e '
const fs = require("fs"), crypto = require("crypto"), path = require("path");
const [yml, dmg] = process.argv.slice(1);
const data = fs.readFileSync(dmg);
const sha = crypto.createHash("sha512").update(data).digest("base64");
const re = new RegExp("(url: " + path.basename(dmg).replace(/\./g, "\\.") + "\\n\\s+sha512: )\\S+(\\n\\s+size: )\\d+");
const text = fs.readFileSync(yml, "utf8");
if (!re.test(text)) { console.error("dmg entry not found in " + yml); process.exit(1); }
fs.writeFileSync(yml, text.replace(re, "$1" + sha + "$2" + data.length));
' "$YML" "$DMG"

if [[ -f RELEASE_NOTES.md ]]; then
  NOTES=$(cat RELEASE_NOTES.md)
else
  LAST=$(git describe --tags --abbrev=0 2>/dev/null || true)
  NOTES=$(git log --pretty='- %s' ${LAST:+$LAST..}HEAD | grep -v '^- v[0-9]' || true)
fi

echo "==> Tagging and pushing..."
git tag -a "$TAG" -m "$TAG"
git push -q origin HEAD
git push -q origin "$TAG"

echo "==> Creating GitHub release ${TAG}..."
gh release create "$TAG" "$DMG" "$ZIP" "$YML" --title "MongoBrowser $VERSION" --notes "$NOTES"
echo "==> Done: $(gh release view "$TAG" --json url --jq .url)"
