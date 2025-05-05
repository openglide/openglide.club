# Nix builder
FROM nixos/nix:latest AS builder

# Copy our source and setup our working dir.
COPY . /tmp/build
WORKDIR /tmp/build

# Build our Nix environment
RUN nix \
    --extra-experimental-features "nix-command flakes" \
    build .#app 

# Copy the Nix store closure into a directory. The Nix store closure is the
# entire set of Nix store values that we need for our build.
RUN mkdir /tmp/nix-store-closure
RUN cp -R $(nix-store -qR result/) /tmp/nix-store-closure
RUN ls /tmp/build/result

# the application image is derived from 'scratch'.
# We copy a self-contained nix store into scratch, which contains all of our project's dependencies
FROM scratch

WORKDIR /app
COPY --from=builder /tmp/nix-store-closure /nix/store
COPY --from=builder /tmp/build/result /app

EXPOSE 3000
CMD ["/app/bin/openglide.club"]
