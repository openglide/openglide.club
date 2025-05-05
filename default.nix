{pkgs ? import <nixpkgs> {}, ...}:
pkgs.buildGoModule rec {
  pname = "openglide";
  version = pkgs.lib.strings.removeSuffix "\n" (builtins.readFile ./version.txt);
  src = ./.;
  depsBuildBuild = [
    pkgs.templ
    pkgs.sqlc
    pkgs.tailwindcss
  ];
  vendorHash = null;
  ldflags = [
    "-X 'main.version=${version}-nix'"
  ];
  preBuild = [
    "templ generate"
    "sqlc generate"
    "tailwindcss -i ./css/tailwind.css -o ./static/css/styles.css"
  ];
  env.CGO_ENABLED = 0;

  meta = {
    description = "openglide.club web application";
    homepage = "https://github.com/openglide/openglide";
    license = pkgs.lib.licenses.bsd2;
  };
}
