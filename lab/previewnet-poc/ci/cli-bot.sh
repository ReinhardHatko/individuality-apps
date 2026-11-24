#!/usr/bin/env bash
# Copyright 2026 Parity Technologies (UK) Ltd.
# SPDX-License-Identifier: GPL-3.0-or-later

# Two people on the truAPI CLI host play one game of live Previewnet on a CI runner, for
# .github/workflows/jollity-bot.yml: Jollity built from this checkout, each person in a host process of their own.
#
#   cli-bot.sh previewnet game <play time>    Unix seconds, from ci/plan-game.mts
#
# Both people are new: onboard.mts makes each through the network's identity backend, whose attester pays, and keeps
# her phrase in the git-ignored .env beside the lab's config, on this runner only. Nothing here needs a secret. What a
# run leaves behind is two usernames on the live network.
#
# Live Previewnet has no other players, so the two play with each other, or with the people other legs of the same
# run bring into the same game. The camera is the browser's synthetic one. No picture is taken all the same, and the
# artifact is text: reports, the lab's output, and each page's console.
set -euo pipefail
export PREVIEWNET_POC_PICTURES=off PRODUCT_LAB_RECORDINGS=off
unset PRODUCT_LAB_RECORDINGS_VIDEO

network="${1:?network}"; mode="${2:?mode}"; play_time="${3:-}"
out="${OUT:-artifacts/cli-bot}"; mkdir -p "$out"
say() { echo "[cli-bot $(date -u +%H:%M:%S)Z] $*"; }
[[ "$network" == previewnet && "$mode" == game ]] || { echo "The CLI leg plays a game on previewnet; '$mode' on '$network' is not built" >&2; exit 2; }
[[ "$play_time" =~ ^[0-9]{9,11}$ ]] || { echo "A game run needs the game's play time in Unix seconds, got '$play_time'" >&2; exit 2; }
export PREVIEWNET_POC_GAME_TIME="$play_time"
left=$(( play_time - $(date -u +%s) ))
(( left >= 600 )) || { echo "The game is $(( left / 60 )) minutes away: too late for two sign-ups" >&2; exit 2; }
say "the game plays in $(( left / 60 )) minutes"

# What the onboarding says stays on the runner; only its last line, the username and address, is shown.
for person in Ada Bob; do
  say "onboarding $person"
  node --import tsx lab/previewnet-poc/onboard.mts previewnet "$person" > "$RUNNER_TEMP/onboard-$person.log" 2>&1 \
    || { echo "Onboarding $person failed:" >&2; grep -viE "mnemonic|phrase|entropy|polkadotapp://" "$RUNNER_TEMP/onboard-$person.log" | tail -15 | cut -c1-300 >&2; exit 1; }
  grep -E "^Onboarded " "$RUNNER_TEMP/onboard-$person.log" | sed 's/; her phrase is in .*//' | tee -a "$out/onboard.log"
done

status=0
say "lab: two-people-play.feature"
node_modules/.bin/product-lab test lab/previewnet-poc/two-people-play.feature --config lab/previewnet-poc/lab.previewnet-play.config.ts \
  --environment live-previewnet --own-lab --report-dir "$out/report-game" > "$out/lab-game.log" 2>&1 || status=$?
grep -E "^Scenario|^ +[✔✖✓✗–-] |^Result|^ +(passed|failed|skipped)|product-lab test " "$out/lab-game.log" | cut -c1-300 || true

taken=$(find "$out" .product-lab lab/previewnet-poc/.product-lab -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.mp4' -o -name '*.webm' \) 2>/dev/null | wc -l)
say "pictures or videos the run wrote: $taken (expected 0)"
find "$out" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.mp4' -o -name '*.webm' -o -name 'report.html' \) -delete 2>/dev/null || true
mkdir -p "$out/console"; cp .product-lab/previewnet-poc/run-*/console/*.log "$out/console/" 2>/dev/null || true
# Nothing that could hold a phrase leaves the runner.
if grep -rlE "MNEMONIC=|HOST_CLI_SIGNER_MNEMONIC" "$out" > /dev/null 2>&1; then echo "A file of the artifact names a phrase variable with a value: nothing is uploaded" >&2; rm -rf "$out"; mkdir -p "$out"; status=1; fi
say "finished with status $status"
exit "$status"
