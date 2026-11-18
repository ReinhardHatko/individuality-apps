// Copyright 2026 Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

const REGISTER_PERSON_MSG_PREFIX = new TextEncoder().encode(
  "pop:resources:register_person",
);

export function registerPersonProofMessage(
  signingContext: Uint8Array,
  alias: Uint8Array,
): Uint8Array {
  const message = new Uint8Array(
    signingContext.length + REGISTER_PERSON_MSG_PREFIX.length + alias.length,
  );
  message.set(signingContext, 0);
  message.set(REGISTER_PERSON_MSG_PREFIX, signingContext.length);
  message.set(alias, signingContext.length + REGISTER_PERSON_MSG_PREFIX.length);
  return message;
}
