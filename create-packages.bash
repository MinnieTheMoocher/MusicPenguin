#!/usr/bin/env bash
set -euo pipefail

# change into the folder where this script resides
cd "$(dirname "$0")"

./package/deb/create-package-deb.bash
./package/rpm/create-package-rpm.bash
