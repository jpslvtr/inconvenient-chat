# inconvenient-chat

A minimal, end-to-end encrypted group chat. All encryption and decryption
happen in your browser using PGP - the server only ever stores ciphertext.

## How it works

- Create a room (you get a 6-digit code) or join one with a code.
- Add your name and paste your PGP public + private keys to set up your identity.
  Keys are kept in your browser only and saved to `localStorage` for the session.
- Add other participants by name and public key.
- When you send a message, it's encrypted separately to every participant's
  public key, then stored in Firestore. Only the matching private key can
  decrypt it, so plaintext never leaves the device.

Messages sync in real time via Firestore's `onSnapshot` — no refresh needed.

## Running locally

It's a static site, so serve the folder with any static server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly also works in most browsers.

## Stack

- [OpenPGP.js](https://openpgpjs.org/) for in-browser encryption
- Firebase Firestore for encrypted message storage and realtime sync
- Plain HTML / CSS / JavaScript - no build step

## Note on Firebase config

The Firebase config in `index.html` is a public client identifier, not a secret
(this is expected for Firebase web apps). Access is controlled by Firestore
security rules, which should be configured to restrict reads/writes.
