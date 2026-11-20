// Copyright 2026 Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { localEnv } from "../../../../packages/jollity-protocol/src/local-network.fixture"

type ProductAccount = Parameters<typeof import("./name-link").linkPlayerName>[0]

const wallet = vi.hoisted(() => ({
  sign: vi.fn<(request: unknown) => Promise<{ accountId: string; signature: Uint8Array }>>(async () => ({ accountId: `0x${"11".repeat(32)}`, signature: new Uint8Array(64) })),
}))
vi.mock("@parity/product-sdk", () => ({
  createApp: async () => ({ wallet: { signMessageWithDotNsIdentity: wallet.sign } }),
}))
/** what the host says of its chains: null by default, as the SDK answers for a host without chain discovery */
const host = vi.hoisted(() => ({
  chains: vi.fn<(chains: string[]) => Promise<{ chains: Record<string, string> } | null>>(async () => null),
}))
vi.mock("@parity/product-sdk-host", () => ({
  getAccountsProvider: async () => ({ getProductAccountSigner: () => ({}) }),
  getHostChainInfo: host.chains,
}))
vi.mock("@individuality/name-link", () => ({
  linkName: async (options: { signAsRoot: (username: string, message: Uint8Array) => Promise<unknown> }) => {
    await options.signAsRoot("alice.testnet", Uint8Array.of(1, 2, 3))
    return "linked"
  },
}))
vi.mock("../engine", () => ({ assetHubClient: async () => ({}), peopleChainClient: () => ({}) }))
vi.mock("../host/identity", () => ({ knownDisplayName: async () => "alice.testnet" }))
vi.mock("../debug/log-store", () => ({ devLog: vi.fn() }))
vi.mock("../journeys/name-link-trace", () => ({
  traceNameLink: () => ({ skipped: vi.fn(), threw: vi.fn(), end: vi.fn(), stage: vi.fn(), facts: vi.fn(), warned: vi.fn() }),
}))

beforeEach(() => {
  vi.resetModules()
  wallet.sign.mockClear()
  host.chains.mockReset()
  host.chains.mockResolvedValue(null)
})
afterEach(() => vi.unstubAllEnvs())

describe("name-link root signature chain", () => {
  it("uses the normalized local People genesis in the SDK descriptor", async () => {
    for (const [name, value] of Object.entries(localEnv)) vi.stubEnv(name, value)
    vi.stubEnv("NEXT_PUBLIC_PEOPLE_GENESIS", `0x${"Ab".repeat(32)}`)
    const { linkPlayerName } = await import("./name-link")
    expect(await linkPlayerName({ publicKey: new Uint8Array(32) } as ProductAccount, "register")).toBe("linked")
    const { previewnet_individuality: base } = await import("@parity/product-sdk-descriptors/previewnet-individuality")
    expect(wallet.sign).toHaveBeenCalledWith({
      peopleChain: { ...base, genesis: `0x${"ab".repeat(32)}` },
      username: "alice.testnet",
      message: Uint8Array.of(1, 2, 3),
    })
    expect(base.genesis).not.toBe(`0x${"ab".repeat(32)}`)
  })

  // Previewnet restarts from genesis, and the SDK's descriptor keeps the old one until its next release: on
  // 19 November 2026 the host refused the root's signature there ("Chain 0x55e3… is not supported by the current host").
  it.each(["paseo", "previewnet"])("signs on the People chain the host names on %s, not the descriptor's", async (network) => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_NAME", network)
    const live = `0x${"73".repeat(32)}`
    host.chains.mockResolvedValue({ chains: { People: live } })
    const { linkPlayerName } = await import("./name-link")
    expect(await linkPlayerName({ publicKey: new Uint8Array(32) } as ProductAccount, "register")).toBe("linked")
    const base = network === "paseo"
      ? (await import("@parity/product-sdk-descriptors/paseo-individuality")).paseo_individuality
      : (await import("@parity/product-sdk-descriptors/previewnet-individuality")).previewnet_individuality
    expect(host.chains).toHaveBeenCalledWith(["People"])
    expect(wallet.sign.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ peopleChain: { ...base, genesis: live } }))
    expect(base.genesis).not.toBe(live)
  })

  // What Jollity falls back to is its own table (`chainGenesis`), as its People client does, not the descriptor's.
  it("signs on Jollity's own People genesis when the host's chain read fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_NAME", "previewnet")
    const configured = `0x${"cd".repeat(32)}`
    vi.stubEnv("NEXT_PUBLIC_PEOPLE_GENESIS", configured)
    host.chains.mockRejectedValue(new Error("no discovery"))
    const { linkPlayerName } = await import("./name-link")
    expect(await linkPlayerName({ publicKey: new Uint8Array(32) } as ProductAccount, "register")).toBe("linked")
    const { previewnet_individuality: base } = await import("@parity/product-sdk-descriptors/previewnet-individuality")
    expect(wallet.sign.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ peopleChain: { ...base, genesis: configured } }))
  })

  it("signs on Jollity's own People genesis when the host answers no discovery", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_NAME", "paseo")
    const configured = `0x${"cd".repeat(32)}`
    vi.stubEnv("NEXT_PUBLIC_PEOPLE_GENESIS", configured)
    const { linkPlayerName } = await import("./name-link")
    expect(await linkPlayerName({ publicKey: new Uint8Array(32) } as ProductAccount, "register")).toBe("linked")
    const { paseo_individuality: base } = await import("@parity/product-sdk-descriptors/paseo-individuality")
    expect(host.chains).toHaveBeenCalledWith(["People"])
    expect(wallet.sign.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ peopleChain: { ...base, genesis: configured } }))
    expect(base.genesis).not.toBe(configured)
  })

  // Jollity's table carries no previewnet genesis (it rotates): with no host discovery and no override, the descriptor's is all there is.
  it("keeps the previewnet descriptor when neither the host nor Jollity names a People chain", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_NAME", "previewnet")
    const { linkPlayerName } = await import("./name-link")
    expect(await linkPlayerName({ publicKey: new Uint8Array(32) } as ProductAccount, "register")).toBe("linked")
    const { previewnet_individuality: base } = await import("@parity/product-sdk-descriptors/previewnet-individuality")
    expect((await import("@jollity/protocol")).chainGenesis("people")).toBeUndefined()
    expect(wallet.sign.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ peopleChain: base }))
  })

  it("does not wait on a host that never names its chains", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_NAME", "previewnet")
    const configured = `0x${"cd".repeat(32)}`
    vi.stubEnv("NEXT_PUBLIC_PEOPLE_GENESIS", configured)
    // The time limit starts when the host is asked, which is after the link's own imports: wait for the question
    // before moving the clock, or a cold import arms the timer on a clock that has already moved.
    let asked!: () => void
    const wasAsked = new Promise<void>((resolve) => { asked = resolve })
    host.chains.mockImplementation(() => { asked(); return new Promise(() => {}) })
    const { linkPlayerName } = await import("./name-link")
    vi.useFakeTimers()
    try {
      const linked = linkPlayerName({ publicKey: new Uint8Array(32) } as ProductAccount, "register")
      await wasAsked
      await vi.advanceTimersByTimeAsync(4_999)
      expect(wallet.sign).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(await linked).toBe("linked")
    } finally {
      vi.useRealTimers()
    }
    expect(wallet.sign.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ peopleChain: expect.objectContaining({ genesis: configured }) }))
  })
})
