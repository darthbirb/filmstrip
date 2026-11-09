import { lookup } from "node:dns/promises";
import { connect } from "node:net";

import { expect, test } from "@playwright/test";

function accepts(address: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host: address, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

// DEVELOPMENT.md "Tests".
test("the dev server answers at every address the suite's URL names", async ({ baseURL }) => {
  const url = new URL(baseURL ?? "");
  const addresses = (await lookup(url.hostname, { all: true })).map(({ address }) => address);
  const answers = await Promise.all(
    addresses.map(async (address) => [address, await accepts(address, Number(url.port))]),
  );
  expect(Object.fromEntries(answers)).toEqual(
    Object.fromEntries(addresses.map((address) => [address, true])),
  );
});
