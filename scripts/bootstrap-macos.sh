#!/bin/sh
# Reproduce the verified macOS tool/dependency set. No chain connections or deployment.
set -eu
cd "$(dirname "$0")/.."
[ "$(uname -s)" = Darwin ] || { echo 'This tested bootstrap supports macOS only.' >&2; exit 1; }
mkdir -p .tools lib
if [ ! -f .tools/solc ]; then
  curl --http1.1 --connect-timeout 15 --max-time 120 -fLsS 'https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/macosx-amd64/solc-macosx-amd64-v0.8.30+commit.73712a01' -o .tools/solc.download
  printf '%s  %s\n' 738dcdc6afddeb505ee4e4ef24f1c1fdba2b8c924e614cbbf5801a5b062dd683 .tools/solc.download | shasum -a 256 -c -
  mv .tools/solc.download .tools/solc
fi
printf '%s  %s\n' 738dcdc6afddeb505ee4e4ef24f1c1fdba2b8c924e614cbbf5801a5b062dd683 .tools/solc | shasum -a 256 -c -
chmod +x .tools/solc
if [ ! -d lib/openzeppelin-contracts ]; then
  git -c http.version=HTTP/1.1 clone --depth 1 --branch v5.4.0 https://github.com/OpenZeppelin/openzeppelin-contracts.git lib/openzeppelin-contracts
fi
if [ ! -d lib/forge-std ]; then
  git -c http.version=HTTP/1.1 clone --depth 1 --branch v1.9.7 https://github.com/foundry-rs/forge-std.git lib/forge-std
fi
[ "$(git -C lib/openzeppelin-contracts rev-parse HEAD)" = c64a1edb67b6e3f4a15cca8909c9482ad33a02b0 ]
[ "$(git -C lib/forge-std rev-parse HEAD)" = 77041d2ce690e692d6e03cc812b57d1ddaa4d505 ]
[ -z "$(git -C lib/openzeppelin-contracts status --porcelain)" ]
[ -z "$(git -C lib/forge-std status --porcelain)" ]
.tools/solc --version
forge_version=$("${FORGE_BIN:-$HOME/.foundry/bin/forge}" --version)
case "$forge_version" in
  *"forge Version: 1.3.1-v1.3.1"*"08d3a4ad4d78b62bcb897350803bf96fc2cf6cc9"*) printf '%s\n' "$forge_version" ;;
  *) echo 'Expected pinned Foundry 1.3.1 commit; refusing version drift.' >&2; exit 1 ;;
esac
