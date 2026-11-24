#!/usr/bin/env bash
# Copyright 2026 Parity Technologies (UK) Ltd.
# SPDX-License-Identifier: GPL-3.0-or-later

# People on the truAPI CLI host play one game of a live network on a CI runner, for
# .github/workflows/jollity-bot.yml: Jollity built from this checkout, each person in a host process of their own.
#
#   cli-bot.sh previewnet game <play time>       two people, who play each other (nobody else plays there)
#   cli-bot.sh paseo-next-v2 game <play time>    one person, in a game real people play
#
# The play time is Unix seconds, from ci/plan-game.mts. The people are new: onboard.mts makes each through the
# network's identity backend, whose attester pays, and keeps her phrase in the git-ignored .env beside the lab's
# config, on this runner only. Nothing here needs a secret. What a run leaves behind is their usernames on the live
# network.
#
# The camera is the browser's synthetic one. No picture is taken all the same, and the artifact is text: reports and
# the lab's output. Each page's console goes with it on Previewnet only: on Paseo Next V2 it names the real people of
# her group and holds network addresses, and a public repository's artifacts are public.
set -euo pipefail
export PREVIEWNET_POC_PICTURES=off PRODUCT_LAB_RECORDINGS=off
# A pinned game opens when the game before it is done with, which can be twenty minutes after the lab starts:
# product-lab gives a sentence ten minutes unless told otherwise.
export PRODUCT_LAB_STEP_TIMEOUT_MINUTES=45
unset PRODUCT_LAB_RECORDINGS_VIDEO

network="${1:?network}"; mode="${2:?mode}"; play_time="${3:-}"
out="${OUT:-artifacts/cli-bot}"; mkdir -p "$out"
# Pictures are counted from here on and deleted in $out only: on a machine that is not a throwaway runner the lab's
# folders hold other runs' evidence, which is not this script's to remove (24 November 2026: a local trial of the iOS
# script deleted 1343 older screenshots from a shared checkout).
started="$out/.started"; : > "$started"
say() { echo "[cli-bot $(date -u +%H:%M:%S)Z] $*"; }
[[ "$mode" == game ]] || { echo "The CLI leg plays a game; '$mode' is not built" >&2; exit 2; }
case "$network" in
  previewnet) people=(Ada Bob); feature=two-people-play.feature; config=lab.previewnet-play.config.ts; environment=live-previewnet ;;
  # The grant the host is handed is the one peopl.paseo publishes; the lab's documented way on this network.
  paseo-next-v2) people=(Ada); feature=paseo-game.feature; config=lab.paseo-play.config.ts; environment=live-next-v2; export PASEO_PLAY_SEED_LIVE_GRANT=1 ;;
  *) echo "Unknown network '$network'" >&2; exit 2 ;;
esac
[[ "$play_time" =~ ^[0-9]{9,11}$ ]] || { echo "A game run needs the game's play time in Unix seconds, got '$play_time'" >&2; exit 2; }
export PREVIEWNET_POC_GAME_TIME="$play_time"
left=$(( play_time - $(date -u +%s) ))
(( left >= 600 )) || { echo "The game is $(( left / 60 )) minutes away: too late for two sign-ups" >&2; exit 2; }
say "the game plays in $(( left / 60 )) minutes"

# What the onboarding says stays on the runner; only its last line, the username and address, is shown.
for person in "${people[@]}"; do
  say "onboarding $person"
  node --import tsx lab/previewnet-poc/onboard.mts "$network" "$person" > "$RUNNER_TEMP/onboard-$person.log" 2>&1 \
    || { echo "Onboarding $person failed:" >&2; grep -viE "mnemonic|phrase|entropy|polkadotapp://" "$RUNNER_TEMP/onboard-$person.log" | tail -15 | cut -c1-300 >&2; exit 1; }
  grep -E "^Onboarded " "$RUNNER_TEMP/onboard-$person.log" | sed 's/; her phrase is in .*//' | tee -a "$out/onboard.log"
done

# The lab starts 25 minutes before the game: its play step waits 22 minutes for a game to begin, and a game that is
# hours away (Paseo Next V2) is open for sign-up long before that.
left=$(( play_time - $(date -u +%s) )); wait=$(( left - 1500 ))
if (( wait > 0 )); then say "waiting $(( wait / 60 )) minutes, to 25 minutes before the game"; sleep "$wait"; fi

status=0
say "lab: $feature"
node_modules/.bin/product-lab test "lab/previewnet-poc/$feature" --config "lab/previewnet-poc/$config" \
  --environment "$environment" --own-lab --report-dir "$out/report-game" > "$out/lab-game.log" 2>&1 || status=$?
grep -E "^Scenario|^ +[✔✖✓✗–-] |^Result|^ +(passed|failed|skipped)|product-lab test " "$out/lab-game.log" | cut -c1-300 || true

taken=$(find "$out" .product-lab lab/previewnet-poc/.product-lab -type f -newer "$started" \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.mp4' -o -name '*.webm' \) 2>/dev/null | wc -l | tr -d ' ')
say "pictures or videos the run wrote: $taken (expected 0)"
find "$out" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.mp4' -o -name '*.webm' -o -name 'report.html' \) -delete 2>/dev/null || true
if [[ "$network" == previewnet ]]; then rm -f "$started"; mkdir -p "$out/console"; cp .product-lab/previewnet-poc/run-*/console/*.log "$out/console/" 2>/dev/null || true; fi
# Nothing that could hold a phrase leaves the runner.
if grep -rlE "MNEMONIC=|HOST_CLI_SIGNER_MNEMONIC" "$out" > /dev/null 2>&1; then echo "A file of the artifact names a phrase variable with a value: nothing is uploaded" >&2; rm -rf "$out"; mkdir -p "$out"; status=1; fi
say "finished with status $status"
exit "$status"
