# Publishing Android releases

## Local toolchain

Use `nix develop .#android` for Android work. This shell provides JDK 17,
Android SDK 35, build-tools 35.0.0, adb, Node, and pnpm, and sets `JAVA_HOME`,
`ANDROID_HOME`, `ANDROID_SDK_ROOT`, and a checkout-local Gradle cache.
The default `nix develop` / `.envrc` shell is for web and Go development.
Use the checked-in `./gradlew` wrapper for builds. For example, from the
repository root:

```sh
nix develop .#android --command bash -c 'cd android && ./gradlew --no-daemon assembleRelease testReleaseUnitTest lintRelease'
```

## Release identity

The package is `org.kairos.android`. The version is defined in
`android/app/build.gradle.kts`: increase `versionCode` for **every** release and
set `versionName` to the public version. Never reuse a published version code.
Tags use `android-v<versionName>`; desktop releases use separate `desktop-v` tags.

## One-time signing setup

Generate a dedicated release key on a trusted computer (keep passwords out of
shell history):

```sh
keytool -genkeypair -keystore kairos-release.jks -alias kairos -keyalg RSA -keysize 4096 -validity 10000
keytool -exportcert -keystore kairos-release.jks -alias kairos | sha256sum
```

Back up the keystore and passwords offline. Losing this key prevents updates to
installed GitHub builds. Never commit it. Configure these repository Actions
secrets:

- `ANDROID_RELEASE_KEYSTORE_BASE64`: base64 of the keystore file.
- `ANDROID_RELEASE_STORE_PASSWORD`: keystore password.
- `ANDROID_RELEASE_KEY_ALIAS`: `kairos` (or your chosen alias).
- `ANDROID_RELEASE_KEY_PASSWORD`: key password.

Set repository Actions variable `ANDROID_RELEASE_CERT_SHA256` to the lowercase
SHA-256 digest from the command above, without spaces or colons. The workflow
verifies the APK certificate against this independently configured fingerprint.
Only trusted maintainers should be able to push release tags or edit workflows.

## Release procedure

1. Increase both version fields and review the changes since the previous tag.
2. Run `pnpm check`, then `cd android && ./gradlew testReleaseUnitTest lintRelease assembleRelease`.
   Without signing environment variables this produces an unsigned APK, suitable
   for source-build verification. Gradle builds the shared transcript automatically.
3. Commit and push the version change. Push the matching tag, for example
   `git tag android-v0.2.2` followed by `git push origin android-v0.2.2`.
4. The Android release workflow checks the tag, runs checks, builds and verifies
   a signed universal APK, and creates a **draft** GitHub release with checksums
   and the signing certificate fingerprint.
5. Download the draft APK, test a fresh install and an update from the previous
   release on a device, inspect release notes, then publish the draft. Mark
   experimental releases as prereleases before publishing.

Existing debug installations use a different certificate and cannot be upgraded
with the release APK. Export anything needed before uninstalling a debug build.
Do not use the debug key for public releases.

## Obtainium

There is no separate APK upload to Obtainium. After publishing a GitHub release,
add `https://github.com/thang-qt/Kairos` as a GitHub source in Obtainium. Set the
release-title filter to `^Kairos Android ` to exclude desktop releases, and the
APK filter to `^kairos-.*\.apk$`. Enable prereleases only if desired. Verify that
Obtainium selects the Android tag and the intended APK before installing.

See [Obtainium source settings](https://wiki.obtainium.imranr.dev/sources/).

## F-Droid

F-Droid inclusion is a separate review, not an upload performed by this workflow.
See the [submission guide](https://f-droid.org/en/docs/Submitting_to_F-Droid_Quick_Start_Guide/)
and [inclusion policy](https://f-droid.org/en/docs/Inclusion_Policy/).

The repository includes English store descriptions under
`fastlane/metadata/android/en-US`. Add phone screenshots and release changelogs
(`changelogs/<versionCode>.txt`) there as releases are prepared.

Before submitting a merge request to `fdroiddata`:

- Audit all Android and bundled JavaScript dependencies and assets for compatible
  free-software licenses; provide source and attribution where required.
- Prepare and test an `org.kairos.android.yml` source-build recipe against a
  published Android tag. The recipe must provision JDK 17, SDK 35/build-tools
  35.0.0, Node 22, and pnpm 9.15.4; install the frozen root pnpm lockfile before
  running the `release` Gradle build in `android`. The transcript is built from
  source by `generateTranscript`; do not substitute prebuilt web assets.
- Account for F-Droid's offline build environment: fetching pnpm packages during
  the Gradle build is not sufficient. Agree on allowed dependency preparation
  with reviewers and prove the complete build in the F-Droid build environment.
- Configure Android-only tag tracking (`android-v…`), version-code detection,
  metadata, and any anti-features reviewers require for server/provider usage.
- Decide signing before launch. Standard F-Droid signing and GitHub signing use
  different certificates, so users cannot update between them. To distribute
  the same upstream signature, work with F-Droid on verified reproducible builds
  and an upstream binary URL; do not claim reproducibility until independently
  reproduced. See [reproducible builds](https://f-droid.org/docs/Reproducible_Builds/).

No F-Droid recipe or acceptance is claimed yet: the mixed Gradle/pnpm offline
build and signing compatibility still need validation with F-Droid tooling.
