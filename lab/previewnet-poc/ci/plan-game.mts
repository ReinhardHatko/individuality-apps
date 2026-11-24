// Copyright 2026 Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

// Picks the one game a bot run plays, for .github/workflows/jollity-bot.yml: the first game of the live network whose
// play time is at least `lead` seconds away, read from the People chain (the game in registration, then the
// schedule). Every leg of the run is handed that play time and takes no other game (next-game.ts), so that people in
// separate jobs meet in one game. Reads only.
//
//   node --import tsx lab/previewnet-poc/ci/plan-game.mts <paseo-next-v2|previewnet> [lead seconds, default 1500]
//
// It prints `play_time=<Unix seconds>` and `play_time_iso=…`, and appends both to $GITHUB_OUTPUT in a job.
import { appendFileSync } from 'node:fs';
import { PapiChainAccess } from '@parity/product-lab/chain-papi';

const PEOPLE: Readonly<Record<string, string>> = {
  'paseo-next-v2': 'wss://paseo-people-next-system-rpc.polkadot.io',
  previewnet: 'wss://previewnet.substrate.dev/people',
};
const [network = '', leadText = '1500'] = process.argv.slice(2), lead = Number(leadText);
if (!PEOPLE[network] || !Number.isFinite(lead) || lead < 0) { console.error('usage: plan-game.mts <paseo-next-v2|previewnet> [lead seconds]'); process.exit(2); }

const people = PapiChainAccess.connect(PEOPLE[network]!, { publicEndpoint: { reason: 'Reads the live games before a bot run' } }) as PapiChainAccess;
try {
  const head = await people.finalizedHead();
  const read = (pallet: string, item: string) => people.historicalStorage(pallet, item, [], head.hash, { orDefault: true });
  const [game, now, schedules] = await Promise.all([read('Game', 'Game'), read('Timestamp', 'Now'), read('Game', 'GameSchedules')]) as
    [{ index: number; game_date: number; state: { type: string } } | undefined, bigint, { game_play_time: number }[] | undefined];
  const chainNow = Number(now / 1000n);
  // The game on the chain counts only while it still takes sign-ups; after that the schedule has the next ones.
  const times = [...(game?.state.type === 'Registration' ? [game.game_date] : []), ...(schedules ?? []).map(entry => entry.game_play_time)].sort((a, b) => a - b);
  const playTime = times.find(time => time - chainNow >= lead);
  console.log(`People #${head.number}, chain time ${new Date(chainNow * 1000).toISOString()}; game ${game ? `${game.index} ${game.state.type}, plays ${new Date(game.game_date * 1000).toISOString()}` : 'none'}; ${(schedules ?? []).length} scheduled`);
  if (!playTime) { console.error(`No game of ${network} plays ${lead} s or more from now: the chain holds ${times.length} coming game(s)`); process.exitCode = 1; }
  else {
    const lines = `play_time=${playTime}\nplay_time_iso=${new Date(playTime * 1000).toISOString()}\n`;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
    console.log(`${lines}in ${Math.round((playTime - chainNow) / 60)} minutes`);
  }
} finally { await people.close(); }
