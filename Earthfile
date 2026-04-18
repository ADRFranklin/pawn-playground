VERSION 0.8

compiler-src:
    FROM alpine:3.22
    RUN apk add --no-cache git patch curl

    ARG COMPILER_COMMIT=bca794a1bc17c6bcb60c1fd0360b4daaff63d50a
    RUN mkdir -p /tmp/omp-compiler \
        && curl -fsSL \
            "https://github.com/openmultiplayer/compiler/archive/${COMPILER_COMMIT}.tar.gz" \
            | tar -xz -C /tmp/omp-compiler --strip-components=1 \
        && mv /tmp/omp-compiler /compiler

    COPY patches/ /patches/
    RUN patch /compiler/source/compiler/sc.h              < /patches/0001-ppg-macro-output-sc.h.patch \
        && patch /compiler/source/compiler/scvars.c       < /patches/0002-ppg-macro-output-scvars.c.patch \
        && patch /compiler/source/compiler/sc1.c          < /patches/0003-ppg-macro-output-sc1.c.patch \
        && patch /compiler/source/compiler/sc2.c          < /patches/0004-ppg-macro-output-sc2.c.patch \
        && patch /compiler/source/compiler/sc4.c          < /patches/0005-ppg-asm-include-file-sc4.c.patch \
        && patch /compiler/source/compiler/CMakeLists.txt < /patches/0006-wasm-build-CMakeLists.txt.patch \
        && patch /compiler/source/amx/amx.c               < /patches/0007-amx-no-computed-goto-amx.c.patch \
        && patch /compiler/source/amx/amxcons.h           < /patches/0008-amx-tchar-compat-amxcons.h.patch \
        && patch /compiler/source/amx/amxcore.c           < /patches/0009-amx-stricmp-posix-amxcore.c.patch \
        && printf '' > /tmp/empty \
        && patch /tmp/empty --output=/compiler/source/compiler/wasm_entry.c \
               < /patches/0010-new-file-wasm_entry.c.patch \
        && patch /tmp/empty --output=/compiler/source/amx/amx_entry.c \
               < /patches/0011-new-file-amx_entry.c.patch

    ARG OMP_STDLIB_COMMIT=91edd2f03eb48dac50223d862abd812677356047
    RUN mkdir -p /tmp/omp-stdlib /compiler/source/compiler/include \
        && curl -fsSL \
            "https://github.com/openmultiplayer/omp-stdlib/archive/${OMP_STDLIB_COMMIT}.tar.gz" \
            | tar -xz -C /tmp/omp-stdlib --strip-components=1 \
        && cp /tmp/omp-stdlib/*.inc /compiler/source/compiler/include/ \
        && rm -rf /tmp/omp-stdlib

    SAVE ARTIFACT /compiler /compiler

compiler-wasm:
    FROM emscripten/emsdk:latest

    COPY +compiler-src/compiler /compiler
    RUN mkdir -p /compiler/wasm-build \
        && emcmake cmake -S /compiler/source/compiler -B /compiler/wasm-build \
            -DCMAKE_BUILD_TYPE=Release \
            -DBUILD_TESTING=OFF \
            -DEMSCRIPTEN=1 \
        && emmake make -C /compiler/wasm-build -j$(nproc) pawncc_wasm pawnrun_wasm

    RUN mkdir -p /wasm-out \
        && cp /compiler/wasm-build/pawncc.js \
              /compiler/wasm-build/pawncc.wasm \
              /compiler/wasm-build/pawncc.data \
              /compiler/wasm-build/pawnrun.js \
              /compiler/wasm-build/pawnrun.wasm \
              /wasm-out/

    SAVE ARTIFACT /wasm-out /wasm AS LOCAL web/wasm

test:
    FROM golang:1.26-alpine
    RUN apk add --no-cache gcc musl-dev

    WORKDIR /build
    COPY go.mod go.sum ./
    RUN go mod download

    COPY . .
    RUN go vet ./...
    RUN CGO_ENABLED=1 go test -race -timeout 30s ./...

server:
    FROM golang:1.26-alpine
    RUN apk add --no-cache git

    WORKDIR /build
    COPY go.mod go.sum ./
    RUN go mod download

    COPY . .
    COPY +compiler-wasm/wasm web/wasm

    RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /server ./cmd/server/

    SAVE ARTIFACT /server /server AS LOCAL server

docker:
    FROM alpine:3.22
    ARG TAG=latest

    RUN addgroup -S pawnpg && adduser -S -G pawnpg pawnpg

    WORKDIR /app
    COPY +server/server /app/server

    RUN mkdir -p /data && chown pawnpg:pawnpg /data

    USER pawnpg
    EXPOSE 7070

    HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
        CMD wget -qO- http://localhost:7070/ > /dev/null || exit 1

    SAVE IMAGE --push ghcr.io/adrfranklin/pawn-playground:$TAG
