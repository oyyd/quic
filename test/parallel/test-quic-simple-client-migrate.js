// Flags: --expose-internals --no-warnings
'use strict';

const common = require('../common');
if (!common.hasQuic)
  common.skip('missing quic');

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
let client2;
const server = createSocket();
const kServerName = 'agent1';
const kALPN = 'zzz';

const countdown = new Countdown(2, () => {
  debug('Countdown expired. Destroying sockets');
  server.close();
  client2.close();
});

server.listen({ key, cert, ca, alpn: kALPN });
server.on('session', common.mustCall((session) => {
  debug('QuicServerSession Created');

  session.on('pathValidation', common.mustCall((result, local, remote) => {
    assert.strictEqual(result, 'success');
    assert.strictEqual(local.address, '0.0.0.0');
    assert.strictEqual(local.family, 'IPv4');
    assert.strictEqual(local.port, server.endpoints[0].address.port);
    assert.strictEqual(remote.address, '127.0.0.1');
    assert.strictEqual(remote.family, 'IPv4');
    assert.strictEqual(remote.port, client2.endpoints[0].address.port);
  }));

  session.on('stream', common.mustCall((stream) => {
    debug('Bidirectional, Client-initiated stream %d received', stream.id);
    stream.pipe(stream);

    const uni = session.openStream({ halfOpen: true });
    uni.end('Hello from the server');
  }));

}));

server.on('ready', common.mustCall(() => {
  debug('Server is listening on port %d', server.endpoints[0].address.port);
  const options = { key, cert, ca, alpn: kALPN };
  client = createSocket({ client: options });
  client2 = createSocket({ client: options });

  const req = client.connect({
    address: 'localhost',
    port: server.endpoints[0].address.port,
    servername: kServerName,
  });

  client.on('close', () => debug('Client closing'));

  req.on('secure', common.mustCall((servername, alpn, cipher) => {
    debug('QuicClientSession TLS Handshake Complete');

    const stream = req.openStream();
    // Send some data on one connection...
    stream.write('Hello ');

    // Wait just a bit, then migrate to a different
    // QuicSocket and continue sending.
    setTimeout(() => {
      req.setSocket(client2, (err) => {
        assert(!err);
        debug('Client 1 port is %d', client.endpoints[0].address.port);
        debug('Client 2 port is %d', client2.endpoints[0].address.port);
        client.close();

        stream.end('from the client');
        let data = '';
        stream.resume();
        stream.setEncoding('utf8');
        stream.on('data', (chunk) => data += chunk);
        stream.on('end', common.mustCall(() => {
          assert.strictEqual(data, 'Hello from the client');
          debug('Client received expected data for stream %d', stream.id);
        }));
        stream.on('close', common.mustCall(() => {
          debug('Bidirectional, Client-initiated stream %d closed', stream.id);
          countdown.dec();
        }));
        debug('Bidirectional, Client-initiated stream %d opened', stream.id);
      });
    }, common.platformTimeout(100));
  }));

  req.on('stream', common.mustCall((stream) => {
    debug('Unidirectional, Server-initiated stream %d received', stream.id);
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => data += chunk);
    stream.on('end', common.mustCall(() => {
      assert.strictEqual(data, 'Hello from the server');
      debug('Client received expected data for stream %d', stream.id);
    }));
    stream.on('close', common.mustCall(() => {
      debug('Unidirectional, Server-initiated stream %d closed', stream.id);
      countdown.dec();
    }));
  }));
}));

server.on('listening', common.mustCall());
server.on('close', () => debug('Server closing'));
