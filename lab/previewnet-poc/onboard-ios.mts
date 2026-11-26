// Copyright 2026 Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

// Onboards the Polkadot app in an iOS simulator as a NEW person, so that a lab can start on a simulator nobody set up
// by hand: a CI runner's, or a new one on this machine. product-lab's iOS host never onboards a phone; its person is
// whoever the app holds, and this makes her. The Android twin is onboard-android.mts.
//
//   node --import tsx lab/previewnet-poc/onboard-ios.mts <simulator udid> [username base]
//
// It needs an Appium server with the XCUITest driver (APPIUM_URL, default http://127.0.0.1:4723) and the app
// installed on the booted simulator (IOS_BUNDLE_ID, default io.parity.polkadotapp, the nightly's). It walks the app's
// own first-run screens as a person does: the theme, the username (the base, six or more lowercase letters, to which
// the app adds digits), the notification alert, and the tips over the tabs. It prints the claimed username on its
// last line and, in a GitHub job, sets the step output `username`. The lab takes it as
//   PRODUCT_LAB_PHONES=Pat=<udid>/<username>
//
// What it leaves behind: a username on the app's live network (the nightly build's is Paseo Next V2), which cannot be
// taken back, and the key that owns it in the simulator's data. It sends no funds and holds no secret.
//
// With OPEN_PRODUCT set to a published name (dim2.paseo), it also opens that product once before it ends: the first
// opening of a product on a new install fetches it and can outlast the lab's three minutes (seen on 24 November
// 2026: "no page of dim2.paseo in the app within 180000 ms"; the opening after it took ten seconds).
//
// The route was first walked by hand through Appium on 23 November 2026 (a DevCI build on iOS 26.4): the ids
// `onboarding_theme_continue_button` and `username_submit_button`, the words "It's yours!", the region
// `PopoverDismissRegion` behind each tip. Alerts are accepted by their action, never by a label: the labels follow
// the machine's language.
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

type Node = { type: string; name: string; label: string; value: string; enabled: boolean; x: number; y: number };

/** Where a network's identity backend lists usernames, by the build that is on it. */
const IDENTITY_SEARCH: Readonly<Record<string, string>> = {
  'io.parity.polkadotapp': 'https://identity.dotspark.app/api/v1/usernames/search?prefix=',
  'io.parity.polkadotapp.develop': 'https://previewnet.substrate.dev/dub/api/v1/usernames/search?prefix=',
};

const [udid, given] = process.argv.slice(2);
if (!udid) { console.error('usage: onboard-ios.mts <simulator udid> [username base]'); process.exit(2); }
const appium = process.env.APPIUM_URL ?? 'http://127.0.0.1:4723', bundle = process.env.IOS_BUNDLE_ID ?? 'io.parity.polkadotapp';
const letters = (count: number) => Array.from({ length: count }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
const base = given ?? `jolci${letters(6)}`;
if (!/^[a-z]{6,}$/.test(base)) { console.error(`The username base must be six or more lowercase letters, got ${JSON.stringify(base)}`); process.exit(2); }
const say = (line: string) => console.log(`[onboard ${udid.slice(0, 8)}] ${line}`);

/** One call to Appium. Over node:http, which waits as long as it is told: the first session builds WebDriverAgent. */
function call(method: string, path: string, body?: unknown, timeoutMs = 60_000) {
  return new Promise<unknown>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(appium + path, { method, timeout: timeoutMs, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, answer => {
      let text = '';
      answer.on('data', chunk => (text += chunk));
      answer.on('end', () => {
        let json: { value?: unknown };
        try { json = JSON.parse(text) as { value?: unknown }; } catch { reject(Error(`Appium answered HTTP ${answer.statusCode} without JSON: ${text.slice(0, 200)}`)); return; }
        const refusal = json.value as { error?: unknown; message?: unknown } | null | undefined;
        if ((answer.statusCode ?? 500) >= 400) reject(Error(`${String(refusal?.error)}: ${String(refusal?.message).slice(0, 300)}`)); else resolve(json.value);
      });
    });
    request.on('timeout', () => request.destroy(Error(`Appium did not answer ${method} ${path} in ${timeoutMs / 1000} s`)));
    request.on('error', reject);
    if (data) request.write(data);
    request.end();
  });
}

const simctl = (args: string[]) => new Promise<string>((resolve, reject) =>
  execFile('xcrun', ['simctl', ...args], { timeout: 30_000 }, (error, out, err) => error ? reject(Error(String(err || error.message).trim().slice(0, 300))) : resolve(out.trim())));

/** The username the app holds, from its own preferences: it writes `username.v3` when the claim is made. */
async function heldUsername() {
  const container = await simctl(['get_app_container', udid, bundle, 'data']).catch(() => '');
  if (!container) return undefined;
  return new Promise<string | undefined>(resolve => execFile('plutil', ['-extract', 'username\\.v3', 'raw', '-o', '-', `${container}/Library/Preferences/${bundle}.plist`], { timeout: 10_000 },
    (error, out) => resolve(error ? undefined : out.trim() || undefined)));
}

/** The identity backend lists the name as assigned: it is registered on chain, and she can sign up for a game. */
async function assigned(username: string) {
  const search = process.env.IDENTITY_SEARCH_URL ?? IDENTITY_SEARCH[bundle];
  if (!search) { say(`no identity backend known for ${bundle}: the name's registration is not checked`); return; }
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

async function onboard(session: string) {
  const run = (script: string, args: Record<string, unknown> = {}) => call('POST', `/session/${session}/execute/sync`, { script, args: [args] });
  /** What is on the screen: each visible element's name, label, value and middle. */
  const screen = async (): Promise<Node[]> => {
    const xml = String(await run('mobile: source', { format: 'xml' }).catch(() => ''));
    const nodes: Node[] = [];
    for (const found of xml.matchAll(/<XCUIElementType(\w+)([^>]*)>/g)) {
      const read = (name: string) => new RegExp(` ${name}="([^"]*)"`).exec(found[2]!)?.[1] ?? '';
      if (read('visible') !== 'true' || !(read('name') || read('label') || read('value'))) continue;
      const text = (value: string) => value.replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"');
      nodes.push({ type: found[1]!, name: text(read('name')), label: text(read('label')), value: text(read('value')), enabled: read('enabled') !== 'false',
        x: Math.round(Number(read('x')) + Number(read('width')) / 2), y: Math.round(Number(read('y')) + Number(read('height')) / 2) });
    }
    return nodes;
  };
  const tap = (node: Node) => run('mobile: tap', { x: node.x, y: node.y });
  let typed = false, claimed = false, last = '', onTabs = 0;
  for (const deadline = Date.now() + 8 * 60_000; Date.now() < deadline;) {
    // A system alert (notifications, "Open in app?") is accepted by its action; one that offers to erase the account
    // is never met on a new install and is left alone: its buttons are not the accepting kind.
    const buttons = await run('mobile: alert', { action: 'getButtons' }).catch(() => undefined) as string[] | undefined;
    if (buttons?.length) {
      if (buttons.some(label => /start over|löschen|erase|reset/i.test(label))) throw Error(`The app shows an alert that offers to erase the account (${buttons.join(', ')}): this script is for a new install`);
      say(`alert (${buttons.length} buttons): accepted`); await run('mobile: alert', { action: 'accept' }).catch(() => undefined); await delay(1_500); continue;
    }
    const nodes = await screen(), named = (name: string) => nodes.find(node => node.name === name || node.label === name), has = (part: string) => nodes.find(node => `${node.name} ${node.label} ${node.value}`.includes(part));
    const seen = [...new Set(nodes.map(node => node.label || node.name || node.value))].slice(0, 12).join(' | ');
    if (seen && seen !== last) say(`screen: ${(last = seen).slice(0, 220)}`);
    const input = named('username_input'), submit = named('username_submit_button') ?? has('Get username'), tabs = named('Chats');
    if (claimed && tabs && !named('PopoverDismissRegion')) { say('the app is on its tabs'); return; }
    // Its tabs before any username was typed: the app has a person already.
    onTabs = !typed && tabs && !input ? onTabs + 1 : 0;
    if (onTabs >= 3) throw Error(`The app is already onboarded${await heldUsername().then(name => name ? ` as ${name}` : '')}: this script is for an app that has no person yet`);
    const tip = named('PopoverDismissRegion');
    if (tip) { say('tip: tapped away'); await tap(tip); await delay(1_200); continue; }
    const theme = named('onboarding_theme_continue_button');
    if (theme) { say('theme: Continue'); await tap(theme); await delay(2_000); continue; }
    if (input && !typed) {
      // The field is tapped (it may or may not have the focus already) and the letters go to it as keys. The button
      // that claims the name is not on the screen before something is typed (the nightly of 23 November 2026).
      await tap(input); await delay(800); await run('mobile: keys', { keys: [...base] }); typed = true; say('typed the base'); await delay(3_000); continue;
    }
    if (typed && !claimed) {
      if (has("It's yours!") && submit?.enabled) {
        // The name she gets is what the field holds, not what was sent to it: claim only the base itself.
        if (!nodes.some(node => node.value === base || node.label === base)) throw Error(`The username field does not show the base ${base}; the screen: ${seen.slice(0, 200)}`);
        await tap(submit); claimed = true; say('claimed; waiting for the app'); await delay(4_000); continue;
      }
      await delay(1_500); continue;
    }
    const start = has('Start using the Polkadot App');
    if (start) { await tap(start); await delay(2_000); continue; }
    if (has('Check in at Web3 Summit')) throw Error("This build asks for the Web3 Summit check-in after the username, which only a volunteer's account can give: this script holds none");
    await delay(2_000);
  }
  throw Error(`${claimed ? 'The claim was sent, but the app did not reach its tabs in eight minutes' : 'The app did not claim a username in eight minutes'}; last screen: ${last.slice(0, 300) || 'nothing readable'}`);
}

let session: string | undefined;
try {
  say(`opening ${bundle} through ${appium}; the username base is ${base}`);
  // The first session on a simulator builds and starts WebDriverAgent, which can take minutes on a CI runner.
  session = ((await call('POST', '/session', { capabilities: { alwaysMatch: {
    platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': udid, 'appium:bundleId': bundle, 'appium:noReset': true,
    'appium:wdaLocalPort': Number(process.env.WDA_PORT ?? 8192), 'appium:newCommandTimeout': 900, 'appium:wdaLaunchTimeout': 600_000, 'appium:waitForIdleTimeout': 0,
    // A runner's simulator is slow to come up; the driver's own two minutes were not enough for it there.
    'appium:simulatorStartupTimeout': 600_000,
  } } }, 1_300_000)) as { sessionId: string }).sessionId;
  await onboard(session);
  const username = await heldUsername();
  if (!username || !username.startsWith(`${base}.`)) throw Error(`The app's preferences hold ${username ? `the username ${username}` : 'no username'}, not one from the base ${base}`);
  say(`the app holds ${username}`);
  await assigned(username);
  const product = process.env.OPEN_PRODUCT;
  if (product) {
    if (!/^[a-z0-9.-]+$/.test(product)) throw Error(`OPEN_PRODUCT is a published name, got ${JSON.stringify(product)}`);
    const scheme = process.env.IOS_SCHEME ?? 'polkadotapp';
    say(`opening ${product} once`);
    await simctl(['openurl', udid, `${scheme}://${product}`]);
    // iOS asks whether to open the link in the app; the product then loads for a while. Alerts are accepted as they come.
    for (const end = Date.now() + 60_000; Date.now() < end; await delay(3_000)) {
      const buttons = await call('POST', `/session/${session}/execute/sync`, { script: 'mobile: alert', args: [{ action: 'getButtons' }] }).catch(() => undefined) as string[] | undefined;
      if (buttons?.length) await call('POST', `/session/${session}/execute/sync`, { script: 'mobile: alert', args: [{ action: 'accept' }] }).catch(() => undefined);
    }
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `username=${username}\n`);
  // The session ends here: the lab's host opens one of its own.
  await call('DELETE', `/session/${session}`).catch(() => undefined); session = undefined;
  console.log(username);
} catch (error) {
  if (session) await call('DELETE', `/session/${session}`).catch(() => undefined);
  console.error(`[onboard ${udid.slice(0, 8)}] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
