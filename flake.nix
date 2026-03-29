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
        let
          cfg = config.services.kairos;
          boolString = value: if value then "true" else "false";
          renderedEnv =
            {
              APP_ENV = cfg.settings.appEnv;
              HTTP_ADDR = "${cfg.listenAddress}:${toString cfg.port}";
              KAIROS_DB_PATH = "${cfg.stateDir}/kairos.db";
              SESSION_COOKIE_SECURE = boolString cfg.settings.cookieSecure;
              SESSION_TTL_HOURS = toString cfg.settings.sessionTTLHours;
              AUTH_ENABLED = boolString cfg.settings.authEnabled;
              ALLOW_SIGNUP = boolString cfg.settings.allowSignup;
              BOOTSTRAP_ADMIN = boolString cfg.settings.bootstrapAdmin;
              ENABLE_USER_PROVIDERS = boolString cfg.settings.enableUserProviders;
              ALLOW_USER_CUSTOM_BASE_URL = boolString cfg.settings.allowUserCustomBaseURL;
              ALLOW_USER_DISABLE_SYSTEM_PROVIDER = boolString cfg.settings.allowUserDisableSystemProvider;
              ALLOW_USER_MODEL_SYNC = boolString cfg.settings.allowUserModelSync;
              LOCK_CHAT_MODEL = boolString cfg.settings.lockChatModel;
              SYSTEM_PROVIDER_1_ID = cfg.settings.systemProvider.id;
              SYSTEM_PROVIDER_1_KIND = "openai_compatible";
              SYSTEM_PROVIDER_1_LABEL = cfg.settings.systemProvider.label;
              SYSTEM_PROVIDER_1_ENABLED = boolString cfg.settings.systemProvider.enabled;
              SYSTEM_PROVIDER_1_ALLOW_DISABLE = boolString cfg.settings.systemProvider.allowDisable;
              SYSTEM_PROVIDER_1_MODEL_SYNC = boolString cfg.settings.systemProvider.modelSync;
            }
            // lib.optionalAttrs (cfg.settings.adminEmail != null) {
              ADMIN_EMAIL = cfg.settings.adminEmail;
            }
            // lib.optionalAttrs (cfg.settings.defaultChatModel != null) {
              DEFAULT_CHAT_MODEL = cfg.settings.defaultChatModel;
            }
            // lib.optionalAttrs (cfg.settings.systemProvider.baseURL != null) {
              SYSTEM_PROVIDER_1_BASE_URL = cfg.settings.systemProvider.baseURL;
            }
            // lib.optionalAttrs (cfg.settings.systemProvider.models != [ ]) {
              SYSTEM_PROVIDER_1_MODELS = lib.concatStringsSep "," cfg.settings.systemProvider.models;
            };
        in
        {
          options.services.kairos = {
            enable = lib.mkEnableOption "Kairos service";

            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.system}.default;
              defaultText = lib.literalExpression "self.packages.\${pkgs.system}.default";
              description = "Kairos package to run.";
            };

            port = lib.mkOption {
              type = lib.types.port;
              default = 3456;
              description = "Port for Kairos to listen on.";
            };

            listenAddress = lib.mkOption {
              type = lib.types.str;
              default = "127.0.0.1";
              description = "Address for Kairos to bind to.";
            };

            openFirewall = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "Open the configured Kairos port in the firewall.";
            };

            stateDir = lib.mkOption {
              type = lib.types.str;
              default = "/var/lib/kairos";
              description = "State directory for the Kairos database.";
            };

            environment = lib.mkOption {
              type = lib.types.attrsOf lib.types.str;
              default = { };
              description = "Extra environment variables for the Kairos service.";
            };

            environmentFile = lib.mkOption {
              type = lib.types.nullOr lib.types.path;
              default = null;
              description = "Optional systemd environment file for secrets such as API keys.";
            };

            settings = {
              appEnv = lib.mkOption {
                type = lib.types.str;
                default = "production";
                description = "Value for APP_ENV.";
              };

              cookieSecure = lib.mkOption {
                type = lib.types.bool;
                default = false;
                description = "Whether session cookies should be marked secure.";
              };

              sessionTTLHours = lib.mkOption {
                type = lib.types.int;
                default = 24 * 30;
                description = "Session lifetime in hours.";
              };

              authEnabled = lib.mkOption {
                type = lib.types.bool;
                default = true;
                description = "Whether Kairos authentication is enabled.";
              };

              allowSignup = lib.mkOption {
                type = lib.types.bool;
                default = true;
                description = "Whether user signup is enabled.";
              };

              bootstrapAdmin = lib.mkOption {
                type = lib.types.bool;
                default = false;
                description = "Whether Kairos should bootstrap an admin account.";
              };

              adminEmail = lib.mkOption {
                type = lib.types.nullOr lib.types.str;
                default = null;
                description = "Admin email used when bootstrapAdmin is enabled.";
              };

              enableUserProviders = lib.mkOption {
                type = lib.types.bool;
                default = true;
                description = "Whether users can add their own providers.";
              };

              allowUserCustomBaseURL = lib.mkOption {
                type = lib.types.bool;
                default = true;
                description = "Whether users can set custom provider base URLs.";
              };

              allowUserDisableSystemProvider = lib.mkOption {
                type = lib.types.bool;
                default = true;
                description = "Whether users can disable the system provider.";
              };

              allowUserModelSync = lib.mkOption {
                type = lib.types.bool;
                default = true;
                description = "Whether users can sync provider models.";
              };

              defaultChatModel = lib.mkOption {
                type = lib.types.nullOr lib.types.str;
                default = null;
                description = "Default chat model.";
              };

              lockChatModel = lib.mkOption {
                type = lib.types.bool;
                default = false;
                description = "Whether the default chat model is locked.";
              };

              systemProvider = {
                enabled = lib.mkOption {
                  type = lib.types.bool;
                  default = false;
                  description = "Whether the system provider is enabled.";
                };

                id = lib.mkOption {
                  type = lib.types.str;
                  default = "system-default";
                  description = "System provider identifier.";
                };

                label = lib.mkOption {
                  type = lib.types.str;
                  default = "Server Default";
                  description = "System provider label.";
                };

                baseURL = lib.mkOption {
                  type = lib.types.nullOr lib.types.str;
                  default = null;
                  description = "System provider base URL.";
                };

                models = lib.mkOption {
                  type = lib.types.listOf lib.types.str;
                  default = [ ];
                  description = "Static system provider models.";
                };

                allowDisable = lib.mkOption {
                  type = lib.types.bool;
                  default = true;
                  description = "Whether users can disable the system provider.";
                };

                modelSync = lib.mkOption {
                  type = lib.types.bool;
                  default = true;
                  description = "Whether the system provider can sync models.";
                };
              };
            };
          };

          config = lib.mkIf cfg.enable {
            assertions = [
              {
                assertion = cfg.settings.authEnabled || !cfg.settings.allowSignup;
                message = "services.kairos.settings.allowSignup must be false when auth is disabled.";
              }
              {
                assertion = !cfg.settings.bootstrapAdmin || cfg.settings.adminEmail != null;
                message = "services.kairos.settings.adminEmail is required when bootstrapAdmin is enabled.";
              }
            ];

            users.users.kairos = {
              isSystemUser = true;
              group = "kairos";
              home = cfg.stateDir;
              createHome = true;
              description = "Kairos service user";
            };

            users.groups.kairos = { };

            systemd.tmpfiles.rules = [
              "d ${cfg.stateDir} 0750 kairos kairos -"
            ];

            networking.firewall.allowedTCPPorts = lib.optional cfg.openFirewall cfg.port;

            systemd.services.kairos = {
              description = "Kairos";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" ];

              environment = renderedEnv // cfg.environment;

              serviceConfig = {
                Type = "simple";
                User = "kairos";
                Group = "kairos";
                ExecStart = "${cfg.package}/bin/kairosd";
                Restart = "on-failure";
                RestartSec = "10s";

                NoNewPrivileges = true;
                PrivateTmp = true;
                ProtectSystem = "strict";
                ProtectHome = true;
                ReadWritePaths = [ cfg.stateDir ];
                EnvironmentFile = lib.optional (cfg.environmentFile != null) cfg.environmentFile;
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
