{
  pkgs,
  frontend,
}:
let
  lib = pkgs.lib;
  metadata = builtins.fromJSON (builtins.readFile ../desktop/package.json);
  electronVersion = metadata.devDependencies.electron;
  checksums = builtins.fromJSON (builtins.readFile ../desktop/electron-checksums.json);
  architecture = if pkgs.stdenv.hostPlatform.isAarch64 then "arm64" else "x64";
  archive = "electron-v${electronVersion}-linux-${architecture}.zip";
  # Reuse Nixpkgs' native library/GTK wrappers with our exact Electron release.
  electron = pkgs.electron_42-bin.overrideAttrs (old: {
    version = electronVersion;
    src = pkgs.fetchurl {
      url = "https://github.com/electron/electron/releases/download/v${electronVersion}/${archive}";
      sha256 = checksums.${archive};
    };
    # Electron 44 ships SwiftShader without the separate libEGL/libGLES files.
    postFixup =
      builtins.replaceStrings
        [ "$out/libexec/electron/lib*GL*" ]
        [ "$out/libexec/electron/libvk_swiftshader.so" ]
        old.postFixup;
  });
in
pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "kairos-desktop";
  version = metadata.version;
  src = lib.cleanSource ../desktop;

  nativeBuildInputs = [
    pkgs.nodejs
    pkgs.pnpm_9
    pkgs.pnpmConfigHook
    pkgs.makeWrapper
  ];
  env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  pnpmDeps = pkgs.fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pkgs.pnpm_9;
    fetcherVersion = 4;
    hash = "sha256-Gwap4KHEU14aiLR3oWQVTOdj53eMFqtchIswjuV3rIo=";
  };

  buildPhase = ''
    runHook preBuild
    pnpm build
    pnpm test
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/kairos $out/share/applications $out/share/icons/hicolor/512x512/apps
    cp -r dist assets *.html *.css kairos.desktop package.json $out/share/kairos/
    cp -r ${frontend} $out/share/kairos/app-dist
    makeWrapper ${electron}/bin/electron $out/bin/kairos \
      --add-flags "$out/share/kairos" \
      --set KAIROS_DESKTOP_LAUNCHER "$out/bin/kairos"
    substitute kairos.desktop $out/share/applications/org.kairos.Kairos.desktop \
      --replace-fail '@LAUNCHER@' "$out/bin/kairos" \
      --replace-fail '@ICON@' 'org.kairos.Kairos'
    cp assets/kairos.png $out/share/icons/hicolor/512x512/apps/org.kairos.Kairos.png
    runHook postInstall
  '';
  meta = {
    description = "Kairos desktop client";
    homepage = metadata.homepage;
    license = lib.licenses.mit;
    mainProgram = "kairos";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
})
