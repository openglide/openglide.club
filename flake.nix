{
  description = "Go project flake template";
  inputs = {
    ess = {
      url = "github:acaloiaro/ess/v2.18.2";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    devshell.url = "github:numtide/devshell";
    flake-parts.url = "github:hercules-ci/flake-parts";
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    pre-commit-hooks.url = "github:cachix/git-hooks.nix";
    process-compose-flake.url = "github:Platonic-Systems/process-compose-flake";
    services-flake.url = "github:juspay/services-flake";
    systems.url = "github:nix-systems/default";
    templ.url = "github:a-h/templ/v0.3.865";
  };
  outputs = inputs:
    inputs.flake-parts.lib.mkFlake {inherit inputs;} {
      systems = import inputs.systems;
      imports = [
        inputs.devshell.flakeModule
        inputs.process-compose-flake.flakeModule
        inputs.pre-commit-hooks.flakeModule
      ];
      perSystem = {
        self,
        pkgs,
        config,
        lib,
        system,
        ...
      }: {
        pre-commit.settings.hooks = {
          ess = {
            enable = true;
            always_run = true;
            pass_filenames = false;
            name = "env-sample-sync";
            description = "Sync secrets to env.sample";
            entry = "${inputs.ess.packages.${system}.default}/bin/ess";
          };
          nixfmt-rfc-style.enable = true;
        };
        packages.app = pkgs.callPackage ./. {inherit pkgs self;};
        devshells.default = {
          env = [
            # this is a hack, using 'eval', to install pre-commit hooks, since devshell doesn't have shellHook to hook into
            # We don't actually need an env var named PRE_COMMIT
            {
              name = "PRE_COMMIT";
              eval = "${config.pre-commit.installationScript}";
            }
          ];
          commands = [
            {
              help = "Run this project's services (postgres, templ, tailwindcss, app)";
              name = "up";
              command = "nix run";
              category = "development";
            }
            {
              help = "Run the dev application server";
              name = "app";
              command = "go generate ./... && go build -o tmp/openglide && ./tmp/openglide";
              category = "development";
            }
          ];
          packages = with pkgs; [
            go_1_24 # Main app
            go-migrate # Generate db migrations
            inputs.templ.packages.${system}.templ # build go code from templ templates
            postgresql_17 # Just to have psql available (there's no client-only package in nixpkgs)
            reflex # watch files for changes
            sqlc # generate go code from sql files
            tailwindcss_4 # Generate go code from templ templates
            watchman # tailwindcss uses it to watch for changes
          ];
        };

        # Documentation: https://flake.parts/options/process-compose-flake.html
        process-compose."default" = {config, ...}: let
          dbName = "openglide";
        in {
          imports = [
            inputs.services-flake.processComposeModules.default
          ];

          services.postgres."postgres" = {
            enable = true;
            initialDatabases = [{name = dbName;}];
            dataDir = "./.data";
          };

          settings.processes.pgweb = let
            pgcfg = config.services.postgres.postgres;
          in {
            environment.PGWEB_DATABASE_URL = pgcfg.connectionURI {inherit dbName;};
            command = pkgs.pgweb;
            depends_on."postgres".condition = "process_healthy";
          };

          settings.processes.templ = {
            command = ''../templ/result/bin/templ generate --watch-pattern '(.+\.js$)|(.+\.go$)|(.+\.templ$)|(.+_templ\.txt$)|(.+\.css$)' --watch --proxy="http://localhost:3000" -cmd app'';
            depends_on."postgres".condition = "process_healthy";
          };

          settings.processes.tailwindcss = {
            command = ''
              reflex \
               --start-service \
               -r '.*tailwind\.css$|.*\.templ$' \
               --inverse-regex='^\.jj' \
               --inverse-regex='\.devenv' \
               --inverse-regex='\.direnv' \
               --inverse-regex='\.data' \
               -- tailwindcss -i ./css/tailwind.css -o ./static/css/styles.css
            '';
          };
        };
      };
    };
}
