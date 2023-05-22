/* Copyright © 2023 Exact Realty Limited.
 *
 * Permission to use, copy, modify, and distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 * OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE.
 */

import { webcrypto } from 'node:crypto';

import m from '../src/index.js';

import type Memcached from 'memcached';
import assert from 'node:assert/strict';

!globalThis.crypto &&
	((() => globalThis || { crypto: {} })().crypto =
		webcrypto as unknown as Crypto);

const fakeMemcached = (): Pick<Memcached, 'get' | 'set' | 'touch' | 'del'> & {
	store: Record<string, string>;
} => {
	const store = Object.create(null);

	return {
		store: store,

		get(key, cb) {
			cb.call(
				null as unknown as Memcached.CommandData,
				undefined,
				store[key],
			);
		},

		set(key, value, _lifetime, cb) {
			store[key] = value;
			cb.call(null as unknown as Memcached.CommandData, undefined, true);
		},

		touch(_key, _lifetime, cb) {
			cb.call(null as unknown as Memcached.CommandData, undefined);
		},

		del(key, cb) {
			delete store[key];
			cb.call(null as unknown as Memcached.CommandData, undefined, true);
		},
	};
};

describe('Memcached store', () => {
	it('should handle set, get and reset', async () => {
		const c = await m({
			cacheMinAge: 1,
			cacheMaxAge: 60,
			cacheDefaultAge: 30,
			cacheClockDriftAdjustment: 1,
			memcached: fakeMemcached(),
		});

		const storedValue = [1, 2, 3];

		const resultBeforeSet = await c['test'];

		assert.deepEqual(resultBeforeSet, undefined);

		await c('test', new Uint8Array(storedValue));

		const resultAfterSet = await c['test'];

		assert.deepEqual(
			Array.from(new Uint8Array(resultAfterSet)),
			storedValue,
		);

		const resultFromSecondGetAfterSet = await c['test'];

		assert.deepEqual(
			Array.from(new Uint8Array(resultFromSecondGetAfterSet)),
			storedValue,
		);

		delete c['test'];

		const resultAfterDelete = await c['test'];

		assert.equal(resultAfterDelete, undefined);
	});

	it('should handle tampering with data', async () => {
		const memcached = fakeMemcached();
		const { store } = memcached;

		const c = await m({
			cacheMinAge: 1,
			cacheMaxAge: 60,
			cacheDefaultAge: 30,
			cacheClockDriftAdjustment: 1,
			memcached: memcached,
		});

		const storedValue = [0, 255, 0, 255, 0, 255];

		await c('test', new Uint8Array(storedValue));

		const resultAfterSet = await c['test'];

		assert.deepEqual(
			Array.from(new Uint8Array(resultAfterSet)),
			storedValue,
		);

		const tempStore = Object.create(null);

		Object.keys(store).forEach((key) => {
			tempStore[key] = store[key];
			store[key] = 'invalid';
		});

		const resultFromInvalidData = c['test'];

		await assert.rejects(Promise.resolve(resultFromInvalidData));

		Object.keys(store).forEach((key) => {
			store[key] = 'invalidinvalidinvalidinvalidinvalidinvalid';
		});

		const resultFromInvalidDataTake2 = c['test'];

		await assert.rejects(Promise.resolve(resultFromInvalidDataTake2));

		delete c['test'];

		const resultAfterDelete = await c['test'];

		assert.equal(resultAfterDelete, undefined);

		Object.keys(tempStore).forEach((key) => {
			store[key] = tempStore[key];
		});

		const resultAfterRestore = await c['test'];

		assert.deepEqual(
			Array.from(new Uint8Array(resultAfterRestore)),
			storedValue,
		);
	});

	it('should handle set using object notation', async () => {
		const c = await m({
			cacheMinAge: 1,
			cacheMaxAge: 60,
			cacheDefaultAge: 30,
			cacheClockDriftAdjustment: 1,
			memcached: fakeMemcached(),
		});

		const storedValue = [1, 2, 3, 4];

		const resultBeforeSet = await c['test'];

		assert.deepEqual(resultBeforeSet, undefined);

		c['test'] = new Uint32Array(new Uint8Array(storedValue).buffer);

		const resultAfterSet = await new Promise<ArrayBufferLike>((resolve) => {
			setTimeout(() => {
				resolve(c['test']);
			}, 50);
		});

		assert.deepEqual(
			Array.from(new Uint8Array(resultAfterSet)),
			storedValue,
		);
	});

	it('should handle replacing values', async () => {
		const c = await m({
			cacheMinAge: 1,
			cacheMaxAge: 60,
			cacheDefaultAge: 30,
			cacheClockDriftAdjustment: 1,
			memcached: fakeMemcached(),
		});

		const storedValue1 = [1, 2, 3];
		const storedValue2 = [4, 5, 6];

		const resultBeforeSet = await c['test'];

		assert.deepEqual(resultBeforeSet, undefined);

		await c('test', new Uint8Array(storedValue1), 1);

		const resultAfterSet = await c['test'];

		assert.deepEqual(
			Array.from(new Uint8Array(resultAfterSet)),
			storedValue1,
		);

		await c('test', new Uint8Array(storedValue2), 1);

		const resultFromSecondGetAfterSet = await c['test'];

		assert.deepEqual(
			Array.from(new Uint8Array(resultFromSecondGetAfterSet)),
			storedValue2,
		);

		delete c['test'];

		const resultAfterDelete = await c['test'];

		assert.equal(resultAfterDelete, undefined);

		await c('test', new Uint8Array(storedValue1), 1);

		const resultFromThirdGetAfterSet = await c['test'];

		assert.deepEqual(
			Array.from(new Uint8Array(resultFromThirdGetAfterSet)),
			storedValue1,
		);
	});

	it('should not return expired values', async function () {
		this.timeout(5000);

		const c = await m({
			cacheMinAge: 1,
			cacheMaxAge: 60,
			cacheDefaultAge: 30,
			cacheClockDriftAdjustment: 1,
			memcached: fakeMemcached(),
		});

		const storedValue = [1, 2, 3];

		const resultBeforeSet = await c['test'];

		assert.deepEqual(resultBeforeSet, undefined);

		await c('test', new Uint8Array(storedValue), 1);

		const resultAfterSet = await c['test'];

		assert.deepEqual(
			Array.from(new Uint8Array(resultAfterSet)),
			storedValue,
		);

		const resultAfterExpiration = await new Promise<ArrayBufferLike>(
			(resolve) => {
				setTimeout(() => resolve(c['test']), 2000);
			},
		);

		assert.deepEqual(resultAfterExpiration, undefined);
	});
});
