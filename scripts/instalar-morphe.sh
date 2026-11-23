#!/usr/bin/env bash
# Descarga Morphe Desktop y los parches oficiales en bin/ (no se versionan).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
VERSION="${1:-2.3.0}"
echo "Descargando Morphe Desktop $VERSION…"
curl -fL -o bin/morphe-desktop.jar \
  "https://github.com/MorpheApp/morphe-desktop/releases/download/v${VERSION}/morphe-desktop-${VERSION}-all.jar"
echo "Descargando parches oficiales $VERSION…"
curl -fL -o bin/patches.mpp \
  "https://github.com/MorpheApp/morphe-patches/releases/download/v${VERSION}/patches-${VERSION}.mpp"
echo "Listo: bin/morphe-desktop.jar y bin/patches.mpp"
