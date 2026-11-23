// Copyright 2026 Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

// Onboards the Polkadot app on an Android emulator as a NEW person, so that a lab can start on a device nobody set up
// by hand: a CI runner's emulator, or a new AVD on this machine. product-lab's Android host never onboards a phone;
// its person is whoever the app holds, and this makes her.
//
//   node --import tsx lab/previewnet-poc/onboard-android.mts <serial> [username base]
//
// It walks the app's own first-run screens as a person does, with adb alone: the theme, the username (the base, six or
// more lowercase letters, to which the app adds digits), the notification sheet, and the welcome. It prints the
// claimed username on its last line and, in a GitHub job, sets the step output `username`. The lab takes it as
//   PRODUCT_LAB_PHONES=Pat=<serial>/<username>
//
// What it leaves behind: a username on the app's live network (the nightly build's is Paseo Next V2), which cannot be
// taken back, and the key that owns it in the emulator's data, which is gone when the emulator is. It sends no funds
// and holds no secret. The app registers through the network's identity backend, which on Android asks Play Integrity:
// the emulator needs a Play Store system image.
//
// Written against the nightly of 22 November 2026 from what its screens show (the ids `username_input`,
// `digits_input`, `username_submit_button` and the screens' own words); a build that renames them fails here by name.
// That build puts a new person in a short queue ("Your position") after the username and lets her through by itself.
// A build that shows the Web3 Summit check-in instead needs a volunteer's account to pass, which this script does
// not hold: it stops there and says so.
//
// Two other scripts onboard this app, both in private repositories and neither copied here: triangle-e2e's (its CI's,
// with a volunteer check-in) and Coffer's (local emulators). Read beside this one on 23 November 2026, they added what
// a slow CI emulator needs and a local one never showed: text typed a character at a time, the compressed screen
// dump, the stylus tip, another app's "isn't responding" dialog, the tip that hides the tabs, the network check
// before the app starts, and the identity backend's word that the name is assigned.
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

type Node = { text: string; id: string; rawId: string; enabled: boolean; x: number; y: number };

/** Where a network's identity backend lists usernames, by the build that is on it. */
const IDENTITY_SEARCH: Readonly<Record<string, string>> = {
  'io.parity.polkadotapp.nightly': 'https://identity.dotspark.app/api/v1/usernames/search?prefix=',
  'io.parity.polkadotapp.debug': 'https://previewnet.substrate.dev/dub/api/v1/usernames/search?prefix=',
};

const [serial, given] = process.argv.slice(2);
if (!serial) { console.error('usage: onboard-android.mts <serial> [username base]'); process.exit(2); }
const letters = (count: number) => Array.from({ length: count }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
const base = given ?? `jolci${letters(6)}`;
if (!/^[a-z]{6,}$/.test(base)) { console.error(`The username base must be six or more lowercase letters, got ${JSON.stringify(base)}`); process.exit(2); }

const say = (line: string) => console.log(`[onboard ${serial}] ${line}`);
const adb = (args: string[], timeoutMs = 30_000) => new Promise<string>((resolve, reject) =>
  execFile('adb', ['-s', serial, ...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, out, err) => error ? reject(Error(`adb ${args.slice(0, 4).join(' ')}: ${String(err || error.message).trim().slice(0, 300)}`)) : resolve(out)));
const shell = (command: string, timeoutMs?: number) => adb(['shell', command], timeoutMs);

/** What is on the screen, as the accessibility tree says it: each node's words, id and middle. Empty while the tree
 *  is not there yet (a starting app, a window in between). */
async function screen(): Promise<Node[]> {
  // Compressed: the full dump is killed for memory on an emulator whose app and WebView already fill it.
  const xml = await adb(['exec-out', 'uiautomator', 'dump', '--compressed', '/dev/tty'], 20_000).catch(() => '');
  const nodes: Node[] = [];
  for (const [tag] of xml.matchAll(/<node [^>]*>/g)) {
    const read = (name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1] ?? '';
    const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(read('bounds'));
    if (!bounds) continue;
    const text = read('text').replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"');
    nodes.push({ text, id: read('resource-id').replace(/^.*:id\//, ''), rawId: read('resource-id'), enabled: read('enabled') !== 'false',
      x: Math.round((Number(bounds[1]) + Number(bounds[3])) / 2), y: Math.round((Number(bounds[2]) + Number(bounds[4])) / 2) });
  }
  return nodes;
}
const tap = (node: Node) => shell(`input tap ${node.x} ${node.y}`);

/** The app's package: one Polkadot app is installed on a device this script is for. */
async function appPackage() {
  const found = (await shell('pm list packages')).split('\n').map(line => line.trim().replace(/^package:/, '')).filter(name => /^io\.parity\.polkadotapp/.test(name));
  if (found.length !== 1) throw Error(`Expected one Polkadot app on ${serial}, found ${found.length ? found.join(', ') : 'none'}`);
  return found[0]!;
}

/** The device is online: a new emulator's Wi-Fi can still be coming up, and the app's first screens need the network. */
async function network() {
  await shell('svc wifi enable').catch(() => '');
  for (const end = Date.now() + 60_000; Date.now() < end; await delay(2_000)) {
    const active = /Active default network: (\S+)/.exec(await shell('dumpsys connectivity').catch(() => ''))?.[1];
    if (active && active !== 'none') return;
  }
  throw Error('The device has no network after a minute');
}

/** What the app's own log says of its calls to the identity backend: each answer's status and path, and no more
 *  (no header, no query, no body). A sign-up that stalls is the backend's or the app's, and this line tells which. */
async function identityCalls() {
  const log = await adb(['logcat', '-d', '-t', '6000', '-s', 'OkHttp:*'], 20_000).catch(() => '');
  const calls = [...new Set([...log.matchAll(/<-- (\d{3}) https:\/\/([^\s?]*\/api\/v1\/[^\s?]*)/g)].map(found => `${found[1]} ${found[2]}`))];
  const failed = [...new Set([...log.matchAll(/<-- HTTP FAILED: ([^\n]{0,100})/g)].map(found => found[1]!))];
  return calls.length || failed.length ? `identity backend calls in the app's log: ${calls.join(' | ') || 'none'}${failed.length ? `; failed: ${failed.join(' | ')}` : ''}` : "the app's log shows no identity backend call";
}

/** The identity backend lists the name as assigned: it is registered on chain, and she can sign up for a game. A
 *  backend that does not answer in JSON is said and passed over; one that answers and never assigns the name fails. */
async function assigned(app: string, username: string) {
  const search = process.env.IDENTITY_SEARCH_URL ?? IDENTITY_SEARCH[app];
  if (!search) { say(`no identity backend known for ${app}: the name's registration is not checked`); return; }
  let last = 'no answer', answered = false;
  for (const end = Date.now() + 180_000; Date.now() < end; await delay(5_000)) {
    try {
      const answer = await fetch(`${search}${username.split('.')[0]}`, { signal: AbortSignal.timeout(15_000) });
      const listed = ((await answer.json()) as { usernames?: { username: string; status?: string }[] }).usernames ?? [];
      answered = true;
      const found = listed.find(one => one.username === username);
      last = found ? `status ${found.status}` : 'not listed yet';
      if (found?.status === 'ASSIGNED') { say(`${username} is ASSIGNED`); return; }
    } catch (error) { last = `unreadable: ${String(error).slice(0, 120)}`; }
  }
  if (!answered) { say(`the identity backend gave no readable answer (${last}): the name's registration is not checked`); return; }
  throw Error(`${username} is not ASSIGNED on the identity backend after three minutes (${last})`);
}

async function onboard() {
  const app = await appPackage(), deadline = Date.now() + 8 * 60_000;
  const launch = () => shell(`monkey -p ${app} -c android.intent.category.LAUNCHER 1`);
  await network();
  // Two things of a Play Store image take the keys meant for the app: the Google search box, and the stylus tip that
  // comes up over the first text field.
  for (const overlay of ['com.google.android.googlequicksearchbox', 'com.google.android.apps.search']) await shell(`pm disable-user --user 0 ${overlay}`).catch(() => '');
  await shell('settings put secure stylus_handwriting_enabled 0').catch(() => '');
  const size = /(\d+)x(\d+)/.exec(await shell('wm size').catch(() => '')), width = Number(size?.[1] ?? 1080), height = Number(size?.[2] ?? 2400);
  await launch();
  say(`opened ${app}; the username base is ${base}`);
  let typed = false, username: string | undefined, last = '', onTabs = 0, atCheckIn = 0, typings = 0;
  // The field emptied, key by key: what a mistyped or half-typed base leaves must not become her name.
  const clear = async (length: number) => { await shell('input keyevent 123'); for (let key = 0; key < length + 2; key++) await shell('input keyevent 67'); };
  while (Date.now() < deadline) {
    // Google's sign-in sheet comes up over the app after the username (a Play build offers a backup): a person without
    // a Google account leaves it, and the app goes on without one.
    const focus = await shell('dumpsys window | grep mCurrentFocus').catch(() => '');
    if (focus.includes('com.google.android.gms')) { say("Google's sign-in sheet: back"); await shell('input keyevent 4'); await delay(2_000); if ((await shell('dumpsys window | grep mCurrentFocus').catch(() => '')).includes('com.google.android.gms')) { await shell('input keyevent 3'); await delay(1_000); await launch(); } await delay(2_000); continue; }
    const nodes = await screen(), words = (text: string) => nodes.find(node => node.text === text), has = (part: string) => nodes.find(node => node.text.includes(part));
    const seen = nodes.map(node => node.text).filter(Boolean).slice(0, 12).join(' | ');
    if (seen && seen !== last) say(`screen: ${(last = seen).slice(0, 220)}`);
    if (username && words('Chats')) { say('the app is on its tabs'); return { app, username }; }
    // Its tabs before any username was typed: the app has a person already. Seen three times in a row, since a
    // notification over the screen leaves little else in the tree to tell by.
    onTabs = !typed && words('Chats') && !nodes.some(node => node.id === 'username_input') ? onTabs + 1 : 0;
    if (onTabs >= 3) throw Error('The app is already onboarded: this script is for an app that has no person yet (clear its data to make a new one, which loses the old one)');
    // "<app> isn't responding": the app's own gets Wait, another's (the launcher on a loaded emulator) is closed.
    const stuck = nodes.find(node => node.rawId === 'android:id/alertTitle' && /isn[’']t responding/.test(node.text));
    if (stuck) { const button = nodes.find(node => node.rawId === (/polkadot/i.test(stuck.text) ? 'android:id/aerr_wait' : 'android:id/aerr_close')); if (button) { say(`"${stuck.text}"`); await tap(button); } await delay(2_000); continue; }
    if (has('Try out your stylus') && words('Cancel')) { await tap(words('Cancel')!); typed = false; await delay(500); continue; }
    // The check-in gate is refused only when it stays and offers no way past it: a build with the debug skip goes on below.
    atCheckIn = has('Check in at Web3 Summit') && !words('(Debug) Skip verification') ? atCheckIn + 1 : 0;
    if (atCheckIn >= 3) throw Error("This build asks for the Web3 Summit check-in after the username, which only a volunteer's account can give: this script holds none");
    // The first-run tip over the tabs hides them from the tree; it goes away on a tap outside it, at the top.
    if (has('Use this button to add contacts')) { say('tip over the tabs: tapped away'); await shell(`input tap ${Math.round(width / 2)} ${Math.round(height * 0.09)}`); await delay(1_500); continue; }
    if (words('Data is paused') && words('OK')) { await tap(words('OK')!); await delay(1_000); continue; }
    if (words('Claim your interface') && words('Continue')) { say('theme: Continue'); await tap(words('Continue')!); await delay(2_000); continue; }
    if (has("Google Play services aren't available")) throw Error('The app says Google Play services are not available: the emulator needs a Play Store system image');
    const input = nodes.find(node => node.id === 'username_input');
    if (input && !typed) {
      if (++typings > 3) throw Error(`The username field did not take the base in three tries; it shows ${JSON.stringify(input.text)}`);
      await tap(input); await delay(800);
      if (typings > 1) await clear(base.length * 2);
      // A letter at a time: one `input text` call for the whole word has doubled its first letter on a CI image.
      for (const letter of base) await shell(`input text ${letter}`);
      typed = true; say('typed the base'); await shell('input keyevent 111'); await delay(3_000); continue;
    }
    if (input && typed && !username) {
      const submit = nodes.find(node => node.id === 'username_submit_button');
      if (words("It's yours!") && submit?.enabled) {
        // The name she gets is what the field holds, not what was sent to it: claim only the base itself.
        if (!words(base)) { say(`the field does not show the base (${JSON.stringify(input.text)}): typing it again`); typed = false; continue; }
        username = `${base}.${nodes.find(node => node.id === 'digits_input')?.text || '01'}`;
        await tap(submit); say(`claimed ${username}`); await delay(4_000); continue;
      }
      await delay(1_500); continue;
    }
    // After the username: the notification sheet, a verification gate where a build shows one, the welcome.
    const allow = words('Allow');
    if (has('send you notifications') && allow) { await tap(allow); await delay(1_500); continue; }
    const on = words('(Debug) Skip verification') ?? has('Start using the Polkadot App');
    if (on) { say(`tapped "${on.text.slice(0, 40)}"`); await tap(on); await delay(2_000); continue; }
    await delay(2_000);
  }
  throw Error(`${username ? `Claimed ${username}, but the app did not reach its tabs in eight minutes` : 'The app did not claim a username in eight minutes'}; last screen: ${last.slice(0, 300) || 'nothing readable'}; ${await identityCalls()}`);
}

try {
  const { app, username } = await onboard();
  // Jollity asks for the camera and to notify; the app asks the device. A person allows both when asked, and the
  // "Alarms & reminders" screen the app opens for a product's reminders is a settings page no sheet answers
  // (paritytech/product-lab#180): all three are given here, as the one-time setup of a new device.
  for (const permission of ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS'])
    await shell(`pm grant ${app} ${permission}`).catch(error => say(`could not grant ${permission}: ${String(error).slice(0, 160)}`));
  await shell(`appops set ${app} SCHEDULE_EXACT_ALARM allow`).catch(error => say(`could not allow exact alarms: ${String(error).slice(0, 160)}`));
  await assigned(app, username);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `username=${username}\npackage=${app}\n`);
  console.log(username);
} catch (error) {
  console.error(`[onboard ${serial}] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
