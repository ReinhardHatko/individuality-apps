// Copyright 2026 Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

// The Paseo phone lab on an iOS simulator: lab.paseo-phone.config.ts with the Polkadot app's simulator build in
// place of the Android app. One person, Pat, so that the phone scenarios (phone-*.feature) run on either host as
// they are; a lab has one phone host because product-lab refuses a lab whose people PRODUCT_LAB_PHONES does not all
// name (lab.paseo-phone.config.ts says how that was met).
//
//  - the app is the public nightly simulator build (bundle io.parity.polkadotapp), which is Paseo Next V2's and
//    opens the published dim2.paseo;
//  - the person is whoever the simulator's app holds: onboard-ios.mts makes one on a new simulator;
//  - an Appium server with the XCUITest driver has to be running (APPIUM_URL, default the driver's own port);
//  - the page has a camera on a simulator: WebKit's mock capture devices, a test pattern.
//
//   PRODUCT_LAB_PHONES=Pat=<udid>/<username> product-lab test lab/previewnet-poc/phone-rehearsal.feature --config lab/previewnet-poc/lab.paseo-ios.config.ts --environment live-next-v2 --own-lab
import { defineLab, defineSteps } from '@parity/product-lab';
import { nextGame } from './next-game.ts';

const chains = ['people', 'asset-hub', 'bulletin'];
const dim2 = defineSteps({ id: 'dim2', product: { label: 'Jollity' }, requires: { chains }, actions: { nextGame }, assertions: {} });

export default defineLab({
  name: 'Paseo Next V2: a person on an iOS simulator joins a live game',
  app: { label: 'Jollity', steps: dim2, chains, account: { testId: 'home', attribute: 'data-account',
    firstRun: { on: { url: '/permissions' }, steps: [{ click: { role: 'button', name: 'Allow access' } }] } } },
  features: ['./phone-permissions.feature', './phone-rehearsal.feature', './phone-sign-up.feature', './phone-play.feature', './phone-now.feature', './phone-game.feature'],
  environments: { fast: false, 'paseo-copy': false, 'previewnet-copy': false },
  hosts: { ios: { product: 'dim2.paseo', appiumUrl: process.env.APPIUM_URL ?? 'http://127.0.0.1:4723' } },
  defaultHost: 'ios',
  live: { 'next-v2': { people: { Pat: { host: 'ios' } } } },
  advanced: { steps: ['./steps.ts', './play-steps.ts'] },
  advancedWhy: { steps: 'The sentences are Cucumber step files shared with the other labs of this repository' },
});
