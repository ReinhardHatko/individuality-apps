#!/usr/bin/env bash
# Copyright 2026 Parity Technologies (UK) Ltd.
# SPDX-License-Identifier: GPL-3.0-or-later

# One Android bot on a CI runner's emulator, for .github/workflows/jollity-phone-bot.yml: installs the Polkadot app,
# onboards a new person in it, and runs the phone lab as her on live Paseo Next V2.
#
#   android-phone-bot.sh rehearsal <apk>                 Jollity's permissions and a read of its page; any time of day
#   android-phone-bot.sh game <apk> <play time>          the same person signs up for the game that plays at that time
#                                                        (Unix seconds, from ci/plan-game.mts) and plays it
#
# (A game on a phone is over about three minutes after it begins: Paseo game 364.)
# The emulator is the one the workflow booted (ANDROID_SERIAL, default emulator-5554). Run from the repository root.
# A game run starts its lab 25 minutes before game time: the sign-up needs ten minutes of an open registration, and
# the play step waits at most 22 minutes for the game to begin.
#
# No picture is taken and no video recorded: a game's screen shows the faces of the real people in her group, and
# this runs on a machine that is not ours. The lab's steps and product-lab's own recording are both told so below.
# What it keeps is text only, under $OUT (default artifacts/phone-bot); as a second guard, any picture found at the
# end is deleted and the reports are gone through for embedded ones.
set -euo pipefail
export PREVIEWNET_POC_PICTURES=off PRODUCT_LAB_RECORDINGS=off
# A pinned game opens when the game before it is done with, which can be twenty minutes after the lab starts:
# product-lab gives a sentence ten minutes unless told otherwise.
export PRODUCT_LAB_STEP_TIMEOUT_MINUTES=45
unset PRODUCT_LAB_RECORDINGS_VIDEO

mode="${1:?rehearsal or game}"; apk="${2:?path of the APK}"; play_time="${3:-}"
serial="${ANDROID_SERIAL:-emulator-5554}"
out="${OUT:-artifacts/phone-bot}"; mkdir -p "$out"
config=lab/previewnet-poc/lab.paseo-phone.config.ts
say() { echo "[phone-bot $(date -u +%H:%M:%S)Z] $*"; }

case "$mode" in
  rehearsal) features=(lab/previewnet-poc/phone-permissions.feature lab/previewnet-poc/phone-rehearsal.feature) ;;
  game)
    [[ "$play_time" =~ ^[0-9]{9,11}$ ]] || { echo "A game run needs the game's play time in Unix seconds, got '$play_time'" >&2; exit 2; }
    # The lab takes this game and no other, as every other leg of the run does (next-game.ts).
    export PREVIEWNET_POC_GAME_TIME="$play_time"
    features=(lab/previewnet-poc/phone-game.feature) ;;
  *) echo "Unknown mode '$mode'" >&2; exit 2 ;;
esac

seconds_to() { echo $(( $1 - $(date -u +%s) )); }
at() { date -u -d "@$1" +%H:%M 2>/dev/null || date -u -r "$1" +%H:%M; }
if [[ "$mode" == game ]]; then
  left=$(seconds_to "$play_time")
  # Setting the phone up takes some minutes; with less than 12 to the game the sign-up would run out of its window.
  (( left >= 720 )) || { echo "The $(at "$play_time") UTC game is $(( left / 60 )) minutes away: a game run has to start at least 12 minutes before it" >&2; exit 2; }
  say "the game is at $(at "$play_time") UTC, in $(( left / 60 )) minutes"
fi

# A just-booted emulator answers adb before its package manager does.
for _ in $(seq 1 60); do adb -s "$serial" shell pm path android 2>/dev/null | grep -q "^package:" && break; sleep 2; done
say "installing $(basename "$apk") on $serial"
adb -s "$serial" install -r "$apk" > "$out/install.log" 2>&1 || { tail -5 "$out/install.log"; exit 1; }

say "onboarding a new person"
node --import tsx lab/previewnet-poc/onboard-android.mts "$serial" 2>&1 | tee "$out/onboard.log"
username=$(tail -1 "$out/onboard.log")
[[ "$username" =~ ^[a-z]{6,}\.[0-9]+$ ]] || { echo "The onboarding gave no username" >&2; exit 1; }
package=$(adb -s "$serial" shell pm list packages | tr -d '\r' | sed -n 's/^package:\(io\.parity\.polkadotapp.*\)$/\1/p' | head -1)

# The app's first opening of a product after a cold start can outlast the lab's wait: open it once before the lab does.
say "opening Jollity once as $username"
adb -s "$serial" shell am start -W -a android.intent.action.VIEW -d 'polkadotapp://dim2.paseo' -p "$package" > /dev/null 2>&1 || true
sleep 20

run_lab() {
  local name="$1"; shift
  say "lab: $*"
  local status=0
  PRODUCT_LAB_PHONES="Pat=$serial/$username" node_modules/.bin/product-lab test "$@" --config "$config" \
    --environment live-next-v2 --own-lab --report-dir "$out/report-$name" > "$out/lab-$name.log" 2>&1 || status=$?
  # The steps and their results, for the job's log; the whole output is in the artifact.
  grep -E "^Scenario|^ +[✔✖–-] |^Result|^ +(passed|failed|skipped)|product-lab test " "$out/lab-$name.log" | cut -c1-300 || true
  return "$status"
}

status=0
if [[ "$mode" == game ]]; then
  # The page is read once before the wait, so that a phone that cannot be read fails now and not at game time.
  run_lab rehearsal lab/previewnet-poc/phone-permissions.feature lab/previewnet-poc/phone-rehearsal.feature || { say "the rehearsal failed: no game run"; status=1; }
  if (( status == 0 )); then
    left=$(seconds_to "$play_time"); wait=$(( left - 1500 ))
    (( left >= 480 )) || { say "only $(( left / 60 )) minutes to the game after the setup: too late to sign up"; status=1; }
    if (( status == 0 )); then
      if (( wait > 0 )); then say "waiting $(( wait / 60 )) minutes, to 25 minutes before the game"; sleep "$wait"; fi
      run_lab game "${features[@]}" || status=$?
    fi
  fi
else
  run_lab rehearsal "${features[@]}" || status=$?
fi

# Text only leaves the runner: no screenshot, no video, and the reports without their pictures.
taken=$(find "$out" .product-lab lab/previewnet-poc/.product-lab -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.mp4' -o -name '*.webm' \) 2>/dev/null | wc -l)
say "pictures or videos the run wrote: $taken (expected 0)"
find "$out" .product-lab lab/previewnet-poc/.product-lab -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.mp4' -o -name '*.webm' -o -name 'report.html' \) -delete 2>/dev/null || true
# The report is product-lab-test.json; any JSON a report folder holds is gone through, whatever it is called.
for report in "$out"/report-*/*.json; do
  [[ -f "$report" ]] || continue
  node -e '
    const fs = require("node:fs"), file = process.argv[1];
    let report; try { report = JSON.parse(fs.readFileSync(file, "utf8")); } catch { process.exit(0); }
    let dropped = 0;
    const clean = (value) => {
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index--) {
          const one = value[index];
          if (one && typeof one === "object" && /^(image|video)\//.test(String(one.mime_type ?? one.mimeType ?? one.mediaType ?? ""))) { value.splice(index, 1); dropped++; } else clean(one);
        }
      } else if (value && typeof value === "object") for (const inner of Object.values(value)) clean(inner);
    };
    clean(report);
    if (dropped) fs.writeFileSync(file, JSON.stringify(report));
    console.log(`[phone-bot] ${file.split("/").slice(-2).join("/")}: ${dropped} picture(s) dropped`);
  ' "$report"
done
mkdir -p "$out/console"; cp .product-lab/previewnet-poc/run-*/console/*.log "$out/console/" 2>/dev/null || true
left=$(find "$out" .product-lab lab/previewnet-poc/.product-lab -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.mp4' -o -name '*.webm' \) 2>/dev/null | wc -l)
say "pictures or videos on this runner after the run: $left"
say "finished with status $status as $username"
exit "$status"
