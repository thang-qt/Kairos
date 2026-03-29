{
  description = "Kairos";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    let
      nixosModule =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        {
          options.services.kairos.enable = lib.mkEnableOption "kairos";

          config = lib.mkIf config.services.kairos.enable {
            systemd.services.kairos = {
              description = "Kairos";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" ];

              serviceConfig = {
                ExecStart = "${self.packages.${pkgs.system}.default}/bin/kairosd";
                Restart = "on-failure";
                DynamicUser = true;
              };
            };
          };
        };
    in
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        lib = pkgs.lib;
        src = lib.cleanSource ./.;
        version =
          if self ? shortRev then
            self.shortRev
          else if self ? rev then
            builtins.substring 0 7 self.rev
          else
            "dirty";
        frontend = pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "kairos-frontend";
          inherit version src;

          nativeBuildInputs = [
            pkgs.nodejs
            pkgs.pnpmConfigHook
            pkgs.pnpm_9
          ];

          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit (finalAttrs)
              pname
              version
              src
              ;
            pnpm = pkgs.pnpm_9;
            fetcherVersion = 3;
            hash = "sha256-8Gg/FMP73+7IlE7mkHsmJ+8gMquZ5wQIM0k+57Z3JvY=";
          };

          buildPhase = ''
            runHook preBuild
            pnpm build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r internal/server/static/. $out/
            runHook postInstall
          '';
        });

        app = pkgs.buildGo124Module {
          pname = "kairos";
          inherit version src;

          vendorHash = "sha256-A2FGgsAxr7w5KG4nBEge4omTUhoHazDGb/VQxdYVb+k=";
          subPackages = [ "./cmd/kairosd" ];

          preBuild = ''
            rm -rf internal/server/static
            mkdir -p internal/server/static
            cp -r ${frontend}/. internal/server/static/
          '';
        };
      in
      {
        packages.default = app;
        packages.kairos = app;

        apps.default = {
          type = "app";
          program = "${app}/bin/kairosd";
        };

        devShells.default = pkgs.mkShell {
          name = "kairos-dev-shell";

          packages = [
            pkgs.go_1_24
            pkgs.nodejs
            pkgs.pnpm_9
            pkgs.git
            pkgs.gopls
            pkgs.air
            pkgs.sqlite
          ];
        };
      }
    )
    // {
      nixosModules.default = nixosModule;
    };
}
