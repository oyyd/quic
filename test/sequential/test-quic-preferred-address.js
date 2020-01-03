// Flags: --expose-internals --no-warnings
'use strict';

const common = require('../common');
if (!common.hasQuic)
  common.skip('missing quic');

const { Buffer } = require('buffer');
const Countdown = require('../common/countdown');
const assert = require('assert');
const fixtures = require('../common/fixtures');
const key = fixtures.readKey('agent1-key.pem', 'binary');
const cert = fixtures.readKey('agent1-cert.pem', 'binary');
const ca = fixtures.readKey('ca1-cert.pem', 'binary');
const { debuglog } = require('util');
const debug = debuglog('test');

const { createSocket } = require('quic');

let client;

const server = createSocket();
const endpoint2 = server.addEndpoint({ port: common.PORT });

const kALPN = 'zzz';  // ALPN can be overriden to whatever we want

const countdown = new Countdown(1, () => {
  debug('Countdown expired. Destroying sockets');
  server.close();
  client.close();
});

server.listen({ key, cert, ca, alpn: kALPN, preferredAddress: {
  port: common.PORT,
  address: '0.0.0.0',
  type: 'udp4',
} });

server.on('session', common.mustCall((session) => {
  debug('QuicServerSession Created');
  session.on('stream', common.mustCall((stream) => {
    stream.end('hello world');
    stream.resume();
    stream.on('close', common.mustCall());
    stream.on('finish', common.mustCall());
  }));
}));

server.on('ready', common.mustCall(() => {
  const endpoints = server.endpoints;
  for (const endpoint of endpoints) {
    const address = endpoint.address;
    debug('Server is listening on address %s:%d',
          address.address,
          address.port);
  }
  const endpoint = endpoints[0];

  client = createSocket({ client: {
    key,
    cert,
    ca,
    alpn: kALPN,
    preferredAddressPolicy: 'accept' } });

  client.on('close', common.mustCall());

  const req = client.connect({
    address: 'localhost',
    port: endpoint.address.port,
    servername: 'localhost',
  });

  req.on('pathValidation', common.mustCall((result, local, remote) => {
    assert.strictEqual(result, 'success');
    assert.strictEqual(local.address, '0.0.0.0');
    assert.strictEqual(local.family, 'IPv4');
    assert.strictEqual(local.port, client.endpoints[0].address.port);
    assert.strictEqual(remote.address, '0.0.0.0');
    assert.strictEqual(remote.family, 'IPv4');
    assert.strictEqual(remote.port, endpoint2.address.port);
  }));

  req.on('ready', common.mustCall(() => {
    req.on('usePreferredAddress', common.mustCall(({address, port, type}) => {
      assert.strictEqual(address, '0.0.0.0');
      assert.strictEqual(port, common.PORT);
      assert.strictEqual(type, 'udp4');
    }));
  }));

  req.on('secure', common.mustCall((servername, alpn, cipher) => {
    const stream = req.openStream();
    stream.end('hello world');
    stream.resume();

    stream.on('close', common.mustCall(() => {
      countdown.dec();
    }));
  }));

  req.on('close', common.mustCall());
}));

server.on('listening', common.mustCall());
