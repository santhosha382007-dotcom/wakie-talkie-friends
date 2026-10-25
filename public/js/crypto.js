/**
 * Simple & Confidential Cryptographic Engine
 * Transparently encrypts voice audio when a Channel PIN is provided.
 */

class SimpleCrypto {
  constructor() {
    this.cryptoKey = null;
    this.hasPin = false;
  }

  async setPin(channel, pin) {
    const cleanPin = String(pin || '').trim();
    if (!cleanPin) {
      this.cryptoKey = null;
      this.hasPin = false;
      return false;
    }

    this.hasPin = true;
    const salt = new TextEncoder().encode(`WALKIE-FRIENDS:${channel}`);
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(cleanPin),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    this.cryptoKey = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 10000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    return true;
  }

  async encrypt(pcmInt16) {
    if (!this.hasPin || !this.cryptoKey) {
      return {
        iv: null,
        ciphertext: this.bufferToBase64(pcmInt16.buffer),
        isEncrypted: false
      };
    }

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.cryptoKey,
      pcmInt16.buffer
    );

    return {
      iv: this.bufferToBase64(iv.buffer),
      ciphertext: this.bufferToBase64(encrypted),
      isEncrypted: true
    };
  }

  async decrypt(ivBase64, ciphertextBase64, isEncrypted) {
    const buffer = this.base64ToBuffer(ciphertextBase64);

    if (!isEncrypted) {
      return new Int16Array(buffer);
    }

    if (!this.hasPin || !this.cryptoKey || !ivBase64) {
      return null; // Cannot decrypt without PIN
    }

    try {
      const iv = new Uint8Array(this.base64ToBuffer(ivBase64));
      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this.cryptoKey,
        buffer
      );
      return new Int16Array(decrypted);
    } catch (e) {
      return null; // Wrong PIN
    }
  }

  bufferToBase64(buf) {
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  base64ToBuffer(base64) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

window.simpleCrypto = new SimpleCrypto();
