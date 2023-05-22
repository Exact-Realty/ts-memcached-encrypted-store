/* Copyright © 2023 Exact Realty Limited. All rights reserved.
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

import type Memcached from 'memcached';
import { atobb, bbtoa } from './lib/base64.js';

const generateEncryptionKey = () =>
	globalThis.crypto.subtle.generateKey(
		{
			['name']: 'AES-GCM',
			['length']: 128,
		},
		false,
		['encrypt', 'decrypt'],
	);

const generateHmacKey = () =>
	globalThis.crypto.subtle.generateKey(
		{
			['name']: 'HMAC',
			['hash']: { ['name']: 'SHA-256' },
		},
		true,
		['sign', 'verify'],
	);

const monotonicTimeFunction = () => {
	return process.hrtime.bigint() % (BigInt(1) << BigInt(72)) >> BigInt(8);
};

const textEncoder = new TextEncoder();

const cache = async (settings: {
	cacheMinAge: number;
	cacheMaxAge: number;
	cacheDefaultAge: number;
	cacheClockDriftAdjustment: number;
	memcached: Pick<Memcached, 'get' | 'set' | 'touch' | 'del'>;
}) => {
	const startTime = process.hrtime.bigint();

	const hmacKey: CryptoKey = await generateHmacKey();
	const encryptionKey = Array(2) as unknown as [CryptoKey, CryptoKey];
	let storeCount: number;

	let keysReady: Promise<void> = generateEncryptionKey().then((e) => {
		encryptionKey.fill(e);
		storeCount = 0;
		keysReady = Promise.resolve();
	});

	const getCacheKey = (key: string): Promise<ArrayBufferLike> =>
		globalThis.crypto.subtle.sign('HMAC', hmacKey, textEncoder.encode(key));

	const asyncGetterHandler = async (
		cacheKey: ArrayBufferLike,
		cacheKeyB64: string,
		err: unknown,
		data: string,
	) => {
		if (!data) {
			if (err) {
				throw err;
			}
			return undefined;
		}

		await keysReady;

		const buf = atobb(data);

		const iv = buf.slice(0, 12);

		const count = new DataView(buf.slice(0, 4)).getUint32(0);

		const keyIndex = Number(count >> 1 > storeCount);

		const plaintext: ArrayBuffer = await globalThis.crypto.subtle.decrypt(
			{
				name: encryptionKey[keyIndex].algorithm.name,
				iv: iv,
				additionalData: cacheKey,
			},
			encryptionKey[keyIndex],
			buf.slice(12),
		);

		if (!plaintext.byteLength) {
			throw Error('Empty message');
		}

		const plaintextDV = new DataView(plaintext.slice(0, 4));

		const expiration = plaintextDV.getUint32(0);

		const currentTimestamp =
			Number((process.hrtime.bigint() - startTime) / BigInt(1000000000)) %
			0x100000000;

		if (
			!Number.isInteger(expiration) ||
			expiration < 0 ||
			(currentTimestamp > expiration &&
				!(currentTimestamp >= 0xfffff000 && expiration < 0x1000))
		) {
			// Expired message
			return;
		}

		settings.memcached.touch(
			cacheKeyB64,
			Math.min(
				expiration > currentTimestamp
					? expiration - currentTimestamp
					: expiration - currentTimestamp + 0x100000000,
				settings.cacheMaxAge,
			),
			(err) => {
				void err;
			},
		);

		return plaintext.slice(4);
	};

	const setCachedValue = async (
		cacheKey: ArrayBufferLike,
		value: BlobPart,
		expiresIn?: number,
	) => {
		if (expiresIn && expiresIn < settings.cacheMinAge) {
			return;
		}

		const expiration = expiresIn
			? Math.floor(
					Math.max(
						expiresIn * settings.cacheClockDriftAdjustment,
						settings.cacheMinAge,
					),
			  )
			: settings.cacheDefaultAge;

		const cacheExpiration = Math.floor(
			Math.min(expiration, settings.cacheMaxAge),
		);

		const expirationTimestamp =
			(Number(
				(process.hrtime.bigint() - startTime) / BigInt(1000000000),
			) +
				expiration) %
			0x100000000;

		const expirationTimestampBuffer = new ArrayBuffer(4);
		const expirationTimestampDV = new DataView(expirationTimestampBuffer);
		expirationTimestampDV.setUint32(0, expirationTimestamp);

		const plaintext = await new Blob([
			expirationTimestampDV,
			value,
		]).arrayBuffer();

		const iv = new ArrayBuffer(12);
		const ivDV = new DataView(iv);

		if (storeCount > 0xffffffff) {
			keysReady = generateEncryptionKey().then((e) => {
				encryptionKey[1] = encryptionKey[0];
				encryptionKey[0] = e;
				storeCount = 0;
				keysReady = Promise.resolve();
			});
		}

		await keysReady;

		/* rotate the key after 2**32 messages  */

		/* To ensure that the IV is unique, the following precautions are taken:
		 * (1). A counter is used (top 32 bits)
		 * (2). The following 16 bits are random
		 * (3). The last 48 bits come from monotonic time
		 * (4). The keys are rotated after the counter is used up
		 */
		ivDV.setUint32(0, storeCount++);
		ivDV.setBigUint64(4, monotonicTimeFunction());
		globalThis.crypto.getRandomValues(new Uint8Array(iv).subarray(4, 6));

		const ciphertext = await globalThis.crypto.subtle.encrypt(
			{
				name: encryptionKey[0].algorithm.name,
				iv: iv,
				additionalData: cacheKey,
			},
			encryptionKey[0],
			plaintext,
		);

		const encryptedValue = await new Blob([iv, ciphertext]).arrayBuffer();

		return new Promise<boolean>((resolve, reject) => {
			settings.memcached.set(
				bbtoa(cacheKey),
				bbtoa(encryptedValue),
				cacheExpiration,
				(err, result) => {
					if (err) {
						return reject(err);
					}
					resolve(result);
				},
			);
		});
	};

	const getCachedValue = (cacheKey: ArrayBufferLike) =>
		new Promise<ArrayBufferLike | undefined>((resolve, reject) => {
			const cacheKeyB64 = bbtoa(cacheKey);

			const handler = (err: unknown, data: string) => {
				asyncGetterHandler(cacheKey, cacheKeyB64, err, data)
					.then(resolve)
					.catch(reject);
			};

			settings.memcached.get(cacheKeyB64, handler);
		});

	return new Proxy<
		Record<string, Promise<ArrayBufferLike> | ArrayBufferLike> & {
			(p: string, value: BlobPart, ttl?: number): Promise<void | Error>;
		}
	>(
		Object.setPrototypeOf(() => undefined, null),
		{
			['apply'](
				_target,
				_thisArg,
				[p, value, ttl]: [string, ArrayBufferLike, number | undefined],
			) {
				if (typeof p === 'symbol' || p === 'then') {
					return false;
				}

				return getCacheKey(p).then((k) =>
					setCachedValue(k, value, ttl),
				);
			},

			['get'](_target, p) {
				if (typeof p === 'symbol' || p === 'then') {
					return undefined;
				}

				return getCacheKey(p).then(getCachedValue);
			},

			['set'](_target, p, v) {
				if (typeof p === 'symbol') {
					return false;
				}

				getCacheKey(p)
					.then((k) => setCachedValue(k, v))
					.catch(Boolean);

				return true;
			},

			['defineProperty']() {
				return false;
			},

			['deleteProperty'](_target, p) {
				return (
					typeof p !== 'symbol' &&
					!!getCacheKey(p)
						.then(bbtoa)
						.then((k) => {
							settings.memcached.del(k, Boolean);
						})
						.catch(Boolean)
				);
			},

			['preventExtensions']() {
				return false;
			},
		},
	);
};

export default cache;
