# memcached-encrypted-store 🗄️

[![License](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

> A secure and efficient encrypted store of keys and values for memcached.

Welcome to `memcached-encrypted-store`! This NPM package provides a convenient
solution for storing encrypted data in memcached, ensuring the confidentiality
and integrity of your cached information. With `memcached-encrypted-store`, you
can protect your sensitive data while benefiting from the speed and scalability
of memcached.

## ✨ Features

✅ Securely store and retrieve keys and values in memcached
✅ Encryption of data with non-persistent symmetrical keys
✅ Data integrity verification to prevent tampering
✅ Configurable cache settings for optimal performance
✅ Simple and intuitive usage

## 🚀 Installation

To start using `memcached-encrypted-store` in your project, simply install it
via npm:

```sh
npm install @exact-realty/memcached-encrypted-store
```

## 📝 Usage

To use `memcached-encrypted-store`, follow these steps:

1. Import the necessary modules:
```js
import m from '@exact-realty/memcached-encrypted-store';
import Memcached from 'memcached';
```

2. Initialize the encrypted memcached instance by providing the required configurations:
```js
const encryptedMemcached = await m({
  cacheMinAge: 1,
  cacheMaxAge: 60,
  cacheDefaultAge: 30,
  cacheClockDriftAdjustment: 1,
  memcached: new Memcached('memcached-server');
});
```

3. Store a value in memcached:
```js
const optionalTtl = 5;
await c('some-key', new Uint8Array([1,2,3]), optionalTtl);
// or altenatively (using the default TTL)
await c('some-key', new Uint8Array([1,2,3]));
// or (using object notation)
// note that fetching immediately after will likely fail, as this is
// an asynchronous operation
c['some-key'] = new Uint8Array([1,2,3]);
```

4. Retrieve a value from memcached:
```javascript
// Warning: may throw
console.log(await c['some-key']);
```

5. Delete a value from memcached:
```javascript
delete c['some-key'];
```

## 🤝 Contributing

🎉 We appreciate contributions from the community! If you have any ideas or
suggestions, feel free to open an issue or submit a pull request.

## 📃 License

This project is licensed under the ISC License. See the [LICENSE](LICENSE) file
for details.
