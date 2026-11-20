// Copyright 2026 Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NameLink } from "@individuality/name-link";
import { previewnet_individuality } from "@parity/product-sdk-descriptors/previewnet-individuality";
import { paseo_individuality } from "@parity/product-sdk-descriptors/paseo-individuality";

import { NETWORKS, resolveNetwork } from "@humanity/shared/chain/networks.ts";
import type { NetworkConfig } from "@humanity/shared/chain/networks.ts";
import { linkSeatName } from "@features/card/chain/seat-name-link.ts";

const state = vi.hoisted(() => ({
  network: null as NetworkConfig | null,
  sign: vi.fn(async () => ({
    accountId: `0x${"01".repeat(32)}`,
    signature: new Uint8Array(64),
  })),
}));

vi.mock("@parity/product-sdk", () => ({
  createApp: vi.fn(async () => ({ wallet: { signMessageWithDotNsIdentity: state.sign } })),
}));
vi.mock("@individuality/name-link", () => ({
  linkName: vi.fn(async (link: NameLink) => {
    await link.signAsRoot(link.username, new Uint8Array([1, 2]));
    return "linked";
  }),
}));
vi.mock("@humanity/shared/chain/client.ts", () => ({
  getPeopleClient: vi.fn(async () => ({ network: state.network, client: {} })),
}));
vi.mock("@humanity/shared/chain/asset-hub-client.ts", () => ({
  getAssetHubClient: vi.fn(async () => ({ client: {} })),
}));
vi.mock("@humanity/shared/chain/host-api.ts", () => ({
  getAccountsProvider: vi.fn(async () => ({ getProductAccountSigner: vi.fn() })),
}));
vi.mock("@humanity/shared/identity/game-account.ts", () => ({
  CANDIDATE_PRODUCT_DOMAIN: "dim2.testnet",
  resolveGameAccount: vi.fn(async () => ({ account: { publicKey: new Uint8Array(32) } })),
}));
vi.mock("@humanity/shared/identity/humanity-user-id.ts", () => ({
  resolveHumanityUserId: vi.fn(async () => ({ username: "alice" })),
}));
vi.mock("@humanity/shared/logging/logger.ts", () => ({
  loggerFor: () => ({ info: vi.fn(), warning: vi.fn() }),
}));

beforeEach(() => {
  state.sign.mockClear();
});

describe("seat name root signature", () => {
  it("passes the local People genesis to the SDK without changing the descriptor metadata", async () => {
    state.network = resolveNetwork("local", {
      VITE_LOCAL_PEOPLE_WS_URL: "ws://127.0.0.1:9944",
      VITE_LOCAL_PEOPLE_GENESIS_HASH: `0x${"12".repeat(32)}`,
      VITE_LOCAL_ASSET_HUB_WS_URL: "ws://127.0.0.1:9945",
      VITE_LOCAL_ASSET_HUB_GENESIS_HASH: `0x${"34".repeat(32)}`,
    });
    expect(await linkSeatName("register")).toBe("linked");
    expect(state.sign).toHaveBeenCalledWith({
      peopleChain: { ...previewnet_individuality, genesis: state.network.peopleChain.genesisHash },
      username: "alice",
      message: new Uint8Array([1, 2]),
    });
    expect(previewnet_individuality.genesis).not.toBe(state.network.peopleChain.genesisHash);
  });

  it.each([
    ["paseo-next-v2", paseo_individuality],
    ["previewnet", previewnet_individuality],
  ] as const)("signs on the genesis the build overrides %s with, not the descriptor's", async (key, descriptor) => {
    const relaunched = `0x${"ab".repeat(32)}` as const;
    state.network = resolveNetwork(key, undefined, { people: relaunched, assetHub: null });
    expect(await linkSeatName("register")).toBe("linked");
    expect(state.sign).toHaveBeenCalledWith({
      peopleChain: { ...descriptor, genesis: relaunched },
      username: "alice",
      message: new Uint8Array([1, 2]),
    });
    expect(descriptor.genesis).not.toBe(relaunched);
  });

  it.each([
    ["paseo-next-v2", paseo_individuality],
    ["previewnet", previewnet_individuality],
  ] as const)("signs on the %s table's People genesis, whatever the descriptor's", async (key, descriptor) => {
    // The table is what the People client reads. Where the SDK's descriptor names another chain (previewnet after a
    // relaunch, until the SDK follows) the table's wins; where the two agree this only pins that nothing else changed.
    state.network = NETWORKS[key];
    expect(await linkSeatName("register")).toBe("linked");
    expect(state.sign).toHaveBeenCalledWith({
      peopleChain: { ...descriptor, genesis: NETWORKS[key].peopleChain.genesisHash },
      username: "alice",
      message: new Uint8Array([1, 2]),
    });
  });
});
