#!/usr/bin/env bash
set -euo pipefail
# Match the x86_64 Ubuntu runner; reject unsupported hosts explicitly.
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]]
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends poppler-utils fontconfig fonts-liberation fonts-dejavu-core python3
ci_tools="$RUNNER_TEMP/stratum-publishing-tools"
mkdir -p "$ci_tools/bin"
curl --fail --location --retry 3 --max-time 120 \
  'https://github.com/jgm/pandoc/releases/download/3.12/pandoc-3.12-linux-amd64.tar.gz' \
  --output "$ci_tools/pandoc.tar.gz"
echo "67d7d011fed8c8543306022b985b9b2499ab9b74818df91d8727c7e9ebc5ba06  $ci_tools/pandoc.tar.gz" | sha256sum --check
tar -xzf "$ci_tools/pandoc.tar.gz" -C "$ci_tools"
cp "$ci_tools/pandoc-3.12/bin/pandoc" "$ci_tools/bin/pandoc"
curl --fail --location --retry 3 --max-time 120 \
  'https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.17.0/tectonic-0.17.0-x86_64-unknown-linux-musl.tar.gz' \
  --output "$ci_tools/tectonic.tar.gz"
echo "8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7  $ci_tools/tectonic.tar.gz" | sha256sum --check
tar -xzf "$ci_tools/tectonic.tar.gz" -C "$ci_tools/bin"
chmod +x "$ci_tools/bin/pandoc" "$ci_tools/bin/tectonic"
echo "$ci_tools/bin" >> "$GITHUB_PATH"
{
  echo "STRATUM_TEST_PANDOC=$ci_tools/bin/pandoc"
  echo "STRATUM_TEST_TECTONIC=$ci_tools/bin/tectonic"
  echo "STRATUM_TEST_PDFTOTEXT=$(command -v pdftotext)"
  echo "STRATUM_TEST_CHROME=$TEST_CHROME_PATH"
  echo 'STRATUM_REQUIRE_PUBLISHING_TOOLS=1'
} >> "$GITHUB_ENV"
