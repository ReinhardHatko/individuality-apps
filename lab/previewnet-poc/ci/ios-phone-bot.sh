#!/usr/bin/env bash
# Copyright 2026 Parity Technologies (UK) Ltd.
# SPDX-License-Identifier: GPL-3.0-or-later

# One iOS bot on a CI runner's simulator, for .github/workflows/jollity-bot.yml: creates a simulator, installs the
# Polkadot app's simulator build, starts Appium, onboards a new person in the app, and runs the phone lab as her on
# live Paseo Next V2. The Android twin is android-phone-bot.sh; the lab part is the same.
#
#   ios-phone-bot.sh rehearsal <the .app>               Jollity's permissions and a read of its page; any time of day
#   ios-phone-bot.sh game <the .app> <play time>        the same person signs up for the game that plays at that time
#                                                       (Unix seconds, from ci/plan-game.mts) and plays it
#
# Run from the repository root, on a Mac with Xcode, and with `appium` and its XCUITest driver installed. A game run
# starts its lab 25 minutes before game time: the sign-up needs its minutes of an open registration, and the play step
# waits at most 22 minutes for the game to begin.
#
# No picture is taken and no video recorded: a game's screen shows the faces of the real people in her group, and
# this runs on a machine that is not ours. What it keeps is text only, under $OUT (default artifacts/phone-bot).
# Appium's own log stays on the runner: during a game it holds what the page said, the names of the people in her
# group among it.
#
# Written for the bash a Mac has (3.2).
set -euo pipefail
export PREVIEWNET_POC_PICTURES=off PRODUCT_LAB_RECORDINGS=off
# A pinned game opens when the game before it is done with: product-lab gives a sentence ten minutes unless told otherwise.
export PRODUCT_LAB_STEP_TIMEOUT_MINUTES=45
unset PRODUCT_LAB_RECORDINGS_VIDEO

mode="${1:?rehearsal or game}"; app="${2:?path of the .app}"; play_time="${3:-}"
out="${OUT:-artifacts/phone-bot}"; mkdir -p "$out"
# Pictures are counted from here on and deleted in $out only: on a machine that is not a throwaway runner the lab's
# folders hold other runs' evidence, which is not this script's to remove (24 November 2026: a local trial of the iOS
# script deleted 1343 older screenshots from a shared checkout).
started="$out/.started"; : > "$started"
work="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
config=lab/previewnet-poc/lab.paseo-ios.config.ts
port="${APPIUM_PORT:-4723}"; export APPIUM_URL="http://127.0.0.1:$port"
say() { echo "[phone-bot $(date -u +%H:%M:%S)Z] $*"; }
seconds_to() { echo $(( $1 - $(date -u +%s) )); }
at() { date -u -r "$1" +%H:%M; }

case "$mode" in
  rehearsal) ;;
  game)
    [[ "$play_time" =~ ^[0-9]{9,11}$ ]] || { echo "A game run needs the game's play time in Unix seconds, got '$play_time'" >&2; exit 2; }
    # The lab takes this game and no other, as every other leg of the run does (next-game.ts).
    export PREVIEWNET_POC_GAME_TIME="$play_time"
    left=$(seconds_to "$play_time")
    (( left >= 720 )) || { echo "The $(at "$play_time") UTC game is $(( left / 60 )) minutes away: a game run has to start at least 12 minutes before it" >&2; exit 2; }
    say "the game is at $(at "$play_time") UTC, in $(( left / 60 )) minutes" ;;
  *) echo "Unknown mode '$mode'" >&2; exit 2 ;;
esac
[[ -d "$app" ]] || { echo "No app at '$app'" >&2; exit 2; }
bundle=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")

# A simulator of this run's own, on the newest runtime the machine has.
device="${IOS_DEVICE:-}"
if [[ -z "$device" ]]; then
  types=$(xcrun simctl list devicetypes)
  for wanted in "iPhone 17" "iPhone 16" "iPhone 15"; do
    if echo "$types" | grep -q "^$wanted ("; then device="$wanted"; break; fi
  done
fi
[[ -n "$device" ]] || { echo "This machine has no iPhone 15, 16 or 17 simulator type" >&2; exit 1; }
udid=$(xcrun simctl create "jollity-bot-$$" "$device")
say "simulator $device ($udid)"
appium_pid=""
finish() {
  [[ -n "$appium_pid" ]] && kill "$appium_pid" 2>/dev/null || true
  xcrun simctl shutdown "$udid" 2>/dev/null || true
  xcrun simctl delete "$udid" 2>/dev/null || true
}
trap finish EXIT
# Booted with the Simulator app's window, not headless: Appium's driver restarts a simulator whose window it cannot
# see, and on a runner that restart outlasted its two minutes (GitHub's macos-15, 24 November 2026: "did not finish
# booting within 120000ms").
open -Fgn "$(xcode-select -p)/Applications/Simulator.app" --args -CurrentDeviceUDID "$udid"
xcrun simctl bootstatus "$udid" -b > /dev/null
say "installing $(basename "$app") ($bundle)"
xcrun simctl install "$udid" "$app"

say "starting Appium on port $port"
appium --port "$port" --use-drivers xcuitest > "$work/appium.log" 2>&1 &
appium_pid=$!
for _ in $(seq 1 60); do curl -s -m 2 "$APPIUM_URL/status" > /dev/null && break; sleep 1; done
curl -s -m 5 "$APPIUM_URL/status" > /dev/null || { echo "Appium did not come up:" >&2; tail -20 "$work/appium.log" >&2; exit 1; }

# The first session builds WebDriverAgent, which takes minutes on a runner. The product is opened once at the end,
# so that the lab's own opening does not meet a first fetch.
say "onboarding a new person"
status=0
IOS_BUNDLE_ID="$bundle" OPEN_PRODUCT=dim2.paseo node --import tsx lab/previewnet-poc/onboard-ios.mts "$udid" 2>&1 | tee "$out/onboard.log" || status=$?
if (( status != 0 )); then echo "The onboarding failed; Appium's last lines:" >&2; tail -25 "$work/appium.log" | cut -c1-300 >&2; exit 1; fi
username=$(tail -1 "$out/onboard.log")
[[ "$username" =~ ^[a-z]{6,}\.[0-9]+$ ]] || { echo "The onboarding gave no username" >&2; exit 1; }

run_lab() {
  local name="$1"; shift
  say "lab: $*"
  local result=0
  PRODUCT_LAB_PHONES="Pat=$udid/$username" node_modules/.bin/product-lab test "$@" --config "$config" \
    --environment live-next-v2 --own-lab --report-dir "$out/report-$name" > "$out/lab-$name.log" 2>&1 || result=$?
  grep -E "^Scenario|^ +[✔✖✓✗–-] |^Result|^ +(passed|failed|skipped)|^      |product-lab test " "$out/lab-$name.log" | cut -c1-300 || true
  return "$result"
}

status=0
# The page is read once before any wait, so that a phone that cannot be read fails now and not at game time.
run_lab rehearsal lab/previewnet-poc/phone-permissions.feature lab/previewnet-poc/phone-rehearsal.feature || status=$?
if [[ "$mode" == game ]]; then
  if (( status != 0 )); then say "the rehearsal failed: no game run"
  else
    left=$(seconds_to "$play_time"); wait=$(( left - 1500 ))
    if (( left < 480 )); then say "only $(( left / 60 )) minutes to the game after the setup: too late to sign up"; status=1
    else
      if (( wait > 0 )); then say "waiting $(( wait / 60 )) minutes, to 25 minutes before the game"; sleep "$wait"; fi
      run_lab game lab/previewnet-poc/phone-game.feature || status=$?
    fi
  fi
fi

# Text only leaves the runner: no screenshot, no video, and the reports without their pictures.
taken=$(find "$out" .product-lab lab/previewnet-poc/.product-lab -type f -newer "$started" \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.mp4' -o -name '*.webm' -o -name '*.mov' \) 2>/dev/null | wc -l | tr -d ' ')
say "pictures or videos the run wrote: $taken (expected 0)"
find "$out" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.mp4' -o -name '*.webm' -o -name '*.mov' -o -name 'report.html' \) -delete 2>/dev/null || true
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
say "finished with status $status as $username"
exit "$status"
